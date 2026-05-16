import { createLoginStart, json } from "../../_shared/audible.js";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const locale = String(body.locale || env.AUDIBLE_MARKETPLACE || "uk").trim().toLowerCase();
  const returnTo = typeof body.returnTo === "string" && body.returnTo.startsWith("https://") ? body.returnTo : "";
  return json(await createLoginStart(locale, { returnTo }));
}
