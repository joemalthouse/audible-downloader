import { cbc } from "@noble/ciphers/aes.js";

const RESOURCES = {
  deviceType: "A10KISP2GWF0E4",
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
  userAgent: "Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64 Build/UPB5.230623.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/113.0.5672.136 Mobile Safari/537.36",
  downloadUserAgent: "com.audible.playersdk.player/3.96.1 (Linux;Android 14) AndroidXMedia3/1.3.0",
};

const LOCALES = {
  us: { name: "us", countryCode: "us", topDomain: "com", marketPlaceId: "AF2M0KC94RCEA", language: "en-US" },
  uk: { name: "uk", countryCode: "uk", topDomain: "co.uk", marketPlaceId: "A2I9A3Q2GNFNGQ", language: "en-GB" },
  au: { name: "au", countryCode: "au", topDomain: "com.au", marketPlaceId: "AN7EY7DTAW63G", language: "en-AU" },
  australia: { name: "au", countryCode: "au", topDomain: "com.au", marketPlaceId: "AN7EY7DTAW63G", language: "en-AU" },
  br: { name: "br", countryCode: "br", topDomain: "com.br", marketPlaceId: "A10J1VAYUDTYRN", language: "pt-BR" },
  ca: { name: "ca", countryCode: "ca", topDomain: "ca", marketPlaceId: "A2CQZ5RBY40XE", language: "en-CA" },
  de: { name: "de", countryCode: "de", topDomain: "de", marketPlaceId: "AN7V1F1VY261K", language: "de-DE" },
  es: { name: "es", countryCode: "es", topDomain: "es", marketPlaceId: "ALMIKO4SZCSAR", language: "es-ES" },
  fr: { name: "fr", countryCode: "fr", topDomain: "fr", marketPlaceId: "A2728XDNODOQ8T", language: "fr-FR" },
  in: { name: "in", countryCode: "in", topDomain: "in", marketPlaceId: "AJO3FBRUE6J4S", language: "en-IN" },
  it: { name: "it", countryCode: "it", topDomain: "it", marketPlaceId: "A2N7FU2W2BU2ZC", language: "it-IT" },
  jp: { name: "jp", countryCode: "jp", topDomain: "co.jp", marketPlaceId: "A1QAP3MOU4173J", language: "ja-JP" },
};

export function getLocale(name = "uk") {
  return LOCALES[String(name || "uk").toLowerCase()] || LOCALES.uk;
}

export async function createLoginStart(localeName, options = {}) {
  const locale = getLocale(localeName);
  const deviceSerialNumber = hex(randomBytes(20));
  const codeVerifier = base64Url(randomBytes(32));
  const challengeBytes = await crypto.subtle.digest("SHA-256", utf8(codeVerifier));
  const challengeCode = base64Url(new Uint8Array(challengeBytes));
  const clientId = hex(utf8(`${deviceSerialNumber}#${RESOURCES.deviceType}`));
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
      device_type: RESOURCES.deviceType,
      device_serial: session.deviceSerialNumber,
      app_name: RESOURCES.appName,
      app_version: RESOURCES.appVersion,
      device_model: RESOURCES.deviceModel,
      os_version: RESOURCES.osVersion,
      software_version: RESOURCES.softwareVersion,
      device_name: `%FIRST_NAME%%FIRST_NAME_POSSESSIVE_STRING%%DUPE_STRATEGY_1ST%${session.deviceName || "Audible Downloader Web"}`,
    },
    device_metadata: {
      device_os_family: RESOURCES.osFamily,
      device_type: RESOURCES.deviceType,
      device_serial: session.deviceSerialNumber,
      manufacturer: RESOURCES.manufacturer,
      model: RESOURCES.deviceModel,
      os_version: RESOURCES.osVersionNumber,
      product: RESOURCES.deviceProduct,
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
      "user-agent": RESOURCES.userAgent,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Amazon register HTTP ${response.status}: ${text.slice(0, 300)}`);
  return parseRegistration(JSON.parse(text), locale);
}

export function readRequestIdentity(request, env) {
  const header = request.headers.get("x-audible-auth");
  if (header) return JSON.parse(textDecoder.decode(base64UrlDecode(header)));
  if (env?.AUDIBLE_AUTH_JSON) return JSON.parse(env.AUDIBLE_AUTH_JSON);
  return null;
}

export async function refreshIdentity(identity) {
  if (!identity?.refreshToken) return identity;
  if (identity.accessTokenExpiresAt && Date.parse(identity.accessTokenExpiresAt) - Date.now() > 300_000) return identity;

  const locale = getLocale(identity.locale);
  const body = new URLSearchParams({
    app_name: RESOURCES.appName,
    app_version: RESOURCES.appVersion,
    source_token: identity.refreshToken,
    requested_token_type: "access_token",
    source_token_type: "refresh_token",
  });
  const response = await fetch(`${registrationBase(locale)}/auth/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "x-amzn-identity-auth-domain": new URL(registrationBase(locale)).host,
      "user-agent": RESOURCES.userAgent,
    },
    body,
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 400) }; }
  if (!response.ok) throw new AudibleApiError("token_refresh", response.status, payload);
  return {
    ...identity,
    accessToken: payload.access_token,
    accessTokenExpiresAt: new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString(),
  };
}

