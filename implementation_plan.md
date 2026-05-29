# Ares Implementation Plan

This document tracks our progress towards production for Ares (Autonomous Bug Bounty Hunter), based on the PRD and the hybrid architecture decision.

## User Review Required

Please review the proposed breakdown of remaining work. Specifically:
> [!IMPORTANT]
> - Do you have a preference on which sub-system to tackle next (the **NestJS Orchestrator** or the **Python Analyzer Microservice**)? 
> - Are there specific vulnerability classes you want the Python Analyzer to focus on first (e.g., Reentrancy via Slither)?
> - Should we deploy the Smart Contracts to the Mantle Testnet right now, or wait until the Orchestrator is ready?

## Completed Work 

- [x] **PRD & Architecture Updated:** Hybrid model (NestJS Orchestrator + Python Analyzer) selected and documented.
- [x] **Smart Contracts Developed & Tested:**
  - `ReputationLedger.sol`
  - `BountyPool.sol`
  - `BountyEscrow.sol`
- [x] **Smart Contract Tests:** 54 out of 54 tests passing (100% success rate on Forge).
- [x] **Code Committed:** Smart contracts and updated PRD pushed to `main`.

## Proposed Changes / Next Phases

---

### Phase 1: Smart Contract Deployment & Tooling
*We have the contracts, but we need deployment scripts and ABI exports for the NestJS client.*
#### [NEW] `contracts/script/DeployAres.s.sol`
- Create a Forge deployment script to deploy the ReputationLedger, BountyPool, and BountyEscrow to the Mantle Testnet.
#### [NEW] `contracts/abi/*`
- Export ABIs to a shared directory for the NestJS application to consume using `viem` or `ethers.js`.

---

### Phase 2: Python Analyzer Microservice (Phase 0 in PRD)
*The core engine that runs security tools against target bytecode/source code.*
#### [NEW] `analyzer/main.py`
- Setup a FastAPI application to receive bytecode/ABI payloads from the NestJS orchestrator.
#### [NEW] `analyzer/analyzers/slither_runner.py`
- Integrate `slither-analyzer` via subprocess to run static analysis on source code.
#### [NEW] `analyzer/analyzers/manticore_runner.py`
- Optional: Basic symbolic execution stub for initial testing.
#### [NEW] `analyzer/poc_validator.py`
- Setup PoC generation templates (e.g., Reentrancy payload generators).

---

### Phase 3: NestJS Orchestrator & Deployment Monitor
*The "brain" of the agent that watches the chain and manages jobs.*
#### [MODIFY] `server/src/app.module.ts`
- Setup Prisma/PostgreSQL or MongoDB to store bounty targets and job statuses.
#### [NEW] `server/src/blockchain/blockchain.service.ts`
- Connect to Mantle RPC. Listen for `ContractDeployed` and `BountyCreated` events.
#### [NEW] `server/src/queue/queue.service.ts`
- Push newly discovered targets to a BullMQ (or similar) queue.
#### [NEW] `server/src/analyzer/analyzer.service.ts`
- Consume queue jobs, fetch bytecode/source from the chain, and make HTTP requests to the Python Analyzer Microservice.
#### [NEW] `server/src/submitter/submitter.service.ts`
- Receive successful PoC payloads from the Python microservice and submit them on-chain via `submitFinding()`.

---

### Phase 4: Escrow Validator & LLM RAG Integration (Advanced)
*Closing the loop and enhancing detection.*
#### [MODIFY] `server/src/submitter/escrow.service.ts`
- For the MVP (since Ares itself acts as an off-chain oracle initially), automatically call `verify()` on the Escrow contract if the PoC works locally.
#### [NEW] `analyzer/analyzers/llm_rag_runner.py`
- Integrate OpenAI/Claude to scan source code for complex logic flaws.
- Implement Retrieval-Augmented Generation (RAG) by scraping and structuring thousands of audit reports from **Solodit**, Code4rena, and Sherlock.
- Store these historical vulnerabilities in a Vector DB (Pinecone/Qdrant) so Ares can retrieve similar past attack vectors to identify zero-day bugs that Slither misses.

---

### Phase 5: Dashboard & Launch
*Admin interface and production deployment.*
#### [NEW] `client/`
- Next.js frontend (Admin Dashboard) for protocol owners to create bounties and view findings.
- Launch preparation (Docs, Demo, Mainnet Deployment).

## Verification Plan

### Automated Tests
- Python: `pytest` for the FastAPI analyzer microservice and tool wrappers.
- NestJS: Jest unit tests for event indexing and transaction submission logic.
- E2E: Deploy the full stack locally, deploy a vulnerable "Vault" contract, and assert that the NestJS app detects it, Python finds the reentrancy, and the agent claims the bounty.

### Manual Verification
- Deploying to Mantle Testnet and manually interacting with a test contract to ensure the live RPC endpoints function correctly with the Orchestrator.
