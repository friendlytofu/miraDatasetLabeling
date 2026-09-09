import { errorJson } from "../_utils.js";

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM entries WHERE status = 'labeled' ORDER BY labeled_at ASC"
  ).all();

  if (results.length === 0) return errorJson("No labeled entries yet.", 404);

  const out = results.map((r, i) => ({
    id: i,
    offers: JSON.parse(r.offers),
    wants: JSON.parse(r.wants),
    human_label: r.human_label,
    labeler: r.labeler,
    labeled_blind: !!r.labeled_blind,
    labeled_at: r.labeled_at,
  }));

  return new Response(JSON.stringify(out, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="mira_dataset_${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
      "access-control-allow-origin": "*",
    },
  });
}
