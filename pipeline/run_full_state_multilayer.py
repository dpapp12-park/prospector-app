#!/usr/bin/env python3
"""
Pipeline B - Multi-Layer Full State Runner

State-agnostic. Generates all configured layers (hillshade, SVF, RRIM) for
every tile in state bounds, uploading each to its own R2 path.

MANDATORY PRECONDITION: proof_tile_multilayer.py must have run successfully
AND all proof tiles must have received visual approval. This is enforced by
requiring --confirm-proof-approved flag.

Usage:
    python3 run_full_state_multilayer.py --config pipeline/states/oregon.yaml \\
        --confirm-proof-approved
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
        "webp_quality", "r2_dest", "layers"
    ]
    missing = [k for k in required if k not in cfg]
    if missing:
        raise ValueError(f"Missing required config keys: {missing}")
    return cfg


def get_vrt_lonlat_bounds(vrt_path):
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


def warp_tile_to_3857(src_ds, cfg, z, x, y):
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


def _hillshade(dem_arr, pixel_size, cfg, tile_id):
    buffer_px = cfg["buffer_px"]
    SIZE = 256 + 2 * buffer_px
    delivery_epsg = int(cfg["crs_delivery"].replace("EPSG:", ""))
    dst_srs = osr.SpatialReference()
    dst_srs.ImportFromEPSG(delivery_epsg)
    tmp_dir = cfg["tmp_dir"]
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_dem = f"{tmp_dir}/hs_dem_{tile_id}.tif"
    tmp_hs = f"{tmp_dir}/hs_out_{tile_id}.tif"

    drv = gdal.GetDriverByName("GTiff")
    tmp_ds = drv.Create(tmp_dem, SIZE, SIZE, 1, gdal.GDT_Float32)
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

    return hs_arr[buffer_px:buffer_px + 256, buffer_px:buffer_px + 256]


def _svf(dem_arr, pixel_size, cfg):
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
    svf = np.clip(result["svf"], 0, 1)
    svf_u8 = (svf * 255).astype(np.uint8)
    return svf_u8[buffer_px:buffer_px + 256, buffer_px:buffer_px + 256]


def _rrim(dem_arr, pixel_size, cfg):
    import rvt.vis
    buffer_px = cfg["buffer_px"]

    slope_result = rvt.vis.slope_aspect(
        dem=dem_arr, resolution_x=pixel_size, resolution_y=pixel_size,
        output_units="degree", ve_factor=1, no_data=None
    )
    slope_deg = slope_result["slope"]

    pos = rvt.vis.sky_view_factor(
        dem=dem_arr, resolution=pixel_size,
        compute_svf=False, compute_asvf=False, compute_opns=True,
        svf_n_dir=8, svf_r_max=20, svf_noise=0, no_data=None
    )["opns"]
    neg = rvt.vis.sky_view_factor(
        dem=dem_arr * -1, resolution=pixel_size,
        compute_svf=False, compute_asvf=False, compute_opns=True,
        svf_n_dir=8, svf_r_max=20, svf_noise=0, no_data=None
    )["opns"]
    diff_opns = (pos - neg) / 2.0

    slope_norm = np.clip(slope_deg / 60.0, 0, 1)
    diff_norm = np.clip((diff_opns + 15.0) / 30.0, 0.05, 1.0)

    h = np.full_like(slope_norm, 0.05, dtype=np.float32)
    s = slope_norm.astype(np.float32)
    v = diff_norm.astype(np.float32)

    c = v * s
    hp = h * 6.0
    x_val = c * (1 - np.abs(hp % 2 - 1))
    zero = np.zeros_like(c)

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
    r += m
    g += m
    b += m

    rgb = np.stack([r, g, b], axis=-1)
    rgb = np.clip(rgb * 255, 0, 255).astype(np.uint8)
    return rgb[buffer_px:buffer_px + 256, buffer_px:buffer_px + 256]


LAYER_FUNCS = {
    "hillshade": _hillshade,
    "svf": _svf,
    "rrim": _rrim,
}


def save_webp(arr, out_path, quality):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if arr.ndim == 2:
        img = Image.fromarray(arr, mode='L').convert('RGB')
    else:
        img = Image.fromarray(arr, mode='RGB')
    img.save(out_path, 'WEBP', quality=quality)


def generate_tiles(cfg):
    log_path = cfg["log_path"]
    layers = cfg["layers"]
    # Base tiles dir is cfg["tiles_dir"] which ends in /hillshade.
    # For multi-layer, write each to {parent}/{layer}/{z}/{x}/{y}.webp
    base_dir = os.path.dirname(cfg["tiles_dir"].rstrip("/"))
    zoom_min = cfg["zoom_min"]
    zoom_max = cfg["zoom_max"]
    quality = cfg["webp_quality"]

    lon_min, lat_min, lon_max, lat_max = get_vrt_lonlat_bounds(cfg["vrt_path"])
    log(f"VRT bounds: lon {lon_min:.3f}-{lon_max:.3f}, lat {lat_min:.3f}-{lat_max:.3f}", log_path)
    log(f"Layers to generate: {layers}", log_path)
    log(f"Base tiles dir: {base_dir}", log_path)

    src_ds = gdal.Open(cfg["vrt_path"])

    counts = {layer: {"written": 0, "skipped": 0} for layer in layers}

    for z in range(zoom_min, zoom_max + 1):
        x0, y1 = lonlat_to_tile(lon_min, lat_min, z)
        x1, y0 = lonlat_to_tile(lon_max, lat_max, z)
        candidates = (x1 - x0 + 1) * (y1 - y0 + 1)
        log(f"Z{z}: {candidates} candidate tiles", log_path)

        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                # Check if ALL layers already exist for this tile -- skip warp if so
                all_exist = all(
                    os.path.exists(f"{base_dir}/{layer}/{z}/{x}/{y}.webp")
                    for layer in layers
                )
                if all_exist:
                    for layer in layers:
                        counts[layer]["skipped"] += 1
                    continue

                # Warp once, reuse across all layers
                dem_arr, pixel_size = warp_tile_to_3857(src_ds, cfg, z, x, y)
                if dem_arr is None:
                    for layer in layers:
                        counts[layer]["skipped"] += 1
                    continue

                tile_id = f"{z}_{x}_{y}"
                for layer in layers:
                    out_path = f"{base_dir}/{layer}/{z}/{x}/{y}.webp"
                    if os.path.exists(out_path):
                        counts[layer]["skipped"] += 1
                        continue
                    func = LAYER_FUNCS.get(layer)
                    if func is None:
                        continue
                    try:
                        result = func(dem_arr, pixel_size, cfg) if layer == "svf" or layer == "rrim" \
                            else func(dem_arr, pixel_size, cfg, tile_id)
                    except Exception as e:
                        log(f"  {layer} {z}/{x}/{y} failed: {e}", log_path)
                        counts[layer]["skipped"] += 1
                        continue
                    if result is None:
                        counts[layer]["skipped"] += 1
                        continue
                    save_webp(result, out_path, quality)
                    counts[layer]["written"] += 1

                total_written = sum(c["written"] for c in counts.values())
                if total_written > 0 and total_written % 500 == 0:
                    log(f"  Progress: {counts}", log_path)

    log(f"Tile generation complete: {counts}", log_path)
    return counts


def upload_layers(cfg):
    log_path = cfg["log_path"]
    layers = cfg["layers"]
    r2_dest = cfg["r2_dest"]  # ends in /hillshade; use as template for other layers
    base_dir = os.path.dirname(cfg["tiles_dir"].rstrip("/"))
    r2_base = os.path.dirname(r2_dest.rstrip("/"))

    for layer in layers:
        local = f"{base_dir}/{layer}/"
        remote = f"{r2_base}/{layer}/"
        if not os.path.isdir(local):
            log(f"  WARNING: No local tiles dir for {layer}: {local}", log_path)
            continue
        log(f"Uploading {layer} -> {remote}", log_path)
        run(
            f"rclone copy {local} {remote} --progress --s3-no-check-bucket --transfers 16",
            log_path
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--skip-upload", action="store_true")
    ap.add_argument("--confirm-proof-approved", action="store_true", required=True,
                    help="MANDATORY: confirms proof tiles received visual approval")
    args = ap.parse_args()

    cfg = load_config(args.config)
    log_path = cfg["log_path"]

    log("=" * 60, log_path)
    log(f"Pipeline B Full State Multi-Layer Run: {cfg['state_name']}", log_path)
    log(f"Layers: {cfg['layers']}", log_path)
    log("=" * 60, log_path)

    if not os.path.exists(cfg["vrt_path"]):
        log(f"ERROR: VRT not found at {cfg['vrt_path']}", log_path)
        sys.exit(1)
    if not os.path.exists(cfg["stats_path"]):
        log(f"ERROR: Global stats not found at {cfg['stats_path']}. "
            f"Run proof_tile_multilayer.py first.", log_path)
        sys.exit(1)

    counts = generate_tiles(cfg)

    if not args.skip_upload:
        upload_layers(cfg)

    total_written = sum(c["written"] for c in counts.values())
    log(f"=== FULL STATE MULTI-LAYER COMPLETE: {cfg['state_name']} ===", log_path)
    log(f"Total tiles written across all layers: {total_written}", log_path)


if __name__ == "__main__":
    main()
