import os
import logging
import socket
from collections import deque
from datetime import datetime, timedelta
from hashlib import sha256
from typing import Optional

# -------------------------------------------------------------------
# IPv4 preference
# -------------------------------------------------------------------

_original_getaddrinfo = socket.getaddrinfo


def _getaddrinfo_ipv4(*args, **kwargs):
    results = _original_getaddrinfo(*args, **kwargs)
    return [r for r in results if r[0] == socket.AF_INET]


socket.getaddrinfo = _getaddrinfo_ipv4

# -------------------------------------------------------------------
# Environment
# -------------------------------------------------------------------

from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is not set")

# -------------------------------------------------------------------
# FastAPI
# -------------------------------------------------------------------

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# -------------------------------------------------------------------
# LangChain
# -------------------------------------------------------------------

from langchain_groq import ChatGroq
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
)
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser

from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import FastEmbedEmbeddings

from langchain_text_splitters import RecursiveCharacterTextSplitter

# -------------------------------------------------------------------
# DuckDuckGo
# -------------------------------------------------------------------

from ddgs import DDGS

# -------------------------------------------------------------------
# Logging
# -------------------------------------------------------------------

logging.basicConfig(level=logging.INFO)

logger = logging.getLogger("sitescout")

# -------------------------------------------------------------------
# FastAPI app
# -------------------------------------------------------------------

app = FastAPI(title="SiteScout API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------

# Maximum page text processed by SiteScout.
# Keeps Render Free memory usage under control.
MAX_PAGE_CHARS = 20000

# Maximum text sent to the summarizer in one request.
MAX_SUMMARY_CHARS = 18000

# RAG chunk configuration.
CHUNK_SIZE = 1500
CHUNK_OVERLAP = 100

# Number of documents retrieved for normal questions.
TOP_K = 3

# Session configuration.
MAX_HISTORY = 5
SESSION_TTL = timedelta(hours=2)

# -------------------------------------------------------------------
# Models
# -------------------------------------------------------------------

logger.info("Loading FastEmbed model...")

embeddings = FastEmbedEmbeddings(
    model_name="BAAI/bge-small-en-v1.5"
)

logger.info("FastEmbed model loaded successfully.")

llm = ChatGroq(
    api_key=GROQ_API_KEY,
    model="openai/gpt-oss-120b",
    temperature=0,
)

# -------------------------------------------------------------------
# Session storage
# -------------------------------------------------------------------

session_db = {}


def get_session(session_id: str):
    now = datetime.utcnow()

    session = session_db.get(session_id)

    if session is None:
        session = {
            "history": deque(maxlen=MAX_HISTORY),
            "vectorstore": None,
            "text_hash": None,
            "last_used": now,
        }

        session_db[session_id] = session

    session["last_used"] = now

    return session


def cleanup_sessions():
    now = datetime.utcnow()

    expired = []

    for session_id, session in session_db.items():
        if now - session["last_used"] > SESSION_TTL:
            expired.append(session_id)

    for session_id in expired:
        del session_db[session_id]

    if expired:
        logger.info(
            "Removed %d expired sessions",
            len(expired)
        )


# -------------------------------------------------------------------
# Request model
# -------------------------------------------------------------------

class ChatRequest(BaseModel):
    text: str
    query: str
    session_id: Optional[str] = None


# -------------------------------------------------------------------
# Health endpoint
# -------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


# -------------------------------------------------------------------
# Root endpoint
# -------------------------------------------------------------------

@app.get("/")
def root():
    return {
        "name": "SiteScout API",
        "status": "running",
        "message": "Backend is working"
    }


# -------------------------------------------------------------------
# DuckDuckGo search
# -------------------------------------------------------------------

def web_search(query: str) -> str:
    try:
        logger.info("Performing web search for: %s", query)

        results = []

        with DDGS() as ddgs:
            search_results = ddgs.text(
                query,
                max_results=5
            )

            for result in search_results:
                title = result.get("title", "")
                body = result.get("body", "")
                href = result.get("href", "")

                results.append(
                    f"Title: {title}\n"
                    f"Content: {body}\n"
                    f"URL: {href}"
                )

        if not results:
            return "No web search results found."

        return "\n\n".join(results)

    except Exception as e:
        logger.exception("Web search failed")

        return (
            "Web search failed. "
            "Please answer using the available page context."
        )


# -------------------------------------------------------------------
# Build vectorstore
# -------------------------------------------------------------------

def build_vectorstore(text: str):

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP
    )

    chunks = splitter.split_text(text)

    logger.info(
        "Building vectorstore: %d characters -> %d chunks",
        len(text),
        len(chunks)
    )

    if not chunks:
        return None

    vectorstore = FAISS.from_texts(
        chunks,
        embeddings
    )

    return vectorstore


# -------------------------------------------------------------------
# Page summarization
# -------------------------------------------------------------------

def summarize_page(text: str) -> str:

    # Limit text before sending it to the LLM.
    text = text[:MAX_SUMMARY_CHARS]

    logger.info(
        "Summarizing page using direct LLM path | %d chars",
        len(text)
    )

    prompt = f"""
You are SiteScout, a webpage summarization assistant.

Summarize the webpage content provided below.

Requirements:

- Give a clear and accurate summary.
- Focus on the most important information.
- Do not invent facts.
- Ignore navigation menus, advertisements, repeated text,
  cookie notices, and irrelevant webpage boilerplate.
- Use bullet points where useful.
- Keep the answer concise but informative.
- If the page contains important dates, names, numbers,
  achievements, or events, include them.

WEBPAGE CONTENT:

{text}

SUMMARY:
"""

    response = llm.invoke(prompt)

    return response.content


