import { json, verifyProxyUrl } from "./_shared/audible.js";

const RANGE_RE = /^bytes=\d+-\d*$/;
const PASSTHROUGH_HEADERS = ["content-type", "content-range", "accept-ranges", "cache-control", "last-modified", "etag"];

export async function onRequest({ request, env }) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  const sig = url.searchParams.get("sig");
  const exp = url.searchParams.get("exp");
  if (!target || !sig || !exp) return json({ error: "Missing url, sig, or exp" }, 400);

  let parsed;
  try { parsed = new URL(target); }
  catch { return json({ error: "Invalid target URL" }, 400); }

  if (parsed.protocol !== "https:") return json({ error: "Only https sources are allowed" }, 400);
  if (!parsed.hostname.endsWith(".cloudfront.net")) {
    return json({ error: "Only Audible CloudFront source URLs are allowed" }, 400);
  }

  if (!(await verifyProxyUrl(env.SOURCE_PROXY_SECRET, target, sig, exp))) {
    return json({ error: "Invalid or expired proxy signature" }, 403);
  }

  const headers = new Headers();
  const range = request.headers.get("range");
  if (range) {
    if (range.length > 200 || !RANGE_RE.test(range)) {
      return json({ error: "Invalid Range header" }, 400);
    }
    headers.set("range", range);
  }
  headers.set("user-agent", "com.audible.playersdk.player/3.96.1 (Linux;Android 14) AndroidXMedia3/1.3.0");

  const upstream = await fetch(parsed.href, { method: request.method, headers, redirect: "manual" });

  const responseHeaders = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
