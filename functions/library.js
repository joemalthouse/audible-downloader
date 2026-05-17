import { AudibleApiError, callAudibleApi, json, normaliseLibrary, readSignedAuth } from "./_shared/audible.js";
import { LIBRARY_PAGE_SIZE, buildLibraryPath } from "../lib/audible-shared.js";

export async function onRequestGet({ request }) {
  const auth = readSignedAuth(request);
  if (!auth) return json({ stage: "auth", error: "Signed Audible identity missing from request" }, 401);

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const path = buildLibraryPath(page);

  try {
    const response = await callAudibleApi(auth, path);
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 400) }; }
    if (!response.ok) {
      console.error("library audible upstream non-ok", { page, status: response.status });
      return json({ stage: "audible_api", page, path, status: response.status, detail: payload }, response.status);
    }
    const normalised = normaliseLibrary(payload);
    const total = Number(payload.total_results || payload.total || normalised.count || 0);
    return json({
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
      console.error("library callAudibleApi failed", { page, stage: error.stage, status: error.status });
      return json({ stage: error.stage, status: error.status, error: error.message, detail: error.detail, page, path }, 502);
    }
    console.error("library unexpected", error);
    return json({ stage: "unexpected", error: error?.message || String(error), page, path }, 500);
  }
}
