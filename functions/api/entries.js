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


export async function onRequestPut({ request, env }) {
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return errorJson("Need a valid entry id.");
  const clean = (value) => Array.isArray(value) ? value.map(v => String(v ?? "").trim()).filter(Boolean) : [];
  const offers = clean(body.offers);
  const wants = clean(body.wants);
  if (!offers.length || !wants.length) return errorJson("An entry needs at least one offer and one want.");
  if (offers.length > 50 || wants.length > 50) return errorJson("Each side can contain at most 50 lines.");
  const entry = await env.DB.prepare("SELECT id, offer_ids, want_ids FROM entries WHERE id=?").bind(id).first();
  if (!entry) return errorJson("Entry not found", 404);
  const offerIds = JSON.parse(entry.offer_ids || "[]");
  const wantIds = JSON.parse(entry.want_ids || "[]");
  await env.DB.prepare(`UPDATE entries SET offers=?, wants=?, offer_count=?, want_count=? WHERE id=?`)
    .bind(JSON.stringify(offers), JSON.stringify(wants), offers.length, wants.length, id).run();
  return json({ id, offers, wants, offer_ids: offerIds, want_ids: wantIds, updated: true });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const idParam = url.searchParams.get("id");
  if (action === "reset_labels") {
    await env.DB.prepare(`UPDATE entries SET status='unlabeled', human_label=NULL, labeler=NULL, labeled_blind=NULL, labeled_at=NULL`).run();
    await env.DB.prepare(`DELETE FROM label_history`).run();
    return json({ reset: true, labels_cleared: true });
  }
  if (action === "clear") {
    const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM entries").first();
    await env.DB.prepare("DELETE FROM label_history").run();
    await env.DB.prepare("DELETE FROM entries").run();
    return json({ cleared: true, deleted_entries: Number(row?.total || 0) });
  }
  if (!idParam) return errorJson("Missing id or action");
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return errorJson("Invalid id");
  await env.DB.prepare("DELETE FROM label_history WHERE entry_id=?").bind(id).run();
  await env.DB.prepare("DELETE FROM entries WHERE id=?").bind(id).run();
  return json({ deleted: id });
}