export async function audibleFetch(identity, path, options = {}) {
  identity = await refreshIdentity(identity);

  const locale = getLocale(identity.locale);
  const method = options.method || "GET";
  const body = options.body ? JSON.stringify(options.body) : "";
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  let signature;
  try {
    signature = await signRequest(identity.privateKey, `${method}\n${path}\n${date}\n${body}\n${identity.adpToken}`);
  } catch (error) {
    throw new AudibleApiError("sign_request", 0, `${error?.name || "Error"}: ${error?.message || String(error)}`);
  }

  const response = await fetch(`${audibleApiBase(locale)}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      "user-agent": options.download ? RESOURCES.downloadUserAgent : RESOURCES.userAgent,
      "x-adp-token": identity.adpToken,
      "x-adp-alg": "SHA256withRSA:1.0",
      "x-adp-signature": `${signature}:${date}`,
    },
    body: body || undefined,
  });

  return { response, identity };
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

export async function getDownloadLicense(identity, asin) {
  const body = {
    supported_media_features: {
      drm_types: ["Adrm", "Mpeg"],
      codecs: ["mp4a.40.2"],
      chapter_titles_type: "Tree",
      previews: false,
      catalog_samples: false,
    },
    spatial: false,
    consumption_type: "Download",
    tenant_id: "Audible",
    quality: "High",
    response_groups: "last_position_heard,pdf_url,content_reference,chapter_info",
  };
  const { response } = await audibleFetch(identity, `/1.0/content/${asin}/licenserequest`, { method: "POST", body });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 400) }; }
  if (!response.ok) throw new AudibleApiError("licenserequest", response.status, payload);
  return await normaliseLicense(payload, identity, asin);
}

export function normaliseLibrary(payload) {
  const items = payload.items || payload.books || [];
  const books = items.map((book) => ({
    asin: book.asin || book.AudibleProductId || book.product_id || "",
    title: book.title || book.Title || "",
    subtitle: book.subtitle || book.Subtitle || "",
    authors: Array.isArray(book.authors) ? book.authors.map((a) => a.name || a).join(", ") : book.AuthorNames || "",
    narrators: Array.isArray(book.narrators) ? book.narrators.map((n) => n.name || n).join(", ") : book.NarratorNames || "",
    lengthInMinutes: Math.round((book.runtime_length_min || book.LengthInMinutes || 0)),
    locale: book.locale || "",
    status: book.status || "",
    imageUrl: getBookImageUrl(book),
  })).filter((book) => book.asin && book.title);

  return { source: "audible api", exportedAt: new Date().toISOString(), count: books.length, books };
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

function parseRegistration(payload, locale) {
  const success = payload?.response?.success;
  const tokens = success?.tokens;
  const bearer = tokens?.bearer;
  const mac = tokens?.mac_dms;
  const device = success?.extensions?.device_info;
  const customer = success?.extensions?.customer_info;
  if (!bearer?.access_token || !bearer?.refresh_token || !mac?.adp_token || !mac?.device_private_key) {
    throw new Error("Amazon registration response did not include required tokens");
  }

  return {
    locale: locale.name,
    accessToken: bearer.access_token,
    refreshToken: bearer.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + Number(bearer.expires_in || 3600) * 1000).toISOString(),
    adpToken: mac.adp_token,
    privateKey: mac.device_private_key,
    deviceType: device?.device_type || RESOURCES.deviceType,
    deviceSerialNumber: device?.device_serial_number,
    deviceName: device?.device_name,
    amazonAccountId: customer?.user_id,
  };
}

async function normaliseLicense(payload, identity, asin) {
  const license = payload.content_license || payload.ContentLicense || payload;
  const metadata = license.content_metadata || license.ContentMetadata || {};
  const reference = metadata.content_reference || {};
  const offlineUrl = metadata.content_url?.offline_url || "";
  const voucher = await decryptVoucher(license, identity, asin);
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

async function decryptVoucher(license, identity, asin) {
  if (!license.license_response) return license.voucher || null;
  const material = utf8(`${identity.deviceType || RESOURCES.deviceType}${identity.deviceSerialNumber}${identity.amazonAccountId}${license.asin || asin}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
  const key = hash.slice(0, 16);
  const iv = hash.slice(16, 32);
  const plaintext = cbc(key, iv, { disablePadding: true }).decrypt(base64Decode(license.license_response));
  const end = plaintext.indexOf(0);
  const jsonText = textDecoder.decode(end >= 0 ? plaintext.slice(0, end) : plaintext).trim();
  return jsonText ? JSON.parse(jsonText) : null;
}

async function signRequest(privateKeyPemOrBase64, data) {
  const keyData = loadRsaPkcs8(privateKeyPemOrBase64);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(data));
  return base64(new Uint8Array(signature));
}

