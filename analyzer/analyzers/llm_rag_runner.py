"""
LLM RAG Runner for Ares

Retrieves similar audit findings from ChromaDB and uses an LLM
to reason about potential vulnerabilities in a target contract.

LLM priority:
  1. Anthropic Claude  — if ANTHROPIC_API_KEY is set
  2. Ollama (local)    — if OLLAMA_BASE_URL or OLLAMA_MODEL is set
  3. No LLM           — returns empty findings (Slither still runs)
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
    parsed = json.loads(content)
    if isinstance(parsed, dict):
        return parsed.get("vulnerabilities", parsed.get("findings", []))
    if isinstance(parsed, list):
        return parsed
    return []


class LLMRagRunner:
    def __init__(self):
        self.anthropic_client = None
        self._ollama_available = False
        self.chroma_client = None
        self.collection = None

        if os.getenv("ANTHROPIC_API_KEY"):
            import anthropic
            self.anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
            logger.info("LLM backend: Anthropic Claude")
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

    def _call_claude(self, user_prompt: str) -> list[dict]:
        import anthropic
        response = self.anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
            temperature=0.1,
            max_tokens=4000,
        )
        return _parse_llm_response(response.content[0].text)

    def _call_ollama(self, user_prompt: str) -> list[dict]:
        full_prompt = f"{SYSTEM_PROMPT}\n\n{user_prompt}"
        resp = httpx.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": full_prompt, "stream": False},
            timeout=180,
        )
        resp.raise_for_status()
        return _parse_llm_response(resp.json()["response"])

    def analyze(self, source_code: str) -> list[dict]:
        if not self.anthropic_client and not self._ollama_available:
            return []

        similar_findings = self.retrieve_similar_findings(source_code)
        context_block = ""
        if similar_findings:
            context_block = (
                "\n\n## SIMILAR PAST FINDINGS (from audit knowledge base)\n\n"
                + "\n\n---\n\n".join(similar_findings)
            )

        user_prompt = (
            f"Analyze the following Solidity smart contract for security vulnerabilities.\n\n"
            f"## TARGET CONTRACT SOURCE CODE\n```solidity\n{source_code}\n```"
            f"{context_block}\n\nReturn your analysis as a JSON array."
        )

        try:
            if self.anthropic_client:
                return self._call_claude(user_prompt)
            return self._call_ollama(user_prompt)
        except Exception as e:
            logger.error(f"LLM analysis failed: {e}")
            # If Claude failed, try Ollama as emergency fallback
            if self.anthropic_client and self._check_ollama():
                logger.info("Falling back to Ollama after Claude error")
                try:
                    return self._call_ollama(user_prompt)
                except Exception as e2:
                    logger.error(f"Ollama fallback also failed: {e2}")
            return []
