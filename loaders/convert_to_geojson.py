import json
import os

INPUT_DIR = r"C:\Users\dpapp\OneDrive\Desktop\Projects\prospector-app\mapbox_export"

print("Converting active claims...")
features = []
with open(os.path.join(INPUT_DIR, "active_claims.geojsonl"), "r") as f:
    for line in f:
        line = line.strip()
        if line:
            features.append(json.loads(line))

output_path = os.path.join(INPUT_DIR, "active_claims_final.geojson")
with open(output_path, "w") as f:
    json.dump({"type": "FeatureCollection", "features": features}, f)

size_mb = os.path.getsize(output_path) / (1024 * 1024)
print(f"Done: {len(features):,} features → active_claims_final.geojson ({size_mb:.1f} MB)")