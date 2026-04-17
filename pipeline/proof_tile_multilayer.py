#!/usr/bin/env python3
"""
Pipeline B - Multi-Layer Proof Tile Generator

State-agnostic. Generates a proof tile for each configured layer from the
same Z/X/Y coordinates, using a SINGLE VRT warp per tile (efficient).

Layers supported (listed in state YAML under 'layers:'):
  - hillshade  -> gdaldem multidirectional hillshade, grayscale WebP
  - svf        -> RVT-py sky_view_factor, grayscale WebP
  - rrim       -> Native Chiba 2008 implementation using RVT-py slope + openness,
                  copper/red RGB WebP

Proof tiles upload to {r2_dest_base}/proof/{layer}/{z}/{x}/{y}.webp
so they don't pollute the production path.

Usage:
    python3 proof_tile_multilayer.py --config pipeline/states/oregon.yaml
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
        "buffer_px", "webp_quality", "r2_dest", "proof_tile", "layers"
    ]
    missing = [k for k in required if k not in cfg]
    if missing:
        raise ValueError(f"Missing required config keys: {missing}")
    return cfg


def tile_to_mercator(z, x, y):
    R = 6378137.0
    n = 2 ** z
    xmin = (x / n) * 2 * math.pi * R - math.pi * R
    xmax = ((x + 1) / n) * 2 * math.pi * R - math.pi * R
    ymax = math.pi * R - (y / n) * 2 * math.pi * R
    ymin = math.pi * R - ((y + 1) / n) * 2 * math.pi * R
    return xmin, ymin, xmax, ymax


def compute_global_stats(vrt_path, stats_path, log_path, p_low=2, p_high=98):
    """Same as single-layer proof_tile.py -- histogram-based global stats."""
    log(f"Computing global stats from {vrt_path}...", log_path)
    ds = gdal.Open(vrt_path, gdal.GA_ReadOnly)
    if ds is None:
        raise RuntimeError(f"Could not open VRT: {vrt_path}")
    band = ds.GetRasterBand(1)
    xsize = band.XSize
    ysize = band.YSize

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

    n_bins = 10000
    counts = np.zeros(n_bins, dtype=np.int64)
    bin_edges = np.linspace(hist_min, hist_max, n_bins + 1)
    step = 4096
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


def warp_tile_to_3857(src_ds, cfg, z, x, y):
    """
    Warp a single tile region from state VRT into EPSG:3857 at the specified
    z/x/y. Returns (dem_array_float32, pixel_size_meters) or (None, None) if
    empty/nodata.
    """
    buffer_px = cfg["buffer_px"]
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
        return None, None

    pixel_size = (xmax - xmin) / SIZE
    return arr, pixel_size


def compute_hillshade_layer(dem_arr, pixel_size, cfg, tmp_dir, tile_id):
    """
    Use gdaldem hillshade (same as Oregon/RI). Returns 256x256 uint8.
    """
    buffer_px = cfg["buffer_px"]
    SIZE = 256 + 2 * buffer_px
    delivery_epsg = int(cfg["crs_delivery"].replace("EPSG:", ""))
    dst_srs = osr.SpatialReference()
    dst_srs.ImportFromEPSG(delivery_epsg)

    # Compute tile bounds for georeferencing the temp DEM
    # We already have dem_arr and pixel_size; fabricate a geotransform
    # centered so gdaldem can compute slopes correctly
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_dem = f"{tmp_dir}/hs_dem_{tile_id}.tif"
    tmp_hs = f"{tmp_dir}/hs_out_{tile_id}.tif"

    drv = gdal.GetDriverByName("GTiff")
    tmp_ds = drv.Create(tmp_dem, SIZE, SIZE, 1, gdal.GDT_Float32)
    # Origin at 0,0 is fine for hillshade calculation (direction-independent
    # gradients). We use multidirectional so azimuth doesn't matter.
    tmp_ds.SetGeoTransform([0, pixel_size, 0, 0, 0, -pixel_size])
    tmp_ds.SetProjection(dst_srs.ExportToWkt())
    tmp_ds.GetRasterBand(1).WriteArray(dem_arr)
    tmp_ds.FlushCache()
    tmp_ds = None

    ret = subprocess.call(
        f"gdaldem hillshade {tmp_dem} {tmp_hs} -multidirectional -z 2 -q",
        shell=True
    )
    if ret != 0:
        os.remove(tmp_dem)
        return None

    hs_ds = gdal.Open(tmp_hs)
    hs_arr = hs_ds.GetRasterBand(1).ReadAsArray().astype(np.uint8)
    hs_ds = None
    os.remove(tmp_dem)
    os.remove(tmp_hs)

    cropped = hs_arr[buffer_px:buffer_px + 256, buffer_px:buffer_px + 256]
    return cropped


def compute_svf_layer(dem_arr, pixel_size, cfg):
    """
    Compute SVF using RVT-py. Returns 256x256 uint8 grayscale.
    """
    import rvt.vis
    buffer_px = cfg["buffer_px"]

    result = rvt.vis.sky_view_factor(
        dem=dem_arr,
        resolution=pixel_size,
        compute_svf=True,
        compute_asvf=False,
        compute_opns=False,
        svf_n_dir=16,
        svf_r_max=10,
        svf_noise=0,
        no_data=None
    )
    svf = result["svf"]  # 0.0 to 1.0
    # Clip and scale to 0-255
    svf = np.clip(svf, 0, 1)
    svf_uint8 = (svf * 255).astype(np.uint8)
    cropped = svf_uint8[buffer_px:buffer_px + 256, buffer_px:buffer_px + 256]
    return cropped


def compute_rrim_layer(dem_arr, pixel_size, cfg):
    """
    Compute RRIM (Chiba 2008) using RVT-py primitives.
    Returns 256x256 uint8 RGB (copper/red color).

    Algorithm:
      1. Slope (degrees)
      2. Positive openness
      3. Negative openness (flip DEM)
      4. Differential openness = (pos - neg) / 2
      5. HSV color: H=copper, S=f(slope), V=f(diff_opns)
      6. HSV -> RGB
    """
    import rvt.vis
    buffer_px = cfg["buffer_px"]

    # Slope
    slope_result = rvt.vis.slope_aspect(
        dem=dem_arr,
        resolution_x=pixel_size,
        resolution_y=pixel_size,
        output_units="degree",
        ve_factor=1,
        no_data=None
    )
    slope_deg = slope_result["slope"]

    # Positive openness
    pos_result = rvt.vis.sky_view_factor(
        dem=dem_arr,
        resolution=pixel_size,
        compute_svf=False,
        compute_asvf=False,
        compute_opns=True,
        svf_n_dir=8,
        svf_r_max=20,
        svf_noise=0,
        no_data=None
    )
    pos_opns = pos_result["opns"]

    # Negative openness (flip DEM)
    neg_result = rvt.vis.sky_view_factor(
        dem=dem_arr * -1,
        resolution=pixel_size,
        compute_svf=False,
        compute_asvf=False,
        compute_opns=True,
        svf_n_dir=8,
        svf_r_max=20,
        svf_noise=0,
        no_data=None
    )
    neg_opns = neg_result["opns"]

    # Differential openness
    diff_opns = (pos_opns - neg_opns) / 2.0

    # Build HSV
    # Hue: copper/red range (0.02 - 0.08 = warm red-orange)
    # Saturation: slope normalized (0-60 deg mapped to 0-1)
    # Value: differential openness (-15 to +15 deg mapped to 0-1)
    slope_norm = np.clip(slope_deg / 60.0, 0, 1)
    diff_norm = np.clip((diff_opns + 15.0) / 30.0, 0.05, 1.0)

    h = np.full_like(slope_norm, 0.05, dtype=np.float32)  # copper hue
    s = slope_norm.astype(np.float32)
    v = diff_norm.astype(np.float32)

    # Vectorized HSV to RGB (standard formula, no colorsys loop)
    # Based on Wikipedia HSV to RGB conversion
    c = v * s
    hp = h * 6.0  # 0-6
    x_val = c * (1 - np.abs(hp % 2 - 1))
    zero = np.zeros_like(c)

    # For hp in [0,1), RGB = (c, x, 0) - copper is in this range
    r = np.where((hp >= 0) & (hp < 1), c,
        np.where((hp >= 1) & (hp < 2), x_val,
        np.where((hp >= 2) & (hp < 3), zero,
        np.where((hp >= 3) & (hp < 4), zero,
        np.where((hp >= 4) & (hp < 5), x_val, c)))))
    g = np.where((hp >= 0) & (hp < 1), x_val,
        np.where((hp >= 1) & (hp < 2), c,
        np.where((hp >= 2) & (hp < 3), c,
        np.where((hp >= 3) & (hp < 4), x_val,
        np.where((hp >= 4) & (hp < 5), zero, zero)))))
    b = np.where((hp >= 0) & (hp < 1), zero,
        np.where((hp >= 1) & (hp < 2), zero,
        np.where((hp >= 2) & (hp < 3), x_val,
        np.where((hp >= 3) & (hp < 4), c,
        np.where((hp >= 4) & (hp < 5), c, x_val)))))

    m = v - c
    r = r + m
    g = g + m
    b = b + m

    rgb = np.stack([r, g, b], axis=-1)
    rgb = np.clip(rgb * 255, 0, 255).astype(np.uint8)

    cropped = rgb[buffer_px:buffer_px + 256, buffer_px:buffer_px + 256]
    return cropped


def save_webp(arr, out_path, quality):
    """Save array as WebP via Pillow. Handles both grayscale and RGB."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if arr.ndim == 2:
        # Grayscale -> convert to RGB for WebP compatibility
        img = Image.fromarray(arr, mode='L').convert('RGB')
    else:
        img = Image.fromarray(arr, mode='RGB')
    img.save(out_path, 'WEBP', quality=quality)


