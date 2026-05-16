import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { audibleFetch, createLoginStart, finishLogin, getDownloadLicense, normaliseLibrary } from "./functions/_shared/audible.js";

const root = process.cwd();
const port = Number(process.env.PORT || 5174);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};
const isolationHeaders = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "credentialless",
};

createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/source")) return await proxySource(req, res);
    if (req.url?.startsWith("/library")) return await serveLibrary(req, res);
    if (req.url?.startsWith("/auth/accounts")) return await serveAccounts(req, res);
    if (req.url?.startsWith("/auth/login")) return await handleLogin(req, res);
    if (req.url?.startsWith("/license/")) return await serveLicense(req, res);
    await serveStatic(req, res);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error?.stack || String(error));
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Audible Downloader helper: http://127.0.0.1:${port}`);
});

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);
  const body = await readFile(filePath);

  res.writeHead(200, {
    "content-type": filePath.endsWith(".wasm.gz") ? "application/wasm" : contentTypes[extname(filePath)] || "application/octet-stream",
    ...(filePath.endsWith(".wasm.gz") ? { "content-encoding": "gzip" } : {}),
    "cache-control": "no-store",
    ...isolationHeaders,
  });
  res.end(body);
}

async function proxySource(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  if (!["GET", "HEAD"].includes(req.method || "GET")) {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const incomingUrl = new URL(req.url || "/", `http://${req.headers.host}`);
  const target = incomingUrl.searchParams.get("url");
  if (!target) {
    writeJson(res, 400, { error: "Missing url" });
    return;
  }

  const parsed = new URL(target);
  if (!parsed.hostname.endsWith(".cloudfront.net")) {
    writeJson(res, 400, { error: "Only CloudFront source URLs are allowed" });
    return;
  }

  const headers = new Headers();
  const range = req.headers.range;
  if (range) headers.set("range", Array.isArray(range) ? range[0] : range);
  headers.set("user-agent", "com.audible.playersdk.player/3.96.1 (Linux;Android 14) AndroidXMedia3/1.3.0");

  const upstream = await fetch(parsed, { method: req.method, headers, redirect: "manual" });

  const responseHeaders = corsHeaders();
  upstream.headers.forEach((value, name) => {
    if (!shouldDropResponseHeader(name)) responseHeaders[name] = value;
  });

  res.writeHead(upstream.status, responseHeaders);
  if (req.method !== "HEAD" && upstream.body) {
    for await (const chunk of upstream.body) res.write(chunk);
  }
  res.end();
}

function serveAccounts(req, res) {
  if (req.method !== "GET") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const identity = readBrowserIdentity(req);
  if (!identity) {
    writeJson(res, 200, { source: "no identity", authenticated: false, accounts: [] });
    return;
  }
  writeJson(res, 200, {
    source: "browser identity",
    authenticated: true,
    accounts: [{
      id: identity.amazonAccountId || "audible",
      name: identity.deviceName || "Audible account",
      locale: identity.locale || "uk",
      scanLibrary: true,
      authenticated: true,
    }],
  });
}

async function serveLibrary(req, res) {
  const identity = readBrowserIdentity(req);
  if (!identity) {
    writeJson(res, 401, { stage: "auth", error: "Audible identity missing from request" });
    return;
  }
  try {
    const payload = await fetchAudibleLibrary(identity);
    writeJson(res, 200, payload);
  } catch (error) {
    writeJson(res, 500, { error: error?.message || String(error) });
  }
}

async function fetchAudibleLibrary(identity) {
  const responseGroups = [
    "contributors", "media", "product_attrs",
    "product_desc", "product_extended_attrs", "series",
  ].join(",");
  const pageSize = 50;
  const books = [];
  let total = 0;
  let firstPayload = null;
  for (let page = 1; page <= 50; page += 1) {
    const path = `/1.0/library?num_results=${pageSize}&page=${page}&response_groups=${encodeURIComponent(responseGroups)}&image_sizes=500%2C300`;
    const { response } = await audibleFetch(identity, path);
    const payload = await response.json();
    if (!response.ok) throw new Error(`Audible library HTTP ${response.status}`);
    if (!firstPayload) firstPayload = payload;
    const normalised = normaliseLibrary(payload);
    books.push(...normalised.books);
    total = Number(payload.total_results || payload.total || normalised.count || books.length);
    if (normalised.books.length < pageSize || books.length >= total) break;
  }
  return { ...normaliseLibrary(firstPayload || {}), count: books.length, total, books };
}

async function serveLicense(req, res) {
  if (req.method !== "GET") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const asin = decodeURIComponent(url.pathname.split("/").at(-1) || "").trim();
  if (!/^[A-Z0-9]{8,16}$/.test(asin)) {
    writeJson(res, 400, { error: "Invalid ASIN" });
    return;
  }

  const identity = readBrowserIdentity(req);
  if (!identity) {
    writeJson(res, 401, { stage: "auth", error: "Audible identity missing from request" });
    return;
  }
  try {
    writeJson(res, 200, await getDownloadLicense(identity, asin));
  } catch (error) {
    writeJson(res, 500, { error: error?.message || String(error) });
  }
}

async function handleLogin(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/auth/login/start") {
    const body = await readJsonBody(req);
    const locale = String(body.locale || "").trim().toLowerCase();
    if (!/^[a-z]{2,4}$/.test(locale)) {
      writeJson(res, 400, { error: "Locale is required" });
      return;
    }
    try {
      writeJson(res, 200, await createLoginStart(locale));
    } catch (error) {
      writeJson(res, 500, { error: error?.message || String(error) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/auth/login/finish") {
    const body = await readJsonBody(req);
    const responseUrl = String(body.responseUrl || "").trim();
    if (!responseUrl || !body.session) {
      writeJson(res, 400, { error: "responseUrl and session are required" });
      return;
    }
    try {
      const identity = await finishLogin(responseUrl, body.session);
      writeJson(res, 200, { status: "authenticated", identity });
    } catch (error) {
      writeJson(res, 500, { status: "failed", error: error?.message || String(error) });
    }
    return;
  }

  writeJson(res, 404, { error: "Unknown login route" });
}

function readBrowserIdentity(req) {
  const header = req.headers["x-audible-auth"];
  if (!header || typeof header !== "string") return null;
  try {
    const padded = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(header.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "range, x-audible-auth",
    "access-control-expose-headers": "content-length, content-range, accept-ranges",
  };
}

function shouldDropResponseHeader(name) {
  const lower = name.toLowerCase();
  return lower === "content-encoding" || lower === "content-length" || lower === "set-cookie";
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}
