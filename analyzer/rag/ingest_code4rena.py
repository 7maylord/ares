"""
Code4rena contest findings ingestion.

Discovers public contest repos from the code-423n4 GitHub org,
clones the most recent ones, and extracts individual findings from
the findings/ directory (each finding is its own .md file).

Usage:
    python -m analyzer.rag.ingest_code4rena [--max-repos 50] [--since 2023-01-01]

Env:
    GITHUB_TOKEN  — optional, raises rate limit from 60 to 5000 req/hr
"""

import argparse
import hashlib
import json
import logging
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import chromadb
import httpx
from chromadb.utils import embedding_functions

from analyzer.rag.training_utils import append_training_record

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).parent / ".cache" / "code4rena"
DB_DIR = Path(__file__).parent / "chroma_db"
COLLECTION_NAME = "audit_findings"

GITHUB_API = "https://api.github.com"
C4_ORG = "code-423n4"

_SEVERITY_RE = re.compile(r"\b(critical|high|medium|low|informational|gas)\b", re.IGNORECASE)
_CATEGORY_KEYWORDS = {
    "Reentrancy": ["reentran"],
    "Access Control": ["access control", "onlyowner", "unauthorized", "privilege"],
    "Oracle Manipulation": ["oracle", "price manipulat", "twap", "chainlink"],
    "Flash Loan": ["flash loan", "flashloan"],
    "Front-Running": ["front.run", "frontrun", "sandwich", "mev"],
    "Integer Overflow": ["overflow", "underflow", "arithmetic"],
    "Unchecked Return Value": ["unchecked", "return value", "safetransfer"],
    "Denial of Service": ["dos", "denial of service", "gas limit", "out of gas"],
    "Delegatecall": ["delegatecall"],
    "Storage Collision": ["storage collision", "slot collision"],
}


def _github_headers() -> dict:
    token = __import__("os").getenv("GITHUB_TOKEN")
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _infer_category(text: str) -> str:
    t = text.lower()
    for cat, keywords in _CATEGORY_KEYWORDS.items():
        if any(k in t for k in keywords):
            return cat
    return "General"


def _list_contest_repos(client: httpx.Client, since: str, max_repos: int) -> list[dict]:
    """Return contest repos sorted newest-first, up to max_repos."""
    repos = []
    page = 1
    since_dt = datetime.fromisoformat(since).replace(tzinfo=timezone.utc)

    while len(repos) < max_repos:
        resp = client.get(
            f"{GITHUB_API}/orgs/{C4_ORG}/repos",
            params={"type": "public", "sort": "created", "direction": "desc",
                    "per_page": 100, "page": page},
            headers=_github_headers(),
            timeout=30,
        )
        if resp.status_code == 403:
            logger.warning("GitHub rate limit hit — add GITHUB_TOKEN env var for 5000 req/hr")
            break
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break

        for r in batch:
            created = datetime.fromisoformat(r["created_at"].rstrip("Z")).replace(tzinfo=timezone.utc)
            if created < since_dt:
                return repos  # repos are sorted newest-first, stop early
            # Contest repos follow pattern: YYYY-MM-<name>
            if re.match(r"^\d{4}-\d{2}-", r["name"]):
                repos.append(r)
                if len(repos) >= max_repos:
                    return repos
        page += 1
        time.sleep(0.5)

    return repos


def _clone_or_pull(slug: str) -> Path:
    repo_dir = CACHE_DIR / slug
    url = f"https://github.com/{C4_ORG}/{slug}.git"
    if repo_dir.exists():
        subprocess.run(["git", "-C", str(repo_dir), "pull", "--quiet"], check=False)
    else:
        repo_dir.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--depth=1", url, str(repo_dir)], check=True)
    return repo_dir


