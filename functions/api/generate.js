import { json, errorJson, sample } from "../_utils.js";

// Builds the 9 (offerCount x wantCount) buckets for offerCount/wantCount in [1,3].
function buildBuckets() {
  const buckets = [];
  for (let o = 1; o <= 3; o++) {
    for (let w = 1; w <= 3; w++) {
      buckets.push({ offerCount: o, wantCount: w });
    }
  }
  return buckets;
}

function comboKey(offerIds, wantIds) {
  const o = [...offerIds].sort((a, b) => a - b).join(",");
  const w = [...wantIds].sort((a, b) => a - b).join(",");
  return `${o}|${w}`;
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const requested = Math.max(1, Math.min(1000, Number(body.count) || 30));

  const offersRes = await env.DB.prepare("SELECT id, text FROM items WHERE type = 'offer'").all();
  const wantsRes = await env.DB.prepare("SELECT id, text FROM items WHERE type = 'want'").all();
  const offerPool = offersRes.results;
  const wantPool = wantsRes.results;

  if (offerPool.length < 1 || wantPool.length < 1) {
    return errorJson("Need at least 1 offer and 1 want in the item bank before generating.");
  }

  // Only buckets the current pool can actually satisfy.
  let feasible = buildBuckets().filter(
    (b) => offerPool.length >= b.offerCount && wantPool.length >= b.wantCount
  );
  if (feasible.length === 0) {
    return errorJson("Item bank too small for any 1-3 x 1-3 combination.");
  }

  const existing = await env.DB.prepare("SELECT combo_key FROM entries").all();
  const seen = new Set(existing.results.map((r) => r.combo_key));

  const now = new Date().toISOString();
  const inserted = [];
  let bucketIdx = 0;
  const MAX_ATTEMPTS_PER_TURN = 25;

  while (inserted.length < requested && feasible.length > 0) {
    const bucket = feasible[bucketIdx % feasible.length];
    let placed = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TURN; attempt++) {
      const offers = sample(offerPool, bucket.offerCount);
      const wants = sample(wantPool, bucket.wantCount);
      const offerIds = offers.map((o) => o.id);
      const wantIds = wants.map((w) => w.id);
      const key = comboKey(offerIds, wantIds);
      if (seen.has(key)) continue;

      seen.add(key);
      const res = await env.DB.prepare(
        `INSERT INTO entries
          (offer_ids, want_ids, offers, wants, combo_key, offer_count, want_count, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unlabeled', ?)`
      )
        .bind(
          JSON.stringify(offerIds),
          JSON.stringify(wantIds),
          JSON.stringify(offers.map((o) => o.text)),
          JSON.stringify(wants.map((w) => w.text)),
          key,
          bucket.offerCount,
          bucket.wantCount,
          now
        )
        .run();

      inserted.push({ id: res.meta.last_row_id, ...bucket });
      placed = true;
      break;
    }

    if (!placed) {
      // This bucket is exhausted (no unused combos left at reasonable attempt cost) — drop it.
      feasible = feasible.filter((b) => b !== bucket);
      continue;
    }
    bucketIdx++;
  }

  const bucketCounts = {};
  for (const e of inserted) {
    const k = `${e.offerCount}x${e.wantCount}`;
    bucketCounts[k] = (bucketCounts[k] || 0) + 1;
  }

  return json({
    generated: inserted.length,
    requested,
    bucketCounts,
    exhausted: inserted.length < requested,
  });
}
