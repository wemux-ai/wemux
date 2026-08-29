#!/usr/bin/env bash
# Auto-pair script for the dev:docker worker container.
# Waits for the server, pairs automatically if needed, then starts the daemon.
set -euo pipefail

WORKER_HOME="${VIBEMUX_WORKER_HOME:-/data/vibemux-worker}"
SERVER_URL="${VIBEMUX_CLOUD_URL:-http://server:18989}"
CONFIG_DIR="${WORKER_HOME}/node"
CONFIG_FILE="${CONFIG_DIR}/config.json"
MACHINE_ID_FILE="${CONFIG_DIR}/machine-id"

log() {
  echo "[auto-pair] $*"
}

# Ensure the config directory exists
mkdir -p "$CONFIG_DIR"

# Generate or read machine-id
if [ -f "$MACHINE_ID_FILE" ] && [ -s "$MACHINE_ID_FILE" ]; then
  MACHINE_ID=$(cat "$MACHINE_ID_FILE" | tr -d '[:space:]')
else
  MACHINE_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')
  echo "$MACHINE_ID" > "$MACHINE_ID_FILE"
fi
log "machine-id: $MACHINE_ID"

# Check if already paired
if [ -f "$CONFIG_FILE" ]; then
  EXISTING_ID=$(node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8'));
      console.log(c.executorId || '');
    } catch { console.log(''); }
  " 2>/dev/null || echo '')
  EXISTING_TOKEN=$(node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8'));
      console.log(c.executorToken || '');
    } catch { console.log(''); }
  " 2>/dev/null || echo '')

  if [ -n "$EXISTING_ID" ] && [ -n "$EXISTING_TOKEN" ]; then
    log "already paired (executorId: $EXISTING_ID), skipping auto-pair"
    exec pnpm exec tsx watch apps/worker/src/index.ts daemon
  fi
fi

# Wait for server to be ready
log "waiting for server at ${SERVER_URL} ..."
MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -sf "${SERVER_URL}/api/health" > /dev/null 2>&1; then
    log "server is ready"
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
  if [ $((WAITED % 10)) -eq 0 ]; then
    log "still waiting for server... (${WAITED}s)"
  fi
done

if [ $WAITED -ge $MAX_WAIT ]; then
  log "ERROR: server did not become ready within ${MAX_WAIT}s"
  exit 1
fi

# Call auto-pair endpoint
log "calling auto-pair endpoint..."
RESPONSE=$(curl -sf -X POST "${SERVER_URL}/api/control-plane/executors/auto-pair" \
  -H "Content-Type: application/json" \
  -d "{\"machineId\":\"${MACHINE_ID}\",\"machineName\":\"$(hostname)\",\"name\":\"dev-docker-worker\"}" \
  2>&1) || {
  log "ERROR: auto-pair request failed"
  log "$RESPONSE"
  exit 1
}

EXECUTOR_ID=$(echo "$RESPONSE" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try { console.log(JSON.parse(d).executorId||''); } catch { console.log(''); }
  })
" 2>/dev/null || echo '')
EXECUTOR_TOKEN=$(echo "$RESPONSE" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try { console.log(JSON.parse(d).executorToken||''); } catch { console.log(''); }
  })
" 2>/dev/null || echo '')

if [ -z "$EXECUTOR_ID" ] || [ -z "$EXECUTOR_TOKEN" ]; then
  log "ERROR: auto-pair response missing executorId or executorToken"
  log "$RESPONSE"
  exit 1
fi

log "paired successfully (executorId: $EXECUTOR_ID)"

# Save credentials to config.json (merge with existing if any)
if [ -f "$CONFIG_FILE" ]; then
  node -e "
    const fs = require('fs');
    const path = '$CONFIG_FILE';
    let config = {};
    try { config = JSON.parse(fs.readFileSync(path, 'utf8')); } catch {}
    config.executorId = '$EXECUTOR_ID';
    config.executorToken = '$EXECUTOR_TOKEN';
    config.cloudUrl = '$SERVER_URL';
    fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  "
else
  node -e "
    const fs = require('fs');
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify({
      executorId: '$EXECUTOR_ID',
      executorToken: '$EXECUTOR_TOKEN',
      cloudUrl: '$SERVER_URL',
    }, null, 2) + '\n');
  "
fi
log "credentials saved to $CONFIG_FILE"

# Build worker console, then start daemon
log "building worker console..."
pnpm build:worker:console

log "starting worker daemon..."
exec pnpm exec tsx watch apps/worker/src/index.ts daemon
