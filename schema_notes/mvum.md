<!--
  schema_notes/mvum.md
  Unworked Gold — schema note for USFS Motor Vehicle Use Map (MVUM).
  Produced: April 22, 2026, Session 18.
  Scope: source documentation for ingest. Two landing tables per
         Option X decision (Session 18): mvum_roads + mvum_trails.
  Companion file: sql/migrations/2026-04-22_mvum.sql (not yet written).
  Precedent template: schema_notes/military_lands.md (Session 16).
-->

# SCHEMA NOTE — USFS MVUM (Motor Vehicle Use Map)

## Summary

Two-table landing per Option X (Session 18 architecture decision).

| Table | Source layer | Record count (verified) | Field count |
|---|---|---|---|
| `mvum_roads` | EDW_MVUM_01 / MapServer / 1 | **150,609** | ~60 |
| `mvum_trails` | EDW_MVUM_01 / MapServer / 2 | **28,760** | ~58 |
| **Total** | | **179,369** | |

Record counts verified via `returnCountOnly=true` on April 22, 2026 (user-in-loop browser fetch).

---

## Source

- **Service**: `EDW/EDW_MVUM_01 (MapServer)`
- **Base URL**: `https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer`
- **Publisher**: USDA Forest Service, Enterprise Data Warehouse (EDW)
- **Regulatory authority**: 36 CFR 212.56 (designated roads and trails for motor vehicle use)
- **License**: US Government Work — public domain. No copyright, no attribution required, though attribution to USDA Forest Service is courteous.
- **FSGeodata Clearinghouse reference**: `https://data.fs.usda.gov/geodata/edw/datasets.php?xmlKeyword=Motor+vehicle+Use+Map`

---

## F.3 — alternatives evaluated

1. **`EDW_MVUM_01`** — **selected**. Unlabeled version of the service. Canonical feature layers 1 (Roads) and 2 (Trails). Source of truth.
2. **`EDW_MVUM_02`** — rejected. Differs from MVUM_01 only by adding labels to the MVUM Symbology group. Same underlying features. No reason to ingest twice.
3. **`data-usfs.hub.arcgis.com`** wrapper / hub — rejected. Wraps the same EDW endpoint. Direct REST access is cleaner and avoids a dependency on the hub's availability.
4. **Per-ranger-district PDFs and georeferenced Avenza maps** — rejected. PDFs are rendering outputs, not GIS-queryable data. Source of truth is EDW.
5. **Per-forest ArcGIS services** (e.g., Kentucky state GIS republishing the national data) — rejected. State-by-state republishing would require reconciling 50+ endpoints for data the national service already aggregates.

---

## Layer numbering correction

The pre-session research memo (`phase1_dataset_research.md`, April 22) listed MVUM layers as 4 (Roads) and 5 (Trails). **This was wrong.** Layers 4 and 5 are the "Visitor Map Symbology" group's rendered sub-layers (styling copies). The authoritative feature layers are:

- **Layer 1** — Motor Vehicle Use Map: Roads (parent group: MVUM Symbology)
- **Layer 2** — Motor Vehicle Use Map: Trails (parent group: MVUM Symbology)

---

## Spatial extent

Both layers in spatial reference **WKID 4269 (NAD83)**. At ingest, request `outSR=4326` (WGS84) to match existing Supabase geometry convention (`[B-13]`, MIRTA migration from Session 16).

| Layer | XMin | YMin | XMax | YMax |
|---|---|---|---|---|
| Roads | -149.981 | 28.961 | -70.795 | 61.029 |
| Trails | -149.373 | 28.985 | -73.004 | 60.752 |

Coverage: continental US + Alaska + Hawaii + Puerto Rico extent where Forest Service units exist. Not every National Forest contributes data — gaps are expected and legitimate, not errors.

---

## Update cadence

Per the service description: published and refreshed on a unit-by-unit basis as needed, synchronized with individual forests' published MVUM publications. **No fixed calendar cadence.** Individual forests update their MVUM when management decisions change.

Unworked Gold refresh policy: **quarterly pull**. Low volatility; over-refresh is wasted work.

---

