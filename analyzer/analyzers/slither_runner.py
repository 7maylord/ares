import subprocess
import json
import os
import tempfile

class SlitherRunner:
    def __init__(self):
        pass

    def run_analysis_on_source(self, source_code: str) -> dict:
        """
        Runs slither on a piece of raw solidity source code.
        """
        # Create a temporary solidity file
        with tempfile.NamedTemporaryFile(suffix=".sol", delete=False, mode="w") as temp_sol:
            temp_sol.write(source_code)
            temp_path = temp_sol.name

        try:
            # Run slither
            # Note: requires solc to be installed and available in PATH
            result = subprocess.run(
                ["slither", temp_path, "--json", "-"],
                capture_output=True,
                text=True
            )
            
            # Slither outputs JSON to stdout if --json - is used
            # But sometimes it mixes with other stdout messages, so parsing needs to be robust
            try:
                output_json = json.loads(result.stdout)
                return output_json
            except json.JSONDecodeError:
                return {"error": "Failed to parse slither output", "raw": result.stdout, "stderr": result.stderr}
                
        finally:
            # Cleanup
            if os.path.exists(temp_path):
                os.remove(temp_path)
