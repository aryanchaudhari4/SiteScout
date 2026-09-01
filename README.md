# SiteScout

SiteScout is an AI-powered Chrome extension that helps you understand and interact with the webpage you're currently viewing. Activate it on any article, blog post, documentation page, or research paper, and ask questions directly — SiteScout reads the page and answers using a RAG pipeline, falling back to a live web search when the page itself doesn't have the answer.

Rather than working out of a cramped popup, SiteScout opens a floating AI panel directly on the page you're reading, so the answer sits right next to the content it's about.

## Features

- AI webpage assistant that reads and answers questions about the current page
- RAG-based question answering over the page's content
- FAISS vector retrieval
- HuggingFace embeddings (`BAAI/bge-small-en`)
- LLM-powered responses (Groq, `llama-3.3-70b-versatile`)
- Web-search fallback when the page content isn't enough
- Conversation memory (multi-turn, per session)
- In-page AI overlay, isolated from the host page via Shadow DOM
- Suggested prompts for common questions
- Follow-up questions in a persistent chat thread
- Copy-to-clipboard on answers
- Minimize / close / reopen the overlay without losing your place

## Architecture

```text
Chrome Extension
       ↓
In-page SiteScout UI (content.js, Shadow DOM overlay)
       ↓
Background service worker (background.js)
       ↓
FastAPI Backend (/chat)
       ↓
RAG Pipeline
       ↓
FAISS + Embeddings
       ↓
LLM (Groq) — with web-search fallback
       ↓
Response → rendered in the overlay
```

**Popup (`popup.html` / `popup.js`)** — a lightweight launcher. It shows whether the backend is reachable and activates the SiteScout overlay on the active tab. It does not run the conversation itself.

**Content script (`content.js`)** — injected into every page. Builds the SiteScout panel inside a Shadow DOM (so the host page's CSS can't affect SiteScout, and SiteScout's styles can't leak onto the page), extracts the page's visible text, and renders the conversation.

**Background service worker (`background.js`)** — forwards chat requests from the content script to the FastAPI backend. Running the network call here (rather than directly from the content script) avoids issues with strict page Content-Security-Policies blocking the request to `localhost`.

**Backend (`backend/main.py`)** — unchanged in this phase. Same `/chat` endpoint, same request/response contract:

```json
// Request
{ "text": "current webpage text", "query": "user question", "session_id": "session identifier" }

// Response
{ "answer": "..." }
```

## Installation

### 1. Run the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in `backend/` with:

```text
GROQ_API_KEY=your_groq_api_key_here
```

Start the server:

```bash
uvicorn main:app --reload --port 8000
```

The backend should be reachable at `http://127.0.0.1:8000`.

### 2. Load the extension into Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `extension/` folder.
5. Pin SiteScout to the toolbar if you'd like quick access.

### 3. Use it

1. Open any normal webpage (`http://` or `https://`).
2. Click the SiteScout icon in the toolbar.
3. Click **Open SiteScout** — the overlay appears on the page.
4. Ask a question, or click one of the suggested prompts.

## Project structure

```text
SiteScout/
├── backend/
│   ├── main.py              # FastAPI app: RAG + LLM + web-search fallback (/chat)
│   ├── rag_prototype.py      # Standalone prototype script, not part of the running app
│   └── requirements.txt
├── extension/
│   ├── manifest.json
│   ├── background.js         # Forwards chat requests to the backend
│   ├── content.js            # In-page Shadow DOM overlay + chat UI
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js               # Lightweight launcher
│   └── icon.jpg
└── README.md
```

## Environment variables

| Variable        | Description                          | Required |
|-----------------|---------------------------------------|----------|
| `GROQ_API_KEY`  | API key for the Groq LLM used by the backend | Yes |

## Notes on this phase

**Phase 1** focused on the Chrome extension experience and frontend architecture. The backend's RAG pipeline, embeddings, FAISS index, LLM provider (Groq), and web-search fallback were left unchanged, and the `/chat` request/response contract was preserved.

**Phase 2** hardened the backend without swapping any of the above:

- **Per-session FAISS caching** — the page is only re-embedded and re-indexed when it actually changes for a given session; follow-up questions on the same page reuse the cached index instead of rebuilding it from scratch every time.
- **`source` field added to the `/chat` response** (`"page"` or `"web_search"`) — the overlay already had a badge built for this; the backend now actually populates it.
- **Clean error handling** — a missing `GROQ_API_KEY`, an LLM failure, or a web-search failure now returns a proper `HTTPException` with a short message instead of crashing with a raw traceback. Empty `text`/`query` is rejected with a 400.
- **CORS middleware** and a **`GET /health`** endpoint, which the popup uses for its "Backend ready/offline" indicator.
- **Session expiry** — sessions (and their cached index) are swept after 2 hours of inactivity so a long-running server doesn't accumulate memory indefinitely.

The `/chat` request format is unchanged (`text`, `query`, `session_id`). The response now includes an additional `source` field alongside `answer`; older frontends that ignore it are unaffected.
