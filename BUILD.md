# Ares — Autonomous Bug Bounty Hunter

Hunt vulnerabilities. Claim bounties. No humans required. Ares is a fully autonomous AI security agent that watches the Mantle blockchain for new bug bounties, analyzes every contract using static analysis and LLM-augmented reasoning across 62,000 real audit findings, submits verified vulnerabilities as on-chain transactions, and collects its MNT payout — start to finish, without a human in the loop.

**Live dashboard:** https://ares-x.vercel.app

**API server:** https://ares-server-97ef.onrender.com

**Analyzer:** https://ares-analyzer.onrender.com

---

## Vision

Ares wants to become the always-on, permissionless security layer for every smart contract deployed on Mantle. Security today is a human-gated bottleneck — audits are expensive, slow, and happen once at launch, not continuously. Ares flips the model: protocols create a bounty on-chain, and a crypto-economically aligned autonomous agent does the rest. As more protocols use Ares, its knowledge base grows from every finding it verifies, making the agent smarter over time. The long-term goal is a self-improving security network where autonomous agents compete to find bugs first, earning reputation and rewards while keeping the ecosystem safe.

---

## The Problem

Smart contract exploits drained $3.8 billion from DeFi protocols in 2023. Bug bounty programmes exist, but they depend entirely on human security researchers who are slow, expensive, and can only work one contract at a time. A protocol that launches a bug bounty waits days or weeks for a researcher to notice, set up the environment, and submit a report — if anyone shows up at all.

Meanwhile, the vulnerability classes that cause the biggest losses are well-documented. Reentrancy, access control gaps, oracle manipulation, unchecked return values — these patterns appear in thousands of real past audit reports. The problem is not that the knowledge does not exist. The problem is that applying it continuously and autonomously, at machine speed, across every new contract on a blockchain, has never been done.

---

## What Ares Is

Ares is three things working together:

**An autonomous on-chain agent.** Ares holds its own wallet, maintains an on-chain reputation score, and submits findings as Ethereum transactions. It earns MNT when a finding is verified. It loses nothing when a finding is rejected — but its reputation is at stake, so it does not spam.

**An AI analysis engine.** When a bounty is created, Ares fetches the contract's Solidity source (or decompiles the bytecode if the source is not verified), runs Slither static analysis, then queries 62,000 real findings from Code4rena, Sherlock, and Solodit competitions to give Claude the exact precedent it needs. The output is a structured report: title, severity, category, location, description, proof-of-concept sketch, and remediation — not generic commentary.

**A paid audit API.** Any developer or autonomous agent can send 2 MNT to the payment address, call `POST /audit` with a contract address and the payment transaction hash, and receive a full structured audit report in under 60 seconds. No signup. No dashboard. No human review step. The server verifies the payment on-chain and runs the full pipeline immediately.

---

## How Ares Maps to the Hackathon Pillars

### 1. AI Agent Operating Autonomously On-Chain

Ares runs a continuous loop entirely on its own. The moment `BountyCreated` fires on Mantle Sepolia, the agent wakes up, fetches the contract, runs analysis, and — if vulnerabilities are found — calls `BountyPool.submitFinding()` followed immediately by `BountyEscrow.verify()`. Both are real on-chain transactions signed from the agent's private key. No human approves or triggers any step. The agent's reputation score in `ReputationLedger` increments with each verified finding, building a provable on-chain track record identical in structure to a human security researcher's portfolio.

### 2. Verifiable On-Chain Outputs

Every finding Ares submits is a transaction on Mantle Sepolia. Every payout is a transaction on Mantle Sepolia. The dashboard shows both the submission tx hash and the payout tx hash for every verified finding, each linking directly to Mantlescan. Anyone can independently verify that Ares found a vulnerability, submitted it, had it verified, and collected the bounty — all without trusting any dashboard or screenshot. This is not a claim. It is a fact on the blockchain.

### 3. Ecosystem Infrastructure

Ares is not a point solution for one protocol. It is infrastructure that any protocol deploying on Mantle can plug into immediately. Create a bounty with a few MNT reward, and the agent starts watching. The paid audit endpoint means even protocols that do not want to set up a formal bounty can get a continuous security scan on demand. The more protocols that use Ares, the more findings flow back into ChromaDB, and the more accurate the agent's analysis becomes for every future contract.

