import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProxyUrlPath, signProxyUrl, verifyProxyUrl } from "../functions/_shared/audible.js";

const SECRET = "test-secret-not-for-prod-123";
const URL = "https://example.cloudfront.net/audiobook.aax?Signature=abc&Expires=999";

test("signProxyUrl roundtrips with verifyProxyUrl", async () => {
  const { sig, exp } = await signProxyUrl(SECRET, URL);
  assert.ok(sig.length > 0);
  assert.ok(exp > Math.floor(Date.now() / 1000));
  assert.equal(await verifyProxyUrl(SECRET, URL, sig, exp), true);
});

test("verifyProxyUrl rejects tampered URL", async () => {
  const { sig, exp } = await signProxyUrl(SECRET, URL);
  assert.equal(await verifyProxyUrl(SECRET, URL + "&extra=1", sig, exp), false);
});

test("verifyProxyUrl rejects wrong secret", async () => {
  const { sig, exp } = await signProxyUrl(SECRET, URL);
  assert.equal(await verifyProxyUrl("different-secret", URL, sig, exp), false);
});

test("verifyProxyUrl rejects expired signatures", async () => {
  const { sig } = await signProxyUrl(SECRET, URL);
  const pastExp = Math.floor(Date.now() / 1000) - 1;
  assert.equal(await verifyProxyUrl(SECRET, URL, sig, pastExp), false);
});

test("verifyProxyUrl rejects missing fields", async () => {
  assert.equal(await verifyProxyUrl(SECRET, URL, "", 99999999), false);
  assert.equal(await verifyProxyUrl(SECRET, URL, "abc", 0), false);
  assert.equal(await verifyProxyUrl(SECRET, "", "abc", 99999999), false);
  assert.equal(await verifyProxyUrl("", URL, "abc", 99999999), false);
});

test("signProxyUrl throws on missing secret", async () => {
  await assert.rejects(() => signProxyUrl(undefined, URL), /SOURCE_PROXY_SECRET/);
});

test("buildProxyUrlPath formats correctly", () => {
  const path = buildProxyUrlPath("https://x.cloudfront.net/a", { sig: "SIG", exp: 12345 });
  assert.equal(path, "/source?url=https%3A%2F%2Fx.cloudfront.net%2Fa&sig=SIG&exp=12345");
});

test("buildProxyUrlPath returns empty when inputs missing", () => {
  assert.equal(buildProxyUrlPath("", { sig: "x", exp: 1 }), "");
  assert.equal(buildProxyUrlPath("u", { sig: "", exp: 1 }), "");
  assert.equal(buildProxyUrlPath("u", { sig: "x", exp: 0 }), "");
});
