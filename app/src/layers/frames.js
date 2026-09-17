// src/layers/frames.js — Phase 10P 玻璃殼＋屋頂光環（docs/11-v2-cesium-app.md §18.1）。
//
// 「有資料的那些棟框起來做特殊標示」：156 棟 FUNRAISE 商辦裡，凡是能對到 OSM 足跡的，都畫一圈可見的暗示——
// 半透明玻璃殼（足跡外擴約 1.5m）＋屋頂發光輪廓線＋往上接到浮空 icon 的細針腳。這不是「假紋理」，是「這棟
// 有資料、可以點」的統一視覺提示，跟實景／白模都相容：實景下 OSM 白模隱藏、殼取代它們的量體感；白模／日照／
// 黃金／夜景下 OSM 本體照舊，殼隱藏，只留屋頂光環（到處都在，才是穩定的「有資料」暗示，不是只有進實景才看得到）。
// 未來供給（尚未真正落成，不存在於空拍網格）沒有殼，但也給一圈虛線屋頂，同樣標示「有資料」。
import * as Cesium from 'cesium';

const D2R = Math.PI / 180;
const C = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
const GRADE_COLOR = { A: '#16A4C0', P: '#16A4C0', B: '#7FA6B8', F: '#F29628' }; // 藍本藍 P/A · 建構灰藍 B · 人文橘 F
const gradeColor = grade => GRADE_COLOR[grade] || GRADE_COLOR.B;
const gradeAlpha = grade => (grade === 'A' || grade === 'P') ? 0.18 : 0.13; // §18.1 alpha 0.12–0.18：等級高的殼稍微更看得見
const INFLATE_M = 1.5;
const MOPS_LINK_M = 80; // mops 沒有 building_id 可以直接對，退而求其次用地理鄰近（跟本檔其它模組的 distM 慣例一致）
const distM = (lon1, lat1, lon2, lat2) => Math.hypot((lon1 - lon2) * 111320 * Math.cos(lat2 * D2R), (lat1 - lat2) * 110540);

/** 足跡 ring（度，[lon,lat,lon,lat,…]）以自己重心為中心，往外推 inflateM 公尺（近似：非圓形多邊形的外推量
 *  會因局部曲率略有誤差，但對 1.5m 的殼厚已經足夠——跟本模組其它幾何運算同一套「夠用就好」原則）。 */
function inflateRing(ring, inflateM) {
  let cx = 0, cy = 0; const n = ring.length / 2;
  for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cy += ring[i + 1]; }
  cx /= n; cy /= n;
  const mLon = 111320 * Math.cos(cy * D2R) || 1, mLat = 110540;
  const out = new Array(ring.length);
  for (let i = 0; i < ring.length; i += 2) {
    const dx = (ring[i] - cx) * mLon, dy = (ring[i + 1] - cy) * mLat, d = Math.hypot(dx, dy) || 1, f = (d + inflateM) / d;
    out[i] = cx + (dx * f) / mLon; out[i + 1] = cy + (dy * f) / mLat;
  }
  return out;
}
function squareRing(lon, lat, sideM) {
  const mLon = 111320 * Math.cos(lat * D2R) || 1, mLat = 110540, h = sideM / 2;
  return [lon - h / mLon, lat - h / mLat, lon + h / mLon, lat - h / mLat, lon + h / mLon, lat + h / mLat, lon - h / mLon, lat + h / mLat];
}
function ringPositionsAt(ringDegs, height) {
  const flat = []; for (let i = 0; i < ringDegs.length; i += 2) flat.push(ringDegs[i], ringDegs[i + 1], height);
  const pos = Cesium.Cartesian3.fromDegreesArrayHeights(flat); pos.push(pos[0]); return pos;
}
/** 哪些商辦跟至少一筆上市櫃資產交易「地理鄰近」——mops 沒有直接的 building_id 外鍵，用座標鄰近當代理指標
 *  （跟 funraise.js 用 osm.nearest() 做建物↔足跡匹配是同一種「沒有 key 就用位置」的慣例）。 */
function mopsLinkedIds(buildings, mops) {
  const linked = new Set();
  for (const b of buildings) { if (b.lat == null) continue;
    for (const m of mops || []) { if (m.lat == null) continue; if (distM(b.lon, b.lat, m.lon, m.lat) <= MOPS_LINK_M) { linked.add(b.id); break; } } }
  return linked;
}

