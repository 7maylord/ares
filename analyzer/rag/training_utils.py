"""
Shared helpers for appending records to the training JSONL pipeline.

All ingestion scripts call append_training_record() so every source
contributes to the same fine-tuning dataset without duplicating logic.
"""

import json
import os
from pathlib import Path

TRAINING_DIR = Path(__file__).parent / "training_data"
TRAINING_FILE = TRAINING_DIR / "findings.jsonl"


def append_training_record(
    instruction: str,
    input_text: str,
    output: str,
    source: str,
    severity: str,
    category: str,
) -> None:
    """Append one training example to findings.jsonl."""
    if not input_text:
        return
    TRAINING_DIR.mkdir(parents=True, exist_ok=True)
    record = {
        "instruction": instruction,
        "input": input_text,
        "output": output,
        "source": source,
        "severity": severity,
        "category": category,
    }
    with TRAINING_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
