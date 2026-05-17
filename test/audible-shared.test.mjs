import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIBRARY_PAGE_SIZE,
  LIBRARY_RESPONSE_GROUPS,
  buildLibraryPath,
  buildLicensePath,
  buildLicenseRequestBody,
  getLocale,
} from "../lib/audible-shared.js";

test("buildLibraryPath returns deterministic path for page 1", () => {
  const path = buildLibraryPath(1);
  assert.match(path, /^\/1\.0\/library\?num_results=50&page=1&response_groups=/);
  assert.ok(path.includes(encodeURIComponent(LIBRARY_RESPONSE_GROUPS)));
});

test("buildLibraryPath honours pagination", () => {
  assert.match(buildLibraryPath(3), /page=3/);
  assert.match(buildLibraryPath(1, 25), /num_results=25/);
});

test("buildLicensePath includes asin", () => {
  assert.equal(buildLicensePath("B00BAR123"), "/1.0/content/B00BAR123/licenserequest");
});

test("buildLicenseRequestBody is deterministic", () => {
  const a = JSON.stringify(buildLicenseRequestBody());
  const b = JSON.stringify(buildLicenseRequestBody());
  assert.equal(a, b);
  assert.match(a, /"consumption_type":"Download"/);
  assert.match(a, /"drm_types":\["Adrm","Mpeg"\]/);
});

test("getLocale falls back to uk for unknown name", () => {
  assert.equal(getLocale("zz").name, "uk");
  assert.equal(getLocale(undefined).name, "uk");
  assert.equal(getLocale(null).name, "uk");
});

test("getLocale matches known locales case-insensitively", () => {
  assert.equal(getLocale("US").countryCode, "us");
  assert.equal(getLocale("de").topDomain, "de");
});

test("LIBRARY_PAGE_SIZE matches path query", () => {
  assert.match(buildLibraryPath(1), new RegExp(`num_results=${LIBRARY_PAGE_SIZE}`));
});
