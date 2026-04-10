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
DEST_BUCKET="${DEST_BUCKET:-s3://tiles.unworkedgold.com}"
PUBLISH_ROOT="${PUBLISH_ROOT:-3dep}"
STYLE_LIST="${STYLE_LIST:-hillshade,svf,slope,lrm,rrim,north,northeast,east,southeast,lowangle}"
TILE_MIN_Z="${TILE_MIN_Z:-8}"
TILE_MAX_Z="${TILE_MAX_Z:-15}"
TILE_PROCESSES="${TILE_PROCESSES:-4}"
DEM_RESOLUTION="${DEM_RESOLUTION:-1.0}"
DISK_WARN_FREE_PCT="${DISK_WARN_FREE_PCT:-25}"
DISK_STOP_FREE_PCT="${DISK_STOP_FREE_PCT:-15}"
MAX_RETRIES="${MAX_RETRIES:-4}"
RETRY_BASE_SECONDS="${RETRY_BASE_SECONDS:-5}"
PROJECT_FILTER_REGEX="${PROJECT_FILTER_REGEX:-}"
KEEP_RAW_ON_FAILURE="${KEEP_RAW_ON_FAILURE:-1}"
DOWNLOAD_ONLY_MODE="${DOWNLOAD_ONLY_MODE:-0}"

mkdir -p "$WORK_ROOT" "$STATE_ROOT" "$OUTPUT_ROOT" "$LOG_ROOT"

log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG_ROOT/state_worker.log"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { log "ERROR missing command: $1"; exit 1; }
}

need_cmd "$AWS_BIN"
need_cmd awk
need_cmd sed
need_cmd rg

disk_free_pct() {
  local probe_path="${1:-$STATE_ROOT}"
  df -P "$probe_path" | awk 'NR==2 {gsub("%","",$5); print 100-$5}'
}

check_disk_guardrails() {
  local free_pct
  free_pct="$(disk_free_pct "$STATE_ROOT")"
  if [ "$free_pct" -lt "$DISK_STOP_FREE_PCT" ]; then
    log "ERROR disk free ${free_pct}% below stop threshold ${DISK_STOP_FREE_PCT}%"
    return 1
  fi
  if [ "$free_pct" -lt "$DISK_WARN_FREE_PCT" ]; then
    log "WARN disk free ${free_pct}% below warn threshold ${DISK_WARN_FREE_PCT}%"
  fi
  return 0
}

run_with_retry() {
  local label="$1"
  shift
  local attempt=1
  local delay="$RETRY_BASE_SECONDS"
  while true; do
    if "$@"; then
      return 0
    fi
    if [ "$attempt" -ge "$MAX_RETRIES" ]; then
      log "ERROR ${label} failed after ${attempt} attempts"
      return 1
    fi
    log "WARN ${label} failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}s"
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

slugify() {
  local v
  v="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
  v="$(echo "$v" | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
  echo "$v"
}

need_cmd python3
if [ "$DOWNLOAD_ONLY_MODE" != "1" ]; then
  need_cmd pdal
  need_cmd gdaldem
  need_cmd gdalwarp
  need_cmd gdal_calc.py
  need_cmd gdal2tiles.py
else
  log "WARN DOWNLOAD_ONLY_MODE=1 -> processing/upload tools are not required"
fi

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
  local dem_tif="$out_dir/dem.tif"
  local ept_json
  local laz_glob
  local style
  local style_tmp_dir="$WORK_ROOT/style_tmp/$state/$project"
  local lrm_trend="$style_tmp_dir/lrm_trend.tif"
  local lrm_tif="$style_tmp_dir/lrm.tif"
  local slope_deg="$style_tmp_dir/slope_degrees.tif"

  mkdir -p "$out_dir" "$style_tmp_dir"

  if [ "$DOWNLOAD_ONLY_MODE" = "1" ]; then
    echo "{\"state\":\"$state\",\"project\":\"$project\",\"mode\":\"download_only\",\"processed_at\":\"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\"}" > "$out_dir/PROCESS_METADATA.json"
    return 0
  fi

  # Prefer EPT project roots from usgs-lidar-public, fallback to local LAS/LAZ sets.
  ept_json="$(rg --files -g 'ept.json' "$local_dir" | head -n 1 || true)"
  if [ -n "$ept_json" ]; then
    cat > "$style_tmp_dir/pdal_dem_pipeline.json" <<EOF
[
  { "type":"readers.ept", "filename":"$ept_json" },
  { "type":"filters.range", "limits":"Classification[2:2]" },
  { "type":"writers.gdal", "filename":"$dem_tif", "resolution":$DEM_RESOLUTION, "output_type":"min", "window_size":6, "nodata":-9999 }
]
EOF
    if ! pdal pipeline "$style_tmp_dir/pdal_dem_pipeline.json"; then
      log "WARN EPT to DEM failed for $project, attempting LAS/LAZ fallback"
      ept_json=""
    fi
  fi

  if [ ! -f "$dem_tif" ]; then
    laz_glob="$(rg --files -g '*.laz' -g '*.las' "$local_dir" | head -n 1 || true)"
    if [ -z "$laz_glob" ]; then
      log "ERROR no ept.json or LAS/LAZ inputs found under $local_dir"
      return 1
    fi
    pdal translate "$laz_glob" "$dem_tif" \
      --filters.range.limits="Classification[2:2]" \
      --writers.gdal.resolution="$DEM_RESOLUTION" \
      --writers.gdal.output_type=min \
      --writers.gdal.nodata=-9999 \
      --writers.gdal.window_size=6
  fi

  if [ ! -f "$dem_tif" ]; then
    log "ERROR DEM build failed for $project"
    return 1
  fi

  # Shared derivatives for LRM/RRIM styles.
  gdalwarp -overwrite -r cubic -tr 10 10 "$dem_tif" "$lrm_trend"
  gdalwarp -overwrite -r cubic -tr "$DEM_RESOLUTION" "$DEM_RESOLUTION" "$lrm_trend" "${lrm_trend%.tif}_hires.tif"
  gdal_calc.py -A "$dem_tif" -B "${lrm_trend%.tif}_hires.tif" \
    --outfile="$lrm_tif" \
    --calc="A-B" \
    --NoDataValue=-9999 \
    --type=Float32
  gdaldem slope "$dem_tif" "$slope_deg" -compute_edges

  IFS=',' read -r -a styles <<< "$STYLE_LIST"
  for style in "${styles[@]}"; do
    local style_src="$style_tmp_dir/${style}.tif"
    local style_3857="$style_tmp_dir/${style}_3857.tif"
    local style_tiles="$out_dir/$style"
    case "$style" in
      hillshade) gdaldem hillshade "$dem_tif" "$style_src" -az 315 -alt 45 -compute_edges ;;
      north) gdaldem hillshade "$dem_tif" "$style_src" -az 0 -alt 45 -compute_edges ;;
      northeast) gdaldem hillshade "$dem_tif" "$style_src" -az 45 -alt 45 -compute_edges ;;
      east) gdaldem hillshade "$dem_tif" "$style_src" -az 90 -alt 45 -compute_edges ;;
      southeast) gdaldem hillshade "$dem_tif" "$style_src" -az 135 -alt 45 -compute_edges ;;
      lowangle) gdaldem hillshade "$dem_tif" "$style_src" -az 315 -alt 20 -compute_edges ;;
      slope) gdaldem slope "$dem_tif" "$style_src" -compute_edges ;;
      svf) gdaldem hillshade "$dem_tif" "$style_src" -multidirectional -compute_edges ;;
      lrm) cp "$lrm_tif" "$style_src" ;;
      rrim)
        gdal_calc.py -A "$lrm_tif" -B "$slope_deg" \
          --outfile="$style_src" \
          --calc="(A*2)+(B/45.0)" \
          --NoDataValue=-9999 \
          --type=Float32
        ;;
      *)
        log "WARN unknown style '$style' skipped"
        continue
        ;;
    esac

    gdalwarp -overwrite -t_srs EPSG:3857 -r bilinear -dstnodata 0 "$style_src" "$style_3857"
    rm -rf "$style_tiles"
    gdal2tiles.py --xyz --processes="$TILE_PROCESSES" --zoom="${TILE_MIN_Z}-${TILE_MAX_Z}" --tiledriver=WEBP "$style_3857" "$style_tiles"
  done

  echo "{\"state\":\"$state\",\"project\":\"$project\",\"processed_at\":\"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\",\"style_list\":\"$STYLE_LIST\"}" > "$out_dir/PROCESS_METADATA.json"
  return 0
}

