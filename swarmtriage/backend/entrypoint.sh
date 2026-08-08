#!/usr/bin/env bash
# SwarmTriage backend entrypoint (SPEC §6):
# start uvicorn; on first boot (empty DB) run SEED_DATA.py against itself.
set -e

API_URL="${API_URL:-http://localhost:8000}"
SNAPSHOT="${DATA_DIR:-/app/data}/tickets.json"

uvicorn app.main:app --host 0.0.0.0 --port 8000 &
UVICORN_PID=$!

# Wait for the server to accept connections.
for _ in $(seq 1 60); do
  if curl -fsS "${API_URL}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Seed only when the database is empty (no persisted tickets).
if [ ! -s "${SNAPSHOT}" ] || ! grep -q '"ticket_id"' "${SNAPSHOT}" 2>/dev/null; then
  echo "[entrypoint] Empty ticket DB detected — running SEED_DATA.py against ${API_URL}"
  API_URL="${API_URL}" python SEED_DATA.py || echo "[entrypoint] SEED_DATA failed; continuing anyway"
else
  echo "[entrypoint] Existing ticket DB found — skipping seed."
fi

wait "${UVICORN_PID}"
