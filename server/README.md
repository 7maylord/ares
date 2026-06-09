# Ares Server (NestJS)

The backend gateway API that orchestrates the full autonomous bug bounty pipeline.

## Responsibilities

- **BlockchainService** — polls for `BountyCreated` events and enqueues analysis jobs
- **ContractFetcherService** — fetches verified Solidity source from Mantlescan; falls back to raw bytecode via RPC
- **AnalyzerService** — proxies contract code to the Python analyzer microservice
- **SubmitterService** — submits findings on-chain via `BountyPool.submitFinding()`
- **FeedbackService** — listens for `FindingVerified` / `FindingRejected` events, sends feedback to the analyzer for continuous learning
- **AuditService** — payment-gated audit endpoint for direct developer/agent use

## API Endpoints

### Autonomous pipeline

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/analysis/trigger` | Manually trigger analysis for a contract address |
| `GET` | `/bounties` | List all tracked bounties |
| `GET` | `/findings` | List all submitted findings |
| `GET` | `/events` | Recent system event log |

### Paid audit

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/audit` | Payment-gated security audit — requires prior MNT payment on Mantle Sepolia |

#### `POST /audit` request body

```json
{
  "contractAddress": "0xYourContractAddress",
  "txHash": "0xYourPaymentTransactionHash"
}
```

**Payment requirements:**
- Send ≥ **2 MNT** on Mantle Sepolia to `0x2986F9236991F156aEfB94F369551a95E67F0aCc`
- Pass the resulting `txHash` in the request body
- Each `txHash` can only be used once (replay protection)

#### Response

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
      "description": "The withdraw() function sends ETH before updating the balance...",
      "poc_sketch": "Deploy attacker contract, call withdraw() from fallback...",
      "remediation": "Apply checks-effects-interactions pattern or use ReentrancyGuard"
    }
  ],
  "analyzedAt": "2026-06-08T12:00:00.000Z"
}
```

## Setup

```bash
cp .env.sample .env   # fill in all values
pnpm install
pnpm run start:dev    # starts on port 3001
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `MANTLE_SEPOLIA_RPC_URL` | Yes | Mantle Sepolia RPC URL |
| `MANTLESCAN_API_KEY` | No | Mantlescan API key for verified source code |
| `POOL_ADDRESS` | Yes | Deployed `BountyPool` address |
| `ESCROW_ADDRESS` | Yes | Deployed `BountyEscrow` address |
| `AGENT_PRIVATE_KEY` | Yes | Agent wallet private key for on-chain submissions |
| `ANALYZER_SERVICE_URL` | Yes | Python analyzer URL (default: `http://localhost:8000`) |
| `ANTHROPIC_API_KEY` | No | Anthropic API key (used by the Python analyzer — falls back to Ollama if unset) |
| `PAYMENT_ADDRESS` | No | Address that receives MNT for `/audit` (default: `0x2986F9236991F156aEfB94F369551a95E67F0aCc`) |

## Running Tests

```bash
pnpm run test          # unit tests
pnpm run test:e2e      # e2e tests
pnpm run test:cov      # coverage report
```
