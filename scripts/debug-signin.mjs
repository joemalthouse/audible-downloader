import { chromium } from "playwright";

const url = process.argv[2] || "https://audible-downloader.pages.dev/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();

const events = [];
function log(label, detail) { events.push({ t: Date.now(), label, detail }); }

page.on("console", (msg) => log("console." + msg.type(), msg.text()));
page.on("pageerror", (err) => log("pageerror", err.message + "\n" + (err.stack || "")));
page.on("requestfailed", (req) => log("reqfailed", `${req.method()} ${req.url()} :: ${req.failure()?.errorText}`));
page.on("request", (req) => log("req", `${req.method()} ${req.url()}`));
page.on("response", (res) => log("res", `${res.status()} ${res.url()}`));
context.on("page", (popup) => {
  log("popup", popup.url());
  popup.on("console", (msg) => log("popup.console." + msg.type(), msg.text()));
  popup.on("pageerror", (err) => log("popup.pageerror", err.message));
});

log("nav", "starting");
await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
log("nav", "loaded");

// Inspect state
const initial = await page.evaluate(() => ({
  connectSummary: document.querySelector("#connectSummary")?.textContent,
  startButton: !!document.querySelector("#startLoginButton"),
  startButtonDisabled: document.querySelector("#startLoginButton")?.disabled,
  audibleIdentity: localStorage.getItem("audible-downloader-identity"),
}));
log("state.before", JSON.stringify(initial));

await page.click("#startLoginButton", { timeout: 5000 }).catch((e) => log("click.error", e.message));

await page.waitForTimeout(4000);

const after = await page.evaluate(() => ({
  connectSummary: document.querySelector("#connectSummary")?.textContent,
  startButtonDisabled: document.querySelector("#startLoginButton")?.disabled,
  loginStartActive: document.querySelector("#loginStartPanel")?.classList.contains("is-active"),
  loginWaitingActive: document.querySelector("#loginWaitingPanel")?.classList.contains("is-active"),
  loginSignedInActive: document.querySelector("#loginSignedInPanel")?.classList.contains("is-active"),
}));
log("state.after", JSON.stringify(after));

await browser.close();

for (const ev of events) {
  process.stdout.write(`[+${(ev.t - events[0].t).toString().padStart(5, " ")}ms] ${ev.label}: ${ev.detail}\n`);
}
