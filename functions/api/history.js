import { json, errorJson } from "../_utils.js";

async function ensureHistoryTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS label_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, action TEXT NOT NULL,
    previous_label TEXT, new_label TEXT, labeler TEXT, acted_at TEXT NOT NULL, details TEXT
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_label_history_entry ON label_history(entry_id, acted_at DESC)").run();
}

export async function onRequestGet({ request, env }) {
  await ensureHistoryTable(env);
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit")) || 1000));
  const { results } = await env.DB.prepare(`SELECT h.*, e.status, e.offer_count, e.want_count
    FROM label_history h LEFT JOIN entries e ON e.id=h.entry_id ORDER BY h.acted_at DESC, h.id DESC LIMIT ?`).bind(limit).all();
  return json({ history: results });
}

export async function onRequestDelete({ request, env }) {
  await ensureHistoryTable(env);
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(Number).filter(Number.isInteger).filter((id) => id > 0))] : [];
  if (!ids.length) return errorJson("Select at least one history record.");
  if (ids.length > 500) return errorJson("You can delete up to 500 history records at once.");
  const placeholders = ids.map(() => "?").join(",");
  await env.DB.prepare(`DELETE FROM label_history WHERE id IN (${placeholders})`).bind(...ids).run();
  return json({ deleted: ids.length });
}
