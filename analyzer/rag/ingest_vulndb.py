"""
Ingests the tintinweb/smart-contract-vulndb JSON dataset into ChromaDB.

This is the fastest win — machine-readable JSON with structured vulnerability
data. Clones the repo once, then reads vulns.json directly.

Usage:
    python -m analyzer.rag.ingest_vulndb
"""

import json
import os
import logging
import subprocess
import hashlib
from pathlib import Path
from typing import Any

import chromadb
from chromadb.utils import embedding_functions

from analyzer.rag.training_utils import append_training_record

logger = logging.getLogger(__name__)

REPO_URL = "https://github.com/tintinweb/smart-contract-vulndb.git"
REPO_DIR = Path(__file__).parent / ".cache" / "smart-contract-vulndb"
DB_DIR = Path(__file__).parent / "chroma_db"
COLLECTION_NAME = "audit_findings"


def _clone_or_pull_repo() -> None:
    if REPO_DIR.exists():
        logger.info("Pulling latest smart-contract-vulndb...")
        subprocess.run(["git", "-C", str(REPO_DIR), "pull", "--quiet"], check=True)
    else:
        logger.info("Cloning tintinweb/smart-contract-vulndb...")
        REPO_DIR.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--depth=1", REPO_URL, str(REPO_DIR)], check=True)


def _load_vuln_entries() -> list[dict[str, Any]]:
    """Walk the repo and collect all JSON vulnerability files."""
    entries = []
    for json_file in REPO_DIR.rglob("*.json"):
        try:
            data = json.loads(json_file.read_text(encoding="utf-8", errors="replace"))
            # The repo contains per-vuln JSON files and a top-level index.
            # Handle both list and single-object formats.
            if isinstance(data, list):
                entries.extend(data)
            elif isinstance(data, dict) and "vulnerabilities" in data:
                entries.extend(data["vulnerabilities"])
            elif isinstance(data, dict) and "id" in data:
                entries.append(data)
        except (json.JSONDecodeError, OSError):
            pass
    return entries


def _entry_to_document(entry: dict[str, Any]) -> tuple[str, dict, str]:
    """Convert a vulndb entry → (document_text, metadata, id)."""
    title = entry.get("title") or entry.get("name") or "Unknown Finding"
    severity = entry.get("severity") or entry.get("impact") or "Unknown"
    category = entry.get("category") or entry.get("type") or "General"
    description = entry.get("description") or entry.get("details") or ""
    remediation = entry.get("remediation") or entry.get("fix") or ""
    vulnerable_code = entry.get("vulnerable_code") or entry.get("code") or ""

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
        "source_repo": "tintinweb/smart-contract-vulndb",
    }

    entry_id = entry.get("id") or hashlib.md5(doc.encode()).hexdigest()[:16]
    return doc, metadata, f"vulndb-{entry_id}"


def ingest(collection: chromadb.Collection) -> int:
    _clone_or_pull_repo()
    entries = _load_vuln_entries()
    if not entries:
        logger.warning("No entries found in smart-contract-vulndb")
        return 0

    documents, metadatas, ids = [], [], []
    seen_ids: set[str] = set()

    for entry in entries:
        try:
            doc, meta, entry_id = _entry_to_document(entry)
            if entry_id in seen_ids:
                continue
            seen_ids.add(entry_id)
            documents.append(doc)
            metadatas.append(meta)
            ids.append(entry_id)
            append_training_record(
                instruction="Analyze the following Solidity code for vulnerabilities",
                input_text=entry.get("vulnerable_code") or "",
                output=json.dumps({
                    "title": meta["title"],
                    "severity": meta["severity"],
                    "category": meta["category"],
                    "description": entry.get("description") or "",
                    "remediation": entry.get("remediation") or "",
                }),
                source="tintinweb/smart-contract-vulndb",
                severity=meta["severity"],
                category=meta["category"],
            )
        except Exception as e:
            logger.debug(f"Skipping malformed entry: {e}")

    # Upsert in batches of 100 to stay within ChromaDB limits
    batch_size = 100
    for i in range(0, len(documents), batch_size):
        collection.upsert(
            documents=documents[i:i + batch_size],
            metadatas=metadatas[i:i + batch_size],
            ids=ids[i:i + batch_size],
        )

    logger.info(f"✅ Ingested {len(documents)} findings from tintinweb/smart-contract-vulndb")
    return len(documents)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    DB_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(DB_DIR))
    ef = embedding_functions.DefaultEmbeddingFunction()
    col = client.get_or_create_collection(COLLECTION_NAME, embedding_function=ef)
    ingest(col)
