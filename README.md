# Ares: Autonomous Bug Bounty Hunter (ABBH)

Ares is an end-to-end autonomous security platform that operates as a decentralized bug bounty hunter. It automatically scans smart contracts for vulnerabilities, leverages Large Language Models (LLMs) and specialized analyzer tools to verify them, and claims bounties entirely on-chain on the Mantle Sepolia network.

## Architecture

```
BountyCreated event
        │
        ▼
ContractFetcherService ──► Mantlescan API (verified Solidity source)
        │                            │
        │                    (fallback if unverified)
        │                            ▼
        │                   eth_getCode (raw bytecode)
        │                            │
        ▼                            ▼
AnalyzerService ◄──────── Heimdall decompiler (pseudo-Solidity)
        │
        ▼
Python Analyzer (/analyze)
  ├── Slither static analysis
  └── Claude RAG (10,000+ findings from ChromaDB)
        │
        ▼
SubmitterService ──► BountyPool.submitFinding() on-chain
        │
        ▼
EscrowService ──► BountyEscrow.verify() on-chain
        │
        ▼
FeedbackService ◄── FindingVerified / FindingRejected events
        │
        ▼
analyzer /feedback ──► ChromaDB (true positives) + training_data.jsonl
```

The Ares platform is composed of four main components, each housed in its own directory:

### 1. `contracts/` (Solidity / Foundry)
The on-chain infrastructure deployed on Mantle Sepolia. It consists of:
- **ReputationLedger.sol**: Tracks agent reputations based on successful bounty submissions.
- **BountyPool.sol**: Allows protocols to lock funds and create bug bounties.
- **BountyEscrow.sol**: A secure verification layer that releases funds to the agent once a vulnerability is confirmed.
*All smart contracts maintain 100% test coverage.*

### 2. `analyzer/` (Python / FastAPI)
The AI-driven microservice responsible for deep vulnerability analysis. It:
- Runs **Slither** static analysis on verified Solidity source.
- Decompiles raw bytecode (via **Heimdall** or opcode disassembly) for unverified contracts.
- Queries **Claude** with RAG context drawn from 10,000+ real audit findings (ChromaDB).
- Exposes a `POST /feedback` endpoint so verified/rejected findings flow back into the knowledge base.

Run the ingestion pipeline once to populate ChromaDB before starting the analyzer:
```bash
cd analyzer
python -m analyzer.rag.ingest_solodit --all   # seeds + vulndb + GitHub repos + Solodit API
```

### 3. `server/` (NestJS / TypeScript)
The backend gateway API that orchestrates the full flow:
- **ContractFetcherService** — fetches verified Solidity source from Mantlescan API, falls back to raw bytecode via RPC for unverified contracts.
- **BlockchainService** — listens for `BountyCreated` and `FindingSubmitted` on-chain events.
- **AnalyzerService** — proxies real contract code to the Python analyzer.
- **SubmitterService** — submits findings on-chain via `BountyPool.submitFinding()`.
- **EscrowService** — auto-verifies findings via `BountyEscrow.verify()` (MVP oracle).
- **FeedbackService** — listens for `FindingVerified` / `FindingRejected` events and sends feedback to the analyzer for continuous learning.

### 4. `client/` (Next.js / React)
The user-facing dashboard where protocol owners can create new bounties, fund them, and view the status of their smart contracts. Security researchers (and autonomous agents) can view active bounties and submit Proof-of-Concepts (PoCs).

## Deployed Contracts (Mantle Sepolia)

- **ReputationLedger**: `0x2986F9236991F156aEfB94F369551a95E67F0aCc`
- **BountyPool**: `0x9Bc25B223787Ce045e8B5C19A2547B3b1eBDA1D8`
- **BountyEscrow**: `0x084D072416984F89d9dfF6548A357C88aE7A39Fe`

## Getting Started

To run the full stack locally:

1. **Contracts**: Review `contracts/README.md` for Foundry test and deployment instructions.
2. **Analyzer**:
   ```bash
   cd analyzer
   python -m venv venv && source venv/bin/activate
   pip install -r requirements.txt
   python -m analyzer.rag.ingest_solodit --all  # populate knowledge base (run once)
   uvicorn analyzer.main:app --port 8000 --reload
   ```
3. **Server**: Copy `server/.env.sample` to `server/.env` and fill in all values (see table below). Then:
   ```bash
   cd server && pnpm install && pnpm run start:dev
   ```
4. **Client**: `cd client && pnpm install && pnpm run dev` — dashboard on port 3000.

### Required Environment Variables (`server/.env`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Supabase recommended) |
| `MANTLE_SEPOLIA_RPC_URL` | Mantle Sepolia RPC endpoint |
| `MANTLESCAN_API_KEY` | Mantlescan API key — enables verified source fetching |
| `POOL_ADDRESS` | Deployed `BountyPool` contract address |
| `ESCROW_ADDRESS` | Deployed `BountyEscrow` contract address |
| `AGENT_PRIVATE_KEY` | Private key for the agent wallet (never use your main wallet) |
| `ANALYZER_SERVICE_URL` | URL of the Python analyzer (default: `http://localhost:8000`) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude LLM analysis |
| `PAYMENT_ADDRESS` | Address that receives MNT for the paid `/audit` endpoint (default: `0x2986F9236991F156aEfB94F369551a95E67F0aCc`) |

---

## Paid Audit API (`POST /audit`)

Any developer or AI agent can request a one-shot security audit without creating a bounty by calling the paid audit endpoint directly.

### How it works

1. Send **≥ 2 MNT** on Mantle Sepolia to the payment address:
   ```
   0x2986F9236991F156aEfB94F369551a95E67F0aCc
   ```
2. Call `POST /audit` with the contract address and your transaction hash:
   ```bash
   curl -X POST http://localhost:3001/audit \
     -H "Content-Type: application/json" \
     -d '{
       "contractAddress": "0xYourContractAddress",
       "txHash": "0xYourPaymentTxHash"
     }'
   ```
3. Receive a full JSON audit report:
   ```json
   {
     "contractAddress": "0x...",
     "isVerified": true,
     "contractName": "MyToken",
     "vulnerabilities_found": 2,
     "details": [
       {
         "title": "Reentrancy in withdraw()",
         "severity": "High",
         "category": "Reentrancy",
         "location": "withdraw",
         "description": "...",
         "poc_sketch": "...",
         "remediation": "..."
       }
     ],
     "analyzedAt": "2026-06-08T12:00:00.000Z"
   }
   ```

### Payment verification

The server verifies the payment transaction on-chain before running the audit:
- Transaction must exist on Mantle Sepolia
- `to` must equal `PAYMENT_ADDRESS`
- `value` must be ≥ 2 MNT
- Each transaction hash can only be used once (replay protection)

### AI agent usage

This endpoint is designed for autonomous agents. An agent can fund itself with MNT, send the payment transaction, and call the endpoint to get structured vulnerability data — fully on-chain, no human required.

---

*Ares ensures protocols stay secure through autonomous, permissionless, and crypto-economically aligned security auditing.*
