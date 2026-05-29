from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import os
import logging

from analyzer.analyzers.slither_runner import SlitherRunner
from analyzer.analyzers.llm_rag_runner import LLMRagRunner

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

# Instantiate runners
slither_runner = SlitherRunner()
# Lazy load LLM RAG runner only if API key is present, to prevent crash on startup if missing
try:
    if os.getenv("OPENAI_API_KEY"):
        llm_rag_runner = LLMRagRunner()
    else:
        logger.warning("OPENAI_API_KEY not found in environment. LLM RAG analysis will be disabled.")
        llm_rag_runner = None
except Exception as e:
    logger.error(f"Failed to initialize LLM RAG runner: {e}")
    llm_rag_runner = None

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
    
    source = request.source_code or ""
    all_findings = []

    # 1. Run Slither if source code is provided
    if source:
        logger.info(f"Running Slither analysis on contract {request.contract_address}...")
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

    # 2. Run LLM RAG if source code is provided and enabled
    if source and llm_rag_runner:
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

    # If no source code but bytecode is provided, we can log it (future work)
    if not source and request.bytecode:
        logger.info(f"Bytecode analysis requested for contract {request.contract_address} (Not implemented in MVP)")

    return AnalyzeResponse(
        status="success",
        vulnerabilities_found=len(all_findings),
        details=all_findings
    )
