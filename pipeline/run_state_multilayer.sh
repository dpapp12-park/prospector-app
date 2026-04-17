#!/bin/bash
# =============================================================================
# Pipeline B - Multi-Layer State Orchestrator
# =============================================================================
# One-command end-to-end run generating 3 layers from single VRT pass:
#   1. Multidirectional hillshade (grayscale)
#   2. SVF - Sky-View Factor (grayscale)
#   3. RRIM - Red Relief Image Map (RGB copper/red)
#
# Designed for Oregon (architect-designated first differentiated state).
#
# Workflow:
#   1-4. Same as single-layer orchestrator (download/reproject/VRT/stats)
#   5.   Generate proof tile for ALL 3 layers from same Z/X/Y
#   6.   Upload all 3 proof tiles to R2 at proof paths
#   7.   HALT and print 3 proof URLs. Exits 0.
#   --- Architect reviews all 3 proof tiles ---
#   --- On approval, create APPROVED file and re-run ---
#   8.   Generate full state tiles for all 3 layers
#   9.   Upload each layer to its own R2 path
#   10.  Prune to free disk
#
# Usage (same as single-layer):
#   ./run_state_multilayer.sh pipeline/states/oregon.yaml
#   touch /mnt/nvme1/oregon/APPROVED
#   ./run_state_multilayer.sh pipeline/states/oregon.yaml
# =============================================================================

set -e
set -o pipefail

