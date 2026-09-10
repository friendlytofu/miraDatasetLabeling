import { json, errorJson } from "../_utils.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "unlabeled";
  const id = url.searchParams.get("id");
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 20));

  let query = "SELECT * FROM entries";
  const binds = [];
  const where = [];
  if (id) { where.push("id = ?"); binds.push(Number(id)); }
  else if (status !== "all") { where.push("status = ?"); binds.push(status); }
  if (where.length) query += " WHERE " + where.join(" AND ");
  query += " ORDER BY id ASC LIMIT ?";
  binds.push(limit);

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  const entries = results.map((r) => ({
    ...r,
    offers: JSON.parse(r.offers), wants: JSON.parse(r.wants),
    offer_ids: JSON.parse(r.offer_ids), want_ids: JSON.parse(r.want_ids),
    labeled_blind: !!r.labeled_blind,
  }));

  const counts = await env.DB.prepare(`SELECT
    SUM(CASE WHEN status = 'unlabeled' THEN 1 ELSE 0 END) AS unlabeled,
    SUM(CASE WHEN human_label = 'yes' THEN 1 ELSE 0 END) AS yes,
    SUM(CASE WHEN human_label = 'no' THEN 1 ELSE 0 END) AS no,
    COUNT(*) AS total FROM entries`).first();
  return json({ entries, counts });
}
