// content.js
//
// SiteScout in-page AI assistant.
// The UI is injected into the current webpage using Shadow DOM so that
// the webpage's CSS does not interfere with SiteScout's interface.
//
// Flow:
//
// Popup
//   ↓
// content.js
//   ↓
// Extract current webpage text
//   ↓
// background.js
//   ↓
// FastAPI /chat
//   ↓
// RAG + LLM
//   ↓
// SiteScout overlay
//

(function () {
  "use strict";

  // Prevent duplicate injection.
  if (window.__sitescoutInjected) {
    return;
  }

  window.__sitescoutInjected = true;

  const SESSION_STORAGE_KEY = "sitescout_session_id";
  const MIN_PAGE_TEXT_LENGTH = 40;

  const SUGGESTED_PROMPTS = [
    {
      icon: "✦",
      text: "Summarize this page"
    },
    {
      icon: "◆",
      text: "What are the key points?"
    },
    {
      icon: "◇",
      text: "Explain this page simply"
    },
    {
      icon: "◎",
      text: "What is the main idea?"
    },
    {
      icon: "⌕",
      text: "Find important information"
    }
  ];

  /* -----------------------------------------------------------------------
     STATE
  ----------------------------------------------------------------------- */

  const state = {
    open: false,
    minimized: false,
    loading: false,
    messages: []
  };

  let sessionId = getOrCreateSessionId();
  let msgIdCounter = 0;

  let host = null;
  let shadow = null;

  let panelEl = null;
  let bubbleEl = null;
  let messagesEl = null;
  let welcomeEl = null;
  let inputEl = null;
  let sendBtn = null;
  let statusDot = null;

  let loadingBubbleEl = null;

  /* -----------------------------------------------------------------------
     SESSION
  ----------------------------------------------------------------------- */

  function getOrCreateSessionId() {
    try {
      let id = sessionStorage.getItem(SESSION_STORAGE_KEY);

      if (!id) {
        id = generateSessionId();
        sessionStorage.setItem(SESSION_STORAGE_KEY, id);
      }

      return id;
    } catch (error) {
      return generateSessionId();
    }
  }

  function generateSessionId() {
    return (
      "ss_" +
      Math.random().toString(36).slice(2) +
      "_" +
      Date.now()
    );
  }

  function resetSessionId() {
    sessionId = generateSessionId();

    try {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        sessionId
      );
    } catch (error) {
      // Ignore storage errors.
    }
  }

  /* -----------------------------------------------------------------------
     PAGE CONTENT
  ----------------------------------------------------------------------- */

  function extractPageContent() {
    if (!document.body) {
      return "";
    }

    return document.body.innerText.trim();
  }

  function getPageDomain() {
    try {
      return location.hostname || location.href;
    } catch (error) {
      return "this page";
    }
  }

  /* -----------------------------------------------------------------------
     BUILD UI
  ----------------------------------------------------------------------- */

  function buildUI() {
    if (host) {
      return;
    }

    host = document.createElement("div");

    host.id = "sitescout-host";

    host.style.all = "initial";

    (
      document.documentElement ||
      document.body
    ).appendChild(host);

    shadow = host.attachShadow({
      mode: "open"
    });

    const style = document.createElement("style");

    style.textContent = getStyles();

    shadow.appendChild(style);

    shadow.appendChild(buildBubble());
    shadow.appendChild(buildPanel());

    updateVisibility();
  }

  /* -----------------------------------------------------------------------
     FLOATING BUBBLE
  ----------------------------------------------------------------------- */

  function buildBubble() {
    bubbleEl = document.createElement("button");

    bubbleEl.className = "ss-bubble";

    bubbleEl.type = "button";

    bubbleEl.title = "Open SiteScout";

    bubbleEl.innerHTML = `
      <span class="ss-bubble-icon">⌕</span>
      <span>SiteScout</span>
    `;

    bubbleEl.addEventListener("click", () => {
      state.minimized = false;
      state.open = true;

      updateVisibility();

      triggerOpenAnimation();

      focusInput();
    });

    return bubbleEl;
  }

  /* -----------------------------------------------------------------------
     PANEL
  ----------------------------------------------------------------------- */

  function buildPanel() {
    panelEl = document.createElement("div");

    panelEl.className = "ss-panel";

    panelEl.appendChild(buildHeader());

    panelEl.appendChild(buildPageInfo());

    messagesEl = document.createElement("div");

    messagesEl.className = "ss-messages";

    panelEl.appendChild(messagesEl);

    panelEl.appendChild(buildInputRow());

    renderWelcome();

    return panelEl;
  }

  /* -----------------------------------------------------------------------
     HEADER
  ----------------------------------------------------------------------- */

  function buildHeader() {
    const header = document.createElement("div");

    header.className = "ss-header";

    const titleBlock = document.createElement("div");

    titleBlock.className = "ss-header-title";

    titleBlock.innerHTML = `
      <div class="ss-title-row">
        <span class="ss-logo">⌕</span>
        <span class="ss-title">SiteScout</span>
      </div>

      <div class="ss-subtitle">
        AI assistant for this webpage
      </div>
    `;

    const controls = document.createElement("div");

    controls.className = "ss-header-controls";

    const clearBtn = makeIconButton(
      "↻",
      "Clear conversation",
      () => {
        clearConversation();
      }
    );

    const minimizeBtn = makeIconButton(
      "−",
      "Minimize",
      () => {
        state.minimized = true;

        updateVisibility();
      }
    );

    const closeBtn = makeIconButton(
      "×",
      "Close",
      () => {
        state.open = false;
        state.minimized = false;

        updateVisibility();
      }
    );

    closeBtn.classList.add("ss-close-btn");

    controls.appendChild(clearBtn);
    controls.appendChild(minimizeBtn);
    controls.appendChild(closeBtn);

    header.appendChild(titleBlock);
    header.appendChild(controls);

    makeDraggable(header);

    return header;
  }

  function makeIconButton(label, title, onClick) {
    const btn = document.createElement("button");

    btn.type = "button";

    btn.className = "ss-icon-btn";

    btn.title = title;

    btn.setAttribute(
      "aria-label",
      title
    );

    btn.textContent = label;

    btn.addEventListener(
      "click",
      onClick
    );

    return btn;
  }

  /* -----------------------------------------------------------------------
     PAGE INFO
  ----------------------------------------------------------------------- */

  function buildPageInfo() {
    const info = document.createElement("div");

    info.className = "ss-page-info";

    statusDot = document.createElement("span");

    statusDot.className = "ss-status-dot";

    const label = document.createElement("span");

    label.className = "ss-page-domain";

    label.textContent = getPageDomain();

    info.appendChild(statusDot);

    info.appendChild(label);

    return info;
  }

  /* -----------------------------------------------------------------------
     INPUT
  ----------------------------------------------------------------------- */

  function buildInputRow() {
    const row = document.createElement("div");

    row.className = "ss-input-row";

    inputEl = document.createElement("textarea");

    inputEl.className = "ss-input";

    inputEl.placeholder =
      "Ask about this page...";

    inputEl.rows = 1;

    inputEl.addEventListener(
      "input",
      () => {
        autoGrowInput();

        updateSendButtonState();
      }
    );

    inputEl.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Enter" &&
          !event.shiftKey
        ) {
          event.preventDefault();

          submitQuery();
        }
      }
    );

    sendBtn = document.createElement("button");

    sendBtn.type = "button";

    sendBtn.className =
      "ss-send-btn";

    sendBtn.title = "Send";

    sendBtn.setAttribute(
      "aria-label",
      "Send"
    );

    sendBtn.innerHTML = "→";

    sendBtn.disabled = true;

    sendBtn.addEventListener(
      "click",
      () => submitQuery()
    );

    row.appendChild(inputEl);

    row.appendChild(sendBtn);

    return row;
  }

  function autoGrowInput() {
    inputEl.style.height = "auto";

    const maxHeight = 96;

    inputEl.style.height =
      Math.min(
        inputEl.scrollHeight,
        maxHeight
      ) + "px";
  }

  function updateSendButtonState() {
    const hasText =
      inputEl.value.trim().length > 0;

    sendBtn.disabled =
      !hasText ||
      state.loading;
  }

  function focusInput() {
    setTimeout(() => {
      if (inputEl) {
        inputEl.focus();
      }
    }, 50);
  }

  /* -----------------------------------------------------------------------
     DRAGGING
  ----------------------------------------------------------------------- */

  function makeDraggable(handle) {
    let dragging = false;

    let startX = 0;
    let startY = 0;

    let startRight = 0;
    let startTop = 0;

    handle.addEventListener(
      "mousedown",
      (event) => {
        if (
          event.target.closest(
            ".ss-icon-btn"
          )
        ) {
          return;
        }

        dragging = true;

        const rect =
          panelEl.getBoundingClientRect();

        startX = event.clientX;

        startY = event.clientY;

        startRight =
          window.innerWidth -
          rect.right;

        startTop = rect.top;

        document.addEventListener(
          "mousemove",
          onDragMove
        );

        document.addEventListener(
          "mouseup",
          onDragEnd
        );

        event.preventDefault();
      }
    );

    function onDragMove(event) {
      if (!dragging) {
        return;
      }

      const deltaX =
        event.clientX - startX;

      const deltaY =
        event.clientY - startY;

      const newRight =
        Math.max(
          8,
          startRight - deltaX
        );

      const newTop =
        Math.max(
          8,
          startTop + deltaY
        );

      panelEl.style.right =
        newRight + "px";

      panelEl.style.top =
        newTop + "px";

      panelEl.style.bottom =
        "auto";
    }

    function onDragEnd() {
      dragging = false;

      document.removeEventListener(
        "mousemove",
        onDragMove
      );

      document.removeEventListener(
        "mouseup",
        onDragEnd
      );
    }
  }

  /* -----------------------------------------------------------------------
     VISIBILITY
  ----------------------------------------------------------------------- */

  function updateVisibility() {
    if (!panelEl) {
      return;
    }

    panelEl.classList.toggle(
      "ss-visible",
      state.open &&
        !state.minimized
    );

    bubbleEl.classList.toggle(
      "ss-visible",
      state.open &&
        state.minimized
    );
  }

  function triggerOpenAnimation() {
    if (!panelEl) {
      return;
    }

    panelEl.classList.remove(
      "ss-animate-in"
    );

    void panelEl.offsetWidth;

    panelEl.classList.add(
      "ss-animate-in"
    );
  }

  /* -----------------------------------------------------------------------
     WELCOME SCREEN
  ----------------------------------------------------------------------- */

  function renderWelcome() {
    messagesEl.innerHTML = "";

    welcomeEl =
      document.createElement("div");

    welcomeEl.className =
      "ss-welcome";

    welcomeEl.innerHTML = `
      <div class="ss-welcome-icon">
        ✦
      </div>

      <div class="ss-welcome-title">
        Welcome to SiteScout
      </div>

      <div class="ss-welcome-text">
        Your AI assistant for understanding
        the webpage you're currently viewing.
      </div>

      <div class="ss-welcome-label">
        TRY ONE OF THESE
      </div>
    `;

    const promptsWrap =
      document.createElement("div");

    promptsWrap.className =
      "ss-suggested-prompts";

    SUGGESTED_PROMPTS.forEach(
      (prompt) => {
        const btn =
          document.createElement("button");

        btn.type = "button";

        btn.className =
          "ss-suggested-prompt";

        btn.innerHTML = `
          <span class="ss-prompt-icon">
            ${prompt.icon}
          </span>

          <span>
            ${prompt.text}
          </span>

          <span class="ss-prompt-arrow">
            →
          </span>
        `;

        btn.addEventListener(
          "click",
          () => {
            submitQuery(prompt.text);
          }
        );

        promptsWrap.appendChild(btn);
      }
    );

    welcomeEl.appendChild(
      promptsWrap
    );

    messagesEl.appendChild(
      welcomeEl
    );
  }

  function clearWelcomeIfPresent() {
    if (
      welcomeEl &&
      welcomeEl.parentNode
    ) {
      welcomeEl.parentNode.removeChild(
        welcomeEl
      );

      welcomeEl = null;
    }
  }

  function scrollToBottom() {
    messagesEl.scrollTop =
      messagesEl.scrollHeight;
  }

  /* -----------------------------------------------------------------------
     SAFE FORMATTING
  ----------------------------------------------------------------------- */

  function escapeHtml(text) {
    const div =
      document.createElement("div");

    div.textContent = text;

    return div.innerHTML;
  }

  function removeThinking(text) {
    if (
      typeof text !== "string"
    ) {
      return "";
    }

    let cleaned = text;

    // Remove complete <think>...</think> sections.
    cleaned = cleaned.replace(
      /<think>[\s\S]*?<\/think>/gi,
      ""
    );

    // Remove incomplete thinking tags too.
    cleaned = cleaned.replace(
      /<think>[\s\S]*/gi,
      ""
    );

    cleaned = cleaned.replace(
      /<\/think>/gi,
      ""
    );

    return cleaned.trim();
  }

  function formatInline(text) {
    return escapeHtml(
      text
    ).replace(
      /\*\*(.+?)\*\*/g,
      "<strong>$1</strong>"
    );
  }

  function formatAnswerHtml(text) {
    const cleaned =
      removeThinking(text);

    const lines =
      cleaned.split(/\r?\n/);

    let html = "";

    let listBuffer = [];

    function flushList() {
      if (
        listBuffer.length
      ) {
        html += `
          <ul class="ss-answer-list">
            ${listBuffer
              .map(
                (item) =>
                  `<li>${item}</li>`
              )
              .join("")}
          </ul>
        `;

        listBuffer = [];
      }
    }

    lines.forEach(
      (rawLine) => {
        const line =
          rawLine.trim();

        if (!line) {
          flushList();

          return;
        }

        const bulletMatch =
          line.match(
            /^[-*•]\s+(.*)/
          );

        const numberedMatch =
          line.match(
            /^\d+[.)]\s+(.*)/
          );

        if (bulletMatch) {
          listBuffer.push(
            formatInline(
              bulletMatch[1]
            )
          );
        } else if (
          numberedMatch
        ) {
          listBuffer.push(
            formatInline(
              numberedMatch[1]
            )
          );
        } else {
          flushList();

          html += `
            <p class="ss-answer-p">
              ${formatInline(line)}
            </p>
          `;
        }
      }
    );

    flushList();

    return html;
  }

  /* -----------------------------------------------------------------------
     MESSAGES
  ----------------------------------------------------------------------- */

  function appendUserMessage(text) {
    clearWelcomeIfPresent();

    const bubble =
      document.createElement("div");

    bubble.className =
      "ss-message ss-message-user";

    const textEl =
      document.createElement("div");

    textEl.className =
      "ss-message-text";

    textEl.textContent = text;

    bubble.appendChild(
      textEl
    );

    messagesEl.appendChild(
      bubble
    );

    scrollToBottom();
  }

  function appendAssistantMessage({
    text,
    error,
    source
  }) {
    clearWelcomeIfPresent();

    const bubble =
      document.createElement("div");

    bubble.className =
      "ss-message ss-message-assistant";

    if (error) {
      const errorEl =
        document.createElement("div");

      errorEl.className =
        "ss-error";

      errorEl.innerHTML =
        errorContentFor(error);

      bubble.appendChild(
        errorEl
      );

      messagesEl.appendChild(
        bubble
      );

      scrollToBottom();

      return;
    }

    const textEl =
      document.createElement("div");

    textEl.className =
      "ss-message-text";

    textEl.innerHTML =
      formatAnswerHtml(text);

    bubble.appendChild(
      textEl
    );

    const footer =
      document.createElement("div");

    footer.className =
      "ss-message-footer";

    if (source) {
      const sourceEl =
        document.createElement(
          "span"
        );

      sourceEl.className =
        "ss-source-badge";

      sourceEl.textContent =
        source === "web_search"
          ? "🌐 Web search"
          : "📄 Current page";

      footer.appendChild(
        sourceEl
      );
    }

    const copyBtn =
      document.createElement(
        "button"
      );

    copyBtn.type = "button";

    copyBtn.className =
      "ss-copy-btn";

    copyBtn.textContent =
      "Copy";

    copyBtn.addEventListener(
      "click",
      () => {
        copyAnswer(
          removeThinking(text),
          copyBtn
        );
      }
    );

    footer.appendChild(
      copyBtn
    );

    bubble.appendChild(
      footer
    );

    messagesEl.appendChild(
      bubble
    );

    scrollToBottom();
  }

  function errorContentFor(error) {
    if (
      error === "not_enough_content"
    ) {
      return `
        <div class="ss-error-icon">⚠</div>

        <strong>
          Not enough page content
        </strong>

        <p>
          SiteScout couldn't find enough
          readable content on this page.
        </p>
      `;
    }

    if (
      error === "connection"
    ) {
      return `
        <div class="ss-error-icon">⚠</div>

        <strong>
          Unable to connect
        </strong>

        <p>
          SiteScout couldn't reach the backend.
          Please make sure the server is running
          and try again.
        </p>
      `;
    }

    return `
      <div class="ss-error-icon">⚠</div>

      <strong>
        Something went wrong
      </strong>

      <p>
        Please try again.
      </p>
    `;
  }

  function copyAnswer(text, btn) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        const original =
          btn.textContent;

        btn.textContent =
          "Copied ✓";

        setTimeout(() => {
          btn.textContent =
            original;
        }, 1500);
      })
      .catch(() => {
        // Clipboard may not be available.
      });
  }

  /* -----------------------------------------------------------------------
     LOADING
  ----------------------------------------------------------------------- */

  function showLoadingBubble() {
    hideLoadingBubble();

    loadingBubbleEl =
      document.createElement("div");

    loadingBubbleEl.className =
      "ss-message ss-message-assistant ss-loading-message";

    loadingBubbleEl.innerHTML = `
      <div class="ss-loading-avatar">
        ✦
      </div>

      <div class="ss-loading-content">
        <div class="ss-loading-text">
          SiteScout is reading this page
        </div>

        <div class="ss-loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    `;

    messagesEl.appendChild(
      loadingBubbleEl
    );

    scrollToBottom();
  }

  function hideLoadingBubble() {
    if (
      loadingBubbleEl &&
      loadingBubbleEl.parentNode
    ) {
      loadingBubbleEl.parentNode.removeChild(
        loadingBubbleEl
      );
    }

    loadingBubbleEl = null;
  }

  /* -----------------------------------------------------------------------
     CLEAR CHAT
  ----------------------------------------------------------------------- */

  function clearConversation() {
    state.messages = [];

    hideLoadingBubble();

    resetSessionId();

    renderWelcome();

    inputEl.value = "";

    autoGrowInput();

    updateSendButtonState();

    focusInput();
  }

  /* -----------------------------------------------------------------------
     SUBMIT QUERY
  ----------------------------------------------------------------------- */

  function submitQuery(prefilledText) {
    const query =
      (
        typeof prefilledText === "string"
          ? prefilledText
          : inputEl.value
      ).trim();

    if (
      !query ||
      state.loading
    ) {
      return;
    }

    if (
      typeof prefilledText !== "string"
    ) {
      inputEl.value = "";

      autoGrowInput();
    }

    updateSendButtonState();

    appendUserMessage(query);

    state.messages.push({
      id: ++msgIdCounter,
      role: "user",
      text: query
    });

    const pageText =
      extractPageContent();

    if (
      pageText.length <
      MIN_PAGE_TEXT_LENGTH
    ) {
      appendAssistantMessage({
        error: "not_enough_content"
      });

      return;
    }

    state.loading = true;

    updateSendButtonState();

    showLoadingBubble();

    let responded = false;

    chrome.runtime.sendMessage(
      {
        type: "sitescout:chat",

        payload: {
          text: pageText,
          query: query,
          session_id: sessionId
        }
      },
      (response) => {
        responded = true;

        finishRequest(response);
      }
    );

    setTimeout(() => {
      if (!responded) {
        responded = true;

        finishRequest(null);
      }
    }, 20000);
  }

  function finishRequest(response) {
    state.loading = false;

    updateSendButtonState();

    hideLoadingBubble();

    if (
      chrome.runtime.lastError ||
      !response ||
      !response.ok
    ) {
      console.error(
        "SiteScout: chat request failed —",
        (
          chrome.runtime.lastError &&
          chrome.runtime.lastError.message
        ) ||
          (
            response &&
            response.error
          ) ||
          "no response from background worker"
      );

      appendAssistantMessage({
        error: "connection"
      });

      return;
    }

    const answer =
      response.data &&
      response.data.answer;

    if (
      typeof answer !== "string"
    ) {
      console.error(
        "SiteScout: unexpected backend response —",
        response.data
      );

      appendAssistantMessage({
        error: "unexpected"
      });

      return;
    }

    const cleanedAnswer =
      removeThinking(answer);

    const source =
      response.data.source;

    state.messages.push({
      id: ++msgIdCounter,
      role: "assistant",
      text: cleanedAnswer,
      source
    });

    appendAssistantMessage({
      text: cleanedAnswer,
      source
    });
  }

  /* -----------------------------------------------------------------------
     POPUP COMMUNICATION
  ----------------------------------------------------------------------- */

  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (
        !message ||
        message.type !==
          "sitescout:toggle"
      ) {
        return false;
      }

      if (!host) {
        buildUI();
      }

      state.open = true;

      state.minimized = false;

      updateVisibility();

      triggerOpenAnimation();

      focusInput();

      sendResponse({
        ok: true
      });

      return false;
    }
  );

  // Open SiteScout and immediately submit a query.
  // Used by the popup quick actions and question box.
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (
        !message ||
        message.type !==
          "sitescout:submit"
      ) {
        return false;
      }

      if (!host) {
        buildUI();
      }

      state.open = true;

      state.minimized = false;

      updateVisibility();

      triggerOpenAnimation();

      submitQuery(message.query);

      sendResponse({
        ok: true
      });

      return false;
    }
  );

  /* -----------------------------------------------------------------------
     STYLES
  ----------------------------------------------------------------------- */

  function getStyles() {
    return `
      :host {
        all: initial;
      }

      * {
        box-sizing: border-box;
        font-family:
          Inter,
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          sans-serif;
      }

      /* ---------------------------------------------------------------
         PANEL
      --------------------------------------------------------------- */

      .ss-panel {
        display: none;

        flex-direction: column;

        position: fixed;

        top: 64px;

        right: 22px;

        bottom: 22px;

        width: 410px;

        max-height:
          calc(100vh - 86px);

        background:
          rgba(18, 18, 18, 0.98);

        color: #f5f5f5;

        border-radius: 20px;

        border:
          1px solid rgba(
            255,
            255,
            255,
            0.08
          );

        box-shadow:
          0 28px 70px
            rgba(0, 0, 0, 0.5),
          0 4px 18px
            rgba(0, 0, 0, 0.35);

        z-index: 2147483647;

        overflow: hidden;

        backdrop-filter: blur(18px);
      }

      .ss-panel.ss-visible {
        display: flex;
      }

      .ss-panel.ss-animate-in {
        animation:
          ss-panel-pop
          0.32s
          cubic-bezier(
            0.16,
            1,
            0.3,
            1
          );
      }

      @keyframes ss-panel-pop {
        from {
          opacity: 0;

          transform:
            scale(0.94)
            translateY(16px);
        }

        to {
          opacity: 1;

          transform:
            scale(1)
            translateY(0);
        }
      }

      /* ---------------------------------------------------------------
         HEADER
      --------------------------------------------------------------- */

      .ss-header {
        display: flex;

        align-items: center;

        justify-content: space-between;

        padding:
          17px
          16px
          14px
          18px;

        border-bottom:
          1px solid
          rgba(
            255,
            255,
            255,
            0.07
          );

        cursor: grab;

        flex-shrink: 0;

        background:
          linear-gradient(
            180deg,
            rgba(255,255,255,0.025),
            transparent
          );
      }

      .ss-header:active {
        cursor: grabbing;
      }

      .ss-header-title {
        min-width: 0;
      }

      .ss-title-row {
        display: flex;

        align-items: center;

        gap: 8px;
      }

      .ss-logo {
        width: 29px;

        height: 29px;

        display: flex;

        align-items: center;

        justify-content: center;

        border-radius: 9px;

        background:
          #ff6b35;

        color:
          #151515;

        font-size: 18px;

        font-weight: 800;
      }

      .ss-title {
        font-size: 16px;

        font-weight: 750;

        letter-spacing:
          -0.25px;
      }

      .ss-subtitle {
        font-size: 11px;

        color: #777;

        margin-top: 4px;

        margin-left: 37px;
      }

      .ss-header-controls {
        display: flex;

        align-items: center;

        gap: 4px;
      }

      .ss-icon-btn {
        width: 29px;

        height: 29px;

        border-radius: 8px;

        border: 1px solid
          transparent;

        background:
          transparent;

        color: #8d8d8d;

        font-size: 14px;

        cursor: pointer;

        display: flex;

        align-items: center;

        justify-content: center;

        transition:
          background
          0.15s ease,
          color
          0.15s ease,
          border-color
          0.15s ease;
      }

      .ss-icon-btn:hover {
        background: #252525;

        border-color: #303030;

        color: #f0f0f0;
      }

      .ss-close-btn {
        font-size: 19px;
      }

      /* ---------------------------------------------------------------
         PAGE INFO
      --------------------------------------------------------------- */

      .ss-page-info {
        display: flex;

        align-items: center;

        gap: 7px;

        padding:
          9px
          18px;

        font-size: 10.5px;

        color: #777;

        border-bottom:
          1px solid
          rgba(
            255,
            255,
            255,
            0.055
          );

        flex-shrink: 0;
      }

      .ss-status-dot {
        width: 6px;

        height: 6px;

        border-radius: 50%;

        background:
          #4ade80;

        box-shadow:
          0 0 8px
          rgba(
            74,
            222,
            128,
            0.55
          );

        flex-shrink: 0;
      }

      .ss-page-domain {
        overflow: hidden;

        text-overflow: ellipsis;

        white-space: nowrap;
      }

      /* ---------------------------------------------------------------
         MESSAGES
      --------------------------------------------------------------- */

      .ss-messages {
        flex: 1 1 auto;

        overflow-y: auto;

        padding:
          18px;

        display: flex;

        flex-direction: column;

        gap: 14px;

        min-height: 0;

        scrollbar-width: thin;

        scrollbar-color:
          #363636
          transparent;
      }

      .ss-messages::-webkit-scrollbar {
        width: 6px;
      }

      .ss-messages::-webkit-scrollbar-thumb {
        background: #363636;

        border-radius: 10px;
      }

      /* ---------------------------------------------------------------
         WELCOME
      --------------------------------------------------------------- */

      .ss-welcome {
        text-align: center;

        padding:
          28px
          4px
          8px;

        display: flex;

        flex-direction: column;

        align-items: center;
      }

      .ss-welcome-icon {
        width: 54px;

        height: 54px;

        display: flex;

        align-items: center;

        justify-content: center;

        border-radius: 17px;

        background:
          linear-gradient(
            145deg,
            #252525,
            #1b1b1b
          );

        border:
          1px solid
          #343434;

        color:
          #ff6b35;

        font-size: 25px;

        margin-bottom: 15px;

        box-shadow:
          0 12px 28px
          rgba(
            0,
            0,
            0,
            0.2
          );
      }

      .ss-welcome-title {
        font-size: 18px;

        font-weight: 750;

        letter-spacing:
          -0.35px;

        margin-bottom: 8px;
      }

      .ss-welcome-text {
        font-size: 12px;

        color: #858585;

        line-height: 1.6;

        max-width: 290px;

        margin-bottom: 23px;
      }

      .ss-welcome-label {
        align-self: flex-start;

        font-size: 9px;

        text-transform:
          uppercase;

        letter-spacing:
          1px;

        color: #5f5f5f;

        margin-bottom: 9px;
      }

      .ss-suggested-prompts {
        display: flex;

        flex-direction: column;

        gap: 7px;

        width: 100%;
      }

      .ss-suggested-prompt {
        width: 100%;

        display: flex;

        align-items: center;

        gap: 10px;

        padding:
          11px
          12px;

        background:
          #1b1b1b;

        border:
          1px solid
          #292929;

        color:
          #e8e8e8;

        border-radius: 11px;

        font-size: 12px;

        text-align: left;

        cursor: pointer;

        transition:
          background
          0.18s ease,
          border-color
          0.18s ease,
          transform
          0.18s ease;
      }

      .ss-suggested-prompt:hover {
        background:
          #222;

        border-color:
          rgba(
            255,
            107,
            53,
            0.7
          );

        transform:
          translateX(2px);
      }

      .ss-prompt-icon {
        width: 27px;

        height: 27px;

        flex-shrink: 0;

        display: flex;

        align-items: center;

        justify-content: center;

        border-radius: 8px;

        background:
          #252525;

        color:
          #ff6b35;

        font-size: 12px;
      }

      .ss-prompt-arrow {
        margin-left: auto;

        color: #555;

        font-size: 15px;

        transition:
          transform
          0.18s ease,
          color
          0.18s ease;
      }

      .ss-suggested-prompt:hover
        .ss-prompt-arrow {
        color:
          #ff6b35;

        transform:
          translateX(3px);
      }

      /* ---------------------------------------------------------------
         CHAT MESSAGES
      --------------------------------------------------------------- */

      .ss-message {
        max-width: 90%;

        display: flex;

        flex-direction: column;

        gap: 6px;

        animation:
          ss-message-in
          0.22s
          ease-out;
      }

      @keyframes ss-message-in {
        from {
          opacity: 0;

          transform:
            translateY(7px);
        }

        to {
          opacity: 1;

          transform:
            translateY(0);
        }
      }

      .ss-message-user {
        align-self: flex-end;
      }

      .ss-message-assistant {
        align-self: flex-start;
      }

      .ss-message-text {
        font-size: 13px;

        line-height: 1.62;

        padding:
          11px
          13px;

        border-radius: 13px;

        word-break: break-word;
      }

      .ss-message-user
        .ss-message-text {
        background:
          #ff6b35;

        color:
          #161616;

        font-weight: 550;

        border-bottom-right-radius:
          4px;

        box-shadow:
          0 5px 15px
          rgba(
            255,
            107,
            53,
            0.13
          );
      }

      .ss-message-assistant
        .ss-message-text {
        background:
          #1f1f1f;

        border:
          1px solid
          #2c2c2c;

        color:
          #e3e3e3;

        border-bottom-left-radius:
          4px;
      }

      .ss-answer-p {
        margin:
          0 0 9px;
      }

      .ss-answer-p:last-child {
        margin-bottom: 0;
      }

      .ss-answer-list {
        margin:
          0 0 9px;

        padding-left: 18px;

        display: flex;

        flex-direction: column;

        gap: 6px;
      }

      .ss-answer-list:last-child {
        margin-bottom: 0;
      }

      .ss-answer-list li {
        padding-left: 2px;
      }

      .ss-answer-list li::marker {
        color:
          #ff6b35;
      }

      .ss-message-text strong {
        color:
          #ffffff;

        font-weight:
          750;
      }

      /* ---------------------------------------------------------------
         FOOTER
      --------------------------------------------------------------- */

      .ss-message-footer {
        display: flex;

        align-items: center;

        gap: 7px;

        padding-left: 3px;
      }

      .ss-source-badge {
        font-size: 9.5px;

        color: #858585;

        background:
          #191919;

        border:
          1px solid
          #292929;

        border-radius:
          999px;

        padding:
          3px
          8px;
      }

      .ss-copy-btn {
        font-size: 9.5px;

        color: #858585;

        background:
          transparent;

        border:
          1px solid
          #292929;

        border-radius:
          999px;

        padding:
          3px
          9px;

        cursor: pointer;

        transition:
          color
          0.15s ease,
          border-color
          0.15s ease,
          background
          0.15s ease;
      }

      .ss-copy-btn:hover {
        color:
          #f0f0f0;

        border-color:
          #ff6b35;

        background:
          #202020;
      }

      /* ---------------------------------------------------------------
         ERROR
      --------------------------------------------------------------- */

      .ss-error {
        font-size: 12px;

        line-height: 1.55;

        color:
          #fca5a5;

        background:
          rgba(
            127,
            29,
            29,
            0.16
          );

        border:
          1px solid
          rgba(
            248,
            113,
            113,
            0.2
          );

        border-radius: 12px;

        padding:
          12px
          13px;
      }

      .ss-error-icon {
        display: inline-flex;

        align-items: center;

        justify-content: center;

        width: 20px;

        height: 20px;

        border-radius: 50%;

        background:
          rgba(
            248,
            113,
            113,
            0.12
          );

        margin-right: 5px;
      }

      .ss-error strong {
        color:
          #fecaca;
      }

      .ss-error p {
        margin:
          7px 0 0;
      }

      /* ---------------------------------------------------------------
         LOADING
      --------------------------------------------------------------- */

      .ss-loading-message {
        flex-direction: row;

        align-items: center;

        gap: 9px;

        max-width: 100%;
      }

      .ss-loading-avatar {
        width: 28px;

        height: 28px;

        flex-shrink: 0;

        display: flex;

        align-items: center;

        justify-content: center;

        border-radius: 9px;

        background:
          #242424;

        color:
          #ff6b35;

        font-size: 12px;
      }

      .ss-loading-content {
        padding:
          7px
          0;
      }

      .ss-loading-text {
        font-size: 11px;

        color:
          #858585;

        margin-bottom: 5px;
      }

      .ss-loading-dots {
        display: flex;

        gap: 4px;
      }

      .ss-loading-dots span {
        width: 5px;

        height: 5px;

        border-radius: 50%;

        background:
          #ff6b35;

        animation:
          ss-bounce
          1.1s
          infinite
          ease-in-out;
      }

      .ss-loading-dots span:nth-child(2) {
        animation-delay:
          0.15s;
      }

      .ss-loading-dots span:nth-child(3) {
        animation-delay:
          0.3s;
      }

      @keyframes ss-bounce {
        0%,
        80%,
        100% {
          transform:
            translateY(0);

          opacity:
            0.45;
        }

        40% {
          transform:
            translateY(-4px);

          opacity:
            1;
        }
      }

      /* ---------------------------------------------------------------
         INPUT
      --------------------------------------------------------------- */

      .ss-input-row {
        display: flex;

        align-items: flex-end;

        gap: 8px;

        padding:
          12px
          14px;

        border-top:
          1px solid
          rgba(
            255,
            255,
            255,
            0.07
          );

        background:
          #151515;

        flex-shrink: 0;
      }

      .ss-input {
        flex: 1 1 auto;

        resize: none;

        background:
          #1d1d1d;

        border:
          1px solid
          #303030;

        border-radius:
          12px;

        padding:
          10px
          12px;

        font-size: 12.5px;

        color:
          #eeeeee;

        line-height: 1.45;

        max-height: 96px;

        outline: none;

        transition:
          border-color
          0.15s ease,
          background
          0.15s ease;
      }

      .ss-input:focus {
        border-color:
          rgba(
            255,
            107,
            53,
            0.85
          );

        background:
          #202020;
      }

      .ss-input::placeholder {
        color:
          #666;
      }

      .ss-send-btn {
        width: 37px;

        height: 37px;

        border-radius:
          10px;

        border: none;

        background:
          #ff6b35;

        color:
          #151515;

        font-size: 17px;

        font-weight: 800;

        cursor: pointer;

        flex-shrink: 0;

        display: flex;

        align-items: center;

        justify-content: center;

        transition:
          background
          0.15s ease,
          transform
          0.15s ease,
          opacity
          0.15s ease;
      }

      .ss-send-btn:hover:not(:disabled) {
        background:
          #ff7b4a;

        transform:
          translateY(-1px);
      }

      .ss-send-btn:active:not(:disabled) {
        transform:
          translateY(0);
      }

      .ss-send-btn:disabled {
        opacity:
          0.3;

        cursor:
          not-allowed;
      }

      /* ---------------------------------------------------------------
         MINIMIZED BUBBLE
      --------------------------------------------------------------- */

      .ss-bubble {
        display: none;

        position: fixed;

        bottom: 24px;

        right: 24px;

        align-items: center;

        gap: 8px;

        background:
          #191919;

        color:
          #eeeeee;

        border:
          1px solid
          #333;

        border-radius:
          999px;

        padding:
          10px
          15px;

        font-size: 12px;

        font-weight: 650;

        cursor: pointer;

        box-shadow:
          0 12px 30px
          rgba(
            0,
            0,
            0,
            0.4
          );

        z-index:
          2147483647;

        transition:
          transform
          0.18s ease,
          border-color
          0.18s ease;
      }

      .ss-bubble:hover {
        transform:
          translateY(-2px);

        border-color:
          #ff6b35;
      }

      .ss-bubble.ss-visible {
        display: flex;
      }

      .ss-bubble-icon {
        width: 23px;

        height: 23px;

        display: flex;

        align-items: center;

        justify-content: center;

        border-radius:
          7px;

        background:
          #ff6b35;

        color:
          #151515;

        font-size: 14px;

        font-weight: 800;
      }

      /* ---------------------------------------------------------------
         RESPONSIVE
      --------------------------------------------------------------- */

      @media (max-width: 700px) {
        .ss-panel {
          right: 10px;

          left: 10px;

          width: auto;

          top: 10px;

          bottom: 10px;

          max-height:
            calc(100vh - 20px);

          border-radius:
            16px;
        }

        .ss-bubble {
          right: 16px;

          bottom: 16px;
        }
      }
    `;
  }

  /* -----------------------------------------------------------------------
     INITIALIZATION
  ----------------------------------------------------------------------- */

  // Build the UI after the page is idle.
  // We don't automatically open it.
  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        buildUI();
      }
    );
  } else {
    buildUI();
  }
})();
