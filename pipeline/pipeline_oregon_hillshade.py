#!/usr/bin/env python3
"""
Pipeline B - Full Oregon Hillshade
Steps: download -> vrt -> stats -> tiles -> upload
Run: python3 ~/pipeline_oregon_hillshade.py
"""
import os, sys, json, math, subprocess, glob
import numpy as np
from osgeo import gdal, osr
from pyproj import Transformer
from PIL import Image

WORK_DIR   = "/mnt/nvme1/oregon"
RAW_DIR    = f"{WORK_DIR}/raw"
TILES_DIR  = f"{WORK_DIR}/tiles/hillshade"
TMP_DIR    = f"{WORK_DIR}/tmp"
VRT_PATH   = f"{WORK_DIR}/oregon.vrt"
STATS_PATH = f"{WORK_DIR}/stats.json"
LOG_PATH   = f"{WORK_DIR}/progress.log"
ZOOM_MIN   = 8
ZOOM_MAX   = 15
BUFFER_PX  = 100
R2_DEST    = "r2:lidar-tiles/oregon/tiles/hillshade"
PROJECT    = "OR_NRCSUSGS_2019_D19"

def log(msg):
    print(msg, flush=True)
    with open(LOG_PATH, "a") as f:
        f.write(msg + "\n")

def run(cmd):
    log(f">> {cmd}")
    subprocess.check_call(cmd, shell=True)

def download():
    os.makedirs(RAW_DIR, exist_ok=True)
    log(f"Downloading {PROJECT}...")
    run(f"aws s3 sync s3://prd-tnm/StagedProducts/Elevation/1m/Projects/{PROJECT}/TIFF/ "
        f"{RAW_DIR}/ --no-sign-request --exclude '*' --include '*.tif'")
    tifs = glob.glob(f"{RAW_DIR}/*.tif")
    log(f"Downloaded {len(tifs)} tiles")

def build_vrt():
    tifs = glob.glob(f"{RAW_DIR}/*.tif")
    log(f"Building VRT from {len(tifs)} tiles...")
    run(f"gdalbuildvrt {VRT_PATH} {RAW_DIR}/*.tif")
    log("VRT built")

def compute_stats():
    run(f"python3 ~/global_stats_from_vrt.py --vrt {VRT_PATH} --out {STATS_PATH}")

def get_vrt_lonlat_bounds():
    ds = gdal.Open(VRT_PATH)
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
    lon_min, lat_min = t.transform(xmin, ymin)
    lon_max, lat_max = t.transform(xmax, ymax)
    return lon_min, lat_min, lon_max, lat_max

def lonlat_to_tile(lon, lat, z):
    n = 2**z
    x = int((lon + 180) / 360 * n)
    lat_r = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_r) + 1/math.cos(lat_r)) / math.pi) / 2 * n)
    return x, y

def tile_to_mercator(z, x, y):
    R = 6378137.0
    n = 2**z
    xmin = (x/n)*2*math.pi*R - math.pi*R
    xmax = ((x+1)/n)*2*math.pi*R - math.pi*R
    ymax = math.pi*R - (y/n)*2*math.pi*R
    ymin = math.pi*R - ((y+1)/n)*2*math.pi*R
    return xmin, ymin, xmax, ymax

def process_tile(src_ds, z, x, y):
    xmin, ymin, xmax, ymax = tile_to_mercator(z, x, y)
    SIZE = 256 + 2 * BUFFER_PX
    dst_srs = osr.SpatialReference()
    dst_srs.ImportFromEPSG(3857)

    warped = gdal.Warp("", src_ds, format="MEM",
        dstSRS=dst_srs.ExportToWkt(),
        outputBounds=[xmin, ymin, xmax, ymax],
        width=SIZE, height=SIZE,
        resampleAlg=gdal.GRA_Bilinear)

    arr = warped.GetRasterBand(1).ReadAsArray().astype(np.float32)
    if arr is None or (arr.max() - arr.min()) < 0.1:
        return None

    pixel_size = (xmax - xmin) / SIZE
    tmp_dem = f"{TMP_DIR}/dem_{z}_{x}_{y}.tif"
    tmp_hs  = f"{TMP_DIR}/hs_{z}_{x}_{y}.tif"

    drv = gdal.GetDriverByName("GTiff")
    tmp_ds = drv.Create(tmp_dem, SIZE, SIZE, 1, gdal.GDT_Float32)
    tmp_ds.SetGeoTransform([xmin, pixel_size, 0, ymax, 0, -pixel_size])
    tmp_ds.SetProjection(dst_srs.ExportToWkt())
    tmp_ds.GetRasterBand(1).WriteArray(arr)
    tmp_ds.FlushCache()
    tmp_ds = None

    ret = subprocess.call(
        f"gdaldem hillshade {tmp_dem} {tmp_hs} -multidirectional -z 2 -q",
        shell=True)
    if ret != 0:
        os.remove(tmp_dem)
        return None

    hs_ds = gdal.Open(tmp_hs)
    hs_arr = hs_ds.GetRasterBand(1).ReadAsArray().astype(np.uint8)
    hs_ds = None
    os.remove(tmp_dem)
    os.remove(tmp_hs)

    cropped = hs_arr[BUFFER_PX:BUFFER_PX+256, BUFFER_PX:BUFFER_PX+256]
    return cropped

def generate_tiles():
    os.makedirs(TMP_DIR, exist_ok=True)
    with open(STATS_PATH) as f:
        stats = json.load(f)

    lon_min, lat_min, lon_max, lat_max = get_vrt_lonlat_bounds()
    log(f"VRT bounds: lon {lon_min:.3f}-{lon_max:.3f}, lat {lat_min:.3f}-{lat_max:.3f}")

    src_ds = gdal.Open(VRT_PATH)
    written = skipped = 0

    for z in range(ZOOM_MIN, ZOOM_MAX + 1):
        x0, y1 = lonlat_to_tile(lon_min, lat_min, z)
        x1, y0 = lonlat_to_tile(lon_max, lat_max, z)
        candidates = (x1-x0+1) * (y1-y0+1)
        log(f"Z{z}: {candidates} candidate tiles")

        for x in range(x0, x1+1):
            for y in range(y0, y1+1):
                out_path = f"{TILES_DIR}/{z}/{x}/{y}.webp"
                if os.path.exists(out_path):
                    skipped += 1
                    continue
                os.makedirs(f"{TILES_DIR}/{z}/{x}", exist_ok=True)
                result = process_tile(src_ds, z, x, y)
                if result is None:
                    skipped += 1
                    continue
                img = Image.fromarray(result, mode='L').convert('RGB')
                img.save(out_path, 'WEBP', quality=90)
                written += 1
                if written % 500 == 0:
                    log(f"  Progress: {written} written, {skipped} skipped")

    log(f"Done: {written} tiles written, {skipped} skipped")

def upload():
    run(f"rclone copy {TILES_DIR}/ {R2_DEST}/ --progress --s3-no-check-bucket --transfers 16")

if __name__ == "__main__":
    os.makedirs(WORK_DIR, exist_ok=True)
    log("=== Pipeline B: Oregon Hillshade ===")
    download()
    build_vrt()
    compute_stats()
    generate_tiles()
    upload()
    log("=== COMPLETE ===")
