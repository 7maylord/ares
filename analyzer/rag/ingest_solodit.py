"""
Solodit Audit Report Ingestion Script

Scrapes structured audit findings from Solodit and stores them
in a local ChromaDB vector database for RAG-powered vulnerability detection.

Usage:
    python -m analyzer.rag.ingest_solodit
"""

import json
import os
import httpx
import chromadb
from chromadb.utils import embedding_functions

# Directory to cache raw scraped data
CACHE_DIR = os.path.join(os.path.dirname(__file__), ".cache")
DB_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")

# Sample curated audit findings (in production, scrape from Solodit API / HTML)
# Each entry mirrors the structure of a real Solodit finding.
SEED_FINDINGS = [
    {
        "id": "reentrancy-eth-transfer",
        "title": "Reentrancy via ETH transfer in withdraw()",
        "severity": "High",
        "category": "Reentrancy",
        "vulnerable_code": """
function withdraw() external {
    uint256 amount = balances[msg.sender];
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success);
    balances[msg.sender] = 0;
}""",
        "description": "The contract sends ETH before updating state. An attacker can re-enter withdraw() and drain the contract because balances[msg.sender] is only zeroed after the external call.",
        "remediation": "Follow the Checks-Effects-Interactions pattern: zero the balance before making the external call, or use a ReentrancyGuard.",
    },
    {
        "id": "price-oracle-manipulation",
        "title": "Price oracle manipulation via flash loan",
        "severity": "Critical",
        "category": "Oracle Manipulation",
        "vulnerable_code": """
function getPrice() public view returns (uint256) {
    return reserve0 / reserve1;
}""",
        "description": "The protocol uses a spot AMM reserve ratio as a price oracle. An attacker can manipulate this in a single transaction with a flash loan, borrow at an inflated/deflated price, and extract value.",
        "remediation": "Use a time-weighted average price (TWAP) oracle or Chainlink price feeds instead of spot reserves.",
    },
    {
        "id": "unchecked-return-value",
        "title": "Unchecked ERC20 transfer return value",
        "severity": "Medium",
        "category": "Unchecked Return Value",
        "vulnerable_code": """
function distribute(address token, address to, uint256 amount) internal {
    IERC20(token).transfer(to, amount);
}""",
        "description": "Some ERC20 tokens (e.g., USDT) do not revert on failure but return false. The contract ignores the return value, so a failed transfer is silently accepted, leading to accounting mismatches.",
        "remediation": "Use OpenZeppelin's SafeERC20.safeTransfer() which reverts on failure.",
    },
    {
        "id": "access-control-missing",
        "title": "Missing access control on critical function",
        "severity": "Critical",
        "category": "Access Control",
        "vulnerable_code": """
function setAdmin(address _newAdmin) external {
    admin = _newAdmin;
}""",
        "description": "The setAdmin function has no access control modifier. Any external account can call it and take over the contract by setting themselves as admin.",
        "remediation": "Add an `onlyOwner` or `onlyAdmin` modifier to restrict who can call administrative functions.",
    },
    {
        "id": "front-running-approval",
        "title": "Front-running ERC20 approve() race condition",
        "severity": "Medium",
        "category": "Front-Running",
        "vulnerable_code": """
function approve(address spender, uint256 amount) public returns (bool) {
    allowance[msg.sender][spender] = amount;
    return true;
}""",
        "description": "When a user changes an allowance from N to M, a spender can front-run the transaction: spend N tokens, then after the new approval, spend M more — extracting N+M total instead of the intended M.",
        "remediation": "Use increaseAllowance/decreaseAllowance pattern, or require setting allowance to 0 before changing to a non-zero value.",
    },
    {
        "id": "delegatecall-to-untrusted",
        "title": "Delegatecall to user-controlled address",
        "severity": "Critical",
        "category": "Delegatecall",
        "vulnerable_code": """
function execute(address target, bytes calldata data) external {
    (bool success, ) = target.delegatecall(data);
    require(success);
}""",
        "description": "The contract performs a delegatecall to an attacker-controlled address. Since delegatecall executes in the context of the calling contract, the attacker can overwrite storage, drain funds, or selfdestruct the contract.",
        "remediation": "Never delegatecall to user-supplied addresses. If a proxy pattern is needed, restrict the implementation address to admin-only updates.",
    },
    {
        "id": "integer-overflow-multiplication",
        "title": "Integer overflow in reward calculation",
        "severity": "High",
        "category": "Integer Overflow",
        "vulnerable_code": """
function calculateReward(uint256 amount, uint256 multiplier) public pure returns (uint256) {
    return amount * multiplier;  // pre-0.8.0 Solidity
}""",
        "description": "In Solidity versions < 0.8.0, arithmetic operations do not check for overflow. If amount * multiplier exceeds uint256 max, it wraps around to a small number, allowing an attacker to claim disproportionate rewards.",
        "remediation": "Upgrade to Solidity ≥0.8.0 (which has built-in overflow checks) or use OpenZeppelin's SafeMath library.",
    },
    {
        "id": "storage-collision-proxy",
        "title": "Storage collision in upgradeable proxy",
        "severity": "Critical",
        "category": "Proxy / Storage",
        "vulnerable_code": """
contract ProxyV1 {
    address public implementation; // slot 0
    address public admin;         // slot 1
}
contract LogicV2 {
    uint256 public totalSupply;   // slot 0 — collides with implementation!
    mapping(address => uint256) public balances;
}""",
        "description": "The proxy and implementation contract share storage. When the implementation writes to slot 0 (totalSupply), it overwrites the proxy's implementation address, bricking the proxy or allowing hijack.",
        "remediation": "Use EIP-1967 storage slots (random, non-colliding slots) for proxy admin/implementation storage. Use OpenZeppelin's TransparentProxy or UUPS pattern.",
    },
]


