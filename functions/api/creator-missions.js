import { json, errorJson } from "../_utils.js";

async function ensureTables(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL DEFAULT 'default',
    pair_key TEXT NOT NULL,
    offer_text TEXT NOT NULL,
    want_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(owner, pair_key)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_pair_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL DEFAULT 'default',
    pair_key TEXT NOT NULL,
    offer_text TEXT NOT NULL,
    want_text TEXT NOT NULL,
    is_duplicate INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_creator_pair_events_owner_created ON creator_pair_events(owner, created_at DESC)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_mission_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    goal INTEGER NOT NULL,
    flag TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_mission_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL DEFAULT 'default',
    goal INTEGER NOT NULL,
    flag TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    starting_pairs INTEGER NOT NULL DEFAULT 0,
    pairs_total INTEGER NOT NULL DEFAULT 0
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_creator_pairs_owner_created ON creator_pairs(owner, created_at DESC)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS active_creator_missions (
    owner TEXT PRIMARY KEY, goal INTEGER NOT NULL, flag TEXT NOT NULL, started_at TEXT NOT NULL,
    starting_pairs INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_creator_mission_history_owner_completed ON creator_mission_history(owner, completed_at DESC)").run();
}

function ownerOf(value) { return String(value || "default").trim().slice(0, 120) || "default"; }
function normalize(value) { return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
function pairKey(offer, want) { return `${normalize(offer)}\u001f${normalize(want)}`; }
async function pairCount(env, owner) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM creator_pairs WHERE owner=?").bind(owner).first();
  return Number(row?.total || 0);
}

// Older versions stored authored offers/wants only in items. Reconcile that
// legacy bank once: the item bank is the source of truth for the pairs that
// already existed before per-user pair tracking was introduced. If a Tony user
// exists, those legacy pairs are credited to Tony rather than the old "default"
// owner. This prevents legacy backfill from inflating the dataset count.
async function legacyPairSet(env) {
  const rows = (await env.DB.prepare(`
    SELECT id, text, type, source_phrase, created_at
    FROM items
    WHERE source_phrase IS NOT NULL AND TRIM(source_phrase) <> ''
    ORDER BY source_phrase, id
  `).all()).results || [];
  const groups = new Map();
  for (const row of rows) {
    const source = normalize(row.source_phrase);
    if (!source) continue;
    if (!groups.has(source)) groups.set(source, { offers: [], wants: [] });
    if (row.type === 'offer') groups.get(source).offers.push(row);
    if (row.type === 'want') groups.get(source).wants.push(row);
  }
  const pairs = [];
  for (const group of groups.values()) {
    const count = Math.min(group.offers.length, group.wants.length);
    for (let i = 0; i < count; i++) {
      const offer = String(group.offers[i].text || '').trim();
      const want = String(group.wants[i].text || '').trim();
      if (offer && want) pairs.push({ key: pairKey(offer, want), offer, want, created_at: group.offers[i].created_at || group.wants[i].created_at });
    }
  }
  const seen = new Set();
  return pairs.filter(p => !seen.has(p.key) && seen.add(p.key));
}

async function reconcileLegacyPairs(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_legacy_reconciliation (
    id INTEGER PRIMARY KEY CHECK (id=1), reconciled_at TEXT NOT NULL, pair_count INTEGER NOT NULL DEFAULT 0
  )`).run();
  const done = await env.DB.prepare("SELECT id FROM creator_legacy_reconciliation WHERE id=1").first();
  if (done) return Number(done.pair_count || 0);

  const pairs = await legacyPairSet(env);
  const tony = await env.DB.prepare("SELECT id,name FROM users WHERE active=1 AND lower(name)=lower('tony') ORDER BY id LIMIT 1").first();
  const tonyOwner = tony ? `user:${Number(tony.id)}` : null;

  // The nine (or however many) pairs already represented by the item bank are
  // authoritative. Credit them to Tony when that legacy contributor exists.
  if (tonyOwner) {
    for (const pair of pairs) {
      await env.DB.prepare(`INSERT OR IGNORE INTO creator_pairs(owner,pair_key,offer_text,want_text,created_at) VALUES (?,?,?,?,?)`)
        .bind(tonyOwner, pair.key, pair.offer, pair.want, pair.created_at || new Date().toISOString()).run();
    }
    // Move old default events to Tony so duplicate history remains attached to
    // the original contributor without creating a second pair count.
    await env.DB.prepare("UPDATE creator_pair_events SET owner=? WHERE owner='default' AND pair_key IN (SELECT pair_key FROM creator_pairs WHERE owner=? )")
      .bind(tonyOwner, tonyOwner).run();
  }

  // Remove legacy/default rows that are now represented by the canonical item
  // bank. Any current, explicitly-owned user pairs remain untouched.
  if (pairs.length) {
    const keys = pairs.map(p => p.key);
    for (const key of keys) {
      if (tonyOwner) {
        await env.DB.prepare("DELETE FROM creator_pairs WHERE owner='default' AND pair_key=?").bind(key).run();
      }
    }
  }

  await env.DB.prepare("INSERT INTO creator_legacy_reconciliation(id,reconciled_at,pair_count) VALUES (1,?,?)")
    .bind(new Date().toISOString(), pairs.length).run();
  return pairs.length;
}

async function backfillLegacyPairs(env) {
  // Kept as a compatibility wrapper for older callers. Reconciliation is
  // deliberately one-time so subsequent users' contributions are never
  // reassigned to Tony.
  return reconcileLegacyPairs(env);
}
const THEME_RULES = [
  ["Teaching & learning", /teach|tutor|lesson|study|learn|homework|class|math|science|history|school|academic|mentor|coach/],
  ["Sports & fitness", /baseball|basketball|soccer|football|tennis|running|fitness|workout|gym|yoga|climb|swim|sport|training/],
  ["Creative & arts", /draw|paint|photo|music|guitar|piano|sing|dance|design|write|writing|film|video|art|craft|creative/],
  ["Technology", /code|coding|program|software|website|web|app|data|python|javascript|tech|computer|ai|robot/],
  ["Food & cooking", /cook|bake|recipe|food|meal|kitchen|bread|cake|garden|gardening/],
  ["Language & culture", /language|english|spanish|french|chinese|japanese|korean|translate|conversation|culture/],
  ["Outdoors & nature", /hike|hiking|camp|camping|garden|nature|bird|plant|bonsai|outdoor|fishing|trail/],
  ["Practical skills", /repair|fix|woodwork|carpentry|sew|sewing|budget|finance|organize|clean|diy|handy/],
  ["Community & social", /meet|friend|community|volunteer|event|group|network|chat|social|local/]
];
function themeOf(text) {
  const value = String(text || '').toLocaleLowerCase();
  return THEME_RULES.find(([, rule]) => rule.test(value))?.[0] || 'General & everyday';
}
async function qualityStats(env, owner = null) {
  // Quality is a snapshot of the CURRENT offer + want bank only.
  // Do not use creator_pair_events or quality snapshots here: those are historical
  // records and must never inflate the current dataset assessment.
  const where = owner ? " WHERE owner=?" : "";
  const bind = owner ? [owner] : [];
  const pairRows = (await env.DB.prepare(
    `SELECT id, owner, pair_key, offer_text, want_text, created_at FROM creator_pairs${where} ORDER BY id ASC`
  ).bind(...bind).all()).results || [];

  const normalizedKeys = new Set();
  const offerThemes = {}; const wantThemes = {};
  let totalWords = 0;
  for (const pair of pairRows) {
    const key = String(pair.pair_key || pairKey(pair.offer_text, pair.want_text));
    normalizedKeys.add(key);
    totalWords += `${pair.offer_text || ''} ${pair.want_text || ''}`.trim().split(/\s+/).filter(Boolean).length;
    const ot = themeOf(pair.offer_text); const wt = themeOf(pair.want_text);
    offerThemes[ot] = (offerThemes[ot] || 0) + 1;
    wantThemes[wt] = (wantThemes[wt] || 0) + 1;
  }

  // A duplicate here means the SAME normalized offer + want pair currently exists
  // more than once in the current bank (for example, under different owners).
  // Historical save attempts are intentionally excluded.
  const duplicateCount = Math.max(0, pairRows.length - normalizedKeys.size);
  const duplicateRate = pairRows.length ? Math.round(duplicateCount / pairRows.length * 1000) / 10 : 0;
  const top = (obj) => Object.entries(obj)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,8)
    .map(([theme,count])=>({theme,count,share:pairRows.length ? Math.round(count/pairRows.length*1000)/10 : 0}));

  return {
    unique_pairs: pairRows.length,
    current_pairs: pairRows.length,
    attempts: pairRows.length,
    duplicates: duplicateCount,
    duplicate_rate: duplicateRate,
    average_pair_words: pairRows.length ? Math.round(totalWords/pairRows.length*10)/10 : 0,
    offer_themes: top(offerThemes),
    want_themes: top(wantThemes),
    assessed_at: new Date().toISOString()
  };
}

async function saveQualitySnapshot(env, scope = 'all', owner = null) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_quality_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL DEFAULT 'all', owner TEXT,
    captured_at TEXT NOT NULL, total_pairs INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
    duplicates INTEGER NOT NULL DEFAULT 0, duplicate_rate REAL NOT NULL DEFAULT 0, average_pair_words REAL NOT NULL DEFAULT 0,
    offer_themes TEXT NOT NULL DEFAULT '[]', want_themes TEXT NOT NULL DEFAULT '[]'
  )`).run();
  const q = await qualityStats(env, owner);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO creator_quality_snapshots(scope,owner,captured_at,total_pairs,attempts,duplicates,duplicate_rate,average_pair_words,offer_themes,want_themes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(scope, owner, now, q.unique_pairs, q.attempts, q.duplicates, q.duplicate_rate, q.average_pair_words, JSON.stringify(q.offer_themes), JSON.stringify(q.want_themes)).run();
  return { ...q, captured_at: now };
}

async function qualityTrend(env, scope = 'all', owner = null) {
  const rows = (await env.DB.prepare("SELECT captured_at,total_pairs,attempts,duplicates,duplicate_rate,average_pair_words FROM creator_quality_snapshots WHERE scope=? AND ((owner IS NULL AND ? IS NULL) OR owner=?) ORDER BY captured_at DESC LIMIT 30").bind(scope, owner, owner).all()).results || [];
  return rows.reverse();
}

export async function onRequestGet({ request, env }) {
  await ensureTables(env);
  await backfillLegacyPairs(env);
  const url = new URL(request.url);
  const ownerParam = url.searchParams.get("owner");
  const owner = ownerParam ? ownerOf(ownerParam) : null;
  const presets = owner ? (await env.DB.prepare("SELECT * FROM creator_mission_presets WHERE owner=? ORDER BY updated_at DESC, id DESC").bind(owner).all()).results : [];
  const history = owner ? (await env.DB.prepare("SELECT * FROM creator_mission_history WHERE owner=? ORDER BY completed_at DESC, id DESC LIMIT 100").bind(owner).all()).results : [];
  const active = owner ? await env.DB.prepare("SELECT * FROM active_creator_missions WHERE owner=?").bind(owner).first() : null;
  const scope = owner ? "owner" : "all";
  const quality = await qualityStats(env, owner);
  return json({ presets, history, active: active || null, pairTotal: quality.current_pairs, quality, trend: [] });
}

export async function onRequestPost({ request, env }) {
  await ensureTables(env);
  await backfillLegacyPairs(env);
  const body = await request.json().catch(() => null);
  if (!body?.action) return errorJson("Need an action.");
  const owner = ownerOf(body.owner);
  const now = new Date().toISOString();

  if (body.action === "record_pair") {
    const offer = String(body.offer_text || "").trim();
    const want = String(body.want_text || "").trim();
    if (!offer || !want) return errorJson("Need both an offer and a want.");
    const key = pairKey(offer, want);
    const result = await env.DB.prepare("INSERT OR IGNORE INTO creator_pairs(owner,pair_key,offer_text,want_text,created_at) VALUES (?,?,?,?,?)")
      .bind(owner, key, offer, want, now).run();
    return json({ recorded: Number(result.meta.changes || 0) > 0, pairTotal: await pairCount(env, owner) });
  }

  if (body.action === "analyze_quality") {
    const requestedOwner = body.owner ? ownerOf(body.owner) : null;
    const quality = await qualityStats(env, requestedOwner);
    return json({ analyzed:true, current_only:true, quality });
  }

  if (body.action === "preset") {
    const goal = Math.max(1, Math.min(10000, Number(body.goal) || 0));
    const name = String(body.name || `Create · ${goal}`).trim().slice(0, 80);
    const flag = String(body.flag || "✦").slice(0, 4);
    if (!goal || !name) return errorJson("Need a preset name and goal.");
    const result = await env.DB.prepare("INSERT INTO creator_mission_presets(owner,name,goal,flag,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind(owner, name, goal, flag, now, now).run();
    return json({ id: result.meta.last_row_id, owner, name, goal, flag, created_at: now, updated_at: now });
  }

  if (body.action === "delete_preset") {
    const id = Number(body.id);
    if (!id) return errorJson("Need a preset id.");
    await env.DB.prepare("DELETE FROM creator_mission_presets WHERE id=? AND owner=?").bind(id, owner).run();
    return json({ id, deleted: true });
  }

  if (body.action === "start") {
    const goal = Math.max(1, Math.min(10000, Number(body.goal) || 0));
    const flag = String(body.flag || "✦").slice(0, 4);
    if (!goal) return errorJson("Need a mission goal.");
    const startingPairs = await pairCount(env, owner);
    await env.DB.prepare("INSERT OR REPLACE INTO active_creator_missions(owner,goal,flag,started_at,starting_pairs,updated_at) VALUES (?,?,?,?,?,?)")
      .bind(owner,goal,flag,now,startingPairs,now).run();
    return json({ mission: { owner, goal, flag, started_at: now, starting_pairs: startingPairs } });
  }

  if (body.action === "complete") {
    const goal = Math.max(1, Math.min(10000, Number(body.goal) || 0));
    const flag = String(body.flag || "✦").slice(0, 4);
    const startedAt = String(body.started_at || now);
    const startingPairs = Math.max(0, Number(body.starting_pairs) || 0);
    const total = await pairCount(env, owner);
    const pairsThisMission = Math.max(0, total - startingPairs);
    if (pairsThisMission < goal) return errorJson(`Mission is not complete yet: ${pairsThisMission}/${goal} pairs written.`);
    const result = await env.DB.prepare(`INSERT INTO creator_mission_history(owner,goal,flag,started_at,completed_at,starting_pairs,pairs_total) VALUES (?,?,?,?,?,?,?)`)
      .bind(owner, goal, flag, startedAt, now, startingPairs, pairsThisMission).run();
    await env.DB.prepare("DELETE FROM active_creator_missions WHERE owner=?").bind(owner).run();
    return json({ id: result.meta.last_row_id, owner, goal, flag, started_at: startedAt, completed_at: now, starting_pairs: startingPairs, pairs_total: pairsThisMission });
  }

  return errorJson("Unknown creation mission action.");
}
