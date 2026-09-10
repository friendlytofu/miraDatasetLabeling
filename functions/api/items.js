import { json, errorJson } from "../_utils.js";

function cleanUploadKey(value) {
  const key = String(value || "").trim();
  return key.length >= 8 && key.length <= 200 ? key : null;
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

async function ensureUploadColumns(env) {
  // Keep older D1 databases compatible even if the migration has not yet been run.
  // SQLite will reject the ALTER when the column already exists, which is harmless.
  for (const sql of [
    "ALTER TABLE items ADD COLUMN upload_key TEXT",
    "ALTER TABLE items ADD COLUMN upload_index INTEGER",
    "ALTER TABLE creator_pair_events ADD COLUMN upload_key TEXT"
  ]) {
    try { await env.DB.prepare(sql).run(); } catch (_) {}
  }
  try { await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_items_upload_key_index ON items(upload_key, upload_index) WHERE upload_key IS NOT NULL").run(); } catch (_) {}
  try { await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_pair_events_upload_key ON creator_pair_events(upload_key) WHERE upload_key IS NOT NULL").run(); } catch (_) {}
}

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT id, text, type, source_phrase, created_at FROM items ORDER BY id DESC"
  ).all();
  return json({ items: results });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body) return errorJson("Invalid JSON body");

  const incoming = Array.isArray(body.items) ? body.items : [body];
  if (!incoming.length) return errorJson("No items supplied.");

  // The browser keeps this key when a save request needs to be retried. The same
  // key makes the operation idempotent: a retry returns the original saved items
  // instead of inserting another copy.
  const uploadKey = cleanUploadKey(request.headers.get("Idempotency-Key") || body.upload_key);
  if (uploadKey) await ensureUploadColumns(env);

  if (uploadKey) {
    const prior = (await env.DB.prepare(
      "SELECT id, text, type, source_phrase, created_at FROM items WHERE upload_key=? ORDER BY upload_index ASC, id ASC"
    ).bind(uploadKey).all()).results || [];
    if (prior.length) {
      let creatorPairResult = null;
      if (body.creator_pair && typeof body.creator_pair === "object") {
        const owner = String(body.creator_pair.owner || "default").trim().slice(0, 120) || "default";
        const event = await env.DB.prepare(
          "SELECT pair_key, is_duplicate FROM creator_pair_events WHERE upload_key=? LIMIT 1"
        ).bind(uploadKey).first();
        const countRow = await env.DB.prepare("SELECT COUNT(*) AS total FROM creator_pairs WHERE owner=?").bind(owner).first();
        creatorPairResult = event ? {
          recorded: Number(event.is_duplicate || 0) === 0,
          duplicate: Number(event.is_duplicate || 0) === 1,
          pairTotal: Number(countRow?.total || 0)
        } : null;
      }
      return json({ created: prior, creatorPair: creatorPairResult, idempotent: true });
    }
  }

  // Creation missions count distinct offer + want pairs saved from the drafting desk.
  const creatorPair = body.creator_pair && typeof body.creator_pair === "object" ? body.creator_pair : null;
  if (creatorPair) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL DEFAULT 'default', pair_key TEXT NOT NULL,
      offer_text TEXT NOT NULL, want_text TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner, pair_key)
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_pair_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL DEFAULT 'default', pair_key TEXT NOT NULL,
      offer_text TEXT NOT NULL, want_text TEXT NOT NULL, is_duplicate INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    )`).run();
    if (uploadKey) await ensureUploadColumns(env);
  }

  const now = new Date().toISOString();
  const validated = [];
  for (const [index, it] of incoming.entries()) {
    const text = (it.text || "").trim();
    const type = it.type;
    if (!text || (type !== "offer" && type !== "want")) {
      return errorJson(`Each item needs non-empty text and type 'offer' or 'want'. Got: ${JSON.stringify(it)}`);
    }
    const createdAt = typeof it.created_at === "string" && !Number.isNaN(Date.parse(it.created_at)) ? it.created_at : now;
    validated.push({ text, type, source_phrase: it.source_phrase || null, created_at: createdAt, index });
  }

  // Insert the actual items and the creator-pair event in one atomic D1 batch.
  // This prevents a failed follow-up analytics query from leaving a half-completed upload.
  const statements = validated.map((it) => env.DB.prepare(
    `INSERT INTO items (text, type, source_phrase, created_at${uploadKey ? ", upload_key, upload_index" : ""})
     VALUES (?, ?, ?, ?${uploadKey ? ", ?, ?" : ""})`
  ).bind(...(
    uploadKey
      ? [it.text, it.type, it.source_phrase, it.created_at, uploadKey, it.index]
      : [it.text, it.type, it.source_phrase, it.created_at]
  )));

  let pairInfo = null;
  if (creatorPair) {
    const owner = String(creatorPair.owner || "default").trim().slice(0, 120) || "default";
    const offer = String(creatorPair.offer_text || "").trim();
    const want = String(creatorPair.want_text || "").trim();
    if (offer && want) {
      const pairKey = `${normalize(offer)}\u001f${normalize(want)}`;
      // Pair row is unique per owner + normalized text, while the event is unique
      // per upload key. A retry therefore cannot create another pair event either.
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO creator_pairs(owner,pair_key,offer_text,want_text,created_at) VALUES (?,?,?,?,?)")
        .bind(owner, pairKey, offer, want, now));
      if (uploadKey) {
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO creator_pair_events(owner,pair_key,offer_text,want_text,is_duplicate,created_at,upload_key) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM creator_pair_events WHERE upload_key=?)")
          .bind(owner, pairKey, offer, want, 0, now, uploadKey, uploadKey));
      } else {
        // Legacy/non-idempotent callers retain the existing duplicate-attempt tracking.
        statements.push(env.DB.prepare("INSERT INTO creator_pair_events(owner,pair_key,offer_text,want_text,is_duplicate,created_at) VALUES (?,?,?,?,?,?)")
          .bind(owner, pairKey, offer, want, 0, now));
      }
      pairInfo = { owner, pairKey, offer, want };
    }
  }

  let batchResults = null;
  try {
    batchResults = await env.DB.batch(statements);
  } catch (writeError) {
    // A concurrent retry can race the unique idempotency index. If that happened,
    // return the already-created upload instead of surfacing a misleading 500.
    if (uploadKey) {
      const prior = (await env.DB.prepare(
        "SELECT id, text, type, source_phrase, created_at FROM items WHERE upload_key=? ORDER BY upload_index ASC, id ASC"
      ).bind(uploadKey).all()).results || [];
      if (prior.length) return json({ created: prior, creatorPair: null, idempotent: true });
    }
    console.error("Item upload failed:", writeError);
    return errorJson("Could not save the upload. No duplicate items were created.", 500);
  }

  let created = [];
  if (uploadKey) {
    created = (await env.DB.prepare(
      "SELECT id, text, type, source_phrase, created_at FROM items WHERE upload_key=? ORDER BY upload_index ASC, id ASC"
    ).bind(uploadKey).all()).results || [];
  } else {
    // D1 batch results preserve statement order and expose last_row_id for INSERTs.
    // Use those exact IDs instead of guessing from the most recent rows, which can
    // return another concurrent upload's items.
    const ids = (batchResults || []).slice(0, validated.length)
      .map(result => Number(result?.meta?.last_row_id || 0))
      .filter(id => id > 0);
    if (ids.length === validated.length) {
      const rows = (await env.DB.prepare(
        `SELECT id, text, type, source_phrase, created_at FROM items WHERE id IN (${ids.map(() => "?").join(",")})`
      ).bind(...ids).all()).results || [];
      const byId = new Map(rows.map(row => [Number(row.id), row]));
      created = ids.map(id => byId.get(id)).filter(Boolean);
    } else {
      // Defensive fallback for runtimes that omit last_row_id. This branch is only
      // for legacy non-idempotent callers; never use a broad "latest N" query when
      // an exact ID list is available.
      created = [];
    }
  }

  let creatorPairResult = null;
  if (pairInfo) {
    const pairRow = await env.DB.prepare("SELECT COUNT(*) AS total FROM creator_pairs WHERE owner=?").bind(pairInfo.owner).first();
    const recordedRow = uploadKey
      ? await env.DB.prepare("SELECT is_duplicate FROM creator_pair_events WHERE upload_key=? LIMIT 1").bind(uploadKey).first()
      : null;
    creatorPairResult = {
      recorded: uploadKey ? Number(recordedRow?.is_duplicate || 0) === 0 : true,
      duplicate: uploadKey ? Number(recordedRow?.is_duplicate || 0) === 1 : false,
      pairTotal: Number(pairRow?.total || 0)
    };
  }

  // Analytics is deliberately best-effort. It must never turn a successful upload into HTTP 500.
  if (pairInfo) {
    try {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_quality_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL DEFAULT 'all', owner TEXT,
        captured_at TEXT NOT NULL, total_pairs INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
        duplicates INTEGER NOT NULL DEFAULT 0, duplicate_rate REAL NOT NULL DEFAULT 0, average_pair_words REAL NOT NULL DEFAULT 0,
        offer_themes TEXT NOT NULL DEFAULT '[]', want_themes TEXT NOT NULL DEFAULT '[]'
      )`).run();
      const pairRows = (await env.DB.prepare("SELECT offer_text,want_text FROM creator_pairs WHERE owner=? ORDER BY id ASC").bind(pairInfo.owner).all()).results || [];
      const events = await env.DB.prepare("SELECT COUNT(*) AS attempts, COALESCE(SUM(is_duplicate),0) AS duplicates FROM creator_pair_events WHERE owner=?").bind(pairInfo.owner).first();
      const words = pairRows.reduce((sum,p) => sum + `${p.offer_text || ''} ${p.want_text || ''}`.trim().split(/\s+/).filter(Boolean).length, 0);
      const snapNow = new Date().toISOString();
      const avg = pairRows.length ? Math.round(words / pairRows.length * 10) / 10 : 0;
      const dupRate = Number(events?.attempts || 0) ? Math.round(Number(events?.duplicates || 0) / Number(events.attempts) * 1000) / 10 : 0;
      await env.DB.prepare(`INSERT INTO creator_quality_snapshots(scope,owner,captured_at,total_pairs,attempts,duplicates,duplicate_rate,average_pair_words,offer_themes,want_themes) VALUES ('owner',?,?,?,?,?,?, '[]','[]')`)
        .bind(pairInfo.owner,snapNow,pairRows.length,Number(events?.attempts || 0),Number(events?.duplicates || 0),dupRate,avg).run();
    } catch (snapshotError) { console.warn("Owner quality snapshot failed after item save:", snapshotError); }
  }

  return json({ created, creatorPair: creatorPairResult, idempotent: false });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return errorJson("Missing id");
  await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
  return json({ deleted: Number(id) });
}
