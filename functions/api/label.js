import { json, errorJson } from "../_utils.js";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body) return errorJson("Invalid JSON body");

  const { id, human_label, labeler, labeled_at } = body;
  if (!id || (human_label !== "yes" && human_label !== "no")) {
    return errorJson("Need id and human_label ('yes' | 'no').");
  }
  if (!labeler || !String(labeler).trim()) {
    return errorJson("Need a labeler name.");
  }

  // The browser sends its real local-time timestamp (with UTC offset, e.g. -07:00) captured
  // at the moment the button was clicked, so exports read in the labeler's own local time.
  // Fall back to server UTC time if the client didn't send one.
  const labeledAt = typeof labeled_at === "string" && labeled_at ? labeled_at : new Date().toISOString();

  const res = await env.DB.prepare(
    `UPDATE entries
     SET status = 'labeled', human_label = ?, labeler = ?, labeled_blind = 1, labeled_at = ?
     WHERE id = ?`
  )
    .bind(human_label, String(labeler).trim(), labeledAt, id)
    .run();

  if (res.meta.changes === 0) return errorJson("Entry not found", 404);

  return json({ id, human_label, labeler: String(labeler).trim(), labeled_blind: true, labeled_at: labeledAt });
}
