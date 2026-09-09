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

  return json({ created });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return errorJson("Missing id");
  await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
  return json({ deleted: Number(id) });
}
