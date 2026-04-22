# schema_notes/military_lands.md

**Dataset:** Military Installations, Ranges, and Training Areas (MIRTA)
**Purpose in Unworked Gold:** Display federal military land boundaries as a
"legally restricted" visual layer alongside mining claims, so prospectors see
where mineral entry is categorically off-limits.
**Step 1 completed:** April 22, 2026, Session 16.

---

## Source

### Selected endpoint (authoritative)

**NTAD Military Bases — FeatureServer, layer 0**
`https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Military_Bases/FeatureServer/0`

- Publisher: USDOT / Bureau of Transportation Statistics (NTAD), compiled from
  DoD DISDI Program source data.
- Underlying source: Fiscal Year 2024 Base Structure Report (BSR), Office of
  the Assistant Secretary of Defense for Energy, Installations, and
  Environment.
- Data dictionary: https://doi.org/10.21949/1529039
- Geometry type: polygon (boundaries). No mixing with point layer — this spec
  covers boundaries only.
- Spatial reference: EPSG:4326 (WGS84).
- Max record count per query: 2000.
- Supported output formats: JSON, geoJSON, PBF.
- Supported ops include: Query, Query Top Features, ConvertFormat, Get
  Estimates. Read-only for public consumers.

### Rejected endpoints (for the record)

- **DISDI MIRTA_Polygons_A_view** (`services2.arcgis.com/FiaPA4ga0iQKduv3/...`):
  endpoint description still references 2015 BSR. Meaningfully stale, fewer
  fields exposed in the view. Rejected.
- **data.gov MIRTA shapefile direct download**: same FY2024 BSR year as
  selected endpoint, but bulk ZIP only. No live REST means scripted refresh
  must download and unzip each time — more brittle. Rejected for the primary
  loader path. *Optional future use:* quarterly cross-check against the
  selected endpoint if drift is ever suspected.
- **Census TIGER/Line Military Installations** (2012 data, frozen): rejected
  out of hand — 13+ years stale.

---

## License and usage

Copyright text from endpoint: *"This NTAD dataset is a work of the United
States government as defined in 17 U.S.C. § 101 and as such are not protected
by any U.S. copyrights. This work is available for unrestricted public use."*

No attribution legally required. Recommended to credit "US DOT NTAD / DoD
DISDI" in app popups for goodwill.

## Known caveats (from source metadata)

- Intended for mapping scales between 1:50,000 and 1:3,000,000. Boundaries
  "may not perfectly align with DoD site boundaries depicted in other federal
  data sources." Fine for our red-fill "don't prospect here" overlay at Mapbox
  zoom levels 5–14. Users should not rely on exact boundary lines at parcel
  scale.
- "This list does not necessarily represent a comprehensive collection of all
  Department of Defense facilities." A small unknown number of sites are
  excluded (classified, sensitive). Prospectors should not treat absence on
  this map as legal permission.
- Joint Base naming convention: post-2005 BRAC joint bases attribute the
  joint name; subordinate sites may still carry the pre-BRAC component.

---

## Coverage

- **Record count:** 824 (verified April 22, 2026 via `returnCountOnly=true`).
- **Spatial extent (WGS84):**
  - xmin: -168.013 (Aleutians, AK)
  - ymin: 13.309 (equatorial, includes US territories)
  - xmax: 174.157 (Guam)
  - ymax: 71.344 (Alaska northern coast)
- **Geography included:** 50 states, DC, PR, Guam, other US territories.
- **Not included for our purposes:** foreign DoD sites — will filter by
  `countryName = 'United States'` at load time if any non-US records appear,
  though the endpoint wrapper appears US-focused already.

## Update cadence

- BSR released annually by DoD. Endpoint's current data: FY2024.
- Endpoint `Last Edit Date`: **November 13, 2025.** Refreshed roughly
  annually after BSR release. Not a fast-moving dataset — base boundaries
  change rarely (closures, realignments, acquisitions).
- Recommendation for Unworked Gold: refresh quarterly, not nightly. Weekly at
  most. Cheap, no downside.

## Rate limits / bulk access

- No published rate limit. Standard ArcGIS Online hosted feature service —
  server returns 429 on abuse. For our 824-record full pull this is a
  non-issue (single query fits under the 2000 cap).
- Bulk access method: single query with `where=1%3D1&outFields=*&f=geojson&
  returnGeometry=true`. No pagination needed at current record count.
- If record count ever exceeds 2000: paginate by `OBJECTID` using
  `resultOffset` + `resultRecordCount`, or chunk by `stateNameCode`.

---

## Field inventory (full)

All 14 non-geometry fields captured. All land in the JSONB `raw` column.

