"""
POST /feedback endpoint for the continuous learning loop.

Called by the NestJS server whenever BountyEscrow emits
FindingVerified or FindingRejected on-chain.

Verified findings → added to ChromaDB with high-confidence metadata
Rejected findings → logged as false positives (excluded from RAG)
Both              → appended to training_data/findings.jsonl with labels
"""

import json
import logging
from pathlib import Path
from typing import Optional

import chromadb
from chromadb.utils import embedding_functions
from fastapi import APIRouter
from pydantic import BaseModel

from analyzer.rag.training_utils import append_training_record

logger = logging.getLogger(__name__)

router = APIRouter()

DB_DIR = Path(__file__).parent / "rag" / "chroma_db"
COLLECTION_NAME = "audit_findings"
FALSE_POSITIVE_LOG = Path(__file__).parent / "rag" / "training_data" / "false_positives.jsonl"


class FeedbackRequest(BaseModel):
    finding_id: int
    verified: bool
    # Optional enrichment fields — the server can send these if it stored them
    source_code: Optional[str] = None
    vulnerability_title: Optional[str] = None
    severity: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None


def _get_collection() -> chromadb.Collection:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(DB_DIR))
    ef = embedding_functions.DefaultEmbeddingFunction()
    return client.get_or_create_collection(COLLECTION_NAME, embedding_function=ef)


@router.post("/feedback")
def receive_feedback(request: FeedbackRequest):
    finding_id = request.finding_id
    label = "true_positive" if request.verified else "false_positive"
    logger.info(f"Feedback received: finding {finding_id} → {label}")

    if request.verified:
        _handle_verified(request)
    else:
        _handle_rejected(request)

    return {"status": "ok", "finding_id": finding_id, "label": label}


def _handle_verified(req: FeedbackRequest) -> None:
    """Add verified finding to ChromaDB with high-confidence metadata."""
    if not req.source_code and not req.vulnerability_title:
        # Nothing enriching to add — just log
        logger.info(f"Finding {req.finding_id} verified but no code/title to ingest")
        return

    title = req.vulnerability_title or f"Verified Finding #{req.finding_id}"
    severity = req.severity or "Unknown"
    category = req.category or "General"
    description = req.description or ""

    doc = (
        f"## {title}\n**Severity:** {severity}\n**Category:** {category}\n"
        f"\n### Vulnerable Code\n```solidity\n{(req.source_code or '').strip()}\n```\n"
        f"\n### Description\n{description}\n"
    )

    collection = _get_collection()
    uid = f"feedback-verified-{req.finding_id}"
    collection.upsert(
        documents=[doc],
        metadatas=[{
            "severity": severity,
            "category": category,
            "title": title,
            "source_repo": "ares-feedback",
            "confidence": "verified",
        }],
        ids=[uid],
    )

    # Also append to training JSONL as a labelled true positive
    append_training_record(
        instruction="Analyze the following Solidity code for vulnerabilities",
        input_text=req.source_code or "",
        output=json.dumps({
            "title": title,
            "severity": severity,
            "category": category,
            "description": description,
            "label": "true_positive",
        }),
        source="ares-feedback",
        severity=severity,
        category=category,
    )
    logger.info(f"Finding {req.finding_id} added to ChromaDB as verified true positive")


def _handle_rejected(req: FeedbackRequest) -> None:
    """Log rejected finding as false positive for future model training."""
    FALSE_POSITIVE_LOG.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "finding_id": req.finding_id,
        "label": "false_positive",
        "source_code": req.source_code or "",
        "title": req.vulnerability_title or "",
        "severity": req.severity or "",
        "category": req.category or "",
        "description": req.description or "",
    }
    with FALSE_POSITIVE_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    logger.info(f"Finding {req.finding_id} logged as false positive")
