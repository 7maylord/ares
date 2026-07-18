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
        """Run Slither on a single Solidity source string."""
        if not os.path.isfile(_SLITHER_BIN):
            return {"error": f"slither binary not found at {_SLITHER_BIN}"}

        pragma_match = re.search(r"pragma solidity\s+[^;]+;", source_code)
        if pragma_match and _SOLC_SELECT_BIN and os.path.isfile(_SOLC_SELECT_BIN):
            _ensure_solc(pragma_match.group(0))

        with tempfile.NamedTemporaryFile(suffix=".sol", delete=False, mode="w") as tmp:
            tmp.write(source_code)
            tmp_path = tmp.name

        try:
            return self._run_slither(tmp_path)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def run_analysis_on_sources(self, sources: dict, entry: str | None = None) -> dict:
        """
        Run Slither on a multi-file project.

        sources: mapping of relative filename → Solidity source text,
                 e.g. {"contracts/Token.sol": "...", "contracts/Vault.sol": "..."}
        entry:   the relative filename of the entry contract (optional).
                 If omitted, Slither is pointed at the whole temp directory.
        """
        if not os.path.isfile(_SLITHER_BIN):
            return {"error": f"slither binary not found at {_SLITHER_BIN}"}

        tmpdir = tempfile.mkdtemp()
        try:
            real_tmpdir = os.path.realpath(tmpdir)
            entry_path = None
            for filename, content in sources.items():
                clean = os.path.normpath(filename.replace("\\", "/"))
                if clean.startswith("/") or clean.startswith("..") or os.path.isabs(clean):
                    logger.warning("Skipping suspicious source path: %s", filename)
                    continue
                dest = os.path.realpath(os.path.join(tmpdir, clean))
                if not dest.startswith(real_tmpdir + os.sep):
                    logger.warning("Path traversal blocked: %s", filename)
                    continue
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "w") as f:
                    f.write(content)
                if entry and filename == entry:
                    entry_path = dest

            target = entry_path or tmpdir

            # Pick solc version from the entry file (or first file)
            sample = sources.get(entry) or next(iter(sources.values()), "")
            pragma_match = re.search(r"pragma solidity\s+[^;]+;", sample)
            if pragma_match and _SOLC_SELECT_BIN and os.path.isfile(_SOLC_SELECT_BIN):
                _ensure_solc(pragma_match.group(0))

            return self._run_slither(target, cwd=tmpdir)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def _run_slither(self, target: str, cwd: str | None = None) -> dict:
        try:
            result = subprocess.run(
                [_SLITHER_BIN, target, "--json", "-"],
                capture_output=True,
                text=True,
                timeout=120,
                cwd=cwd,
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
