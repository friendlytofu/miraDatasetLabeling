import { json, errorJson, sample } from "../_utils.js";

// Builds the 9 (offerCount x wantCount) buckets for offerCount/wantCount in [1,3].
function buildBuckets() {
  const buckets = [];
  for (let o = 1; o <= 3; o++) {
    for (let w = 1; w <= 3; w++) buckets.push({ offerCount: o, wantCount: w });
  }
  return buckets;
}

function comboKey(offerIds, wantIds) {
  const o = [...offerIds].sort((a, b) => a - b).join(",");
  const w = [...wantIds].sort((a, b) => a - b).join(",");
  return `${o}|${w}`;
}

function sourceKey(item) {
  const value = String(item?.source_phrase || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return value || null;
}

function buildSourceGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const key = sourceKey(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

// A "yes candidate" is built from the same source phrase; a "no candidate"
// deliberately crosses source phrases. This uses the provenance already attached
// to the item bank, without pretending that a generated candidate has been human-labeled.
function candidateForClass(kind, bucket, offerPool, wantPool, offerGroups, wantGroups) {
  if (kind === "yes") {
    const sharedKeys = [...offerGroups.keys()].filter((key) => wantGroups.has(key));
    if (!sharedKeys.length) return null;
    const key = sample(sharedKeys, 1)[0];
    const offers = sample(offerGroups.get(key), bucket.offerCount);
    const wants = sample(wantGroups.get(key), bucket.wantCount);
    if (offers.length !== bucket.offerCount || wants.length !== bucket.wantCount) return null;
    return { offers, wants };
  }

  // For a negative candidate, choose offers and wants whose source phrases differ.
  const offerSourceKeys = [...offerGroups.keys()];
  const wantSourceKeys = [...wantGroups.keys()];
  if (offerSourceKeys.length < 1 || wantSourceKeys.length < 1) return null;
  for (let i = 0; i < 20; i++) {
    const ok = sample(offerSourceKeys, 1)[0];
    const wk = sample(wantSourceKeys, 1)[0];
    if (ok === wk) continue;
    const offers = sample(offerGroups.get(ok), bucket.offerCount);
    const wants = sample(wantGroups.get(wk), bucket.wantCount);
    if (offers.length === bucket.offerCount && wants.length === bucket.wantCount) return { offers, wants };
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const requested = Math.max(1, Math.min(1000, Number(body.count) || 30));

  const offersRes = await env.DB.prepare("SELECT id, text, source_phrase FROM items WHERE type = 'offer'").all();
  const wantsRes = await env.DB.prepare("SELECT id, text, source_phrase FROM items WHERE type = 'want'").all();
  const offerPool = offersRes.results;
  const wantPool = wantsRes.results;

  if (offerPool.length < 1 || wantPool.length < 1) {
    return errorJson("Need at least 1 offer and 1 want in the item bank before generating.");
  }

  let feasible = buildBuckets().filter((b) => offerPool.length >= b.offerCount && wantPool.length >= b.wantCount);
  if (feasible.length === 0) return errorJson("Item bank too small for any 1-3 x 1-3 combination.");

  const existing = await env.DB.prepare("SELECT combo_key FROM entries").all();
  const seen = new Set(existing.results.map((r) => r.combo_key));
  const offerGroups = buildSourceGroups(offerPool);
  const wantGroups = buildSourceGroups(wantPool);
  const hasProvenance = offerGroups.size > 0 && wantGroups.size > 0;

  const now = new Date().toISOString();
  const inserted = [];
  let bucketIdx = 0;
  const MAX_ATTEMPTS_PER_TURN = 40;

  // Keep every run in the useful 40/60–50/50 range whenever the item bank has
  // enough provenance to construct both sides. Prefer exactly 50/50.
  const preferredYes = Math.round(requested * 0.5);
  const minimumYes = Math.ceil(requested * 0.4);
  const maximumYes = Math.floor(requested * 0.6);
  let yesTarget = Math.min(maximumYes, Math.max(minimumYes, preferredYes));
  if (!hasProvenance) yesTarget = 0;
  let noTarget = requested - yesTarget;

  const classCounts = { yes: 0, no: 0 };

  async function insertCandidate(kind) {
    if (!feasible.length) return false;
    for (let outer = 0; outer < feasible.length * 2; outer++) {
      const bucket = feasible[bucketIdx % feasible.length];
      bucketIdx++;
      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TURN; attempt++) {
        let pair;
        if (hasProvenance) pair = candidateForClass(kind, bucket, offerPool, wantPool, offerGroups, wantGroups);
        else {
          const offers = sample(offerPool, bucket.offerCount);
          const wants = sample(wantPool, bucket.wantCount);
          pair = { offers, wants };
        }
        if (!pair) continue;
        const offers = pair.offers;
        const wants = pair.wants;
        const offerIds = offers.map((o) => o.id);
        const wantIds = wants.map((w) => w.id);
        const key = comboKey(offerIds, wantIds);
        if (seen.has(key)) continue;

        seen.add(key);
        const res = await env.DB.prepare(
          `INSERT INTO entries
            (offer_ids, want_ids, offers, wants, combo_key, offer_count, want_count, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'unlabeled', ?)`
        ).bind(
          JSON.stringify(offerIds), JSON.stringify(wantIds),
          JSON.stringify(offers.map((o) => o.text)), JSON.stringify(wants.map((w) => w.text)),
          key, bucket.offerCount, bucket.wantCount, now
        ).run();

        inserted.push({ id: res.meta.last_row_id, ...bucket, balanceClass: hasProvenance ? kind : "unclassified" });
        classCounts[hasProvenance ? kind : "no"]++;
        return true;
      }
    }
    return false;
  }

  // Fill the requested Yes/No quotas first, then use whichever class still has
  // viable unique combinations. This prevents a shortage in one class from
  // producing an unusably skewed queue.
  while (inserted.length < requested && hasProvenance && classCounts.yes < yesTarget) {
    if (!(await insertCandidate("yes"))) break;
  }
  while (inserted.length < requested && hasProvenance && classCounts.no < noTarget) {
    if (!(await insertCandidate("no"))) break;
  }
  while (inserted.length < requested) {
    const preferred = classCounts.yes < yesTarget ? "yes" : "no";
    if (hasProvenance && await insertCandidate(preferred)) continue;
    if (hasProvenance && await insertCandidate(preferred === "yes" ? "no" : "yes")) continue;
    if (!hasProvenance && await insertCandidate("no")) continue;
    break;
  }

  const bucketCounts = {};
  for (const e of inserted) {
    const k = `${e.offerCount}x${e.wantCount}`;
    bucketCounts[k] = (bucketCounts[k] || 0) + 1;
  }

  const balancedTarget = hasProvenance && inserted.length > 0;
  const yes = balancedTarget ? classCounts.yes : null;
  const no = balancedTarget ? classCounts.no : null;
  const yesPct = balancedTarget ? Math.round((yes / inserted.length) * 100) : null;
  const noPct = balancedTarget ? Math.round((no / inserted.length) * 100) : null;

  return json({
    generated: inserted.length,
    requested,
    bucketCounts,
    exhausted: inserted.length < requested,
    balance: {
      available: balancedTarget,
      yes,
      no,
      yes_pct: yesPct,
      no_pct: noPct,
      target: balancedTarget ? "40/60–50/50" : "unclassified",
      basis: balancedTarget ? "source phrase provenance" : "Item bank has insufficient source-phrase provenance"
    }
  });
}
