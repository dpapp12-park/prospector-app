#!/usr/bin/env python3
"""
Pipeline B - Proof Tile Generator

State-agnostic single-tile proof script. Validates that the full pipeline
(VRT -> global stats -> hillshade -> normalize -> Pillow WebP) works end-to-end
on one curated tile before committing compute to a full state run.

MANDATORY GATE: No full state run may proceed without visual approval of the
proof tile output.

Usage:
    python3 proof_tile.py --config pipeline/states/rhode_island.yaml

Output:
    Single WebP tile at {tiles_dir}/{z}/{x}/{y}.webp
    Also uploads to R2 at proof path: {r2_dest}/proof/{z}/{x}/{y}.webp
    Also computes and saves {stats_path} (reused by run_full_state.py)
"""
import os
import sys
import json
import math
import argparse
import subprocess
import yaml
import numpy as np
from osgeo import gdal, osr
from PIL import Image


def log(msg, log_path=None):
    print(msg, flush=True)
    if log_path:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, "a") as f:
            f.write(msg + "\n")


def run(cmd, log_path=None):
    log(f">> {cmd}", log_path)
    subprocess.check_call(cmd, shell=True)


def load_config(config_path):
    with open(config_path) as f:
        cfg = yaml.safe_load(f)
    required = [
        "state_name", "workdir", "vrt_path", "stats_path",
        "tiles_dir", "tmp_dir", "log_path", "crs_delivery",
        "buffer_px", "hillshade_algorithm", "hillshade_z_factor",
        "webp_quality", "r2_dest", "proof_tile"
    ]
    missing = [k for k in required if k not in cfg]
    if missing:
        raise ValueError(f"Missing required config keys: {missing}")
    proof_required = ["z", "x", "y"]
    missing_proof = [k for k in proof_required if k not in cfg["proof_tile"]]
    if missing_proof:
        raise ValueError(f"proof_tile missing keys: {missing_proof}")
    return cfg


def tile_to_mercator(z, x, y):
    """Convert XYZ tile coords to EPSG:3857 bounds."""
    R = 6378137.0
    n = 2 ** z
    xmin = (x / n) * 2 * math.pi * R - math.pi * R
    xmax = ((x + 1) / n) * 2 * math.pi * R - math.pi * R
    ymax = math.pi * R - (y / n) * 2 * math.pi * R
    ymin = math.pi * R - ((y + 1) / n) * 2 * math.pi * R
    return xmin, ymin, xmax, ymax


def compute_global_stats(vrt_path, stats_path, log_path, p_low=2, p_high=98):
    """
    Compute global 2nd/98th percentile across full state VRT.
    Uses histogram method -- never loads full dataset into memory.
    """
    log(f"Computing global stats from {vrt_path}...", log_path)
    ds = gdal.Open(vrt_path, gdal.GA_ReadOnly)
    if ds is None:
        raise RuntimeError(f"Could not open VRT: {vrt_path}")
    band = ds.GetRasterBand(1)
    xsize = band.XSize
    ysize = band.YSize
    log(f"VRT size: {xsize} x {ysize}", log_path)

    # First pass: coarse min/max scan
    hist_min, hist_max = 1e10, -1e10
    step = 8192
    for y in range(0, ysize, step):
        rows = min(step, ysize - y)
        data = band.ReadAsArray(0, y, xsize, rows)
        if data is None:
            continue
        data = data.astype(np.float32)
        data = data[np.isfinite(data) & (data > -9000)]
        if data.size == 0:
            continue
        hist_min = min(hist_min, float(data.min()))
        hist_max = max(hist_max, float(data.max()))
    log(f"Coarse range: {hist_min:.2f} to {hist_max:.2f}", log_path)

    # Second pass: build histogram with sampling
    n_bins = 10000
    counts = np.zeros(n_bins, dtype=np.int64)
    bin_edges = np.linspace(hist_min, hist_max, n_bins + 1)
    step = 4096  # Sample step -- proven for large VRTs (per April 16 brief)
    for y in range(0, ysize, step):
        rows = min(step, ysize - y)
        data = band.ReadAsArray(0, y, xsize, rows)
        if data is None:
            continue
        data = data.astype(np.float32).ravel()
        data = data[np.isfinite(data) & (data > -9000)]
        if data.size == 0:
            continue
        c, _ = np.histogram(data, bins=bin_edges)
        counts += c

    # Percentiles from cumulative histogram
    total = counts.sum()
    cumsum = np.cumsum(counts)
    low_idx = np.searchsorted(cumsum, total * p_low / 100)
    high_idx = np.searchsorted(cumsum, total * p_high / 100)
    low = float(bin_edges[low_idx])
    high = float(bin_edges[high_idx])

    os.makedirs(os.path.dirname(stats_path), exist_ok=True)
    with open(stats_path, "w") as f:
        json.dump({"global_min": low, "global_max": high}, f, indent=2)
    log(f"Global stats: min={low:.2f}, max={high:.2f} -> {stats_path}", log_path)
    return low, high


