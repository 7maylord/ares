"""
Unified ingestion runner — populates ChromaDB from all sources.

Sources (run in order):
  1. tintinweb/smart-contract-vulndb  (fast, structured JSON)
  2. Solodit API                       (paginated REST API)
  3. Code4rena contest repos           (GitHub org code-423n4)
  4. Sherlock contest repos            (GitHub org sherlock-audit)
  5. GitHub audit repos (pashov, etc.) (mixed MD/PDF repos)

Usage:
    python -m analyzer.rag.ingest_all [--since 2023-01-01] [--max-repos 60]

Env:
    GITHUB_TOKEN  — optional, raises GitHub rate limit to 5000 req/hr
"""

import argparse
import logging
import shutil
import time
from pathlib import Path

import chromadb
from chromadb.utils import embedding_functions

CACHE_DIR = Path(__file__).parent / ".cache"


def _cleanup_cache(subdir: str) -> None:
    """Delete a clone cache directory after ingestion to free ephemeral disk."""
    target = CACHE_DIR / subdir
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
        logger.info(f"Cleaned up clone cache: {target}")

logger = logging.getLogger(__name__)

DB_DIR = Path(__file__).parent / "chroma_db"
COLLECTION_NAME = "audit_findings"


def _get_collection() -> chromadb.Collection:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(DB_DIR))
    ef = embedding_functions.DefaultEmbeddingFunction()
    return client.get_or_create_collection(COLLECTION_NAME, embedding_function=ef)


def run(since: str = "2023-01-01", max_repos: int = 60) -> None:
    col = _get_collection()
    results: dict[str, int] = {}

    # 1. VulnDB
    logger.info("=" * 50)
    logger.info("Source 1/5: tintinweb/smart-contract-vulndb")
    try:
        from analyzer.rag.ingest_vulndb import ingest as ingest_vulndb
        results["vulndb"] = ingest_vulndb(col)
    except Exception as e:
        logger.error(f"vulndb failed: {e}")
        results["vulndb"] = 0
    finally:
        _cleanup_cache("smart-contract-vulndb")

    # 2. Solodit API (no clone cache)
    logger.info("=" * 50)
    logger.info("Source 2/5: Solodit API")
    try:
        from analyzer.rag.ingest_solodit_api import ingest as ingest_solodit
        results["solodit"] = ingest_solodit(col)
    except Exception as e:
        logger.error(f"Solodit API failed: {e}")
        results["solodit"] = 0

    # 3. Code4rena
    logger.info("=" * 50)
    logger.info(f"Source 3/5: Code4rena (since={since}, max={max_repos} repos)")
    try:
        from analyzer.rag.ingest_code4rena import ingest as ingest_c4
        results["code4rena"] = ingest_c4(col, since=since, max_repos=max_repos)
    except Exception as e:
        logger.error(f"Code4rena failed: {e}")
        results["code4rena"] = 0
    finally:
        _cleanup_cache("code4rena")

    time.sleep(5)

    # 4. Sherlock
    logger.info("=" * 50)
    logger.info(f"Source 4/5: Sherlock (since={since}, max={max_repos} repos)")
    try:
        from analyzer.rag.ingest_sherlock import ingest as ingest_sherlock
        results["sherlock"] = ingest_sherlock(col, since=since, max_repos=max_repos)
    except Exception as e:
        logger.error(f"Sherlock failed: {e}")
        results["sherlock"] = 0
    finally:
        _cleanup_cache("sherlock")

    time.sleep(5)

    # 5. GitHub audit repos (pashov, GuardianAudits, NethermindEth, etc.)
    logger.info("=" * 50)
    logger.info("Source 5/5: GitHub audit repos")
    try:
        from analyzer.rag.ingest_github_reports import ingest as ingest_github
        results["github"] = ingest_github(col)
    except Exception as e:
        logger.error(f"GitHub repos failed: {e}")
        results["github"] = 0
    finally:
        _cleanup_cache("audit_repos")

    # Summary
    total = sum(results.values())
    db_count = col.count()
    logger.info("=" * 50)
    logger.info("INGESTION COMPLETE")
    logger.info(f"  vulndb:    {results['vulndb']:>6} findings")
    logger.info(f"  solodit:   {results['solodit']:>6} findings")
    logger.info(f"  code4rena: {results['code4rena']:>6} findings")
    logger.info(f"  sherlock:  {results['sherlock']:>6} findings")
    logger.info(f"  github:    {results['github']:>6} findings")
    logger.info(f"  ─────────────────────────")
    logger.info(f"  session:   {total:>6} new/updated")
    logger.info(f"  db total:  {db_count:>6} documents in ChromaDB")


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s — %(message)s",
    )
    parser = argparse.ArgumentParser(description="Populate Ares ChromaDB from all audit sources")
    parser.add_argument("--since", default="2023-01-01", help="Ignore repos created before this date (YYYY-MM-DD)")
    parser.add_argument("--max-repos", type=int, default=60, help="Max contest repos per source (Code4rena + Sherlock)")
    args = parser.parse_args()
    run(since=args.since, max_repos=args.max_repos)
