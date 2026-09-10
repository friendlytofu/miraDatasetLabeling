import { errorJson } from "../_utils.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const historyIds = parseIds(url.searchParams.get("history_ids"));
    const entryIds = parseIds(url.searchParams.get("entry_ids"));
    const labeler = (url.searchParams.get("labeler") || "").trim();
    const label = url.searchParams.get("label");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const qualityCheck = url.searchParams.get("quality_check") === "1";
    const cleanRepeated = url.searchParams.get("clean_repeated") === "1";
    const maxPairUses = Math.max(1, Math.min(10, Number(url.searchParams.get("max_pair_uses")) || 2));

    const filters = [];
    const binds = [];
    if (entryIds.length) { filters.push(`id IN (${entryIds.map(() => "?").join(",")})`); binds.push(...entryIds); }
    if (historyIds.length) {
      filters.push(`id IN (SELECT entry_id FROM label_history WHERE id IN (${historyIds.map(() => "?").join(",")}))`);
      binds.push(...historyIds);
    }
    if (labeler) { filters.push("labeler=?"); binds.push(labeler); }
    if (label === "yes" || label === "no") { filters.push("human_label=?"); binds.push(label); }
    if (from) { filters.push("labeled_at>=?"); binds.push(from); }
    if (to) { filters.push("labeled_at<=?"); binds.push(to); }

    // Quality checks can be run against a large labeled queue. Fetch in small
    // pages instead of one giant D1 result so the preview itself does not hit
    // D1/Workers response-size limits.
    const baseWhere = `status='labeled'${filters.length ? ` AND ${filters.join(" AND ")}` : ""}`;
    const pageSize = 250;
    let lastId = 0;
    const parsed = [];
    while (true) {
      const pageQuery = `SELECT * FROM entries WHERE ${baseWhere} AND id>? ORDER BY id ASC LIMIT ${pageSize}`;
      const pageBinds = [...binds, lastId];
      const page = await env.DB.prepare(pageQuery).bind(...pageBinds).all();
      const rows = page?.results || [];
      if (!rows.length) break;
      for (const r of rows) parsed.push({ row: r, offers: parseTextArray(r.offers), wants: parseTextArray(r.wants) });
      lastId = Number(rows[rows.length - 1].id) || lastId;
      if (rows.length < pageSize) break;
    }

    if (!parsed.length) {
      if (qualityCheck) return Response.json({ checked: true, total: 0, repeated_relationships: [], repeat_tasks: 0, clean_total: 0, removed_if_cleaned: 0, excluded_tasks: [], excluded_tasks_total: 0, maxPairUses });
      return errorJson("No labeled entries match the selected export.", 404);
    }

    const report = analyzePairReuse(parsed, maxPairUses);

    if (qualityCheck) {
      return Response.json({
        checked: true,
        total: parsed.length,
        clean_total: report.cleanRows.length,
        removed_if_cleaned: report.removedRows.length,
        repeat_tasks: report.removedRows.length,
        repeated_relationships: report.repeatedRelationships.slice(0, 50),
        excluded_tasks: report.removedRows.slice(0, 200).map((entry) => ({
          entry_id: entry.row.id,
          labeled_at: entry.row.labeled_at,
          human_label: entry.row.human_label,
          labeler: entry.row.labeler,
          offers: entry.offers,
          wants: entry.wants,
          blocked_relationships: pairRelationshipsForEntry(entry, report.repeatedRelationships, maxPairUses),
        })),
        excluded_tasks_total: report.removedRows.length,
        max_pair_uses: maxPairUses,
        policy: `Keep the first ${maxPairUses} labeled task appearances of each normalized offer × want relationship; later tasks containing an overused relationship are quarantined from the clean export.`,
      });
    }

    let exportRows = parsed;
    if (cleanRepeated) exportRows = report.cleanRows;
    if (!exportRows.length) return errorJson("The export quality check removed every labeled task. Increase the allowed pair appearances or export without cleaning.", 409);

    // Export in instruction/output JSONL so the file can be imported directly
    // into training systems that require a string `instruction` and `output`.
    // The labeling task itself is the instruction; the human decision is the
    // output. Multiple offers/wants are kept in the instruction rather than
    // as arrays because the target importer expects strings.
    const lines = exportRows.map((entry) => JSON.stringify({
      instruction: buildTrainingInstruction(entry.offers, entry.wants),
      output: String(entry.row.human_label || "").trim(),
    }));
    const date = new Date().toISOString().slice(0,10);
    const scoped = historyIds.length || entryIds.length ? "selected_" : "";
    const cleaned = cleanRepeated ? "clean_" : "";
    return new Response(lines.join("\n") + "\n", { headers: {
      "content-type": "application/jsonl; charset=utf-8",
      "content-disposition": `attachment; filename="mira_${cleaned}${scoped}dataset_${date}.jsonl"`,
      "cache-control": "no-store",
      "x-mira-quality-checked": "true",
      "x-mira-repeated-tasks-removed": String(cleanRepeated ? report.removedRows.length : 0),
    }});
  } catch (error) {
    console.error("Export/quality check failed:", error);
    return errorJson(`Quality check failed: ${error?.message || "unexpected server error"}`, 500);
  }
}