def _parse_finding_md(text: str, filename: str) -> dict[str, Any] | None:
    """Parse a single Code4rena finding markdown file."""
    lines = text.strip().splitlines()
    if not lines:
        return None

    # Title is usually the first heading
    title = lines[0].lstrip("#").strip() if lines[0].startswith("#") else filename

    severity_match = _SEVERITY_RE.search(title) or _SEVERITY_RE.search(text[:500])
    severity = severity_match.group(1).capitalize() if severity_match else "Unknown"
    # Skip gas-only findings
    if severity.lower() == "gas":
        return None

    code_blocks = re.findall(r"```(?:solidity|sol)?\s*(.*?)```", text, re.DOTALL)
    vulnerable_code = code_blocks[0].strip() if code_blocks else ""

    # Try to extract recommendation section
    remediation_match = re.search(
        r"(?:recommend|mitigation|fix|suggestion)[:\s]*([^\n]{20,}(?:\n(?!#)[^\n]{5,}){0,4})",
        text, re.IGNORECASE,
    )
    remediation = remediation_match.group(1).strip() if remediation_match else ""

    description = text[:1500]

    return {
        "title": title,
        "severity": severity,
        "category": _infer_category(title + " " + text[:400]),
        "description": description,
        "vulnerable_code": vulnerable_code,
        "remediation": remediation,
    }


def _finding_to_doc(finding: dict, repo_name: str) -> tuple[str, dict, str]:
    doc = f"## {finding['title']}\n**Severity:** {finding['severity']}\n**Category:** {finding['category']}\n"
    if finding.get("vulnerable_code"):
        doc += f"\n### Vulnerable Code\n```solidity\n{finding['vulnerable_code']}\n```\n"
    if finding.get("description"):
        doc += f"\n### Description\n{finding['description'][:800]}\n"
    if finding.get("remediation"):
        doc += f"\n### Remediation\n{finding['remediation']}\n"

    metadata = {
        "severity": finding["severity"],
        "category": finding["category"],
        "title": finding["title"],
        "source_repo": f"code-423n4/{repo_name}",
    }
    uid = hashlib.md5(doc.encode()).hexdigest()[:16]
    return doc, metadata, f"c4-{repo_name[:20]}-{uid}"


def ingest(collection: chromadb.Collection, since: str = "2023-01-01", max_repos: int = 60) -> int:
    total = 0
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    with httpx.Client() as client:
        repos = _list_contest_repos(client, since, max_repos)

    logger.info(f"Found {len(repos)} Code4rena contest repos to ingest")

    for repo in repos:
        repo_name = repo["name"]
        try:
            repo_dir = _clone_or_pull(repo_name)
        except Exception as e:
            logger.warning(f"Clone failed for {repo_name}: {e}")
            continue

        findings_dir = repo_dir / "findings"
        if not findings_dir.exists():
            # Some repos put report.md at root or have no structured findings
            report = repo_dir / "report.md"
            if not report.exists():
                continue
            md_files = [report]
        else:
            md_files = list(findings_dir.glob("*.md"))

        documents, metadatas, ids = [], [], []
        for md_file in md_files:
            try:
                text = md_file.read_text(encoding="utf-8", errors="replace")
                finding = _parse_finding_md(text, md_file.stem)
                if not finding:
                    continue
                doc, meta, uid = _finding_to_doc(finding, repo_name)
                documents.append(doc)
                metadatas.append(meta)
                ids.append(uid)
                append_training_record(
                    instruction="Analyze the following Solidity code for vulnerabilities",
                    input_text=finding.get("vulnerable_code") or "",
                    output=json.dumps({
                        "title": meta["title"],
                        "severity": meta["severity"],
                        "category": meta["category"],
                        "description": finding.get("description") or "",
                        "remediation": finding.get("remediation") or "",
                    }),
                    source=f"code-423n4/{repo_name}",
                    severity=meta["severity"],
                    category=meta["category"],
                )
            except Exception as e:
                logger.debug(f"Skipping {md_file.name}: {e}")

        if documents:
            batch_size = 100
            for i in range(0, len(documents), batch_size):
                collection.upsert(
                    documents=documents[i:i + batch_size],
                    metadatas=metadatas[i:i + batch_size],
                    ids=ids[i:i + batch_size],
                )
            logger.info(f"  code-423n4/{repo_name}: {len(documents)} findings")
            total += len(documents)

    logger.info(f"✅ Code4rena total: {total} findings")
    return total


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-repos", type=int, default=60)
    parser.add_argument("--since", type=str, default="2023-01-01")
    args = parser.parse_args()

    DB_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(DB_DIR))
    ef = embedding_functions.DefaultEmbeddingFunction()
    col = client.get_or_create_collection(COLLECTION_NAME, embedding_function=ef)
    total = ingest(col, since=args.since, max_repos=args.max_repos)
    print(f"Total ingested: {total} findings")
