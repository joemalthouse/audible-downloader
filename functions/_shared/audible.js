import { cbc } from "@noble/ciphers/aes.js";
import {
  AUDIBLE_API_USER_AGENT,
  AUDIBLE_DEVICE_TYPE,
  AUDIBLE_DOWNLOAD_USER_AGENT,
  audibleApiBase,
  buildLicensePath,
  buildLicenseRequestBody,
  getLocale,
} from "../../lib/audible-shared.js";

// Pinned to the Audible Android app device-registration handshake.
// Amazon validates these values; if /auth/register starts failing with
// InvalidClient or DeviceRegistration errors, pull the latest strings
// from a current Audible APK build and bump here.
const REGISTRATION = {
  deviceType: AUDIBLE_DEVICE_TYPE,
  appName: "com.audible.application",
  appVersion: "2090253826",
  appVersionName: "25.38.26",
  softwareVersion: "130050002",
  deviceModel: "sdk_gphone64_x86_64",
  osVersion: "google/sdk_gphone64_x86_64/emu64xa:14/UPB5.230623.003/10615560:userdebug/dev-keys",
  osVersionNumber: "34",
  osFamily: "android",
  manufacturer: "Google",
  deviceProduct: "sdk_phone64_x86_64",
  userAgent: AUDIBLE_API_USER_AGENT,
};

export async function createLoginStart(localeName, options = {}) {
  const locale = getLocale(localeName);
  const deviceSerialNumber = hex(randomBytes(20));
  const codeVerifier = base64Url(randomBytes(32));
  const challengeBytes = await crypto.subtle.digest("SHA-256", utf8(codeVerifier));
  const challengeCode = base64Url(new Uint8Array(challengeBytes));
  const clientId = hex(utf8(`${deviceSerialNumber}#${REGISTRATION.deviceType}`));
  const session = {
    locale: locale.name,
    deviceSerialNumber,
    codeVerifier,
    challengeCode,
    clientId,
    deviceName: "Audible Downloader Web",
  };

  const returnTo = options.returnTo || `${audibleLoginBase(locale)}/ap/maplanding`;
  const assocHandle = `amzn_audible_android_aui_${locale.countryCode}`;
  const pageId = `amzn_audible_android_aui_v2_dark_us${locale.countryCode}`;
  const params = new URLSearchParams({
    "openid.pape.max_auth_age": "0",
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    accountStatusPolicy: "P1",
    marketPlaceId: locale.marketPlaceId,
    pageId,
    "openid.return_to": returnTo,
    "openid.assoc_handle": assocHandle,
    "openid.oa2.response_type": "code",
    "openid.mode": "checkid_setup",
    "openid.ns.pape": "http://specs.openid.net/extensions/pape/1.0",
    "openid.oa2.code_challenge_method": "S256",
    "openid.ns.oa2": "http://www.amazon.com/ap/ext/oauth/2",
    "openid.oa2.code_challenge": challengeCode,
    "openid.oa2.scope": "device_auth_access",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.oa2.client_id": `device:${clientId}`,
    disableLoginPrepopulate: "1",
    "openid.ns": "http://specs.openid.net/auth/2.0",
  });

  return {
    id: crypto.randomUUID(),
    status: "waiting_for_response_url",
    signInUrl: `${loginBase(locale)}/ap/signin?${params}`,
    session,
  };
}

