#!/usr/bin/env python3
"""
Pipeline B - Reproject State Tiles to EPSG:5070

State-agnostic reprojection loop. Reads a state YAML config, finds all raw
3DEP tiles across the listed projects, reprojects each to EPSG:5070 with
bilinear resampling.

Key safety features:
- Resumable: skips tiles already reprojected
- Disk-safe: optionally deletes source tile after successful reprojection
- Logs progress every 25 tiles
- Exits with non-zero on any failure (lets orchestrator stop cleanly)

Usage:
    python3 reproject_state.py --config pipeline/states/oregon.yaml
    python3 reproject_state.py --config pipeline/states/oregon.yaml --keep-source

By default SOURCE TILES ARE DELETED after successful reprojection to free disk.
Use --keep-source to preserve raw tiles (uses ~2x disk during run).
"""
import os
import sys
import glob
import argparse
import subprocess
import yaml


def log(msg, log_path=None):
    print(msg, flush=True)
    if log_path:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, "a") as f:
            f.write(msg + "\n")


def load_config(config_path):
    with open(config_path) as f:
        cfg = yaml.safe_load(f)
    required = ["state_name", "workdir", "projects", "crs_processing"]
    missing = [k for k in required if k not in cfg]
    if missing:
        raise ValueError(f"Missing required config keys: {missing}")
    return cfg


def find_raw_tiles(cfg):
    """
    Find all raw .tif tiles for the state, looking in standard 3DEP download
    locations. Searches both common patterns:
      - {workdir}/raw/*.tif  (single project per state)
      - /mnt/nvme1/3dep_raw/{project}/*.tif  (multi-project batch download)
      - {reprojected_dir sibling}/ for same-dir parallel patterns
    Returns list of absolute paths.
    """
    projects = cfg["projects"]
    tiles = []

    # Pattern 1: {workdir}/raw/*.tif (Oregon original, RI ingest)
    workdir_raw = os.path.join(cfg["workdir"], "raw")
    if os.path.isdir(workdir_raw):
        hits = sorted(glob.glob(os.path.join(workdir_raw, "*.tif")))
        if hits:
            tiles.extend(hits)

    # Pattern 2: /mnt/nvme1/3dep_raw/{project}/*.tif (batch download)
    for proj in projects:
        batch_path = f"/mnt/nvme1/3dep_raw/{proj}"
        if os.path.isdir(batch_path):
            hits = sorted(glob.glob(os.path.join(batch_path, "*.tif")))
            tiles.extend(hits)

    # Pattern 3: explicit raw_dir override in YAML
    if "raw_dir" in cfg:
        raw_dir = cfg["raw_dir"]
        if os.path.isdir(raw_dir):
            hits = sorted(glob.glob(os.path.join(raw_dir, "*.tif")))
            tiles.extend(hits)

    # Deduplicate (in case multiple patterns matched the same files)
    tiles = sorted(set(tiles))
    return tiles


def reproject_tile(src, dst, target_crs, log_path):
    """Run gdalwarp to reproject a single tile. Returns True on success."""
    # Use COMPRESS=DEFLATE TILED=YES for faster downstream reads, matches RI pattern
    cmd = [
        "gdalwarp",
        "-t_srs", target_crs,
        "-r", "bilinear",
        "-co", "COMPRESS=DEFLATE",
        "-co", "TILED=YES",
        "-overwrite",
        "-q",  # quiet (progress still logged by our wrapper)
        src, dst
    ]
    try:
        subprocess.check_call(cmd)
        return True
    except subprocess.CalledProcessError as e:
        log(f"ERROR reprojecting {src}: {e}", log_path)
        return False


def main():
    ap = argparse.ArgumentParser(
        description="Pipeline B state-agnostic reprojection to EPSG:5070"
    )
    ap.add_argument("--config", required=True,
                    help="Path to state YAML config")
    ap.add_argument("--keep-source", action="store_true",
                    help="Do not delete source tiles after successful reprojection "
                         "(uses ~2x disk during run)")
    args = ap.parse_args()

    cfg = load_config(args.config)
    log_path = cfg.get("log_path", f"{cfg['workdir']}/reproject.log")
    target_crs = cfg["crs_processing"]

    # Output directory -- use reprojected_dir from YAML or default pattern
    if "reprojected_dir" in cfg:
        out_dir = cfg["reprojected_dir"]
    else:
        out_dir = os.path.join(cfg["workdir"], "reprojected_5070")
    os.makedirs(out_dir, exist_ok=True)

    log("=" * 60, log_path)
    log(f"Pipeline B Reprojection: {cfg['state_name']}", log_path)
    log(f"Target CRS: {target_crs}", log_path)
    log(f"Output dir: {out_dir}", log_path)
    log(f"Delete source after reproject: {not args.keep_source}", log_path)
    log("=" * 60, log_path)

    # Find raw tiles
    tiles = find_raw_tiles(cfg)
    if not tiles:
        log("ERROR: No raw tiles found. Check projects list and paths in YAML.", log_path)
        sys.exit(1)
    log(f"Found {len(tiles)} raw tiles to process", log_path)

    # Process each tile
    succeeded = 0
    skipped = 0
    failed = 0

    for i, src_path in enumerate(tiles, 1):
        # Output path: same basename with _5070 suffix
        base = os.path.basename(src_path)
        out_name = base.replace(".tif", "_5070.tif")
        dst_path = os.path.join(out_dir, out_name)

        # Resume: skip if output already exists and is non-empty
        if os.path.exists(dst_path) and os.path.getsize(dst_path) > 0:
            skipped += 1
            # If skipping and not --keep-source, still delete source to recover disk
            if not args.keep_source and os.path.exists(src_path):
                try:
                    os.remove(src_path)
                except OSError:
                    pass
            if i % 25 == 0 or i == len(tiles):
                log(f"  [{i}/{len(tiles)}] {succeeded} done, {skipped} skipped, {failed} failed", log_path)
            continue

        # Reproject
        ok = reproject_tile(src_path, dst_path, target_crs, log_path)
        if ok:
            succeeded += 1
            # Delete source to save disk (default behavior)
            if not args.keep_source:
                try:
                    os.remove(src_path)
                except OSError as e:
                    log(f"  Warning: could not remove source {src_path}: {e}", log_path)
        else:
            failed += 1
            # Remove possibly-partial output
            if os.path.exists(dst_path):
                try:
                    os.remove(dst_path)
                except OSError:
                    pass

        if i % 25 == 0 or i == len(tiles):
            log(f"  [{i}/{len(tiles)}] {succeeded} done, {skipped} skipped, {failed} failed", log_path)

    log("=" * 60, log_path)
    log(f"Reprojection complete:", log_path)
    log(f"  Succeeded: {succeeded}", log_path)
    log(f"  Skipped (already done): {skipped}", log_path)
    log(f"  Failed: {failed}", log_path)
    log(f"  Output: {out_dir}", log_path)
    log("=" * 60, log_path)

    if failed > 0:
        log(f"EXIT 1: {failed} tiles failed reprojection", log_path)
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
