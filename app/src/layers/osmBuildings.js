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
  // 對焦／X-ray: while a focus is active, recolorPrimitive recedes everything outside radiusM toward a palette-aware
  // muted tone and keeps (optionally brightened) the palette colour inside — always recomputed from colorFor(), so
  // re-focusing or switching palette is idempotent (never blends from an already-receded colour).
  const RECEDE = { light: { to: Cesium.Color.fromCssColorString('#E8ECF1'), amt: 0.78 }, dark: { to: Cesium.Color.fromCssColorString('#0B1220'), amt: 0.70 } };
  const FOCUS_BRIGHTEN = 0.06;
  let focusState = null; // { lon, lat, radiusM, keepIds:Set<number>, insideSet:Set<number> } | null
  const distM = (lon1, lat1, lon2, lat2) => Math.hypot((lon1 - lon2) * 111320 * Math.cos(lat2 * Math.PI / 180), (lat1 - lat2) * 110540);
  const insideSetFor = (lon, lat, radiusM) => { // reuse the centroid grid: scan only the cells near (lon,lat) rather than all buildings.length instances
    const inside = new Set(); const dLat = radiusM / 110540, dLon = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
    const kx = Math.floor(lon * 1000), ky = Math.floor(lat * 1000), rx = Math.ceil(dLon * 1000) + 1, ry = Math.ceil(dLat * 1000) + 1;
    for (let dx = -rx; dx <= rx; dx++) for (let dy = -ry; dy <= ry; dy++) { const arr = grid.get(`${kx + dx}:${ky + dy}`); if (!arr) continue; for (const it of arr) if (distM(it.lon, it.lat, lon, lat) <= radiusM) inside.add(it.i); }
    return inside;
  };
  const focusColorFor = (it) => {
    const base = colorFor(it ? it.h : 10); if (!it) return base;
    if (focusState.insideSet.has(it.i) || focusState.keepIds.has(it.i)) return FOCUS_BRIGHTEN ? base.brighten(FOCUS_BRIGHTEN, new Cesium.Color()) : base;
    const r = RECEDE[palette] || RECEDE.dark; return Cesium.Color.lerp(base, r.to, r.amt, new Cesium.Color());
  };
  let recolorTimer = null;
  const recolorPrimitive = (pi) => { const prim = primitives[pi]; if (!prim || !prim.ready) return false; for (let i = pi * CHUNK; i < Math.min(buildings.length, (pi + 1) * CHUNK); i++) { let attr = null; try { attr = prim.getGeometryInstanceAttributes('osm:' + i); } catch { attr = null; } if (attr) { const it = byId.get(i); attr.color = Cesium.ColorGeometryInstanceAttribute.toValue(focusState ? focusColorFor(it) : colorFor(it ? it.h : 10), attr.color); } } return true; };
  const runRecolor = () => { // shared chunked driver (≤14ms/tick, revisit not-ready primitives, back off to 250ms once none are ready) used by setPalette/focus/unfocus alike
    if (recolorTimer) { clearTimeout(recolorTimer); recolorTimer = null; }
    const pending = primitives.map((_, i) => i);
    const step = () => { const t0 = performance.now(); while (pending.length && performance.now() - t0 < 14) { const pi = pending[0]; if (recolorPrimitive(pi)) pending.shift(); else { pending.push(pending.shift()); break; } } if (pending.length) recolorTimer = setTimeout(step, pending.every(pi => !(primitives[pi] && primitives[pi].ready)) ? 250 : 0); else recolorTimer = null; };
    step();
  };
  const setPalette = (name) => { if (!PALETTES[name] || name === palette) return; palette = name; runRecolor(); /* focus (if any) is re-applied for free: recolorPrimitive reads live focusState/palette */ };
  const focusedInfo = () => focusState ? { lon: focusState.lon, lat: focusState.lat, radiusM: focusState.radiusM, keepIds: [...focusState.keepIds] } : null;
  const focus = ({ lon, lat, radiusM = 320, keepIds = [] } = {}) => {
    if (lon == null || lat == null) return focusedInfo();
    focusState = { lon, lat, radiusM, keepIds: new Set(keepIds), insideSet: insideSetFor(lon, lat, radiusM) };
    runRecolor(); return focusedInfo();
  };
  const unfocus = () => { if (!focusState) return; focusState = null; runRecolor(); };
  return { count: index.length, primitives, nearest, setShow: (on) => primitives.forEach(p => { p.show = on; }), setPalette, get palette() { return palette; }, landmarks: index.filter(x => x.name && x.h >= 60), focus, unfocus, get focused() { return focusedInfo(); } };
}
