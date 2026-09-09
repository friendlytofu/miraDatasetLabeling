import { sha256Hex, json, errorJson } from "../_utils.js";

const SALT = "mira-dataset-studio-v1";
const COOKIE_NAME = "mira_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function onRequestPost(context) {
  const { request, env } = context;
  // Trim in case MIRA_PASSWORD was set with trailing whitespace/newline
  // (easy to do via `wrangler pages secret put` or a copy-paste).
  const password = ((env && env.MIRA_PASSWORD) || "mira").trim();

  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Bad request", 400);
  }

  const submitted = typeof body?.password === "string" ? body.password.trim() : "";
  if (!submitted || submitted !== password) {
    return errorJson("Incorrect password", 401);
  }

  const token = await sha256Hex(SALT + password);
  const isHttps = new URL(request.url).protocol === "https:";
  const cookie = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE}`,
    isHttps ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

  return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}

export async function onRequestGet() {
  return errorJson("Method not allowed", 405);
}
