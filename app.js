import { signRsaPkcs1 } from "./lib/rsa.js";
import {
  LIBRARY_PAGE_SIZE,
  buildLibraryPath,
  buildLicensePath,
  buildLicenseRequestBody,
} from "./lib/audible-shared.js";

const libraryEl = document.querySelector("#library");
const librarySummary = document.querySelector("#librarySummary");
const librarySearchInput = document.querySelector("#librarySearch");
const librarySortSelect = document.querySelector("#librarySort");
const exportCsvButton = document.querySelector("#exportLibraryCsv");
const exportJsonButton = document.querySelector("#exportLibraryJson");
const bookCardTemplate = document.querySelector("#bookCardTemplate");
const connectSummary = document.querySelector("#connectSummary");
const capabilityStatus = document.querySelector("#capabilityStatus");
const refreshLibraryButton = document.querySelector("#refreshLibraryButton");
const signOutButton = document.querySelector("#signOutButton");
const loginLocaleInput = document.querySelector("#loginLocaleInput");
const startLoginButton = document.querySelector("#startLoginButton");
const reopenLoginButton = document.querySelector("#reopenLoginButton");
const cancelLoginButton = document.querySelector("#cancelLoginButton");
const loginStartPanel = document.querySelector("#loginStartPanel");
const loginWaitingPanel = document.querySelector("#loginWaitingPanel");
const loginSignedInPanel = document.querySelector("#loginSignedInPanel");
const loginDomainHint = document.querySelector("#loginDomainHint");
const loginResponseInput = document.querySelector("#loginResponseInput");
const finishLoginButton = document.querySelector("#finishLoginButton");
const wasmStatus = document.querySelector("#wasmStatus");
const wasmLog = document.querySelector("#wasmLog");
const wasmProgressBar = document.querySelector("#wasmProgressBar");
const runtimeLog = document.querySelector("#runtimeLog");

const ffmpegModuleUrl = "./vendor/ffmpeg/ffmpeg/dist/esm/index.js";
const ffmpegCoreBaseUrl = "./vendor/ffmpeg/core/dist/esm";

const LOCALE_DOMAINS = {
  uk: "co.uk", us: "com", ca: "ca", au: "com.au", de: "de",
  fr: "fr", it: "it", es: "es", jp: "co.jp", in: "in",
};

let library = [];
const jobs = new Map();
const inspections = new Map();
let wasmFfmpeg = null;
let wasmBusy = false;
let wasmCoreBlobUrl = "";
let activeConversionAsin = "";
let activeLoginId = "";
let activeLoginSession = null;
let activeLoginSignInUrl = "";
let activeLoginPopup = null;
let activeLoginPopupTimer = 0;
let transientSummaryActive = false;
let renderScheduled = false;
const wasmLogLines = [];
let wasmLogFlushScheduled = false;
const runtimeLogLines = [];
let runtimeLogFlushScheduled = false;
let librarySearch = "";
let librarySort = "recent";
const expandedAsins = new Set();
const downloadQueue = [];
let conversionRunning = false;
let wakeLockSentinel = null;
let beforeUnloadHandlerInstalled = false;
const trustedTypesPolicy = (typeof window !== "undefined" && window.trustedTypes?.createPolicy)
  ? window.trustedTypes.createPolicy("audible-app", { createHTML: (input) => input })
  : null;
let audibleIdentity = loadAudibleIdentity();

setCapabilityStatus();
renderLoginPanels();
renderLibrary();
log("App loaded.");
if (!handleReturnedLogin() && audibleIdentity) loadLibrary(false);

refreshLibraryButton.addEventListener("click", () => loadLibrary(true));
signOutButton.addEventListener("click", signOutAudible);
startLoginButton.addEventListener("click", startAudibleLogin);
reopenLoginButton.addEventListener("click", reopenSignInPopup);
cancelLoginButton.addEventListener("click", cancelAudibleLogin);
finishLoginButton.addEventListener("click", () => finishAudibleLogin());
loginResponseInput.addEventListener("paste", handleResponseInputPaste);
loginResponseInput.addEventListener("input", handleResponseInputChange);
document.addEventListener("visibilitychange", handleVisibilityChange);
window.addEventListener("storage", handleIdentityStorageEvent);
librarySearchInput?.addEventListener("input", handleSearchInput);
librarySortSelect?.addEventListener("change", handleSortChange);
exportCsvButton?.addEventListener("click", () => exportLibrary("csv"));
exportJsonButton?.addEventListener("click", () => exportLibrary("json"));
libraryEl.addEventListener("click", handleLibraryClick);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => log(`SW registration failed: ${err.message}`, "warn"));
}

function handleSearchInput(event) {
  librarySearch = String(event.target.value || "").toLowerCase().trim();
  scheduleRender();
}

function handleSortChange(event) {
  librarySort = String(event.target.value || "recent");
  scheduleRender();
}

function handleLibraryClick(event) {
  const card = event.target.closest(".book");
  if (!card) return;
  const asin = card.dataset.asin;
  if (!asin) return;
  if (event.target.closest(".download-primary")) {
    enqueueDownload(asin);
    return;
  }
  if (event.target.closest(".book-detail-toggle")) {
    if (expandedAsins.has(asin)) expandedAsins.delete(asin); else expandedAsins.add(asin);
    scheduleRender();
  }
}

function handleIdentityStorageEvent(event) {
  if (event.key !== "audible-downloader-identity") return;
  if (audibleIdentity) return;
  const fresh = loadAudibleIdentity();
  if (!fresh) return;
  audibleIdentity = fresh;
  closeLoginPopup();
  clearLoginSession();
  loginResponseInput.value = "";
  clearTransientSummary();
  log("Signed in via popup.");
  renderLoginPanels();
  loadLibrary(true);
}

