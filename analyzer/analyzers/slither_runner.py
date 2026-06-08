import subprocess
import json
import os
import sys
import tempfile
import shutil
import logging
import re

logger = logging.getLogger(__name__)

# Derive the slither binary path from the running Python executable so this
# works whether or not the venv is activated in the shell.
_PYTHON_BIN = os.path.dirname(sys.executable)
_SLITHER_BIN = shutil.which("slither") or os.path.join(_PYTHON_BIN, "slither")
_SOLC_SELECT_BIN = shutil.which("solc-select") or os.path.join(_PYTHON_BIN, "solc-select")


def _ensure_solc(pragma: str) -> str | None:
    """
    Parse the pragma and make sure the required solc version is installed via
    solc-select. Returns the version string selected, or None on failure.
    """
    m = re.search(r"\^?(\d+\.\d+\.\d+)", pragma)
    if not m:
        version = "0.8.20"
    else:
        version = m.group(1)

    try:
        # Install if not already present (idempotent)
        subprocess.run(
            [_SOLC_SELECT_BIN, "install", version],
            capture_output=True, text=True, timeout=60,
        )
        subprocess.run(
            [_SOLC_SELECT_BIN, "use", version],
            capture_output=True, text=True, timeout=10,
        )
        return version
    except Exception as e:
        logger.warning(f"solc-select failed for {version}: {e}")
        return None


class SlitherRunner:
    def run_analysis_on_source(self, source_code: str) -> dict:
        """Run Slither on Solidity source and return its JSON output."""
        if not os.path.isfile(_SLITHER_BIN):
            return {"error": f"slither binary not found at {_SLITHER_BIN}"}

        # solc is expected on PATH (installed via Homebrew or solc-select)
        # solc-select is used as fallback only if the version differs
        pragma_match = re.search(r"pragma solidity\s+[^;]+;", source_code)
        if pragma_match and _SOLC_SELECT_BIN and os.path.isfile(_SOLC_SELECT_BIN):
            _ensure_solc(pragma_match.group(0))

        with tempfile.NamedTemporaryFile(suffix=".sol", delete=False, mode="w") as tmp:
            tmp.write(source_code)
            tmp_path = tmp.name

        try:
            result = subprocess.run(
                [_SLITHER_BIN, tmp_path, "--json", "-"],
                capture_output=True,
                text=True,
                timeout=120,
            )
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                return {
                    "error": "Failed to parse slither output",
                    "raw": result.stdout[:500],
                    "stderr": result.stderr[:500],
                }
        except subprocess.TimeoutExpired:
            return {"error": "Slither timed out"}
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
