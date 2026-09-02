"use strict";

const questionInput =
  document.getElementById("questionInput");

const askButton =
  document.getElementById("askButton");


/* ============================================================
   SEND QUERY TO SITESCOUNT
============================================================ */

function sendToSiteScout(query) {
  const text = String(query || "").trim();

  if (!text) {
    questionInput.focus();
    return;
  }

  chrome.tabs.query(
    {
      active: true,
      currentWindow: true
    },
    (tabs) => {

      if (
        chrome.runtime.lastError
      ) {
        console.error(
          "SiteScout:",
          chrome.runtime.lastError.message
        );

        return;
      }

      if (
        !tabs ||
        !tabs.length ||
        !tabs[0].id
      ) {
        return;
      }

      const tab = tabs[0];

      /*
       * First open SiteScout.
       */
      chrome.tabs.sendMessage(
        tab.id,
        {
          type: "sitescout:toggle"
        },
        () => {

          if (
            chrome.runtime.lastError
          ) {
            console.error(
              "SiteScout could not open:",
              chrome.runtime.lastError.message
            );

            return;
          }

          /*
           * Give content.js a moment to
           * update the UI before submitting.
           */
          setTimeout(() => {

            chrome.tabs.sendMessage(
              tab.id,
              {
                type: "sitescout:submit",
                query: text
              },
              () => {

                if (
                  chrome.runtime.lastError
                ) {
                  console.error(
                    "SiteScout could not submit query:",
                    chrome.runtime.lastError.message
                  );
                }

              }
            );

          }, 120);

          /*
           * Close popup after sending.
           */
          setTimeout(() => {
            window.close();
          }, 150);

        }
      );
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

const quickActions =
  document.querySelectorAll(
    ".quick-action"
  );

quickActions.forEach(
  (button) => {

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

  }
);


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
