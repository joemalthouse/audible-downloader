import { finishLogin, json } from "../../_shared/audible.js";

export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    if (!body?.responseUrl || !body?.session) return json({ error: "responseUrl and session are required" }, 400);
    const identity = await finishLogin(String(body.responseUrl), body.session);
    return json({ status: "authenticated", identity });
  } catch (error) {
    return json({ error: error?.message || String(error), status: "failed" }, 400);
  }
}
