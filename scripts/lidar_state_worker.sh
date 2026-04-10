#!/usr/bin/env bash
set -euo pipefail

# State-atomic worker:
# For each state in order, run full lifecycle for each project:
# download -> process -> upload -> cleanup -> mark done.
# On failure: mark failed and continue.

STATE_ORDER="${STATE_ORDER:-WY,MT,ID,OR,NV,WA,CA,UT,AZ,NM,CO,AK}"
SOURCE_BUCKET="${SOURCE_BUCKET:-s3://usgs-lidar-public}"
WORK_ROOT="${WORK_ROOT:-/data/lidar/work}"
STATE_ROOT="${STATE_ROOT:-/data/lidar/state}"
OUTPUT_ROOT="${OUTPUT_ROOT:-/data/lidar/output}"
LOG_ROOT="${LOG_ROOT:-/data/lidar/logs}"
MANIFEST_CSV="${MANIFEST_CSV:-/data/lidar/state_manifest.csv}"
AWS_BIN="${AWS_BIN:-/usr/local/bin/aws}"

mkdir -p "$WORK_ROOT" "$STATE_ROOT" "$OUTPUT_ROOT" "$LOG_ROOT"

log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG_ROOT/state_worker.log"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { log "ERROR missing command: $1"; exit 1; }
}

need_cmd "$AWS_BIN"
need_cmd awk
need_cmd sed
need_cmd rg

normalize_state_code() {
  local raw="${1:-}"
  local s
  s="$(echo "$raw" | tr '[:upper:]' '[:lower:]' | tr '-' '_' | xargs)"
  case "$s" in
    alabama) echo "AL" ;;
    alaska) echo "AK" ;;
    arizona) echo "AZ" ;;
    arkansas) echo "AR" ;;
    california) echo "CA" ;;
    colorado) echo "CO" ;;
    connecticut) echo "CT" ;;
    delaware) echo "DE" ;;
    district_of_columbia|dc) echo "DC" ;;
    florida) echo "FL" ;;
    georgia) echo "GA" ;;
    hawaii) echo "HI" ;;
    idaho) echo "ID" ;;
    illinois) echo "IL" ;;
    indiana) echo "IN" ;;
    iowa) echo "IA" ;;
    kansas) echo "KS" ;;
    kentucky) echo "KY" ;;
    louisiana) echo "LA" ;;
    maine) echo "ME" ;;
    maryland) echo "MD" ;;
    massachusetts) echo "MA" ;;
    michigan) echo "MI" ;;
    minnesota) echo "MN" ;;
    mississippi) echo "MS" ;;
    missouri) echo "MO" ;;
    montana) echo "MT" ;;
    nebraska) echo "NE" ;;
    nevada) echo "NV" ;;
    new_hampshire) echo "NH" ;;
    new_jersey) echo "NJ" ;;
    new_mexico) echo "NM" ;;
    new_york) echo "NY" ;;
    north_carolina) echo "NC" ;;
    north_dakota) echo "ND" ;;
    ohio) echo "OH" ;;
    oklahoma) echo "OK" ;;
    oregon) echo "OR" ;;
    pennsylvania) echo "PA" ;;
    rhode_island) echo "RI" ;;
    south_carolina) echo "SC" ;;
    south_dakota) echo "SD" ;;
    tennessee) echo "TN" ;;
    texas) echo "TX" ;;
    utah) echo "UT" ;;
    vermont) echo "VT" ;;
    virginia) echo "VA" ;;
    washington) echo "WA" ;;
    west_virginia) echo "WV" ;;
    wisconsin) echo "WI" ;;
    wyoming) echo "WY" ;;
    [a-z][a-z]) echo "$(echo "$s" | tr '[:lower:]' '[:upper:]')" ;;
    *) return 1 ;;
  esac
}

# Placeholder hooks for your real conversion stack.
# Keep names stable so we can replace implementations without changing orchestrator flow.
process_project() {
  local state="$1"
  local project="$2"
  local local_dir="$3"
  local out_dir="$4"

  # TODO: replace this with your real PDAL/GDAL/tiler pipeline.
  # Returning 0 keeps flow moving while wiring in full processor.
  mkdir -p "$out_dir"
  echo "{\"state\":\"$state\",\"project\":\"$project\",\"processed_at\":\"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\"}" > "$out_dir/PROCESS_PLACEHOLDER.json"
  return 0
}

upload_project() {
  local state="$1"
  local project="$2"
  local out_dir="$3"

  # TODO: set real destination bucket/path for live tiles.
  # Example: s3://tiles.unworkedgold.com/<state>/<project>/
  # Current placeholder is dry-write to local output root only.
  [ -d "$out_dir" ] || return 1
  return 0
}

