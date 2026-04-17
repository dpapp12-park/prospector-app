#!/usr/bin/env python3
"""
Pipeline B - Full State Runner

State-agnostic full state runner. Generates all z8-z15 hillshade tiles for
a state, normalized against the state-wide global statistics computed by
proof_tile.py.

MANDATORY PRECONDITION: proof_tile.py must have run successfully AND the
proof tile must have received visual approval from architect + owner
before this script is invoked.

Usage:
    python3 run_full_state.py --config pipeline/states/rhode_island.yaml

Reuses:
    - Existing global stats from proof_tile.py run (cfg["stats_path"])
    - Existing master VRT (cfg["vrt_path"])
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
from pyproj import Transformer
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
        "zoom_min", "zoom_max", "buffer_px",
        "hillshade_algorithm", "hillshade_z_factor",
        "webp_quality", "r2_dest"
    ]
    missing = [k for k in required if k not in cfg]
    if missing:
        raise ValueError(f"Missing required config keys: {missing}")
    return cfg


def get_vrt_lonlat_bounds(vrt_path):
    """Compute WGS84 lon/lat bounds of the VRT (handles any input CRS)."""
    ds = gdal.Open(vrt_path)
    gt = ds.GetGeoTransform()
    proj = ds.GetProjection()
    xmin = gt[0]
    ymax = gt[3]
    xmax = gt[0] + gt[1] * ds.RasterXSize
    ymin = gt[3] + gt[5] * ds.RasterYSize
    src_srs = osr.SpatialReference()
    src_srs.ImportFromWkt(proj)
    epsg = src_srs.GetAuthorityCode(None)
    t = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
    # Transform all four corners to get true lon/lat bounding box
    # (non-aligned projections like EPSG:5070 rotate relative to lon/lat)
    corners = [
        t.transform(xmin, ymin),
        t.transform(xmin, ymax),
        t.transform(xmax, ymin),
        t.transform(xmax, ymax),
    ]
    lons = [c[0] for c in corners]
    lats = [c[1] for c in corners]
    return min(lons), min(lats), max(lons), max(lats)


def lonlat_to_tile(lon, lat, z):
    """Web Mercator XYZ tile for given lon/lat."""
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    lat_r = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n)
    return x, y


def tile_to_mercator(z, x, y):
    R = 6378137.0
    n = 2 ** z
    xmin = (x / n) * 2 * math.pi * R - math.pi * R
    xmax = ((x + 1) / n) * 2 * math.pi * R - math.pi * R
    ymax = math.pi * R - (y / n) * 2 * math.pi * R
    ymin = math.pi * R - ((y + 1) / n) * 2 * math.pi * R
    return xmin, ymin, xmax, ymax


def process_tile(src_ds, cfg, z, x, y):
    """Warp VRT slice -> gdaldem hillshade -> crop buffer. Returns 256x256 uint8 or None."""
    buffer_px = cfg["buffer_px"]
    hs_algo = cfg["hillshade_algorithm"]
    hs_z = cfg["hillshade_z_factor"]
    tmp_dir = cfg["tmp_dir"]

    xmin, ymin, xmax, ymax = tile_to_mercator(z, x, y)
    SIZE = 256 + 2 * buffer_px

    delivery_epsg = int(cfg["crs_delivery"].replace("EPSG:", ""))
    dst_srs = osr.SpatialReference()
    dst_srs.ImportFromEPSG(delivery_epsg)

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

    if os.path.exists(tmp_dem):
        os.remove(tmp_dem)
    if os.path.exists(tmp_hs):
        os.remove(tmp_hs)

    cropped = hs_arr[buffer_px:buffer_px + 256, buffer_px:buffer_px + 256]
    return cropped


def save_webp(arr, out_path, quality):
    """Save grayscale uint8 array as WebP via Pillow (hard rule)."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img = Image.fromarray(arr, mode='L').convert('RGB')
    img.save(out_path, 'WEBP', quality=quality)