function buildTrainingInstruction(offers, wants) {
  const offerLines = offers.map((text) => `- ${text}`).join("\n");
  const wantLines = wants.map((text) => `- ${text}`).join("\n");
  return [
    "Decide whether the offers are a good match for the wants. Reply only with yes or no.",
    "",
    "Offers:",
    offerLines || "-",
    "",
    "Wants:",
    wantLines || "-",
  ].join("\n");
}

function pairRelationshipsForEntry(entry, repeatedRelationships, maxPairUses) {
  const repeated = new Map(repeatedRelationships.map((item) => [pairKey(item.offer, item.want), item]));
  const out = [];
  const seen = new Set();
  for (const offer of entry.offers) for (const want of entry.wants) {
    const key = pairKey(offer, want);
    if (!key || seen.has(key)) continue;
    const item = repeated.get(key);
    if (item && item.appearances > maxPairUses) {
      seen.add(key);
      out.push({ offer, want, appearances: item.appearances, allowed: maxPairUses, excess: item.excess });
    }
  }
  return out;
}

function parseTextArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(v => String(v || "").trim()).filter(Boolean) : [];
  } catch { return []; }
}

function normalizePairText(value) {
  return String(value || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function pairKey(offer, want) {
  const o = normalizePairText(offer);
  const w = normalizePairText(want);
  return o && w ? `${o}\u001f${w}` : null;
}

function analyzePairReuse(entries, maxPairUses) {
  const counts = new Map();
  const firstIds = new Map();
  for (const entry of entries) {
    const keys = new Set();
    for (const offer of entry.offers) for (const want of entry.wants) {
      const key = pairKey(offer, want);
      if (key) keys.add(key);
    }
    for (const key of keys) {
      const count = counts.get(key) || 0;
      counts.set(key, count + 1);
      if (!firstIds.has(key)) firstIds.set(key, entry.row.id);
    }
  }

  const repeatedRelationships = [...counts.entries()]
    .filter(([, count]) => count > maxPairUses)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => {
      const [offer, want] = key.split("\u001f");
      return { offer, want, appearances: count, excess: count - maxPairUses, first_entry_id: firstIds.get(key) };
    });

  const allowedCounts = new Map();
  const cleanRows = [];
  const removedRows = [];
  for (const entry of entries) {
    const keys = new Set();
    for (const offer of entry.offers) for (const want of entry.wants) {
      const key = pairKey(offer, want);
      if (key) keys.add(key);
    }
    let blocked = false;
    for (const key of keys) {
      const count = allowedCounts.get(key) || 0;
      if (count >= maxPairUses) { blocked = true; break; }
    }
    if (blocked) {
      removedRows.push(entry);
      continue;
    }
    cleanRows.push(entry);
    for (const key of keys) allowedCounts.set(key, (allowedCounts.get(key) || 0) + 1);
  }
  return { repeatedRelationships, cleanRows, removedRows };
}

function parseIds(value) {
  if (!value) return [];
  return [...new Set(value.split(",").map(Number).filter(Number.isInteger).filter((id) => id > 0))].slice(0, 500);
}