## Rate limits and pagination

- `MaxRecordCount`: **2000** per query (both layers)
- Pagination supported: yes (`supportsPagination: true`)
- Max selection count: 2000
- Supported output formats: JSON, geoJSON, PBF

**Pagination math:**

| Layer | Records | Pages @ 2000 |
|---|---|---|
| Roads | 150,609 | 76 |
| Trails | 28,760 | 15 |
| **Total ingest API calls** | | **91** |

Single-session feasible for both layers. No CA/NV-style server-cutoff risk observed in FS services (confirmed — this is USDA, not BLM).

Query strategy: `?where=1=1&outFields=*&outSR=4326&resultOffset=<n>&resultRecordCount=2000&f=geojson&returnGeometry=true`. Increment `resultOffset` by 2000 per page. Loop until returned feature count < 2000.

---

## Landing table: `mvum_roads`

- **Source layer**: `EDW/EDW_MVUM_01/MapServer/1`
- **Geometry type**: `esriGeometryPolyline` → PostGIS `GEOMETRY(Geometry, 4326)` (per MIRTA precedent; segments may be multipart)
- **`source_id` choice**: **`globalid`** (ArcGIS GlobalID, type `esriFieldTypeGlobalID`, length 38). Endpoint metadata confirms uniqueness via index `uuid_282` marked `isUnique: true`. The alternative `rte_cn` is indexed but **NOT unique** (`isUnique: false`) — multiple route segments share a route control number. `objectid` is per-service-reload volatile. GlobalID is the stable, unique, persistent identifier.

### Field inventory — Roads (60 fields)

#### Identity + geometry (8)

| Field | Type | Len | Notes |
|---|---|---|---|
| `objectid` | OID | — | Internal, volatile across reloads |
| `rte_cn` | String | 34 | Route Control Number — business identifier, **not unique** |
| `id` | String | 30 | |
| `name` | String | 30 | Road name |
| `bmp` | Double | — | Beginning MilePost |
| `emp` | Double | — | Ending MilePost |
| `seg_length` | Double | — | Segment length |
| `gis_miles` | Double | — | GIS-calculated miles |

#### Classification (8)

| Field | Type | Len | Notes |
|---|---|---|---|
| `symbol` | String | 4 | MVUM symbol code. FS System road values: 1, 2, 3, 4, 11, 12. Non-FS values (highways, county roads) also present for mapping context — filter by symbol if UG wants FS-only display. |
| `mvum_symbol_name` | String | 100 | Human-readable symbol description (e.g., "Roads open to all Vehicles, Yearlong") |
| `jurisdiction` | String | 40 | Managing authority |
| `operationalmaintlevel` | String | 40 | FS maintenance level (1-5) |
| `surfacetype` | String | 40 | Road surface material |
| `system` | String | 40 | Forest Service system classification |
| `seasonal` | String | 11 | Seasonal designation flag |
| `sbs_symbol_name` | String | 100 | Secondary symbology name |

#### Vehicle permissions — 14 standard classes, each a (Y/N + DatesOpen) pair = 28 fields

| Class | Y/N field | DatesOpen field |
|---|---|---|
| Passenger vehicle | `passengervehicle` | `passengervehicle_datesopen` |
| High clearance vehicle | `highclearancevehicle` | `highclearancevehicle_datesopen` |
| Truck | `truck` | `truck_datesopen` |
| Bus | `bus` | `bus_datesopen` |
| Motorhome | `motorhome` | `motorhome_datesopen` |
| Four WD >50" | `fourwd_gt50inches` | `fourwd_gt50_datesopen` |
| Two WD >50" | `twowd_gt50inches` | `twowd_gt50_datesopen` |
| Tracked OHV >50" | `tracked_ohv_gt50inches` | `tracked_ohv_gt50_datesopen` |
| Other OHV >50" | `other_ohv_gt50inches` | `other_ohv_gt50_datesopen` |
| ATV | `atv` | `atv_datesopen` |
| Motorcycle | `motorcycle` | `motorcycle_datesopen` |
| Other wheeled OHV | `otherwheeled_ohv` | `otherwheeled_ohv_datesopen` |
| Tracked OHV <50" | `tracked_ohv_lt50inches` | `tracked_ohv_lt50_datesopen` |
| Other OHV <50" | `other_ohv_lt50inches` | `other_ohv_lt50_datesopen` |