def process_tile(src_ds, cfg, z, x, y):
    """
    Warp VRT slice to tile bounds (3857), compute hillshade via gdaldem,
    crop buffer, return 256x256 uint8 array (grayscale hillshade).
    Returns None if tile is empty/nodata.
    """
    buffer_px = cfg["buffer_px"]
    hs_algo = cfg["hillshade_algorithm"]
    hs_z = cfg["hillshade_z_factor"]
    tmp_dir = cfg["tmp_dir"]

    xmin, ymin, xmax, ymax = tile_to_mercator(z, x, y)
    SIZE = 256 + 2 * buffer_px

    # Parse delivery CRS
    delivery_epsg = int(cfg["crs_delivery"].replace("EPSG:", ""))
    dst_srs = osr.SpatialReference()
    dst_srs.ImportFromEPSG(delivery_epsg)

    # Warp VRT slice into memory-backed dataset
    warped = gdal.Warp(
        "", src_ds, format="MEM",
        dstSRS=dst_srs.ExportToWkt(),
        outputBounds=[xmin, ymin, xmax, ymax],
        width=SIZE, height=SIZE,
        resampleAlg=gdal.GRA_Bilinear
    )
    arr = warped.GetRasterBand(1).ReadAsArray().astype(np.float32)
    if arr is None or (arr.max() - arr.min()) < 0.1:
        return None

    # Write warped DEM to temp file for gdaldem
    pixel_size = (xmax - xmin) / SIZE
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_dem = f"{tmp_dir}/dem_{z}_{x}_{y}.tif"
    tmp_hs = f"{tmp_dir}/hs_{z}_{x}_{y}.tif"

    drv = gdal.GetDriverByName("GTiff")
    tmp_ds = drv.Create(tmp_dem, SIZE, SIZE, 1, gdal.GDT_Float32)
    tmp_ds.SetGeoTransform([xmin, pixel_size, 0, ymax, 0, -pixel_size])
    tmp_ds.SetProjection(dst_srs.ExportToWkt())
    tmp_ds.GetRasterBand(1).WriteArray(arr)
    tmp_ds.FlushCache()
    tmp_ds = None

    # Run gdaldem hillshade
    hs_flag = "-multidirectional" if hs_algo == "multidirectional" else ""
    ret = subprocess.call(
        f"gdaldem hillshade {tmp_dem} {tmp_hs} {hs_flag} -z {hs_z} -q",
        shell=True
    )
    if ret != 0:
        if os.path.exists(tmp_dem):
            os.remove(tmp_dem)
        return None

    hs_ds = gdal.Open(tmp_hs)
    hs_arr = hs_ds.GetRasterBand(1).ReadAsArray().astype(np.uint8)
    hs_ds = None

    # Cleanup
    if os.path.exists(tmp_dem):
        os.remove(tmp_dem)
    if os.path.exists(tmp_hs):
        os.remove(tmp_hs)

    # Crop buffer -- return 256x256 center
    cropped = hs_arr[buffer_px:buffer_px + 256, buffer_px:buffer_px + 256]
    return cropped


