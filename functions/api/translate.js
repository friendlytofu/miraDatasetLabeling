import { json, errorJson, sha256Hex } from "../_utils.js";

// Free, no-key machine translation via MyMemory (https://mymemory.translated.net/).
// Rate-limited (~5000 words/day anonymous) -- fine for a small internal labeling tool.
// Results are cached in D1 by text hash so the same sentence is never re-translated.
async function translateOne(text) {
  const url =
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(text) +
    "&langpair=en|zh-CN";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const data = await res.json();
  const translated = data?.responseData?.translatedText;
  if (!translated) throw new Error("MyMemory returned no translation");
  return translated;
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const texts = body?.texts;
  if (!Array.isArray(texts) || texts.length === 0) {
    return errorJson("Need a non-empty 'texts' array.");
  }

  const result = {};
  const now = new Date().toISOString();

  for (const text of texts) {
    const hash = await sha256Hex(text);
    const cached = await env.DB.prepare(
      "SELECT translated_text FROM translations WHERE text_hash = ?"
    )
      .bind(hash)
      .first();

    if (cached) {
      result[text] = cached.translated_text;
      continue;
    }

    try {
      const translated = await translateOne(text);
      result[text] = translated;
      await env.DB.prepare(
        "INSERT OR REPLACE INTO translations (text_hash, source_text, translated_text, created_at) VALUES (?, ?, ?, ?)"
      )
        .bind(hash, text, translated, now)
        .run();
    } catch (err) {
      result[text] = null; // let the UI fall back gracefully per-item
    }
  }

  return json({ translations: result });
}
