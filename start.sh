#!/bin/sh
# Render startup script — runs inside the container as PID 1 via tini.
# 1. Start Ollama in background
# 2. Wait until it is accepting connections
# 3. Pull the model if not already cached on the persistent disk
# 4. Hand off to Node (becomes the foreground process)

set -e

OLLAMA_MODEL="${OLLAMA_MODEL:-gemma:2b}"
OLLAMA_HOST="http://localhost:11434"
MAX_WAIT=120   # seconds to wait for Ollama to boot

echo "[start] Starting Ollama in background..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
echo "[start] Waiting for Ollama to accept connections..."
waited=0
until curl -sf "${OLLAMA_HOST}/api/tags" > /dev/null 2>&1; do
  if [ $waited -ge $MAX_WAIT ]; then
    echo "[start] ERROR: Ollama did not start within ${MAX_WAIT}s"
    exit 1
  fi
  sleep 2
  waited=$((waited + 2))
done
echo "[start] Ollama is up after ${waited}s"

# Pull model only if not already present (persistent disk avoids re-downloading)
if ollama list 2>/dev/null | grep -q "^${OLLAMA_MODEL}"; then
  echo "[start] Model '${OLLAMA_MODEL}' already cached — skipping pull"
else
  echo "[start] Pulling model '${OLLAMA_MODEL}' (this may take several minutes on first deploy)..."
  ollama pull "${OLLAMA_MODEL}"
  echo "[start] Model pull complete"
fi

echo "[start] Starting Node.js server..."
# exec replaces this shell — Node becomes the direct child of tini
exec node --max-old-space-size=256 /app/server.js
