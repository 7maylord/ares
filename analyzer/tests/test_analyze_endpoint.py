"""
Tests for the POST /analyze endpoint in analyzer/main.py

Key invariants:
- Returns 400 when neither source_code nor bytecode is provided
- Passes source_code directly to Slither when provided (verified_source path)
- Decompiles bytecode when only bytecode is provided (decompiled path)
- Returns source_type tag matching the code path taken
- LLM RAG results are merged into the findings list
- Slither / LLM failures are caught and don't crash the endpoint
"""

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    # Patch LLM RAG runner to avoid needing an API key at test time
    with patch("analyzer.main.llm_rag_runner", None):
        from analyzer.main import app
        yield TestClient(app)


SIMPLE_SOURCE = "pragma solidity ^0.8.0;\ncontract Safe {}"


class TestAnalyzeEndpoint:
    def test_returns_400_when_no_code_provided(self, client):
        response = client.post("/analyze", json={"contract_address": "0xabc"})
        assert response.status_code == 400

    def test_source_code_path_returns_verified_source_type(self, client):
        with patch("analyzer.main.slither_runner") as mock_slither:
            mock_slither.run_analysis_on_source.return_value = {"results": {"detectors": []}}
            response = client.post("/analyze", json={
                "contract_address": "0xabc",
                "source_code": SIMPLE_SOURCE,
            })
        assert response.status_code == 200
        data = response.json()
        assert data["source_type"] == "verified_source"
        assert data["status"] == "success"

    def test_bytecode_only_path_returns_decompiled_type(self, client):
        with patch("analyzer.main.slither_runner") as mock_slither, \
             patch("analyzer.main.decompile", return_value="// decompiled\nfunction foo(){}") as mock_dec:
            mock_slither.run_analysis_on_source.return_value = {"results": {"detectors": []}}
            response = client.post("/analyze", json={
                "contract_address": "0xabc",
                "bytecode": "0x6080604052",
            })
        assert response.status_code == 200
        data = response.json()
        assert data["source_type"] == "decompiled"
        mock_dec.assert_called_once_with("0x6080604052")

    def test_slither_findings_are_returned(self, client):
        mock_detector = {
            "check": "reentrancy-eth",
            "impact": "High",
            "description": "Reentrancy in withdraw()",
            "first_markdown_element": "Vault.sol#L10",
            "recommendation": "Use CEI pattern",
        }
        with patch("analyzer.main.slither_runner") as mock_slither:
            mock_slither.run_analysis_on_source.return_value = {
                "results": {"detectors": [mock_detector]}
            }
            response = client.post("/analyze", json={
                "contract_address": "0xabc",
                "source_code": SIMPLE_SOURCE,
            })
        data = response.json()
        assert data["vulnerabilities_found"] == 1
        assert data["details"][0]["source"] == "slither"
        assert data["details"][0]["title"] == "reentrancy-eth"

    def test_slither_failure_does_not_crash_endpoint(self, client):
        with patch("analyzer.main.slither_runner") as mock_slither:
            mock_slither.run_analysis_on_source.side_effect = RuntimeError("slither crashed")
            response = client.post("/analyze", json={
                "contract_address": "0xabc",
                "source_code": SIMPLE_SOURCE,
            })
        assert response.status_code == 200
        assert response.json()["vulnerabilities_found"] == 0

    def test_llm_rag_findings_merged_when_enabled(self, client):
        llm_finding = {
            "title": "Price oracle manipulation",
            "severity": "Critical",
            "category": "Oracle",
            "description": "Uses spot price",
            "remediation": "Use TWAP",
            "poc_sketch": "N/A",
        }
        mock_llm = MagicMock()
        mock_llm.analyze.return_value = [llm_finding]

        with patch("analyzer.main.slither_runner") as mock_slither, \
             patch("analyzer.main.llm_rag_runner", mock_llm):
            mock_slither.run_analysis_on_source.return_value = {"results": {"detectors": []}}
            response = client.post("/analyze", json={
                "contract_address": "0xabc",
                "source_code": SIMPLE_SOURCE,
            })
        data = response.json()
        assert data["vulnerabilities_found"] == 1
        assert data["details"][0]["source"] == "llm_rag"
