"""
LLM RAG Runner for Ares

Retrieves similar audit findings from ChromaDB and uses an LLM
to reason about potential vulnerabilities in a target contract.

LLM priority:
  1. DeepSeek        — if DEEPSEEK_API_KEY is set
  2. Ollama (local)  — if OLLAMA_BASE_URL or OLLAMA_MODEL is set
  3. No LLM          — returns empty findings (Slither still runs)
"""

import json
import logging
import os

import chromadb
import httpx
from chromadb.utils import embedding_functions
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

DB_DIR = os.path.join(os.path.dirname(__file__), "..", "rag", "chroma_db")

# DeepSeek exposes an OpenAI-style /chat/completions endpoint — a plain REST call.
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-pro")
# Default to pro: flash can't reason over decompiled bytecode (it misses even blatant
# bugs like an unprotected drain), so we standardize on pro. DEEPSEEK_DECOMPILE_MODEL
# is kept as a separate knob (also pro) — set either to deepseek-v4-flash via env for
# a cheaper tier on verified source.
DEEPSEEK_DECOMPILE_MODEL = os.getenv("DEEPSEEK_DECOMPILE_MODEL", "deepseek-v4-pro")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3:8b")

SYSTEM_PROMPT = """You are Ares, an elite smart contract security auditor.
You have access to a knowledge base of real audit findings from past security competitions (Code4rena, Sherlock, Solodit).

Your job:
1. Analyze the provided Solidity source code for vulnerabilities.
2. Use the SIMILAR PAST FINDINGS provided as context to guide your analysis.
3. For each vulnerability found, output a structured JSON object.

Output format (JSON array):
[
  {
    "title": "Short title of the vulnerability",
    "severity": "Critical | High | Medium | Low | Informational",
    "category": "e.g. Reentrancy, Access Control, Oracle Manipulation",
    "location": "function name or line range",
    "description": "Detailed explanation of the vulnerability",
    "poc_sketch": "Brief description of how to exploit this",
    "remediation": "How to fix it"
  }
]

If no vulnerabilities are found, return an empty array: []
Be thorough. Check for: reentrancy, access control, oracle manipulation, integer issues,
unchecked return values, front-running, storage collisions, flash loan attacks, and logic errors.
IMPORTANT: Return ONLY valid JSON, do not include markdown code blocks or any other text."""


def _strip_markdown_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _parse_llm_response(raw: str) -> list[dict]:
    content = _strip_markdown_fences(raw)
    if not content:
        logger.warning("LLM returned empty response")
        return []
    # If the model prefixed the JSON with explanation text, find the array/object
    if not content.startswith(("[", "{")):
        start = content.find("[")
        obj_start = content.find("{")
        if start == -1 and obj_start == -1:
            logger.warning("LLM response contains no JSON: %s", content[:200])
            return []
        if start == -1 or (obj_start != -1 and obj_start < start):
            start = obj_start
        content = content[start:]
    parsed = json.loads(content)
    if isinstance(parsed, dict):
        return parsed.get("vulnerabilities", parsed.get("findings", []))
    if isinstance(parsed, list):
        return parsed
    return []