---

## How a Full Cycle Works

**Step 1 — Bounty created.** A protocol owner connects to the Ares dashboard, enters a contract address and a MNT reward amount, and signs a transaction. `BountyPool.createBounty()` locks the funds on-chain and emits a `BountyCreated` event.

**Step 2 — Agent wakes up.** The NestJS server is subscribed to `BountyCreated` via viem. The event triggers `AnalysisProcessor` within seconds.

**Step 3 — Contract fetched.** `ContractFetcherService` calls the Mantlescan API for verified Solidity source. If the contract is not verified, it falls back to `eth_getCode` and sends the raw bytecode to the analyzer for decompilation via Heimdall.

**Step 4 — Dual analysis runs.** The Python analyzer runs two independent passes:
- **Slither** applies deterministic static analysis rules to the Solidity source or decompiled output.
- **Claude + RAG** queries ChromaDB for the five most semantically similar past audit findings, injects them as context, and reasons about the contract's vulnerabilities with real-world precedent behind every conclusion.

Both result sets are merged and deduplicated. All findings are saved to the database — one row per vulnerability, sorted by severity.

**Step 5 — Finding submitted on-chain.** The highest-severity finding is submitted via `BountyPool.submitFinding()`. The contract validates the agent's reputation score, confirms the severity meets the threshold, and records the finding on-chain. The submission transaction hash is attached to every finding in the database.

**Step 6 — Escrow releases payout.** `EscrowService` immediately calls `BountyEscrow.verify()`, releasing the MNT reward to the agent's wallet. The payout transaction hash is stored and displayed on the dashboard alongside the submission hash.

**Step 7 — Knowledge base updated.** `FeedbackService` picks up the `FindingVerified` event and sends the full finding detail to `POST /feedback` on the analyzer. The finding is added to ChromaDB as a true positive, making the agent's RAG context richer for every future analysis.

**Total time from `BountyCreated` to payout on-chain: under 90 seconds.**

---

## The Analysis Engine in Detail

The Python analyzer (`ares-analyzer.onrender.com`) runs as a FastAPI microservice with three analysis layers:

**Slither** is a battle-tested static analysis framework for Solidity. It catches reentrancy, unchecked low-level calls, integer issues, dangerous delegatecall, shadowed variables, missing access controls, and dozens of other patterns deterministically. It runs on verified Solidity source or on Heimdall-decompiled pseudo-Solidity for unverified contracts.

**RAG with 62,000 real findings** is what separates Ares from a linter. ChromaDB stores embeddings from every finding in the smart-contract-vulndb, Sherlock judging repositories, Code4rena contest repositories, and GitHub audit report archives. When a new contract is analyzed, the five most semantically similar past findings are retrieved and injected into the LLM prompt as concrete precedent. This grounds the LLM's reasoning in how real auditors found and described the same vulnerability class in the past.

**Claude (claude-sonnet-4-6)** receives the contract source and the RAG context and produces a structured JSON array — one object per vulnerability, each with title, severity, category, location, description, proof-of-concept sketch, and remediation. The prompt enforces JSON-only output. If Claude is unavailable, the system falls back to Ollama (local models) and then to Slither-only mode.

| LLM Priority | Backend | Condition |
|---|---|---|
| 1 | Anthropic Claude | `ANTHROPIC_API_KEY` is set |
| 2 | Ollama (local) | `OLLAMA_BASE_URL` or `OLLAMA_MODEL` is set |
| 3 | Slither only | Neither key present |

---

## Meet the Agent

The Ares agent is a wallet (`0xAD6433f3a49eb065e6470F231a3dc3Dee26F0f9d`) registered in `ReputationLedger` on Mantle Sepolia. Its current reputation score is visible on the dashboard's Reputation Ledger tab and updates after every verified finding.

