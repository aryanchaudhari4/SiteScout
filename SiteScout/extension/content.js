// content.js
//
// Injects the SiteScout AI overlay into the current webpage. The overlay
// lives inside a Shadow DOM so the host page's CSS cannot leak in (and
// SiteScout's styles cannot leak out onto the page). It talks to the
// existing FastAPI backend through background.js, using the same
// { text, query, session_id } contract the extension has always used.
//
// This script is auto-injected on every page (see manifest.json). It stays
// idle until the popup asks it to open the overlay.

(function () {
  "use strict";

  // Guard against double-injection (e.g. if the script is ever injected
  // programmatically in addition to the declarative content_scripts entry).
  if (window.__sitescoutInjected) return;
  window.__sitescoutInjected = true;

  const SESSION_STORAGE_KEY = "sitescout_session_id";
  const MIN_PAGE_TEXT_LENGTH = 40;

  const SUGGESTED_PROMPTS = [
    { icon: "📝", text: "Summarize this page" },
    { icon: "🔑", text: "What are the key points?" },
    { icon: "💡", text: "Explain this page simply" },
    { icon: "🎯", text: "What is the main idea?" },
    { icon: "🔍", text: "Find important information" }
  ];

  /** ---------------------------------------------------------------------
   * State
   * ------------------------------------------------------------------- */

  const state = {
    open: false,
    minimized: false,
    loading: false,
    messages: [] // { id, role: 'user' | 'assistant', text, error, source }
  };

  let sessionId = getOrCreateSessionId();
  let msgIdCounter = 0;

  // DOM references, populated once buildUI() runs.
  let host, shadow;
  let panelEl, bubbleEl, messagesEl, welcomeEl, inputEl, sendBtn, statusDot;
  let loadingBubbleEl = null;

  /** ---------------------------------------------------------------------
   * Session handling (frontend-only "memory reset" for Clear chat)
   * ------------------------------------------------------------------- */

  function getOrCreateSessionId() {
    try {
      let id = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!id) {
        id = generateSessionId();
        sessionStorage.setItem(SESSION_STORAGE_KEY, id);
      }
      return id;
    } catch (e) {
      return generateSessionId();
    }
  }

  function generateSessionId() {
    return "ss_" + Math.random().toString(36).slice(2) + "_" + Date.now();
  }

  function resetSessionId() {
    sessionId = generateSessionId();
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } catch (e) {
      /* sessionStorage may be unavailable on some pages; safe to ignore */
    }
  }

  /** ---------------------------------------------------------------------
   * Page content extraction
   * ------------------------------------------------------------------- */

  function extractPageContent() {
    if (!document.body) return "";
    return document.body.innerText.trim();
  }

  function getPageDomain() {
    try {
      return location.hostname || location.href;
    } catch (e) {
      return "this page";
    }
  }

  /** ---------------------------------------------------------------------
   * Building the UI (Shadow DOM)
   * ------------------------------------------------------------------- */

  function buildUI() {
    host = document.createElement("div");
    host.id = "sitescout-host";
    host.style.all = "initial";
    (document.documentElement || document.body).appendChild(host);

    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = getStyles();
    shadow.appendChild(style);

    shadow.appendChild(buildBubble());
    shadow.appendChild(buildPanel());

    updateVisibility();
  }

  function buildBubble() {
    bubbleEl = document.createElement("button");
    bubbleEl.className = "ss-bubble";
    bubbleEl.type = "button";
    bubbleEl.title = "Open SiteScout";
    bubbleEl.innerHTML = `<span class="ss-bubble-icon">🔎</span><span>SiteScout</span>`;
    bubbleEl.addEventListener("click", () => {
      state.minimized = false;
      state.open = true;
      updateVisibility();
      triggerOpenAnimation();
      focusInput();
    });
    return bubbleEl;
  }

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

  function buildHeader() {
    const header = document.createElement("div");
    header.className = "ss-header";

    const titleBlock = document.createElement("div");
    titleBlock.className = "ss-header-title";
    titleBlock.innerHTML = `
      <div class="ss-title-row">
        <span class="ss-logo">🔎</span>
        <span class="ss-title">SiteScout</span>
      </div>
      <div class="ss-subtitle">AI assistant for this webpage</div>
    `;

    const controls = document.createElement("div");
    controls.className = "ss-header-controls";

    const clearBtn = makeIconButton("🗑", "Clear conversation", () => {
      clearConversation();
    });
    const minimizeBtn = makeIconButton("−", "Minimize", () => {
      state.minimized = true;
      updateVisibility();
    });
    const closeBtn = makeIconButton("×", "Close", () => {
      state.open = false;
      state.minimized = false;
      updateVisibility();
    });
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
    btn.setAttribute("aria-label", title);
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

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

  function buildInputRow() {
    const row = document.createElement("div");
    row.className = "ss-input-row";

    inputEl = document.createElement("textarea");
    inputEl.className = "ss-input";
    inputEl.placeholder = "Ask about this page...";
    inputEl.rows = 1;
    inputEl.addEventListener("input", () => {
      autoGrowInput();
      updateSendButtonState();
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitQuery();
      }
    });

    sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "ss-send-btn";
    sendBtn.title = "Send";
    sendBtn.setAttribute("aria-label", "Send");
    sendBtn.innerHTML = "➤";
    sendBtn.disabled = true;
    sendBtn.addEventListener("click", submitQuery);

    row.appendChild(inputEl);
    row.appendChild(sendBtn);
    return row;
  }

  function autoGrowInput() {
    inputEl.style.height = "auto";
    const maxHeight = 96;
    inputEl.style.height = Math.min(inputEl.scrollHeight, maxHeight) + "px";
  }

  function updateSendButtonState() {
    const hasText = inputEl.value.trim().length > 0;
    sendBtn.disabled = !hasText || state.loading;
  }

  function focusInput() {
    setTimeout(() => inputEl && inputEl.focus(), 50);
  }

  /** ---------------------------------------------------------------------
   * Dragging (header repositions the panel)
   * ------------------------------------------------------------------- */

  function makeDraggable(handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startTop = 0;

    handle.addEventListener("mousedown", (e) => {
      // Don't start a drag from the control buttons.
      if (e.target.closest(".ss-icon-btn")) return;
      dragging = true;
      const rect = panelEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startRight = window.innerWidth - rect.right;
      startTop = rect.top;
      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragEnd);
      e.preventDefault();
    });

    function onDragMove(e) {
      if (!dragging) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      const newRight = Math.max(8, startRight - deltaX);
      const newTop = Math.max(8, startTop + deltaY);
      panelEl.style.right = newRight + "px";
      panelEl.style.top = newTop + "px";
      panelEl.style.bottom = "auto";
    }

    function onDragEnd() {
      dragging = false;
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);
    }
  }

  /** ---------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------- */

  function updateVisibility() {
    if (!panelEl) return;
    panelEl.classList.toggle("ss-visible", state.open && !state.minimized);
    bubbleEl.classList.toggle("ss-visible", state.open && state.minimized);
  }

  function triggerOpenAnimation() {
    if (!panelEl) return;
    // Remove and re-add the class (forcing a reflow in between) so the
    // pop-in animation replays every time the panel opens, not just the
    // first time.
    panelEl.classList.remove("ss-animate-in");
    void panelEl.offsetWidth;
    panelEl.classList.add("ss-animate-in");
  }

  function renderWelcome() {
    messagesEl.innerHTML = "";
    welcomeEl = document.createElement("div");
    welcomeEl.className = "ss-welcome";
    welcomeEl.innerHTML = `
      <div class="ss-welcome-icon">🔎</div>
      <div class="ss-welcome-title">Welcome to SiteScout</div>
      <div class="ss-welcome-text">Your AI assistant for understanding the webpage you're currently viewing.</div>
      <div class="ss-welcome-label">Try asking:</div>
    `;
    const promptsWrap = document.createElement("div");
    promptsWrap.className = "ss-suggested-prompts";
    SUGGESTED_PROMPTS.forEach((prompt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ss-suggested-prompt";
      btn.innerHTML = `<span class="ss-prompt-icon">${prompt.icon}</span><span>${prompt.text}</span>`;
      btn.addEventListener("click", () => submitQuery(prompt.text));
      promptsWrap.appendChild(btn);
    });
    welcomeEl.appendChild(promptsWrap);
    messagesEl.appendChild(welcomeEl);
  }

  function clearWelcomeIfPresent() {
    if (welcomeEl && welcomeEl.parentNode) {
      welcomeEl.parentNode.removeChild(welcomeEl);
      welcomeEl = null;
    }
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function formatInline(text) {
    // Escape first so nothing in the model's output can inject markup,
    // then re-introduce a couple of safe, simple formatting affordances.
    return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  // Turns plain-text answers (including "- point one" / "1. point one"
  // style lists that LLMs commonly produce) into real, nicely styled
  // paragraphs and bullet lists instead of one flat block of text.
  function formatAnswerHtml(text) {
    const lines = text.split(/\r?\n/);
    let html = "";
    let listBuffer = [];

    function flushList() {
      if (listBuffer.length) {
        html += `<ul class="ss-answer-list">${listBuffer
          .map((item) => `<li>${item}</li>`)
          .join("")}</ul>`;
        listBuffer = [];
      }
    }

    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) {
        flushList();
        return;
      }
      const bulletMatch = line.match(/^[-*•]\s+(.*)/);
      const numberedMatch = line.match(/^\d+[.)]\s+(.*)/);
      if (bulletMatch) {
        listBuffer.push(formatInline(bulletMatch[1]));
      } else if (numberedMatch) {
        listBuffer.push(formatInline(numberedMatch[1]));
      } else {
        flushList();
        html += `<p class="ss-answer-p">${formatInline(line)}</p>`;
      }
    });
    flushList();
    return html;
  }

  function appendUserMessage(text) {
    clearWelcomeIfPresent();
    const bubble = document.createElement("div");
    bubble.className = "ss-message ss-message-user";
    const textEl = document.createElement("div");
    textEl.className = "ss-message-text";
    textEl.textContent = text;
    bubble.appendChild(textEl);
    messagesEl.appendChild(bubble);
    scrollToBottom();
  }

  function appendAssistantMessage({ text, error, source }) {
    clearWelcomeIfPresent();
    const bubble = document.createElement("div");
    bubble.className = "ss-message ss-message-assistant";

    if (error) {
      const errorEl = document.createElement("div");
      errorEl.className = "ss-error";
      errorEl.innerHTML = errorContentFor(error);
      bubble.appendChild(errorEl);
      messagesEl.appendChild(bubble);
      scrollToBottom();
      return;
    }

    const textEl = document.createElement("div");
    textEl.className = "ss-message-text";
    textEl.innerHTML = formatAnswerHtml(text);
    bubble.appendChild(textEl);

    const footer = document.createElement("div");
    footer.className = "ss-message-footer";

    if (source) {
      const sourceEl = document.createElement("span");
      sourceEl.className = "ss-source-badge";
      sourceEl.textContent = source === "web_search" ? "🌐 Web search" : "📄 Current page";
      footer.appendChild(sourceEl);
    }

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "ss-copy-btn";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => copyAnswer(text, copyBtn));
    footer.appendChild(copyBtn);

    bubble.appendChild(footer);
    messagesEl.appendChild(bubble);
    scrollToBottom();
  }

  function errorContentFor(error) {
    if (error === "not_enough_content") {
      return `⚠️ <strong>Not enough page content</strong><br>SiteScout couldn't find enough readable content on this page.`;
    }
    if (error === "connection") {
      return `⚠️ <strong>Unable to connect</strong><br>SiteScout couldn't reach the backend. Please make sure the server is running and try again.`;
    }
    return `Something went wrong.<br>Please try again.`;
  }

  function copyAnswer(text, btn) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        const original = btn.textContent;
        btn.textContent = "Copied ✓";
        setTimeout(() => {
          btn.textContent = original;
        }, 1500);
      })
      .catch(() => {
        /* clipboard API may be unavailable; fail silently */
      });
  }

  function showLoadingBubble() {
    hideLoadingBubble();
    loadingBubbleEl = document.createElement("div");
    loadingBubbleEl.className = "ss-message ss-message-assistant ss-loading-message";
    loadingBubbleEl.innerHTML = `
      <div class="ss-loading-text">SiteScout is reading this page...</div>
      <div class="ss-loading-dots"><span></span><span></span><span></span></div>
    `;
    messagesEl.appendChild(loadingBubbleEl);
    scrollToBottom();
  }

  function hideLoadingBubble() {
    if (loadingBubbleEl && loadingBubbleEl.parentNode) {
      loadingBubbleEl.parentNode.removeChild(loadingBubbleEl);
    }
    loadingBubbleEl = null;
  }

  function clearConversation() {
    state.messages = [];
    hideLoadingBubble();
    resetSessionId();
    renderWelcome();
  }

  /** ---------------------------------------------------------------------
   * Sending a query
   * ------------------------------------------------------------------- */

  function submitQuery(prefilledText) {
    const query = (typeof prefilledText === "string" ? prefilledText : inputEl.value).trim();
    if (!query || state.loading) return;

    if (typeof prefilledText !== "string") {
      inputEl.value = "";
      autoGrowInput();
    }
    updateSendButtonState();

    appendUserMessage(query);
    state.messages.push({ id: ++msgIdCounter, role: "user", text: query });

    const pageText = extractPageContent();
    if (pageText.length < MIN_PAGE_TEXT_LENGTH) {
      appendAssistantMessage({ error: "not_enough_content" });
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

    // Defensive fallback: if the background worker never responds
    // (e.g. it was asleep and failed to wake), don't leave the user
    // staring at a spinner forever.
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

    if (chrome.runtime.lastError || !response || !response.ok) {
      console.error(
        "SiteScout: chat request failed —",
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
          (response && response.error) ||
          "no response from background worker"
      );
      appendAssistantMessage({ error: "connection" });
      return;
    }

    const answer = response.data && response.data.answer;
    if (typeof answer !== "string") {
      console.error("SiteScout: unexpected response shape from backend —", response.data);
      appendAssistantMessage({ error: "unexpected" });
      return;
    }

    // The current backend only returns { answer }. If a future backend
    // version adds a "source" field, it will be picked up automatically
    // without requiring another frontend change.
    const source = response.data.source;

    state.messages.push({ id: ++msgIdCounter, role: "assistant", text: answer, source });
    appendAssistantMessage({ text: answer, source });
  }

  /** ---------------------------------------------------------------------
   * Messaging with the popup
   * ------------------------------------------------------------------- */

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "sitescout:toggle") return false;

    if (!host) buildUI();

    state.open = true;
    state.minimized = false;
    updateVisibility();
    triggerOpenAnimation();
    focusInput();

    sendResponse({ ok: true });
    return false;
  });

  /** ---------------------------------------------------------------------
   * Styles
   * ------------------------------------------------------------------- */

  function getStyles() {
    return `
      :host {
        all: initial;
      }
      * {
        box-sizing: border-box;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      .ss-panel {
        display: none;
        flex-direction: column;
        position: fixed;
        top: 72px;
        right: 20px;
        bottom: 20px;
        width: 380px;
        max-height: calc(100vh - 92px);
        background: #191919;
        color: #ecebe8;
        border-radius: 16px;
        box-shadow: 0 20px 45px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.3);
        z-index: 2147483647;
        overflow: hidden;
        border: 1px solid #2e2e2e;
      }
      .ss-panel.ss-visible {
        display: flex;
      }
      .ss-panel.ss-animate-in {
        animation: ss-panel-pop 0.32s cubic-bezier(0.16, 1, 0.3, 1);
        transform-origin: bottom right;
      }
      @keyframes ss-panel-pop {
        from {
          opacity: 0;
          transform: scale(0.9) translateY(18px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      .ss-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 14px 14px 12px 16px;
        border-bottom: 1px solid #2e2e2e;
        cursor: grab;
        flex-shrink: 0;
      }
      .ss-header:active {
        cursor: grabbing;
      }
      .ss-title-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .ss-logo {
        font-size: 15px;
      }
      .ss-title {
        font-size: 15px;
        font-weight: 700;
        color: #ecebe8;
      }
      .ss-subtitle {
        font-size: 11.5px;
        color: #8b8b8b;
        margin-top: 2px;
      }
      .ss-header-controls {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .ss-icon-btn {
        width: 26px;
        height: 26px;
        border-radius: 6px;
        border: none;
        background: transparent;
        color: #b0b0b0;
        font-size: 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .ss-icon-btn:hover {
        background: #2a2a2a;
        color: #ecebe8;
      }
      .ss-close-btn {
        font-size: 18px;
      }

      .ss-page-info {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        font-size: 11.5px;
        color: #8b8b8b;
        border-bottom: 1px solid #232323;
        flex-shrink: 0;
      }
      .ss-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #4ade80;
        flex-shrink: 0;
      }
      .ss-page-domain {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ss-messages {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
      }
      .ss-messages::-webkit-scrollbar {
        width: 6px;
      }
      .ss-messages::-webkit-scrollbar-thumb {
        background: #333;
        border-radius: 3px;
      }

      .ss-welcome {
        text-align: center;
        padding: 18px 6px 4px;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .ss-welcome-icon {
        font-size: 26px;
        margin-bottom: 10px;
      }
      .ss-welcome-title {
        font-size: 15px;
        font-weight: 700;
        color: #ecebe8;
        margin-bottom: 8px;
      }
      .ss-welcome-text {
        font-size: 12.5px;
        color: #9b9b9b;
        line-height: 1.5;
        max-width: 280px;
        margin-bottom: 16px;
      }
      .ss-welcome-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: #6b6b6b;
        margin-bottom: 10px;
      }
      .ss-suggested-prompts {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
      }
      .ss-suggested-prompt {
        display: flex;
        align-items: center;
        gap: 9px;
        background: #222222;
        border: 1px solid #2e2e2e;
        color: #ecebe8;
        border-radius: 8px;
        padding: 9px 12px;
        font-size: 12.5px;
        text-align: left;
        cursor: pointer;
        transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
      }
      .ss-suggested-prompt:hover {
        border-color: #ff6b35;
        background: #262626;
        transform: translateX(2px);
      }
      .ss-prompt-icon {
        font-size: 13px;
        flex-shrink: 0;
      }

      .ss-message {
        max-width: 88%;
        display: flex;
        flex-direction: column;
        gap: 6px;
        animation: ss-message-in 0.22s ease-out;
      }
      @keyframes ss-message-in {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
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
        line-height: 1.55;
        white-space: pre-wrap;
        padding: 10px 12px;
        border-radius: 10px;
      }
      .ss-message-user .ss-message-text {
        background: #ff6b35;
        color: #191919;
        font-weight: 500;
        border-bottom-right-radius: 3px;
      }
      .ss-message-assistant .ss-message-text {
        background: #222222;
        border: 1px solid #2e2e2e;
        color: #e2e8f0;
        border-bottom-left-radius: 3px;
      }
      .ss-answer-p {
        margin: 0 0 8px 0;
      }
      .ss-answer-p:last-child {
        margin-bottom: 0;
      }
      .ss-answer-list {
        margin: 0 0 8px 0;
        padding-left: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .ss-answer-list:last-child {
        margin-bottom: 0;
      }
      .ss-answer-list li {
        position: relative;
        padding-left: 16px;
      }
      .ss-answer-list li::before {
        content: "•";
        position: absolute;
        left: 0;
        color: #ff6b35;
        font-weight: 700;
      }
      .ss-message-text strong {
        color: #ffffff;
        font-weight: 700;
      }

      .ss-message-footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-left: 2px;
      }
      .ss-source-badge {
        font-size: 10.5px;
        color: #8b8b8b;
        background: #202020;
        border: 1px solid #2a2a2a;
        border-radius: 999px;
        padding: 2px 8px;
      }
      .ss-copy-btn {
        font-size: 10.5px;
        color: #8b8b8b;
        background: transparent;
        border: 1px solid #2a2a2a;
        border-radius: 999px;
        padding: 2px 9px;
        cursor: pointer;
        transition: color 0.15s ease, border-color 0.15s ease;
      }
      .ss-copy-btn:hover {
        color: #ecebe8;
        border-color: #ff6b35;
      }

      .ss-error {
        font-size: 12.5px;
        line-height: 1.6;
        color: #f87171;
        background: #2a1818;
        border: 1px solid #4a2222;
        border-radius: 10px;
        padding: 10px 12px;
      }

      .ss-loading-message {
        opacity: 0.9;
      }
      .ss-loading-text {
        font-size: 12px;
        color: #9b9b9b;
        margin-bottom: 6px;
      }
      .ss-loading-dots {
        display: flex;
        gap: 4px;
      }
      .ss-loading-dots span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #ff6b35;
        animation: ss-bounce 1.1s infinite ease-in-out;
      }
      .ss-loading-dots span:nth-child(2) { animation-delay: 0.15s; }
      .ss-loading-dots span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes ss-bounce {
        0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
        40% { transform: translateY(-4px); opacity: 1; }
      }

      .ss-input-row {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 12px 14px;
        border-top: 1px solid #2e2e2e;
        flex-shrink: 0;
      }
      .ss-input {
        flex: 1 1 auto;
        resize: none;
        background: #222222;
        border: 1.5px solid #2e2e2e;
        border-radius: 10px;
        padding: 9px 11px;
        font-size: 13px;
        color: #ecebe8;
        line-height: 1.4;
        max-height: 96px;
        transition: border-color 0.15s ease;
      }
      .ss-input:focus {
        outline: none;
        border-color: #ff6b35;
      }
      .ss-input::placeholder {
        color: #7a7a7a;
      }
      .ss-send-btn {
        width: 34px;
        height: 34px;
        border-radius: 9px;
        border: none;
        background: #ff6b35;
        color: #191919;
        font-size: 14px;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.15s ease, opacity 0.15s ease;
      }
      .ss-send-btn:hover:not(:disabled) {
        background: #e55a2b;
      }
      .ss-send-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .ss-bubble {
        display: none;
        position: fixed;
        bottom: 24px;
        right: 24px;
        align-items: center;
        gap: 7px;
        background: #191919;
        color: #ecebe8;
        border: 1px solid #2e2e2e;
        border-radius: 999px;
        padding: 10px 16px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
        z-index: 2147483647;
      }
      .ss-bubble.ss-visible {
        display: flex;
      }
      .ss-bubble-icon {
        font-size: 14px;
      }

      @media (max-width: 480px) {
        .ss-panel {
          right: 10px;
          left: 10px;
          width: auto;
          top: 10px;
          bottom: 10px;
          max-height: calc(100vh - 20px);
        }
      }
    `;
  }
})();