All Y/N fields: String, length 4. All DatesOpen fields: String, length 96.

#### E-bike permissions — 3 classes, each a (Y/N + Duration) pair = 6 fields

| Class | Y/N field | Duration field |
|---|---|---|
| Class 1 | `e_bike_class1` | `e_bike_class1_dur` |
| Class 2 | `e_bike_class2` | `e_bike_class2_dur` |
| Class 3 | `e_bike_class3` | `e_bike_class3_dur` |

Y/N: String, length 4. Duration: String, length 500.

#### Administrative (5)

| Field | Type | Len | Notes |
|---|---|---|---|
| `adminorg` | String | 40 | |
| `securityid` | String | 30 | Alias "Forest Code" |
| `districtname` | String | 150 | Ranger district |
| `forestname` | String | 150 | Forest name |
| `field_id` | String | 50 | Label ID for map rendering |

#### Misc + geometry (5)

| Field | Type | Len | Notes |
|---|---|---|---|
| `routestatus` | String | 20 | |
| `globalid` | GlobalID | 38 | **→ source_id** |
| `ta_symbol` | SmallInteger | — | Travel analysis symbol |
| `shape` | Geometry | — | Polyline; stored in `geometry` column as LINESTRING/MULTILINESTRING, SRID 4326 |
| `st_length(shape)` | Double | — | Shape length in source spatial units |

---

## Landing table: `mvum_trails`

- **Source layer**: `EDW/EDW_MVUM_01/MapServer/2`
- **Geometry type**: `esriGeometryPolyline` → `GEOMETRY(Geometry, 4326)`
- **`source_id` choice**: **`globalid`** (same reasoning as Roads — stable, unique, persistent)

### Field inventory — Trails (58 fields)

#### Identity + geometry (8)

Same as Roads: `objectid`, `rte_cn`, `id`, `name`, `bmp`, `emp`, `seg_length`, `gis_miles`.

#### Classification (4 — fewer than Roads)

| Field | Type | Len | Notes |
|---|---|---|---|
| `symbol` | String | 4 | MVUM symbol code. **FS System trail values: 5, 6, 7, 8, 9, 10, 11, 12, 16, 17.** Memo's cited range "5-12, 16, 1" was wrong on both ends — symbol 1 is not in the trail renderer; symbol 17 exists ("Trails Open to Wheeled Vehicles < 50" or Less in Width, Seasonal"). |
| `mvum_symbol_name` | String | 100 | Human-readable symbol description |
| `jurisdiction` | String | 40 | |
| `seasonal` | String | 11 | |

**Missing vs Roads**: no `operationalmaintlevel`, no `surfacetype`, no `system`, no `routestatus`, no `sbs_symbol_name`. These don't apply to trails.

#### Vehicle permissions — same 14 classes as Roads = 28 fields

Identical schema to Roads. Same 14 vehicle classes with the same (Y/N + DatesOpen) pairs.

#### E-bike permissions — same 3 classes as Roads = 6 fields

Identical schema to Roads.

#### Administrative (5)

Same as Roads: `adminorg`, `securityid`, `districtname`, `forestname`, `field_id`.

#### Trail-specific (3 — new, not in Roads)

| Field | Type | Len | Notes |
|---|---|---|---|
| `trailstatus` | String | 20 | Replaces `routestatus` from Roads schema |
| `trailsystem` | String | 40 | |
| `trailclass` | String | 40 | |

#### Misc + geometry (4)

| Field | Type | Len | Notes |
|---|---|---|---|
| `globalid` | GlobalID | 38 | **→ source_id** |
| `ta_symbol` | SmallInteger | — | |
| `shape` | Geometry | — | |
| `shape.len` | Double | — | Shape length |

---

## Known source caveats

