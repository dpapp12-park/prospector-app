#!/usr/bin/env python3
"""
Pipeline B - Build State Master VRT

State-agnostic VRT builder. Reads a state YAML config, runs gdalbuildvrt
across all reprojected tiles, verifies the output VRT opens cleanly and
has sensible dimensions before exiting.

Usage:
    python3 build_vrt.py --config pipeline/states/oregon.yaml
"""
import os
import sys
import glob
import argparse
import subprocess
import yaml
from osgeo import gdal


def log(msg, log_path=None):
    print(msg, flush=True)
    if log_path:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, "a") as f:
            f.write(msg + "\n")


def load_config(config_path):
    with open(config_path) as f:
        cfg = yaml.safe_load(f)
    required = ["state_name", "workdir", "vrt_path"]
    missing = [k for k in required if k not in cfg]
    if missing:
        raise ValueError(f"Missing required config keys: {missing}")
    return cfg


def main():
    ap = argparse.ArgumentParser(description="Pipeline B state-agnostic VRT builder")
    ap.add_argument("--config", required=True, help="Path to state YAML config")
    args = ap.parse_args()

    cfg = load_config(args.config)
    log_path = cfg.get("log_path", f"{cfg['workdir']}/build_vrt.log")

    # Input directory from YAML or default
    if "reprojected_dir" in cfg:
        in_dir = cfg["reprojected_dir"]
    else:
        in_dir = os.path.join(cfg["workdir"], "reprojected_5070")

    vrt_path = cfg["vrt_path"]

    log("=" * 60, log_path)
    log(f"Pipeline B VRT Build: {cfg['state_name']}", log_path)
    log(f"Input dir: {in_dir}", log_path)
    log(f"Output VRT: {vrt_path}", log_path)
    log("=" * 60, log_path)

    # Find all reprojected tiles
    tiles = sorted(glob.glob(os.path.join(in_dir, "*.tif")))
    if not tiles:
        log(f"ERROR: No .tif files found in {in_dir}", log_path)
        sys.exit(1)
    log(f"Found {len(tiles)} reprojected tiles", log_path)

    # Build VRT
    os.makedirs(os.path.dirname(vrt_path), exist_ok=True)
    cmd = ["gdalbuildvrt", vrt_path] + tiles
    log(f"Running: gdalbuildvrt {vrt_path} [{len(tiles)} tiles]", log_path)
    try:
        subprocess.check_call(cmd)
    except subprocess.CalledProcessError as e:
        log(f"ERROR: gdalbuildvrt failed: {e}", log_path)
        sys.exit(1)

    # Verify the VRT opens and has sensible properties
    if not os.path.exists(vrt_path):
        log(f"ERROR: VRT not created at {vrt_path}", log_path)
        sys.exit(1)

    ds = gdal.Open(vrt_path)
    if ds is None:
        log(f"ERROR: VRT created but cannot be opened: {vrt_path}", log_path)
        sys.exit(1)

    xsize = ds.RasterXSize
    ysize = ds.RasterYSize
    proj = ds.GetProjection()
    gt = ds.GetGeoTransform()

    log(f"VRT dimensions: {xsize} x {ysize} pixels", log_path)
    log(f"Pixel size: ({gt[1]:.4f}, {gt[5]:.4f})", log_path)
    log(f"Projection: {proj[:100]}...", log_path)

    # Sanity: pixel size should be ~1m (3DEP 1m source)
    if abs(abs(gt[1]) - 1.0) > 0.1:
        log(f"WARNING: Unexpected pixel size {gt[1]:.4f}, expected ~1.0m", log_path)

    # Check projection is the expected one
    expected_crs = cfg.get("crs_processing", "EPSG:5070")
    if expected_crs.replace("EPSG:", "") not in proj and "Conus Albers" not in proj:
        log(f"WARNING: VRT projection may not match expected {expected_crs}", log_path)

    log("VRT verified successfully", log_path)
    log("=" * 60, log_path)
    sys.exit(0)


if __name__ == "__main__":
    main()
