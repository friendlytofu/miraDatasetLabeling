import { json, errorJson } from "../_utils.js";

async function ensureTables(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mission_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL DEFAULT 'default', name TEXT NOT NULL, goal INTEGER NOT NULL, flag TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mission_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL DEFAULT 'default', goal INTEGER NOT NULL, flag TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, starting_labeled INTEGER NOT NULL DEFAULT 0, labeled_total INTEGER NOT NULL DEFAULT 0, generated_total INTEGER NOT NULL DEFAULT 0
  )`).run();
  // Backfill databases created by the first mission version.
  try { await env.DB.prepare("ALTER TABLE mission_presets ADD COLUMN owner TEXT NOT NULL DEFAULT 'default'").run(); } catch {}
  try { await env.DB.prepare("ALTER TABLE mission_history ADD COLUMN owner TEXT NOT NULL DEFAULT 'default'").run(); } catch {}
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_mission_history_owner_completed ON mission_history(owner, completed_at DESC)").run();
}

async function labeledCount(env, owner) {
  if (owner === "default") {
    const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM entries WHERE status='labeled'").first();
    return Number(row?.total || 0);
  }
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM entries WHERE status='labeled' AND labeler=?").bind(owner).first();
  return Number(row?.total || 0);
}

export async function onRequestGet({ request, env }) {
  await ensureTables(env);
  const owner = String(new URL(request.url).searchParams.get("owner") || "default").trim().slice(0, 120) || "default";
  const presets = (await env.DB.prepare("SELECT * FROM mission_presets WHERE owner=? ORDER BY updated_at DESC, id DESC").bind(owner).all()).results;
  const history = (await env.DB.prepare("SELECT * FROM mission_history WHERE owner=? ORDER BY completed_at DESC, id DESC LIMIT 100").bind(owner).all()).results;
  return json({ presets, history, labeledTotal: await labeledCount(env, owner) });
}

export async function onRequestPost({ request, env }) {
  await ensureTables(env);
  const body = await request.json().catch(() => null);
  if (!body?.action) return errorJson("Need an action.");
  const now = new Date().toISOString();
  const owner = String(body.owner || "default").trim().slice(0, 120) || "default";

  if (body.action === "preset") {
    const goal = Math.max(1, Math.min(10000, Number(body.goal) || 0));
    const name = String(body.name || `Mission · ${goal}`).trim().slice(0, 80);
    const flag = String(body.flag || "⚑").slice(0, 4);
    if (!goal || !name) return errorJson("Need a preset name and goal.");
    const result = await env.DB.prepare("INSERT INTO mission_presets(owner,name,goal,flag,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(owner, name, goal, flag, now, now).run();
    return json({ id: result.meta.last_row_id, owner, name, goal, flag, created_at: now, updated_at: now });
  }

  if (body.action === "delete_preset") {
    const id = Number(body.id);
    if (!id) return errorJson("Need a preset id.");
    await env.DB.prepare("DELETE FROM mission_presets WHERE id=? AND owner=?").bind(id, owner).run();
    return json({ id, deleted: true });
  }

  if (body.action === "start") {
    const goal = Math.max(1, Math.min(10000, Number(body.goal) || 0));
    const flag = String(body.flag || "⚑").slice(0, 4);
    if (!goal) return errorJson("Need a mission goal.");
    const startingLabeled = await labeledCount(env, owner);
    return json({ mission: { owner, goal, flag, started_at: now, starting_labeled: startingLabeled, generated_total: 0 } });
  }

  if (body.action === "complete") {
    const goal = Math.max(1, Math.min(10000, Number(body.goal) || 0));
    const flag = String(body.flag || "⚑").slice(0, 4);
    const startedAt = String(body.started_at || now);
    const startingLabeled = Math.max(0, Number(body.starting_labeled) || 0);
    const generatedTotal = Math.max(0, Number(body.generated_total) || 0);
    const total = await labeledCount(env, owner);
    const labeledThisMission = Math.max(0, total - startingLabeled);
    if (labeledThisMission < goal) return errorJson(`Mission is not complete yet: ${labeledThisMission}/${goal} labeled.`);
    const result = await env.DB.prepare(`INSERT INTO mission_history(owner,goal,flag,started_at,completed_at,starting_labeled,labeled_total,generated_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(owner, goal, flag, startedAt, now, startingLabeled, labeledThisMission, generatedTotal).run();
    return json({ id: result.meta.last_row_id, owner, goal, flag, started_at: startedAt, completed_at: now, starting_labeled: startingLabeled, labeled_total: labeledThisMission, generated_total: generatedTotal });
  }

  return errorJson("Unknown mission action.");
}