if [ $# -lt 1 ]; then
    cat <<EOF
Usage: $0 <state_yaml>

Multi-layer orchestrator generating hillshade + SVF + RRIM from single VRT pass.

First invocation runs download, reproject, VRT, stats, and 3-layer proof tile.
Then halts and prints 3 proof URLs for architect review.

After approval:
  touch \$(workdir)/APPROVED
  $0 <state_yaml>

Resumable at every stage.
EOF
    exit 1
fi

CONFIG="$1"
if [ ! -f "$CONFIG" ]; then
    echo "ERROR: Config not found: $CONFIG"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read_yaml() {
    python3 -c "import yaml; d=yaml.safe_load(open('$CONFIG')); print(d.get('$1', ''))"
}

STATE_NAME=$(read_yaml state_name)
WORKDIR=$(read_yaml workdir)
VRT_PATH=$(read_yaml vrt_path)
LOG_PATH=$(read_yaml log_path)
R2_DEST_HILLSHADE=$(read_yaml r2_dest)  # base path; layers append below

if [ -z "$STATE_NAME" ] || [ -z "$WORKDIR" ]; then
    echo "ERROR: state_name and workdir are required in YAML"
    exit 1
fi

# Layers must be declared in YAML
LAYERS=$(python3 -c "
import yaml
d = yaml.safe_load(open('$CONFIG'))
for layer in d.get('layers', ['hillshade']):
    print(layer)
")
if [ -z "$LAYERS" ]; then
    echo "ERROR: 'layers' must be listed in YAML for multi-layer orchestrator"
    echo "Example: layers: [hillshade, svf, rrim]"
    exit 1
fi

APPROVAL_FILE="${WORKDIR}/APPROVED"
mkdir -p "$WORKDIR"
mkdir -p "$(dirname "$LOG_PATH")"

log() {
    local msg="$1"
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$ts] $msg" | tee -a "$LOG_PATH"
}

log "============================================================"
log "Pipeline B Multi-Layer Orchestrator: $STATE_NAME"
log "Config: $CONFIG"
log "Layers: $(echo $LAYERS | tr '\n' ' ')"
log "============================================================"

# ---- Stages 1-3: Same as single-layer (download/reproject/VRT) -------------
RAW_DIR=$(read_yaml raw_dir)
if [ -z "$RAW_DIR" ]; then
    RAW_DIR="${WORKDIR}/raw"
fi
mkdir -p "$RAW_DIR"

log "Stage 1: Download 3DEP source"
PROJECTS=$(python3 -c "
import yaml
d = yaml.safe_load(open('$CONFIG'))
for p in d.get('projects', []):
    print(p)
")
if [ -n "$PROJECTS" ]; then
    while IFS= read -r project; do
        if [ -z "$project" ]; then continue; fi
        log "  Syncing project: $project"
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

log "Stage 2: Reproject to EPSG:5070"
python3 "$SCRIPT_DIR/reproject_state.py" --config "$CONFIG" 2>&1 | tee -a "$LOG_PATH" || exit 1

log "Stage 3: Build master VRT"
python3 "$SCRIPT_DIR/build_vrt.py" --config "$CONFIG" 2>&1 | tee -a "$LOG_PATH" || exit 1

# ---- Stage 4: Multi-layer proof tile ---------------------------------------
log "Stage 4: Multi-layer proof tile generation"
python3 "$SCRIPT_DIR/proof_tile_multilayer.py" --config "$CONFIG" 2>&1 | tee -a "$LOG_PATH" || {
    log "  ERROR: multi-layer proof tile failed"
    exit 1
}
log "Stage 4 complete"

# ---- Gate: APPROVAL file ---------------------------------------------------
if [ ! -f "$APPROVAL_FILE" ]; then
    PROOF_Z=$(python3 -c "import yaml; print(yaml.safe_load(open('$CONFIG'))['proof_tile']['z'])")
    PROOF_X=$(python3 -c "import yaml; print(yaml.safe_load(open('$CONFIG'))['proof_tile']['x'])")
    PROOF_Y=$(python3 -c "import yaml; print(yaml.safe_load(open('$CONFIG'))['proof_tile']['y'])")
    STATE_R2_BASE=$(echo "$R2_DEST_HILLSHADE" | sed 's|r2:lidar-tiles/||' | sed 's|/tiles/hillshade||')

    log ""
    log "============================================================"
    log "APPROVAL GATE: 3 proof tiles uploaded and ready for review"
    log "============================================================"
    while IFS= read -r layer; do
        if [ -z "$layer" ]; then continue; fi
        URL="https://tiles.unworkedgold.com/${STATE_R2_BASE}/proof/${layer}/${PROOF_Z}/${PROOF_X}/${PROOF_Y}.webp"
        log "  $layer: $URL"
    done <<< "$LAYERS"
    log ""
    log "After architect approves all layers, create the approval file:"
    log "  touch $APPROVAL_FILE"
    log ""
    log "Then re-run this script:"
    log "  $0 $CONFIG"
    log "============================================================"
    exit 0
fi

# ---- Stage 5: Full state run for all layers --------------------------------
log "APPROVAL file detected: $APPROVAL_FILE"
log "Stage 5: Full state multi-layer tile generation"
python3 "$SCRIPT_DIR/run_full_state_multilayer.py" \
    --config "$CONFIG" \
    --confirm-proof-approved 2>&1 | tee -a "$LOG_PATH" || {
        log "  ERROR: full state multi-layer run failed"
        exit 1
    }
log "Stage 5 complete"

# ---- Stage 6: Prune -------------------------------------------------------
PRUNE_MODE=$(read_yaml prune_after_upload)
if [ "$PRUNE_MODE" != "false" ]; then
    log "Stage 6: Prune raw + reprojected (free NVMe)"
    REPROJECTED_DIR=$(read_yaml reprojected_dir)
    if [ -z "$REPROJECTED_DIR" ]; then
        REPROJECTED_DIR="${WORKDIR}/reprojected_5070"
    fi
    [ -d "$RAW_DIR" ] && rm -rf "$RAW_DIR" && log "  Removed $RAW_DIR"
    [ -d "$REPROJECTED_DIR" ] && rm -rf "$REPROJECTED_DIR" && log "  Removed $REPROJECTED_DIR"
fi

log ""
log "============================================================"
log "=== STATE COMPLETE (multi-layer): $STATE_NAME ==="
log "============================================================"
STATE_R2_BASE=$(echo "$R2_DEST_HILLSHADE" | sed 's|r2:lidar-tiles/||' | sed 's|/tiles/hillshade||')
log "Tiles live per layer:"
while IFS= read -r layer; do
    if [ -z "$layer" ]; then continue; fi
    log "  $layer: https://tiles.unworkedgold.com/${STATE_R2_BASE}/tiles/${layer}/"
done <<< "$LAYERS"
log "============================================================"
