import { sha256Hex } from "./_utils.js";

// Simple shared-password gate. Anyone without a valid session cookie is
// redirected to /login.html (for page requests) or gets a 401 JSON error
// (for /api/* requests), so both the UI and the data behind it are covered.
const SALT = "mira-dataset-studio-v1";
const COOKIE_NAME = "mira_session";

const PUBLIC_PATHS = new Set(["/login.html", "/api/login"]);

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  if (PUBLIC_PATHS.has(url.pathname)) {
    return next();
  }

  const password = ((env && env.MIRA_PASSWORD) || "mira").trim();
  const expected = await sha256Hex(SALT + password);
  const cookie = getCookie(request, COOKIE_NAME);

  if (cookie === expected) {
    return next();
  }

  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const redirectUrl = new URL("/login.html", url.origin);
  if (url.pathname !== "/") {
    redirectUrl.searchParams.set("next", url.pathname + url.search);
  }
  return Response.redirect(redirectUrl.toString(), 302);
}
