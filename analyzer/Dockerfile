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

# --- Heimdall decompiler (prebuilt binary) ---
# Fail loud (curl -f, no `|| echo`): if the decompiler can't install, break the
# build rather than silently shipping a scanner that can't read unverified
# bytecode. The old URL used tag "v0.8.4" — heimdall release tags have NO "v"
# prefix, so it 404'd and the swallowed error shipped images with no decompiler,
# making every unverified contract look "secure".
ARG HEIMDALL_VERSION=0.9.3
RUN ARCH="$(dpkg --print-architecture)" \
    && case "$ARCH" in amd64) HARCH=amd64 ;; arm64) HARCH=arm64 ;; *) echo "unsupported arch: $ARCH" && exit 1 ;; esac \
    && curl -fsSL "https://github.com/Jon-Becker/heimdall-rs/releases/download/${HEIMDALL_VERSION}/heimdall-linux-${HARCH}" \
       -o /usr/local/bin/heimdall \
    && chmod +x /usr/local/bin/heimdall \
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
