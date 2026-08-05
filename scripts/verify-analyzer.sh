#!/usr/bin/env bash
# Verify the analyzer can decompile + audit an UNVERIFIED contract.
# Run AFTER the analyzer redeploys with the Heimdall + decompiler fixes.
#
#   ./scripts/verify-analyzer.sh [targetAddress]
#
# Reads ANALYZER_API_KEY from analyzer/.env and the RPC from contracts/.env.
# Override the analyzer URL with:  ANALYZER_URL=... ./scripts/verify-analyzer.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ANALYZER="${ANALYZER_URL:-https://ares-production-b24f.up.railway.app}"
KEY="$(grep -E '^ANALYZER_API_KEY=' "$ROOT/analyzer/.env" | head -1 | cut -d= -f2- | tr -d '"'\''')"
RPC="$(grep -E '^MANTLE_SEPOLIA_RPC_URL=' "$ROOT/contracts/.env" | head -1 | cut -d= -f2- | tr -d '"'\''')"
TARGET="${1:-0x803836431B4BC7Fc98577a1A42FD48B11A52e5f4}"   # ReentrancyBank (unverified)

python3 - "$ANALYZER" "$KEY" "$RPC" "$TARGET" <<'PY'
import sys, json, time, urllib.request
analyzer, key, rpc, target = sys.argv[1:5]

# 1. fetch on-chain bytecode (what the server sends for an unverified contract)
b = json.dumps({"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":[target,"latest"]}).encode()
code = json.load(urllib.request.urlopen(
    urllib.request.Request(rpc, data=b, headers={"Content-Type":"application/json"}), timeout=30))["result"]
print(f"target {target}  bytecode {len(code)} chars")

# 2. send bytecode-only to the analyzer with the shared key
body = json.dumps({"contract_address": target, "bytecode": code}).encode()
req = urllib.request.Request(analyzer + "/analyze", data=body,
        headers={"Content-Type":"application/json", "x-ares-key": key})
t0 = time.time()
d = json.load(urllib.request.urlopen(req, timeout=180))
print(f"HTTP 200 in {time.time()-t0:.0f}s | source_type={d.get('source_type')} | vulns={d.get('vulnerabilities_found')}")
for x in d.get("details", [])[:8]:
    print(f"  [{x.get('source')}] {x.get('severity')}: {x.get('title')}")

st, n = d.get("source_type"), d.get("vulnerabilities_found", 0)
if st == "decompiled" and n > 0:
    print("PASS — Heimdall decompiled the bytecode and detection found vulns.")
elif st == "decompiled":
    print("PARTIAL — decompiled OK but 0 vulns (Heimdall output may be lossy). No longer a false SECURE.")
else:
    print(f"FAIL — source_type={st}; decompilation still not producing usable source.")
PY
