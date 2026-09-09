import { json } from "../_utils.js";

export async function onRequestPost({ request }) {
  const isHttps = new URL(request.url).protocol === "https:";
  const cookie = [
    "mira_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    isHttps ? "Secure" : "",
  ].filter(Boolean).join("; ");
  return json({ ok: true }, { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