/**
 * @param {{viewer:import('cesium').Viewer, osm:object, layers:object, data:object}} ctx `data` 跟 main.js 傳給
 *   `new FunraiseLayers(viewer, data, …)` 的是同一個物件，`buildings[]`／`future_dev[]` 上的 `_h`／`_built`
 *   （由 FunraiseLayers.buildStock()／buildFuture() 寫入）在這裡直接讀得到，不需要 funraise.js 額外暴露什麼。
 */
export function createFrames({ viewer, osm, layers, data }) {
  const scene = viewer.scene;
  const ds = new Cesium.CustomDataSource('frames'); viewer.dataSources.add(ds); ds.show = true; // 屋頂光環／針腳：任何 Look 都在
  let shellPrimitive = null;
  const recs = new Map(); // b.id → { b, roof, needle }
  const mopsLinked = mopsLinkedIds(data.buildings || [], data.mops || []);
  let lens = 'occupier', theme = 'light';

  const colorFor = b => lens === 'investor' ? (mopsLinked.has(b.id) ? '#F29628' : '#16A4C0') : gradeColor(b.grade);
  const roofMat = (col, a) => new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: C(col, a) });

  /* ---- 玻璃殼：批次進同一個 Primitive（§18.1「Batch shells in one Primitive」），每個 instance 帶 color／show
     兩個 per-instance attribute，之後 setLens()/setYear() 都用 getGeometryInstanceAttributes() 改，不重建 primitive。 ---- */
  const instances = []; const matched = []; // matched[i] 對應 instances[i] 的 { b, foot }
  for (const b of data.buildings || []) {
    if (!b.lat || b._h == null) continue;
    const foot = osm && osm.nearest ? osm.nearest(b.lon, b.lat, 48) : null; if (!foot || !foot.ring || foot.ring.length < 6) continue; // 沒有足跡可對：跳過，不畫殼
    const ring = inflateRing(foot.ring, INFLATE_M);
    const built = b._built == null || b._built <= layers.year;
    try {
      instances.push(new Cesium.GeometryInstance({
        geometry: Cesium.PolygonGeometry.fromPositions({ positions: Cesium.Cartesian3.fromDegreesArray(ring), height: 0, extrudedHeight: b._h, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(C(colorFor(b), gradeAlpha(b.grade))), show: new Cesium.ShowGeometryInstanceAttribute(built) },
        id: 'frame:' + b.id,
      }));
      matched.push({ b, foot });
    } catch { /* 退化足跡：跳過 */ }
  }
  if (instances.length) { shellPrimitive = new Cesium.Primitive({ geometryInstances: instances, appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, closed: true, flat: false }), asynchronous: true, allowPicking: false, releaseGeometryInstances: false }); scene.primitives.add(shellPrimitive); }

  /* ---- 屋頂光環＋針腳：entity，跟殼分開存放（entity 好單獨改色／改粗細，殼走 batch attribute）。disableDepthTestDistance
     是刻意的：這一圈光環跟同一棟樓的 funraise.js `stock`量體幾乎貼在同一個屋頂高度上（見 buildStock() 也是用同一個
     b._h），不加這個的話光環會被自己這棟樓的量體整個蓋住，看起來像沒畫——跟這棟樓「真的擋住別的東西」的一般情況
     不同，這裡兩塊幾何本來就是同一棟樓，不是誰擋住誰。 ---- */
  for (const { b, foot } of matched) {
    const col = colorFor(b); const built = b._built == null || b._built <= layers.year;
    const roof = ds.entities.add({ show: built, polyline: { positions: ringPositionsAt(foot.ring, b._h + 0.6), width: 5, material: roofMat(col, 0.9), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 20000), disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    const needle = ds.entities.add({ show: built, polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights([b.lon, b.lat, b._h, b.lon, b.lat, b._h + 10]), width: 1, material: C(col, 0.75), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 20000), disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    recs.set(b.id, { b, roof, needle });
  }

  /* ---- 未來供給幽靈量體：本來就沒有實體可對（還沒蓋），只給一圈虛線屋頂標示「這裡有資料」 ---- */
  const futureRoofs = [];
  for (const f of data.future_dev || []) {
    if (!f.lat) continue;
    const h = (f.floors_above || 20) * (f.typical_floor_height || 3.6) + 4;
    const side = Math.max(22, Math.min(70, Math.sqrt(f.max_floor_area || 1000) * 1.15));
    const ring = squareRing(f.lon, f.lat, side);
    const e = ds.entities.add({ polyline: { positions: ringPositionsAt(ring, h + 0.6), width: 3, material: new Cesium.PolylineDashMaterialProperty({ color: C('#93DCE6', .85), gapColor: C('#93DCE6', .12), dashLength: 16 }), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 20000), disableDepthTestDistance: Number.POSITIVE_INFINITY } });
    futureRoofs.push(e);
  }

  /* ---- setLens()/emphasize()/setYear() 要重新讀 primitive 的 per-instance attribute；剛建立時可能還沒
     ready，跟 osmBuildings.js 的 runRecolor() 同一種「還沒 ready 就晚點再試」慣例，只是這裡量體小
     （≤156 棟）不需要分批，簡單 setTimeout 重試就夠。 ---- */
  function withShellAttr(id, fn) {
    if (!shellPrimitive) return;
    if (!shellPrimitive.ready) { setTimeout(() => withShellAttr(id, fn), 120); return; }
    let attr = null; try { attr = shellPrimitive.getGeometryInstanceAttributes('frame:' + id); } catch { attr = null; }
    if (attr) fn(attr);
  }

  function setVisible(on) { if (shellPrimitive) shellPrimitive.show = !!on; return !!on; }
  function setTheme(t) {
    theme = t === 'dark' ? 'dark' : 'light';
    const night = theme === 'dark'; // §18.1 夜景：屋頂光環更亮一點；其餘 Look 維持原樣
    for (const { b, roof, needle } of recs.values()) { const col = colorFor(b); roof.polyline.material = roofMat(col, night ? 1 : 0.9); roof.polyline.width = night ? 6 : 5; needle.polyline.material = C(col, night ? 0.95 : 0.75); }
    return theme;
  }
  function setLens(l) {
    lens = l === 'investor' ? 'investor' : 'occupier';
    for (const { b, roof, needle } of recs.values()) {
      const col = colorFor(b);
      withShellAttr(b.id, attr => { attr.color = Cesium.ColorGeometryInstanceAttribute.toValue(C(col, gradeAlpha(b.grade)), attr.color); });
      roof.polyline.material = roofMat(col, theme === 'dark' ? 1 : 0.9); needle.polyline.material = C(col, theme === 'dark' ? 0.95 : 0.75);
    }
    return lens;
  }
  /** explain.js／scenes.js 之後會用：把指定的 keys（'stock:<id>' 或裸 id）強調到 level（0 正常、1 亮、2 更亮＋變粗）。 */
  function emphasize(keys, level = 1) {
    const ids = new Set((keys || []).map(k => { const s = String(k); return s.includes(':') ? s.split(':')[1] : s; }));
    for (const [id, { b, roof }] of recs) {
      const hot = ids.has(String(id)); const lvl = hot ? level : 0; const col = colorFor(b);
      withShellAttr(id, attr => { attr.color = Cesium.ColorGeometryInstanceAttribute.toValue(C(col, lvl > 0 ? Math.min(1, 0.35 + 0.25 * lvl) : gradeAlpha(b.grade)), attr.color); });
      roof.polyline.width = lvl > 0 ? 5 + 3 * lvl : (theme === 'dark' ? 6 : 5); roof.polyline.material = roofMat(col, lvl > 0 ? 1 : (theme === 'dark' ? 1 : 0.9));
    }
  }
  function setYear(y) {
    for (const [id, { b, roof, needle }] of recs) { const built = b._built == null || b._built <= y; roof.show = built; needle.show = built; withShellAttr(id, attr => { attr.show = Cesium.ShowGeometryInstanceAttribute.toValue(built, attr.show); }); }
  }

  return { setVisible, setTheme, setLens, emphasize, setYear, get lens() { return lens; }, count: matched.length, futureCount: futureRoofs.length };
}
