import socket
# Force IPv4 to bypass macOS broken IPv6 resolution (fixes 75-second delay)
orig_getaddrinfo = socket.getaddrinfo
def getaddrinfo_ipv4(*args, **kwargs):
    responses = orig_getaddrinfo(*args, **kwargs)
    return [r for r in responses if r[0] == socket.AF_INET]
socket.getaddrinfo = getaddrinfo_ipv4


from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import JSONResponse

from langchain_core.tools import tool
from langchain_community.tools import DuckDuckGoSearchRun

from langchain_core.messages import SystemMessage, HumanMessage
from langchain_community.vectorstores import FAISS
from langchain_core.output_parsers import StrOutputParser
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document
from langchain_groq import ChatGroq
import os
import time
import hashlib
import logging
from typing import Dict, Optional
from collections import deque

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sitescout")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    # Fail fast with a clear message rather than letting every /chat
    # request crash later with an opaque authentication error.
    logger.warning(
        "GROQ_API_KEY is not set. Set it in backend/.env before making requests."
    )

# How long a session (and its cached page index) is kept in memory before
# being swept, in seconds. Prevents unbounded memory growth on a
# long-running server.
SESSION_TTL_SECONDS = 2 * 60 * 60  # 2 hours

emb_model = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en") # Embedding Model
groq_model = ChatGroq(
    api_key=os.getenv("GROQ_API_KEY"),
    model="openai/gpt-oss-120b",
    temperature=0
)

@tool
def web_search(query:str):
    """Search the web for information when the provided document context does not contain the answer or is insufficient."""
    search = DuckDuckGoSearchRun()
    return search.run(query)

tools = [web_search]
groq_model_with_tools = groq_model.bind_tools(tools)

# Each session stores its chat history plus a cached FAISS index for the
# last page it was built from, so a follow-up question on the same page
# doesn't re-embed and re-index the entire page again.
session_db: Dict[str, dict] = {}


def get_session(session_id: str) -> dict:
    now = time.time()
    _sweep_expired_sessions(now)

    session = session_db.get(session_id)
    if session is None:
        session = {
            "history": deque(maxlen=5),
            "vectorstore": None,
            "text_hash": None,
        }
        session_db[session_id] = session

    session["last_accessed"] = now
    return session


def _sweep_expired_sessions(now: float) -> None:
    expired = [
        sid
        for sid, session in session_db.items()
        if now - session.get("last_accessed", now) > SESSION_TTL_SECONDS
    ]
    for sid in expired:
        del session_db[sid]


def get_or_build_vectorstore(session: dict, text: str):
    text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()

    if session["vectorstore"] is not None and session["text_hash"] == text_hash:
        # Same page as last time for this session — reuse the existing index.
        return session["vectorstore"]

    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    chunks = splitter.split_text(text)
    docs = [Document(page_content=chunk) for chunk in chunks]

    vectorstore = FAISS.from_documents(documents=docs, embedding=emb_model)

    session["vectorstore"] = vectorstore
    session["text_hash"] = text_hash
    return vectorstore


parser = StrOutputParser()

app = FastAPI()

# Chrome extension requests come from a chrome-extension:// origin, which
# can vary between installs/reloads. Allowing all origins is fine here
# since this backend is intended to run locally for the extension only —
# tighten this if the backend is ever exposed beyond localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "ok"}


class RAGrequest(BaseModel):
    text: str
    query: str
    session_id: str

@app.post("/chat")
def get_answer(payload: RAGrequest):

    if not payload.text or not payload.text.strip():
        raise HTTPException(status_code=400, detail="Page text is empty.")
    if not payload.query or not payload.query.strip():
        raise HTTPException(status_code=400, detail="Query is empty.")

    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Server is not configured with a GROQ_API_KEY.",
        )

    session = get_session(payload.session_id)
    history = session["history"]

    history_str = ''
    for user_msg, ai_msg in history:
        history_str += f"User: {user_msg}\nAI: {ai_msg}\n"

    try:
        vectorstore = get_or_build_vectorstore(session, payload.text)

        retriever = vectorstore.as_retriever(search_type="similarity", search_kwargs={"k": 3})
        relevant_docs = retriever.invoke(payload.query)

        context = "\n\n".join([doc.page_content for doc in relevant_docs])

        messages = [
            SystemMessage(content="""You are a helpful assistant.

                RULES:
                1. Answer ONLY from the provided document context and conversation history.
                2. If the document context is completely unrelated or does not contain the answer, call the web_search tool.
                3. Do NOT start answers with phrases like "Based on the context..." or "According to the document...". Answer directly."""),
            HumanMessage(content=f"""Conversation History:
{history_str}

Document Context:
{context}

User's question: {payload.query}""")
        ]

        response = groq_model_with_tools.invoke(messages)

        source = "page"

        if response.tool_calls:
            tool_call = response.tool_calls[0]
            tool_name = tool_call["name"]
            tool_args = tool_call["args"]

            if tool_name == "web_search":
                source = "web_search"
                search_query = tool_args.get("query", payload.query)
                logger.info("Web search tool called: %s", search_query)

                try:
                    search_result = web_search.invoke({"query": search_query})
                except Exception:
                    logger.exception("Web search failed")
                    search_result = "No search results were available."

                agent_prompt = f"""
                You are a helpful assistant. The user asked a question, but the webpage context was insufficient.
                So, you searched the web and retrieved the following results.

                CRITICAL: Do NOT start your answer with introductory phrases like "Based on the search results..." or "Based on the history...". Just answer the question directly.

                Conversation History:
                {history_str}

                Web Search Results:
                {search_result}

                User's question: {payload.query}

                Please answer the user's question accurately using these search results and the conversation history.
                """

                final_response = groq_model.invoke(agent_prompt)
                answer = final_response.content
            else:
                answer = response.content
        else:
            answer = response.content

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error while answering /chat request")
        raise HTTPException(
            status_code=500,
            detail="Something went wrong while generating an answer.",
        )

    history.append((payload.query, answer))
    return JSONResponse(content={"answer": answer, "source": source})