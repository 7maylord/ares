# Ares Analyzer

Python microservice that performs smart contract security analysis. Exposes a FastAPI HTTP API consumed by the NestJS gateway.

## Stack

- **FastAPI** — HTTP server
- **Slither** — static analysis on Solidity source
- **LLM RAG** — Claude (Anthropic) + ChromaDB vector store seeded with past audit findings (Solodit, Code4rena, Sherlock)
- **Heimdall** — bytecode decompiler (fallback when no verified source is available)
- **solc-select** — manages multiple Solidity compiler versions for Slither

## LLM backends

Priority order — first available is used:

| Backend | Env var required | Notes |
|---------|-----------------|-------|
| Anthropic Claude | `ANTHROPIC_API_KEY` | Best quality, paid API |
| Ollama (local) | `OLLAMA_BASE_URL` + `OLLAMA_MODEL` | Free, runs on your machine |
| None | — | Slither still runs; LLM findings disabled |

If Claude fails mid-request, Ollama is tried automatically as a fallback.

**Ollama quick start:**
```bash
# Install: https://ollama.com
ollama pull llama3:8b       # or codellama:13b, mistral, deepseek-coder, etc.
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=llama3:8b
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check + LLM backend info |
| `POST` | `/analyze` | Analyze a contract |
| `POST` | `/feedback` | Submit finding feedback (used by gateway) |
| `POST` | `/ingest` | Trigger knowledge base population (background) |
| `GET` | `/ingest/status` | Check ChromaDB document count |

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

The vector store lives in `rag/chroma_db/`. It is not committed to git and must be seeded after cloning.

### Storage

| Directory | Size | Keep in production? |
|-----------|------|-------------------|
| `rag/chroma_db/` | ~1.2 GB | Yes — this is the vector DB |
| `rag/.cache/` | ~7 GB | No — delete after ingest to reclaim space |
| `rag/training_data/` | ~50 MB | Optional — only needed for fine-tuning |

Production storage requirement: **~1.2 GB** for ChromaDB only.

### Sources

| Script | Source | What it ingests |
|--------|--------|----------------|
| `ingest_vulndb.py` | tintinweb/smart-contract-vulndb | ~38k findings (JSONL audit reports) |
| `ingest_solodit_api.py` | solodit.cyfrin.io | Critical/High/Medium findings via REST API |
| `ingest_code4rena.py` | code-423n4 GitHub org | Individual finding `.md` files per contest |
| `ingest_sherlock.py` | sherlock-audit GitHub org | Judging repo findings (markdown + CSV) |
| `ingest_github_reports.py` | pashov, NethermindEth, etc. | Mixed MD/PDF audit repos (~4.5k findings) |

A full run produces ~62,000+ findings in ChromaDB.

### First-time setup (after cloning)

```bash
cd /path/to/ares
source analyzer/venv/bin/activate

# Optional but recommended — raises GitHub API limit from 60 to 5000 req/hr
export GITHUB_TOKEN=ghp_...

python -m analyzer.rag.ingest_all --since 2021-01-01 --max-repos 200
```

Takes 1–2 hours. Once complete, delete the clone cache to free ~7 GB:

```bash
rm -rf analyzer/rag/.cache/
```

### Re-run or update

```bash
# Add new findings from recent contests (fast — skips already-ingested docs)
python -m analyzer.rag.ingest_all --since 2025-01-01 --max-repos 50

# Or trigger via HTTP while the server is running:
curl -X POST http://localhost:8000/ingest \
  -H "Content-Type: application/json" \
  -d '{"since": "2025-01-01", "max_repos": 50}'

# Check document count:
curl http://localhost:8000/ingest/status
```

## Tests

```bash
pytest tests/
```

Tests cover the analyze endpoint, decompiler, feedback route, and PoC validator.
