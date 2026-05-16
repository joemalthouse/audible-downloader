import { AudibleApiError, getDownloadLicense, json, readRequestIdentity } from "../_shared/audible.js";

export async function onRequestGet({ request, params, env }) {
  const auth = readRequestIdentity(request, env);
  if (!auth) return json({ stage: "auth", error: "Audible identity missing from request" }, 401);

  const asin = String(params.asin || "").trim();
  if (!/^[A-Z0-9]{8,16}$/.test(asin)) return json({ stage: "validation", error: "Invalid ASIN", asin }, 400);

  try {
    return json(await getDownloadLicense(auth, asin));
  } catch (error) {
    if (error instanceof AudibleApiError) {
      console.error("license audibleFetch failed", { asin, stage: error.stage, status: error.status, detail: error.detail });
      return json({ stage: error.stage, status: error.status, error: error.message, detail: error.detail, asin }, 502);
    }
    console.error("license unexpected", { asin, error: error?.message || error });
    return json({ stage: "unexpected", error: error?.message || String(error), asin }, 500);
  }
}
