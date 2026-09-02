"use strict";


/* ============================================================
   BACKEND
============================================================ */

const BACKEND_ENDPOINTS = [
  "http://127.0.0.1:8000/chat",
  "http://localhost:8000/chat"
];


/* ============================================================
   FORWARD CHAT REQUEST
============================================================ */

async function forwardChatRequest(payload) {

  let lastError = null;

  for (const url of BACKEND_ENDPOINTS) {

    try {

      const response = await fetch(
        url,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {

        lastError =
          new Error(
            `status_${response.status}`
          );

        continue;
      }

      const data =
        await response.json();

      return {
        ok: true,
        data
      };

    } catch (error) {

      lastError = error;

    }

  }

  return {
    ok: false,
    error:
      lastError
        ? lastError.message
        : "network_error"
  };
}


/* ============================================================
   POPUP ACTION
============================================================ */

async function handlePopupAction(
  message,
  sendResponse
) {

  try {

    /*
     * Find the active tab.
     */

    const tabs =
      await chrome.tabs.query({
        active: true,
        currentWindow: true
      });

    if (
      !tabs ||
      !tabs.length ||
      !tabs[0].id
    ) {

      sendResponse({
        ok: false,
        error: "No active tab found"
      });

      return;
    }

    const tabId =
      tabs[0].id;


    /*
     * Open SiteScout overlay.
     */

    await chrome.tabs.sendMessage(
      tabId,
      {
        type: "sitescout:toggle"
      }
    );


    /*
     * Wait briefly for the UI
     * to become visible.
     */

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 150)
    );


    /*
     * Submit selected action.
     */

    await chrome.tabs.sendMessage(
      tabId,
      {
        type: "sitescout:submit",
        query: message.query
      }
    );


    sendResponse({
      ok: true
    });

  } catch (error) {

    console.error(
      "SiteScout popup action failed:",
      error
    );

    sendResponse({
      ok: false,
      error:
        error?.message ||
        "Could not communicate with webpage"
    });

  }

}


/* ============================================================
   MESSAGE HANDLER
============================================================ */

chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {

    if (!message) {
      return false;
    }


    /*
     * Popup → Background → Content Script
     */

    if (
      message.type ===
      "sitescout:popup_action"
    ) {

      handlePopupAction(
        message,
        sendResponse
      );

      return true;
    }


    /*
     * Content Script → Background → Backend
     */

    if (
      message.type ===
      "sitescout:chat"
    ) {

      forwardChatRequest(
        message.payload
      ).then(sendResponse);

      return true;
    }


    return false;

  }
);
