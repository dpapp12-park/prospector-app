import json
import os

INPUT_DIR = r"C:\Users\dpapp\OneDrive\Desktop\Projects\prospector-app\mapbox_export"
OUTPUT_DIR = INPUT_DIR

CHUNKS = [
    ("closed_chunk1_final.geojson", ["AZ", "AK"]),       # 247 MB
    ("closed_chunk2_final.geojson", ["CA", "CO"]),        # 265 MB
    ("closed_chunk3_final.geojson", ["NM", "NV", "MT"]), # 198 MB
    ("closed_chunk4_final.geojson", ["WY", "UT"]),        # 223 MB
    ("closed_chunk5_final.geojson", ["OR", "ID"]),        # 151 MB
]

for output_filename, states in CHUNKS:
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    features = []
    for state in states:
        input_file = os.path.join(INPUT_DIR, f"closed_{state}_final.geojson")
        print(f"  Reading {state}...", end=" ")
        with open(input_file, "r") as f:
            fc = json.load(f)
            features.extend(fc["features"])
        print(f"{len(fc['features']):,} features")

    print(f"  Writing {output_filename}...", end=" ")
    with open(output_path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Done ({size_mb:.1f} MB)\n")

print("All chunks ready.")