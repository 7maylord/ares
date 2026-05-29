# Ares (Autonomous Bug Bounty Hunter) – PRD & TRD

## Product Requirements Document (PRD)

### 1. Executive Summary

**Ares** is a fully autonomous AI agent that continuously scans newly deployed smart contracts on Mantle testnet for security vulnerabilities, generates proof-of-concept exploits, and claims bounties — all without human intervention. It turns security auditing into a permissionless, 24/7 competitive market.

**Core Value Proposition:**  
Protocols get continuous, low-cost security coverage. The agent (or a DAO-owned swarm) earns yield by hunting bugs. Mantle’s high throughput and low fees make real-time, on-chain fuzzing economically viable.

### 2. Product Vision

> *“A tireless white-hat hacker that sleeps only when the network does.”*

Ares democratizes security: any protocol can deploy a bounty pool, and any agent can compete to find flaws. Over time, a reputation economy emerges where the most effective agents earn more trust and higher bounties.

### 3. Target Audience

| Persona | Description |
|---------|-------------|
| **Protocol Developers** | Deploy smart contracts and want continuous, automated security monitoring without paying expensive audit firms. |
| **DAO Treasuries** | Allocate bounty budgets to attract autonomous hunters. |
| **Agent Operators** | Individuals or DAOs that stake capital to deploy and maintain Ares agents, sharing in bounty rewards. |
| **Validators / Judges** | Decentralized voters who verify contested exploit submissions (fallback mechanism). |

### 4. Core Features (MVP)

| Feature | Description |
|---------|-------------|
| **Deployment Monitor** | Listens for `ContractDeployed` events on Mantle testnet, filters by whitelist or bounty pool presence. |
| **Multi-Stage Analyzer** | Static analysis (pattern matching), symbolic execution, fuzzing, and LLM reasoning. |
| **Exploit Validator** | Automatically constructs a PoC transaction that demonstrates the vulnerability. |
| **Bounty Escrow Contract** | Holds funds, verifies submissions (via on-chain replay or validator vote), and pays out. |
| **Reputation Ledger** | Tracks each agent’s success rate, accuracy, and speed – used for future prioritization. |
| **Admin Dashboard** | For protocol owners to create bounties, whitelist agents, and view findings. |

### 5. User Flows

#### 5.1 Protocol Creates a Bounty
1. Protocol owner deploys a `BountyPool` contract, depositing funds (SOMI or stablecoin).
2. Owner sets target contract address(es), scope (e.g., “only critical severity”), and reward amounts.
3. Pool emits `BountyCreated` event – agents begin monitoring.

#### 5.2 Agent Scans & Reports
1. Ares agent detects new contract or active bounty.
2. Agent runs analysis pipeline (static → symbolic → fuzzing → LLM).
3. If vulnerability found, agent attempts to generate a PoC transaction.
4. Agent submits `Finding` to the pool: `(contract, vulnerabilityType, PoC_tx_data, confidenceScore)`.

#### 5.3 Verification & Payout
- **Automatic verification (default):** The `BountyEscrow` contract forks the target contract (using Mantle’s `eth_call` with state override) and executes the PoC. If the transaction changes state as expected (e.g., drains funds), verification passes.
- **Manual verification (fallback):** If automatic verification is ambiguous, a random set of 5–9 validator agents (or human jurors) vote within 24 hours.
- Upon verification, reward is transferred to agent’s treasury. Agent’s reputation increases.

### 6. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Time from contract deployment to submission | < 5 minutes (for simple vulns) |
| Gas cost per full scan (static+fuzz+LLM) | < $0.50 (on Mantle testnet) |
| False positive rate (submissions rejected) | < 10% |
| Uptime (agent daemon) | 99.9% |
| Number of contracts monitored simultaneously | > 10,000 |

### 7. Success Metrics (KPIs)

- **Total bounties claimed (weekly)** – target: 10+ after 3 months
- **Average time-to-submission** – target: < 10 minutes
- **Protocols using Ares bounties** – target: 50 after 6 months
- **Agent operator ROI** – target: > 20% annualized

### 8. Roadmap (12 weeks)

| Phase | Duration | Deliverables |
|-------|----------|---------------|
| **Phase 0: Core Analyzers** | Week 1-3 | Static analyzer + symbolic execution engine (off-chain, integrated with Hardhat). |
| **Phase 1: Exploit Validator** | Week 4-5 | PoC generation module, on-chain replay verification contract. |
| **Phase 2: Bounty Escrow** | Week 6-7 | `BountyPool` and `BountyEscrow` contracts, agent submission interface. |
| **Phase 3: LLM Integration** | Week 8-9 | Fine-tuned LLM for logic flaw detection, prompt engineering. |
| **Phase 4: Reputation & Launch** | Week 10-12 | Reputation ledger, dashboard, testnet deployment, demo video, GitHub release. |

