const textEncoder = new TextEncoder();
const utf8 = (value) => textEncoder.encode(value);
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));
const base64Decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export async function signRsaPkcs1(privateKeyPemOrBase64, dataString) {
  const cryptoKey = await importPrivateKey(privateKeyPemOrBase64);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, utf8(dataString));
  return base64(new Uint8Array(signature));
}

const importedKeys = new Map();

async function importPrivateKey(pem) {
  const fingerprint = await sha256Hex(pem);
  const cached = importedKeys.get(fingerprint);
  if (cached) return cached;
  const pkcs8 = loadRsaPkcs8(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  importedKeys.set(fingerprint, key);
  return key;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", utf8(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function loadRsaPkcs8(pem) {
  const text = String(pem);
  const isPkcs1 = /-----BEGIN RSA PRIVATE KEY-----/.test(text);
  const der = pemToBytes(text);
  return isPkcs1 ? wrapPkcs1AsPkcs8(der) : der;
}

function pemToBytes(value) {
  const clean = String(value)
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  return base64Decode(clean);
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
