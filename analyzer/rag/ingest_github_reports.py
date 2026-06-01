"""
Multi-repo audit report ingestion script.

Clones/pulls each audit repo, walks for .md and .pdf files,
extracts findings, and upserts into ChromaDB + training JSONL.

Usage:
    python -m analyzer.rag.ingest_github_reports
"""

import hashlib
import json
import logging
import re
import subprocess
from pathlib import Path
from typing import Any

import chromadb
from chromadb.utils import embedding_functions

from analyzer.rag.training_utils import append_training_record

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).parent / ".cache" / "audit_repos"
DB_DIR = Path(__file__).parent / "chroma_db"
COLLECTION_NAME = "audit_findings"

# Repos to ingest — (github_slug, description)
AUDIT_REPOS = [
    ("pashov/audits", "markdown"),
    ("GuardianAudits/Audits", "pdf"),
    ("solidified-platform/audits", "mixed"),
    ("softstack/Smart-Contract-Security-Audits", "mixed"),
    ("CDSecurity/audits", "mixed"),
    ("sigp/public-audits", "mixed"),
    ("NethermindEth/PublicAuditReports", "pdf"),
    ("sherlock-protocol/sherlock-reports", "pdf"),
    ("Certora/SecurityReports", "pdf"),
]

# Regex patterns to extract finding blocks from Markdown
_FINDING_HEADING = re.compile(
    r"^#{1,4}\s+(?:(?:H|M|L|C|High|Medium|Low|Critical|Info)\b[^\n]*|[A-Z][^\n]{10,})",
    re.MULTILINE,
)
_SEVERITY_TAG = re.compile(
    r"\b(critical|high|medium|low|informational|info)\b", re.IGNORECASE
)


def _clone_or_pull(slug: str) -> Path:
    repo_dir = CACHE_DIR / slug.replace("/", "_")
    url = f"https://github.com/{slug}.git"
    if repo_dir.exists():
        logger.info(f"Pulling {slug}...")
        subprocess.run(
            ["git", "-C", str(repo_dir), "pull", "--quiet"],
            check=False,  # don't hard-fail if network is down
        )
    else:
        logger.info(f"Cloning {slug}...")
        repo_dir.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth=1", url, str(repo_dir)],
            check=True,
        )
    return repo_dir


def _extract_findings_from_markdown(text: str) -> list[dict[str, Any]]:
    """Split a Markdown audit report into individual finding dicts."""
    findings = []
    # Split on heading lines that look like a finding title
    sections = _FINDING_HEADING.split(text)
    headings = _FINDING_HEADING.findall(text)

    for heading, body in zip(headings, sections[1:]):
        heading = heading.strip("# ").strip()
        body = body.strip()
        if len(body) < 50:
            continue

        severity_match = _SEVERITY_TAG.search(heading) or _SEVERITY_TAG.search(body[:200])
        severity = severity_match.group(1).capitalize() if severity_match else "Unknown"

        # Try to pull out a code block
        code_blocks = re.findall(r"```(?:solidity|sol)?\s*(.*?)```", body, re.DOTALL)
        vulnerable_code = code_blocks[0].strip() if code_blocks else ""

        findings.append({
            "title": heading,
            "severity": severity,
            "category": _infer_category(heading + " " + body[:300]),
            "description": body[:1000],
            "vulnerable_code": vulnerable_code,
            "remediation": _extract_remediation(body),
        })
    return findings


def _extract_findings_from_pdf(pdf_path: Path) -> list[dict[str, Any]]:
    """Extract text from a PDF and parse it like Markdown."""
    try:
        import pdfplumber
    except ImportError:
        try:
            import PyPDF2 as _pypdf

            def _read(p: Path) -> str:
                reader = _pypdf.PdfReader(str(p))
                return "\n".join(
                    page.extract_text() or "" for page in reader.pages
                )
        except ImportError:
            logger.warning("Neither pdfplumber nor PyPDF2 installed — skipping PDFs")
            return []
        text = _read(pdf_path)
    else:
        with pdfplumber.open(str(pdf_path)) as pdf:
            text = "\n".join(
                page.extract_text() or "" for page in pdf.pages
            )

    if not text.strip():
        return []
    return _extract_findings_from_markdown(text)