# -------------------------------------------------------------------
# Normal RAG answer
# -------------------------------------------------------------------

def answer_question(
    text: str,
    query: str,
    session
) -> str:

    # Limit page content before vectorization.
    text = text[:MAX_PAGE_CHARS]

    current_hash = sha256(
        text.encode("utf-8")
    ).hexdigest()

    # Reuse vectorstore if the page hasn't changed.
    if (
        session["vectorstore"] is None
        or session["text_hash"] != current_hash
    ):

        session["vectorstore"] = build_vectorstore(text)
        session["text_hash"] = current_hash

    vectorstore = session["vectorstore"]

    if vectorstore is None:
        return (
            "I couldn't find enough readable content "
            "on this page to answer your question."
        )

    # Retrieve relevant chunks.
    docs = vectorstore.similarity_search(
        query,
        k=TOP_K
    )

    context = "\n\n".join(
        doc.page_content
        for doc in docs
    )

    history_text = ""

    for message in session["history"]:
        if isinstance(message, HumanMessage):
            history_text += f"User: {message.content}\n"

        elif isinstance(message, AIMessage):
            history_text += f"Assistant: {message.content}\n"

    prompt = f"""
You are SiteScout, an AI assistant that answers questions
about the webpage the user is currently viewing.

Use the provided webpage context to answer the user's question.

Rules:

1. Answer using the webpage context whenever possible.
2. Do not invent information.
3. If the answer cannot be found in the webpage context,
   use web search if necessary.
4. Consider the previous conversation when answering
   follow-up questions.
5. Be clear and concise.
6. If the user asks for an explanation, explain simply.

PREVIOUS CONVERSATION:

{history_text}

WEBPAGE CONTEXT:

{context}

USER QUESTION:

{query}

ANSWER:
"""

    response = llm.invoke(prompt)

    answer = response.content

    # ----------------------------------------------------------------
    # Web fallback
    # ----------------------------------------------------------------

    # If the model indicates that the page does not contain
    # enough information, perform a web search.
    insufficient_phrases = [
        "not mentioned",
        "not provided",
        "cannot determine",
        "can't determine",
        "not available",
        "does not contain",
        "not found in the context",
        "insufficient information",
    ]

    should_search = any(
        phrase in answer.lower()
        for phrase in insufficient_phrases
    )

    if should_search:

        logger.info(
            "Page context appears insufficient. "
            "Trying web search."
        )

        search_results = web_search(query)

        web_prompt = f"""
You are SiteScout.

Answer the user's question using the webpage context
and web search results.

Do not invent facts.

WEBPAGE CONTEXT:

{context}

WEB SEARCH RESULTS:

{search_results}

USER QUESTION:

{query}

ANSWER:
"""

        web_response = llm.invoke(web_prompt)

        answer = web_response.content

    return answer


# -------------------------------------------------------------------
# Chat endpoint
# -------------------------------------------------------------------

@app.post("/chat")
async def chat(payload: ChatRequest):

    logger.info(
        "Chat request received | text=%d chars | query=%s | session=%s",
        len(payload.text),
        payload.query,
        payload.session_id
    )

    try:

        cleanup_sessions()

        # ------------------------------------------------------------
        # Validate input
        # ------------------------------------------------------------

        if not payload.query.strip():

            return {
                "answer": "Please enter a question."
            }

        if not payload.text.strip():

            return {
                "answer": (
                    "I couldn't extract readable content "
                    "from this webpage."
                )
            }

        session_id = (
            payload.session_id
            or "default"
        )

        session = get_session(session_id)

        # ------------------------------------------------------------
        # Special handling for page summarization
        # ------------------------------------------------------------

        if payload.query.strip().lower() in {
            "summarize this page",
            "summarise this page",
            "summarize the page",
            "summarise the page",
        }:

            logger.info(
                "Summary request detected. "
                "Skipping FAISS/vectorstore."
            )

            page_text = payload.text[:MAX_SUMMARY_CHARS]

            if len(payload.text) > MAX_SUMMARY_CHARS:

                logger.info(
                    "Summary text truncated from %d to %d characters.",
                    len(payload.text),
                    MAX_SUMMARY_CHARS
                )

            answer = summarize_page(page_text)

        else:

            # --------------------------------------------------------
            # Normal RAG question
            # --------------------------------------------------------

            page_text = payload.text[:MAX_PAGE_CHARS]

            if len(payload.text) > MAX_PAGE_CHARS:

                logger.info(
                    "Page text truncated from %d to %d characters.",
                    len(payload.text),
                    MAX_PAGE_CHARS
                )

            answer = answer_question(
                page_text,
                payload.query,
                session
            )

        # ------------------------------------------------------------
        # Save conversation history
        # ------------------------------------------------------------

        session["history"].append(
            HumanMessage(
                content=payload.query
            )
        )

        session["history"].append(
            AIMessage(
                content=answer
            )
        )

        logger.info(
            "Chat request completed successfully | session=%s",
            session_id
        )

        return {
            "answer": answer
        }

    except Exception as e:

        logger.exception(
            "Chat request failed"
        )

        return {
            "answer": (
                "Sorry, I couldn't process this request "
                "right now. Please try again."
            ),
            "error": "request_processing_failed"
        }