import { json, errorJson } from "../_utils.js";

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT id, text, type, source_phrase, created_at FROM items ORDER BY id DESC"
  ).all();
  return json({ items: results });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body) return errorJson("Invalid JSON body");

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
  }

  // Accept either a single item { text, type, source_phrase } or a batch { items: [...] }
  const incoming = Array.isArray(body.items) ? body.items : [body];
  const now = new Date().toISOString();
  const created = [];

  for (const it of incoming) {
    const text = (it.text || "").trim();
    const type = it.type;
    if (!text || (type !== "offer" && type !== "want")) {
      return errorJson(`Each item needs non-empty text and type 'offer' or 'want'. Got: ${JSON.stringify(it)}`);
    }
    // If a valid created_at is supplied (e.g. restoring a downloaded backup), keep it
    // so restored items preserve their original place in history instead of looking new.
    const createdAt = typeof it.created_at === "string" && !Number.isNaN(Date.parse(it.created_at)) ? it.created_at : now;
    const res = await env.DB.prepare(
      "INSERT INTO items (text, type, source_phrase, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(text, type, it.source_phrase || null, createdAt)
      .run();
    created.push({ id: res.meta.last_row_id, text, type, source_phrase: it.source_phrase || null, created_at: createdAt });
  }

  let creatorPairResult = null;
  if (creatorPair) {
    const owner = String(creatorPair.owner || "default").trim().slice(0, 120) || "default";
    const offer = String(creatorPair.offer_text || "").trim();
    const want = String(creatorPair.want_text || "").trim();
    if (offer && want) {
      const normalize = (value) => value.replace(/\s+/g, " ").toLocaleLowerCase();
      const pairKey = `${normalize(offer)}\u001f${normalize(want)}`;
      const pairRes = await env.DB.prepare("INSERT OR IGNORE INTO creator_pairs(owner,pair_key,offer_text,want_text,created_at) VALUES (?,?,?,?,?)")
        .bind(owner, pairKey, offer, want, now).run();
      const recorded = Number(pairRes.meta.changes || 0) > 0;
      await env.DB.prepare("INSERT INTO creator_pair_events(owner,pair_key,offer_text,want_text,is_duplicate,created_at) VALUES (?,?,?,?,?,?)")
        .bind(owner, pairKey, offer, want, recorded ? 0 : 1, now).run();
      const countRow = await env.DB.prepare("SELECT COUNT(*) AS total FROM creator_pairs WHERE owner=?").bind(owner).first();
      creatorPairResult = { recorded, duplicate: !recorded, pairTotal: Number(countRow?.total || 0) };
    }
  }

  return json({ created, creatorPair: creatorPairResult });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return errorJson("Missing id");
  await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
  return json({ deleted: Number(id) });
}
