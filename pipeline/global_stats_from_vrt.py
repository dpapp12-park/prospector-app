#!/usr/bin/env python3
import json
import argparse
import numpy as np
from osgeo import gdal

def compute_percentiles(vrt_path, p_low=2, p_high=98):
    ds = gdal.Open(vrt_path, gdal.GA_ReadOnly)
    band = ds.GetRasterBand(1)
    xsize = band.XSize
    ysize = band.YSize

    # Build histogram in chunks — never loads full dataset
    hist_min, hist_max = 1e10, -1e10

    # First pass: find actual min/max with coarse sampling
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

    # Second pass: build histogram
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

    # Compute percentiles from histogram
    total = counts.sum()
    cumsum = np.cumsum(counts)
    low_idx  = np.searchsorted(cumsum, total * p_low  / 100)
    high_idx = np.searchsorted(cumsum, total * p_high / 100)
    low  = float(bin_edges[low_idx])
    high = float(bin_edges[high_idx])
    return low, high

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vrt", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    low, high = compute_percentiles(args.vrt)
    with open(args.out, "w") as f:
        json.dump({"global_min": low, "global_max": high}, f, indent=2)
    print(f"global_min={low}, global_max={high}")

if __name__ == "__main__":
    main()
