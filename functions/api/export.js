import { errorJson } from "../_utils.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const historyIds = parseIds(url.searchParams.get("history_ids"));
  const entryIds = parseIds(url.searchParams.get("entry_ids"));
  const labeler = (url.searchParams.get("labeler") || "").trim();
  const label = url.searchParams.get("label");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let query = "SELECT * FROM entries WHERE status='labeled'";
  const binds = [];
  const where = [];
  if (entryIds.length) { where.push(`id IN (${entryIds.map(() => "?").join(",")})`); binds.push(...entryIds); }
  if (historyIds.length) {
    where.push(`id IN (SELECT entry_id FROM label_history WHERE id IN (${historyIds.map(() => "?").join(",")}))`);
    binds.push(...historyIds);
  }
  if (labeler) { where.push("labeler=?"); binds.push(labeler); }
  if (label === "yes" || label === "no") { where.push("human_label=?"); binds.push(label); }
  if (from) { where.push("labeled_at>=?"); binds.push(from); }
  if (to) { where.push("labeled_at<=?"); binds.push(to); }
  if (where.length) query += " AND " + where.join(" AND ");
  query += " ORDER BY labeled_at ASC, id ASC";

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  if (!results.length) return errorJson("No labeled entries match the selected export.", 404);
  const lines = results.map((r, i) => JSON.stringify({
    id: i,
    offers: JSON.parse(r.offers),
    wants: JSON.parse(r.wants),
    human_label: r.human_label,
    labeler: r.labeler,
    labeled_blind: !!r.labeled_blind,
    labeled_at: r.labeled_at,
  }));
  const date = new Date().toISOString().slice(0,10);
  const scoped = historyIds.length || entryIds.length ? "selected_" : "";
  return new Response(lines.join("\n") + "\n", { headers: {
    "content-type": "application/jsonl; charset=utf-8",
    "content-disposition": `attachment; filename="mira_${scoped}dataset_${date}.jsonl"`,
    "cache-control": "no-store",
  }});
}

function parseIds(value) {
  if (!value) return [];
  return [...new Set(value.split(",").map(Number).filter(Number.isInteger).filter((id) => id > 0))].slice(0, 500);
}
