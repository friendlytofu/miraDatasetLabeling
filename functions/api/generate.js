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
function pickItemsFromGroups(groups, count, allowedKeys, excludedIds = new Set()) {
  const keys = sample(allowedKeys, allowedKeys.length);
  const items = [];
  for (const key of keys) {
    const available = (groups.get(key) || []).filter(item => !excludedIds.has(item.id));
    if (!available.length) continue;
    const take = Math.min(count - items.length, available.length);
    items.push(...sample(available, take));
    if (items.length >= count) break;
  }
  return items;
}

function candidateForClass(kind, bucket, offerPool, wantPool, offerGroups, wantGroups) {
  const offerSourceKeys = [...offerGroups.keys()];
  const wantSourceKeys = [...wantGroups.keys()];

  if (kind === "yes") {
    // A positive multi-item task can draw from several source phrases. Every
    // selected item comes from a source phrase that exists on both sides, so
    // 2x1, 1x2, 2x2, 3x3, etc. remain possible even when each source has only
    // one offer and one want.
    const sharedKeys = offerSourceKeys.filter((key) => wantGroups.has(key));
    if (!sharedKeys.length) return null;
    const offers = pickItemsFromGroups(offerGroups, bucket.offerCount, sharedKeys);
    const wants = pickItemsFromGroups(wantGroups, bucket.wantCount, sharedKeys);
    if (offers.length !== bucket.offerCount || wants.length !== bucket.wantCount) return null;
    return { offers, wants };
  }

  // A negative multi-item task draws each side from source phrases that do not
  // overlap. This creates genuinely varied 2x1/1x2/2x2/3x3 tasks rather than
  // falling back to 1x1 whenever each source phrase has only one item.
  for (let i = 0; i < 30; i++) {
    const shuffledOffers = sample(offerSourceKeys, offerSourceKeys.length);
    const shuffledWants = sample(wantSourceKeys, wantSourceKeys.length);
    for (const firstOfferKey of shuffledOffers) {
      const possibleOfferKeys = [firstOfferKey, ...shuffledOffers.filter(k => k !== firstOfferKey)];
      const offers = pickItemsFromGroups(offerGroups, bucket.offerCount, possibleOfferKeys);
      if (offers.length !== bucket.offerCount) continue;
      const usedOfferSources = new Set(offers.map(item => sourceKey(item)).filter(Boolean));
      const disjointWantKeys = shuffledWants.filter(key => !usedOfferSources.has(key));
      const wants = pickItemsFromGroups(wantGroups, bucket.wantCount, disjointWantKeys);
      if (wants.length === bucket.wantCount) return { offers, wants };
    }
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const requested = Math.max(1, Math.min(1000, Number(body.count) || 30));
  // User-controlled target. Keep the control in the intended balanced range.
  const requestedYesPct = Math.max(40, Math.min(60, Number(body.yes_percent) || 50));

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

  // Honor the user's selected Yes percentage. The UI constrains this to 40–60%,
  // so every requested target remains inside the intended balanced range.
  const preferredYes = Math.round(requested * requestedYesPct / 100);
  const minimumYes = Math.ceil(requested * 0.4);
  const maximumYes = Math.floor(requested * 0.6);
  let yesTarget = Math.min(maximumYes, Math.max(minimumYes, preferredYes));
  if (!hasProvenance) yesTarget = 0;
  let noTarget = requested - yesTarget;

  const classCounts = { yes: 0, no: 0 };

  const bucketCounts = {};
  function bucketKey(bucket) { return `${bucket.offerCount}x${bucket.wantCount}`; }
  function bucketCanSupportClass(kind, bucket) {
    if (!hasProvenance) return true;
    if (kind === "yes") {
      const sharedKeys = [...offerGroups.keys()].filter((key) => wantGroups.has(key));
      const offerCapacity = sharedKeys.reduce((n, key) => n + (offerGroups.get(key)?.length || 0), 0);
      const wantCapacity = sharedKeys.reduce((n, key) => n + (wantGroups.get(key)?.length || 0), 0);
      return sharedKeys.length > 0 && offerCapacity >= bucket.offerCount && wantCapacity >= bucket.wantCount;
    }
    // There must be enough items on each side after choosing disjoint source
    // sets. The exact candidate is still validated by candidateForClass().
    return offerSourceKeysWithCapacity(offerGroups, 1).length > 0 &&
      wantSourceKeysWithCapacity(wantGroups, 1).length > 0 &&
      (offerGroups.size > 1 || wantGroups.size > 1);
  }
  function chooseBucket(kind) {
    const candidates = feasible.filter(bucket => bucketCanSupportClass(kind, bucket));
    if (!candidates.length) return null;
    // Prefer buckets that have appeared least in this run, then rotate among
    // them. This prevents a stream of 1x1 tasks while still respecting quotas.
    const minCount = Math.min(...candidates.map(b => bucketCounts[bucketKey(b)] || 0));
    const leastUsed = candidates.filter(b => (bucketCounts[bucketKey(b)] || 0) === minCount);
    return leastUsed[bucketIdx++ % leastUsed.length];
  }

  async function insertCandidate(kind) {
    if (!feasible.length) return false;
    for (let outer = 0; outer < feasible.length * 2; outer++) {
      const bucket = chooseBucket(kind);
      if (!bucket) return false;
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
        const bk = bucketKey(bucket);
        bucketCounts[bk] = (bucketCounts[bk] || 0) + 1;
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
      target: balancedTarget ? `${requestedYesPct}/${100-requestedYesPct} Yes/No` : "unclassified",
      basis: balancedTarget ? "source phrase provenance" : "Item bank has insufficient source-phrase provenance"
    }
  });
}
