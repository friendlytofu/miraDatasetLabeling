import { errorJson } from "../_utils.js";

export async function onRequestGet({ request, env }) {
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
  if (!results.length) {
    if (qualityCheck) return Response.json({ checked: true, total: 0, repeated_relationships: [], repeat_tasks: 0, clean_total: 0, max_pair_uses });
    return errorJson("No labeled entries match the selected export.", 404);
  }

  const parsed = results.map((r) => ({
    row: r,
    offers: parseTextArray(r.offers),
    wants: parseTextArray(r.wants),
  }));
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
      max_pair_uses,
      policy: `Keep the first ${maxPairUses} labeled task appearances of each normalized offer × want relationship; later tasks containing an overused relationship are quarantined from the clean export.`,
    });
  }

  let exportRows = parsed;
  if (cleanRepeated) exportRows = report.cleanRows;
  if (!exportRows.length) return errorJson("The export quality check removed every labeled task. Increase the allowed pair appearances or export without cleaning.", 409);

  const lines = exportRows.map((entry, i) => JSON.stringify({
    id: i,
    offers: entry.offers,
    wants: entry.wants,
    human_label: entry.row.human_label,
    labeler: entry.row.labeler,
    labeled_blind: !!entry.row.labeled_blind,
    labeled_at: entry.row.labeled_at,
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
