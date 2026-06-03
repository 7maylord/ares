# ============================================================
# Analyzer image — single stage (no Rust compilation).
# Heimdall is downloaded as a pre-built binary from GitHub Releases,
# which takes seconds instead of the 10-20 min cargo build would need.
# If the download fails the decompiler falls back to basic disassembly.
# ============================================================
FROM python:3.12-slim

# --- System dependencies ---
# git: GitPython needs it for cloning audit repos
# curl: Heimdall download + healthcheck
# libssl-dev, libffi-dev: needed by some Python crypto wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    libssl-dev \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# --- Heimdall pre-built binary (linux/amd64) ---
# Releases: https://github.com/Jon-Becker/heimdall-rs/releases
# Update the version tag here when a new release ships.
ARG HEIMDALL_VERSION=v0.8.4
RUN curl -fsSL \
    "https://github.com/Jon-Becker/heimdall-rs/releases/download/${HEIMDALL_VERSION}/heimdall-linux-amd64" \
    -o /usr/local/bin/heimdall \
    && chmod +x /usr/local/bin/heimdall \
    || echo "Heimdall download failed — falling back to basic disassembly"

# --- solc (Solidity compiler — required by Slither) ---
# solc-select downloads versioned solc binaries and symlinks the active one
# into ~/.solc-select/artifacts/, then into PATH via a shim.
RUN pip install --no-cache-dir solc-select \
    && solc-select install 0.8.20 \
    && solc-select use 0.8.20

# Verify solc is on PATH
RUN solc --version

# --- Python application ---
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# --- ChromaDB and training data live in volumes (persisted across restarts) ---
VOLUME ["/app/analyzer/rag/chroma_db", "/app/analyzer/rag/training_data"]

# --- One-time RAG seeding ---
# Run this manually after first deploy:
#   docker compose exec analyzer python -m analyzer.rag.ingest_solodit --all

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -f http://localhost:8000/ || exit 1

CMD ["uvicorn", "analyzer.main:app", "--host", "0.0.0.0", "--port", "8000"]
