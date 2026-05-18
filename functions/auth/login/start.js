import { createLoginStart, json } from "../../_shared/audible.js";

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.AUTH_LIMITER?.limit) {
    try {
      const { success } = await env.AUTH_LIMITER.limit({ key: ip });
      if (!success) return json({ error: "Too many sign-in attempts. Try again in a minute." }, 429);
    } catch {
      // If the rate-limit binding errors, fail open rather than blocking sign-in.
    }
  }
  const body = await request.json().catch(() => ({}));
  const locale = String(body.locale || env.AUDIBLE_MARKETPLACE || "uk").trim().toLowerCase();
  const returnTo = typeof body.returnTo === "string" && body.returnTo.startsWith("https://") ? body.returnTo : "";
  return json(await createLoginStart(locale, { returnTo }));
}
