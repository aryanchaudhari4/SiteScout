// background.js
//
// Minimal MV3 service worker. Its only job is to forward chat requests
// from the in-page SiteScout overlay (content.js) to the existing FastAPI
// backend, and hand the response back.
//
// Why route through the background worker instead of fetching directly
// from content.js? Content scripts share the network/CSP restrictions of
// the host page, so a site with a strict Content-Security-Policy could
// silently block the request to localhost. The background worker runs in
// the extension's own process and is not subject to the page's CSP, which
// makes the connection to the backend much more reliable across sites.
//
// This file does NOT change the backend contract. It sends exactly the
// same payload shape the extension always has:
//   { text, query, session_id }
// to the existing /chat endpoint, and returns the existing
//   { answer: "..." }
// response untouched.

const BACKEND_ENDPOINTS = [
  "http://127.0.0.1:8000/chat",
  "http://localhost:8000/chat"
];

async function forwardChatRequest(payload) {
  let lastError = null;

  for (const url of BACKEND_ENDPOINTS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        lastError = new Error(`status_${response.status}`);
        continue;
      }

      const data = await response.json();
      return { ok: true, data };
    } catch (err) {
      lastError = err;
    }
  }

  return {
    ok: false,
    error: lastError ? lastError.message : "network_error"
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "sitescout:chat") {
    return false;
  }

  forwardChatRequest(message.payload).then(sendResponse);
  return true; // keep the message channel open for the async response
});
