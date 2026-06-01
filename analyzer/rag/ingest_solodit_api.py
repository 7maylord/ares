"""
Solodit API scraper — fetches real audit findings from solodit.cyfrin.io.

Rate limit: 20 requests / 60 seconds (respected via httpx + sleep).
Fetches Critical, High, and Medium severity findings paginated.

Usage:
    python -m analyzer.rag.ingest_solodit_api
"""

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx
import chromadb
from chromadb.utils import embedding_functions

from analyzer.rag.training_utils import append_training_record

logger = logging.getLogger(__name__)

DB_DIR = Path(__file__).parent / "chroma_db"
COLLECTION_NAME = "audit_findings"

SOLODIT_API = "https://solodit.cyfrin.io/api/v1"
# Severities to fetch — skip Low/Info to stay within rate limits
TARGET_SEVERITIES = ["Critical", "High", "Medium"]
# Max pages per severity (20 items/page × 50 pages = 1,000 findings max per severity)
MAX_PAGES = 50
# Respect the 20 req/60s rate limit: ~3s between requests is safe
REQUEST_DELAY = 3.0


def _fetch_page(client: httpx.Client, severity: str, page: int) -> list[dict[str, Any]]:
    try:
        resp = client.get(
            f"{SOLODIT_API}/issues",
            params={"severity": severity, "page": page, "limit": 20},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        # Solodit returns either a list or {"results": [...], "count": N}
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("results") or data.get("data") or []
        return []
    except httpx.HTTPStatusError as e:
        logger.warning(f"Solodit API HTTP {e.response.status_code} on page {page}")
        return []
    except Exception as e:
        logger.warning(f"Solodit API error page {page}: {e}")
        return []


def _entry_to_document(entry: dict[str, Any]) -> tuple[str, dict, str]:
    title = entry.get("title") or "Untitled Finding"
    severity = entry.get("severity") or "Unknown"
    category = entry.get("category") or entry.get("type") or "General"
    description = entry.get("description") or entry.get("body") or ""
    remediation = entry.get("recommendation") or entry.get("remediation") or ""
    vulnerable_code = entry.get("vulnerable_code") or entry.get("code_snippet") or ""
    source_url = entry.get("url") or entry.get("source") or ""

    doc = f"## {title}\n**Severity:** {severity}\n**Category:** {category}\n"
    if vulnerable_code:
        doc += f"\n### Vulnerable Code\n```solidity\n{vulnerable_code.strip()}\n```\n"
    if description:
        doc += f"\n### Description\n{description}\n"
    if remediation:
        doc += f"\n### Remediation\n{remediation}\n"

    metadata = {
        "severity": str(severity),
        "category": str(category),
        "title": str(title),
        "source_repo": "solodit.cyfrin.io",
        "source_url": str(source_url),
    }

    entry_id = entry.get("id") or hashlib.md5(doc.encode()).hexdigest()[:16]
    return doc, metadata, f"solodit-{entry_id}"


def ingest(collection: chromadb.Collection) -> int:
    total = 0

    with httpx.Client(headers={"Accept": "application/json"}) as client:
        for severity in TARGET_SEVERITIES:
            logger.info(f"Fetching Solodit {severity} findings...")
            page = 1
            severity_count = 0

            while page <= MAX_PAGES:
                items = _fetch_page(client, severity, page)
                if not items:
                    break

                documents, metadatas, ids = [], [], []
                for entry in items:
                    try:
                        doc, meta, uid = _entry_to_document(entry)
                        documents.append(doc)
                        metadatas.append(meta)
                        ids.append(uid)
                        append_training_record(
                            instruction="Analyze the following Solidity code for vulnerabilities",
                            input_text=entry.get("vulnerable_code") or entry.get("code_snippet") or "",
                            output=json.dumps({
                                "title": meta["title"],
                                "severity": meta["severity"],
                                "category": meta["category"],
                                "description": entry.get("description") or "",
                                "remediation": entry.get("recommendation") or "",
                            }),
                            source="solodit.cyfrin.io",
                            severity=meta["severity"],
                            category=meta["category"],
                        )
                    except Exception as e:
                        logger.debug(f"Skipping entry: {e}")

                if documents:
                    collection.upsert(documents=documents, metadatas=metadatas, ids=ids)
                    severity_count += len(documents)

                page += 1
                time.sleep(REQUEST_DELAY)

            logger.info(f"  {severity}: {severity_count} findings")
            total += severity_count

    logger.info(f"✅ Solodit API: ingested {total} findings total")
    return total


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    DB_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(DB_DIR))
    ef = embedding_functions.DefaultEmbeddingFunction()
    col = client.get_or_create_collection(COLLECTION_NAME, embedding_function=ef)
    ingest(col)
