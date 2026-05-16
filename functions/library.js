import { AudibleApiError, audibleFetch, json, normaliseLibrary, readRequestIdentity } from "./_shared/audible.js";

export async function onRequestGet({ request, env }) {
  const auth = readRequestIdentity(request, env);
  if (!auth) return json({ stage: "auth", error: "Audible identity missing from request" }, 401);

  const responseGroups = [
    "contributors",
    "media",
    "product_attrs",
    "product_desc",
    "product_extended_attrs",
    "series",
  ].join(",");
  const pageSize = 50;
  const books = [];
  let total = 0;
  let firstPayload = null;
  let lastPath = "";

  try {
    for (let page = 1; page <= 50; page += 1) {
      lastPath = `/1.0/library?num_results=${pageSize}&page=${page}&response_groups=${encodeURIComponent(responseGroups)}&image_sizes=500%2C300`;
      const { response } = await audibleFetch(auth, lastPath);
      const text = await response.text();
      let payload;
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 400) }; }
      if (!response.ok) {
        console.error("library audible upstream non-ok", { page, status: response.status, payload });
        return json({
          stage: "audible_api",
          page,
          path: lastPath,
          status: response.status,
          detail: payload,
        }, response.status);
      }
      if (!firstPayload) firstPayload = payload;
      const normalised = normaliseLibrary(payload);
      books.push(...normalised.books);
      total = Number(payload.total_results || payload.total || normalised.count || books.length);
      if (normalised.books.length < pageSize || books.length >= total) break;
    }
  } catch (error) {
    if (error instanceof AudibleApiError) {
      console.error("library audibleFetch failed", { stage: error.stage, status: error.status, detail: error.detail, path: lastPath });
      return json({ stage: error.stage, status: error.status, error: error.message, detail: error.detail, path: lastPath }, 502);
    }
    console.error("library unexpected", error);
    return json({ stage: "unexpected", error: error?.message || String(error), path: lastPath }, 500);
  }

  return json({ ...normaliseLibrary(firstPayload || {}), count: books.length, total, books });
}
