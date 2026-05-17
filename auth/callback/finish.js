const statusEl = document.querySelector("#status");
const errorEl = document.querySelector("#error");

finish().catch((error) => {
  statusEl.textContent = "Sign in could not be completed automatically.";
  errorEl.textContent = error?.message || String(error);
});

async function finish() {
  const responseUrl = location.href;
  history.replaceState(null, "", "/auth/callback/");

  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage({ type: "audible-auth-callback", responseUrl }, location.origin);
      statusEl.textContent = "Returning to the app...";
      window.close();
      return;
    } catch {
      // fall through to direct-navigation flow
    }
  }

  const stored = sessionStorage.getItem("audible-downloader-login") || localStorage.getItem("audible-downloader-login");
  if (!stored) throw new Error("No pending Audible login session was found. Return to the app and start sign in again.");

  const login = JSON.parse(stored);
  const response = await fetch("/auth/login/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    referrerPolicy: "no-referrer",
    body: JSON.stringify({ id: login.id, responseUrl, session: login.session }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status !== "authenticated" || !payload.identity) {
    throw new Error(payload.error || `Login finish HTTP ${response.status}`);
  }

  localStorage.setItem("audible-downloader-identity", JSON.stringify(payload.identity));
  sessionStorage.removeItem("audible-downloader-login");
  localStorage.removeItem("audible-downloader-login");
  statusEl.textContent = "Signed in. Returning to your library...";
  location.replace("/?auth=success");
}
