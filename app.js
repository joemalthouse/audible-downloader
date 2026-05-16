const libraryEl = document.querySelector("#library");
const librarySummary = document.querySelector("#librarySummary");
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

function setCapabilityStatus() {
  if (!capabilityStatus) return;
  if ("Worker" in window && "DecompressionStream" in window) {
    capabilityStatus.textContent = location.port === "5174" ? "Local dev" : "Ready";
    capabilityStatus.classList.add("ok");
    return;
  }
  capabilityStatus.textContent = "Use Chromium";
  capabilityStatus.classList.add("warn");
}

function renderLibrary() {
  const total = library.length;
  librarySummary.textContent = total
    ? `${total} title${total === 1 ? "" : "s"}`
    : audibleIdentity ? "Loading" : "Sign in required";
  libraryEl.innerHTML = "";

  if (!total) {
    libraryEl.innerHTML = `<div class="empty">${audibleIdentity ? "Loading your Audible library..." : "Sign in to show your Audible books."}</div>`;
    return;
  }

  for (const book of library) {
    const job = jobs.get(book.asin);
    const progress = Number.isFinite(job?.progress) ? Math.max(0, Math.min(100, job.progress)) : 0;
    const isBusy = job?.running || wasmBusy;
    const row = document.createElement("article");
    row.className = "book";
    row.innerHTML = `
      <div class="book-main">
        <div class="cover">
          ${book.imageUrl ? `<img src="${escapeHtml(book.imageUrl)}" alt="" loading="lazy" />` : `<span>${escapeHtml(bookInitials(book))}</span>`}
        </div>
        <div class="book-copy">
          <h3>${escapeHtml(book.title)}${book.subtitle ? `: ${escapeHtml(book.subtitle)}` : ""}</h3>
          <div class="meta">${escapeHtml(book.authors || "Unknown author")} - ${formatMinutes(book.lengthInMinutes)}</div>
          <div class="book-progress ${job ? "" : "idle"}">
            <div class="progress"><div class="bar" style="width: ${progress}%"></div></div>
            <div class="job-line">${job ? `${escapeHtml(job.status)}${job.lastLine ? ` - ${escapeHtml(job.lastLine)}` : ""}` : "Ready"}</div>
          </div>
        </div>
      </div>
      <div class="book-actions">
        <button type="button" class="download-primary" data-asin="${escapeHtml(book.asin)}" ${isBusy ? "disabled" : ""}>Download</button>
      </div>
    `;
    libraryEl.append(row);
  }

  libraryEl.querySelectorAll(".download-primary").forEach((button) => {
    button.addEventListener("click", () => startBrowserM4bConversion(button.dataset.asin));
  });
}