function loadRsaPkcs8(pem) {
  const text = String(pem);
  const isPkcs1 = /-----BEGIN RSA PRIVATE KEY-----/.test(text);
  const der = pemToBytes(text);
  return isPkcs1 ? wrapPkcs1AsPkcs8(der) : der;
}

function wrapPkcs1AsPkcs8(pkcs1) {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const algorithm = new Uint8Array([
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  ]);
  const octet = derTag(0x04, pkcs1);
  const content = concatBytes(version, algorithm, octet);
  return derTag(0x30, content);
}

function derLength(length) {
  if (length < 0x80) return new Uint8Array([length]);
  if (length <= 0xff) return new Uint8Array([0x81, length]);
  if (length <= 0xffff) return new Uint8Array([0x82, (length >> 8) & 0xff, length & 0xff]);
  return new Uint8Array([0x83, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
}

function derTag(tag, content) {
  const length = derLength(content.length);
  const out = new Uint8Array(1 + length.length + content.length);
  out[0] = tag;
  out.set(length, 1);
  out.set(content, 1 + length.length);
  return out;
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

function parseAuthorizationCode(responseUrl) {
  const url = new URL(responseUrl);
  return url.searchParams.get("openid.oa2.authorization_code");
}

function audibleApiBase(locale) {
  return `https://api.audible.${locale.topDomain}`;
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

function pemToBytes(value) {
  const clean = String(value)
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  return base64Decode(clean);
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const utf8 = (value) => textEncoder.encode(value);
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));
const base64Decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const base64Url = (bytes) => base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const base64UrlDecode = (value) => base64Decode(String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
