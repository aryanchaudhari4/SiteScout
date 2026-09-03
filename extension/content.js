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

  const LOGO_URL = chrome.runtime.getURL("icon.png");

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
    host.style.position = "fixed";
    host.style.top = "0";
    host.style.right = "0";
    host.style.width = "470px";
    host.style.height = "100vh";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";

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
      <img class="ss-bubble-logo" src="${LOGO_URL}" alt="SiteScout">
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
        <img class="ss-logo" src="${LOGO_URL}" alt="SiteScout">
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
    if (!panelEl || !bubbleEl || !host) {
      return;
    }

    const panelVisible =
      state.open && !state.minimized;

    const bubbleVisible =
      state.open && state.minimized;

    panelEl.classList.toggle(
      "ss-visible",
      panelVisible
    );

    bubbleEl.classList.toggle(
      "ss-visible",
      bubbleVisible
    );

    // The host never intercepts the webpage while SiteScout is closed.
    // When open, only the narrow right-side SiteScout rail is interactive.
    host.style.pointerEvents =
      state.open ? "auto" : "none";
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
        <img src="${LOGO_URL}" alt="SiteScout">
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
        <img src="${LOGO_URL}" alt="SiteScout">
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
}, 120000);
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
        display: block;
        pointer-events: none;
      }

      * {
        box-sizing: border-box;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      button, textarea { font: inherit; }
      button { -webkit-tap-highlight-color: transparent; }

      .ss-panel {
        display: none;
        flex-direction: column;
        position: fixed;
        top: 18px;
        right: 18px;
        bottom: 18px;
        width: 430px;
        max-height: calc(100vh - 36px);
        color: #f8fafc;
        background:
          radial-gradient(circle at 85% 0%, rgba(124,58,237,.20), transparent 34%),
          radial-gradient(circle at 0% 100%, rgba(6,182,212,.12), transparent 30%),
          #0b1020;
        border: 1px solid rgba(255,255,255,.11);
        border-radius: 24px;
        box-shadow: 0 30px 90px rgba(0,0,0,.48), 0 8px 30px rgba(0,0,0,.28);
        z-index: 2147483647;
        overflow: hidden;
        backdrop-filter: blur(22px);
        pointer-events: auto;
        user-select: text;
        -webkit-user-select: text;
      }

      .ss-panel.ss-visible { display: flex; }
      .ss-panel.ss-animate-in { animation: ss-panel-pop .34s cubic-bezier(.16,1,.3,1); }
      @keyframes ss-panel-pop {
        from { opacity: 0; transform: translateX(22px) scale(.97); }
        to { opacity: 1; transform: translateX(0) scale(1); }
      }

      .ss-header {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 18px 18px 15px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.025);
        cursor: grab;
      }
      .ss-header:active { cursor: grabbing; }
      .ss-header-title { min-width: 0; }
      .ss-title-row { display:flex; align-items:center; gap:10px; }
      .ss-logo {
        width:36px; height:36px; display:block; flex:0 0 36px;
        border-radius:12px; object-fit:cover;
        box-shadow:0 8px 24px rgba(124,58,237,.32);
      }
      .ss-title { font-size:17px; font-weight:800; letter-spacing:-.45px; }
      .ss-subtitle { margin:4px 0 0 46px; font-size:10px; color:#94a3b8; }
      .ss-header-controls { display:flex; gap:5px; }
      .ss-icon-btn {
        width:30px; height:30px; border:1px solid rgba(255,255,255,.08); border-radius:9px;
        background:rgba(255,255,255,.045); color:#94a3b8; cursor:pointer; font-size:15px;
        display:flex; align-items:center; justify-content:center; transition:.18s ease;
        pointer-events:auto;
      }
      .ss-icon-btn:hover { color:#fff; background:rgba(255,255,255,.10); border-color:rgba(255,255,255,.16); transform:translateY(-1px); }
      .ss-close-btn:hover { background:rgba(244,63,94,.15); color:#fb7185; }

      .ss-page-info {
        flex-shrink:0; display:flex; align-items:center; gap:7px; margin:12px 18px 0;
        padding:8px 10px; border:1px solid rgba(255,255,255,.07); border-radius:10px;
        background:rgba(255,255,255,.035); min-width:0;
      }
      .ss-status-dot { width:7px; height:7px; border-radius:50%; background:#34d399; box-shadow:0 0 10px rgba(52,211,153,.65); flex-shrink:0; }
      .ss-page-domain { color:#94a3b8; font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

      .ss-messages {
        flex:1 1 0; min-height:0; max-height:none; overflow-x:hidden; overflow-y:auto;
        overscroll-behavior:contain; -webkit-overflow-scrolling:touch; padding:18px;
        display:flex; flex-direction:column; gap:13px; scrollbar-width:thin; pointer-events:auto;
      }
      .ss-messages::-webkit-scrollbar { width:6px; }
      .ss-messages::-webkit-scrollbar-thumb { background:rgba(148,163,184,.28); border-radius:99px; }

      .ss-welcome { margin:auto 0; padding:4px 0 10px; text-align:center; }
      .ss-welcome-icon {
        width:58px; height:58px; margin:0 auto 15px; display:flex;
        align-items:center; justify-content:center; overflow:hidden;
        border-radius:18px; background:#070d1f;
        box-shadow:0 16px 40px rgba(6,182,212,.18);
      }
      .ss-welcome-icon img {
        width:100%; height:100%; display:block; object-fit:cover;
        border-radius:inherit;
      }
      .ss-welcome-title { font-size:20px; font-weight:800; letter-spacing:-.6px; }
      .ss-welcome-text { max-width:330px; margin:7px auto 20px; color:#94a3b8; font-size:11px; line-height:1.55; }
      .ss-welcome-label { margin-bottom:8px; text-align:left; color:#64748b; font-size:8px; font-weight:800; letter-spacing:1.2px; }
      .ss-suggested-prompts { display:flex; flex-direction:column; gap:8px; }
      .ss-suggested-prompt {
        width:100%; min-height:52px; display:flex; align-items:center; gap:10px; padding:10px 12px;
        border:1px solid rgba(255,255,255,.08); border-radius:13px; background:rgba(255,255,255,.045);
        color:#e2e8f0; cursor:pointer; text-align:left; transition:.18s ease; pointer-events:auto;
      }
      .ss-suggested-prompt:hover { transform:translateY(-2px); border-color:rgba(124,58,237,.55); background:rgba(124,58,237,.10); box-shadow:0 10px 25px rgba(0,0,0,.18); }
      .ss-prompt-icon { width:29px; height:29px; display:flex; align-items:center; justify-content:center; flex-shrink:0; border-radius:9px; color:#c4b5fd; background:rgba(124,58,237,.14); }
      .ss-prompt-arrow { margin-left:auto; color:#64748b; font-size:15px; transition:.18s; }
      .ss-suggested-prompt:hover .ss-prompt-arrow { color:#c4b5fd; transform:translateX(3px); }

      .ss-bubble { display:none; position:fixed; right:22px; bottom:22px; z-index:2147483647; align-items:center; gap:8px; padding:8px 12px 8px 8px; border:1px solid rgba(255,255,255,.12); border-radius:15px; background:#0b1020; color:#f8fafc; box-shadow:0 16px 45px rgba(0,0,0,.4); cursor:pointer; pointer-events:auto; }
      .ss-bubble.ss-visible { display:flex; }
      .ss-bubble-logo { width:27px; height:27px; flex:0 0 27px; object-fit:cover; border-radius:9px; display:block; }

      .ss-loading-avatar { width:30px; height:30px; flex:0 0 30px; border-radius:10px; overflow:hidden; box-shadow:0 8px 20px rgba(124,58,237,.22); }
      .ss-loading-avatar img { width:100%; height:100%; display:block; object-fit:cover; }

      .ss-input-row { position:relative; z-index:2; flex-shrink:0; display:flex; align-items:flex-end; gap:8px; padding:12px 14px 14px; border-top:1px solid rgba(255,255,255,.08); background:rgba(8,13,28,.92); pointer-events:auto; }
      .ss-input { min-width:0; flex:1 1 auto; resize:none; max-height:96px; min-height:42px; outline:none; padding:11px 12px; border:1px solid rgba(255,255,255,.09); border-radius:12px; background:rgba(255,255,255,.055); color:#f8fafc; font-size:11px; line-height:1.45; pointer-events:auto; user-select:text; -webkit-user-select:text; }
      .ss-input:focus { border-color:rgba(124,58,237,.75); box-shadow:0 0 0 3px rgba(124,58,237,.10); }
      .ss-input::placeholder { color:#64748b; }
      .ss-send-btn { width:42px; height:42px; flex-shrink:0; border:0; border-radius:12px; background:linear-gradient(135deg,#7c3aed,#06b6d4); color:#fff; font-size:18px; font-weight:800; cursor:pointer; box-shadow:0 8px 22px rgba(124,58,237,.22); pointer-events:auto; }
      .ss-send-btn:disabled { opacity:.35; cursor:not-allowed; box-shadow:none; }
      .ss-send-btn:not(:disabled):hover { transform:translateY(-1px); filter:brightness(1.08); }

      .ss-user-message { align-self:flex-end; max-width:88%; padding:10px 12px; border-radius:14px 14px 4px 14px; background:linear-gradient(135deg,#6d28d9,#0891b2); color:#fff; font-size:11px; line-height:1.5; word-break:break-word; pointer-events:auto; }
      .ss-assistant-message { align-self:flex-start; max-width:94%; padding:12px 13px; border:1px solid rgba(255,255,255,.07); border-radius:14px 14px 14px 4px; background:rgba(255,255,255,.045); color:#dbe4f0; font-size:11px; line-height:1.65; word-break:break-word; pointer-events:auto; }
      .ss-answer-list { margin:7px 0; padding-left:19px; }
      .ss-assistant-message strong { color:#fff; }
      .ss-loading { align-self:flex-start; padding:11px 13px; border:1px solid rgba(255,255,255,.07); border-radius:14px; background:rgba(255,255,255,.045); color:#94a3b8; font-size:10px; }
      .ss-loading-dots { display:inline-flex; gap:4px; }
      .ss-loading-dots span { width:5px; height:5px; border-radius:50%; background:#a78bfa; animation:ss-dot 1s infinite ease-in-out; }
      .ss-loading-dots span:nth-child(2) { animation-delay:.15s; } .ss-loading-dots span:nth-child(3) { animation-delay:.3s; }
      @keyframes ss-dot { 0%,80%,100%{transform:scale(.65);opacity:.4} 40%{transform:scale(1);opacity:1} }

      @media (max-width:700px) {
        .ss-panel { top:10px; right:10px; bottom:10px; width:calc(100vw - 20px); max-height:calc(100vh - 20px); border-radius:20px; }
      }
    `;
  }

  /* -----------------------------------------------------------------------
     INITIALIZATION
  ----------------------------------------------------------------------- */

  // Build the UI after the page is idle.
  // The popup action opens it automatically; direct page injection stays hidden.
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
