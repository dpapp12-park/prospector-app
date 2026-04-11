#!/usr/bin/env bash
set -euo pipefail

AWS_BIN="${AWS_BIN:-/home/ubuntu/.local/bin/aws}"
BUCKET="${BUCKET:-s3://usgs-lidar-public}"
OUT_ROOT="${OUT_ROOT:-/workspace/data/usgs_lidar}"
MASTER_LOG="${MASTER_LOG:-$OUT_ROOT/longhaul_queue.log}"

MADISON_PROJECT="USGS_LPC_IN_ET_B6_Madison_2012_LAS_2017"

mkdir -p "$OUT_ROOT"
touch "$MASTER_LOG"

log() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$MASTER_LOG"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "ERROR missing command: $1"
    exit 1
  fi
}

require_cmd "$AWS_BIN"
require_cmd awk
require_cmd rg
require_cmd sed

list_projects_by_state() {
  local state="$1"
  "$AWS_BIN" s3 ls --no-sign-request "$BUCKET/" \
    | awk '{print $2}' \
    | sed 's:/$::' \
    | rg "^USGS_LPC_${state}_" \
    | sort -u
}

wait_for_existing_madison_download() {
  while ps -ef | rg -v "rg " | rg -q "aws s3 sync --no-sign-request ${BUCKET}/${MADISON_PROJECT}/"; do
    log "Detected active Madison sync in another session; waiting 30s..."
    sleep 30
  done
}

sync_project() {
  local project="$1"
  local src="${BUCKET}/${project}/"
  local dst="${OUT_ROOT}/${project}/"
  local project_log="${OUT_ROOT}/${project}.sync.log"
  local attempt=1

  mkdir -p "$dst"
  log "START project=${project}"
  while true; do
    log "SYNC attempt=${attempt} project=${project}"
    if "$AWS_BIN" s3 sync --no-sign-request "$src" "$dst" 2>&1 | tee -a "$project_log"; then
      local size
      size="$(du -sh "$dst" | awk '{print $1}')"
      log "DONE project=${project} size=${size}"
      return 0
    fi

    local backoff=$(( attempt * 30 ))
    if (( backoff > 300 )); then
      backoff=300
    fi
    log "RETRY project=${project} after=${backoff}s"
    sleep "$backoff"
    attempt=$((attempt + 1))
  done
}

log "Queue boot: Madison -> Oregon -> Nevada"

wait_for_existing_madison_download
sync_project "$MADISON_PROJECT"

log "Discovering Oregon projects from ${BUCKET}"
mapfile -t OREGON_PROJECTS < <(list_projects_by_state "OR")
if ((${#OREGON_PROJECTS[@]} == 0)); then
  log "WARN no Oregon projects matched in ${BUCKET}"
else
  log "Oregon projects found: ${#OREGON_PROJECTS[@]}"
  for p in "${OREGON_PROJECTS[@]}"; do
    sync_project "$p"
  done
fi

log "Discovering Nevada projects from ${BUCKET}"
mapfile -t NEVADA_PROJECTS < <(list_projects_by_state "NV")
if ((${#NEVADA_PROJECTS[@]} == 0)); then
  log "WARN no Nevada projects matched in ${BUCKET}"
else
  log "Nevada projects found: ${#NEVADA_PROJECTS[@]}"
  for p in "${NEVADA_PROJECTS[@]}"; do
    sync_project "$p"
  done
fi

log "Queue complete."
