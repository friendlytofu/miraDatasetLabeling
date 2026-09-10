import { errorJson } from "../_utils.js";
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare("SELECT * FROM entries WHERE status='labeled' ORDER BY labeled_at ASC, id ASC").all();
  if (!results.length) return errorJson("No labeled entries yet.", 404);
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
  return new Response(lines.join("\n") + "\n", { headers: {
    "content-type": "application/jsonl; charset=utf-8",
    "content-disposition": `attachment; filename="mira_dataset_${date}.jsonl"`,
    "cache-control": "no-store",
  }});
}