async function loadLibrary(refresh) {
  refreshLibraryButton.disabled = true;
  connectSummary.textContent = "Checking session";

  try {
    const accountStatus = await fetchAccountStatus();
    if (!accountStatus.accounts.some((account) => account.authenticated)) {
      throw new Error("No authenticated Audible account found");
    }

    const response = await fetch(`/library${refresh ? "?refresh=1" : ""}`, {
      cache: "no-store",
      headers: audibleAuthHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = describeUpstreamError(payload, response.status);
      connectSummary.textContent = `Library load failed: ${detail}`;
      throw new Error(detail);
    }

    library = payload.books || [];
    connectSummary.textContent = "Signed in";
    log(`Loaded ${library.length} library titles.`);
  } catch (error) {
    log(`Library load failed: ${error.message}`, "error");
  } finally {
    refreshLibraryButton.disabled = false;
    renderLoginPanels();
    renderLibrary();
  }
}

async function fetchAccountStatus() {
  const response = await fetch("/auth/accounts", { cache: "no-store", headers: audibleAuthHeaders() });
  if (!response.ok) throw new Error(`account status HTTP ${response.status}`);
  return response.json();
}

function renderLoginPanels() {
  const signedIn = Boolean(audibleIdentity);
  const waiting = Boolean(activeLoginId);
  loginStartPanel.classList.toggle("is-active", !signedIn && !waiting);
  loginWaitingPanel.classList.toggle("is-active", !signedIn && waiting);
  loginSignedInPanel.classList.toggle("is-active", signedIn);
  if (waiting) updateLoginStepsState();
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
  connectSummary.textContent = "Starting sign-in";

  try {
    const response = await fetch("/auth/login/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(describeUpstreamError(payload, response.status));
    if (payload.status === "authenticated") {
      connectSummary.textContent = "Signed in";
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
    renderLoginPanels();
    updateLoginStepsState("amazon");
    connectSummary.textContent = "Complete sign-in in the pop-up";
    openSignInPopup();
  } catch (error) {
    const detail = formatError(error);
    connectSummary.textContent = `Sign in failed: ${detail}`;
    log(`Audible sign in failed: ${detail}`, "error");
  } finally {
    startLoginButton.disabled = false;
  }
}

function openSignInPopup() {
  if (!activeLoginSignInUrl) return;
  if (activeLoginPopup && !activeLoginPopup.closed) {
    activeLoginPopup.focus();
    return;
  }
  activeLoginPopup = window.open(activeLoginSignInUrl, "audible-signin", "popup=1,width=520,height=760,left=120,top=80");
  if (!activeLoginPopup) {
    connectSummary.textContent = "Pop-up blocked - re-open Amazon sign-in to allow it";
    return;
  }
  clearInterval(activeLoginPopupTimer);
  activeLoginPopupTimer = setInterval(() => {
    if (!activeLoginPopup || activeLoginPopup.closed) {
      clearInterval(activeLoginPopupTimer);
      activeLoginPopupTimer = 0;
      activeLoginPopup = null;
      if (activeLoginId) {
        updateLoginStepsState("finish");
        connectSummary.textContent = "Pop-up closed - paste the URL or click Finish sign-in";
      }
    }
  }, 700);
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
  connectSummary.textContent = "Sign-in cancelled";
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

function isLoginCallbackUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    return /maplanding/i.test(url.pathname) && url.searchParams.has("openid.oa2.authorization_code");
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
    connectSummary.textContent = "Sign in failed";
    log("Returned from sign in but no Audible identity was saved.", "error");
    renderLoginPanels();
    return true;
  }
  connectSummary.textContent = "Signed in";
  renderLoginPanels();
  loadLibrary(true);
  return true;
}

async function finishAudibleLogin(prefillUrl) {
  if (finishLoginButton.disabled) return;
  finishLoginButton.disabled = true;
  connectSummary.textContent = "Completing sign-in";
  updateLoginStepsState("finish");

  try {
    let responseUrl = (typeof prefillUrl === "string" ? prefillUrl : "").trim()
      || loginResponseInput.value.trim()
      || await readClipboardForLoginUrl();
    if (!responseUrl) {
      connectSummary.textContent = "Copy the URL from the Amazon tab, then click Finish sign-in";
      return;
    }
    if (!isLoginCallbackUrl(responseUrl)) throw new Error("That URL doesn't look like Amazon's sign-in result");
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
    connectSummary.textContent = "Signed in";
    log("Audible sign in completed.");
    renderLoginPanels();
    await loadLibrary(true);
  } catch (error) {
    const detail = formatError(error);
    connectSummary.textContent = `Sign in failed: ${detail}`;
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
  connectSummary.textContent = "Not signed in";
  renderLoginPanels();
  renderLibrary();
  log("Signed out of Audible.");
}

async function startBrowserM4bConversion(asin) {
  const book = library.find((candidate) => candidate.asin === asin);
  if (!book) return;

  const inputName = `source-${asin}.aax`;
  const outputName = `converted-${asin}.m4b`;
  wasmBusy = true;
  setWasmProgress(0);
  setJob(asin, "Preparing", "Loading converter", 1);
  appendWasmLog(`Starting browser M4B flow for ${book.title}.`);
  wasmStatus.textContent = "Preparing";
  renderLibrary();

  try {
    let inspection = inspections.get(asin);
    if (!inspection?.offlineUrl || !getAaxcKey(inspection)) {
      setJob(asin, "Authorising", "Requesting Audible licence", 3);
      wasmStatus.textContent = "Authorising";
      setWasmProgress(3);
      renderLibrary();
      inspection = await fetchLicense(asin);
      inspections.set(asin, inspection);
    }

    const key = getAaxcKey(inspection);
    if (!inspection.offlineUrl || !key) throw new Error("License did not include source URL and AAXC key material.");

    if (!wasmFfmpeg?.loaded) await loadWasmCore();
    if (!wasmFfmpeg?.loaded) throw new Error("ffmpeg.wasm did not load.");

    const proxiedUrl = `/source?url=${encodeURIComponent(inspection.offlineUrl)}`;
    appendWasmLog(`Fetching encrypted source for ${book.title} (${formatBytes(inspection.size || 0)}).`);
    setJob(asin, "Downloading", "0%", 5);
    renderLibrary();
    const sourceBytes = await fetchArrayBufferWithProgress(proxiedUrl, inspection.size || 0, (received, total) => {
      const pct = total ? Math.min(45, 5 + (received / total) * 40) : 8;
      const status = total ? `Fetching ${Math.round((received / total) * 100)}%` : `Fetching ${formatBytes(received)}`;
      wasmStatus.textContent = status;
      setWasmProgress(pct);
      setJob(asin, "Downloading", total ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received), pct);
      renderLibrary();
    });

    appendWasmLog(`Writing encrypted source into WASM FS (${formatBytes(sourceBytes.byteLength)}).`);
    setJob(asin, "Preparing", formatBytes(sourceBytes.byteLength), 48);
    wasmStatus.textContent = "Preparing conversion";
    setWasmProgress(48);
    renderLibrary();
    await wasmFfmpeg.writeFile(inputName, new Uint8Array(sourceBytes));

    appendWasmLog("Converting fetched source to M4B in browser.");
    wasmStatus.textContent = "Converting";
    setWasmProgress(50);
    setJob(asin, "Converting", "Building M4B", 50);
    renderLibrary();
    activeConversionAsin = asin;
    const exitCode = await wasmFfmpeg.exec([
      "-audible_key", key.audibleKey,
      "-audible_iv", key.audibleIv,
      "-i", inputName,
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
    const blob = new Blob([outputBytes], { type: "audio/mp4" });
    await saveBlob(blob, `${safeFileName(book.title)} [${asin}].m4b`);
    appendWasmLog(`Downloaded and converted ${book.title}: ${formatBytes(blob.size)} M4B.`);
    wasmStatus.textContent = "Converted";
    setWasmProgress(100);
    setJob(asin, "Downloaded", formatBytes(blob.size), 100, false);
    log(`Browser M4B conversion finished for ${book.title} (${asin}).`);
  } catch (error) {
    wasmStatus.textContent = "Convert failed";
    setWasmProgress(0);
    const detail = formatError(error);
    appendWasmLog(`Convert failed: ${detail}`);
    setJob(asin, "Failed", detail, 0, false);
    log(`Browser M4B conversion failed for ${asin}: ${detail}`, "error");
  } finally {
    await wasmFfmpeg?.deleteFile(inputName).catch(() => {});
    await wasmFfmpeg?.deleteFile(outputName).catch(() => {});
    if (activeConversionAsin === asin) activeConversionAsin = "";
    wasmBusy = false;
    renderLibrary();
  }
}

function setJob(asin, status, lastLine, progress, running = true) {
  jobs.set(asin, { running, status, lastLine, progress });
}

async function fetchLicense(asin) {
  const response = await fetch(`/license/${encodeURIComponent(asin)}`, { cache: "no-store", headers: audibleAuthHeaders() });
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
          renderLibrary();
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

async function saveBlob(blob, suggestedName) {
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "M4B audiobook", accept: { "audio/mp4": [".m4b", ".m4a", ".mp4"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      if (error?.name !== "AbortError") throw error;
      return;
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getAaxcKey(license) {
  const keyRecord = license?.decryptionKeys?.[0] || license?.DecryptionKeys?.[0] || {};
  const audibleKey = keyRecord.keyPart1 || keyRecord.KeyPart1;
  const audibleIv = keyRecord.keyPart2 || keyRecord.KeyPart2;
  if (!audibleKey || !audibleIv) return null;
  return { audibleKey, audibleIv };
}

async function fetchArrayBufferWithProgress(url, expectedBytes, onProgress) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`source fetch HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length")) || expectedBytes || 0;
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength, contentLength || buffer.byteLength);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.(received, contentLength);
  }

  const output = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

function appendWasmLog(message) {
  if (!message || !wasmLog) return;
  const line = `[${new Date().toLocaleTimeString("en-GB")}] ${message}`;
  wasmLog.textContent = `${line}\n${wasmLog.textContent}`.slice(0, 8000);
}

function setWasmProgress(percent) {
  if (!wasmProgressBar) return;
  wasmProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function loadAudibleIdentity() {
  try {
    return JSON.parse(localStorage.getItem("audible-downloader-identity") || "null");
  } catch {
    return null;
  }
}

function saveAudibleIdentity(identity) {
  localStorage.setItem("audible-downloader-identity", JSON.stringify(identity));
}

function persistLoginSession(login) {
  const payload = JSON.stringify({ id: login.id, session: login.session, createdAt: Date.now() });
  sessionStorage.setItem("audible-downloader-login", payload);
  localStorage.setItem("audible-downloader-login", payload);
}

function audibleAuthHeaders() {
  if (!audibleIdentity) return {};
  const lean = {
    locale: audibleIdentity.locale,
    accessToken: audibleIdentity.accessToken,
    accessTokenExpiresAt: audibleIdentity.accessTokenExpiresAt,
    refreshToken: audibleIdentity.refreshToken,
    adpToken: audibleIdentity.adpToken,
    privateKey: audibleIdentity.privateKey,
    deviceType: audibleIdentity.deviceType,
    deviceSerialNumber: audibleIdentity.deviceSerialNumber,
    deviceName: audibleIdentity.deviceName,
    amazonAccountId: audibleIdentity.amazonAccountId,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(lean));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { "x-audible-auth": btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "") };
}

function log(message, level = "info") {
  if (!runtimeLog) return;
  const line = `[${new Date().toLocaleTimeString("en-GB")}] ${level.toUpperCase()} ${message}`;
  runtimeLog.textContent = `${line}\n${runtimeLog.textContent}`.slice(0, 6000);
}

function sanitizeRuntimeLine(value) {
  const line = String(value || "")
    .replace(/https:\/\/[^\s']+/g, "[signed-url]")
    .replace(/[0-9a-f]{32}/gi, "[hex32]")
    .trim();
  if (!line || line === "Aborted()") return "";
  if (/^(ffmpeg version|built with|configuration:|libav|libsw|libpostproc)/i.test(line)) return "";
  if (/^(Input #|Output #|Metadata:|Chapters:|Chapter #|Stream #|Stream mapping:|Press \[q\]|size=)/.test(line)) return "";
  if (/^(major_brand|minor_version|compatible_brands|creation_time|title|artist|album|album_artist|genre|comment|copyright|date|encoder|handler_name|vendor_id)/.test(line)) return "";
  if (/stream 0, timescale not set/i.test(line)) return "";
  if (/video:0kB audio:\d+kB subtitle:0kB other streams:0kB/i.test(line)) return "";
  if (/(error|failed|invalid|unsupported|unable|not found|warning)/i.test(line)) return line;
  return "";
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

function safeFileName(value) {
  return String(value || "audiobook")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "audiobook";
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
