# Ares — Autonomous Bug Bounty Hunter

Ares is a fully autonomous, crypto-economically aligned smart contract security platform. It watches the Mantle Sepolia blockchain for new bug bounties, automatically fetches and analyzes each contract using static analysis and LLM-augmented reasoning, submits verified vulnerability findings as on-chain transactions, and collects the MNT payout — all without any human intervention.

> **Live demo:** [ares-x.vercel.app](https://ares-x.vercel.app)

---

## How It Works

The full lifecycle runs autonomously from a single on-chain event:

```
BountyCreated (on-chain event)
        │
        ▼
ContractFetcherService
  ├── Mantlescan API → verified Solidity source       (preferred)
  └── eth_getCode → raw bytecode
              └── Heimdall decompiler → pseudo-Solidity  (fallback)
        │
        ▼
Python Analyzer  POST /analyze
  ├── Slither — deterministic static analysis
  └── LLM RAG — Claude + 62,000 real audit findings (ChromaDB)
        │
        ▼
SubmitterService → BountyPool.submitFinding()        (on-chain tx)
        │
        ▼
EscrowService → BountyEscrow.verify()               (on-chain tx, releases payout)
        │
        ▼
FeedbackService ← FindingVerified / FindingRejected events
        │
        ▼
POST /feedback → ChromaDB update + training_data.jsonl  (continuous learning)
```

**What makes Ares different from a scanner:**

- Findings are submitted **as Ethereum transactions** — not reports, not emails.
- The agent **earns MNT** when findings are verified, building an on-chain reputation score.
- The knowledge base **improves over time** — every verified finding is fed back into ChromaDB.
- Any developer can request an audit by **sending 2 MNT** — no signup, no dashboard, just an HTTP call.

---

## Repository Structure

```
ares/
├── contracts/   Solidity smart contracts (Foundry)
├── analyzer/    Python vulnerability analysis microservice (FastAPI)
├── server/      NestJS orchestrator and API gateway
└── client/      Next.js dashboard (Vercel)
```

---

## 1. `contracts/` — On-Chain Infrastructure

Three contracts deployed on Mantle Sepolia, built with Foundry and OpenZeppelin. All have 100% test coverage.

### ReputationLedger.sol

Tracks each agent's reputation score on-chain. An agent must hold a minimum score of **100** before `BountyPool` will accept its findings — this prevents sybil spam submissions. The deployer registers agents manually; each verified finding increments the agent's score.

```solidity
function reputationScore(address agent) external view returns (uint256)
function registerAgent(address agent) external onlyRole(DEFAULT_ADMIN_ROLE)
function incrementReputation(address agent) external onlyRole(ESCROW_ROLE)
```

### BountyPool.sol

The primary on-chain contract. Protocol owners deposit MNT rewards and define a target contract and minimum severity threshold. Emits `BountyCreated` which triggers the Ares agent.

```solidity
// Create a bounty — msg.value must equal rewardAmount
function createBounty(
    address targetContract,
    uint256 rewardAmount,
    Severity severityThreshold,    // Low | Medium | High | Critical
    uint256 deadline,
    address[] calldata whitelistedAgents
) external payable returns (uint256 bountyId)

// Called by the Ares agent after analysis
function submitFinding(
    uint256 bountyId,
    bytes calldata pocData,
    string calldata description,
    Severity severity
) external returns (uint256 findingId)
```

Key rules enforced on-chain:
- Agent must have `reputationScore >= MIN_REPUTATION_TO_SUBMIT` (100).
- Agent can only submit one finding per bounty.
- Finding severity must meet or exceed the bounty's `severityThreshold`.
- Deadline must not have passed.

### BountyEscrow.sol

Acts as an escrow and oracle. Holds the bounty reward and releases it to the agent when a finding is verified. In the current MVP, the Ares agent itself acts as the oracle (auto-verify after submission). The architecture supports plugging in a real third-party oracle later.

```solidity
function verify(uint256 findingId) external    // releases payout to agent
function reject(uint256 findingId) external    // returns funds to protocol
```

Emits `FindingVerified` (triggers payout + reputation increment) or `FindingRejected` (triggers feedback loop).

### Target Contracts (for testing)

Five intentionally vulnerable contracts in `src/targets/` for testing the Ares pipeline:

| Contract | Primary Vulnerability |
|----------|----------------------|
| `ReentrancyBank.sol` | Classic reentrancy in withdraw |
| `InsecureStaking.sol` | Missing access control on reward claims |
| `NaiveAMM.sol` | Unchecked ERC-20 return values, price manipulation |
| `UnprotectedUpgrade.sol` | `tx.origin` auth, unprotected upgrade path |
| `VulnerableVault.sol` | Reentrancy, `tx.origin` auth, missing access control, unchecked arithmetic, front-running (12 bugs total) |

Deploy any target and create a bounty:

```bash
cd contracts

# Deploy VulnerableVault with a 10 MNT bounty
forge script script/DeployVault.s.sol \
  --rpc-url $MANTLE_SEPOLIA_RPC_URL \
  --broadcast \
  --private-key $PRIVATE_KEY

# Or deploy all four original targets at once
forge script script/DeployTargets.s.sol \
  --rpc-url $MANTLE_SEPOLIA_RPC_URL \
  --broadcast \
  --private-key $PRIVATE_KEY
```

Required env vars in `contracts/.env`: `PRIVATE_KEY`, `POOL_ADDRESS`, `MANTLE_SEPOLIA_RPC_URL`.

---

## 2. `analyzer/` — Python Analysis Microservice

A FastAPI service that performs two independent analyses and merges their findings.

### Analysis pipeline (`POST /analyze`)

**Step 1 — Source acquisition**

The server sends either verified Solidity source (from Mantlescan) or raw bytecode. If bytecode is provided without source, the analyzer decompiles it using **Heimdall** (produces pseudo-Solidity) or falls back to basic opcode disassembly.

**Step 2 — Slither static analysis**

Slither runs on the Solidity source (real or decompiled). It detects common vulnerability patterns deterministically: reentrancy, unchecked return values, integer issues, access control gaps, and more. Output is a list of findings with detector name, impact, confidence, and location.

**Step 3 — LLM RAG analysis**

Queries ChromaDB for the 5 most semantically similar past audit findings (from Code4rena, Sherlock, and Solodit competitions). These are injected as context into a Claude prompt (or Ollama if Claude is unavailable). The LLM reasons about the contract's vulnerabilities with real-world precedent, producing structured JSON output with title, severity, category, location, description, PoC sketch, and remediation.

**Step 4 — Merge and return**

Both result sets are merged, deduplicated, and returned as a unified JSON response.

### LLM Backend Priority

| Priority | Backend | Trigger |
|----------|---------|---------|
| 1 | Anthropic Claude (`claude-sonnet-4-6`) | `ANTHROPIC_API_KEY` is set |
| 2 | Ollama (local) | `OLLAMA_BASE_URL` or `OLLAMA_MODEL` is set |
| 3 | None (Slither only) | Neither key is set |

Set `DISABLE_RAG=true` to skip ChromaDB entirely and run with Slither + Claude only (fits in 512 MB RAM — useful for constrained environments).

### Other endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Health check, returns LLM status |
| `POST /analyze` | Main analysis endpoint |
| `POST /feedback` | Ingest a verified/rejected finding back into ChromaDB |
| `POST /ingest` | Re-run the full RAG ingest pipeline in a background thread |
| `GET /ingest/status` | Returns current ChromaDB document count |

### RAG Knowledge Base

The ChromaDB vector store is populated from five sources:

| Source | Findings | Notes |
|--------|----------|-------|
| tintinweb/smart-contract-vulndb | ~38,000 | JSONL format |
| Sherlock judging repos | ~19,000 | `-judging` suffix repos |
| Code4rena contest repos | ~4,000 | `code-423n4` org |
| GitHub audit reports | ~1,000 | Markdown PDFs |
| Solodit API | variable | REST API |
| **Total** | **~62,000** | |

Run ingest once after cloning (takes 1–2 hours, produces ~1.2 GB of ChromaDB data):

```bash
cd ares    # run from repo root, not from inside analyzer/
source analyzer/venv/bin/activate
export GITHUB_TOKEN=ghp_...   # optional — raises rate limit from 60 to 5000 req/hr
python -m analyzer.rag.ingest_all --since 2021-01-01 --max-repos 200
rm -rf analyzer/rag/.cache/   # delete 7 GB clone cache after ingest
```

On production (Render), ingest runs automatically on first boot via `entrypoint.sh`. Subsequent boots skip ingest if a lock file or the SQLite DB exists.

---

## 3. `server/` — NestJS Orchestrator

The backend API that wires all components together. Runs on port 3001.

### Services

**BlockchainService**
- Subscribes to `BountyCreated`, `FindingSubmitted`, `FindingVerified`, and `FindingRejected` events using `viem`.
- On startup, backfills missed events since the last run (bounties and pending findings).
- Reads `MANTLE_SEPOLIA_RPC_URL` for all viem clients — configure this to avoid public RPC timeouts.

**ContractFetcherService**
- Tries Mantlescan API first for verified Solidity source.
- Falls back to `eth_getCode` (raw bytecode) for unverified contracts.
- Always fetches both if possible — having source + bytecode lets the analyzer cross-validate.

**AnalysisProcessor**
- Called for every new bounty. Runs the full fetch → analyze → submit pipeline.
- Saves **all** findings to the database (one row per vulnerability, sorted by severity).
- Submits only the highest-severity finding on-chain (one transaction per bounty, as the contract requires).
- Attaches the submission `txHash` to every finding row for that bounty.

**SubmitterService / EscrowService**
- `SubmitterService` calls `BountyPool.submitFinding()` and returns the tx hash.
- `EscrowService` calls `BountyEscrow.verify()` immediately after submission (MVP oracle mode).
- Both use `AGENT_PRIVATE_KEY` and respect `MANTLE_SEPOLIA_RPC_URL`.

**FeedbackService**
- Listens for `FindingVerified` / `FindingRejected` events.
- POSTs the finding details to `analyzer/feedback` so the knowledge base improves over time.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `GET` | `/bounties` | All bounties from the database |
| `GET` | `/findings` | All findings from the database |
| `GET` | `/findings/contract/:address` | All findings for a specific contract |
| `GET` | `/events` | Live activity event log |
| `GET` | `/agent` | Agent wallet address and reputation score |
| `POST` | `/analysis/trigger` | Manually re-trigger analysis for a contract address |
| `POST` | `/audit` | One-shot paid audit (requires on-chain MNT payment) |

### Environment Variables

Copy `server/.env.sample` to `server/.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Supabase recommended) |
| `MANTLE_SEPOLIA_RPC_URL` | Yes | Mantle Sepolia RPC — use a dedicated endpoint to avoid timeouts |
| `MANTLESCAN_API_KEY` | Yes | Mantlescan API key — enables verified source fetching |
| `POOL_ADDRESS` | Yes | Deployed `BountyPool` contract address |
| `ESCROW_ADDRESS` | Yes | Deployed `BountyEscrow` contract address |
| `REPUTATION_ADDRESS` | Yes | Deployed `ReputationLedger` contract address |
| `AGENT_PRIVATE_KEY` | Yes | Private key for the Ares agent wallet — never use your main wallet |
| `ANALYZER_SERVICE_URL` | Yes | URL of the Python analyzer (default: `http://localhost:8000`) |
| `ANTHROPIC_API_KEY` | No | Claude API key — falls back to Ollama or Slither-only if unset |
| `PAYMENT_ADDRESS` | No | Address that receives MNT for `POST /audit` (default: ReputationLedger address) |

---

## 4. `client/` — Next.js Dashboard

The user-facing interface at [ares-x.vercel.app](https://ares-x.vercel.app). Built with Next.js (App Router), Tailwind CSS, Wagmi, and Privy for wallet connection.

### Pages

- **`/dashboard`** — Main dashboard with four tabs:
  - **Overview** — Stats (total bounties, active bounties, total payouts, verified findings), run-Ares panel, live activity feed
  - **Bounties & Escrows** — Full table of all on-chain bounties with status, reward, deadline
  - **Findings** — Grouped by contract — one card per contract showing all vulnerability titles, highest severity, and payout tx links. Click to drill into the detail page.
  - **Reputation Ledger** — Agent leaderboard with on-chain reputation scores

- **`/findings/[address]`** — Detail page for a specific contract. Shows all findings sorted by severity, with full description, PoC sketch, remediation, and Mantlescan links for both the submission tx and payout tx.

### Creating a Bounty (from the dashboard)

1. Connect wallet (Privy — supports embedded wallet or MetaMask)
2. Switch to Mantle Sepolia if prompted
3. Enter the target contract address, reward amount (MNT), minimum severity, and deadline
4. Approve the transaction — `BountyPool.createBounty()` is called on-chain
5. Ares detects the `BountyCreated` event and begins analysis automatically

---

## Live Deployments

| Service | URL |
|---------|-----|
| Dashboard | [ares-x.vercel.app](https://ares-x.vercel.app) |
| API Server | [ares-server-97ef.onrender.com](https://ares-server-97ef.onrender.com) |
| Analyzer | [ares-analyzer.onrender.com](https://ares-analyzer.onrender.com) |

## Deployed Contracts (Mantle Sepolia)

| Contract | Address |
|----------|---------|
| ReputationLedger | [`0x2986F9236991F156aEfB94F369551a95E67F0aCc`](https://sepolia.mantlescan.xyz/address/0x2986F9236991F156aEfB94F369551a95E67F0aCc) |
| BountyPool | [`0x9Bc25B223787Ce045e8B5C19A2547B3b1eBDA1D8`](https://sepolia.mantlescan.xyz/address/0x9Bc25B223787Ce045e8B5C19A2547B3b1eBDA1D8) |
| BountyEscrow | [`0x084D072416984F89d9dfF6548A357C88aE7A39Fe`](https://sepolia.mantlescan.xyz/address/0x084D072416984F89d9dfF6548A357C88aE7A39Fe) |

---

## Getting Started Locally

### Prerequisites

- Node.js 20+, pnpm
- Python 3.12+
- Foundry (`curl -L https://foundry.paradigm.xyz | bash`)
- A Mantle Sepolia RPC URL and funded wallet

### 1. Contracts

```bash
cd contracts
forge install
forge test          # should pass with 100% coverage
forge build
```

Deploy (requires `contracts/.env` with `PRIVATE_KEY`, `MANTLE_SEPOLIA_RPC_URL`):

```bash
# Deploy core contracts (first time only)
forge script script/Deploy.s.sol --rpc-url $MANTLE_SEPOLIA_RPC_URL --broadcast --private-key $PRIVATE_KEY

# Deploy test targets
forge script script/DeployVault.s.sol --rpc-url $MANTLE_SEPOLIA_RPC_URL --broadcast --private-key $PRIVATE_KEY
```

### 2. Analyzer

```bash
cd analyzer
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cd ..

# Populate ChromaDB — run once (~1-2 hrs, ~1.2 GB output)
export GITHUB_TOKEN=ghp_...   # optional but recommended
python -m analyzer.rag.ingest_all --since 2021-01-01 --max-repos 200
rm -rf analyzer/rag/.cache/   # delete ~7 GB clone cache after

# Start analyzer
uvicorn analyzer.main:app --port 8000 --reload
```

Skip ingest and run without RAG (Slither + Claude only, minimal RAM):

```bash
DISABLE_RAG=true uvicorn analyzer.main:app --port 8000 --reload
```

### 3. Server

```bash
cp server/.env.sample server/.env
# Fill in all values in server/.env

cd server
pnpm install
pnpm run start:dev   # starts on port 3001
```

### 4. Client

```bash
cd client
pnpm install
pnpm run dev         # starts on port 3000
```

---

## Paid Audit API (`POST /audit`)

Any developer or autonomous agent can request a one-shot audit without creating a bounty.

### How it works

1. Send **≥ 2 MNT** to the payment address on Mantle Sepolia:
   ```
   0x2986F9236991F156aEfB94F369551a95E67F0aCc
   ```

2. Call the audit endpoint with the contract address and your payment tx hash:
   ```bash
   curl -X POST https://ares-server-97ef.onrender.com/audit \
     -H "Content-Type: application/json" \
     -d '{
       "contractAddress": "0xYourContractAddress",
       "txHash": "0xYourPaymentTxHash"
     }'
   ```

3. Receive a structured JSON audit report:
   ```json
   {
     "contractAddress": "0x...",
     "isVerified": true,
     "contractName": "MyToken",
     "vulnerabilities_found": 3,
     "details": [
       {
         "title": "Reentrancy in withdraw()",
         "severity": "High",
         "category": "Reentrancy",
         "location": "withdraw",
         "description": "The withdraw function sends ETH before updating the balance...",
         "poc_sketch": "Deploy attacker contract with fallback that re-enters withdraw()...",
         "remediation": "Apply the checks-effects-interactions pattern. Update balances before the external call."
       }
     ],
     "analyzedAt": "2026-06-14T12:00:00.000Z"
   }
   ```

### Payment verification

The server verifies the tx on-chain before running any analysis:
- `to` must equal `PAYMENT_ADDRESS`
- `value` must be ≥ 2 MNT
- Each `txHash` can only be used once (replay protection via database)

### Using from an autonomous agent

The endpoint is intentionally machine-friendly. An agent can fund itself with MNT, send the payment, and call this endpoint to receive structured vulnerability data — no browser, no wallet UI, no human in the loop.

---

## Re-triggering Analysis

If a bounty was processed before Claude credits were topped up, or you want to re-analyze a contract:

```bash
curl -X POST http://localhost:3001/analysis/trigger \
  -H "Content-Type: application/json" \
  -d '{"targetContract": "0xYourContractAddress"}'
```

The server will re-fetch the contract, run the full analysis, and submit any findings found.

---

## Deployment (Render + Vercel)

See `render.yaml` for the full Render service configuration. Two services are defined:

- **ares-analyzer** — Docker (Standard plan, 10 GB persistent disk for ChromaDB)
- **ares-server** — Docker (Starter plan)

The analyzer's `entrypoint.sh` handles first-boot ingest automatically:
1. If `DISABLE_RAG=true` — starts server immediately, no ingest
2. If ChromaDB already exists — starts server immediately
3. If ChromaDB is empty — runs `ingest_all` in background, starts server immediately so health checks pass

For the client, push to `main` and Vercel deploys automatically via `client/vercel.json`.

---

*Ares demonstrates that autonomous, permissionless, crypto-economically aligned security is not a future concept — it is running on Mantle Sepolia right now.*
