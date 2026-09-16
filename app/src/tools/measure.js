// 睿鏡 PeakLens — 手刻量測與畫基地工具（Cesium 官方 Measure widget 需付費 ion SDK，這裡自己刻）：量距離、量面積、畫基地→都更模擬。
// 對外介面：createMeasure({ viewer, onSite, onStatus }) → { start(mode), cancel(), clear(), get active, setTheme(t) }
import * as Cesium from 'cesium';
import './measure.css';

/* >>> PURE HELPERS — no Cesium, plain [lon,lat] degree pairs. Node-testable as-is; see measure.test.mjs >>> */
const PING_SQM = 3.305785; // 1 坪 = 3.305785 m²
export function pingOf(sqm) { return (sqm || 0) / PING_SQM; }

// Local east-north tangent-plane projection (metres) around the ring's own centroid — good enough at
// site/street scale in Taipei; avoids pulling in a geodesic area library just for a shoelace sum.
function projectLocal(ring) {
  let clon = 0, clat = 0;
  for (const p of ring) { clon += p[0]; clat += p[1]; }
  const n = ring.length; clon /= n; clat /= n;
  const mPerDegLat = 110540; // metres per degree latitude (WGS84-ish average)
  const mPerDegLon = 111320 * Math.cos(clat * Math.PI / 180); // metres per degree longitude at that latitude
  return ring.map(p => [(p[0] - clon) * mPerDegLon, (p[1] - clat) * mPerDegLat]);
}
// Drop an explicit closing duplicate (first === last) so the shoelace/perimeter loops don't double an edge.
function openedRing(pts) {
  if (pts.length > 1) { const a = pts[0], b = pts[pts.length - 1]; if (a[0] === b[0] && a[1] === b[1]) return pts.slice(0, -1); }
  return pts;
}
export function ringAreaSqm(ring) {
  if (!ring || ring.length < 3) return 0;
  const p = openedRing(projectLocal(ring)); if (p.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; sum += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(sum) / 2;
}
export function ringPerimeterM(ring) {
  if (!ring || ring.length < 2) return 0;
  const p = openedRing(projectLocal(ring)); if (p.length < 2) return 0;
  let per = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return per;
}
// plain average — fine at this scale, no need for a geodesic centroid
function ringCentroid(ring) {
  let x = 0, y = 0; const n = (ring || []).length; if (!n) return [0, 0];
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / n, y / n];
}
function segmentsIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
// simple O(n²) pairwise test across non-adjacent edges — plenty for a hand-drawn site polygon
function ringSelfIntersects(ring) {
  const p = openedRing(ring || []); const n = p.length; if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = p[i], a2 = p[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue; // skip edges that share a vertex
      if (segmentsIntersect(a1, a2, p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}
/* <<< END PURE HELPERS <<< */

const MIN_AREA_SQM = 1; // below this, treat the ring as degenerate (near-collinear / duplicate points)
const C = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
const PALETTE = {
  blue: { line: '#16A4C0', outline: '#93DCE6', glowDark: '#E3F8FA', inkLight: '#0F6A85' },
  orange: { line: '#F29628', outline: '#FCBE83', glowDark: '#FFDAA0', inkLight: '#BA5C2D' },
};
const MODE_PALETTE = { distance: PALETTE.blue, area: PALETTE.blue, site: PALETTE.orange };
const HINT_BASE = {
  distance: '量距離：點擊加點 · 雙擊完成 · 右鍵退一步 · Esc 取消',
  area: '量面積：點擊加點（至少 3 點）· 雙擊完成 · 右鍵退一步 · Esc 取消',
  site: '畫基地：點擊加點（至少 3 點）· 雙擊完成→模擬容積 · 右鍵退一步 · Esc 取消',
};
const LABEL_FONT = '600 12px "SF Mono", ui-monospace, Menlo, monospace';
const fmtNum = n => Math.round(n).toLocaleString('zh-TW');
const fmtSeg = m => Math.round(m) + ' m';
const fmtTotal = m => m >= 1000 ? '合計 ' + (m / 1000).toFixed(2) + ' km' : '合計 ' + Math.round(m) + ' m';
const fmtLive = m => m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
const flatten = pts => { const a = []; for (const p of pts) a.push(p[0], p[1]); return a; };
const toCartesians = pts => Cesium.Cartesian3.fromDegreesArray(flatten(pts));
const padded = (list, min) => { if (list.length >= min) return list; const filler = list.length ? list[list.length - 1] : [0, 0]; const out = list.slice(); while (out.length < min) out.push(filler); return out; };
function geodesicM(a, b) { return new Cesium.EllipsoidGeodesic(Cesium.Cartographic.fromDegrees(a[0], a[1]), Cesium.Cartographic.fromDegrees(b[0], b[1])).surfaceDistance; }

export function createMeasure({ viewer, onSite, onStatus }) {
  const scene = viewer.scene, camera = viewer.camera, canvas = viewer.canvas;
  const ds = new Cesium.CustomDataSource('measure-tools'); viewer.dataSources.add(ds);
  let theme = 'light', mode = null, handler = null, keyBound = false, shape = null, hintEl = null;

  const emitStatus = text => { if (typeof onStatus === 'function') onStatus(text || ''); };
  function setHint(text) {
    if (!hintEl) { hintEl = document.createElement('div'); hintEl.id = 'toolhint'; hintEl.className = 'panel hidden'; (document.getElementById('stage') || document.body).appendChild(hintEl); }
    if (text) { hintEl.textContent = text; hintEl.classList.remove('hidden'); } else { hintEl.textContent = ''; hintEl.classList.add('hidden'); }
    emitStatus(text);
  }

  /* ---- ground point capture: pickPosition (depth buffer) → globe.pick (ray/ellipsoid) → pickEllipsoid; always flattened to height 0 ---- */
  function pickGroundLonLat(windowPos) {
    let cart = null;
    if (scene.pickPositionSupported) { const p = scene.pickPosition(windowPos); if (Cesium.defined(p)) cart = p; }
    if (!cart) { const ray = camera.getPickRay(windowPos); cart = ray && scene.globe.pick(ray, scene); }
    if (!cart) cart = camera.pickEllipsoid(windowPos, scene.globe.ellipsoid);
    if (!cart) return null;
    const carto = Cesium.Cartographic.fromCartesian(cart);
    return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
  }

  /* ---- per-shape entity bookkeeping (one "shape" = one in-progress or just-finished line/polygon) ---- */
  function newShape() { return { pts: [], preview: null, vertexEnts: [], lineEnt: null, fillEnt: null, segLabelEnts: [], totalLabelEnt: null, infoLabelEnt: null }; }
  const shapePositions = s => s.preview ? [...s.pts, s.preview] : s.pts.slice();

  function labelGraphics(text, m) {
    const pal = MODE_PALETTE[m]; const light = theme === 'light';
    return { text, font: LABEL_FONT, fillColor: C(light ? pal.inkLight : pal.glowDark), outlineColor: light ? C('#FFFFFF', 0.92) : C('#030712', 0.9), outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -10),
      disableDepthTestDistance: Number.POSITIVE_INFINITY, showBackground: true, backgroundColor: light ? C('#FFFFFF', 0.82) : C('#030712', 0.65), backgroundPadding: new Cesium.Cartesian2(6, 3) };
  }
  function addVertexPoint(s, m, lonlat) {
    const pal = MODE_PALETTE[m];
    const ent = ds.entities.add({ position: Cesium.Cartesian3.fromDegrees(lonlat[0], lonlat[1], 0),
      point: { pixelSize: 7, color: C(pal.line), outlineColor: C('#FFFFFF', 0.9), outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    s.vertexEnts.push(ent);
  }
  function ensureShapeEntities(s, m) {
    const pal = MODE_PALETTE[m];
    if (m === 'distance') {
      if (s.lineEnt) return;
      s.lineEnt = ds.entities.add({ polyline: {
        positions: new Cesium.CallbackProperty(() => toCartesians(padded(shapePositions(s), 2)), false),
        clampToGround: true, width: 4, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: C(pal.line) }),
        show: new Cesium.CallbackProperty(() => shapePositions(s).length >= 2, false) } });
    } else {
      if (s.fillEnt) return;
      s.fillEnt = ds.entities.add({ polygon: {
        hierarchy: new Cesium.CallbackProperty(() => new Cesium.PolygonHierarchy(toCartesians(padded(shapePositions(s), 3))), false),
        height: 0, material: new Cesium.ColorMaterialProperty(C(pal.line, 0.22)), outline: false,
        show: new Cesium.CallbackProperty(() => shapePositions(s).length >= 3, false) } });
      s.lineEnt = ds.entities.add({ polyline: {
        positions: new Cesium.CallbackProperty(() => { const p = shapePositions(s); return toCartesians(padded(p.length ? [...p, p[0]] : p, 2)); }, false),
        clampToGround: true, width: 3, material: new Cesium.ColorMaterialProperty(C(pal.outline, 0.95)),
        show: new Cesium.CallbackProperty(() => shapePositions(s).length >= 2, false) } });
    }
  }
  function removeEntities(list) { for (const e of list) ds.entities.remove(e); }
  function discardInProgress() {
    if (!shape) return;
    removeEntities(shape.vertexEnts); removeEntities(shape.segLabelEnts);
    if (shape.lineEnt) ds.entities.remove(shape.lineEnt); if (shape.fillEnt) ds.entities.remove(shape.fillEnt);
    if (shape.totalLabelEnt) ds.entities.remove(shape.totalLabelEnt); if (shape.infoLabelEnt) ds.entities.remove(shape.infoLabelEnt);
    shape = null;
  }

  function refreshDistanceLabels(s) {
    removeEntities(s.segLabelEnts); s.segLabelEnts = [];
    let total = 0;
    for (let i = 0; i < s.pts.length - 1; i++) {
      const d = geodesicM(s.pts[i], s.pts[i + 1]); total += d;
      const mid = [(s.pts[i][0] + s.pts[i + 1][0]) / 2, (s.pts[i][1] + s.pts[i + 1][1]) / 2];
      const ent = ds.entities.add({ position: Cesium.Cartesian3.fromDegrees(mid[0], mid[1], 0), label: labelGraphics(fmtSeg(d), 'distance') });
      ent._mmode = 'distance'; s.segLabelEnts.push(ent);
    }
    if (s.pts.length >= 2) {
      const last = s.pts[s.pts.length - 1];
      if (!s.totalLabelEnt) { s.totalLabelEnt = ds.entities.add({ position: Cesium.Cartesian3.fromDegrees(last[0], last[1], 0), label: labelGraphics(fmtTotal(total), 'distance') }); s.totalLabelEnt._mmode = 'distance'; }
      else { s.totalLabelEnt.position = Cesium.Cartesian3.fromDegrees(last[0], last[1], 0); s.totalLabelEnt.label.text = fmtTotal(total); }
    } else if (s.totalLabelEnt) { ds.entities.remove(s.totalLabelEnt); s.totalLabelEnt = null; }
  }
  function refreshAreaLabel(s, m) {
    if (s.pts.length < 3) { if (s.infoLabelEnt) { ds.entities.remove(s.infoLabelEnt); s.infoLabelEnt = null; } return; }
    const area = ringAreaSqm(s.pts), per = ringPerimeterM(s.pts), c = ringCentroid(s.pts);
    const text = `${fmtNum(area)} m² · ${fmtNum(pingOf(area))} 坪 · 周長 ${fmtNum(per)} m`;
    if (!s.infoLabelEnt) { s.infoLabelEnt = ds.entities.add({ position: Cesium.Cartesian3.fromDegrees(c[0], c[1], 0), label: labelGraphics(text, m) }); s.infoLabelEnt._mmode = m; }
    else { s.infoLabelEnt.position = Cesium.Cartesian3.fromDegrees(c[0], c[1], 0); s.infoLabelEnt.label.text = text; }
  }

  function updateLiveHint(previewPoint) {
    if (!mode) return;
    let extra = '';
    if (shape && shape.pts.length) {
      const live = previewPoint ? [...shape.pts, previewPoint] : shape.pts;
      if (mode === 'distance') { if (live.length >= 2) { let t = 0; for (let i = 0; i < live.length - 1; i++) t += geodesicM(live[i], live[i + 1]); extra = ' · 目前 ' + fmtLive(t); } }
      else if (live.length >= 3) { const a = ringAreaSqm(live); extra = ' · 目前 ' + fmtNum(a) + ' m² · ' + fmtNum(pingOf(a)) + ' 坪'; }
    }
    setHint(HINT_BASE[mode] + extra);
  }
  function updateAfterChange() { if (!shape) { updateLiveHint(null); return; } if (mode === 'distance') refreshDistanceLabels(shape); else refreshAreaLabel(shape, mode); updateLiveHint(null); }

  function onLeftClick(ev) {
    const p = pickGroundLonLat(ev.position); if (!p) return;
    if (!shape) shape = newShape();
    shape.pts.push(p); shape.preview = null;
    addVertexPoint(shape, mode, p); ensureShapeEntities(shape, mode);
    updateAfterChange();
  }
  function onMouseMove(ev) {
    if (!shape || !shape.pts.length) { updateLiveHint(null); return; }
    shape.preview = pickGroundLonLat(ev.endPosition);
    updateLiveHint(shape.preview);
  }
  function onRightClick() {
    if (!shape || !shape.pts.length) return;
    shape.pts.pop(); const v = shape.vertexEnts.pop(); if (v) ds.entities.remove(v); shape.preview = null;
    if (!shape.pts.length) { discardInProgress(); updateLiveHint(null); return; }
    updateAfterChange();
  }
  // once a shape is done, swap its CallbackProperty-driven geometry for plain static values so a finished
  // measurement doesn't keep re-deriving the same Cartesian3s every render frame forever.
  function freezeShape(s, m) {
    if (m === 'distance') { if (s.lineEnt) { s.lineEnt.polyline.positions = toCartesians(s.pts); s.lineEnt.polyline.show = true; } }
    else {
      if (s.fillEnt) { s.fillEnt.polygon.hierarchy = new Cesium.PolygonHierarchy(toCartesians(s.pts)); s.fillEnt.polygon.show = true; }
      if (s.lineEnt) { s.lineEnt.polyline.positions = toCartesians([...s.pts, s.pts[0]]); s.lineEnt.polyline.show = true; }
    }
  }
  function finish() {
    if (!shape) return;
    if (mode === 'distance') {
      if (shape.pts.length < 2) { discardInProgress(); updateLiveHint(null); return; }
      shape.preview = null; refreshDistanceLabels(shape); freezeShape(shape, mode); shape = null; updateLiveHint(null); return;
    }
    if (shape.pts.length < 3) { discardInProgress(); setHint(HINT_BASE[mode] + ' · 至少需要 3 個點才能算面積'); return; }
    if (ringSelfIntersects(shape.pts)) { discardInProgress(); setHint(HINT_BASE[mode] + ' · 這個形狀邊線自我交叉了，請重畫'); return; }
    const area = ringAreaSqm(shape.pts);
    if (area < MIN_AREA_SQM) { discardInProgress(); setHint(HINT_BASE[mode] + ' · 面積太小，請重畫'); return; }
    shape.preview = null; refreshAreaLabel(shape, mode); freezeShape(shape, mode);
    if (mode === 'site' && typeof onSite === 'function') {
      onSite({ ring: [...shape.pts, shape.pts[0]], areaSqm: area, areaPing: pingOf(area), centroid: ringCentroid(shape.pts), perimeterM: ringPerimeterM(shape.pts) });
    }
    shape = null; updateLiveHint(null);
  }
  function onKeyDown(e) {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Enter') { e.preventDefault(); finish(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  }
  function bindKeys() { if (!keyBound) { window.addEventListener('keydown', onKeyDown); keyBound = true; } }
  function unbindKeys() { if (keyBound) { window.removeEventListener('keydown', onKeyDown); keyBound = false; } }

  function teardownHandler() { if (handler) { handler.destroy(); handler = null; } unbindKeys(); discardInProgress(); }

  function start(m) {
    if (!['distance', 'area', 'site'].includes(m)) return;
    teardownHandler();
    mode = m; canvas.dataset.tool = mode; shape = null;
    handler = new Cesium.ScreenSpaceEventHandler(canvas);
    handler.setInputAction(onLeftClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(onMouseMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction(finish, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    handler.setInputAction(onRightClick, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    bindKeys();
    setHint(HINT_BASE[mode]);
  }
  function cancel() { teardownHandler(); mode = null; delete canvas.dataset.tool; setHint(null); }
  function clear() { shape = null; ds.entities.removeAll(); }
  function setTheme(t) {
    theme = t === 'light' ? 'light' : 'dark';
    for (const e of ds.entities.values) {
      if (!e.label) continue; const pal = MODE_PALETTE[e._mmode || 'distance']; const light = theme === 'light';
      e.label.fillColor = C(light ? pal.inkLight : pal.glowDark); e.label.outlineColor = light ? C('#FFFFFF', 0.92) : C('#030712', 0.9);
      e.label.backgroundColor = light ? C('#FFFFFF', 0.82) : C('#030712', 0.65);
    }
  }

  return { start, cancel, clear, get active() { return mode; }, setTheme };
}
