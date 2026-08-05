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

# --- Heimdall decompiler (installed via bifrost, its official installer) ---
# Fail loud: if the decompiler can't install, break the build rather than
# silently shipping a scanner that can't read unverified bytecode. The old
# direct-asset URL 404'd and the `|| echo` swallowed it, so images shipped with
# no decompiler — every unverified contract then looked "secure".
RUN curl -L http://get.heimdall.rs | bash \
    && /root/.bifrost/bin/bifrost \
    && ln -sf /root/.bifrost/bin/heimdall /usr/local/bin/heimdall \
    && heimdall --version

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

# --- Persistent data dirs ---
# No Dockerfile VOLUME: Railway rejects it. Persist by attaching a Railway Volume
# to each mount path below in the service settings (see notes). mkdir keeps the app
# working when no volume is attached (ChromaDB re-ingests on boot).
RUN mkdir -p /workspace/analyzer/rag/chroma_db /workspace/analyzer/rag/training_data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD curl -f http://localhost:${PORT:-8000}/ || exit 1

ENV INGEST_SINCE=2021-01-01
ENV INGEST_MAX_REPOS=200

CMD ["./analyzer/entrypoint.sh"]
