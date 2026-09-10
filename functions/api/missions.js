import { json, errorJson } from "../_utils.js";

async function ensureTables(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mission_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    goal INTEGER NOT NULL DEFAULT 100,
    flag TEXT NOT NULL DEFAULT '🏁',
    labeler TEXT,
    baseline_labeled INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    active INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    completed_total INTEGER
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mission_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    goal INTEGER NOT NULL,
    flag TEXT NOT NULL DEFAULT '🏁',
    labeler TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mission_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal INTEGER NOT NULL,
    flag TEXT NOT NULL,
    labeler TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    baseline_labeled INTEGER NOT NULL DEFAULT 0,
    completed_total INTEGER NOT NULL DEFAULT 0,
    labels_completed INTEGER NOT NULL DEFAULT 0
  )`).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO mission_state (id) VALUES (1)`).run();
}

async function getStats(env) {
  const counts = await env.DB.prepare(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status='labeled' THEN 1 ELSE 0 END) AS labeled,
    SUM(CASE WHEN status='unlabeled' THEN 1 ELSE 0 END) AS unlabeled
    FROM entries`).first();
  return { total: Number(counts?.total || 0), labeled: Number(counts?.labeled || 0), unlabeled: Number(counts?.unlabeled || 0) };
}

async function maybeComplete(env) {
  const state = await env.DB.prepare("SELECT * FROM mission_state WHERE id=1").first();
  if (!state || !state.active) return state;
  const stats = await getStats(env);
  const progress = Math.max(0, stats.labeled - Number(state.baseline_labeled || 0));
  if (progress < Number(state.goal)) return state;
  const completedAt = new Date().toISOString();
  await env.DB.prepare(`UPDATE mission_state SET active=0, completed_at=?, completed_total=? WHERE id=1`)
    .bind(completedAt, stats.labeled).run();
  await env.DB.prepare(`INSERT INTO mission_history (goal, flag, labeler, started_at, completed_at, baseline_labeled, completed_total, labels_completed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(state.goal, state.flag, state.labeler || null, state.started_at || completedAt, completedAt, state.baseline_labeled || 0, stats.labeled, progress).run();
  return { ...state, active: 0, completed_at: completedAt, completed_total: stats.labeled };
}

export async function onRequestGet({ env }) {
  await ensureTables(env);
  const state = await maybeComplete(env);
  const stats = await getStats(env);
  const presets = await env.DB.prepare("SELECT * FROM mission_presets ORDER BY updated_at DESC, id DESC").all();
  const history = await env.DB.prepare("SELECT * FROM mission_history ORDER BY completed_at DESC, id DESC LIMIT 100").all();
  const active = state && state.active ? {
    goal: Number(state.goal), flag: state.flag, labeler: state.labeler || "", baseline_labeled: Number(state.baseline_labeled || 0),
    started_at: state.started_at, progress: Math.min(Number(state.goal), Math.max(0, stats.labeled - Number(state.baseline_labeled || 0))),
    remaining: Math.max(0, Number(state.goal) - Math.max(0, stats.labeled - Number(state.baseline_labeled || 0)))
  } : null;
  return json({ active, stats, presets: presets.results, history: history.results });
}

export async function onRequestPost({ request, env }) {
  await ensureTables(env);
  const body = await request.json().catch(() => ({}));
  const action = body.action || "start";
  if (action === "start") {
    const goal = Math.max(1, Math.min(10000, Number(body.goal) || 100));
    const flag = String(body.flag || "🏁").slice(0, 8);
    const labeler = String(body.labeler || "").trim();
    const stats = await getStats(env);
    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE mission_state SET goal=?, flag=?, labeler=?, baseline_labeled=?, started_at=?, active=1, completed_at=NULL, completed_total=NULL WHERE id=1`)
      .bind(goal, flag, labeler || null, stats.labeled, now).run();
    return json({ started: true, goal, flag, labeler, baseline_labeled: stats.labeled, started_at: now });
  }
  if (action === "save-preset") {
    const name = String(body.name || "").trim();
    const goal = Math.max(1, Math.min(10000, Number(body.goal) || 100));
    if (!name) return errorJson("Give the mission preset a name.");
    const flag = String(body.flag || "🏁").slice(0, 8);
    const labeler = String(body.labeler || "").trim();
    const now = new Date().toISOString();
    const result = await env.DB.prepare(`INSERT INTO mission_presets (name, goal, flag, labeler, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(name, goal, flag, labeler || null, now, now).run();
    return json({ id: result.meta.last_row_id, name, goal, flag, labeler, created_at: now, updated_at: now });
  }
  return errorJson("Unknown mission action.");
}

export async function onRequestPut({ request, env }) {
  await ensureTables(env);
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!id) return errorJson("Need a preset id.");
  const name = String(body.name || "").trim();
  const goal = Math.max(1, Math.min(10000, Number(body.goal) || 100));
  if (!name) return errorJson("Give the mission preset a name.");
  const flag = String(body.flag || "🏁").slice(0, 8);
  const labeler = String(body.labeler || "").trim();
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`UPDATE mission_presets SET name=?, goal=?, flag=?, labeler=?, updated_at=? WHERE id=?`)
    .bind(name, goal, flag, labeler || null, now, id).run();
  if (!result.meta.changes) return errorJson("Preset not found.", 404);
  return json({ updated: true, id, name, goal, flag, labeler, updated_at: now });
}

export async function onRequestDelete({ request, env }) {
  await ensureTables(env);
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return errorJson("Missing preset id.");
  const result = await env.DB.prepare("DELETE FROM mission_presets WHERE id=?").bind(id).run();
  if (!result.meta.changes) return errorJson("Preset not found.", 404);
  return json({ deleted: id });
}

export async function completeMissionIfNeeded(env) {
  await ensureTables(env);
  return maybeComplete(env);
}
