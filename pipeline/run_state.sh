#!/bin/bash
# =============================================================================
# Pipeline B - Single-Layer State Orchestrator
# =============================================================================
# One-command end-to-end run of a single state through Pipeline B (hillshade).
# Designed for use on Phase 1 states: RI, CT, MA, VT, NH, ME, etc.
#
# Workflow:
#   1. Download 3DEP source tiles (resumable, skips if already downloaded)
#   2. Reproject all tiles to EPSG:5070 (resumable)
#   3. Build master state VRT
#   4. Compute global stats + generate proof tile
#   5. Upload proof tile to R2 at proof path
#   6. HALT and print proof URL. Exits 0.
#   --- Architect/owner review the proof tile ---
#   --- On approval, create the APPROVED file and re-run ---
#   7. Detect APPROVED file, run full state tile generation
#   8. Upload all tiles to R2 production path
#   9. Prune local raw+reprojected tiles to free NVMe
#   10. Print completion summary. Exits 0.
#
# Usage:
#   First invocation (runs steps 1-6):
#     ./run_state.sh pipeline/states/connecticut.yaml
#
#   After architect approves proof tile:
#     touch /mnt/scratch/connecticut/APPROVED
#     ./run_state.sh pipeline/states/connecticut.yaml
#
# Resumable: every stage checks for prior output. Safe to re-invoke.
# =============================================================================

set -e
set -o pipefail

# ---- Arguments -------------------------------------------------------------
if [ $# -lt 1 ]; then
    cat <<EOF
Usage: $0 <state_yaml>

First invocation runs: download -> reproject -> vrt -> stats -> proof tile -> upload proof
Then halts and prints proof URL for architect review.

After architect approval, create the approval file:
  touch \$(workdir from yaml)/APPROVED

Then re-invoke the same command to run full state + upload + cleanup:
  $0 <state_yaml>
EOF
    exit 1
fi

CONFIG="$1"
if [ ! -f "$CONFIG" ]; then
    echo "ERROR: Config not found: $CONFIG"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- Extract key paths from YAML via Python (avoids shell yaml parsing) ----
read_yaml() {
    python3 -c "import yaml; d=yaml.safe_load(open('$CONFIG')); print(d.get('$1', ''))"
}

STATE_NAME=$(read_yaml state_name)
WORKDIR=$(read_yaml workdir)
VRT_PATH=$(read_yaml vrt_path)
TILES_DIR=$(read_yaml tiles_dir)
LOG_PATH=$(read_yaml log_path)
R2_DEST=$(read_yaml r2_dest)

if [ -z "$STATE_NAME" ] || [ -z "$WORKDIR" ]; then
    echo "ERROR: state_name and workdir are required in YAML"
    exit 1
fi

APPROVAL_FILE="${WORKDIR}/APPROVED"
mkdir -p "$WORKDIR"
mkdir -p "$(dirname "$LOG_PATH")"

# ---- Helper: log to both stdout and log file -------------------------------
log() {
    local msg="$1"
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$ts] $msg" | tee -a "$LOG_PATH"
}

log "============================================================"
log "Pipeline B Orchestrator (Single-Layer): $STATE_NAME"
log "Config: $CONFIG"
log "Workdir: $WORKDIR"
log "============================================================"

# ---- Stage 1: Download 3DEP source (if not already done) -------------------
RAW_DIR=$(read_yaml raw_dir)
if [ -z "$RAW_DIR" ]; then
    RAW_DIR="${WORKDIR}/raw"
fi
mkdir -p "$RAW_DIR"

# Count already-downloaded tiles
RAW_COUNT=$(find "$RAW_DIR" -maxdepth 2 -name "*.tif" 2>/dev/null | wc -l)
log "Stage 1: Download 3DEP source (current count in $RAW_DIR: $RAW_COUNT)"