cleanup_project() {
  local local_dir="$1"
  rm -rf "$local_dir"
}

build_manifest_if_missing() {
  if [ -f "$MANIFEST_CSV" ]; then
    log "Using existing manifest: $MANIFEST_CSV"
    return 0
  fi

  log "Building manifest from bucket listing..."
  {
    echo "state,project,status,last_error,last_update"
    "$AWS_BIN" s3 ls --no-sign-request "$SOURCE_BUCKET/" \
      | awk '{print $2}' \
      | sed 's:/$::' \
      | rg '^(USGS_LPC_[A-Z]{2}_|[A-Z]{2}_)' \
      | while read -r p; do
          st="$(echo "$p" | sed -E 's/^USGS_LPC_([A-Z]{2})_.*/\1/; t; s/^([A-Z]{2})_.*/\1/')"
          echo "$st,$p,pending,,$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
        done
  } > "$MANIFEST_CSV"
  log "Manifest created: $MANIFEST_CSV"
}

set_status() {
  local state="$1" project="$2" status="$3" err="$4"
  local ts
  ts="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  awk -F, -v OFS=, -v s="$state" -v p="$project" -v st="$status" -v e="$err" -v t="$ts" '
    NR==1 {print; next}
    $1==s && $2==p {$3=st; $4=e; $5=t}
    {print}
  ' "$MANIFEST_CSV" > "${MANIFEST_CSV}.tmp"
  mv "${MANIFEST_CSV}.tmp" "$MANIFEST_CSV"
}

run_project() {
  local state="$1" project="$2"
  local local_dir="$STATE_ROOT/$state/$project"
  local out_dir="$OUTPUT_ROOT/$state/$project"
  local sync_log="$LOG_ROOT/${project}.sync.log"

  mkdir -p "$(dirname "$local_dir")" "$(dirname "$out_dir")"
  set_status "$state" "$project" "downloading" ""
  log "START $state :: $project"

  if ! "$AWS_BIN" s3 sync --no-sign-request "$SOURCE_BUCKET/$project/" "$local_dir/" 2>&1 | tee -a "$sync_log"; then
    set_status "$state" "$project" "failed" "download_failed"
    log "FAIL $state :: $project (download_failed)"
    return 1
  fi

  set_status "$state" "$project" "processing" ""
  if ! process_project "$state" "$project" "$local_dir" "$out_dir" >> "$LOG_ROOT/${project}.process.log" 2>&1; then
    set_status "$state" "$project" "failed" "process_failed"
    log "FAIL $state :: $project (process_failed)"
    return 1
  fi

  set_status "$state" "$project" "uploading" ""
  if ! upload_project "$state" "$project" "$out_dir" >> "$LOG_ROOT/${project}.upload.log" 2>&1; then
    set_status "$state" "$project" "failed" "upload_failed"
    log "FAIL $state :: $project (upload_failed)"
    return 1
  fi

  cleanup_project "$local_dir"
  set_status "$state" "$project" "done" ""
  log "DONE $state :: $project"
  return 0
}

run_state() {
  local state="$1"
  log "STATE_START $state"

  mapfile -t projects < <(awk -F, -v s="$state" 'NR>1 && $1==s && $3!="done" {print $2}' "$MANIFEST_CSV")
  if [ "${#projects[@]}" -eq 0 ]; then
    log "STATE_SKIP $state (no pending projects)"
    return 0
  fi

  for p in "${projects[@]}"; do
    if ! run_project "$state" "$p"; then
      # continue-on-error policy by design
      continue
    fi
  done

  log "STATE_DONE $state"
}

main() {
  build_manifest_if_missing

  # Orchestrator mode: process exactly one requested state (name or code).
  if [ -n "${STATE:-}" ]; then
    local single_state
    if ! single_state="$(normalize_state_code "$STATE")"; then
      log "ERROR invalid STATE value: $STATE"
      exit 1
    fi
    run_state "$single_state"
    log "WORKER_DONE"
    return 0
  fi

  # Standalone mode: process configured sequence.
  IFS=',' read -r -a states <<< "$STATE_ORDER"
  for st in "${states[@]}"; do
    local st_norm
    if ! st_norm="$(normalize_state_code "$st")"; then
      log "WARN skipping invalid state token in STATE_ORDER: $st"
      continue
    fi
    run_state "$st_norm"
  done
  log "WORKER_DONE"
}

main "$@"

