"""
Tests for analyzer/feedback.py

Key invariants:
- POST /feedback with verified=True upserts into ChromaDB and appends to training JSONL
- POST /feedback with verified=False writes to false_positives.jsonl
- The endpoint returns {"status": "ok"} in both cases
- Missing optional fields don't cause failures
"""

import json
import pytest
from unittest.mock import patch, MagicMock, mock_open
from fastapi.testclient import TestClient
from fastapi import FastAPI

from analyzer.feedback import router, FeedbackRequest


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


class TestFeedbackEndpoint:
    def test_verified_finding_returns_ok(self, client):
        with patch("analyzer.feedback._get_collection") as mock_col, \
             patch("analyzer.feedback.append_training_record"):
            mock_col.return_value = MagicMock()
            response = client.post("/feedback", json={
                "finding_id": 1,
                "verified": True,
                "source_code": "pragma solidity ^0.8.0;",
                "vulnerability_title": "Reentrancy",
                "severity": "High",
                "category": "Reentrancy",
                "description": "withdraw() sends ETH before zeroing balance",
            })
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["label"] == "true_positive"

    def test_rejected_finding_returns_ok(self, client, tmp_path):
        with patch("analyzer.feedback.FALSE_POSITIVE_LOG", tmp_path / "fp.jsonl"):
            response = client.post("/feedback", json={
                "finding_id": 99,
                "verified": False,
            })
        assert response.status_code == 200
        data = response.json()
        assert data["label"] == "false_positive"

    def test_verified_finding_upserts_into_chromadb(self, client):
        mock_collection = MagicMock()
        with patch("analyzer.feedback._get_collection", return_value=mock_collection), \
             patch("analyzer.feedback.append_training_record"):
            client.post("/feedback", json={
                "finding_id": 2,
                "verified": True,
                "source_code": "contract Foo {}",
                "vulnerability_title": "Access Control",
                "severity": "Critical",
                "category": "Access Control",
            })
        mock_collection.upsert.assert_called_once()
        call_kwargs = mock_collection.upsert.call_args
        upserted_ids = call_kwargs.kwargs.get("ids") or call_kwargs.args[0] if call_kwargs.args else call_kwargs.kwargs["ids"]
        assert "feedback-verified-2" in str(call_kwargs)

    def test_verified_finding_appends_training_record(self, client):
        with patch("analyzer.feedback._get_collection") as mock_col, \
             patch("analyzer.feedback.append_training_record") as mock_train:
            mock_col.return_value = MagicMock()
            client.post("/feedback", json={
                "finding_id": 3,
                "verified": True,
                "source_code": "contract Bar {}",
                "vulnerability_title": "Overflow",
                "severity": "High",
                "category": "Integer Overflow",
            })
        mock_train.assert_called_once()
        _, kwargs = mock_train.call_args
        assert kwargs["severity"] == "High" or mock_train.call_args[0][5] == "High"

    def test_rejected_finding_writes_to_jsonl(self, client, tmp_path):
        fp_log = tmp_path / "false_positives.jsonl"
        with patch("analyzer.feedback.FALSE_POSITIVE_LOG", fp_log):
            client.post("/feedback", json={
                "finding_id": 55,
                "verified": False,
                "vulnerability_title": "Fake vuln",
                "severity": "Low",
            })
        assert fp_log.exists()
        record = json.loads(fp_log.read_text().strip())
        assert record["finding_id"] == 55
        assert record["label"] == "false_positive"

    def test_verified_without_optional_fields_does_not_crash(self, client):
        with patch("analyzer.feedback._get_collection") as mock_col, \
             patch("analyzer.feedback.append_training_record"):
            mock_col.return_value = MagicMock()
            # No source_code or title — should log and return ok without upserting
            response = client.post("/feedback", json={
                "finding_id": 10,
                "verified": True,
            })
        assert response.status_code == 200
