# Pipeline B Layer Implementation -- Library Choices

**Last updated:** April 17, 2026
**Authority:** Architect directive (April 17, 2026 orchestrator approval)
**Status:** Final, reviewable

---

## Summary

| Layer | Library | Status |
|---|---|---|
| Hillshade (multidirectional) | `gdaldem hillshade -multidirectional` | Proven on Oregon west, RI |
| SVF (Sky-View Factor) | RVT-py (`rvt.vis.sky_view_factor`) | Per architect directive |
| RRIM (Red Relief Image Map) | **Native implementation using RVT-py + numpy + PIL** | Deviates from architect's pyRRIM suggestion -- reasoning documented below |

---

## Hillshade

No change from Oregon/RI. `gdaldem hillshade -multidirectional -z 2 -q` per tile, Pillow WebP output.

## SVF

Per architect directive (April 17, 2026): **RVT-py** is the Pipeline B standard for SVF.

Replaces SAGA-GIS's `ta_lighting 3` (documented in brief as 6-hours-per-tile disaster) and the WhiteboxTools `sky_view_factor` (paid license required).

Implementation:
```python
import rvt.vis
result = rvt.vis.sky_view_factor(
    dem=dem_array,
    resolution=pixel_size_meters,
    compute_svf=True,
    compute_asvf=False,
    compute_opns=False,
    svf_n_dir=16,
    svf_r_max=10,
    svf_noise=0,
    no_data=nodata_value
)
svf_array = result["svf"]  # 2D numpy array, float32, range 0-1
```

Output normalization: SVF returns 0.0-1.0 where 1.0 = completely open sky, 0.0 = fully obstructed. For display tile, we scale to 0-255 uint8 via `(svf * 255).astype(np.uint8)`.

Install: `pip install rvt-py --break-system-packages` (on Ubuntu 24.04).

## RRIM -- Deviation from architect suggestion

### Architect's guidance (April 17, 2026):
> "Use pyRRIM as primary implementation, per April 15 notes. If RVT-py provides a RRIM-equivalent that is well-documented, stable, and produces visually comparable output, you may evaluate it, but default to pyRRIM unless you can document a clear advantage."

### Decision: Native implementation using RVT-py primitives

### Documented advantages over pyRRIM:

1. **Maintenance posture.** pyRRIM (robertxa/pyRRIM on GitHub) has 3 stars, 0 forks, last release May 2021 (5 years ago). Unmaintained hobby code. Native implementation means we own the code path and can fix bugs without waiting for upstream.

2. **Python version compatibility.** pyRRIM's setup.py declares Python 3.9. Our EC2 target is Ubuntu 24.04 with Python 3.12. Risk of install failure or runtime incompatibility with 5-year-old abandoned package is non-zero. Native implementation has no such risk.

3. **Dependency footprint.** pyRRIM transitively requires: opencv-python, richdem, alive_progress, time (stdlib), gdal, rvt_py. That's 5 extra heavy dependencies. Native implementation needs only: rvt-py, numpy, PIL -- all already installed for other pipeline stages.

4. **I/O architecture.** pyRRIM's `rrim()` function takes a file path input and writes a GeoTIFF output. Our pipeline processes tiles in-memory via numpy arrays -- file-based I/O would add disk round-trips per tile (there are thousands of tiles per state). Native implementation stays in-memory.

5. **Algorithmic transparency.** pyRRIM's algorithm under the hood is:
   (a) compute slope (provided by RVT-py or gdaldem)
   (b) compute positive and negative openness (provided by RVT-py)
   (c) take differential openness = (pos - neg) / 2
   (d) construct HSV where H=red, S=f(slope), V=f(differential openness)
   (e) convert to RGB

   All of these primitives exist in rvt-py or stdlib numpy. No novel algorithms in pyRRIM that we can't reproduce in ~50 lines.

### Algorithm (per Chiba et al. 2008, implemented via RVT-py primitives):

```python
import rvt.vis
import numpy as np
from PIL import Image

def compute_rrim_tile(dem_array, pixel_size):
    """
    Red Relief Image Map per Chiba, Kaneta, Suzuki 2008 ISPRS.
    Returns uint8 RGB array (HxWx3) ready for WebP output.
    """
    # Step 1: Slope
    slope_result = rvt.vis.slope_aspect(
        dem=dem_array,
        resolution_x=pixel_size,
        resolution_y=pixel_size,
        output_units="degree",
        ve_factor=1,
        no_data=None
    )
    slope_deg = slope_result["slope"]  # degrees, 0-90

    # Step 2: Positive openness
    pos_opns_result = rvt.vis.sky_view_factor(
        dem=dem_array,
        resolution=pixel_size,
        compute_svf=False,
        compute_asvf=False,
        compute_opns=True,
        svf_n_dir=8,
        svf_r_max=20,
        svf_noise=0,
        no_data=None
    )
    pos_opns = pos_opns_result["opns"]  # degrees

    # Step 3: Negative openness (flip DEM sign)
    neg_opns_result = rvt.vis.sky_view_factor(
        dem=dem_array * -1,
        resolution=pixel_size,
        compute_svf=False,
        compute_asvf=False,
        compute_opns=True,
        svf_n_dir=8,
        svf_r_max=20,
        svf_noise=0,
        no_data=None
    )
    neg_opns = neg_opns_result["opns"]  # degrees

    # Step 4: Differential openness
    diff_opns = (pos_opns - neg_opns) / 2  # degrees

    # Step 5: Build HSV
    # H = 0 (red/copper)
    # S = slope scaled 0-1 (steeper = more saturated red)
    # V = diff_opns scaled 0-1 (convex = bright, concave = dark)
    slope_norm = np.clip(slope_deg / 60.0, 0, 1)  # 60 deg = max saturation
    diff_norm = np.clip((diff_opns + 15) / 30, 0, 1)  # -15 to +15 deg range

    h = np.full_like(slope_norm, 10.0 / 360.0)  # copper hue
    s = slope_norm
    v = diff_norm

    # HSV -> RGB
    import colorsys
    h_flat = h.flatten()
    s_flat = s.flatten()
    v_flat = v.flatten()
    rgb = np.array([colorsys.hsv_to_rgb(hh, ss, vv)
                    for hh, ss, vv in zip(h_flat, s_flat, v_flat)])
    rgb = rgb.reshape(dem_array.shape + (3,))
    rgb_uint8 = (rgb * 255).astype(np.uint8)
    return rgb_uint8
```

### Visual output comparison

Chiba 2008 RRIM classic look: warm copper-to-red for slopes, lighter/brighter for ridges, darker for valleys/pits. Our implementation matches the canonical HSV construction from the original paper. Visual approval gate via proof tile will confirm on real Oregon data before any full-state run.

### Rollback plan

If proof tile for Oregon RRIM fails architect visual review, we fall back to pyRRIM:
```
pip install pyRRIM --break-system-packages
```
and swap `compute_rrim_tile()` to call pyRRIM's `rrim()` with a temp file round-trip. Cost: slower per-tile processing, but proven legacy implementation.

---

## Approval requested

This decision document is committed to `/pipeline/docs/pipeline_b_layers.md` per architect directive:
> "Document the final choice and reasoning in `/pipeline/docs/pipeline_b_layers.md`."

Architect has option to override this decision at Oregon RRIM proof-tile approval gate. If override requested, rollback plan above applies.
