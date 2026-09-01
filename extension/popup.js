// popup.js
//
// The popup is now a lightweight launcher, not the chatbot itself. It:
//   1. Shows whether the backend looks reachable.
//   2. Activates the in-page SiteScout overlay (content.js) on the
//      current tab when the user clicks "Open SiteScout".
//
// All conversation logic now lives in content.js / background.js.

const BACKEND_HEALTH_URLS = [
  "http://127.0.0.1:8000/",
  "http://localhost:8000/"
];

const openBtn = document.getElementById("openBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const messageBox = document.getElementById("messageBox");

init();

async function init() {
  checkBackendStatus();
  openBtn.addEventListener("click", openSiteScout);
}

async function checkBackendStatus() {
  for (const url of BACKEND_HEALTH_URLS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      // Any response (even a 404) means the server process is up.
      await fetch(url, { method: "GET", signal: controller.signal });
      clearTimeout(timeout);
      setStatus("ready", "Backend ready");
      return;
    } catch (e) {
      // try the next URL
    }
  }
  setStatus("offline", "Backend offline");
}

function setStatus(kind, label) {
  statusDot.className = "status-dot status-" + kind;
  statusText.textContent = label;
}

async function openSiteScout() {
  openBtn.disabled = true;
  hideMessage();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error("no_active_tab");
    }

    if (!isSupportedUrl(tab.url)) {
      showMessage("SiteScout can't run on this type of page.");
      openBtn.disabled = false;
      return;
    }

    await activateOverlay(tab.id);
    window.close();
  } catch (err) {
    console.error("SiteScout: failed to activate overlay —", err);
    showMessage("Couldn't open SiteScout on this page. Try reloading the tab.");
    openBtn.disabled = false;
  }
}

function isSupportedUrl(url) {
  if (!url) return false;
  return /^https?:\/\//.test(url);
}

async function activateOverlay(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "sitescout:toggle" });
    return;
  } catch (e) {
    // Content script probably isn't injected yet (e.g. the tab was open
    // before the extension was installed/reloaded). Inject it, then retry.
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
  await chrome.tabs.sendMessage(tabId, { type: "sitescout:toggle" });
}

function showMessage(text) {
  messageBox.textContent = text;
  messageBox.hidden = false;
}

function hideMessage() {
  messageBox.hidden = true;
}