export async function finishLogin(responseUrl, session) {
  const locale = getLocale(session?.locale);
  const authorizationCode = parseAuthorizationCode(responseUrl);
  if (!authorizationCode) throw new Error("Final URL did not contain openid.oa2.authorization_code");

  const body = {
    requested_token_type: ["bearer", "mac_dms", "store_authentication_cookie", "website_cookies"],
    cookies: { domain: audibleLoginBase(locale), website_cookies: [] },
    registration_data: {
      domain: "DeviceLegacy",
      device_type: REGISTRATION.deviceType,
      device_serial: session.deviceSerialNumber,
      app_name: REGISTRATION.appName,
      app_version: REGISTRATION.appVersion,
      device_model: REGISTRATION.deviceModel,
      os_version: REGISTRATION.osVersion,
      software_version: REGISTRATION.softwareVersion,
      device_name: `%FIRST_NAME%%FIRST_NAME_POSSESSIVE_STRING%%DUPE_STRATEGY_1ST%${session.deviceName || "Audible Downloader Web"}`,
    },
    device_metadata: {
      device_os_family: REGISTRATION.osFamily,
      device_type: REGISTRATION.deviceType,
      device_serial: session.deviceSerialNumber,
      manufacturer: REGISTRATION.manufacturer,
      model: REGISTRATION.deviceModel,
      os_version: REGISTRATION.osVersionNumber,
      product: REGISTRATION.deviceProduct,
    },
    auth_data: {
      use_global_authentication: "true",
      authorization_code: authorizationCode,
      code_verifier: session.codeVerifier,
      code_algorithm: "SHA-256",
      client_domain: "DeviceLegacy",
      client_id: session.clientId,
    },
    requested_extensions: ["device_info", "customer_info"],
  };

  const response = await fetch(`${registrationBase(locale)}/auth/register`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      "user-agent": REGISTRATION.userAgent,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Amazon register HTTP ${response.status}: ${text.slice(0, 300)}`);
  return parseRegistration(JSON.parse(text), locale);
}

export function readSignedAuth(request) {
  const header = request.headers.get("x-audible-auth");
  if (!header) return null;
  try {
    const auth = JSON.parse(textDecoder.decode(base64UrlDecode(header)));
    if (!auth?.adpToken || !auth?.signature || !auth?.date || !auth?.locale) return null;
    return auth;
  } catch {
    return null;
  }
}

export async function callAudibleApi(auth, path, { method = "GET", body = "", download = false } = {}) {
  const locale = getLocale(auth.locale);
  const response = await fetch(`${audibleApiBase(locale)}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      "user-agent": download ? AUDIBLE_DOWNLOAD_USER_AGENT : AUDIBLE_API_USER_AGENT,
      "x-adp-token": auth.adpToken,
      "x-adp-alg": "SHA256withRSA:1.0",
      "x-adp-signature": `${auth.signature}:${auth.date}`,
    },
    body: body || undefined,
  });
  return response;
}

export class AudibleApiError extends Error {
  constructor(stage, status, detail) {
    super(`${stage}${status ? ` HTTP ${status}` : ""}: ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}`);
    this.name = "AudibleApiError";
    this.stage = stage;
    this.status = status;
    this.detail = detail;
  }
}

export async function getDownloadLicense(auth, asin) {
  const response = await callAudibleApi(auth, buildLicensePath(asin), {
    method: "POST",
    body: JSON.stringify(buildLicenseRequestBody()),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 400) }; }
  if (!response.ok) throw new AudibleApiError("licenserequest", response.status, payload);
  return await normaliseLicense(payload, auth, asin);
}

export function normaliseLibrary(payload) {
  const items = payload.items || payload.books || [];
  const books = items.map((book) => {
    const series = Array.isArray(book.series) ? book.series.map((s) => ({
      asin: s.asin || "",
      title: s.title || "",
      sequence: s.sequence || "",
    })).filter((s) => s.title) : [];
    return {
      asin: book.asin || book.AudibleProductId || book.product_id || "",
      title: book.title || book.Title || "",
      subtitle: book.subtitle || book.Subtitle || "",
      authors: Array.isArray(book.authors) ? book.authors.map((a) => a.name || a).join(", ") : book.AuthorNames || "",
      narrators: Array.isArray(book.narrators) ? book.narrators.map((n) => n.name || n).join(", ") : book.NarratorNames || "",
      lengthInMinutes: Math.round((book.runtime_length_min || book.LengthInMinutes || 0)),
      locale: book.locale || "",
      status: book.status || "",
      imageUrl: getBookImageUrl(book),
      synopsis: stripHtml(book.publisher_summary || book.PublisherSummary || book.merchandising_summary || book.summary || ""),
      releaseDate: book.release_date || book.issue_date || book.publication_datetime || book.IssueDate || "",
      language: book.language || book.Language || "",
      publisher: book.publisher_name || book.PublisherName || book.publisher || "",
      series,
      purchaseDate: book.purchase_date || "",
    };
  }).filter((book) => book.asin && book.title);

  return { source: "audible api", exportedAt: new Date().toISOString(), count: books.length, books };
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function getBookImageUrl(book) {
  const images = book.product_images || book.productImages || book.ProductImages || {};
  return images["500"] || images["300"] || images["1215"] || images["882"] || images["558"] || images["445"] || images["338"] || book.image_url || book.cover_url || "";
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });
}

