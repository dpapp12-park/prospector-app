#!/usr/bin/env python3
import os
import argparse
import subprocess

def run(cmd):
    print(">>", cmd)
    subprocess.check_call(cmd, shell=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workdir", default="/mnt/nvme1/oregon_3x3")
    ap.add_argument("--vrt", default="oregon_3x3.vrt")
    ap.add_argument("--stats", default="stats.json")
    ap.add_argument("--z", type=int, default=15)
    ap.add_argument("--x", type=int, required=True)
    ap.add_argument("--y", type=int, required=True)
    ap.add_argument("--tiles_root", default="/mnt/nvme1/tiles")
    args = ap.parse_args()

    os.makedirs(args.workdir, exist_ok=True)
    os.makedirs(args.tiles_root, exist_ok=True)

    vrt_path = os.path.join(args.workdir, args.vrt)
    stats_path = os.path.join(args.workdir, args.stats)

    run(f"python3 ~/global_stats_from_vrt.py --vrt {vrt_path} --out {stats_path}")

    z = args.z
    x = args.x
    y = args.y
    out_dir = os.path.join(args.tiles_root, str(z), str(x))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{y}.webp")

    run(
        f"python3 ~/process_seamless_tile.py "
        f"--vrt {vrt_path} --z {z} --x {x} --y {y} "
        f"--stats {stats_path} --out {out_path}"
    )

    print("Tile written to:", out_path)

if __name__ == "__main__":
    main()