def _infer_category(text: str) -> str:
    text_lower = text.lower()
    if "reentran" in text_lower:
        return "Reentrancy"
    if "overflow" in text_lower or "underflow" in text_lower:
        return "Integer Overflow"
    if "access control" in text_lower or "onlyowner" in text_lower or "authorization" in text_lower:
        return "Access Control"
    if "oracle" in text_lower or "price manipulat" in text_lower:
        return "Oracle Manipulation"
    if "flash loan" in text_lower:
        return "Flash Loan"
    if "front.run" in text_lower or "frontrun" in text_lower:
        return "Front-Running"
    if "delegatecall" in text_lower:
        return "Delegatecall"
    if "storage" in text_lower and "collision" in text_lower:
        return "Storage Collision"
    if "dos" in text_lower or "denial" in text_lower:
        return "Denial of Service"
    if "unchecked" in text_lower:
        return "Unchecked Return Value"
    return "General"


def _extract_remediation(body: str) -> str:
    match = re.search(
        r"(?:recommendation|remediation|fix|mitigation)[:\s]*([^\n]{20,}(?:\n[^\n]{10,}){0,3})",
        body,
        re.IGNORECASE,
    )
    return match.group(1).strip() if match else ""


def _finding_to_doc(finding: dict, source_repo: str) -> tuple[str, dict, str]:
    doc = f"## {finding['title']}\n**Severity:** {finding['severity']}\n**Category:** {finding['category']}\n"
    if finding.get("vulnerable_code"):
        doc += f"\n### Vulnerable Code\n```solidity\n{finding['vulnerable_code']}\n```\n"
    if finding.get("description"):
        doc += f"\n### Description\n{finding['description']}\n"
    if finding.get("remediation"):
        doc += f"\n### Remediation\n{finding['remediation']}\n"

    metadata = {
        "severity": finding["severity"],
        "category": finding["category"],
        "title": finding["title"],
        "source_repo": source_repo,
    }
    uid = hashlib.md5(doc.encode()).hexdigest()[:16]
    return doc, metadata, f"gh-{source_repo.replace('/', '-')}-{uid}"


def ingest(collection: chromadb.Collection) -> int:
    total = 0

    for slug, _ in AUDIT_REPOS:
        try:
            repo_dir = _clone_or_pull(slug)
        except Exception as e:
            logger.error(f"Failed to clone {slug}: {e}")
            continue

        findings: list[dict] = []

        for md_file in repo_dir.rglob("*.md"):
            try:
                text = md_file.read_text(encoding="utf-8", errors="replace")
                findings.extend(_extract_findings_from_markdown(text))
            except OSError:
                pass

        for pdf_file in repo_dir.rglob("*.pdf"):
            try:
                findings.extend(_extract_findings_from_pdf(pdf_file))
            except Exception as e:
                logger.debug(f"PDF error {pdf_file}: {e}")

        if not findings:
            logger.info(f"No findings extracted from {slug}")
            continue

        # Deduplicate within this repo by content hash
        seen: set[str] = set()
        documents, metadatas, ids = [], [], []

        for f in findings:
            doc, meta, uid = _finding_to_doc(f, slug)
            if uid in seen:
                continue
            seen.add(uid)
            documents.append(doc)
            metadatas.append(meta)
            ids.append(uid)
            append_training_record(
                instruction="Analyze the following Solidity code for vulnerabilities",
                input_text=f.get("vulnerable_code") or "",
                output=json.dumps({
                    "title": meta["title"],
                    "severity": meta["severity"],
                    "category": meta["category"],
                    "description": f.get("description") or "",
                    "remediation": f.get("remediation") or "",
                }),
                source=slug,
                severity=meta["severity"],
                category=meta["category"],
            )

        batch_size = 100
        for i in range(0, len(documents), batch_size):
            collection.upsert(
                documents=documents[i:i + batch_size],
                metadatas=metadatas[i:i + batch_size],
                ids=ids[i:i + batch_size],
            )

        logger.info(f"✅ {slug}: ingested {len(documents)} findings")
        total += len(documents)

    return total


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    DB_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(DB_DIR))
    ef = embedding_functions.DefaultEmbeddingFunction()
    col = client.get_or_create_collection(COLLECTION_NAME, embedding_function=ef)
    ingested = ingest(col)
    print(f"Total ingested: {ingested} findings")