function setCapabilityStatus() {
  if (!capabilityStatus) return;
  const ready = "Worker" in window
    && "DecompressionStream" in window
    && typeof navigator.storage?.getDirectory === "function";
  if (ready) {
    capabilityStatus.textContent = location.port === "5174" ? "Local dev" : "Ready";
    capabilityStatus.classList.add("ok");
    return;
  }
  capabilityStatus.textContent = "Use Chromium";
  capabilityStatus.classList.add("warn");
}

function renderLibrary() {
  const total = library.length;
  const visible = getVisibleLibrary();
  librarySummary.textContent = total
    ? visible.length === total
      ? `${total} title${total === 1 ? "" : "s"}`
      : `${visible.length} of ${total}`
    : audibleIdentity ? "Loading" : "Sign in required";

  setSafeHtml(libraryEl, "");

  if (!total) {
    setSafeHtml(libraryEl, `<div class="empty">${audibleIdentity ? "Loading your Audible library..." : "Sign in to show your Audible books."}</div>`);
    return;
  }
  if (!visible.length) {
    setSafeHtml(libraryEl, `<div class="empty">No titles match "${escapeHtml(librarySearch)}".</div>`);
    return;
  }

  for (const book of visible) {
    libraryEl.append(buildBookCard(book));
  }
}

/**
 * @param {object} book
 * @returns {HTMLElement}
 */
function buildBookCard(book) {
  const fragment = bookCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".book");
  card.dataset.asin = book.asin;

  const job = jobs.get(book.asin);
  const queued = downloadQueue.includes(book.asin) && !job?.running;
  const progress = Number.isFinite(job?.progress) ? Math.max(0, Math.min(100, job.progress)) : 0;
  const isBusy = Boolean(job?.running) || queued;

  const coverImage = card.querySelector(".cover-image");
  const coverInitials = card.querySelector(".cover-initials");
  if (book.imageUrl) {
    coverImage.src = book.imageUrl;
    coverImage.hidden = false;
    coverInitials.hidden = true;
  } else {
    coverImage.hidden = true;
    coverInitials.hidden = false;
    coverInitials.textContent = bookInitials(book);
  }

  card.querySelector(".book-title").textContent = book.subtitle
    ? `${book.title}: ${book.subtitle}`
    : book.title;
  card.querySelector(".book-meta").textContent =
    `${book.authors || "Unknown author"} · ${formatMinutes(book.lengthInMinutes)}`;

  const seriesMeta = card.querySelector(".book-series-meta");
  const primarySeries = book.series?.[0];
  if (primarySeries?.title) {
    seriesMeta.textContent = primarySeries.sequence
      ? `${primarySeries.title} · book ${primarySeries.sequence}`
      : primarySeries.title;
    seriesMeta.hidden = false;
  }

  const progressEl = card.querySelector(".book-progress");
  progressEl.classList.toggle("idle", !job);
  card.querySelector(".bar").style.width = `${progress}%`;
  const jobLine = card.querySelector(".job-line");
  if (queued && !job) {
    jobLine.textContent = "Queued";
  } else if (job) {
    jobLine.textContent = job.lastLine
      ? `${job.status} — ${job.lastLine}`
      : job.status;
  } else {
    jobLine.textContent = "Ready";
  }

  const errorEl = card.querySelector(".book-error");
  if (job?.error) {
    errorEl.textContent = job.error;
    errorEl.hidden = false;
  }

  const downloadButton = card.querySelector(".download-primary");
  downloadButton.disabled = isBusy;
  downloadButton.textContent = queued ? "Queued" : (job?.running ? "Working…" : "Download");

  const detailToggle = card.querySelector(".book-detail-toggle");
  const detailPanel = card.querySelector(".book-detail");
  const expanded = expandedAsins.has(book.asin);
  detailToggle.setAttribute("aria-expanded", String(expanded));
  detailPanel.hidden = !expanded;
  if (expanded) populateBookDetail(card, book);

  return card;
}

/**
 * @param {HTMLElement} card
 * @param {object} book
 */
function populateBookDetail(card, book) {
  card.querySelector(".book-synopsis").textContent = book.synopsis || "No synopsis available.";
  card.querySelector(".book-narrator").textContent = book.narrators || "—";
  card.querySelector(".book-length").textContent = formatMinutes(book.lengthInMinutes);
  card.querySelector(".book-series").textContent = book.series?.length
    ? book.series.map((s) => s.sequence ? `${s.title} (#${s.sequence})` : s.title).join("; ")
    : "—";
  card.querySelector(".book-release").textContent = formatDate(book.releaseDate);
  card.querySelector(".book-language").textContent = book.language || "—";
  card.querySelector(".book-publisher").textContent = book.publisher || "—";
}

function getVisibleLibrary() {
  let result = library;
  if (librarySearch) {
    result = result.filter((book) => {
      const hay = `${book.title} ${book.subtitle || ""} ${book.authors} ${book.narrators}`.toLowerCase();
      return hay.includes(librarySearch);
    });
  }
  const sorted = result.slice();
  sorted.sort(compareBooks);
  return sorted;
}

/**
 * @param {object} a
 * @param {object} b
 */