def upload_proof(out_path, cfg, layer_name, z, x, y):
    """Upload single proof tile for a layer to R2 at proof path."""
    r2_dest = cfg["r2_dest"]
    # r2:lidar-tiles/oregon/tiles/hillshade -> r2:lidar-tiles/oregon/proof/{layer}
    r2_proof = r2_dest.replace("/tiles/hillshade", f"/proof/{layer_name}")
    r2_target = f"{r2_proof}/{z}/{x}/{y}.webp"
    log(f"  Uploading {layer_name} proof -> {r2_target}", cfg["log_path"])
    run(
        f"rclone copyto {out_path} {r2_target} --s3-no-check-bucket",
        cfg["log_path"]
    )
    bucket_path = r2_target.replace("r2:lidar-tiles/", "")
    return f"https://tiles.unworkedgold.com/{bucket_path}"


def main():
    ap = argparse.ArgumentParser(description="Pipeline B multi-layer proof tile")
    ap.add_argument("--config", required=True)
    ap.add_argument("--skip-stats", action="store_true")
    ap.add_argument("--skip-upload", action="store_true")
    args = ap.parse_args()

    cfg = load_config(args.config)
    log_path = cfg["log_path"]

    log("=" * 60, log_path)
    log(f"Pipeline B Multi-Layer Proof Tile: {cfg['state_name']}", log_path)
    log(f"Layers: {cfg['layers']}", log_path)
    log("=" * 60, log_path)

    if not os.path.exists(cfg["vrt_path"]):
        log(f"ERROR: VRT not found at {cfg['vrt_path']}", log_path)
        sys.exit(1)

    # Stats
    if args.skip_stats and os.path.exists(cfg["stats_path"]):
        with open(cfg["stats_path"]) as f:
            stats = json.load(f)
        log(f"Using existing stats: min={stats['global_min']:.2f}, max={stats['global_max']:.2f}", log_path)
    else:
        compute_global_stats(cfg["vrt_path"], cfg["stats_path"], log_path)

    # Proof tile coords
    z = cfg["proof_tile"]["z"]
    x = cfg["proof_tile"]["x"]
    y = cfg["proof_tile"]["y"]
    description = cfg["proof_tile"].get("description", "")
    log(f"Proof tile: z={z} x={x} y={y} ({description})", log_path)

    # Single warp -- reuse DEM array across all layers
    src_ds = gdal.Open(cfg["vrt_path"])
    dem_arr, pixel_size = warp_tile_to_3857(src_ds, cfg, z, x, y)
    if dem_arr is None:
        log("ERROR: Proof tile warp returned empty/nodata", log_path)
        sys.exit(1)

    tile_id = f"{z}_{x}_{y}"
    proof_urls = {}

    for layer in cfg["layers"]:
        log(f"Processing layer: {layer}", log_path)
        if layer == "hillshade":
            result = compute_hillshade_layer(dem_arr, pixel_size, cfg, cfg["tmp_dir"], tile_id)
        elif layer == "svf":
            result = compute_svf_layer(dem_arr, pixel_size, cfg)
        elif layer == "rrim":
            result = compute_rrim_layer(dem_arr, pixel_size, cfg)
        else:
            log(f"  WARNING: Unknown layer '{layer}', skipping", log_path)
            continue

        if result is None:
            log(f"  ERROR: {layer} generation failed", log_path)
            continue

        # Save locally
        local_path = f"{cfg['tiles_dir']}/../proof/{layer}/{z}/{x}/{y}.webp"
        local_path = os.path.normpath(local_path)
        save_webp(result, local_path, cfg["webp_quality"])
        log(f"  {layer}: {local_path}  (shape={result.shape}, dtype={result.dtype})", log_path)

        # Upload
        if not args.skip_upload:
            url = upload_proof(local_path, cfg, layer, z, x, y)
            proof_urls[layer] = url

    # Print review summary
    if proof_urls:
        log("", log_path)
        log("=" * 60, log_path)
        log("ALL PROOF TILES READY FOR ARCHITECT REVIEW", log_path)
        log("=" * 60, log_path)
        for layer, url in proof_urls.items():
            log(f"  {layer:10s} : {url}", log_path)
        log("", log_path)
        log("Visual checklist:", log_path)
        log("  [ ] Hillshade: grayscale terrain, no seams, ridge/gully clarity at z15", log_path)
        log("  [ ] SVF: grayscale, darker in valleys/depressions, brighter on exposed terrain", log_path)
        log("  [ ] RRIM: copper-colored, red where steep, bright on ridges, dark in pits", log_path)
        log("", log_path)
        log("On approval: touch {cfg['workdir']}/APPROVED".format(**{"cfg": cfg}), log_path)
        log("=" * 60, log_path)

    log("=== MULTI-LAYER PROOF COMPLETE ===", log_path)


if __name__ == "__main__":
    main()
