from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import os
import logging

from analyzer.analyzers.slither_runner import SlitherRunner
from analyzer.analyzers.llm_rag_runner import LLMRagRunner
from analyzer.analyzers.decompiler import decompile
from analyzer.feedback import router as feedback_router
from analyzer.poc_validator import PoCValidator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Ares Analyzer Microservice",
    description="Python microservice for smart contract security analysis",
    version="1.0.0"
)

class AnalyzeRequest(BaseModel):
    contract_address: str
    source_code: Optional[str] = None
    bytecode: Optional[str] = None

class AnalyzeResponse(BaseModel):
    status: str
    vulnerabilities_found: int
    details: List[Dict[str, Any]]
    source_type: str  # "verified_source" | "decompiled" | "bytecode_only"

# Instantiate runners
slither_runner = SlitherRunner()
poc_validator = PoCValidator()
# Lazy load LLM RAG runner only if API key is present, to prevent crash on startup if missing
try:
    llm_rag_runner = LLMRagRunner()
    # LLMRagRunner logs its own backend selection (Claude / Ollama / none)
    if not os.getenv("ANTHROPIC_API_KEY") and not os.getenv("OLLAMA_MODEL"):
        llm_rag_runner = None
except Exception as e:
    logger.error(f"Failed to initialize LLM RAG runner: {e}")
    llm_rag_runner = None

app.include_router(feedback_router)

@app.get("/")
def read_root():
    return {
        "status": "Ares Analyzer is running",
        "llm_rag_enabled": llm_rag_runner is not None
    }

@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_contract(request: AnalyzeRequest):
    if not request.source_code and not request.bytecode:
        raise HTTPException(status_code=400, detail="Must provide either source_code or bytecode")

    all_findings = []
    source_type: str

    if request.source_code:
        # Verified Solidity source — analyze directly
        source = request.source_code
        source_type = "verified_source"
    else:
        # No source — decompile bytecode first
        logger.info(f"No source for {request.contract_address}, decompiling bytecode...")
        source = decompile(request.bytecode)
        source_type = "decompiled"
        logger.info(f"Decompiled {len(request.bytecode)} byte bytecode → {len(source)} chars")

    # 1. Run Slither on whatever source we have
    logger.info(f"Running Slither analysis on contract {request.contract_address} ({source_type})...")
    try:
        slither_results = slither_runner.run_analysis_on_source(source)
        if isinstance(slither_results, dict) and "results" in slither_results:
            detectors = slither_results["results"].get("detectors", [])
            for det in detectors:
                all_findings.append({
                    "source": "slither",
                    "title": det.get("check", "Slither Finding"),
                    "severity": det.get("impact", "Medium"),
                    "category": det.get("check", "Static Analysis"),
                    "location": det.get("first_markdown_element", "unknown"),
                    "description": det.get("description", ""),
                    "poc_sketch": "N/A",
                    "remediation": det.get("recommendation", "Review code logic")
                })
    except Exception as e:
        logger.error(f"Slither analysis failed: {e}")

    # 2. Run LLM RAG if enabled
    if llm_rag_runner:
        logger.info(f"Running LLM RAG analysis on contract {request.contract_address}...")
        try:
            llm_findings = llm_rag_runner.analyze(source)
            if isinstance(llm_findings, list):
                for finding in llm_findings:
                    if isinstance(finding, dict):
                        finding["source"] = "llm_rag"
                        all_findings.append(finding)
        except Exception as e:
            logger.error(f"LLM RAG analysis failed: {e}")

    # Generate ABI-encoded PoC payload for each finding (falls back to "0x" if no template)
    contract_info = {"address": request.contract_address}
    for finding in all_findings:
        if not finding.get("poc_sketch") or finding["poc_sketch"] == "N/A":
            finding["poc_sketch"] = poc_validator.generate_poc(
                finding.get("category", ""), contract_info
            )

    return AnalyzeResponse(
        status="success",
        vulnerabilities_found=len(all_findings),
        details=all_findings,
        source_type=source_type,
    )


class IngestRequest(BaseModel):
    since: Optional[str] = "2023-01-01"
    max_repos: Optional[int] = 60


@app.post("/ingest")
def trigger_ingest(request: IngestRequest):
    """
    Trigger knowledge base population from all audit sources.
    Runs in the background — returns immediately with a status message.
    Long-running (can take 30-60 min for a full ingest).
    """
    import threading
    from analyzer.rag.ingest_all import run as run_ingest

    def _bg():
        try:
            run_ingest(since=request.since, max_repos=request.max_repos)
        except Exception as e:
            logger.error(f"Background ingest failed: {e}")

    t = threading.Thread(target=_bg, daemon=True)
    t.start()
    return {
        "status": "started",
        "message": f"Ingesting from all sources (since={request.since}, max_repos={request.max_repos}). Check server logs for progress.",
    }


@app.get("/ingest/status")
def ingest_status():
    """Return current ChromaDB document count."""
    try:
        import chromadb
        from pathlib import Path
        db_dir = Path(__file__).parent / "rag" / "chroma_db"
        if not db_dir.exists():
            return {"count": 0, "status": "empty"}
        client = chromadb.PersistentClient(path=str(db_dir))
        col = client.get_or_create_collection("audit_findings")
        return {"count": col.count(), "status": "ready"}
    except Exception as e:
        return {"count": 0, "status": "error", "detail": str(e)}
