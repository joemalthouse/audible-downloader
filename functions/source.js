export async function onRequest({ request }) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) return json({ error: "Missing url" }, 400);

  const parsed = new URL(target);
  if (!parsed.hostname.endsWith(".cloudfront.net")) {
    return json({ error: "Only Audible CloudFront source URLs are allowed" }, 400);
  }

  const headers = new Headers();
  const range = request.headers.get("range");
  if (range) headers.set("range", range);
  headers.set("user-agent", "com.audible.playersdk.player/3.96.1 (Linux;Android 14) AndroidXMedia3/1.3.0");

  const upstream = await fetch(parsed.href, {
    method: request.method,
    headers,
    redirect: "manual",
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("access-control-allow-origin", "*");
  responseHeaders.set("access-control-expose-headers", "*");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
