import { json, errorJson } from "../_utils.js";

const COOKIE_NAME = "mira_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  const password = ((env && env.MIRA_PASSWORD) || "mira").trim();
  const body = await request.json().catch(() => null);
  if (!body) return errorJson("Bad request", 400);

  const submitted = typeof body.password === "string" ? body.password.trim() : "";
  if (!submitted || submitted !== password) return errorJson("Incorrect password", 401);

  const issuedAt = Math.floor(Date.now() / 1000).toString();
  const nonce = new Uint8Array(18);
  crypto.getRandomValues(nonce);
  const nonceText = bytesToBase64Url(nonce);
  const payload = `${issuedAt}.${nonceText}`;
  const signature = await hmacHex(password, payload);
  const token = `${payload}.${signature}`;

  const isHttps = new URL(request.url).protocol === "https:";
  const cookie = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE}`,
    isHttps ? "Secure" : "",
  ].filter(Boolean).join("; ");

  return json({ ok: true }, {
    headers: {
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestGet() {
  return errorJson("Method not allowed", 405);
}
