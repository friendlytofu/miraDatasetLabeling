import { json } from "../_utils.js";

export async function onRequestPost() {
  const cookie = "mira_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
  return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}