---

## Technical Requirements Document (TRD)

### 1. System Architecture Overview

```text
[On-Chain]          [Off-Chain Agent]                                           [Storage]
Mantle L2           Ares Orchestrator (NestJS) <-> Analyzer Service (Python)    IPFS / Arweave
    |                           |                                 |
    v                           v                                 v
ContractDeployed event ---> Deployment Monitor --->         Fetches bytecode
    |                           |
    v                           v
BountyPool.sol <---         Submission Tx <---              Analyzer Pipeline
    |                           |                           (static, symbolic, fuzz, LLM)
    v                           v
BountyEscrow.sol <---       Verification ---                Exploit Validator (PoC generation)
```

**Key Mantle Features Used:**
- **Reactivity** → instant trigger on contract deployment.
- **Low gas fees** → frequent scanning and submission tx cost pennies.
- **Parallel EVM** → run multiple analyzer instances concurrently.
- **`eth_call` with state override** → for safe PoC verification on a forked environment.

### 2. Smart Contracts Design

#### 2.1 BountyPool.sol

```solidity
struct Bounty {
    address targetContract;
    address bountyCreator;
    uint256 rewardAmount;
    uint256 severityThreshold; // 1=low, 2=medium, 3=high
    bool active;
    uint256 deadline;
    address[] whitelistedAgents; // empty = open to all
}

mapping(uint256 => Bounty) public bounties;
mapping(uint256 => mapping(address => bool)) public submissions;

function createBounty(...) external returns (uint256 bountyId);
function submitFinding(uint256 bountyId, bytes calldata pocData, string calldata description) external;
function claimReward(uint256 bountyId) external; // called after verification
```

#### 2.2 BountyEscrow.sol
`verifyAndPay(uint256 bountyId, address agent)`
Uses Mantle’s `eth_call` with a cloned environment to execute `pocData` against the target contract. If the post-state matches the expected invariant violation (e.g., agent balance increased by >0), reward is transferred.

```solidity
function _simulateExploit(address target, bytes calldata poc) internal returns (bool success) {
    // Use Mantle's fork simulation (similar to eth_call but with state changes)
    (bool ok, bytes memory ret) = target.staticcall(poc); // simplified
    // Check if exploit achieved goal (e.g., balance changed)
    return ok && _checkInvariantBroken(target);
}
```

#### 2.3 ReputationLedger.sol
```solidity
mapping(address => uint256) public reputationScore; // 0-1000
mapping(address => uint256) public successfulSubmissions;
mapping(address => uint256) public failedSubmissions;

function updateReputation(address agent, bool success) external onlyRole(JUDGE_ROLE);
```

### 3. Off-Chain Agent Components

#### 3.1 Orchestrator & Deployment Monitor (NestJS + Mantle RPC)
- Subscribes to `newHeads` filters for `ContractDeployed` logs.
- Maintains a set of active bounty targets (from `BountyPool` events).
- Pushes each new target to a job queue.
- Manages database, reputation ledger, and transaction submissions to Mantle.
- Delegates heavy analysis tasks to the Analyzer Microservice.

#### 3.2 Analyzer Microservice (Python)

| Stage | Technology | Description |
| :--- | :--- | :--- |
| **Static Analyzer** | Slither (integrated via JSON-RPC) | Runs ~50 detectors for common bugs (reentrancy, timestamp dependence, etc.). |
| **Symbolic Executor** | Manticore or hevm | Explores all execution paths, identifies assertion violations. |
| **Fuzzing Engine** | Echidna (adapted for Mantle) | Generates random transactions, uses coverage guidance. |
| **LLM Reasoner (RAG)** | GPT-4 API + Solodit Vector DB | Uses Retrieval-Augmented Generation with thousands of past audit reports (Solodit/Code4rena) to spot complex logic flaws beyond static analysis. |

**Integration:**
The pipeline is orchestrated by a control script. Each stage runs in parallel; if any stage flags a potential vulnerability, the result is passed to the Exploit Validator.

