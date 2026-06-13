# ============================================================
# Analyzer image
# Working directory is /workspace so that "python -m analyzer.main"
# resolves to /workspace/analyzer/main.py — matching the import structure.
# ============================================================
FROM python:3.12-slim

# --- System dependencies ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    libssl-dev \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# --- Heimdall decompiler ---
ARG HEIMDALL_VERSION=v0.8.4
RUN curl -fsSL \
    "https://github.com/Jon-Becker/heimdall-rs/releases/download/${HEIMDALL_VERSION}/heimdall-linux-amd64" \
    -o /usr/local/bin/heimdall \
    && chmod +x /usr/local/bin/heimdall \
    || echo "Heimdall download failed — falling back to basic disassembly"

# --- solc ---
RUN pip install --no-cache-dir solc-select \
    && solc-select install 0.8.20 \
    && solc-select use 0.8.20 \
    && solc --version

# --- Python dependencies ---
WORKDIR /workspace
COPY requirements.txt ./analyzer/
RUN pip install --no-cache-dir -r analyzer/requirements.txt

# --- Application code ---
# Copy into /workspace/analyzer/ so imports like "from analyzer.rag.x" work
COPY . ./analyzer/
RUN chmod +x analyzer/entrypoint.sh

# --- Persistent volumes ---
VOLUME ["/workspace/analyzer/rag/chroma_db", "/workspace/analyzer/rag/training_data"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD curl -f http://localhost:${PORT:-8000}/ || exit 1

ENV INGEST_SINCE=2021-01-01
ENV INGEST_MAX_REPOS=200

CMD ["./analyzer/entrypoint.sh"]
