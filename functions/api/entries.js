import { json } from "../_utils.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "unlabeled"; // unlabeled | labeled | all
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 20));

  let query = "SELECT * FROM entries";
  const binds = [];
  if (status !== "all") {
    query += " WHERE status = ?";
    binds.push(status);
  }
  query += status === "labeled" ? " ORDER BY labeled_at DESC" : " ORDER BY id ASC";
  query += " LIMIT ?";
  binds.push(limit);

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  const entries = results.map((r) => ({
    ...r,
    offers: JSON.parse(r.offers),
    wants: JSON.parse(r.wants),
    offer_ids: JSON.parse(r.offer_ids),
    want_ids: JSON.parse(r.want_ids),
    labeled_blind: !!r.labeled_blind,
  }));

  const counts = await env.DB.prepare(
    `SELECT
      SUM(CASE WHEN status = 'unlabeled' THEN 1 ELSE 0 END) AS unlabeled,
      SUM(CASE WHEN human_label = 'yes' THEN 1 ELSE 0 END) AS yes,
      SUM(CASE WHEN human_label = 'no' THEN 1 ELSE 0 END) AS no,
      COUNT(*) AS total
     FROM entries`
  ).first();

  return json({ entries, counts });
}
