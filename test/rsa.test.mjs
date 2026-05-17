import { test } from "node:test";
import assert from "node:assert/strict";
import { signRsaPkcs1 } from "../lib/rsa.js";

const enc = new TextEncoder();
const base64Decode = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

async function generateKeyPair() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

function pkcs8ToPem(pkcs8Bytes) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8Bytes)));
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----`;
}

test("signRsaPkcs1 (PKCS#8) verifies against the paired public key", async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  const pem = pkcs8ToPem(pkcs8);
  const data = "GET\n/1.0/library?page=1\n2026-05-17T12:34:56Z\n\nadp-token-value";
  const b64sig = await signRsaPkcs1(pem, data);
  const sigBytes = base64Decode(b64sig);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, sigBytes, enc.encode(data));
  assert.equal(ok, true);
});

test("signRsaPkcs1 produces stable signatures for identical input", async () => {
  const { privateKey } = await generateKeyPair();
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  const pem = pkcs8ToPem(pkcs8);
  const data = "GET\n/x\n2026-05-17T12:34:56Z\n\nadp";
  const a = await signRsaPkcs1(pem, data);
  const b = await signRsaPkcs1(pem, data);
  assert.equal(a, b);
});
