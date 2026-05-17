import { AudibleApiError, buildProxyUrlPath, getDownloadLicense, json, readSignedAuth, signProxyUrl } from "../_shared/audible.js";

export async function onRequestGet({ request, params, env }) {
  const auth = readSignedAuth(request);
  if (!auth) return json({ stage: "auth", error: "Signed Audible identity missing from request" }, 401);
  if (!auth.deviceSerialNumber || !auth.amazonAccountId) {
    return json({ stage: "auth", error: "deviceSerialNumber and amazonAccountId are required for license decryption" }, 400);
  }

  const asin = String(params.asin || "").trim();
  if (!/^[A-Z0-9]{8,16}$/.test(asin)) return json({ stage: "validation", error: "Invalid ASIN", asin }, 400);

  try {
    const license = await getDownloadLicense(auth, asin);
    if (license.offlineUrl) {
      const signature = await signProxyUrl(env.SOURCE_PROXY_SECRET, license.offlineUrl);
      license.proxyUrl = buildProxyUrlPath(license.offlineUrl, signature);
    }
    return json(license);
  } catch (error) {
    if (error instanceof AudibleApiError) {
      console.error("license callAudibleApi failed", { asin, stage: error.stage, status: error.status });
      return json({ stage: error.stage, status: error.status, error: error.message, detail: error.detail, asin }, 502);
    }
    console.error("license unexpected", { asin, error: error?.message || error });
    return json({ stage: "unexpected", error: error?.message || String(error), asin }, 500);
  }
}
