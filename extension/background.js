"use strict";

const BACKEND_ENDPOINTS = [
  "https://sitescout-backend-9duz.onrender.com/chat"
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
      if (!response.ok) { lastError = new Error(`status_${response.status}`); continue; }
      return { ok: true, data: await response.json() };
    } catch (error) { lastError = error; }
  }
  return { ok: false, error: lastError?.message || "network_error" };
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs?.length || !tabs[0]?.id) throw new Error("No active tab found");
  return tabs[0];
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "sitescout:toggle" });
    return;
  } catch (_) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await new Promise(resolve => setTimeout(resolve, 80));
    await chrome.tabs.sendMessage(tabId, { type: "sitescout:toggle" });
  }
}

async function openSiteScout(sendResponse) {
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    sendResponse({ ok: true });
  } catch (error) {
    console.error("SiteScout open failed:", error);
    sendResponse({ ok: false, error: error?.message || "Could not open SiteScout on this page" });
  }
}

async function handlePopupAction(message, sendResponse) {
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    await new Promise(resolve => setTimeout(resolve, 100));
    await chrome.tabs.sendMessage(tab.id, { type: "sitescout:submit", query: message.query });
    sendResponse({ ok: true });
  } catch (error) {
    console.error("SiteScout popup action failed:", error);
    sendResponse({ ok: false, error: error?.message || "Could not communicate with webpage" });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return false;

  if (message.type === "sitescout:popup_open") {
    openSiteScout(sendResponse);
    return true;
  }

  if (message.type === "sitescout:popup_action") {
    handlePopupAction(message, sendResponse);
    return true;
  }

  if (message.type === "sitescout:chat") {
    forwardChatRequest(message.payload).then(sendResponse);
    return true;
  }

  return false;
});
