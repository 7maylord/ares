"""
LLM RAG Runner for Ares

Retrieves similar audit findings from ChromaDB and uses an LLM
to reason about potential vulnerabilities in a target contract.
"""

import os
import chromadb
from chromadb.utils import embedding_functions
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

# Path to the persistent ChromaDB
DB_DIR = os.path.join(os.path.dirname(__file__), "..", "rag", "chroma_db")

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
unchecked return values, front-running, storage collisions, flash loan attacks, and logic errors."""


class LLMRagRunner:
    def __init__(self):
        self.openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.chroma_client = None
        self.collection = None
        self._init_vectordb()

    def _init_vectordb(self):
        """Connect to the ChromaDB vector store."""
        if os.path.exists(DB_DIR):
            self.chroma_client = chromadb.PersistentClient(path=DB_DIR)
            ef = embedding_functions.DefaultEmbeddingFunction()
            try:
                self.collection = self.chroma_client.get_collection(
                    name="audit_findings",
                    embedding_function=ef,
                )
            except Exception:
                self.collection = None

    def retrieve_similar_findings(self, source_code: str, top_k: int = 5) -> list[str]:
        """Query ChromaDB for audit findings similar to the given source code."""
        if not self.collection:
            return []

        results = self.collection.query(
            query_texts=[source_code],
            n_results=top_k,
        )

        return results.get("documents", [[]])[0]

    def analyze(self, source_code: str) -> list[dict]:
        """
        Full RAG pipeline:
        1. Retrieve similar past audit findings from vector DB.
        2. Build an augmented prompt with those findings as context.
        3. Send to LLM for deep analysis.
        4. Parse and return structured vulnerability results.
        """
        # Step 1: Retrieve
        similar_findings = self.retrieve_similar_findings(source_code)

        context_block = ""
        if similar_findings:
            context_block = "\n\n---\n\n".join(similar_findings)
            context_block = f"\n\n## SIMILAR PAST FINDINGS (from audit knowledge base)\n\n{context_block}"

        # Step 2: Build prompt
        user_prompt = f"""Analyze the following Solidity smart contract for security vulnerabilities.

## TARGET CONTRACT SOURCE CODE
```solidity
{source_code}
```
{context_block}

Return your analysis as a JSON array."""

        # Step 3: Call LLM
        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,  # Low temp for deterministic security analysis
                response_format={"type": "json_object"},
            )

            import json
            content = response.choices[0].message.content
            parsed = json.loads(content)

            # Handle both {"vulnerabilities": [...]} and direct [...]
            if isinstance(parsed, dict):
                return parsed.get("vulnerabilities", parsed.get("findings", []))
            elif isinstance(parsed, list):
                return parsed
            else:
                return []

        except Exception as e:
            print(f"LLM analysis failed: {e}")
            return []
