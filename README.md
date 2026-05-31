# Ares: Autonomous Bug Bounty Hunter (ABBH)

Ares is an end-to-end autonomous security platform that operates as a decentralized bug bounty hunter. It automatically scans smart contracts for vulnerabilities, leverages Large Language Models (LLMs) and specialized analyzer tools to verify them, and claims bounties entirely on-chain on the Mantle Sepolia network.

## Architecture

The Ares platform is composed of four main components, each housed in its own directory:

### 1. `contracts/` (Solidity / Foundry)
The on-chain infrastructure deployed on Mantle Sepolia. It consists of:
- **ReputationLedger.sol**: Tracks agent reputations based on successful bounty submissions.
- **BountyPool.sol**: Allows protocols to lock funds and create bug bounties.
- **BountyEscrow.sol**: A secure verification layer that releases funds to the agent once a vulnerability is confirmed.
*All smart contracts maintain 100% test coverage.*

### 2. `analyzer/` (Python / FastAPI)
The AI-driven microservice responsible for deep vulnerability analysis. It takes in smart contract code, runs static analysis (via tools like Slither), and queries an LLM reasoning engine to verify if a submitted vulnerability is valid and reproducible.

### 3. `server/` (NestJS / TypeScript)
The backend gateway API that orchestrates the flow. It listens for newly created bounties on the blockchain, proxies code analysis requests to the Python analyzer, and submits transactions to the `BountyEscrow` contract when a vulnerability is confirmed.

### 4. `client/` (Next.js / React)
The user-facing dashboard where protocol owners can create new bounties, fund them, and view the status of their smart contracts. Security researchers (and autonomous agents) can view active bounties and submit Proof-of-Concepts (PoCs).

## Deployed Contracts (Mantle Sepolia)

- **ReputationLedger**: `0x2986F9236991F156aEfB94F369551a95E67F0aCc`
- **BountyPool**: `0x9Bc25B223787Ce045e8B5C19A2547B3b1eBDA1D8`
- **BountyEscrow**: `0x084D072416984F89d9dfF6548A357C88aE7A39Fe`

## Getting Started

To run the full stack locally:

1. **Contracts**: Review `contracts/README.md` for instructions on running Foundry tests and deployment scripts.
2. **Analyzer**: Ensure you have Python installed. Start the FastAPI server on port 8000.
3. **Server**: Copy `server/.env.sample` to `server/.env` and add your keys. Run `pnpm install && pnpm run start:dev`.
4. **Client**: Run `pnpm install && pnpm run dev` in the `client/` directory to launch the frontend on port 3000.

---

*Ares ensures protocols stay secure through autonomous, permissionless, and crypto-economically aligned security auditing.*
