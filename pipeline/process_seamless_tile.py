#!/usr/bin/env python3
import json
import argparse
import math
import os
import numpy as np
from osgeo import gdal, osr

BUFFER_PX = 100

def tile_to_mercator_bounds(z, x, y):
    R = 6378137.0
    n = 2 ** z
    xmin = (x / n) * 2 * math.pi * R - math.pi * R
    xmax = ((x + 1) / n) * 2 * math.pi * R - math.pi * R
    ymax = math.pi * R - (y / n) * 2 * math.pi * R
    ymin = math.pi * R - ((y + 1) / n) * 2 * math.pi * R
    return xmin, ymin, xmax, ymax

def normalize(arr, vmin, vmax):
    arr = np.clip(arr, vmin, vmax)
    return (arr - vmin) / (vmax - vmin + 1e-6)

def process_tile(vrt_path, z, x, y, global_min, global_max, out_path):
    xmin, ymin, xmax, ymax = tile_to_mercator_bounds(z, x, y)
    src = gdal.Open(vrt_path, gdal.GA_ReadOnly)
    dst_srs = osr.SpatialReference()
    dst_srs.ImportFromEPSG(3857)
    tile_size = 256
    out_size = tile_size + 2 * BUFFER_PX
    warp_opts = gdal.WarpOptions(
        format="GTiff",
        dstSRS=dst_srs.ExportToWkt(),
        outputBounds=[xmin, ymin, xmax, ymax],
        width=out_size,
        height=out_size,
        resampleAlg=gdal.GRA_Bilinear
    )
    tmp_tif = out_path + ".tmp.tif"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    warped = gdal.Warp(tmp_tif, src, options=warp_opts)
    arr = warped.GetRasterBand(1).ReadAsArray().astype(np.float32)
    warped = None

    norm = normalize(arr, global_min, global_max)
    styled = (norm * 255).astype(np.uint8)
    cropped = styled[BUFFER_PX:BUFFER_PX+tile_size, BUFFER_PX:BUFFER_PX+tile_size]

    tmp_rgb = out_path + ".tmp_rgb.tif"
    driver = gdal.GetDriverByName("GTiff")
    rgb_ds = driver.Create(tmp_rgb, tile_size, tile_size, 3, gdal.GDT_Byte)
    rgb_ds.GetRasterBand(1).WriteArray(cropped)
    rgb_ds.GetRasterBand(2).WriteArray(cropped)
    rgb_ds.GetRasterBand(3).WriteArray(cropped)
    rgb_ds.FlushCache()

    webp_driver = gdal.GetDriverByName("WEBP")
    webp_driver.CreateCopy(out_path, rgb_ds, options=["QUALITY=90"])
    rgb_ds = None

    os.remove(tmp_tif)
    os.remove(tmp_rgb)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vrt", required=True)
    ap.add_argument("--z", type=int, required=True)
    ap.add_argument("--x", type=int, required=True)
    ap.add_argument("--y", type=int, required=True)
    ap.add_argument("--stats", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    with open(args.stats) as f:
        stats = json.load(f)
    process_tile(
        vrt_path=args.vrt,
        z=args.z,
        x=args.x,
        y=args.y,
        global_min=stats["global_min"],
        global_max=stats["global_max"],
        out_path=args.out
    )
    print("Done:", args.out)

if __name__ == "__main__":
    main()