#### 3.3 Exploit Validator (PoC Generator)
- Takes a vulnerability type + contract ABI + bytecode.
- Uses a template-based transaction generator (e.g., for reentrancy: `attackContract.call{value: x}(...)`).
- Uses symbolic execution to fill concrete values (e.g., the exact ETH amount that triggers the overflow).
- Outputs a raw transaction data blob that can be submitted to `BountyPool.submitFinding()`.

#### 3.4 LLM RAG Details
- **Base model:** GPT-4o or Claude 3.5 Sonnet.
- **Knowledge Base:** Thousands of audit findings scraped from **Solodit**, Code4rena, and Sherlock.
- **Vector Database:** Pinecone or Qdrant storing structured chunks of (vulnerable_code, vulnerability_type, remediation).
- **Inference Workflow:** When a new contract is analyzed, Ares chunks the source code, queries the Vector DB for similar past vulnerabilities, and feeds these historical examples into the LLM context. This provides Ares with deep "security intuition" to catch zero-day logic flaws that Slither cannot detect.

### 4. Verification Mechanism

**Primary (automatic):**
`BountyEscrow.sol` calls a privileged off-chain oracle (or a Mantle precompile) that runs the PoC in a sandboxed EVM. This can be implemented using Mantle’s `static_call` with state capture – no gas cost for the actual exploit.

**Fallback (decentralized):**
If automatic verification fails (e.g., non-deterministic outcome), a panel of 7 randomly selected reputation-weighted agents votes on the finding. Voting is done via a commit-reveal scheme on Mantle testnet. This ensures liveness and decentralization.

### 5. Mantle-Specific Optimizations

| Challenge | Mantle Solution |
| :--- | :--- |
| **Running fuzzing on-chain is expensive.** | Fuzzing runs off-chain; only the final PoC submission is on-chain. Mantle’s low fees still make this economical for the agent operator. |
| **Need to simulate exploit without affecting real state.** | Mantle’s `eth_call` with state override allows safe replay. |
| **Many contracts to monitor.** | Parallel EVM lets the agent run multiple analyzer instances in separate threads, each scanning different contracts. |
| **Real-time reaction to new contracts.** | Reactivity (event-driven execution) triggers the agent instantly. |

### 6. Security & Risk Mitigation

| Risk | Mitigation |
| :--- | :--- |
| **Agent submits false positives (wasting verifier time).** | Reputation penalty: failed submissions reduce score; agents with low reputation are ignored. |
| **PoC could be malicious (e.g., self-destruct).** | Verification runs in a sandboxed fork with no access to real funds. |
| **Bounty pool drained by fake exploit.** | Verification requires the exploit to actually change state in a way that matches the vulnerability definition. |
| **LLM hallucinates vulnerabilities.** | LLM findings are only accepted if the Exploit Validator can produce a working PoC. |

### 7. Testing Strategy

- **Unit tests:** Hardhat tests for `BountyPool`, `BountyEscrow`, `ReputationLedger`.
- **Integration tests:** Deploy a vulnerable test contract (e.g., reentrant vault), run the full agent pipeline, verify that a bounty is claimed.
- **Performance test:** Simulate 100 new contracts per minute, measure agent throughput and latency.
- **Adversarial test:** Submit contracts with hidden backdoors that only a specific sequence triggers; ensure agent finds them.

### 8. Deployment & Monitoring

- **Testnet:** Mantle Testnet (MNT faucet for gas).
- **Mainnet:** Mantle Mainnet (MNT tokens).
- **Agent deployment:** Docker container running on a cloud VM (or decentralized compute like Akash).
- **Monitoring:** Prometheus metrics (scans per second, findings per hour, false positive rate). Alerts on agent downtime.

### 9. Developer Setup

```bash
git clone https://github.com/your-org/ares-agent
cd ares-agent

# 1. Setup Orchestrator (NestJS)
npm install
npx hardhat compile
cp .env.example .env
npm run start:dev

# 2. Setup Analyzer Microservice (Python)
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

**Environment variables:**
- `MANTLE_RPC_URL`
- `PRIVATE_KEY`
- `OPENAI_API_KEY` (if using GPT-4)
- `IPFS_GATEWAY`

### 10. Appendices

#### A. Vulnerability Classes Initially Supported
- Reentrancy (single & cross-function)
- Arithmetic overflow/underflow
- Access control (missing `onlyOwner`)
- Timestamp dependence
- Front-running (transaction ordering)
- Unchecked low-level calls
- Denial of service (unbounded loop)

#### B. References
- Mantle Docs
- Slither Static Analyzer
- Echidna Fuzzer
- SmartBugs Wild Dataset
