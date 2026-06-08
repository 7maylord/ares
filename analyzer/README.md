# Ares Analyzer

Python microservice that performs smart contract security analysis. Exposes a FastAPI HTTP API consumed by the NestJS gateway.

## Stack

- **FastAPI** — HTTP server
- **Slither** — static analysis on Solidity source
- **LLM RAG** — Claude (Anthropic) + ChromaDB vector store seeded with past audit findings (Solodit, Code4rena, Sherlock)
- **Heimdall** — bytecode decompiler (fallback when no verified source is available)
- **solc-select** — manages multiple Solidity compiler versions for Slither

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `POST` | `/analyze` | Analyze a contract |
| `POST` | `/feedback` | Submit finding feedback (used by gateway) |

### `POST /analyze`

```json
{
  "contract_address": "0xABC...",
  "source_code": "// Solidity source (optional)",
  "bytecode": "0x608060..."
}
```

At least one of `source_code` or `bytecode` must be provided. If only bytecode is given, Heimdall decompiles it first.

**Response:**
```json
{
  "status": "success",
  "vulnerabilities_found": 2,
  "source_type": "verified_source | decompiled | bytecode_only",
  "details": [
    {
      "source": "slither | llm_rag",
      "title": "Reentrancy vulnerability",
      "severity": "High",
      "category": "Reentrancy",
      "location": "withdraw()",
      "description": "...",
      "poc_sketch": "...",
      "remediation": "..."
    }
  ]
}
```

## Local development

```bash
cd analyzer
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Install and activate a solc version
solc-select install 0.8.20 && solc-select use 0.8.20

# Set env vars
export ANTHROPIC_API_KEY=sk-ant-...

uvicorn analyzer.main:app --reload --port 8000
```

The server starts at `http://localhost:8000`. LLM RAG analysis is disabled if `ANTHROPIC_API_KEY` is unset — Slither still runs.

## Docker

```bash
docker build -t ares-analyzer .
docker run -p 8000:8000 -e ANTHROPIC_API_KEY=sk-ant-... ares-analyzer
```

Or via the root `docker-compose.yml`:

```bash
docker compose up analyzer
```

## RAG knowledge base

The vector store lives in `rag/chroma_db/`. It is **not** seeded automatically. After the first deploy:

```bash
# Ingest Solodit findings
docker compose exec analyzer python -m analyzer.rag.ingest_solodit --all

# Or ingest from local vulnerability DB
docker compose exec analyzer python -m analyzer.rag.ingest_vulndb
```

Without seeding, the LLM still runs but has no retrieval context — findings quality degrades.

## Tests

```bash
pytest tests/
```

Tests cover the analyze endpoint, decompiler, feedback route, and PoC validator.
