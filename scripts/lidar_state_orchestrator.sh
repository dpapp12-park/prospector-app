#!/usr/bin/env bash
set -euo pipefail

ORDER_FILE="${ORDER_FILE:-/opt/lidar-ops/lidar_state_order.txt}"
WORKER="${WORKER:-/opt/lidar-ops/lidar_state_worker.sh}"
MASTER_LOG="${MASTER_LOG:-/data/lidar/logs/state_orchestrator.log}"

mkdir -p "$(dirname "$MASTER_LOG")"
touch "$MASTER_LOG"

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$MASTER_LOG"
}

if [[ ! -f "$ORDER_FILE" ]]; then
  log "ERROR missing ORDER_FILE=$ORDER_FILE"
  exit 1
fi
if [[ ! -x "$WORKER" ]]; then
  log "ERROR missing executable WORKER=$WORKER"
  exit 1
fi

log "orchestrator_start order_file=$ORDER_FILE worker=$WORKER"

while IFS= read -r state || [[ -n "$state" ]]; do
  state="${state%%#*}"
  state="$(echo "$state" | xargs)"
  [[ -z "$state" ]] && continue

  log "state_begin state=$state"
  if STATE="$state" "$WORKER"; then
    log "state_done state=$state"
  else
    log "state_failed state=$state continuing_next_state=true"
  fi
done < "$ORDER_FILE"

log "orchestrator_complete"