| # | Field | Type | Length | Alias | Nullable | Notes |
|---|---|---|---|---|---|---|
| 1 | `OBJECTID` | OID | — | OBJECTID | false | Endpoint-internal integer. **Current `source_id` choice** (Session 16) — server-guaranteed unique + non-null in actual data. NOT stable across annual BSR republishes, but our refresh cadence is TRUNCATE + full reload, which neutralizes that concern. |
| 2 | `countryName` | String | 25 | Country | true | Actual values are lowercase codes like `"usa"`. Filter to `'usa'` at load time if non-US sites ever appear. |
| 3 | `featureDescription` | String | 2000 | Feature Description | true | Free-text description. Actual values often `"na"` literal — capture anyway. |
| 4 | `featureName` | String | 80 | Feature Name | true | Display name for map popup and tooltip. Human-readable label. Not unique (e.g., multiple "Storage Annex" entries). |
| 5 | `isCui` | String | 3 | Controlled Unclassified Information Indicator | true | Actual values: `"yes"` / `"no"`. Flag for sensitive records. |
| 6 | `isFirrmaSite` | String | 3 | Is FIRRMA Site | true | `"yes"` / `"no"`. Foreign Investment Risk Review Modernization Act sites. Not prospector-relevant but capture. |
| 7 | `isJointBase` | String | 3 | Is Joint Base | true | `"yes"` / `"no"`. Joint Base designation (e.g., JBLM). |
| 8 | `mediaId` | String | 40 | Media Identifier | true | DISDI internal media reference. Actual values often `"na"`. Capture, don't display. |
| 9 | `mirtaLocationsIdpk` | String | 40 | Primary Key Identifier | **false** per metadata | ⚠️ **Metadata is misleading.** The endpoint metadata labels this as non-nullable Primary Key Identifier, but the actual data populates it with a single space `" "` for every record (100% empty). Do **not** use as `source_id`. Captured in `raw` for archaeology. |
| 10 | `sdsId` | GUID | 38 | Globally Unique Identifier | true | DISDI GUID. Populated for ~75% of records (619 of 824), empty for the rest with 3 duplicate keys. Do **not** use as `source_id`. Captured in `raw`. |
| 11 | `siteName` | String | 100 | Site Name | true | Often matches or overlaps with `featureName`. Capture both. |
| 12 | `siteOperationalStatus` | String | 4 | Site Operational Status | true | Actual codes: `"act"`, `"semi"`, etc. Useful for filtering closed bases. |
| 13 | `siteReportingComponent` | String | 22 | Site Reporting Component Code | true | Actual codes: `"usaf"`, `"usar"` (Army Reserve), etc. Useful for styling or filtering. |
| 14 | `stateNameCode` | String | 5 | State Name Code | true | Lowercase two-letter state code (e.g., `"ma"`, `"ca"`). Useful for state-filtered queries. |
| — | `Shape__Area` | Double | — | Shape__Area | true | Auto-derived from geometry. Not stored separately — derive from PostGIS. |
| — | `Shape__Length` | Double | — | Shape__Length | true | Auto-derived. Same treatment. |

**Geometry:** polygon / multi-polygon, WGS84. Stored in `geometry` column.

**`source_id` choice:** `OBJECTID` (integer, cast to TEXT in landing table).

**How we got here (Session 16):** First pick was `mirtaLocationsIdpk` based on the API metadata labeling it "Primary Key Identifier" + non-nullable. Actual data populates it with `" "` (single space) for every record — useless. Second pick was `sdsId` (GUID). Pre-check against `mirta.geojson` showed 202 of 824 records had empty `sdsId`, with 3 duplicate keys among the populated ones. Third pick — `OBJECTID` — verified populated and unique across all 824. The only downside is OBJECTID is not stable across annual BSR republishes; refresh cadence is TRUNCATE + full reload so that doesn't matter for our use.

**Lesson logged:** Trusting endpoint metadata without spot-checking real data costs a retry loop. For future datasets, Step 1 should include fetching one sample record and verifying the "unique identifier" field is actually populated and unique before committing the schema note.

---

## Next steps (Step 2+ — separate sessions per protocol)

- **Step 2:** `sql/migrations/2026-04-22_military_lands.sql` creating the
  `military_lands` landing table with the JSONB pattern from
  `Data_Foundation.md` Section 1.
- **Step 3:** `loaders/load_military_lands.py` — single `where=1=1` geoJSON
  pull, UPSERT on `mirtaLocationsIdpk`. Uses `.env` pattern per `[F-9]`.
- **Step 4:** Load and print one sample `raw` JSONB to confirm full property
  set landed.
- **Step 5:** Commit schema note, SQL migration, loader, and sample row.

Tileset publish and UI wiring are **separate** follow-up sessions per
`Data_Foundation.md` Section 2 Step 5.
