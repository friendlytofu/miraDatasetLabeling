import { json, errorJson, sha256Hex } from "../_utils.js";

function hasChinese(value) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(value || ""));
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function translateWithGoogle(text) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=" + encodeURIComponent(text);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
  const data = await res.json();
  const translated = Array.isArray(data?.[0]) ? data[0].map((part) => part?.[0] || "").join("") : "";
  if (!translated || !hasChinese(translated)) throw new Error("Google returned an invalid Chinese translation");
  return decodeHtml(translated);
}

async function translateWithMyMemory(text) {
  const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=en|zh-CN";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const data = await res.json();
  const translated = decodeHtml(data?.responseData?.translatedText || "");
  if (!translated || !hasChinese(translated)) throw new Error("MyMemory returned an invalid Chinese translation");
  return translated;
}

async function translateOne(text) {
  try { return await translateWithGoogle(text); }
  catch { return await translateWithMyMemory(text); }
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const texts = body?.texts;
  if (!Array.isArray(texts) || texts.length === 0) return errorJson("Need a non-empty 'texts' array.");

  const result = {};
  const now = new Date().toISOString();
  for (const raw of texts.slice(0, 60)) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const hash = await sha256Hex(`en|zh-CN|${text}`);
    const cached = await env.DB.prepare("SELECT translated_text FROM translations WHERE text_hash = ?").bind(hash).first();
    if (cached && hasChinese(cached.translated_text)) { result[text] = cached.translated_text; continue; }
    try {
      const translated = await translateOne(text);
      result[text] = translated;
      await env.DB.prepare("INSERT OR REPLACE INTO translations (text_hash, source_text, translated_text, created_at) VALUES (?, ?, ?, ?)")
        .bind(hash, text, translated, now).run();
    } catch {
      result[text] = null;
    }
  }
  return json({ translations: result, target_language: "zh-CN" });
}
