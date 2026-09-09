const COOKIE_NAME = "mira_session";
const MAX_AGE = 60 * 60 * 24 * 30;
const PUBLIC_PATHS = new Set(["/login.html", "/api/login"]);

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function hexEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

async function isValidSession(token, password) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [issuedAtText, nonce, signature] = parts;
  if (!/^\d+$/.test(issuedAtText) || !/^[A-Za-z0-9_-]{20,}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const issuedAt = Number(issuedAtText);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now + 60 || now - issuedAt > MAX_AGE) return false;
  const expected = await hmacHex(password, `${issuedAtText}.${nonce}`);
  return hexEqual(signature, expected);
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  if (PUBLIC_PATHS.has(url.pathname)) return next();

  const password = ((env && env.MIRA_PASSWORD) || "mira").trim();
  const valid = await isValidSession(getCookie(request, COOKIE_NAME), password);
  if (valid) return next();

  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const redirectUrl = new URL("/login.html", url.origin);
  if (url.pathname !== "/") redirectUrl.searchParams.set("next", `${url.pathname}${url.search}`);
  return Response.redirect(redirectUrl.toString(), 302);
}
