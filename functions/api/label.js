import { json, errorJson } from "../_utils.js";

async function ensureHistoryTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS label_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    previous_label TEXT,
    new_label TEXT,
    labeler TEXT,
    acted_at TEXT NOT NULL,
    details TEXT
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_label_history_entry ON label_history(entry_id, acted_at DESC)").run();
}

export async function onRequestPost({ request, env }) {
  await ensureHistoryTable(env);
  const body = await request.json().catch(() => null);
  if (!body) return errorJson("Invalid JSON body");
  const { id, human_label, labeler, labeled_at } = body;
  if (!id || (human_label !== "yes" && human_label !== "no")) return errorJson("Need id and human_label ('yes' | 'no').");
  if (!labeler || !String(labeler).trim()) return errorJson("Need a labeler name.");
  const entry = await env.DB.prepare("SELECT human_label, status, labeler, labeled_at FROM entries WHERE id = ?").bind(id).first();
  if (!entry) return errorJson("Entry not found", 404);
  const labeledAt = typeof labeled_at === "string" && labeled_at ? labeled_at : new Date().toISOString();
  const actor = String(labeler).trim();
  const action = entry.status === "labeled" ? "changed" : "labeled";
  await env.DB.prepare(`UPDATE entries SET status='labeled', human_label=?, labeler=?, labeled_blind=1, labeled_at=? WHERE id=?`)
    .bind(human_label, actor, labeledAt, id).run();
  await env.DB.prepare(`INSERT INTO label_history(entry_id, action, previous_label, new_label, labeler, acted_at, details) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, action, entry.human_label || null, human_label, actor, labeledAt, action === "changed" ? "Label changed during review" : "Initial label").run();
  return json({ id, human_label, labeler: actor, labeled_blind: true, labeled_at: labeledAt, action });
}

export async function onRequestPut({ request, env }) {
  await ensureHistoryTable(env);
  const body = await request.json().catch(() => null);
  if (!body?.id) return errorJson("Need an entry id.");
  const labeler = String(body.labeler || "").trim();
  if (!labeler) return errorJson("Need a labeler name.");
  const entry = await env.DB.prepare("SELECT human_label, status FROM entries WHERE id=?").bind(body.id).first();
  if (!entry) return errorJson("Entry not found", 404);
  const actedAt = typeof body.acted_at === "string" && body.acted_at ? body.acted_at : new Date().toISOString();
  await env.DB.prepare("UPDATE entries SET status='unlabeled', human_label=NULL, labeler=NULL, labeled_blind=NULL, labeled_at=NULL WHERE id=?").bind(body.id).run();
  await env.DB.prepare(`INSERT INTO label_history(entry_id, action, previous_label, new_label, labeler, acted_at, details) VALUES (?, 'reset', ?, NULL, ?, ?, 'Label reset and returned to the queue')`)
    .bind(body.id, entry.human_label || null, labeler, actedAt).run();
  return json({ id: body.id, reset: true });
}

export async function onRequestDelete({ request, env }) {
  await ensureHistoryTable(env);
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  const labeler = String(url.searchParams.get("labeler") || "").trim();
  if (!id) return errorJson("Missing id");
  if (!labeler) return errorJson("Need a labeler name.");
  const entry = await env.DB.prepare("SELECT human_label FROM entries WHERE id=?").bind(id).first();
  if (!entry) return errorJson("Entry not found", 404);
  const actedAt = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO label_history(entry_id, action, previous_label, new_label, labeler, acted_at, details) VALUES (?, 'deleted', ?, NULL, ?, ?, 'Entry permanently deleted from the labeling queue')`)
    .bind(id, entry.human_label || null, labeler, actedAt).run();
  await env.DB.prepare("DELETE FROM entries WHERE id=?").bind(id).run();
  return json({ id, deleted: true });
}