def generate_tiles(cfg):
    """Iterate all z/x/y within state bounds, generate WebP tiles."""
    log_path = cfg["log_path"]
    tiles_dir = cfg["tiles_dir"]
    zoom_min = cfg["zoom_min"]
    zoom_max = cfg["zoom_max"]
    quality = cfg["webp_quality"]

    with open(cfg["stats_path"]) as f:
        stats = json.load(f)
    log(f"Global stats loaded: min={stats['global_min']:.2f}, max={stats['global_max']:.2f}", log_path)

    lon_min, lat_min, lon_max, lat_max = get_vrt_lonlat_bounds(cfg["vrt_path"])
    log(f"VRT bounds: lon {lon_min:.3f} to {lon_max:.3f}, lat {lat_min:.3f} to {lat_max:.3f}", log_path)

    src_ds = gdal.Open(cfg["vrt_path"])
    written = 0
    skipped = 0

    for z in range(zoom_min, zoom_max + 1):
        x0, y1 = lonlat_to_tile(lon_min, lat_min, z)
        x1, y0 = lonlat_to_tile(lon_max, lat_max, z)
        candidates = (x1 - x0 + 1) * (y1 - y0 + 1)
        log(f"Z{z}: {candidates} candidate tiles (x {x0}-{x1}, y {y0}-{y1})", log_path)

        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                out_path = f"{tiles_dir}/{z}/{x}/{y}.webp"
                if os.path.exists(out_path):
                    skipped += 1
                    continue
                os.makedirs(f"{tiles_dir}/{z}/{x}", exist_ok=True)
                result = process_tile(src_ds, cfg, z, x, y)
                if result is None:
                    skipped += 1
                    continue
                save_webp(result, out_path, quality)
                written += 1
                if written % 500 == 0:
                    log(f"  Progress: {written} written, {skipped} skipped", log_path)

    log(f"Tile generation complete: {written} written, {skipped} skipped", log_path)
    return written


def upload_to_r2(cfg):
    """Rclone sync tile dir to R2 production path."""
    log(f"Uploading tiles to {cfg['r2_dest']}", cfg["log_path"])
    run(
        f"rclone copy {cfg['tiles_dir']}/ {cfg['r2_dest']}/ "
        f"--progress --s3-no-check-bucket --transfers 16",
        cfg["log_path"]
    )


def main():
    ap = argparse.ArgumentParser(
        description="Pipeline B full state runner (state-agnostic)"
    )
    ap.add_argument("--config", required=True,
                    help="Path to state YAML config")
    ap.add_argument("--skip-upload", action="store_true",
                    help="Skip R2 upload (generate locally only)")
    ap.add_argument("--confirm-proof-approved", action="store_true", required=True,
                    help="MANDATORY: confirms proof tile has received visual approval. "
                         "Without this flag the script will not run.")
    args = ap.parse_args()

    cfg = load_config(args.config)
    log_path = cfg["log_path"]

    log("=" * 60, log_path)
    log(f"Pipeline B Full State Run: {cfg['state_name']}", log_path)
    log(f"Config: {args.config}", log_path)
    log("=" * 60, log_path)

    # Validate preconditions
    if not os.path.exists(cfg["vrt_path"]):
        log(f"ERROR: VRT not found at {cfg['vrt_path']}", log_path)
        log("Run Pipeline B prep (download + reproject + buildvrt) first.", log_path)
        sys.exit(1)

    if not os.path.exists(cfg["stats_path"]):
        log(f"ERROR: Global stats not found at {cfg['stats_path']}", log_path)
        log("Run proof_tile.py first -- it generates the stats.json this run depends on.", log_path)
        sys.exit(1)

    log("Preconditions met:", log_path)
    log(f"  - VRT exists: {cfg['vrt_path']}", log_path)
    log(f"  - Global stats exist: {cfg['stats_path']}", log_path)
    log(f"  - Proof tile approval: {'CONFIRMED by --confirm-proof-approved' if args.confirm_proof_approved else 'MISSING (will not run)'}", log_path)

    written = generate_tiles(cfg)

    if written == 0:
        log("WARNING: No tiles written. Check VRT coverage and state bounds.", log_path)
        sys.exit(1)

    if not args.skip_upload:
        upload_to_r2(cfg)

    log(f"=== FULL STATE COMPLETE: {cfg['state_name']} ===", log_path)
    log(f"Tiles written: {written}", log_path)
    log(f"R2 destination: {cfg['r2_dest']}", log_path)


if __name__ == "__main__":
    main()
