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
function normalize(value) { return String(value || "").trim().replace(/\\s+/g, " ").toLocaleLowerCase(); }
function pairKey(offer, want) { return `${normalize(offer)}\\u001f${normalize(want)}`; }
async function pairCount(env, owner) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM creator_pairs WHERE owner=?").bind(owner).first();
  return Number(row?.total || 0);
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
  const pairWhere = owner ? " WHERE owner=?" : "";
  const eventWhere = owner ? " WHERE owner=?" : "";
  const pairBind = owner ? [owner] : [];
  const eventBind = owner ? [owner] : [];
  const uniqueRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM creator_pairs${pairWhere}`).bind(...pairBind).first();
  const eventRow = await env.DB.prepare(`SELECT COUNT(*) AS attempts, COALESCE(SUM(is_duplicate),0) AS duplicates FROM creator_pair_events${eventWhere}`).bind(...eventBind).first();
  // Intentionally analyze every saved pair; this is the source of truth for the quality dashboard.
  const pairs = (await env.DB.prepare(`SELECT offer_text,want_text FROM creator_pairs${pairWhere} ORDER BY id ASC`).bind(...pairBind).all()).results || [];
  const attempts = Number(eventRow?.attempts || 0);
  const duplicates = Number(eventRow?.duplicates || 0);
  const totalWords = pairs.reduce((sum,p) => sum + `${p.offer_text || ''} ${p.want_text || ''}`.trim().split(/\s+/).filter(Boolean).length, 0);
  const offerThemes = {}; const wantThemes = {};
  for (const pair of pairs) {
    const ot = themeOf(pair.offer_text); const wt = themeOf(pair.want_text);
    offerThemes[ot] = (offerThemes[ot] || 0) + 1;
    wantThemes[wt] = (wantThemes[wt] || 0) + 1;
  }
  const top = (obj) => Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([theme,count])=>({theme,count,share:pairs.length ? Math.round(count/pairs.length*1000)/10 : 0}));
  return { unique_pairs:Number(uniqueRow?.total || 0), attempts, duplicates, duplicate_rate: attempts ? Math.round(duplicates/attempts*1000)/10 : 0, average_pair_words:pairs.length ? Math.round(totalWords/pairs.length*10)/10 : 0, offer_themes:top(offerThemes), want_themes:top(wantThemes) };
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
  const url = new URL(request.url);
  const ownerParam = url.searchParams.get("owner");
  const owner = ownerParam ? ownerOf(ownerParam) : null;
  const presets = owner ? (await env.DB.prepare("SELECT * FROM creator_mission_presets WHERE owner=? ORDER BY updated_at DESC, id DESC").bind(owner).all()).results : [];
  const history = owner ? (await env.DB.prepare("SELECT * FROM creator_mission_history WHERE owner=? ORDER BY completed_at DESC, id DESC LIMIT 100").bind(owner).all()).results : [];
  const active = owner ? await env.DB.prepare("SELECT * FROM active_creator_missions WHERE owner=?").bind(owner).first() : null;
  const scope = owner ? "owner" : "all";
  let quality = await qualityStats(env, owner);
  let trend = await qualityTrend(env, scope, owner);
  if (!trend.length && quality.unique_pairs) {
    const snap = await saveQualitySnapshot(env, scope, owner);
    quality = snap;
    trend = [snap];
  }
  return json({ presets, history, active: active || null, pairTotal: quality.unique_pairs, quality, trend });
}

export async function onRequestPost({ request, env }) {
  await ensureTables(env);
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
    await saveQualitySnapshot(env, "owner", owner);
    await saveQualitySnapshot(env, "all", null);
    return json({ recorded: Number(result.meta.changes || 0) > 0, pairTotal: await pairCount(env, owner) });
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
