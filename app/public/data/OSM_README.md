# OSM Building Footprints - Taipei Core

Data (c) OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
Fetched from https://overpass.kumi.systems/api/interpreter

Generated: 2026-09-14T03:48:54Z

## Area

bbox (west,south,east,north): [121.495, 25.015, 121.625, 25.095]

Taipei core: 中正/大同/中山/松山/大安/信義 and the west of 內湖/南港.

Grid: 0.02 deg x 0.02 deg tiles, 7 x 4 = 28 tiles.

## Counts

- Buildings in output: 57458
- Tiles missing (failed twice): none
- Ways skipped, ring not closed: 0
- Ways skipped, too few points/degenerate: 0
- Ways skipped, null geometry node: 0
- Height range: 0.5-508.0 m, average 18.3 m
- Landmarks (named, height>=60m): 154

## Building type breakdown

- apartments: 19540
- residential: 18133
- yes: 10089
- house: 2359
- commercial: 1206
- industrial: 1197
- school: 1030
- roof: 998
- office: 438
- university: 339
- temple: 282
- outbuilding: 256
- retail: 179
- hotel: 157
- hospital: 123
- construction: 119
- dormitory: 114
- service: 113
- public: 109
- church: 83
- government: 63
- transportation: 58
- toilets: 57
- greenhouse: 56
- detached: 53
- parking: 40
- terrace: 33
- kindergarten: 27
- warehouse: 25
- train_station: 24
- storage_tank: 15
- fire_station: 11
- shed: 11
- depot: 11
- hangar: 10
- college: 9
- stadium: 7
- garage: 7
- hut: 7
- bungalow: 7
- sports_centre: 5
- carport: 5
- allotment_house: 5
- grandstand: 4
- civic: 4
- ruins: 3
- guardhouse: 3
- garages: 3
- bunker: 2
- chapel: 2
- tower: 2
- shrine: 2
- supermarket: 1
- rs: 1
- cathedral: 1
- mosque: 1
- police: 1
- clinic: 1
- kiosk: 1
- religious: 1
- wall: 1
- 醫院建築: 1
- library: 1
- shelter: 1
- static_caravan: 1
- bridge: 1
- sports_hall: 1
- service;commercial: 1
- (department_store: 1
- pagoda: 1
- civil: 1
- disused: 1
- elevator: 1
- entrance: 1
- water_tower: 1

## Height estimation rules (in order of precedence)

1. `tags.height` parsed numerically (units stripped), used directly in meters.
2. else `tags['building:levels'] * 3.2 + 1` if building:levels is present and numeric.
3. else by `tags.building`: apartments/residential=21m, commercial/office=30m, retail=7m, house=8m, industrial/warehouse=11m, hotel=36m, school/public=12m, garage/shed/roof=3m, yes/other=12m.

## Output format

`osm_buildings_taipei.json`: `{meta, b:[[height_dm, typeIndex, [x0,y0,x1,y1,...], name?], ...], types:[...]}`.
Coordinates are integers: x=round((lon-origin_lon)*1e6), y=round((lat-origin_lat)*1e6); ring is open (closing point not repeated).
height_dm = round(height_m*10). name (4th array element) present only when the building has a name.

`osm_landmarks.json`: array of `{name, lon, lat, height_m}` polygon centroids, named buildings >=60m tall, max 300, sorted tallest first.