1. **Not every National Forest has data.** Some units haven't finalized or published their MVUM to EDW. Legitimate gaps; not ingest errors.
2. **Per-unit staleness is possible.** Data publishes on a unit-by-unit cadence — some forests may lag others.
3. **Non-FS routes included in Roads layer for mapping context.** Highways, county roads, public roads appear in the Roads feature class but are not FS System roads. **Only symbols 1, 2, 3, 4, 11, 12 are FS System.** At display/query time, filter by `symbol IN ('1','2','3','4','11','12')` if UG wants FS-only — at ingest, capture everything per `Data_Foundation.md` Section 1.
4. **Trails also include context data.** Symbols outside 5, 6, 7, 8, 9, 10, 11, 12, 16, 17 may appear for rendering purposes.
5. **Overlap with `BLM_Natl_Transportation`.** Some routes cross USFS/BLM boundaries. MVUM is authoritative for USFS; BLM_Natl_Transportation is authoritative for BLM. Deduplication at display time is a UI concern, not an ingest concern.
6. **"Open" ≠ "passable".** Per the USFS: a trail designated open to motorcycles year-round may still be impassable due to snow. Legal openness is what MVUM tracks. Surface conditions are not.
7. **Motorized-only.** MVUM excludes non-motorized trails entirely. Hiking-only, horse-only, mountain-bike-only trails are in a separate EDW service (`EDW_TrailNFSPublish_01`) — not this ingest.

---

## Moat framing (F.18)

Detector Maps does not currently expose per-vehicle-class MVUM data per the April 20 gap analysis. Unworked Gold ingesting **17 vehicle classes × open/closed × dates-open** creates an in-field decision tool ("I have a 60-inch UTV, which FS roads am I legally allowed to drive on during my planned week in July?") that competitors cannot match with a generic roads layer. Moat-quality IF paired with good UI filtering — the data alone is only potential.

---

## Corrections to the pre-session research memo

The research memo (`phase1_dataset_research.md`, April 22) contained the following errors. Verified against endpoint metadata and corrected in this schema note:

1. **Layer IDs.** Memo said Roads = Layer 4, Trails = Layer 5. **Actual: Roads = Layer 1, Trails = Layer 2.** Layers 4/5 are Visitor Map Symbology sub-layers (rendered copies, not authoritative features).
2. **Vehicle class count.** Memo listed 6 classes (MOTORHOME, FOURWD_GT50INCHES, TWOWD_GT50INCHES, TRACKED_OHV_GT50INCHES, OTHER_OHV_GT50INCHES, ATV). **Actual: 17 classes** — memo missed passenger vehicle, high-clearance vehicle, truck, bus, motorcycle, other wheeled OHV, tracked OHV <50", other OHV <50", and three e-bike classes.
3. **Trail symbol range.** Memo cited "5-12, 16, 1". **Actual: 5, 6, 7, 8, 9, 10, 11, 12, 16, 17.** Symbol 1 is not in the trail renderer. Symbol 17 exists and was missed.
4. **Record counts.** Memo estimated 100K–500K combined. **Actual verified: 179,369 combined.** Inside the estimate range but at the low end — no surprise.
5. **`source_id` rationale.** Memo did not identify `globalid` as the stable unique identifier. Index metadata confirms `globalid` is unique (`uuid_282` isUnique: true); `rte_cn` is indexed but not unique.

None of these errors are disqualifying — the memo's core judgment ("MVUM is single-endpoint, low-complexity, high-value, single-session ingest") held up against verification. Errors were in layer-number and field-count precision, which is exactly what Step 1 is designed to catch.

---

## Next steps (Step 2+)

- **Step 2**: Write migration `sql/migrations/2026-04-22_mvum.sql` creating both tables with standard JSONB landing pattern from `Data_Foundation.md` Section 1, plus RLS per `[F-11]`. Execute against Supabase separately (not part of the migration write).
- **Step 3**: Write ingest script (paginated REST pulls, 91 total API calls, `outSR=4326`, GeoJSON format).
- **Step 4**: Execute ingest.
- **Step 5**: Map layer + popup.

---

*End of schema note. Source of truth for MVUM ingest. Living document — update if endpoint metadata changes at next quarterly refresh.*