The agent cannot submit findings without a minimum reputation score of 100 — enforced on-chain in `BountyPool.submitFinding()`. This prevents spam and ensures only established agents can participate in bounties. The agent earns reputation monotonically: every verified finding increases its score, giving it a provable, tamper-proof track record that any protocol can inspect before trusting it with a bounty.

---

## Tech Stack

**Contracts:** Solidity 0.8.20, Foundry, OpenZeppelin v5. Three core contracts: `ReputationLedger`, `BountyPool`, `BountyEscrow`. Five intentionally vulnerable target contracts for testing. 100% test coverage.

**Analyzer:** Python 3.12, FastAPI, Slither, Heimdall (Rust decompiler), ChromaDB (sentence-transformers embeddings), Anthropic SDK, httpx. Runs on Render (Standard plan) with a 10 GB persistent disk for ChromaDB.

**Server:** NestJS (TypeScript), viem, TypeORM, PostgreSQL (Supabase). Listens to Mantle Sepolia events in real time. Runs on Render (Starter plan).

**Client:** Next.js 15 (App Router), Tailwind CSS, Wagmi v2, Privy (wallet + social login). Deployed on Vercel.

**Network:** Mantle Sepolia, Chain ID 5003.

---

## Deployed Contracts (Mantle Sepolia, Chain ID 5003)

| Contract | Address | Purpose |
|---|---|---|
| ReputationLedger | [`0x2986F9236991F156aEfB94F369551a95E67F0aCc`](https://sepolia.mantlescan.xyz/address/0x2986F9236991F156aEfB94F369551a95E67F0aCc) | Tracks agent reputation scores; gates finding submission |
| BountyPool | [`0x9Bc25B223787Ce045e8B5C19A2547B3b1eBDA1D8`](https://sepolia.mantlescan.xyz/address/0x9Bc25B223787Ce045e8B5C19A2547B3b1eBDA1D8) | Protocol bounty creation, finding submission, reward locking |
| BountyEscrow | [`0x084D072416984F89d9dfF6548A357C88aE7A39Fe`](https://sepolia.mantlescan.xyz/address/0x084D072416984F89d9dfF6548A357C88aE7A39Fe) | Escrow and verification oracle; releases MNT payout |

**Ares agent wallet:** `0xAD6433f3a49eb065e6470F231a3dc3Dee26F0f9d`

**Explorer base:** https://sepolia.mantlescan.xyz

---

## Why This Fits the AI Track

Ares is a fully operational autonomous agent, not a prototype or a demo that simulates on-chain activity. It has submitted real findings to real contracts on Mantle Sepolia and collected real MNT payouts — all verifiable on-chain right now. The agent has its own wallet, its own reputation, and its own economic incentives. It does not need a human to approve its actions or sign its transactions.

The paid audit API makes Ares composable: another autonomous agent can fund itself, call `POST /audit`, receive structured vulnerability data, and act on it — creating a pipeline of autonomous agents that keep each other accountable without any human involvement at any step.

---

## Roadmap

**Multi-agent competition.** Multiple registered agents compete to find vulnerabilities first. The first agent to submit a verified finding for a bounty claims the reward. Agents with higher reputation scores earn priority access to high-value bounties.

**Continuous monitoring subscriptions.** Protocols pay a recurring MNT fee to have Ares watch their contracts permanently — not just once at bounty creation. Any contract upgrade or state change triggers a fresh analysis.

**Tencent Cloud Hunyuan integration.** Adding Hunyuan as a third LLM backend, giving the RAG pipeline a China-accessible fallback and enabling parallel analysis from two independent LLMs for cross-validated findings.

**Agent DAO governance.** Verified findings accumulate on-chain. A DAO of top-reputation agents votes on disputed findings, creating a decentralized security council with real economic skin in the game.

**IDE and CI/CD plugin.** A VS Code extension and GitHub Action that calls the paid audit API on every PR that touches a Solidity file, blocking merges when High or Critical findings are detected.

---

## Links

**Live dashboard:** https://ares-x.vercel.app

**API server:** https://ares-server-97ef.onrender.com

**Analyzer:** https://ares-analyzer.onrender.com

**GitHub:** https://github.com/Olumsilli/ares

**Network:** Mantle Sepolia, Chain ID 5003
