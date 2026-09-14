// OSM building footprints → batched extruded primitives (keyless 3D city). Data: public/data/osm_buildings_taipei.json
import * as Cesium from 'cesium';

// Two building palettes: 夜間戰情室 (dark glassy gradient) and PickPeak 日間 (soft white → cyan-tinted, taller = more saturated).
export const PALETTES = {
  dark: (t) => new Cesium.Color((28 + 40 * t) / 255, (44 + 70 * t) / 255, (78 + 110 * t) / 255, 1),
  light: (t) => new Cesium.Color((236 - 96 * t) / 255, (240 - 36 * t) / 255, (244 - 12 * t) / 255, 1),
};

export async function loadOsmBuildings(viewer, url, onProgress, { palette: initialPalette = 'dark' } = {}) {
  const res = await fetch(url); if (!res.ok) throw new Error('osm buildings fetch failed ' + res.status);
  const data = await res.json(); const { origin, scale } = data.meta; const [ox, oy] = origin;
  const buildings = data.b; const types = data.types || []; const index = []; // centroid index for matching FUNRAISE buildings to footprints
  const CHUNK = 1500; const primitives = [];
  let palette = PALETTES[initialPalette] ? initialPalette : 'dark';
  const colorFor = (hm) => PALETTES[palette](Math.min(1, hm / 120)); // height → palette gradient
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
  const byId = new Map(index.map(it => [it.i, it]));
  const grid = new Map(); const key = (lon, lat) => `${Math.floor(lon * 1000)}:${Math.floor(lat * 1000)}`;
  for (const it of index) { const k = key(it.lon, it.lat); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(it); }
  const nearest = (lon, lat, maxM = 45) => {
    let best = null, bd = maxM; const kx = Math.floor(lon * 1000), ky = Math.floor(lat * 1000);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const arr = grid.get(`${kx + dx}:${ky + dy}`); if (!arr) continue; for (const it of arr) { const d = Math.hypot((it.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180), (it.lat - lat) * 110540); if (d < bd) { bd = d; best = it; } } }
    return best;
  };
  // Recolor in place via per-instance attributes; primitives still building asynchronously are revisited until ready.
  let recolorTimer = null;
  const recolorPrimitive = (pi) => { const prim = primitives[pi]; if (!prim || !prim.ready) return false; for (let i = pi * CHUNK; i < Math.min(buildings.length, (pi + 1) * CHUNK); i++) { let attr = null; try { attr = prim.getGeometryInstanceAttributes('osm:' + i); } catch { attr = null; } if (attr) { const it = byId.get(i); attr.color = Cesium.ColorGeometryInstanceAttribute.toValue(colorFor(it ? it.h : 10), attr.color); } } return true; };
  const setPalette = (name) => {
    if (!PALETTES[name] || name === palette) return; palette = name; if (recolorTimer) { clearTimeout(recolorTimer); recolorTimer = null; }
    const pending = primitives.map((_, i) => i);
    const step = () => { const t0 = performance.now(); while (pending.length && performance.now() - t0 < 14) { const pi = pending[0]; if (recolorPrimitive(pi)) pending.shift(); else { pending.push(pending.shift()); break; } } if (pending.length) recolorTimer = setTimeout(step, pending.every(pi => !(primitives[pi] && primitives[pi].ready)) ? 250 : 0); else recolorTimer = null; };
    step();
  };
  return { count: index.length, primitives, nearest, setShow: (on) => primitives.forEach(p => { p.show = on; }), setPalette, get palette() { return palette; }, landmarks: index.filter(x => x.name && x.h >= 60) };
}
