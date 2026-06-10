#!/bin/sh
# Entrypoint for the Ares analyzer container.
# On first boot (empty ChromaDB), runs ingest_all in the background
# then starts the API server immediately so healthchecks pass.
# On subsequent boots, skips ingest and starts the server directly.

DB_DIR="/app/analyzer/rag/chroma_db"
LOCK_FILE="$DB_DIR/.ingest_complete"

start_server() {
  exec uvicorn analyzer.main:app --host 0.0.0.0 --port 8000
}

if [ -f "$LOCK_FILE" ]; then
  echo "[entrypoint] ChromaDB already seeded — skipping ingest"
  start_server
fi

# Check if DB has any documents (chroma writes a sqlite file on first use)
if [ -f "$DB_DIR/chroma.sqlite3" ]; then
  echo "[entrypoint] ChromaDB exists — skipping ingest"
  touch "$LOCK_FILE"
  start_server
fi

echo "[entrypoint] ChromaDB is empty — running ingest_all in background"
echo "[entrypoint] Server will start immediately; ingest progress visible in logs"

# Run ingest in background, touch lock file when done
(
  python -m analyzer.rag.ingest_all \
    --since "${INGEST_SINCE:-2021-01-01}" \
    --max-repos "${INGEST_MAX_REPOS:-200}" \
  && touch "$LOCK_FILE" \
  && echo "[entrypoint] Ingest complete — ChromaDB ready" \
  || echo "[entrypoint] Ingest failed — check logs. Re-trigger via POST /ingest"
) &

start_server
