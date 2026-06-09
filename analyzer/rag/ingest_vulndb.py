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
    """Walk the repo and collect all JSON/JSONL vulnerability entries."""
    entries = []
    for json_file in REPO_DIR.rglob("*.json"):
        try:
            text = json_file.read_text(encoding="utf-8", errors="replace").strip()
            # Try regular JSON first
            try:
                data = json.loads(text)
                if isinstance(data, list):
                    entries.extend(data)
                elif isinstance(data, dict) and "vulnerabilities" in data:
                    entries.extend(data["vulnerabilities"])
                elif isinstance(data, dict):
                    entries.append(data)
            except json.JSONDecodeError:
                # Fall back to JSONL (one JSON object per line)
                for line in text.splitlines():
                    line = line.strip()
                    if line:
                        try:
                            entries.append(json.loads(line))
                        except json.JSONDecodeError:
                            pass
        except OSError:
            pass
    return entries


def _infer_category(text: str) -> str:
    t = text.lower()
    if "reentran" in t:
        return "Reentrancy"
    if "overflow" in t or "underflow" in t:
        return "Integer Overflow"
    if "access control" in t or "onlyowner" in t or "authorization" in t:
        return "Access Control"
    if "oracle" in t or "price manipulat" in t:
        return "Oracle Manipulation"
    if "flash loan" in t:
        return "Flash Loan"
    if "front.run" in t or "frontrun" in t:
        return "Front-Running"
    if "delegatecall" in t:
        return "Delegatecall"
    if "dos" in t or "denial" in t:
        return "Denial of Service"
    if "unchecked" in t:
        return "Unchecked Return Value"
    return "General"


def _entry_to_document(entry: dict[str, Any]) -> tuple[str, dict, str]:
    """Convert a vulndb entry → (document_text, metadata, id)."""
    title = entry.get("title") or entry.get("name") or "Unknown Finding"
    raw_severity = entry.get("severity") or entry.get("impact") or "Unknown"
    # Normalise: "minor" → "Low", "medium" → "Medium", etc.
    sev_map = {"minor": "Low", "major": "High", "critical": "Critical",
               "low": "Low", "medium": "Medium", "high": "High", "informational": "Info"}
    severity = sev_map.get(str(raw_severity).lower(), raw_severity.capitalize())

    # body is the main content field in tintinweb/smart-contract-vulndb
    body = entry.get("body") or ""
    description = entry.get("description") or entry.get("details") or body[:1500]
    remediation = entry.get("remediation") or entry.get("fix") or ""

    # Extract code blocks from body if no dedicated field
    vulnerable_code = entry.get("vulnerable_code") or entry.get("code") or ""
    if not vulnerable_code and body:
        import re
        code_blocks = re.findall(r"```(?:solidity|sol)?\s*(.*?)```", body, re.DOTALL)
        vulnerable_code = code_blocks[0].strip() if code_blocks else ""

    # Extract remediation from body if not set
    if not remediation and body:
        import re
        m = re.search(r"(?:recommendation|fix|mitigation)[:\s]*([^\n]{20,}(?:\n(?!#)[^\n]{5,}){0,3})",
                      body, re.IGNORECASE)
        remediation = m.group(1).strip() if m else ""

    source_repo = (entry.get("dataSource") or {}).get("repo") or "tintinweb/smart-contract-vulndb"
    category = entry.get("category") or entry.get("type") or _infer_category(title + " " + description[:300])

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
        "source_repo": source_repo,
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
