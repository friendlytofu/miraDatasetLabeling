import { json } from "../_utils.js";
export async function onRequestGet({ env }) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS label_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, action TEXT NOT NULL,
    previous_label TEXT, new_label TEXT, labeler TEXT, acted_at TEXT NOT NULL, details TEXT
  )`).run();
  const { results } = await env.DB.prepare(`SELECT h.*, e.status, e.offer_count, e.want_count
    FROM label_history h LEFT JOIN entries e ON e.id=h.entry_id ORDER BY h.acted_at DESC, h.id DESC LIMIT 200`).all();
  return json({ history: results });
}
