"use strict";

const questionInput = document.getElementById("questionInput");
const askButton = document.getElementById("askButton");

function sendToSiteScout(query) {
  const text = String(query || "").trim();
  if (!text) { questionInput.focus(); return; }
  chrome.runtime.sendMessage({ type: "sitescout:popup_action", query: text }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      console.error("SiteScout popup error:", chrome.runtime.lastError?.message || response?.error);
      return;
    }
    window.close();
  });
}

// Opening the extension should immediately open the in-page SiteScout panel.
chrome.runtime.sendMessage({ type: "sitescout:popup_open" }, () => {
  if (chrome.runtime.lastError) console.error("SiteScout open error:", chrome.runtime.lastError.message);
  window.close();
});

askButton.addEventListener("click", () => sendToSiteScout(questionInput.value));
questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendToSiteScout(questionInput.value);
  }
});
document.querySelectorAll(".quick-action").forEach((button) => {
  button.addEventListener("click", () => sendToSiteScout(button.dataset.query));
});