class LLMRagRunner:
    def __init__(self):
        self._deepseek_available = False
        self._ollama_available = False
        self.chroma_client = None
        self.collection = None

        if DEEPSEEK_API_KEY:
            self._deepseek_available = True
            logger.info(f"LLM backend: DeepSeek ({DEEPSEEK_MODEL})")
        else:
            self._ollama_available = self._check_ollama()
            if self._ollama_available:
                logger.info(f"LLM backend: Ollama ({OLLAMA_MODEL} @ {OLLAMA_BASE_URL})")
            else:
                logger.warning("No LLM backend available — LLM RAG analysis disabled")

        self._init_vectordb()

    def _check_ollama(self) -> bool:
        try:
            resp = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=3)
            return resp.status_code == 200
        except Exception:
            return False

    def _init_vectordb(self):
        if os.getenv("DISABLE_RAG", "false").lower() == "true":
            logger.info("DISABLE_RAG=true — ChromaDB and embedding model disabled")
            return
        if not os.path.exists(DB_DIR):
            return
        try:
            self.chroma_client = chromadb.PersistentClient(path=DB_DIR)
            ef = embedding_functions.DefaultEmbeddingFunction()
            self.collection = self.chroma_client.get_collection(
                name="audit_findings",
                embedding_function=ef,
            )
            count = self.collection.count()
            logger.info(f"ChromaDB loaded: {count} findings in knowledge base")
        except Exception as e:
            logger.warning(f"ChromaDB init failed: {e}")
            self.collection = None

    def retrieve_similar_findings(self, source_code: str, top_k: int = 5) -> list[str]:
        if not self.collection:
            return []
        try:
            results = self.collection.query(query_texts=[source_code], n_results=top_k)
            return results.get("documents", [[]])[0]
        except Exception as e:
            logger.warning(f"ChromaDB query failed: {e}")
            return []

    def _call_deepseek(self, user_prompt: str, model: "str | None" = None) -> list[dict]:
        resp = httpx.post(
            f"{DEEPSEEK_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model or DEEPSEEK_MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.1,
                "max_tokens": 4000,
                "stream": False,
            },
            timeout=180,
        )
        resp.raise_for_status()
        choice = resp.json()["choices"][0]
        raw = choice["message"]["content"] or ""
        if choice.get("finish_reason") == "length":
            logger.warning("DeepSeek hit max_tokens — response may be truncated")
        return _parse_llm_response(raw)

    def _call_ollama(self, user_prompt: str) -> list[dict]:
        full_prompt = f"{SYSTEM_PROMPT}\n\n{user_prompt}"
        resp = httpx.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": full_prompt, "stream": False},
            timeout=180,
        )
        resp.raise_for_status()
        return _parse_llm_response(resp.json()["response"])

    def analyze(self, source_code: str, source_type: str = "verified_source") -> list[dict]:
        if not self._deepseek_available and not self._ollama_available:
            return []

        decompiled = source_type in ("decompiled", "bytecode_only")

        similar_findings = self.retrieve_similar_findings(source_code)
        context_block = ""
        if similar_findings:
            context_block = (
                "\n\n## SIMILAR PAST FINDINGS (from audit knowledge base)\n\n"
                + "\n\n---\n\n".join(similar_findings)
            )

        # Decompiled source is noisy: names may be generic and heimdall renders raw
        # low-level calls as `.transfer(...)`. Steer the model past those artifacts.
        decompile_note = (
            "\n\nNOTE: this source was DECOMPILED from bytecode. Names may be generic, and a "
            "`.transfer(...)` of the full balance is really a raw low-level call (reentrancy-capable). "
            "Judge access control by whether public/external functions restrict msg.sender; focus on logic."
            if decompiled else ""
        )

        user_prompt = (
            f"Analyze the following Solidity smart contract for security vulnerabilities.\n\n"
            f"## TARGET CONTRACT SOURCE CODE\n```solidity\n{source_code}\n```"
            f"{context_block}{decompile_note}\n\nReturn your analysis as a JSON array."
        )

        model = DEEPSEEK_DECOMPILE_MODEL if decompiled else DEEPSEEK_MODEL

        try:
            if self._deepseek_available:
                return self._call_deepseek(user_prompt, model)
            return self._call_ollama(user_prompt)
        except Exception as e:
            logger.error(f"LLM analysis failed: {e}")
            # If DeepSeek failed, try Ollama as emergency fallback
            if self._deepseek_available and self._check_ollama():
                logger.info("Falling back to Ollama after DeepSeek error")
                try:
                    return self._call_ollama(user_prompt)
                except Exception as e2:
                    logger.error(f"Ollama fallback also failed: {e2}")
            return []
