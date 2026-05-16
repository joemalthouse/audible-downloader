import { json, readRequestIdentity } from "../_shared/audible.js";

export async function onRequestGet({ request, env }) {
  const auth = readRequestIdentity(request, env);
  return json({
    source: auth ? "browser identity" : "cloudflare pages",
    authenticated: Boolean(auth),
    accounts: auth
      ? [{
        id: auth.amazonAccountId || "audible",
        name: auth.deviceName || "Audible account",
        locale: auth.locale || env.AUDIBLE_MARKETPLACE || "uk",
        scanLibrary: true,
        authenticated: true,
      }]
      : [],
  });
}