function compareBooks(a, b) {
  switch (librarySort) {
    case "title": return collator.compare(a.title, b.title);
    case "author": return collator.compare(a.authors || "", b.authors || "");
    case "length-asc": return (a.lengthInMinutes || 0) - (b.lengthInMinutes || 0);
    case "length-desc": return (b.lengthInMinutes || 0) - (a.lengthInMinutes || 0);
    case "series": {
      const sa = a.series?.[0];
      const sb = b.series?.[0];
      const seriesCmp = collator.compare(sa?.title || "~", sb?.title || "~");
      if (seriesCmp !== 0) return seriesCmp;
      return (Number(sa?.sequence) || 0) - (Number(sb?.sequence) || 0);
    }
    case "recent":
    default:
      return collator.compare(b.purchaseDate || b.releaseDate || "", a.purchaseDate || a.releaseDate || "");
  }
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * @param {Element} el
 * @param {string} html
 */
function setSafeHtml(el, html) {
  el.innerHTML = trustedTypesPolicy ? trustedTypesPolicy.createHTML(html) : html;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

async function loadLibrary(refresh) {
  refreshLibraryButton.disabled = true;
  setTransientSummary(refresh ? "Refreshing library" : "Loading library");

  if (!refresh && audibleIdentity?.amazonAccountId) {
    const cached = await loadCachedLibrary(audibleIdentity.amazonAccountId).catch(() => null);
    if (cached?.books?.length) {
      library = cached.books;
      renderLibrary();
      setTransientSummary("Updating from Audible");
    }
  }

  try {
    if (!audibleIdentity) throw new Error("No authenticated Audible account");
    const books = [];
    let total = 0;
    const maxPages = 100;
    for (let page = 1; page <= maxPages; page += 1) {
      const path = buildLibraryPath(page);
      const headers = await buildSignedAuthHeader("GET", path);
      const url = `/library?page=${page}${refresh && page === 1 ? "&refresh=1" : ""}`;
      const response = await fetchWithRetry(url, { cache: "no-store", headers }, { timeoutMs: 25000 });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(describeUpstreamError(payload, response.status));
      books.push(...(payload.books || []));
      total = Number(payload.total || 0);
      if (!payload.books?.length || payload.books.length < LIBRARY_PAGE_SIZE) break;
      if (total && books.length >= total) break;
      if (page === maxPages) console.warn("library pagination hit cap", { total, fetched: books.length });
    }
    library = books;
    if (audibleIdentity?.amazonAccountId) {
      saveCachedLibrary(audibleIdentity.amazonAccountId, books).catch(() => {});
    }
    clearTransientSummary();
    log(`Loaded ${library.length} library titles.`);
    preloadFfmpegCore();
    if (librarySearchInput && document.activeElement === document.body) {
      librarySearchInput.focus({ preventScroll: true });
    }
  } catch (error) {
    setTransientSummary(`Library load failed: ${error.message}`);
    log(`Library load failed: ${error.message}`, "error");
  } finally {
    refreshLibraryButton.disabled = false;
    renderLoginPanels();
    renderLibrary();
  }
}

const LIBRARY_DB = "audible-downloader";
const LIBRARY_STORE = "library-cache";

function openLibraryDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("IndexedDB unsupported")); return; }
    const req = indexedDB.open(LIBRARY_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(LIBRARY_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadCachedLibrary(accountId) {
  if (!accountId) return null;
  const db = await openLibraryDb().catch(() => null);
  if (!db) return null;
  try {
    return await new Promise((resolve) => {
      const tx = db.transaction(LIBRARY_STORE, "readonly");
      const req = tx.objectStore(LIBRARY_STORE).get(accountId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } finally { db.close(); }
}

async function saveCachedLibrary(accountId, books) {
  if (!accountId) return;
  const db = await openLibraryDb().catch(() => null);
  if (!db) return;
  try {
    await new Promise((resolve) => {
      const tx = db.transaction(LIBRARY_STORE, "readwrite");
      tx.objectStore(LIBRARY_STORE).put({ books, savedAt: Date.now() }, accountId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally { db.close(); }
}

async function clearCachedLibrary() {
  const db = await openLibraryDb().catch(() => null);
  if (!db) return;
  try {
    await new Promise((resolve) => {
      const tx = db.transaction(LIBRARY_STORE, "readwrite");
      tx.objectStore(LIBRARY_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally { db.close(); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch with exponential-backoff retry on 5xx + network failure, and an abort
 * timer for each attempt.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ tries?: number, timeoutMs?: number }} [config]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}, config = {}) {
  const tries = config.tries ?? 3;
  const timeoutMs = config.timeoutMs ?? 30000;
  let lastError;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (response.status >= 500 && response.status < 600 && attempt < tries - 1) {
        await sleep(2 ** attempt * 500 + Math.random() * 250);
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < tries - 1) {
        await sleep(2 ** attempt * 500 + Math.random() * 250);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function preloadFfmpegCore() {
  if (wasmFfmpeg?.loaded) return;
  loadWasmCore().catch((error) => log(`ffmpeg preload deferred: ${error.message}`, "warn"));
}

function enqueueDownload(asin) {
  if (!asin) return;
  if (downloadQueue.includes(asin)) return;
  const job = jobs.get(asin);
  if (job?.running) return;
  jobs.set(asin, { running: false, status: "Queued", lastLine: "", progress: 0, error: null });
  downloadQueue.push(asin);
  scheduleRender();
  void processDownloadQueue();
}

async function processDownloadQueue() {
  if (conversionRunning) return;
  while (downloadQueue.length > 0) {
    const next = downloadQueue.shift();
    if (!next) continue;
    conversionRunning = true;
    try {
      await startBrowserM4bConversion(next);
    } catch (error) {
      log(`Queue conversion failed for ${next}: ${error.message}`, "error");
    } finally {
      conversionRunning = false;
    }
  }
}

async function acquireWakeLock() {
  if (wakeLockSentinel || !navigator.wakeLock?.request) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => { wakeLockSentinel = null; });
  } catch (error) {
    log(`Wake Lock denied: ${error.message}`, "warn");
  }
}

function releaseWakeLock() {
  if (!wakeLockSentinel) return;
  wakeLockSentinel.release().catch(() => {});
  wakeLockSentinel = null;
}

function installBeforeUnloadGuard() {
  if (beforeUnloadHandlerInstalled) return;
  window.addEventListener("beforeunload", beforeUnloadHandler);
  beforeUnloadHandlerInstalled = true;
}

function removeBeforeUnloadGuard() {
  if (!beforeUnloadHandlerInstalled) return;
  window.removeEventListener("beforeunload", beforeUnloadHandler);
  beforeUnloadHandlerInstalled = false;
}

function beforeUnloadHandler(event) {
  if (!wasmBusy && downloadQueue.length === 0) return;
  event.preventDefault();
  event.returnValue = "";
}

function setBookError(asin, message) {
  const job = jobs.get(asin) || {};
  jobs.set(asin, { ...job, error: message });
  scheduleRender();
}

function clearBookError(asin) {
  const job = jobs.get(asin);
  if (!job?.error) return;
  jobs.set(asin, { ...job, error: null });
}

function renderLoginPanels() {
  const signedIn = Boolean(audibleIdentity);
  const waiting = Boolean(activeLoginId);
  loginStartPanel.classList.toggle("is-active", !signedIn && !waiting);
  loginWaitingPanel.classList.toggle("is-active", !signedIn && waiting);
  loginSignedInPanel.classList.toggle("is-active", signedIn);
  if (waiting) updateLoginStepsState();
  syncConnectSummary();
}

function syncConnectSummary() {
  if (transientSummaryActive) return;
  if (audibleIdentity) connectSummary.textContent = "Signed in";
  else if (activeLoginId) connectSummary.textContent = "Complete sign-in in the pop-up";
  else connectSummary.textContent = "Not signed in";
}

function setTransientSummary(text) {
  transientSummaryActive = true;
  connectSummary.textContent = text;
}

function clearTransientSummary() {
  transientSummaryActive = false;
  syncConnectSummary();
}

function updateLoginStepsState(stage = "amazon") {
  const order = ["popup", "amazon", "copy", "finish"];
  const currentIndex = order.indexOf(stage);
  loginWaitingPanel.querySelectorAll(".login-steps > li").forEach((li, index) => {
    li.classList.remove("step-done", "step-active");
    if (index < currentIndex) li.classList.add("step-done");
    else if (index === currentIndex) li.classList.add("step-active");
  });
}

async function startAudibleLogin() {
  const locale = (loginLocaleInput.value || "uk").trim().toLowerCase();
  startLoginButton.disabled = true;
  setTransientSummary("Starting sign-in");

  // Open popup synchronously to preserve the user-activation token; we'll
  // navigate it once the auth start endpoint returns the sign-in URL.
  const popup = window.open("about:blank", "audible-signin", "popup=1,width=520,height=760,left=120,top=80");

  try {
    const response = await fetch("/auth/login/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(describeUpstreamError(payload, response.status));
    if (payload.status === "authenticated") {
      if (popup && !popup.closed) popup.close();
      clearTransientSummary();
      renderLoginPanels();
      await loadLibrary(true);
      return;
    }
    if (!payload.signInUrl) throw new Error(payload.error || "Sign-in did not return a URL");

    activeLoginId = payload.id;
    activeLoginSession = payload.session;
    activeLoginSignInUrl = payload.signInUrl;
    persistLoginSession(payload);
    loginResponseInput.value = "";
    loginDomainHint.textContent = LOCALE_DOMAINS[locale] || "com";
    clearTransientSummary();
    renderLoginPanels();
    updateLoginStepsState("amazon");

    if (popup && !popup.closed) {
      popup.location.replace(payload.signInUrl);
      bindLoginPopup(popup);
    } else {
      setTransientSummary("Pop-up blocked - click Re-open Amazon sign-in");
    }
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    const detail = formatError(error);
    setTransientSummary(`Sign in failed: ${detail}`);
    log(`Audible sign in failed: ${detail}`, "error");
  } finally {
    startLoginButton.disabled = false;
  }
}

function bindLoginPopup(popup) {
  activeLoginPopup = popup;
  clearInterval(activeLoginPopupTimer);
  activeLoginPopupTimer = setInterval(() => {
    if (!activeLoginPopup || activeLoginPopup.closed) {
      clearInterval(activeLoginPopupTimer);
      activeLoginPopupTimer = 0;
      activeLoginPopup = null;
      if (activeLoginId) {
        updateLoginStepsState("finish");
        setTransientSummary("Pop-up closed - paste the URL or click Finish sign-in");
      }
    }
  }, 700);
}

function openSignInPopup() {
  if (!activeLoginSignInUrl) return;
  if (activeLoginPopup && !activeLoginPopup.closed) {
    activeLoginPopup.focus();
    return;
  }
  const popup = window.open(activeLoginSignInUrl, "audible-signin", "popup=1,width=520,height=760,left=120,top=80");
  if (!popup) {
    setTransientSummary("Pop-up blocked - re-open Amazon sign-in to allow it");
    return;
  }
  bindLoginPopup(popup);
}

function reopenSignInPopup() {
  if (!activeLoginSignInUrl) return;
  openSignInPopup();
  updateLoginStepsState("amazon");
}

function cancelAudibleLogin() {
  closeLoginPopup();
  clearLoginSession();
  loginResponseInput.value = "";
  setTransientSummary("Sign-in cancelled");
  renderLoginPanels();
}

function handleVisibilityChange() {
  if (document.visibilityState !== "visible" || !activeLoginId) return;
  updateLoginStepsState(activeLoginPopup && !activeLoginPopup.closed ? "copy" : "finish");
}

function handleResponseInputPaste(event) {
  const text = event.clipboardData?.getData("text") || "";
  if (isLoginCallbackUrl(text)) {
    event.preventDefault();
    loginResponseInput.value = text.trim();
    queueMicrotask(() => finishAudibleLogin(text.trim()));
  }
}

function handleResponseInputChange() {
  const value = loginResponseInput.value.trim();
  if (isLoginCallbackUrl(value)) finishAudibleLogin(value);
}

const AUDIBLE_HOST_RE = /^www\.audible\.(com|co\.uk|ca|com\.au|de|fr|it|es|co\.jp|in|com\.br)$/i;
function isLoginCallbackUrl(value, locale) {
  if (!value || typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    if (!url.searchParams.has("openid.oa2.authorization_code")) return false;
    if (url.origin === location.origin) return url.pathname === "/auth/callback/";
    if (!AUDIBLE_HOST_RE.test(url.hostname)) return false;
    if (locale && LOCALE_DOMAINS[locale] && url.hostname !== `www.audible.${LOCALE_DOMAINS[locale]}`) return false;
    return url.pathname === "/ap/maplanding";
  } catch {
    return false;
  }
}

async function readClipboardForLoginUrl() {
  if (!navigator.clipboard?.readText) return "";
  try {
    const text = await navigator.clipboard.readText();
    return isLoginCallbackUrl(text) ? text.trim() : "";
  } catch {
    return "";
  }
}

function handleReturnedLogin() {
  const params = new URLSearchParams(location.search);
  if (params.get("auth") !== "success") return false;

  history.replaceState(null, "", location.pathname);
  audibleIdentity = loadAudibleIdentity();
  if (!audibleIdentity) {
    setTransientSummary("Sign in failed");
    log("Returned from sign in but no Audible identity was saved.", "error");
    renderLoginPanels();
    return true;
  }
  clearTransientSummary();
  renderLoginPanels();
  loadLibrary(true);
  return true;
}

async function finishAudibleLogin(prefillUrl) {
  if (finishLoginButton.disabled) return;
  finishLoginButton.disabled = true;
  setTransientSummary("Completing sign-in");
  updateLoginStepsState("finish");

  try {
    let responseUrl = (typeof prefillUrl === "string" ? prefillUrl : "").trim()
      || loginResponseInput.value.trim()
      || await readClipboardForLoginUrl();
    if (!responseUrl) {
      setTransientSummary("Copy the URL from the Amazon tab, then click Finish sign-in");
      return;
    }
    if (!isLoginCallbackUrl(responseUrl, activeLoginSession?.locale)) throw new Error("That URL doesn't look like Amazon's sign-in result");
    if (!activeLoginId) throw new Error("Sign-in session expired - start over");

    const response = await fetch("/auth/login/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: activeLoginId, responseUrl, session: activeLoginSession }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status !== "authenticated") {
      throw new Error(describeUpstreamError(payload, response.status));
    }

    if (payload.identity) {
      audibleIdentity = payload.identity;
      saveAudibleIdentity(audibleIdentity);
    }
    closeLoginPopup();
    clearLoginSession();
    loginResponseInput.value = "";
    clearTransientSummary();
    log("Audible sign in completed.");
    renderLoginPanels();
    await loadLibrary(true);
  } catch (error) {
    const detail = formatError(error);
    setTransientSummary(`Sign in failed: ${detail}`);
    log(`Could not finish Audible sign in: ${detail}`, "error");
  } finally {
    finishLoginButton.disabled = false;
  }
}

function closeLoginPopup() {
  if (activeLoginPopup && !activeLoginPopup.closed) {
    try { activeLoginPopup.close(); } catch {}
  }
  activeLoginPopup = null;
  clearInterval(activeLoginPopupTimer);
  activeLoginPopupTimer = 0;
}

function clearLoginSession() {
  activeLoginId = "";
  activeLoginSession = null;
  activeLoginSignInUrl = "";
  sessionStorage.removeItem("audible-downloader-login");
  localStorage.removeItem("audible-downloader-login");
}

function signOutAudible() {
  audibleIdentity = null;
  localStorage.removeItem("audible-downloader-identity");
  library = [];
  jobs.clear();
  inspections.clear();
  downloadQueue.length = 0;
  expandedAsins.clear();
  librarySearch = "";
  if (librarySearchInput) librarySearchInput.value = "";
  clearTransientSummary();
  void clearCachedLibrary();
  renderLoginPanels();
  renderLibrary();
  log("Signed out of Audible.");
}

async function startBrowserM4bConversion(asin) {
  const book = library.find((candidate) => candidate.asin === asin);
  if (!book) return;

  const inputName = `source-${asin}.aax`;
  const outputName = `converted-${asin}.m4b`;
  const mountPoint = "/in";
  const suggestedName = `${safeFileName(book.title)} [${asin}].m4b`;

  // The browser's user-activation token only lasts a few seconds, so we must
  // call showSaveFilePicker while it is still valid. The conversion can take
  // many minutes, well past the activation window.
  let saveHandle = null;
  if ("showSaveFilePicker" in window) {
    try {
      saveHandle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "M4B audiobook", accept: { "audio/mp4": [".m4b", ".m4a", ".mp4"] } }],
      });
    } catch (error) {
      if (error?.name === "AbortError") return;
      log(`Save dialog failed: ${formatError(error)}`, "error");
      return;
    }
  }

  let mounted = false;
  wasmBusy = true;
  clearBookError(asin);
  installBeforeUnloadGuard();
  void acquireWakeLock();
  setWasmProgress(0);
  setJob(asin, "Preparing", "Loading converter", 1);
  appendWasmLog(`Starting browser M4B flow for ${book.title}.`);
  wasmStatus.textContent = "Preparing";
  renderLibrary();

  try {
    let inspection = inspections.get(asin);
    if (!inspection?.proxyUrl || !getAaxcKey(inspection)) {
      setJob(asin, "Authorising", "Requesting Audible licence", 3);
      wasmStatus.textContent = "Authorising";
      setWasmProgress(3);
      renderLibrary();
      inspection = await fetchLicense(asin);
      inspections.set(asin, inspection);
    }

    const key = getAaxcKey(inspection);
    if (!inspection.proxyUrl || !key) throw new Error("License did not include proxy URL and AAXC key material.");

    if (!wasmFfmpeg?.loaded) await loadWasmCore();
    if (!wasmFfmpeg?.loaded) throw new Error("ffmpeg.wasm did not load.");

    appendWasmLog(`Streaming encrypted source for ${book.title} (${formatBytes(inspection.size || 0)}).`);
    setJob(asin, "Downloading", "0%", 5);
    renderLibrary();
    const sourceFile = await downloadSourceToOpfs(inspection.proxyUrl, inputName, inspection.size || 0, (received, total) => {
      const pct = total ? Math.min(45, 5 + (received / total) * 40) : 8;
      const status = total ? `Fetching ${Math.round((received / total) * 100)}%` : `Fetching ${formatBytes(received)}`;
      wasmStatus.textContent = status;
      setWasmProgress(pct);
      setJob(asin, "Downloading", total ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received), pct);
      scheduleRender();
    });

    appendWasmLog(`Mounting source as WORKERFS (${formatBytes(sourceFile.size)}).`);
    setJob(asin, "Preparing", formatBytes(sourceFile.size), 48);
    wasmStatus.textContent = "Preparing conversion";
    setWasmProgress(48);
    renderLibrary();
    await wasmFfmpeg.createDir(mountPoint).catch(() => {});
    await wasmFfmpeg.mount("WORKERFS", { files: [sourceFile] }, mountPoint);
    mounted = true;

    appendWasmLog("Converting fetched source to M4B in browser.");
    wasmStatus.textContent = "Converting";
    setWasmProgress(50);
    setJob(asin, "Converting", "Building M4B", 50);
    renderLibrary();
    activeConversionAsin = asin;
    const exitCode = await wasmFfmpeg.exec([
      "-audible_key", key.audibleKey,
      "-audible_iv", key.audibleIv,
      "-i", `${mountPoint}/${inputName}`,
      "-map", "0:a:0",
      "-map_chapters", "0",
      "-c", "copy",
      outputName,
    ]);
    if (exitCode !== 0) throw new Error(`ffmpeg exited ${exitCode}`);

    appendWasmLog("Conversion complete. Saving output file.");
    wasmStatus.textContent = "Ready to save";
    setWasmProgress(96);
    setJob(asin, "Ready to save", "Saving M4B", 96);
    renderLibrary();
    const outputBytes = await wasmFfmpeg.readFile(outputName);
    const outputSize = outputBytes.byteLength;
    if (saveHandle) {
      const writable = await saveHandle.createWritable();
      await writable.write(outputBytes);
      await writable.close();
    } else {
      const blob = new Blob([outputBytes], { type: "audio/mp4" });
      saveBlobViaAnchor(blob, suggestedName);
    }
    appendWasmLog(`Downloaded and converted ${book.title}: ${formatBytes(outputSize)} M4B.`);
    wasmStatus.textContent = "Converted";
    setWasmProgress(100);
    setJob(asin, "Downloaded", formatBytes(outputSize), 100, false);
    log(`Browser M4B conversion finished for ${book.title} (${asin}).`);
  } catch (error) {
    wasmStatus.textContent = "Convert failed";
    setWasmProgress(0);
    const detail = formatError(error);
    appendWasmLog(`Convert failed: ${detail}`);
    setJob(asin, "Failed", detail, 0, false);
    setBookError(asin, detail);
    log(`Browser M4B conversion failed for ${asin}: ${detail}`, "error");
  } finally {
    if (mounted) await wasmFfmpeg?.unmount?.(mountPoint).catch(() => {});
    await wasmFfmpeg?.deleteFile?.(outputName).catch(() => {});
    await deleteOpfsFile(inputName);
    if (activeConversionAsin === asin) activeConversionAsin = "";
    wasmBusy = false;
    if (downloadQueue.length === 0) {
      releaseWakeLock();
      removeBeforeUnloadGuard();
    }
    renderLibrary();
  }
}

function setJob(asin, status, lastLine, progress, running = true) {
  const existing = jobs.get(asin) || {};
  jobs.set(asin, { running, status, lastLine, progress, error: running ? null : existing.error || null });
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderLibrary();
  });
}

async function fetchLicense(asin) {
  const licensePath = buildLicensePath(asin);
  const licenseBody = JSON.stringify(buildLicenseRequestBody());
  const headers = await buildSignedAuthHeader("POST", licensePath, licenseBody);
  const response = await fetchWithRetry(`/license/${encodeURIComponent(asin)}`, { cache: "no-store", headers }, { timeoutMs: 25000 });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(describeUpstreamError(payload, response.status));
  return payload;
}

function describeUpstreamError(payload, status) {
  const parts = [];
  if (payload?.stage) parts.push(payload.stage);
  if (payload?.status) parts.push(`HTTP ${payload.status}`);
  else if (status) parts.push(`HTTP ${status}`);
  if (payload?.path) parts.push(payload.path);
  const detail = payload?.detail;
  if (detail) {
    const text = typeof detail === "string" ? detail : detail?.message || detail?.error || JSON.stringify(detail).slice(0, 240);
    if (text) parts.push(text);
  } else if (payload?.error) {
    parts.push(payload.error);
  }
  return parts.join(" - ") || `HTTP ${status || "error"}`;
}

async function loadWasmCore() {
  if (wasmFfmpeg?.loaded) return;
  wasmStatus.textContent = "Loading core";
  appendWasmLog("Loading vendored ffmpeg.wasm core.");

  try {
    const { FFmpeg } = await import(ffmpegModuleUrl);
    wasmFfmpeg = new FFmpeg();
    wasmFfmpeg.on("log", ({ message }) => appendWasmLog(sanitizeRuntimeLine(message)));
    wasmFfmpeg.on("progress", ({ progress, time }) => {
      if (!Number.isFinite(progress)) return;
      const percent = `${Math.round(progress * 100)}%`;
      wasmStatus.textContent = time ? `${percent} (${formatDurationMicros(time)})` : percent;
      const mapped = Math.min(95, Math.max(50, 50 + progress * 45));
      setWasmProgress(mapped);
      if (activeConversionAsin) {
        const current = jobs.get(activeConversionAsin);
        if (current?.running) {
          jobs.set(activeConversionAsin, {
            ...current,
            progress: mapped,
            lastLine: time ? formatDurationMicros(time) : percent,
          });
          scheduleRender();
        }
      }
    });

    const coreURL = new URL(`${ffmpegCoreBaseUrl}/ffmpeg-core.js`, location.href).href;
    const wasmURL = await getWasmCoreUrl();
    await wasmFfmpeg.load({ coreURL, wasmURL });
    wasmFfmpeg.loaded = true;
    wasmStatus.textContent = "Loaded";
    appendWasmLog("ffmpeg.wasm loaded.");
  } catch (error) {
    wasmStatus.textContent = "Load failed";
    const detail = formatError(error);
    appendWasmLog(`Load failed: ${detail}`);
    log(`ffmpeg.wasm load failed: ${detail}`, "error");
    throw error;
  }
}

async function getWasmCoreUrl() {
  if (wasmCoreBlobUrl) return wasmCoreBlobUrl;

  const sourceUrl = new URL(`${ffmpegCoreBaseUrl}/ffmpeg-core.wasm.gz`, location.href).href;
  appendWasmLog("Fetching compressed ffmpeg.wasm core.");
  const response = await fetch(sourceUrl, { cache: "force-cache" });
  if (!response.ok) throw new Error(`ffmpeg core HTTP ${response.status}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const wasmBytes = isGzip ? await decompressGzip(bytes) : bytes;
  if (!(wasmBytes[0] === 0x00 && wasmBytes[1] === 0x61 && wasmBytes[2] === 0x73 && wasmBytes[3] === 0x6d)) {
    throw new Error("ffmpeg core did not decode to a valid WebAssembly module.");
  }
  wasmCoreBlobUrl = URL.createObjectURL(new Blob([wasmBytes], { type: "application/wasm" }));
  appendWasmLog(`Decoded ffmpeg.wasm core (${formatBytes(wasmBytes.byteLength)}).`);
  return wasmCoreBlobUrl;
}

async function decompressGzip(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("This browser cannot decompress the hosted ffmpeg core. Use current Chromium.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function saveBlobViaAnchor(blob, suggestedName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function getAaxcKey(license) {
  const keyRecord = license?.decryptionKeys?.[0] || license?.DecryptionKeys?.[0] || {};
  const audibleKey = keyRecord.keyPart1 || keyRecord.KeyPart1;
  const audibleIv = keyRecord.keyPart2 || keyRecord.KeyPart2;
  if (!audibleKey || !audibleIv) return null;
  return { audibleKey, audibleIv };
}

async function downloadSourceToOpfs(proxyUrl, name, expectedSize, onProgress) {
  if (!navigator.storage?.getDirectory) {
    throw new Error("Browser lacks OPFS support. Use a current Chromium build.");
  }
  const dir = await navigator.storage.getDirectory();

  const existing = await dir.getFileHandle(name, { create: false }).catch(() => null);
  if (existing) {
    const cached = await existing.getFile();
    if (expectedSize > 0 && cached.size === expectedSize) {
      onProgress?.(cached.size, expectedSize);
      return cached;
    }
    await dir.removeEntry(name).catch(() => {});
  }

  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    const response = await fetchWithRetry(proxyUrl, { cache: "no-store" }, { timeoutMs: 180000 });
    if (!response.ok) throw new Error(`source fetch HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length")) || expectedSize || 0;
    const reader = response.body.getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      received += value.byteLength;
      onProgress?.(received, total);
    }
  } finally {
    await writable.close();
  }
  return handle.getFile();
}

async function deleteOpfsFile(name) {
  if (!navigator.storage?.getDirectory) return;
  try {
    const dir = await navigator.storage.getDirectory();
    await dir.removeEntry(name);
  } catch {}
}

function appendWasmLog(message) {
  if (!message || !wasmLog) return;
  wasmLogLines.unshift(`[${new Date().toLocaleTimeString("en-GB")}] ${message}`);
  if (wasmLogLines.length > 80) wasmLogLines.length = 80;
  if (wasmLogFlushScheduled) return;
  wasmLogFlushScheduled = true;
  requestAnimationFrame(() => {
    wasmLogFlushScheduled = false;
    wasmLog.textContent = wasmLogLines.join("\n");
  });
}

function setWasmProgress(percent) {
  if (!wasmProgressBar) return;
  wasmProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function loadAudibleIdentity() {
  try {
    const raw = JSON.parse(localStorage.getItem("audible-downloader-identity") || "null");
    if (!raw) return null;
    const minimal = pickIdentityFields(raw);
    if (!minimal.adpToken || !minimal.privateKey) return null;
    if (raw.accessToken || raw.refreshToken || raw.accessTokenExpiresAt) {
      localStorage.setItem("audible-downloader-identity", JSON.stringify(minimal));
    }
    return minimal;
  } catch {
    return null;
  }
}

function saveAudibleIdentity(identity) {
  localStorage.setItem("audible-downloader-identity", JSON.stringify(pickIdentityFields(identity)));
}

function pickIdentityFields(identity) {
  return {
    locale: identity.locale,
    adpToken: identity.adpToken,
    privateKey: identity.privateKey,
    deviceType: identity.deviceType,
    deviceSerialNumber: identity.deviceSerialNumber,
    deviceName: identity.deviceName,
    amazonAccountId: identity.amazonAccountId,
  };
}

function persistLoginSession(login) {
  const payload = JSON.stringify({ id: login.id, session: login.session, createdAt: Date.now() });
  sessionStorage.setItem("audible-downloader-login", payload);
  localStorage.setItem("audible-downloader-login", payload);
}

async function buildSignedAuthHeader(method, path, body = "") {
  if (!audibleIdentity?.privateKey || !audibleIdentity?.adpToken) {
    throw new Error("Not signed in");
  }
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const signature = await signRsaPkcs1(
    audibleIdentity.privateKey,
    `${method}\n${path}\n${date}\n${body}\n${audibleIdentity.adpToken}`,
  );
  const auth = {
    adpToken: audibleIdentity.adpToken,
    signature,
    date,
    locale: audibleIdentity.locale,
    deviceType: audibleIdentity.deviceType,
    deviceSerialNumber: audibleIdentity.deviceSerialNumber,
    amazonAccountId: audibleIdentity.amazonAccountId,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(auth));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { "x-audible-auth": btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "") };
}

function log(message, level = "info") {
  if (!runtimeLog) return;
  runtimeLogLines.unshift(`[${new Date().toLocaleTimeString("en-GB")}] ${level.toUpperCase()} ${message}`);
  if (runtimeLogLines.length > 60) runtimeLogLines.length = 60;
  if (runtimeLogFlushScheduled) return;
  runtimeLogFlushScheduled = true;
  requestAnimationFrame(() => {
    runtimeLogFlushScheduled = false;
    runtimeLog.textContent = runtimeLogLines.join("\n");
  });
}

const RUNTIME_LINE_SUPPRESS_RE = new RegExp([
  "^(ffmpeg version|built with|configuration:|libav|libsw|libpostproc)",
  "^(Input #|Output #|Metadata:|Chapters:|Chapter #|Stream #|Stream mapping:|Press \\[q\\]|size=)",
  "^(major_brand|minor_version|compatible_brands|creation_time|title|artist|album|album_artist|genre|comment|copyright|date|encoder|handler_name|vendor_id)",
  "stream 0, timescale not set",
  "video:0kB audio:\\d+kB subtitle:0kB other streams:0kB",
].join("|"), "i");
const RUNTIME_LINE_KEEP_RE = /(error|failed|invalid|unsupported|unable|not found|warning)/i;

function sanitizeRuntimeLine(value) {
  const line = String(value || "")
    .replace(/https:\/\/[^\s']+/g, "[signed-url]")
    .replace(/[0-9a-f]{32}/gi, "[hex32]")
    .trim();
  if (!line || line === "Aborted()") return "";
  if (RUNTIME_LINE_SUPPRESS_RE.test(line)) return "";
  return RUNTIME_LINE_KEEP_RE.test(line) ? line : "";
}

function formatError(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function formatDurationMicros(value) {
  const seconds = Math.max(0, Math.floor(value / 1_000_000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

const WIN_RESERVED_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
function safeFileName(value) {
  let name = String(value || "audiobook")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 160) || "audiobook";
  if (WIN_RESERVED_RE.test(name)) name = `_${name}`;
  return name;
}

function bookInitials(book) {
  return String(book.title || "AB")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "AB";
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

function formatMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "unknown length";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return `${hours} hr ${remainder} min`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Export current library list as CSV or JSON.
 * @param {"csv" | "json"} format
 */
function exportLibrary(format) {
  if (!library.length) return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const filename = `audible-library-${stamp}.${format}`;
  let blob;
  if (format === "json") {
    blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), books: library }, null, 2)], { type: "application/json" });
  } else {
    const headers = ["asin", "title", "subtitle", "authors", "narrators", "lengthInMinutes", "language", "publisher", "releaseDate", "series"];
    const rows = library.map((book) => headers.map((key) => {
      const value = key === "series"
        ? (book.series || []).map((s) => s.sequence ? `${s.title} #${s.sequence}` : s.title).join(" | ")
        : book[key] ?? "";
      return `"${String(value).replace(/"/g, '""')}"`;
    }).join(","));
    blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv" });
  }
  saveBlobViaAnchor(blob, filename);
}
