// OSM building footprints → batched extruded primitives (keyless 3D city). Data: public/data/osm_buildings_taipei.json
// Landmark shape (§16.7): public/data/osm_parts_taipei.json (scripts/fetch-osm-parts.mjs) carries per-building
// `building:part` segments (Taipei 101's podium vs tower, stepped massing on 南山廣場/微風南山, …), each with its
// own min_height/height. Loaded best-effort alongside the flat boxes below — a missing/failed parts fetch never
// breaks the app, it just means every building renders as a single tapered box like before this feature landed.
import * as Cesium from 'cesium';
import { FACADE_VERTEX_FORMAT, facadeAppearance, plainAppearance, facadeAttributes } from './facade.js';

// Two building palettes: 夜間戰情室 (dark glassy gradient) and PickPeak 日間 (soft white → cyan-tinted, taller = more saturated).
export const PALETTES = {
  dark: (t) => new Cesium.Color((28 + 40 * t) / 255, (44 + 70 * t) / 255, (78 + 110 * t) / 255, 1),
  light: (t) => new Cesium.Color((236 - 96 * t) / 255, (240 - 36 * t) / 255, (244 - 12 * t) / 255, 1),
};

export async function loadOsmBuildings(viewer, url, onProgress, { palette: initialPalette = 'dark', facade: initialFacade = false } = {}) {
  let facade = !!initialFacade;
  // public/data/osm_parts_taipei.json lives next to the buildings file; fired off in parallel with the (much
  // bigger) buildings fetch below so it doesn't add to the critical path. Best-effort: any failure (404, bad
  // JSON, network) just leaves partsData null and every building falls back to its own single-box extrusion.
  const partsUrl = url.replace(/osm_buildings_taipei\.json(?=$|[?#])/, 'osm_parts_taipei.json');
  const partsPromise = partsUrl !== url
    ? fetch(partsUrl).then(r => r.ok ? r.json() : null).catch(e => { console.warn('[osm] building:part 分段量體未載入（不影響白模主體）:', e.message); return null; })
    : Promise.resolve(null);

  const res = await fetch(url); if (!res.ok) throw new Error('osm buildings fetch failed ' + res.status);
  const data = await res.json(); const { origin, scale } = data.meta; const [ox, oy] = origin;
  const buildings = data.b; const types = data.types || []; const index = []; // centroid index for matching FUNRAISE buildings to footprints

  const partsData = await partsPromise;
  const partsRows = (partsData && Array.isArray(partsData.parts)) ? partsData.parts : [];
  const suppressSet = new Set((partsData && Array.isArray(partsData.suppress)) ? partsData.suppress : []); // parent building indices whose own box is fully replaced by its parts
  const tallestByParent = new Map(); // parent index → tallest matched part's top height (m); used to correct a suppressed parent's `h` in `index`
  for (const row of partsRows) { const parent = row[4]; if (parent == null || parent < 0) continue; const h = (row[1] || 0) / 10; if (h > (tallestByParent.get(parent) || 0)) tallestByParent.set(parent, h); }

  const CHUNK = 1500; const primitives = []; const primMeta = []; // primMeta[pi] = { start, end, kind:'b'|'p' } — which index range (building or part) primitives[pi] covers, for recolorAt()
  let palette = PALETTES[initialPalette] ? initialPalette : 'dark';
  const colorFor = (hm) => PALETTES[palette](Math.min(1, hm / 120)); // height → palette gradient

  for (let c = 0; c < buildings.length; c += CHUNK) {
    const instances = []; const startI = c, endI = Math.min(c + CHUNK, buildings.length);
    for (let i = startI; i < endI; i++) {
      const b = buildings[i]; const suppressed = suppressSet.has(i);
      const hmOwn = (b[0] || 100) / 10; const hm = suppressed ? (tallestByParent.get(i) ?? hmOwn) : hmOwn; // suppressed parent keeps the tallest-part height in `index` even though its own box isn't drawn
      const flat = b[2]; if (!flat || flat.length < 8) continue;
      const degs = new Array(flat.length); let cx = 0, cy = 0; const n = flat.length / 2; let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (let k = 0; k < flat.length; k += 2) { const lon = ox + flat[k] / scale, lat = oy + flat[k + 1] / scale; degs[k] = lon; degs[k + 1] = lat; cx += lon; cy += lat; if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon; if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat; }
      const bw = Math.max(3, (maxLon - minLon) * 111320 * Math.cos(cy / n * Math.PI / 180)), bh = Math.max(3, (maxLat - minLat) * 110540);
      index.push({ i, lon: cx / n, lat: cy / n, h: hm, name: b[3] || null, type: types[b[1]] || 'yes', ring: degs });
      if (suppressed) continue; // its parts already fully express this building's shape (see fetch-osm-parts.mjs's suppress rule) — don't also draw the flattened one-box version underneath them
      try {
        instances.push(new Cesium.GeometryInstance({
          geometry: Cesium.PolygonGeometry.fromPositions({ positions: Cesium.Cartesian3.fromDegreesArray(degs), extrudedHeight: hm, height: 0, vertexFormat: FACADE_VERTEX_FORMAT }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colorFor(hm)), ...facadeAttributes({ hm, cx: cx / n, cy: cy / n, bw, bh }) }, id: 'osm:' + i,
        }));
      } catch (e) { /* skip degenerate */ }
    }
    if (instances.length) {
      const p = new Cesium.Primitive({ geometryInstances: instances, appearance: initialFacade ? facadeAppearance() : plainAppearance(), asynchronous: true, allowPicking: false, releaseGeometryInstances: true });
      viewer.scene.primitives.add(p); primitives.push(p); primMeta[primitives.length - 1] = { start: startI, end: endI, kind: 'b' };
    }
    onProgress && onProgress(Math.min(1, (c + CHUNK) / buildings.length));
    await new Promise(r => setTimeout(r, 0));
  }

  // building:part 分段量體：跟上面完全同一套 batching/appearance 機制，只是 (a) 用自己的 min_height/height 當
  // extrude 的 base/top（不是永遠從 0 蓋到頂），(b) id 帶著母建物索引方便除錯／未來查詢，(c) 顏色種子用自己的
  // 高度（H），不是母建物的。partMetaById 給 recolorAt() 用：沒有母建物（parentIndex=-1，例如落單的屋突/水塔量
  // 體）時退回用自己的中心點判斷「是否在對焦半徑內」，見下面 focusColorFor()。
  const partMetaById = new Map(); // k (parts 陣列的全域索引) → { parent, h, lon, lat, name, type }
  const partsOrigin = (partsData && partsData.meta && partsData.meta.origin) || origin;
  const partsScale = (partsData && partsData.meta && partsData.meta.scale) || scale;
  const [pox, poy] = partsOrigin;
  for (let c = 0; c < partsRows.length; c += CHUNK) {
    const instances = []; const startK = c, endK = Math.min(c + CHUNK, partsRows.length);
    for (let k = startK; k < endK; k++) {
      const row = partsRows[k]; const minH = (row[0] || 0) / 10, H = (row[1] || 0) / 10, typeIdx = row[2], flat = row[3];
      const parent = row[4] != null ? row[4] : -1; const name = row[5] || null;
      if (!flat || flat.length < 8 || !(H > minH)) continue; // 退化環或高度不合理（頂高沒有嚴格大於底高）都跳過，不畫一個看不出來的薄片
      const degs = new Array(flat.length); let cx = 0, cy = 0; const n = flat.length / 2; let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (let j = 0; j < flat.length; j += 2) { const lon = pox + flat[j] / partsScale, lat = poy + flat[j + 1] / partsScale; degs[j] = lon; degs[j + 1] = lat; cx += lon; cy += lat; if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon; if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat; }
      const pcx = cx / n, pcy = cy / n; const bw = Math.max(3, (maxLon - minLon) * 111320 * Math.cos(pcy * Math.PI / 180)), bh = Math.max(3, (maxLat - minLat) * 110540);
      partMetaById.set(k, { parent, h: H, lon: pcx, lat: pcy, name, type: types[typeIdx] || 'yes' });
      const id = parent >= 0 ? `osm:${parent}:p${k}` : `osmp:${k}`;
      try {
        instances.push(new Cesium.GeometryInstance({
          geometry: Cesium.PolygonGeometry.fromPositions({ positions: Cesium.Cartesian3.fromDegreesArray(degs), height: minH, extrudedHeight: H, vertexFormat: FACADE_VERTEX_FORMAT }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colorFor(H)), ...facadeAttributes({ hm: H, cx: pcx, cy: pcy, bw, bh }) }, id,
        }));
      } catch (e) { /* skip degenerate */ }
    }
    if (instances.length) {
      const p = new Cesium.Primitive({ geometryInstances: instances, appearance: initialFacade ? facadeAppearance() : plainAppearance(), asynchronous: true, allowPicking: false, releaseGeometryInstances: true });
      viewer.scene.primitives.add(p); primitives.push(p); primMeta[primitives.length - 1] = { start: startK, end: endK, kind: 'p' };
    }
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
  // 對焦／X-ray: while a focus is active, recolorAt recedes everything outside radiusM toward a palette-aware
  // muted tone and keeps (optionally brightened) the palette colour inside — always recomputed from colorFor(), so
  // re-focusing or switching palette is idempotent (never blends from an already-receded colour). Buildings and
  // building:part instances share this exact mechanism (see recolorAt below): a part inherits its parent
  // building's inside/kept status (so a landmark's podium+tower recede or highlight together as one unit); a
  // standalone part with no matched parent (parent:-1) falls back to judging its own centroid against the radius.
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
  // meta: a building `it` ({i,h,lon,lat,…}) or a part's partMetaById entry ({parent,h,lon,lat,…}). Keyed off
  // `parent` when present (parts), else `i` (buildings) — a part with no parent match (parent:-1) has no id to
  // look up in insideSet/keepIds, so it judges inside-ness directly from its own centroid instead.
  const isInsideOrKept = (meta) => {
    const ownerIdx = meta.parent != null ? meta.parent : meta.i;
    if (ownerIdx != null && ownerIdx >= 0) return focusState.insideSet.has(ownerIdx) || focusState.keepIds.has(ownerIdx);
    if (meta.lon != null && meta.lat != null) return distM(meta.lon, meta.lat, focusState.lon, focusState.lat) <= focusState.radiusM;
    return false;
  };
  const focusColorFor = (meta) => {
    const base = colorFor(meta ? meta.h : 10); if (!meta) return base;
    if (isInsideOrKept(meta)) return FOCUS_BRIGHTEN ? base.brighten(FOCUS_BRIGHTEN, new Cesium.Color()) : base;
    const r = RECEDE[palette] || RECEDE.dark; return Cesium.Color.lerp(base, r.to, r.amt, new Cesium.Color());
  };
  let recolorTimer = null;
  const recolorAt = (pi) => { // generalized over primMeta[pi]: same contract as before (building-only) — false = primitive not ready yet, revisit later
    const prim = primitives[pi]; if (!prim || !prim.ready) return false;
    const { start, end, kind } = primMeta[pi];
    for (let k = start; k < end; k++) {
      const m = kind === 'b' ? byId.get(k) : partMetaById.get(k);
      const id = kind === 'b' ? ('osm:' + k) : ((m && m.parent >= 0) ? `osm:${m.parent}:p${k}` : `osmp:${k}`);
      let attr = null; try { attr = prim.getGeometryInstanceAttributes(id); } catch { attr = null; }
      if (attr) attr.color = Cesium.ColorGeometryInstanceAttribute.toValue(focusState ? focusColorFor(m) : colorFor(m ? m.h : 10), attr.color);
    }
    return true;
  };
  const runRecolor = () => { // shared chunked driver (≤14ms/tick, revisit not-ready primitives, back off to 250ms once none are ready) used by setPalette/focus/unfocus alike
    if (recolorTimer) { clearTimeout(recolorTimer); recolorTimer = null; }
    const pending = primitives.map((_, i) => i);
    const step = () => { const t0 = performance.now(); while (pending.length && performance.now() - t0 < 14) { const pi = pending[0]; if (recolorAt(pi)) pending.shift(); else { pending.push(pending.shift()); break; } } if (pending.length) recolorTimer = setTimeout(step, pending.every(pi => !(primitives[pi] && primitives[pi].ready)) ? 250 : 0); else recolorTimer = null; };
    step();
  };
  const setPalette = (name) => { if (!PALETTES[name] || name === palette) return; palette = name; runRecolor(); /* focus (if any) is re-applied for free: recolorAt reads live focusState/palette */ };
  const focusedInfo = () => focusState ? { lon: focusState.lon, lat: focusState.lat, radiusM: focusState.radiusM, keepIds: [...focusState.keepIds] } : null;
  const focus = ({ lon, lat, radiusM = 320, keepIds = [] } = {}) => {
    if (lon == null || lat == null) return focusedInfo();
    focusState = { lon, lat, radiusM, keepIds: new Set(keepIds), insideSet: insideSetFor(lon, lat, radiusM) };
    runRecolor(); return focusedInfo();
  };
  const unfocus = () => { if (!focusState) return; focusState = null; runRecolor(); };
  const setFacade = (on) => { on = !!on; if (on === facade) return facade; facade = on; for (const p of primitives) p.appearance = on ? facadeAppearance() : plainAppearance(); return facade; };
  const setVisible = (on) => primitives.forEach(p => { p.show = on; }); // whole layer (buildings + parts) on/off — e.g. the Photorealistic 3D Tiles "相片級" Look hides the white-box city underneath it
  return {
    count: index.length, partCount: partsRows.length, primitives, nearest, setFacade, get facade() { return facade; },
    setVisible, setShow: setVisible, // setShow kept as an alias for anything still calling the old name
    setPalette, get palette() { return palette; }, landmarks: index.filter(x => x.name && x.h >= 60), focus, unfocus, get focused() { return focusedInfo(); },
  };
}
