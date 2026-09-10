import { json, errorJson, sha256Hex } from "../_utils.js";

async function ensureTables(env) {
  // Users is also the entry point for the team dashboard. Make the small set of
  // referenced creator tables available here too, so /api/users never fails just
  // because a deployment has not run every migration yet.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  )`).run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_ci ON users(lower(name))").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS label_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER,
    action TEXT NOT NULL,
    old_label TEXT,
    new_label TEXT,
    labeler TEXT,
    details TEXT,
    acted_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL DEFAULT 'default',
    pair_key TEXT NOT NULL, offer_text TEXT NOT NULL, want_text TEXT NOT NULL,
    created_at TEXT NOT NULL, UNIQUE(owner, pair_key)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_pair_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL DEFAULT 'default',
    pair_key TEXT NOT NULL, offer_text TEXT NOT NULL, want_text TEXT NOT NULL,
    is_duplicate INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS creator_mission_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL DEFAULT 'default', goal INTEGER NOT NULL,
    flag TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
    starting_pairs INTEGER NOT NULL DEFAULT 0, pairs_total INTEGER NOT NULL DEFAULT 0
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS active_creator_missions (
    owner TEXT PRIMARY KEY, goal INTEGER NOT NULL, flag TEXT NOT NULL, started_at TEXT NOT NULL,
    starting_pairs INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  )`).run();
}

function cleanName(value) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80); }
function cleanCode(value) { return String(value || "").trim().slice(0, 120); }
function ownerKey(id) { return `user:${Number(id)}`; }

async function statsFor(env, user) {
  const owner = ownerKey(user.id);
  const [pairs, labels, createMissions, activeCreate] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM creator_pairs WHERE owner=?").bind(owner).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM entries WHERE status='labeled' AND labeler=?").bind(user.name).first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM creator_mission_history WHERE owner=?").bind(owner).first(),
    env.DB.prepare("SELECT * FROM active_creator_missions WHERE owner=?").bind(owner).first()
  ]);
  return {
    labels: Number(labels?.total || 0),
    pairs: Number(pairs?.total || 0),
    creation_missions: Number(createMissions?.total || 0),
    total: Number(labels?.total || 0) + Number(pairs?.total || 0),
    active_creation_mission: activeCreate ? { goal:Number(activeCreate.goal), progress:Math.max(0,Number(pairs?.total||0)-Number(activeCreate.starting_pairs||0)), flag:activeCreate.flag } : null
  };
}

export async function onRequestGet({ request, env }) {
  await ensureTables(env);
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "list";
  if (action === "validate") {
    const id = Number(url.searchParams.get("id"));
    const code = cleanCode(url.searchParams.get("code"));
    if (!id || !code) return errorJson("Need a user and code.");
    const user = await env.DB.prepare("SELECT id,name,code_hash,active FROM users WHERE id=? AND active=1").bind(id).first();
    if (!user) return errorJson("User not found.", 404);
    const valid = (await sha256Hex(code)) === user.code_hash;
    if (!valid) return errorJson("That user code is not valid.", 401);
    return json({ valid:true, user:{ id:user.id, name:user.name, owner:ownerKey(user.id) } });
  }
  const rows = (await env.DB.prepare("SELECT id,name,created_at,updated_at FROM users WHERE active=1 ORDER BY lower(name), id").all()).results || [];
  const users = [];
  for (const user of rows) users.push({ ...user, ...(await statsFor(env, user)) });
  users.sort((a,b) => (b.labels + b.pairs) - (a.labels + a.pairs) || b.labels - a.labels || a.name.localeCompare(b.name));
  users.forEach((u,i) => { u.rank = i + 1; });
  return json({ users });
}

export async function onRequestPost({ request, env }) {
  await ensureTables(env);
  const body = await request.json().catch(() => null);
  if (!body?.action) return errorJson("Need an action.");
  const now = new Date().toISOString();

  if (body.action === "validate") {
    const id = Number(body.id); const code = cleanCode(body.code);
    if (!id || !code) return errorJson("Need a user and code.");
    const user = await env.DB.prepare("SELECT id,name,code_hash,active FROM users WHERE id=? AND active=1").bind(id).first();
    if (!user) return errorJson("User not found.", 404);
    const valid = (await sha256Hex(code)) === user.code_hash;
    if (!valid) return errorJson("That user code is not valid.", 401);
    return json({ valid:true, user:{ id:user.id, name:user.name, owner:ownerKey(user.id) } });
  }

  if (body.action === "add") {
    const name = cleanName(body.name); const code = cleanCode(body.code);
    if (name.length < 1) return errorJson("Enter a user name.");
    if (code.length < 4) return errorJson("Use a user code with at least 4 characters.");
    const exists = await env.DB.prepare("SELECT id FROM users WHERE lower(name)=lower(?)").bind(name).first();
    if (exists) return errorJson("A user with that name already exists.");
    const result = await env.DB.prepare("INSERT INTO users(name,code_hash,created_at,updated_at) VALUES (?,?,?,?)").bind(name, await sha256Hex(code), now, now).run();
    return json({ user:{ id:result.meta.last_row_id, name, owner:ownerKey(result.meta.last_row_id) } });
  }

  const id = Number(body.id); if (!id) return errorJson("Need a user id.");
  const user = await env.DB.prepare("SELECT id,name FROM users WHERE id=? AND active=1").bind(id).first();
  if (!user) return errorJson("User not found.", 404);

  if (body.action === "rename") {
    const name = cleanName(body.name);
    if (!name) return errorJson("Enter a user name.");
    const exists = await env.DB.prepare("SELECT id FROM users WHERE lower(name)=lower(?) AND id<>?").bind(name,id).first();
    if (exists) return errorJson("A user with that name already exists.");
    await env.DB.prepare("UPDATE users SET name=?,updated_at=? WHERE id=?").bind(name,now,id).run();
    // Keep existing labels attached to the same person after a rename.
    await env.DB.prepare("UPDATE entries SET labeler=? WHERE labeler=?").bind(name,user.name).run();
    await env.DB.prepare("UPDATE label_history SET labeler=? WHERE labeler=?").bind(name,user.name).run();
    return json({ user:{ id, name, owner:ownerKey(id) } });
  }

  if (body.action === "set_code") {
    const code = cleanCode(body.code);
    if (code.length < 4) return errorJson("Use a user code with at least 4 characters.");
    await env.DB.prepare("UPDATE users SET code_hash=?,updated_at=? WHERE id=?").bind(await sha256Hex(code),now,id).run();
    return json({ id, updated:true });
  }

  return errorJson("Unknown user action.");
}
