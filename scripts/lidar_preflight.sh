#!/usr/bin/env bash
set -euo pipefail

echo "== LiDAR preflight =="
echo

need_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "OK   $1"
  else
    echo "MISS $1"
    MISSING=1
  fi
}

MISSING=0
need_cmd aws
need_cmd python3
need_cmd pdal
need_cmd gdalinfo
need_cmd rio

echo
echo "AWS identity:"
if aws sts get-caller-identity >/tmp/lidar_sts.json 2>/tmp/lidar_sts.err; then
  cat /tmp/lidar_sts.json
else
  echo "Unable to call STS. Check credentials/profile."
  cat /tmp/lidar_sts.err || true
  MISSING=1
fi

echo
echo "Tile endpoint probe:"
URL="https://tiles.unworkedgold.com/indiana/pendleton/hillshade/12/1072/1550.webp"
if command -v curl >/dev/null 2>&1; then
  curl -sI "$URL" | sed -n '1,3p'
else
  echo "curl not installed; skipping endpoint check"
fi

echo
if [[ "$MISSING" -eq 1 ]]; then
  echo "Preflight result: NOT READY"
  exit 1
fi

echo "Preflight result: READY"