upload_project() {
  local state="$1"
  local project="$2"
  local out_dir="$3"
  local style
  local state_slug project_slug
  local style_dest
  [ -d "$out_dir" ] || { log "ERROR missing output directory: $out_dir"; return 1; }
  if [ "$DOWNLOAD_ONLY_MODE" = "1" ]; then
    log "WARN upload skipped for $project (DOWNLOAD_ONLY_MODE=1)"
    return 0
  fi

  state_slug="$(slugify "$state")"
  project_slug="$(slugify "$project")"

  IFS=',' read -r -a styles <<< "$STYLE_LIST"
  for style in "${styles[@]}"; do
    [ -d "$out_dir/$style" ] || continue
    style_dest="$DEST_BUCKET/$PUBLISH_ROOT/$state_slug/$project_slug/$style/"
    run_with_retry "upload_${project}_${style}" "$AWS_BIN" s3 sync --delete "$out_dir/$style/" "$style_dest"
  done
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
  if ! check_disk_guardrails; then
    set_status "$state" "$project" "failed" "disk_low_pre_download"
    log "FAIL $state :: $project (disk_low_pre_download)"
    return 1
  fi

  set_status "$state" "$project" "downloading" ""
  log "START $state :: $project"

  if ! run_with_retry "download_${project}" "$AWS_BIN" s3 sync --no-sign-request "$SOURCE_BUCKET/$project/" "$local_dir/" >> "$sync_log" 2>&1; then
    set_status "$state" "$project" "failed" "download_failed"
    log "FAIL $state :: $project (download_failed)"
    return 1
  fi

  if ! check_disk_guardrails; then
    set_status "$state" "$project" "failed" "disk_low_pre_process"
    log "FAIL $state :: $project (disk_low_pre_process)"
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

  cleanup_project "$out_dir"
  if [ "$DOWNLOAD_ONLY_MODE" != "1" ]; then
    cleanup_project "$local_dir"
    set_status "$state" "$project" "done" ""
  else
    set_status "$state" "$project" "done" "download_only"
  fi
  log "DONE $state :: $project"
  return 0
}

run_state() {
  local state="$1"
  log "STATE_START $state"

  mapfile -t projects < <(awk -F, -v s="$state" 'NR>1 && $1==s && $3!="done" {print $2}' "$MANIFEST_CSV")
  if [ -n "$PROJECT_FILTER_REGEX" ]; then
    mapfile -t projects < <(printf "%s\n" "${projects[@]}" | rg "$PROJECT_FILTER_REGEX" || true)
  fi
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