def save_webp(arr, out_path, quality):
    """Save uint8 grayscale array as WebP via Pillow (hard rule: Pillow only)."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img = Image.fromarray(arr, mode='L').convert('RGB')
    img.save(out_path, 'WEBP', quality=quality)


def upload_proof_tile(out_path, cfg, z, x, y):
    """Upload single proof tile to R2 at proof path for visual review."""
    # Proof tiles go to {r2_dest}/proof/{z}/{x}/{y}.webp so we can review
    # on the live map without polluting the production path
    r2_dest = cfg["r2_dest"]
    # Trim trailing slash, replace /hillshade with /proof/hillshade for clarity
    # e.g. r2:lidar-tiles/rhode_island/tiles/hillshade
    #   -> r2:lidar-tiles/rhode_island/proof/hillshade
    r2_proof = r2_dest.replace("/tiles/hillshade", "/proof/hillshade")
    r2_target = f"{r2_proof}/{z}/{x}/{y}.webp"
    log(f"Uploading proof tile to {r2_target}", cfg["log_path"])
    run(
        f"rclone copyto {out_path} {r2_target} "
        f"--s3-no-check-bucket",
        cfg["log_path"]
    )
    # Also print the public URL so you can verify in browser
    # Assumes r2_dest format: r2:lidar-tiles/{state}/...
    bucket_path = r2_target.replace("r2:lidar-tiles/", "")
    public_url = f"https://tiles.unworkedgold.com/{bucket_path}"
    log(f"Proof tile public URL: {public_url}", cfg["log_path"])
    return public_url


def main():
    ap = argparse.ArgumentParser(
        description="Pipeline B proof tile generator (state-agnostic)"
    )
    ap.add_argument("--config", required=True,
                    help="Path to state YAML config (e.g. pipeline/states/rhode_island.yaml)")
    ap.add_argument("--skip-stats", action="store_true",
                    help="Skip global stats computation (use existing stats.json)")
    ap.add_argument("--skip-upload", action="store_true",
                    help="Skip R2 upload (generate locally only)")
    args = ap.parse_args()

    cfg = load_config(args.config)
    log_path = cfg["log_path"]

    log("=" * 60, log_path)
    log(f"Pipeline B Proof Tile: {cfg['state_name']}", log_path)
    log(f"Config: {args.config}", log_path)
    log("=" * 60, log_path)

    # Ensure VRT exists
    if not os.path.exists(cfg["vrt_path"]):
        log(f"ERROR: VRT not found at {cfg['vrt_path']}", log_path)
        sys.exit(1)

    # Compute or load global stats
    if args.skip_stats and os.path.exists(cfg["stats_path"]):
        log(f"Using existing stats: {cfg['stats_path']}", log_path)
        with open(cfg["stats_path"]) as f:
            stats = json.load(f)
        log(f"  global_min={stats['global_min']:.2f}, global_max={stats['global_max']:.2f}", log_path)
    else:
        compute_global_stats(cfg["vrt_path"], cfg["stats_path"], log_path)

    # Process the proof tile
    z = cfg["proof_tile"]["z"]
    x = cfg["proof_tile"]["x"]
    y = cfg["proof_tile"]["y"]
    description = cfg["proof_tile"].get("description", "")
    log(f"Processing proof tile z={z} x={x} y={y} ({description})", log_path)

    src_ds = gdal.Open(cfg["vrt_path"])
    result = process_tile(src_ds, cfg, z, x, y)
    if result is None:
        log("ERROR: Proof tile returned empty/nodata. Check coordinates.", log_path)
        sys.exit(1)

    # Save locally
    out_path = f"{cfg['tiles_dir']}/{z}/{x}/{y}.webp"
    save_webp(result, out_path, cfg["webp_quality"])
    log(f"Proof tile written: {out_path}", log_path)
    log(f"  Min pixel value: {result.min()}", log_path)
    log(f"  Max pixel value: {result.max()}", log_path)
    log(f"  Mean pixel value: {result.mean():.1f}", log_path)

    # Upload to R2 at proof path for visual review
    if not args.skip_upload:
        url = upload_proof_tile(out_path, cfg, z, x, y)
        log("", log_path)
        log("=" * 60, log_path)
        log("PROOF TILE READY FOR VISUAL REVIEW", log_path)
        log(f"URL: {url}", log_path)
        log("=" * 60, log_path)
        log("Visual checklist (per Production Work Order):", log_path)
        log("  [ ] No visible seams at tile boundaries", log_path)
        log("  [ ] GPS alignment: tile matches 3857 satellite overlay", log_path)
        log(f"  [ ] Color: Consistent 'Copper' across {description}", log_path)
        log("  [ ] Ridge/gully clarity at z15", log_path)
        log("Awaiting architect + owner approval before full state run.", log_path)
    else:
        log(f"Local proof tile ready at: {out_path}", log_path)

    log("=== PROOF TILE COMPLETE ===", log_path)


if __name__ == "__main__":
    main()