# Read projects list
PROJECTS=$(python3 -c "
import yaml
d = yaml.safe_load(open('$CONFIG'))
for p in d.get('projects', []):
    print(p)
")

if [ -z "$PROJECTS" ]; then
    log "  WARNING: No projects listed in YAML. Skipping download stage."
else
    while IFS= read -r project; do
        if [ -z "$project" ]; then continue; fi
        # Count existing tiles for this project
        EXISTING=$(find "$RAW_DIR" -maxdepth 2 -name "*${project}*.tif" 2>/dev/null | wc -l)
        log "  Project $project: $EXISTING existing tiles"
        log "  Downloading s3://prd-tnm/.../${project}/TIFF/ -> $RAW_DIR/"
        aws s3 sync \
            "s3://prd-tnm/StagedProducts/Elevation/1m/Projects/${project}/TIFF/" \
            "$RAW_DIR/" \
            --no-sign-request \
            --exclude '*' --include '*.tif' \
            --only-show-errors 2>&1 | tee -a "$LOG_PATH" || {
                log "  ERROR: download failed for $project"
                exit 1
            }
    done <<< "$PROJECTS"
fi

POST_RAW_COUNT=$(find "$RAW_DIR" -maxdepth 2 -name "*.tif" 2>/dev/null | wc -l)
log "Stage 1 complete: $POST_RAW_COUNT total tiles in $RAW_DIR"

# ---- Stage 2: Reproject to EPSG:5070 ---------------------------------------
log "Stage 2: Reproject to EPSG:5070"
python3 "$SCRIPT_DIR/reproject_state.py" --config "$CONFIG" 2>&1 | tee -a "$LOG_PATH" || {
    log "  ERROR: reprojection failed"
    exit 1
}
log "Stage 2 complete"

# ---- Stage 3: Build master VRT ---------------------------------------------
log "Stage 3: Build master VRT"
python3 "$SCRIPT_DIR/build_vrt.py" --config "$CONFIG" 2>&1 | tee -a "$LOG_PATH" || {
    log "  ERROR: VRT build failed"
    exit 1
}
log "Stage 3 complete"

# ---- Stage 4: Global stats + proof tile ------------------------------------
log "Stage 4: Global stats + proof tile"
python3 "$SCRIPT_DIR/proof_tile.py" --config "$CONFIG" 2>&1 | tee -a "$LOG_PATH" || {
    log "  ERROR: proof tile generation failed"
    exit 1
}
log "Stage 4 complete"

# ---- Gate: check for APPROVAL file -----------------------------------------
if [ ! -f "$APPROVAL_FILE" ]; then
    PROOF_Z=$(python3 -c "import yaml; print(yaml.safe_load(open('$CONFIG'))['proof_tile']['z'])")
    PROOF_X=$(python3 -c "import yaml; print(yaml.safe_load(open('$CONFIG'))['proof_tile']['x'])")
    PROOF_Y=$(python3 -c "import yaml; print(yaml.safe_load(open('$CONFIG'))['proof_tile']['y'])")

    # Compute proof URL from R2_DEST
    # e.g. r2:lidar-tiles/connecticut/tiles/hillshade ->
    #      https://tiles.unworkedgold.com/connecticut/proof/hillshade/Z/X/Y.webp
    BUCKET_PATH=$(echo "$R2_DEST" | sed 's|r2:lidar-tiles/||' | sed 's|/tiles/hillshade|/proof/hillshade|')
    PROOF_URL="https://tiles.unworkedgold.com/${BUCKET_PATH}/${PROOF_Z}/${PROOF_X}/${PROOF_Y}.webp"

    log ""
    log "============================================================"
    log "APPROVAL GATE: Proof tile uploaded and ready for review"
    log "============================================================"
    log "Proof tile URL:"
    log "  $PROOF_URL"
    log ""
    log "After architect approves, create the approval file:"
    log "  touch $APPROVAL_FILE"
    log ""
    log "Then re-run this script to continue to full state:"
    log "  $0 $CONFIG"
    log "============================================================"
    exit 0
fi

# ---- Stage 5: Full state tile generation -----------------------------------
log "APPROVAL file detected: $APPROVAL_FILE"
log "Stage 5: Full state tile generation + R2 upload"
python3 "$SCRIPT_DIR/run_full_state.py" \
    --config "$CONFIG" \
    --confirm-proof-approved 2>&1 | tee -a "$LOG_PATH" || {
        log "  ERROR: full state run failed"
        exit 1
    }
log "Stage 5 complete"

# ---- Stage 6: Prune NVMe to free disk --------------------------------------
PRUNE_MODE=$(read_yaml prune_after_upload)
if [ "$PRUNE_MODE" != "false" ]; then
    log "Stage 6: Prune raw + reprojected tiles (to free NVMe)"
    REPROJECTED_DIR=$(read_yaml reprojected_dir)
    if [ -z "$REPROJECTED_DIR" ]; then
        REPROJECTED_DIR="${WORKDIR}/reprojected_5070"
    fi
    if [ -d "$RAW_DIR" ]; then
        RAW_SIZE=$(du -sh "$RAW_DIR" 2>/dev/null | cut -f1)
        log "  Removing $RAW_DIR ($RAW_SIZE)"
        rm -rf "$RAW_DIR"
    fi
    if [ -d "$REPROJECTED_DIR" ]; then
        REP_SIZE=$(du -sh "$REPROJECTED_DIR" 2>/dev/null | cut -f1)
        log "  Removing $REPROJECTED_DIR ($REP_SIZE)"
        rm -rf "$REPROJECTED_DIR"
    fi
    log "Stage 6 complete"
else
    log "Stage 6 skipped (prune_after_upload: false in YAML)"
fi

log ""
log "============================================================"
log "=== STATE COMPLETE: $STATE_NAME ==="
log "============================================================"
log "Tiles live at: $R2_DEST"
log "Public base URL: https://tiles.unworkedgold.com/$(echo "$R2_DEST" | sed 's|r2:lidar-tiles/||')/"
log ""
log "Next steps:"
log "  1. Verify tiles by loading app with state added to lidarStates in index.html"
log "  2. Safe to stop EC2 instance to halt billing"
log "============================================================"