def get_chroma_client():
    """Initialize a persistent ChromaDB client."""
    os.makedirs(DB_DIR, exist_ok=True)
    return chromadb.PersistentClient(path=DB_DIR)


def ingest_seed_findings():
    """Ingest seed findings into ChromaDB."""
    client = get_chroma_client()

    # Use default embedding function (all-MiniLM-L6-v2)
    ef = embedding_functions.DefaultEmbeddingFunction()

    collection = client.get_or_create_collection(
        name="audit_findings",
        embedding_function=ef,
        metadata={"description": "Smart contract audit findings from Solodit and curated sources"},
    )

    documents = []
    metadatas = []
    ids = []

    for finding in SEED_FINDINGS:
        # Combine all text into a single searchable document
        doc = f"""## {finding['title']}
**Severity:** {finding['severity']}
**Category:** {finding['category']}

### Vulnerable Code
```solidity
{finding['vulnerable_code'].strip()}
```

### Description
{finding['description']}

### Remediation
{finding['remediation']}"""

        documents.append(doc)
        metadatas.append({
            "severity": finding["severity"],
            "category": finding["category"],
            "title": finding["title"],
        })
        ids.append(finding["id"])

    # Upsert to avoid duplicates on re-run
    collection.upsert(documents=documents, metadatas=metadatas, ids=ids)
    print(f"✅ Ingested {len(documents)} findings into ChromaDB at {DB_DIR}")
    return collection


def ingest_all() -> None:
    """
    Orchestrator: run all ingestion sources in sequence.

    Order:
      1. Seed findings (fast, always available)
      2. tintinweb/smart-contract-vulndb (machine-readable JSON)
      3. GitHub audit repos (Markdown + PDF)
      4. Solodit API (live, rate-limited)
    """
    import logging
    from pathlib import Path

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

    from chromadb.utils import embedding_functions
    from analyzer.rag import ingest_vulndb, ingest_github_reports, ingest_solodit_api

    db_path = Path(DB_DIR)
    db_path.mkdir(parents=True, exist_ok=True)
    client = get_chroma_client()
    ef = embedding_functions.DefaultEmbeddingFunction()
    collection = client.get_or_create_collection(
        name="audit_findings",
        embedding_function=ef,
        metadata={"description": "Smart contract audit findings from all sources"},
    )

    logger.info("=== Step 1: Seed findings ===")
    ingest_seed_findings()

    logger.info("=== Step 2: tintinweb/smart-contract-vulndb ===")
    try:
        count = ingest_vulndb.ingest(collection)
        logger.info(f"vulndb: {count} findings")
    except Exception as e:
        logger.error(f"vulndb ingestion failed: {e}")

    logger.info("=== Step 3: GitHub audit repos ===")
    try:
        count = ingest_github_reports.ingest(collection)
        logger.info(f"github reports: {count} findings")
    except Exception as e:
        logger.error(f"GitHub ingestion failed: {e}")

    logger.info("=== Step 4: Solodit API ===")
    try:
        count = ingest_solodit_api.ingest(collection)
        logger.info(f"solodit api: {count} findings")
    except Exception as e:
        logger.error(f"Solodit API ingestion failed: {e}")

    final_count = collection.count()
    logger.info(f"✅ Ingestion complete — total documents in ChromaDB: {final_count}")


if __name__ == "__main__":
    import sys
    if "--all" in sys.argv:
        ingest_all()
    else:
        ingest_seed_findings()
