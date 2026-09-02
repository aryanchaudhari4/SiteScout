"use strict";

const questionInput =
  document.getElementById("questionInput");

const askButton =
  document.getElementById("askButton");


/* ============================================================
   SEND ACTION THROUGH BACKGROUND
============================================================ */

function sendToSiteScout(query) {
  const text = String(query || "").trim();

  if (!text) {
    questionInput.focus();
    return;
  }

  /*
   * Send the request to the background service worker.
   *
   * Background worker will:
   *
   * 1. Find the active tab.
   * 2. Open SiteScout.
   * 3. Submit the selected query.
   */

  chrome.runtime.sendMessage(
    {
      type: "sitescout:popup_action",
      query: text
    },
    (response) => {

      if (chrome.runtime.lastError) {
        console.error(
          "SiteScout popup error:",
          chrome.runtime.lastError.message
        );

        return;
      }

      if (!response || !response.ok) {
        console.error(
          "SiteScout could not perform action:",
          response?.error || "unknown_error"
        );

        return;
      }

      /*
       * Close popup after the action
       * has successfully been sent.
       */
      window.close();
    }
  );
}


/* ============================================================
   ASK BUTTON
============================================================ */

askButton.addEventListener(
  "click",
  () => {

    sendToSiteScout(
      questionInput.value
    );

  }
);


/* ============================================================
   ENTER TO SEND
============================================================ */

questionInput.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      sendToSiteScout(
        questionInput.value
      );

    }

  }
);


/* ============================================================
   QUICK ACTIONS
============================================================ */

document
  .querySelectorAll(".quick-action")
  .forEach((button) => {

    button.addEventListener(
      "click",
      () => {

        const query =
          button.getAttribute(
            "data-query"
          );

        sendToSiteScout(query);

      }
    );

  });


/* ============================================================
   AUTO FOCUS
============================================================ */

window.addEventListener(
  "load",
  () => {

    setTimeout(() => {

      if (questionInput) {
        questionInput.focus();
      }

    }, 50);

  }
);
