# Taipei Metro Area Basemap

`taipei_basemap.json` — a compact basemap for offline canvas rendering, covering
Taipei City and inner New Taipei City (bbox: lon 121.40–121.70, lat 24.93–25.20).

Generated: 2026-09-14T02:26:49Z

## Contents

| Collection     | Count | Notes |
|----------------|------:|-------|
| `districts`    | 34    | 12 Taipei City districts + 22 New Taipei districts intersecting the bbox |
| `mrt_lines`    | 6     | 文湖線 / 淡水信義線 / 松山新店線 / 中和新蘆線 / 板南線 / 環狀線 (incl. 新北投 & 小碧潭 branches, merged into their parent line) |
| `mrt_stations` | 100   | Stations serving at least one of the above lines within the bbox |
| `rivers`       | 13 segments | 淡水河, 基隆河, 新店溪, 大漢溪, 景美溪 |
| `roads`        | 1356  | motorway / trunk / primary ways ≥150m, capped at 2500 |
| `parks`        | 102   | leisure=park polygons > 5 ha |

All coordinates are `[lon, lat]`, rounded to 5 decimal places (~1.1 m).

## Sources & Licenses

1. **g0v/twgeojson** — `json/twTown1982.topo.json`
   https://github.com/g0v/twgeojson
   License: **CC BY 4.0**
   Used for district (鄉鎮市區) boundaries. This dataset predates the 2010
   county-to-municipality reorganization, so boundaries for old 台北縣
   townships are geometrically identical to today's 新北市 districts; county
   was relabeled `台北市→臺北市` / `台北縣→新北市` and township-name suffixes
   `市/鎮/鄉` were normalized to `區` to match current names (e.g. 板橋市→板橋區,
   汐止鎮→汐止區). Simplified with Douglas-Peucker, tolerance 0.0006° (~60 m),
   as specified.

2. **OpenStreetMap contributors**, fetched via the Overpass API
   https://overpass.kumi.systems/api/interpreter (mirror; the primary
   `overpass-api.de` endpoint reset connections throughout this run and was
   abandoned in favor of the mirror after one retry, per instructions)
   License: **ODbL 1.0** — © OpenStreetMap contributors
   Used for:
   - MRT lines/stations: `relation[route=subway]`, grouped by line `ref`
     (BR/R/G/O/BL/Y); station↔line association derived from each relation's
     `stop`/`platform` members. Taoyuan Airport MRT (ref `A`, operator
     桃園大眾捷運股份有限公司) explicitly excluded.
   - Rivers: `waterway=river` ways filtered to the 5 named rivers.
   - Roads: `highway~"motorway|trunk|primary"` ways, segments <150 m dropped,
     simplified at tolerance 0.0004° as specified.
   - Parks: `leisure=park` ways and multipolygon relations, area >5 ha
     (computed via equirectangular-projected shoelace formula), outer rings
     only.

## Processing notes / fallbacks used

- District source followed the requested order: g0v/twgeojson (a) succeeded,
  so Overpass admin_level boundaries (b) were not needed. GitHub's REST API
  (`api.github.com`) was not reachable from this session, so the repo was
  fetched via anonymous `git clone` instead of the contents API.
- The full-bbox `highway~"motorway|trunk|primary"` Overpass query timed out
  (504) even on retry. It was split into: (1) motorway+trunk for the whole
  bbox, and (2) primary roads per geographic quadrant/tile, re-split further
  where a tile still timed out. All sub-areas eventually returned successfully
  (some downtown Da'an-core tiles genuinely contain few/no `primary`-tagged
  ways — those arterials are tagged `secondary`/`trunk` instead), so road
  coverage across the full bbox is complete.
- Douglas-Peucker simplification was implemented from scratch (pure Python,
  no shapely/numpy). Tolerances: districts 0.0006°, roads 0.0004° (both
  per spec); MRT lines 0.000003°, rivers 0.000008°, parks 0.00002° (not
  spec'd, chosen to balance visual fidelity against file size).
- No coordinates were fabricated: every point traces back to an OSM node
  geometry or a g0v/twgeojson TopoJSON arc.
