"use strict";

const questionInput = document.getElementById("questionInput");
const askButton = document.getElementById("askButton");

function sendToSiteScout(query) {
  const text = query.trim();

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

      if (!tabs || !tabs.length) {
        return;
      }

      const tab = tabs[0];

      chrome.tabs.sendMessage(
        tab.id,
        {
          type: "sitescout:toggle"
        },
        () => {

          if (chrome.runtime.lastError) {
            console.error(
              "SiteScout could not open the page overlay:",
              chrome.runtime.lastError.message
            );

            return;
          }

          chrome.tabs.sendMessage(
            tab.id,
            {
              type: "sitescout:submit",
              query: text
            }
          );

          window.close();
        }
      );
    }
  );
}


/* ASK BUTTON */

askButton.addEventListener("click", () => {
  sendToSiteScout(questionInput.value);
});


/* ENTER TO SEND */

questionInput.addEventListener("keydown", (event) => {

  if (event.key === "Enter" && !event.shiftKey) {

    event.preventDefault();

    sendToSiteScout(questionInput.value);
  }

});


/* QUICK ACTIONS */

document.querySelectorAll(".quick-action").forEach((button) => {

  button.addEventListener("click", () => {

    const query = button.dataset.query;

    sendToSiteScout(query);

  });

});


/* AUTO FOCUS */

window.addEventListener("load", () => {
  questionInput.focus();
});
