// OSM building footprints → batched extruded primitives (keyless 3D city). Data: public/data/osm_buildings_taipei.json
import * as Cesium from 'cesium';

export async function loadOsmBuildings(viewer, url, onProgress) {
  const res = await fetch(url); if (!res.ok) throw new Error('osm buildings fetch failed ' + res.status);
  const data = await res.json(); const { origin, scale } = data.meta; const [ox, oy] = origin;
  const buildings = data.b; const types = data.types || []; const index = []; // centroid index for matching FUNRAISE buildings to footprints
  const CHUNK = 1500; const primitives = [];
  const colorFor = (hm) => { // height → cool glassy gradient
    const t = Math.min(1, hm / 120);
    const r = 28 + 40 * t, g = 44 + 70 * t, b = 78 + 110 * t; return new Cesium.Color(r / 255, g / 255, b / 255, 1);
  };
  for (let c = 0; c < buildings.length; c += CHUNK) {
    const instances = [];
    for (let i = c; i < Math.min(c + CHUNK, buildings.length); i++) {
      const b = buildings[i]; const hm = (b[0] || 100) / 10; const flat = b[2]; if (!flat || flat.length < 8) continue;
      const degs = new Array(flat.length); let cx = 0, cy = 0; const n = flat.length / 2;
      for (let k = 0; k < flat.length; k += 2) { const lon = ox + flat[k] / scale, lat = oy + flat[k + 1] / scale; degs[k] = lon; degs[k + 1] = lat; cx += lon; cy += lat; }
      index.push({ i, lon: cx / n, lat: cy / n, h: hm, name: b[3] || null, type: types[b[1]] || 'yes', ring: degs });
      try {
        instances.push(new Cesium.GeometryInstance({
          geometry: Cesium.PolygonGeometry.fromPositions({ positions: Cesium.Cartesian3.fromDegreesArray(degs), extrudedHeight: hm, height: 0, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colorFor(hm)) }, id: 'osm:' + i,
        }));
      } catch (e) { /* skip degenerate */ }
    }
    if (instances.length) {
      const p = new Cesium.Primitive({ geometryInstances: instances, appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true, flat: false }), asynchronous: true, allowPicking: false, releaseGeometryInstances: true });
      viewer.scene.primitives.add(p); primitives.push(p);
    }
    onProgress && onProgress(Math.min(1, (c + CHUNK) / buildings.length));
    await new Promise(r => setTimeout(r, 0));
  }
  const grid = new Map(); const key = (lon, lat) => `${Math.floor(lon * 1000)}:${Math.floor(lat * 1000)}`;
  for (const it of index) { const k = key(it.lon, it.lat); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(it); }
  const nearest = (lon, lat, maxM = 45) => {
    let best = null, bd = maxM; const kx = Math.floor(lon * 1000), ky = Math.floor(lat * 1000);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const arr = grid.get(`${kx + dx}:${ky + dy}`); if (!arr) continue; for (const it of arr) { const d = Math.hypot((it.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180), (it.lat - lat) * 110540); if (d < bd) { bd = d; best = it; } } }
    return best;
  };
  return { count: index.length, primitives, nearest, setShow: (on) => primitives.forEach(p => { p.show = on; }), landmarks: index.filter(x => x.name && x.h >= 60) };
}
