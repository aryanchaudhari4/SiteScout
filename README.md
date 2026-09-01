<div align="center">

# 🔍 SiteScout

### AI-Powered Chrome Extension for Instant Webpage Understanding

**Ask questions about *any* webpage — right where you're reading it.**

![Chrome Extension](https://img.shields.io/badge/Platform-Chrome%20Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Groq](https://img.shields.io/badge/LLM-Groq%20Llama%203.3-F55036?style=for-the-badge)
![FAISS](https://img.shields.io/badge/Vector%20Search-FAISS-00A67E?style=for-the-badge)

</div>

---

## 💡 What is SiteScout?

Ever read a long article, a dense research paper, or confusing documentation and wished you could just *ask* it something instead of Ctrl+F-ing your way through it?

**SiteScout** turns any webpage into an interactive AI assistant. Click the extension, and a floating chat panel opens **directly on top of the page** — powered by a **Retrieval-Augmented Generation (RAG)** pipeline that reads the page's content, embeds it, and answers your questions grounded in what's actually there. If the page doesn't have the answer, SiteScout automatically falls back to a live web search so you're never left hanging.

No tab-switching. No copy-pasting text into ChatGPT. Just ask, right there on the page.

---

## ✨ Key Features

| | |
|---|---|
| 🧠 **RAG-based Q&A** | Answers are grounded in the actual page content using FAISS vector retrieval |
| ⚡ **Blazing-fast LLM** | Powered by Groq's `llama-3.3-70b-versatile` for near-instant responses |
| 🌐 **Smart Web Fallback** | Automatically searches the web when the page alone can't answer |
| 💬 **Multi-turn Memory** | Remembers context within a session for natural follow-up questions |
| 🎨 **Shadow DOM Overlay** | A fully isolated in-page UI — no CSS conflicts with the host site, ever |
| 🔖 **Source Badges** | Every answer is tagged as coming from the **page** or the **web** |
| 📋 **Suggested Prompts** | One-click starter questions for common use cases |
| 📎 **Copy-to-Clipboard** | Grab any answer instantly |
| 🪟 **Persistent Panel** | Minimize, close, or reopen without losing your conversation |

---

## 🏗️ System Architecture

SiteScout is built as a clean, layered pipeline — from the browser UI down to vector search and LLM inference:

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension                      │
│                                                            │
│   Popup (popup.html/js)  →  lightweight launcher +        │
│                              backend health indicator      │
│                                                            │
│   Content Script (content.js)                              │
│      → Injects a Shadow DOM overlay on every page          │
│      → Extracts visible page text                          │
│      → Renders the chat UI                                 │
│                        ↓                                    │
│   Background Service Worker (background.js)                │
│      → Relays chat requests (bypasses page CSP issues)      │
└───────────────────────────┬─────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────┐
│                  FastAPI Backend  (/chat)                │
│                                                            │
│   Request → RAG Pipeline → FAISS + HuggingFace Embeddings  │
│                    ↓                                        │
│         Groq LLM  (llama-3.3-70b-versatile)                 │
│                    ↓                                        │
│      Web-Search Fallback (if page context insufficient)     │
│                    ↓                                        │
│              Response → rendered in overlay                 │
└─────────────────────────────────────────────────────────┘
```

**Why this design?**
- The **background worker** (not the content script) makes the network call — sidestepping strict page Content-Security-Policies that would otherwise block requests to `localhost`.
- The **Shadow DOM** overlay guarantees zero style leakage in either direction between SiteScout and the host page.
- **Per-session FAISS caching** means a page is embedded once, not on every single question — follow-ups reuse the cached index.

---

## 🛠️ Tech Stack

**Frontend / Extension**
`JavaScript` · `Chrome Extension APIs (Manifest V3)` · `Shadow DOM` · `Service Workers`

**Backend**
`Python` · `FastAPI` · `Uvicorn`

**AI / ML**
`RAG (Retrieval-Augmented Generation)` · `FAISS` (vector similarity search) · `HuggingFace Embeddings (BAAI/bge-small-en)` · `Groq LLM API (Llama 3.3 70B)`

---

## 🚀 Getting Started

### 1️⃣ Set up the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file inside `backend/`:

```env
GROQ_API_KEY=your_groq_api_key_here
```

Run the server:

```bash
uvicorn main:app --reload --port 8000
```

Backend will be live at `http://127.0.0.1:8000` — check `GET /health` for a quick status ping.

### 2️⃣ Load the extension in Chrome

1. Navigate to `chrome://extensions`
2. Toggle on **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Pin **SiteScout** to your toolbar for one-click access

### 3️⃣ Start asking questions

1. Open any article, blog, or docs page
2. Click the SiteScout icon → **Open SiteScout**
3. The overlay appears right on the page
4. Ask anything — or tap a suggested prompt to get started

---

## 📁 Project Structure

```
SiteScout/
├── backend/
│   ├── main.py                # FastAPI app — RAG + LLM + web-search fallback (/chat, /health)
│   ├── rag_prototype.py       # Standalone prototype script
│   └── requirements.txt
├── extension/
│   ├── manifest.json
│   ├── background.js          # Relays chat requests to the backend
│   ├── content.js             # Shadow DOM overlay + chat UI + page text extraction
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js                # Lightweight launcher + health check
│   └── icon.jpg
└── README.md
```

---

## 🔌 API Reference

**`POST /chat`**

```json
// Request
{
  "text": "current webpage text",
  "query": "user question",
  "session_id": "session identifier"
}

// Response
{
  "answer": "...",
  "source": "page | web_search"
}
```

**`GET /health`** → simple liveness check, used by the popup's status indicator.

---

## ⚙️ Engineering Highlights

A few things worth calling out for anyone reviewing the codebase:

- **Session-aware FAISS caching** avoids redundant re-embedding — the index is only rebuilt when the page content actually changes.
- **Graceful error handling** across the board: a missing API key, LLM failure, or web-search failure returns a clean `HTTPException` instead of a raw stack trace; empty inputs are rejected with a `400`.
- **Automatic session expiry** (2 hours of inactivity) prevents unbounded memory growth on a long-running server.
- **CSP-aware architecture** — network calls are deliberately routed through the background service worker to work reliably even on sites with strict security policies.

---

## 🗺️ Roadmap

- [ ] PDF and multi-page document support
- [ ] Highlight-to-ask (select text → auto-fill query)
- [ ] Persistent chat history across sessions
- [ ] Dark mode for the overlay
- [ ] Support for additional LLM providers

---

<div align="center">

**Built as a full-stack AI systems project** — spanning browser extension development, backend API design, and applied RAG/LLM engineering.

⭐ If you found this project interesting, a star is always appreciated!

</div>