export async function signProxyUrl(secret, url, ttlSeconds = 7200) {
  if (!secret) throw new Error("SOURCE_PROXY_SECRET is not configured");
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, utf8(`${url}\n${exp}`));
  return { sig: base64Url(new Uint8Array(sig)), exp };
}

export async function verifyProxyUrl(secret, url, sig, exp) {
  if (!secret || !url || !sig || !exp) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  try {
    const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify("HMAC", key, base64UrlDecode(sig), utf8(`${url}\n${expNum}`));
  } catch {
    return false;
  }
}

export function buildProxyUrlPath(offlineUrl, signature) {
  if (!offlineUrl || !signature?.sig || !signature?.exp) return "";
  return `/source?url=${encodeURIComponent(offlineUrl)}&sig=${signature.sig}&exp=${signature.exp}`;
}

function parseRegistration(payload, locale) {
  const success = payload?.response?.success;
  const tokens = success?.tokens;
  const mac = tokens?.mac_dms;
  const device = success?.extensions?.device_info;
  const customer = success?.extensions?.customer_info;
  if (!mac?.adp_token || !mac?.device_private_key) {
    throw new Error("Amazon registration response did not include required tokens");
  }

  return {
    locale: locale.name,
    adpToken: mac.adp_token,
    privateKey: mac.device_private_key,
    deviceType: device?.device_type || REGISTRATION.deviceType,
    deviceSerialNumber: device?.device_serial_number,
    deviceName: device?.device_name,
    amazonAccountId: customer?.user_id,
  };
}

async function normaliseLicense(payload, auth, asin) {
  const license = payload.content_license || payload.ContentLicense || payload;
  const metadata = license.content_metadata || license.ContentMetadata || {};
  const reference = metadata.content_reference || {};
  const offlineUrl = metadata.content_url?.offline_url || "";
  const voucher = await decryptVoucher(license, auth, asin);
  const parsedUrl = offlineUrl ? new URL(offlineUrl) : null;

  return {
    asin,
    drmType: license.drm_type || license.DrmType || "",
    offlineUrl,
    urlHost: parsedUrl?.host || "",
    urlExpires: parsedUrl?.searchParams.get("Expires") || "",
    contentFormat: reference.content_format || "",
    codec: reference.codec || "",
    size: reference.content_size_in_bytes || 0,
    version: reference.version || "",
    fileVersion: reference.file_version || "",
    sku: reference.sku || "",
    chapterCount: metadata.chapter_info?.chapters?.length || 0,
    chapters: metadata.chapter_info?.chapters || [],
    runtimeMs: metadata.chapter_info?.runtime_length_ms || 0,
    hasDecryptionKeys: Boolean(voucher?.key),
    decryptionKeys: voucher?.key ? [{ keyPart1: voucher.key, keyPart2: voucher.iv || voucher.KeyPart2 || "" }] : [],
    rawStatus: license.status_code || "",
  };
}

async function decryptVoucher(license, auth, asin) {
  if (!license.license_response) return license.voucher || null;
  if (!auth.deviceSerialNumber || !auth.amazonAccountId) {
    throw new AudibleApiError("voucher_decrypt", 0, "deviceSerialNumber and amazonAccountId are required");
  }
  const material = utf8(`${auth.deviceType || REGISTRATION.deviceType}${auth.deviceSerialNumber}${auth.amazonAccountId}${license.asin || asin}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
  const key = hash.slice(0, 16);
  const iv = hash.slice(16, 32);
  const plaintext = cbc(key, iv, { disablePadding: true }).decrypt(base64Decode(license.license_response));
  const end = plaintext.indexOf(0);
  const jsonText = textDecoder.decode(end >= 0 ? plaintext.slice(0, end) : plaintext).trim();
  return jsonText ? JSON.parse(jsonText) : null;
}

function parseAuthorizationCode(responseUrl) {
  try {
    const url = new URL(responseUrl);
    return url.searchParams.get("openid.oa2.authorization_code");
  } catch {
    return null;
  }
}

function audibleLoginBase(locale) {
  return `https://www.audible.${locale.topDomain}`;
}

function loginBase(locale) {
  return `https://www.amazon.${locale.topDomain}`;
}

function registrationBase(locale) {
  return `https://api.amazon.${locale.topDomain}`;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const utf8 = (value) => textEncoder.encode(value);
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));
const base64Decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const base64Url = (bytes) => base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const base64UrlDecode = (value) => base64Decode(String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
