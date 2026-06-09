"""
Sherlock contest findings ingestion.

Discovers public contest repos from the sherlock-audit GitHub org,
clones them, and extracts findings from markdown files.

Sherlock contest repos contain:
  - 001-H.md, 002-M.md ... (individual finding files, severity in filename)
  - Or a single Audit_Report.pdf / report.md

Usage:
    python -m analyzer.rag.ingest_sherlock [--max-repos 60] [--since 2023-01-01]

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

CACHE_DIR = Path(__file__).parent / ".cache" / "sherlock"
DB_DIR = Path(__file__).parent / "chroma_db"
COLLECTION_NAME = "audit_findings"

GITHUB_API = "https://api.github.com"
SHERLOCK_ORG = "sherlock-audit"

_SEVERITY_FROM_FILENAME = re.compile(r"-([HMhm])\.", )
_SEVERITY_RE = re.compile(r"\b(critical|high|medium|low|informational)\b", re.IGNORECASE)
_CATEGORY_KEYWORDS = {
    "Reentrancy": ["reentran"],
    "Access Control": ["access control", "onlyowner", "unauthorized"],
    "Oracle Manipulation": ["oracle", "price manipulat", "twap"],
    "Flash Loan": ["flash loan", "flashloan"],
    "Front-Running": ["front.run", "frontrun", "sandwich", "mev"],
    "Integer Overflow": ["overflow", "underflow", "arithmetic"],
    "Unchecked Return Value": ["unchecked", "return value", "safetransfer"],
    "Denial of Service": ["dos", "denial of service", "gas limit"],
    "Delegatecall": ["delegatecall"],
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
    repos = []
    page = 1
    since_dt = datetime.fromisoformat(since).replace(tzinfo=timezone.utc)

    while len(repos) < max_repos:
        resp = client.get(
            f"{GITHUB_API}/orgs/{SHERLOCK_ORG}/repos",
            params={"type": "public", "sort": "created", "direction": "desc",
                    "per_page": 100, "page": page},
            headers=_github_headers(),
            timeout=30,
        )
        if resp.status_code == 403:
            logger.warning("GitHub rate limit hit — add GITHUB_TOKEN env var")
            break
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break

        for r in batch:
            created = datetime.fromisoformat(r["created_at"].rstrip("Z")).replace(tzinfo=timezone.utc)
            if created < since_dt:
                return repos
            repos.append(r)
            if len(repos) >= max_repos:
                return repos
        page += 1
        time.sleep(0.5)

    return repos


def _clone_or_pull(repo_name: str) -> Path:
    repo_dir = CACHE_DIR / repo_name
    url = f"https://github.com/{SHERLOCK_ORG}/{repo_name}.git"
    if repo_dir.exists():
        subprocess.run(["git", "-C", str(repo_dir), "pull", "--quiet"], check=False)
    else:
        repo_dir.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--depth=1", url, str(repo_dir)], check=True)
    return repo_dir


def _severity_from_filename(name: str) -> str | None:
    """Sherlock filenames like 001-H.md, 023-M.md encode severity."""
    m = _SEVERITY_FROM_FILENAME.search(name)
    if not m:
        return None
    letter = m.group(1).upper()
    return {"H": "High", "M": "Medium"}.get(letter)


def _parse_finding_md(text: str, filename: str) -> dict[str, Any] | None:
    lines = text.strip().splitlines()
    if not lines or len(text) < 100:
        return None

    title = lines[0].lstrip("#").strip() if lines[0].startswith("#") else filename

    severity = _severity_from_filename(filename)
    if not severity:
        m = _SEVERITY_RE.search(title) or _SEVERITY_RE.search(text[:400])
        severity = m.group(1).capitalize() if m else "Unknown"

    code_blocks = re.findall(r"```(?:solidity|sol)?\s*(.*?)```", text, re.DOTALL)
    vulnerable_code = code_blocks[0].strip() if code_blocks else ""

    remediation_match = re.search(
        r"(?:recommend|mitigation|fix)[:\s]*([^\n]{20,}(?:\n(?!#)[^\n]{5,}){0,4})",
        text, re.IGNORECASE,
    )
    remediation = remediation_match.group(1).strip() if remediation_match else ""

    return {
        "title": title,
        "severity": severity,
        "category": _infer_category(title + " " + text[:400]),
        "description": text[:1500],
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
        "source_repo": f"sherlock-audit/{repo_name}",
    }
    uid = hashlib.md5(doc.encode()).hexdigest()[:16]
    return doc, metadata, f"sherlock-{repo_name[:20]}-{uid}"


def _findings_from_repo(repo_dir: Path, repo_name: str) -> list[dict]:
    """Extract findings from a Sherlock judging repo (markdown or CSV)."""
    findings = []

    # Older repos (pre-2024): individual .md files named like 001-H.md, 023-M.md
    md_files = [
        f for f in repo_dir.rglob("*.md")
        if f.name.lower() not in ("readme.md", "sherlock.md")
        and not f.name.startswith(".")
    ]
    for md_file in md_files:
        try:
            text = md_file.read_text(encoding="utf-8", errors="replace")
            f = _parse_finding_md(text, md_file.stem)
            if f:
                findings.append(f)
        except Exception:
            pass

    # Newer repos (2024+): comments.csv with issue_number,comment columns
    # Each row is a judge's comment on a finding — use first comment as the body
    csv_file = repo_dir / "comments.csv"
    if csv_file.exists() and not findings:
        import csv
        try:
            seen_issues: set[str] = set()
            with csv_file.open(encoding="utf-8", errors="replace") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    issue_num = str(row.get("issue_number") or "")
                    comment = row.get("comment") or ""
                    if issue_num in seen_issues or len(comment) < 80:
                        continue
                    seen_issues.add(issue_num)
                    parsed = _parse_finding_md(comment, f"issue-{issue_num}")
                    if parsed:
                        findings.append(parsed)
        except Exception as e:
            logger.debug(f"CSV parse failed for {repo_name}: {e}")

    return findings


def ingest(collection: chromadb.Collection, since: str = "2023-01-01", max_repos: int = 60) -> int:
    total = 0
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    with httpx.Client() as client:
        all_repos = _list_contest_repos(client, since, max_repos * 2)

    # Only judging repos contain findings; skip source-code-only contest repos
    judging_repos = [r for r in all_repos if r["name"].endswith("-judging")][:max_repos]
    logger.info(f"Found {len(judging_repos)} Sherlock judging repos to ingest")

    for repo in judging_repos:
        repo_name = repo["name"]
        try:
            repo_dir = _clone_or_pull(repo_name)
        except Exception as e:
            logger.warning(f"Clone failed for {repo_name}: {e}")
            continue

        findings = _findings_from_repo(repo_dir, repo_name)
        documents, metadatas, ids = [], [], []
        for finding in findings:
            try:
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
                    source=f"sherlock-audit/{repo_name}",
                    severity=meta["severity"],
                    category=meta["category"],
                )
            except Exception as e:
                logger.debug(f"Skipping finding in {repo_name}: {e}")

        if documents:
            batch_size = 100
            for i in range(0, len(documents), batch_size):
                collection.upsert(
                    documents=documents[i:i + batch_size],
                    metadatas=metadatas[i:i + batch_size],
                    ids=ids[i:i + batch_size],
                )
            logger.info(f"  sherlock-audit/{repo_name}: {len(documents)} findings")
            total += len(documents)

    logger.info(f"✅ Sherlock total: {total} findings")
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
