import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import {
  AudibleApiError,
  buildProxyUrlPath,
  callAudibleApi,
  createLoginStart,
  finishLogin,
  getDownloadLicense,
  normaliseLibrary,
  readSignedAuth,
  signProxyUrl,
  verifyProxyUrl,
} from "./functions/_shared/audible.js";
import { LIBRARY_PAGE_SIZE, buildLibraryPath } from "./lib/audible-shared.js";

const root = process.cwd();
const port = Number(process.env.PORT || 5174);
const sourceProxySecret = process.env.SOURCE_PROXY_SECRET || generateEphemeralSecret();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};
const securityHeaders = {
  "cross-origin-opener-policy": "same-origin-allow-popups",
  "content-security-policy": "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' blob:; img-src 'self' https://m.media-amazon.com data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; manifest-src 'self'",
  "referrer-policy": "no-referrer",
  "permissions-policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};
const RANGE_RE = /^bytes=\d+-\d*$/;
const PASSTHROUGH_HEADERS = ["content-type", "content-range", "accept-ranges", "cache-control", "last-modified", "etag"];

createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/source")) return await proxySource(req, res);
    if (req.url?.startsWith("/library")) return await serveLibrary(req, res);
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
  const filePath = resolve(root, "." + requested);
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const body = await readFile(filePath);

  res.writeHead(200, {
    "content-type": filePath.endsWith(".wasm.gz") ? "application/wasm" : contentTypes[extname(filePath)] || "application/octet-stream",
    ...(filePath.endsWith(".wasm.gz") ? { "content-encoding": "gzip" } : {}),
    "cache-control": "no-store",
    ...securityHeaders,
  });
  res.end(body);
}

async function proxySource(req, res) {
  if (!["GET", "HEAD"].includes(req.method || "GET")) {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const incomingUrl = new URL(req.url || "/", `http://${req.headers.host}`);
  const target = incomingUrl.searchParams.get("url");
  const sig = incomingUrl.searchParams.get("sig");
  const exp = incomingUrl.searchParams.get("exp");
  if (!target || !sig || !exp) {
    writeJson(res, 400, { error: "Missing url, sig, or exp" });
    return;
  }

  let parsed;
  try { parsed = new URL(target); }
  catch { writeJson(res, 400, { error: "Invalid target URL" }); return; }

  if (parsed.protocol !== "https:") {
    writeJson(res, 400, { error: "Only https sources are allowed" });
    return;
  }
  if (!parsed.hostname.endsWith(".cloudfront.net")) {
    writeJson(res, 400, { error: "Only Audible CloudFront source URLs are allowed" });
    return;
  }

  if (!(await verifyProxyUrl(sourceProxySecret, target, sig, exp))) {
    writeJson(res, 403, { error: "Invalid or expired proxy signature" });
    return;
  }

  const headers = new Headers();
  const rangeRaw = req.headers.range;
  const range = Array.isArray(rangeRaw) ? rangeRaw[0] : rangeRaw;
  if (range) {
    if (range.length > 200 || !RANGE_RE.test(range)) {
      writeJson(res, 400, { error: "Invalid Range header" });
      return;
    }
    headers.set("range", range);
  }
  headers.set("user-agent", "com.audible.playersdk.player/3.96.1 (Linux;Android 14) AndroidXMedia3/1.3.0");

  const upstream = await fetch(parsed, { method: req.method, headers, redirect: "manual" });

  const responseHeaders = {};
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }

  res.writeHead(upstream.status, responseHeaders);
  if (req.method !== "HEAD" && upstream.body) {
    for await (const chunk of upstream.body) res.write(chunk);
  }
  res.end();
}

async function serveLibrary(req, res) {
  if (req.method !== "GET") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const auth = readSignedAuth(toFetchRequest(req));
  if (!auth) {
    writeJson(res, 401, { stage: "auth", error: "Signed Audible identity missing from request" });
    return;
  }
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const path = buildLibraryPath(page);

  try {
    const response = await callAudibleApi(auth, path);
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 400) }; }
    if (!response.ok) {
      writeJson(res, response.status, { stage: "audible_api", page, path, status: response.status, detail: payload });
      return;
    }
    const normalised = normaliseLibrary(payload);
    const total = Number(payload.total_results || payload.total || normalised.count || 0);
    writeJson(res, 200, {
      source: "audible api",
      exportedAt: new Date().toISOString(),
      page,
      pageSize: LIBRARY_PAGE_SIZE,
      total,
      count: normalised.books.length,
      books: normalised.books,
    });
  } catch (error) {
    if (error instanceof AudibleApiError) {
      writeJson(res, 502, { stage: error.stage, status: error.status, error: error.message, detail: error.detail, page, path });
      return;
    }
    writeJson(res, 500, { stage: "unexpected", error: error?.message || String(error) });
  }
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

  const auth = readSignedAuth(toFetchRequest(req));
  if (!auth) {
    writeJson(res, 401, { stage: "auth", error: "Signed Audible identity missing from request" });
    return;
  }
  if (!auth.deviceSerialNumber || !auth.amazonAccountId) {
    writeJson(res, 400, { stage: "auth", error: "deviceSerialNumber and amazonAccountId are required for license decryption" });
    return;
  }
  try {
    const license = await getDownloadLicense(auth, asin);
    if (license.offlineUrl) {
      const signature = await signProxyUrl(sourceProxySecret, license.offlineUrl);
      license.proxyUrl = buildProxyUrlPath(license.offlineUrl, signature);
    }
    writeJson(res, 200, license);
  } catch (error) {
    if (error instanceof AudibleApiError) {
      writeJson(res, 502, { stage: error.stage, status: error.status, error: error.message, detail: error.detail, asin });
      return;
    }
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

function toFetchRequest(req) {
  return {
    headers: {
      get(name) {
        const value = req.headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value || null;
      },
    },
  };
}

function generateEphemeralSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  console.warn("[helper] SOURCE_PROXY_SECRET not set; using ephemeral dev secret. Set it in .dev.vars to persist across restarts.");
  return hex;
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
