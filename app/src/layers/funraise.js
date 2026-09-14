// FUNRAISE MCP data → Cesium entity layers (one CustomDataSource per layer, GEV-style layer registry)
import * as Cesium from 'cesium';
import { icon, clusterImage } from './icons.js';
const D2R = Math.PI / 180;
const BB = (name, color, size = 30, far = 26000) => ({ image: icon(name, color, 64), width: size, height: size, verticalOrigin: Cesium.VerticalOrigin.CENTER, disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new Cesium.NearFarScalar(600, 1.15, far, 0.45), translucencyByDistance: new Cesium.NearFarScalar(far * 0.8, 1, far * 1.6, 0.15) });
export const LAYERS = {
  stock:    { name: '商辦存量',        color: '#FCBE83', glyph: 'box',     desc: 'FUNRAISE 商辦資料庫 · 等級 / 屋齡 / 認證 / 捷運距離 / 照片' },
  future:   { name: '未來供給（規劃中）', color: '#93DCE6', glyph: 'ghost', icon: 'ghost',   desc: '興建中／規劃中建案 · 逐層用途 · 完工年（隨時間軸長高）' },
  licenses: { name: '建照（即將開工）',   color: '#50C0D4', glyph: 'pulse', icon: 'permit',   desc: '臺北市 114–115 年建照 · 未來 24–48 月新供給訊號' },
  renewal:  { name: '都更單元',        color: '#C4B5FD', glyph: 'polygon', icon: 'renew', desc: '都更地區／單元圖形 · 政府主導／已核定事業' },
  zones:    { name: '重劃／區段徵收',   color: '#A78BFA', glyph: 'hex',     desc: '臺北市 73 筆市地重劃／區段徵收' },
  mops:     { name: '上市櫃資產交易',   color: '#F29628', glyph: 'diamond', icon: 'deal', desc: '公開資訊觀測站 取得／處分資產（近 12 月）' },
  moves:    { name: '企業遷徙',        color: '#DE7020', glyph: 'arc', icon: 'arrow',     desc: '公司登記地址跨區異動（2026-07）· 由原址飛向新址' },
  infra:    { name: '公共建設（興建中）', color: '#BBEAF0', glyph: 'square', icon: 'crane',  desc: '捷運環狀線／信義東延／汐東線 · TOD 開發' },
  parks:    { name: '產業園區',        color: '#6EE7B7', glyph: 'ring', icon: 'factory',    desc: '產業園區範圍' },
  heat:     { name: '商圈行情',        color: '#FCBE83', glyph: 'heat', icon: 'coin',    desc: '商圈租金／售價熱度' },
  parcels:  { name: '地號（都更模擬）',  color: '#93DCE6', glyph: 'polygon', icon: 'parcel', desc: '台北市地籤圖：選定都更單元內的地號、面積、使用分區（FUNRAISE MCP land-info）' },
  mrt:      { name: '捷運路網',        color: '#99A1AF', glyph: 'line', icon: 'metro',    desc: '台北捷運 6 線（OSM）' },
};
const C = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
const MRT_COLOR = { '文湖線': '#C48C31', '淡水信義線': '#E3002C', '松山新店線': '#008659', '中和新蘂線': '#F8B61C', '中和新蘆線': '#F8B61C', '板南線': '#0070BD', '環狀線': '#FFDB00' };
const yearOf = s => { if (!s) return null; const m = String(s).match(/(\d{4})/); if (m) return +m[1]; const r = String(s).match(/^(\d{3})/); return r ? +r[1] + 1911 : null; };
const FONT = '500 13px "Inter", "Noto Sans TC", sans-serif', MONO = '600 11px "SF Mono", ui-monospace, Menlo, monospace';
const label = (text, opts = {}) => ({ text, font: opts.font || FONT, fillColor: C(opts.color || '#F3F4F6'), outlineColor: C('#030712', .9), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, opts.dy ?? -14), verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, opts.far || 3500), scale: opts.scale || 1, showBackground: !!opts.bg, backgroundColor: C('#030712', .65), backgroundPadding: new Cesium.Cartesian2(6, 3) });

export class FunraiseLayers {
  constructor(viewer, data, basemap, osm) {
    this.viewer = viewer; this.d = data; this.base = basemap || {}; this.osm = osm; this.year = new Date().getFullYear(); this.now = this.year; this.t0 = performance.now();
    this.ds = {}; this.byKey = new Map(); this.highlight = new Map(); this.vis = Object.fromEntries(Object.keys(LAYERS).map(k => [k, true]));
    for (const k of [...Object.keys(LAYERS), 'labels', 'markers', 'fx']) { this.ds[k] = new Cesium.CustomDataSource(k); viewer.dataSources.add(this.ds[k]); }
    this.prevYear = this.year; this.yearChangedAt = 0;
    this.districtCentroids = new Map(); for (const d of this.base.districts || []) { const r = d.rings && d.rings[0]; if (!r) continue; let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } this.districtCentroids.set(d.name, [x / r.length, y / r.length]); }
  }
  add(layer, key, item, ent) { ent.properties = { pl: { layer, key, item } }; const e = this.ds[layer].entities.add(ent); this.byKey.set(key, e); return e; }
  get t() { return (performance.now() - this.t0) / 1000; }
  isHot(key) { const u = this.highlight.get(key); return u && u > performance.now(); }
  pulse(key, ms = 7000) { this.highlight.set(key, performance.now() + ms); }
  setVisible(k, on) { if (this.ds[k]) { this.ds[k].show = on; this.vis[k] = on; if (k === 'stock') this.ds.markers.show = on; } }
  /* Density budget (Direction C): scale label reach and hide low-importance labels when immersive. */
  setTheme(theme) { // light: darker text on white halo + white-disc icons (PickPeak); dark: original glow colours on dark halo
    const light = theme === 'light'; const DARK_INK = { stock: '#9A4B12', heat: '#9A4B12', mops: '#B45309', moves: '#B45309', future: '#0F6A85', licenses: '#0F6A85', infra: '#0F6A85', renewal: '#6D28D9', zones: '#6D28D9', parks: '#047857', mrt: '#374151' };
    const ICON_INK = { stock: '#0C83A2', heat: '#BA5C2D', mops: '#DE7020', moves: '#BA5C2D', future: '#0F6A85', licenses: '#0C83A2', infra: '#0F6A85', renewal: '#6D28D9', zones: '#6D28D9', parks: '#047857', mrt: '#374151' };
    for (const ds of Object.values(this.ds)) for (const e of ds.entities.values) {
      const pl = e.properties && e.properties.pl ? e.properties.pl.getValue() : null;
      if (e.billboard && pl) { const name = ds === this.ds.markers ? 'tower' : (LAYERS[pl.layer] && LAYERS[pl.layer].icon); if (name && e.billboard.image) { if (!e._img0) e._img0 = e.billboard.image.getValue(); const ink = ds === this.ds.markers && /^[AP]$/.test(pl.item.grade || '') ? '#DE7020' : (ICON_INK[pl.layer] || '#1E2939'); e.billboard.image = light ? icon(name, ink, 64, { bg: 'rgba(255,255,255,0.94)' }) : e._img0; } }
      if (!e.label) continue; if (!e._fill) e._fill = e.label.fillColor ? e.label.fillColor.getValue() : Cesium.Color.WHITE;
      e.label.fillColor = light ? Cesium.Color.fromCssColorString(pl ? (DARK_INK[pl.layer] || '#1E2939') : '#4A5565') : e._fill; e.label.outlineColor = light ? Cesium.Color.fromCssColorString('#FFFFFF').withAlpha(0.92) : Cesium.Color.fromCssColorString('#030712').withAlpha(0.9); e.label.backgroundColor = light ? Cesium.Color.fromCssColorString('#FFFFFF').withAlpha(0.82) : Cesium.Color.fromCssColorString('#030712').withAlpha(0.65); }
  }
  setDensity(mode) {
    const f = mode === 'immersive' ? 0.6 : mode === 'annotated' ? 1.7 : 1; const minImp = mode === 'immersive' ? 0.5 : 0;
    for (const ds of Object.values(this.ds)) for (const e of ds.entities.values) { if (!e.label) continue; if (e._far == null) { const d = e.label.distanceDisplayCondition && e.label.distanceDisplayCondition.getValue(); e._far = d ? d.far : 3500; }
      e.label.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(0, e._far * f); e.label.show = (e._imp == null ? 1 : e._imp) >= minImp; }
  }
  importance(layer, item) {
    switch (layer) { case 'stock': return item.grade === 'A' || item.grade === 'P' ? 0.9 : item.grade === 'F' ? 0.6 : 0.35; case 'future': return 0.8; case 'renewal': return item.category === '政府主導' ? 0.75 : 0.4; case 'mops': return Math.min(1, 0.5 + Math.log10(Math.max(1, item.total_price || 1)) / 20); case 'licenses': return 0.3; case 'zones': return 0.3; case 'infra': return 0.85; case 'parks': return 0.85; case 'heat': return 0.9; case 'mrt': return 0.4; case 'moves': return 0.45; default: return 0.5; }
  }
  build() { this.buildStock(); this.buildMarkers(); this.buildFuture(); this.buildParcels(); this.buildLicenses(); this.buildRenewal(); this.buildZones(); this.buildMops(); this.buildMoves(); this.buildInfra(); this.buildParks(); this.buildHeat(); this.buildMrt(); this.buildDistricts();
    for (const ds of Object.values(this.ds)) for (const e of ds.entities.values) { if (!e.label) continue; const pl = e.properties && e.properties.pl ? e.properties.pl.getValue() : null; e._imp = pl ? this.importance(pl.layer, pl.item) : 1; } }
  /* ---- 商辦存量 ---- */
  buildStock() {
    for (const b of this.d.buildings || []) {
      if (!b.lat) continue; const key = 'stock:' + b.id; const grade = b.grade || 'B'; const col = grade === 'A' ? '#FCBE83' : grade === 'F' ? '#6EE7B7' : grade === 'P' ? '#F29628' : '#E8C9A0';
      const built = yearOf(b.license_date); const floors = b.floor_above || 8; let h = floors * 3.6 + 4;
      const foot = this.osm ? this.osm.nearest(b.lon, b.lat, 48) : null; if (foot) h = Math.max(h, foot.h + 1.5);
      b._h = h; b._built = built;
      const show = new Cesium.CallbackProperty(() => built == null || built <= this.year, false);
      const mat = new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C(col, this.isHot(key) ? 0.98 : (grade === 'A' ? 0.82 : 0.62)), false));
      const common = { show, properties: null };
      if (foot) this.add('stock', key, b, { ...common, polygon: { hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(foot.ring)), height: 0, extrudedHeight: h, material: mat, outline: true, outlineColor: C(col, .95), outlineWidth: 1 } });
      else { const side = Math.max(18, Math.min(60, Math.sqrt((b.total_floor_area || 6000) / Math.max(1, floors + (b.floor_below || 0))) * 1.2)); this.add('stock', key, b, { ...common, position: Cesium.Cartesian3.fromDegrees(b.lon, b.lat, h / 2), box: { dimensions: new Cesium.Cartesian3(side, side, h), material: mat, outline: true, outlineColor: C(col, .95) } }); }
      this.ds.labels.entities.add({ show: new Cesium.CallbackProperty(() => this.vis.stock && (built == null || built <= this.year), false), position: Cesium.Cartesian3.fromDegrees(b.lon, b.lat, h + 6), label: label(b.name, { color: grade === 'A' || grade === 'P' ? '#FFDAA0' : grade === 'F' ? '#B9F0C9' : '#F3E5CF', far: grade === 'A' || grade === 'P' ? 2600 : 1400, dy: -6 }), properties: { pl: { layer: 'stock', key, item: b } } });
    }
  }
  /* ---- 商辦 markers：PickPeak 風格 —— 遠看是「N 棟」群聚圓，近看是大樓圖示，再近就只剩 3D 量體 ---- */
  buildMarkers() {
    const ds = this.ds.markers; const cl = ds.clustering; cl.enabled = true; cl.pixelRange = 64; cl.minimumClusterSize = 3; cl.clusterBillboards = true; cl.clusterLabels = false; cl.clusterPoints = false;
    for (const b of this.d.buildings || []) { if (!b.lat) continue; const key = 'stock:' + b.id; const grade = b.grade || 'B'; const col = grade === 'A' ? '#FCBE83' : grade === 'F' ? '#6EE7B7' : grade === 'P' ? '#F29628' : '#E8C9A0';
      ds.entities.add({ position: Cesium.Cartesian3.fromDegrees(b.lon, b.lat, (b._h || 40) + 10), show: new Cesium.CallbackProperty(() => b._built == null || b._built <= this.year, false),
        billboard: { image: icon('tower', col, 64), width: 28, height: 28, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(2200, 70000), scaleByDistance: new Cesium.NearFarScalar(3000, 1, 40000, 0.6) },
        properties: { pl: { layer: 'stock', key, item: b } } }); }
    cl.clusterEvent.addEventListener((entities, cluster) => { cluster.label.show = false; cluster.billboard.show = true; cluster.billboard.image = clusterImage(entities.length); cluster.billboard.width = entities.length >= 10 ? 56 : 46; cluster.billboard.height = cluster.billboard.width; cluster.billboard.verticalOrigin = Cesium.VerticalOrigin.CENTER; cluster.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY; cluster.billboard.id = { cluster: entities }; });
  }
  /* ---- 地號（都更模擬用）：選定單元內的地籤 polygon ---- */
  buildParcels() {
    const units = (this.d.parcels && this.d.parcels.units) || {};
    for (const [uid, u] of Object.entries(units)) for (const pc of u.parcels || []) { if (!pc.ring || pc.ring.length < 3) continue; const key = `parcel:${pc.sectcode}/${pc.landcode}`; const flat = []; let cx = 0, cy = 0; for (const q of pc.ring) { flat.push(q[0], q[1]); cx += q[0]; cy += q[1]; } cx /= pc.ring.length; cy /= pc.ring.length; const item = { ...pc, unit_id: uid, unit_name: u.name, name: `${pc.town} ${pc.section1}段 ${pc.landcode} 地號`, lon: cx, lat: cy };
      this.add('parcels', key, item, { polygon: { hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)), height: 0.8, material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C('#93DCE6', this.isHot(key) ? .45 : .14), false)), outline: true, outlineColor: C('#E3F8FA', .95), outlineWidth: 1.5 },
        position: Cesium.Cartesian3.fromDegrees(cx, cy, 3), label: label(pc.landcode, { color: '#E3F8FA', far: 900, font: '600 10px "SF Mono", ui-monospace, monospace', dy: 0 }) }); }
  }
  /* ---- 時間軸動態：跨年時新出現的大樓「長出來」、當年交易「ping」 ---- */
  onYearChange(prev, year) {
    this.prevYear = prev; this.yearChangedAt = performance.now(); const fx = this.ds.fx; fx.entities.removeAll(); if (year <= prev) return;
    const born = (this.d.buildings || []).filter(b => b.lat && b._built != null && b._built > prev && b._built <= year).slice(0, 24);
    const t0 = performance.now();
    for (const b of born) { const h = b._h || 40; const side = Math.max(22, Math.min(64, Math.sqrt((b.total_floor_area || 6000) / Math.max(1, (b.floor_above || 8))) * 1.5));
      const prog = () => Math.min(1, (performance.now() - t0) / 1100); const ease = () => 1 - Math.pow(1 - prog(), 3);
      fx.entities.add({ position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(b.lon, b.lat, h * 1.35 * ease() / 2), false), box: { dimensions: new Cesium.CallbackProperty(() => new Cesium.Cartesian3(side, side, Math.max(1, h * 1.35 * ease())), false), material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C('#FCBE83', 0.55 * (1 - prog())), false)), outline: true, outlineColor: C('#FFDAA0', .9) } });
      fx.entities.add({ position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(b.lon, b.lat, h + 30 + 40 * ease()), false), label: { text: `+ ${b.name}`, font: MONO, fillColor: new Cesium.CallbackProperty(() => C('#FFDAA0', 1 - prog() * 0.6), false), outlineColor: C('#030712', .9), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY, scale: 1 } }); }
    for (const m of this.d.mops || []) if (m.lat && m._year === year) this.pulse('mops:' + m.id, 4000);
    for (const f of this.d.future_dev || []) if (f.lat && f._year === year) this.pulse('future:' + f.id, 4000);
    setTimeout(() => { if (this.yearChangedAt === t0 || performance.now() - t0 > 1400) fx.entities.removeAll(); }, 1500);
  }
  yearStats(year) { const d = this.d; return { stock: (d.buildings || []).filter(b => b._built === year).length, licenses: (d.building_licenses || []).filter(l => l._year === year).length, mops: (d.mops || []).filter(m => m._year === year).length, future: (d.future_dev || []).filter(f => f._year === year).length, total: (d.buildings || []).filter(b => b._built == null || b._built <= year).length }; }
  /* ---- 未來供給（幽靈建物，隨時間長高）---- */
  buildFuture() {
    for (const f of this.d.future_dev || []) {
      if (!f.lat) continue; const key = 'future:' + f.id; const done = yearOf(f.completion_date) || 2028; f._year = done; const h = (f.floors_above || 20) * (f.typical_floor_height || 3.6) + 4; const side = Math.max(22, Math.min(70, Math.sqrt(f.max_floor_area || 1000) * 1.15));
      const prog = () => Math.max(0.12, Math.min(1, (this.year - (done - 3)) / 3));
      const pos = new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(f.lon, f.lat, h * prog() / 2), false);
      const dims = new Cesium.CallbackProperty(() => new Cesium.Cartesian3(side, side, h * prog()), false);
      const mat = new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C('#93DCE6', this.year >= done ? 0.78 : (this.isHot(key) ? 0.45 : 0.2)), false));
      this.add('future', key, f, { position: pos, box: { dimensions: dims, material: mat, outline: true, outlineColor: C('#BBEAF0', .9) } });
      this.ds.labels.entities.add({ show: new Cesium.CallbackProperty(() => this.vis.future, false), position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(f.lon, f.lat, h * prog() + 8), false), label: label(new Cesium.CallbackProperty(() => `${f.name} · ${this.year >= done ? '完工' : done}`, false), { color: '#BBEAF0', far: 4500, font: MONO }), properties: { pl: { layer: 'future', key, item: f } } });
    }
  }
  /* ---- 建照脈衝 ---- */
  buildLicenses() {
    for (const l of this.d.building_licenses || []) {
      if (!l.lat) continue; const key = 'license:' + l.license_number; const y = yearOf(l.issue_date); l._year = y; const ph = Math.random() * 6.28;
      this.add('licenses', key, l, { position: Cesium.Cartesian3.fromDegrees(l.lon, l.lat, 6), show: new Cesium.CallbackProperty(() => this.year >= (y || 2025), false),
        point: { pixelSize: new Cesium.CallbackProperty(() => 4 + (this.isHot(key) ? 6 : 0), false), color: C('#50C0D4', .0), outlineColor: C('#50C0D4', .35), outlineWidth: new Cesium.CallbackProperty(() => 10 + 10 * (0.5 + 0.5 * Math.sin(this.t * 2.2 + ph)), false), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        billboard: BB('permit', '#50C0D4', 22, 9000),
        label: label(`${l.license_number} · ${l.construction_type || ''}`, { color: '#93DCE6', far: 1800, font: MONO, dy: -12 }) });
    }
  }
  /* ---- 都更多邊形 ---- */
  buildRenewal() {
    for (const u of this.d.urban_renewal || []) {
      if (!u.rings) continue; const key = 'renewal:' + u.id; const gov = u.category === '政府主導'; let cx = 0, cy = 0, n = 0;
      for (const ring of u.rings) { const flat = []; for (const p of ring) { flat.push(p[0], p[1]); cx += p[0]; cy += p[1]; n++; } if (flat.length < 6) continue;
        this.add('renewal', key + ':' + n, u, { polygon: { hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)), height: 0.5, extrudedHeight: 3, material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C(gov ? '#DDD6FE' : '#C4B5FD', this.isHot(key) ? .75 : .38), false)), outline: true, outlineColor: C('#EDE9FE', .95) } }); }
      if (n) { u._c = [cx / n, cy / n]; this.ds.labels.entities.add({ show: new Cesium.CallbackProperty(() => this.vis.renewal, false), position: Cesium.Cartesian3.fromDegrees(cx / n, cy / n, 10), billboard: { ...BB(gov ? 'renew' : 'renew', gov ? '#DDD6FE' : '#C4B5FD', gov ? 24 : 18, 7000), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, gov ? 9000 : 4000) }, label: label(`${u.name}`, { color: '#DDD6FE', far: 2600, dy: -16 }), properties: { pl: { layer: 'renewal', key, item: u } } }); }
    }
  }
  /* ---- 重劃／區段徵收 ---- */
  buildZones() {
    for (const z of this.d.development_zones || []) { if (!z.lat) continue; const key = 'zone:' + z.id; const r = z.category === '區段徵收' ? 240 : 180;
      this.add('zones', key, z, { position: Cesium.Cartesian3.fromDegrees(z.lon, z.lat, 0), ellipse: { semiMajorAxis: r, semiMinorAxis: r, height: 0.3, material: C('#A78BFA', z.status === '規劃中' ? .22 : .10), outline: true, outlineColor: C('#A78BFA', .75) },
        label: label(z.name.replace(/^臺北市/, ''), { color: '#DDD6FE', far: 5000, dy: -4, font: MONO }) }); }
  }
  /* ---- 上市櫃資產交易 ---- */
  buildMops() {
    for (const m of this.d.mops || []) { if (!m.lat) continue; const key = 'mops:' + m.id; const y = yearOf(m.announcement_date); m._year = y; const size = Math.max(9, Math.min(26, 6 + Math.log10(Math.max(1e6, m.total_price || 1e6)) * 2.2));
      this.add('mops', key, m, { position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 14), show: new Cesium.CallbackProperty(() => y == null || (y <= this.year && y >= this.year - 1), false),
        billboard: { ...BB('deal', '#F29628', Math.round(size * 1.6)), scale: new Cesium.CallbackProperty(() => this.isHot(key) ? 1.15 + 0.2 * Math.sin(this.t * 5) : 1, false) },
        label: label(`${m.company_name} · ${fmtMoney(m.total_price)}`, { color: '#FFDAA0', far: 4200, dy: -16, font: MONO, bg: true }) }); }
  }
  /* ---- 企業遷徙弧線 ---- */
  buildMoves() {
    const orig = this.originFor.bind(this);
    for (const mv of this.d.registry_moves || []) { if (!mv.lat) continue; const key = 'move:' + mv.uniform_number; const from = orig(mv.before); if (!from) continue; const to = [mv.lon, mv.lat]; const pts = arc(from, to, 44); mv._from = from;
      this.add('moves', key, mv, { polyline: { positions: pts, width: 2.2, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, taperPower: 0.6, color: C('#DE7020', .85) }), arcType: Cesium.ArcType.NONE } });
      const ph = Math.random(); this.ds.moves.entities.add({ position: new Cesium.CallbackProperty(() => { const u = (this.t * 0.18 + ph) % 1; return pts[Math.min(pts.length - 1, Math.floor(u * pts.length))]; }, false), point: { pixelSize: 5, color: C('#FFDAA0'), disableDepthTestDistance: Number.POSITIVE_INFINITY } });
      this.ds.moves.entities.add({ position: Cesium.Cartesian3.fromDegrees(to[0], to[1], 30), billboard: BB('arrow', '#DE7020', 20, 6000), label: label(mv.company_name.replace(/股份有限公司|有限公司/, ''), { color: '#FFDAA0', far: 2200, font: MONO, dy: -14 }), properties: { pl: { layer: 'moves', key, item: mv } } }); }
  }
  originFor(before) {
    if (!before) return null; const m = before.match(/(臺北市|台北市)(\S{2}區)/); if (m && this.districtCentroids.has(m[2])) return this.districtCentroids.get(m[2]);
    const CITY = { '板橋': [121.459, 25.012], '三重': [121.488, 25.062], '永和': [121.514, 25.008], '中和': [121.499, 24.999], '新莊': [121.450, 25.036], '汐止': [121.646, 25.064], '五股': [121.438, 25.083], '蘆洲': [121.474, 25.085], '新店': [121.541, 24.968], '土城': [121.443, 24.972], '淡水': [121.444, 25.169], '林口': [121.392, 25.077], '桃園': [121.301, 24.994], '觀音': [121.093, 25.036], '竹北': [121.004, 24.839], '臺中': [120.679, 24.147], '台中': [120.679, 24.147], '臺南': [120.213, 22.997], '台南': [120.213, 22.997], '頭份': [120.905, 24.687], '基隆': [121.741, 25.128], '金門': [118.318, 24.436], '高雄': [120.302, 22.627] };
    for (const [k, v] of Object.entries(CITY)) if (before.includes(k)) return v; return null;
  }
  /* ---- 公共建設 ---- */
  buildInfra() {
    for (const p of this.d.public_infras || []) { const key = 'infra:' + p.id; const cons = p.status === 'constructing';
      if (p.line && p.line.length > 1) { const flat = []; for (const q of p.line) flat.push(q[0], q[1], 12); this.add('infra', key, p, { polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat), width: 5, material: new Cesium.PolylineDashMaterialProperty({ color: C('#BBEAF0', .95), gapColor: C('#BBEAF0', .15), dashLength: 24 }), arcType: Cesium.ArcType.GEODESIC } });
        const mid = p.line[Math.floor(p.line.length / 2)]; this.ds.labels.entities.add({ show: new Cesium.CallbackProperty(() => this.vis.infra, false), position: Cesium.Cartesian3.fromDegrees(mid[0], mid[1], 30), label: label(`${p.name} · ${cons ? '興建中' : '規劃中'} ${p.completion_year || ''}`, { color: '#E3F8FA', far: 30000, bg: true, dy: -6 }), properties: { pl: { layer: 'infra', key, item: p } } }); continue; }
      if (!p.lat) continue;
      this.ds.infra.entities.add({ position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 175), billboard: BB('crane', '#BBEAF0', 30, 40000), properties: { pl: { layer: 'infra', key, item: p } } });
      this.add('infra', key, p, { position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0), cylinder: { length: new Cesium.CallbackProperty(() => 120 + 30 * Math.sin(this.t * 1.5), false), topRadius: 22, bottomRadius: 60, material: C('#BBEAF0', cons ? .35 : .15), outline: true, outlineColor: C('#BBEAF0', .8) },
        label: label(`${p.name} · ${cons ? '興建中' : '規劃中'} ${p.completion_year || ''}`, { color: '#E3F8FA', far: 12000, bg: true, dy: -60 }) }); }
  }
  /* ---- 產業園區 ---- */
  buildParks() {
    for (const p of this.d.industrial_parks || []) { if (!p.lat) continue; const key = 'ipark:' + p.id; const r = Math.max(120, Math.sqrt((p.area_ha || 10) * 1e4) * 0.62);
      this.ds.parks.entities.add({ position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 70), billboard: BB('factory', '#6EE7B7', 30, 40000), properties: { pl: { layer: 'parks', key, item: p } } });
      this.add('parks', key, p, { position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0), ellipse: { semiMajorAxis: r, semiMinorAxis: r, height: 0.4, material: C('#6EE7B7', .10), outline: true, outlineColor: C('#6EE7B7', .9), outlineWidth: 2 }, label: label(p.name, { color: '#A7F3D0', far: 20000, dy: -4, bg: true }) }); }
  }
  /* ---- 商圈行情 ---- */
  buildHeat() {
    for (const a of this.d.business_areas || []) { if (!a.lat) continue; const key = 'heat:' + a.id; const mp = a.market_price || {}; const rent = mp.actual_rent_avg || 1500; const hot = Math.max(0, Math.min(1, (rent - 1200) / 1600)); const col = `rgb(${Math.round(252 - 66 * hot)},${Math.round(190 - 98 * hot)},${Math.round(131 - 86 * hot)})`;
      [[700, .05], [480, .09], [260, .15]].forEach(([r, al], i) => this.ds.heat.entities.add({ position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 0), ellipse: { semiMajorAxis: r, semiMinorAxis: r, height: 0.2 + i * 0.1, material: Cesium.Color.fromCssColorString(col).withAlpha(al + hot * 0.06) }, properties: { pl: { layer: 'heat', key, item: a } } }));
      this.ds.heat.entities.add({ position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 40), billboard: BB('coin', '#FCBE83', 26, 30000), properties: { pl: { layer: 'heat', key, item: a } } });
      this.add('heat', key, a, { position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 40), label: label(`${(a.name || '').replace(/^台北市/, '')}\n租 ${fmtInt(rent)}/坪 · 售 ${fmtInt((mp.actual_sale_avg || 0) / 1e4)} 萬/坪`, { color: '#FCBE83', far: 16000, bg: true, dy: -18 }) }); }
  }
  /* ---- 捷運 ---- */
  buildMrt() {
    for (const l of this.base.mrt_lines || []) { const col = MRT_COLOR[l.name] || l.color || '#8FA3C8'; for (const seg of l.coords || []) { const flat = []; for (const q of seg) flat.push(q[0], q[1], 3); if (flat.length < 6) continue; this.ds.mrt.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat), width: 3.5, material: C(col, .85), arcType: Cesium.ArcType.GEODESIC } }); } }
    for (const s of this.base.mrt_stations || []) { const key = 'mrt:' + s.name; this.add('mrt', key, s, { position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 4), billboard: { ...BB('metro', '#D1D5DB', 18, 9000), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 14000) }, label: label(s.name, { color: '#D1D5DB', far: 2800, font: '11px "Noto Sans TC", sans-serif', dy: -8 }) }); }
  }
  buildDistricts() {
    for (const [name, c] of this.districtCentroids) { const tp = (this.base.districts || []).find(d => d.name === name); if (!tp || !/臺北市|台北市/.test(tp.county)) continue; this.ds.labels.entities.add({ position: Cesium.Cartesian3.fromDegrees(c[0], c[1], 80), label: { text: name, font: '600 15px "Noto Sans TC", sans-serif', fillColor: C('#99A1AF', .9), outlineColor: C('#030712', .9), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(5000, 120000) } }); }
  }
  /* ---- analytics helpers ---- */
  inBounds(b, lon, lat) { return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]; }
  countInView(bounds) {
    const c = {}; const cnt = (k, arr, pred) => { c[k] = (arr || []).filter(x => x.lat && this.inBounds(bounds, x.lon, x.lat) && (!pred || pred(x))).length; };
    cnt('stock', this.d.buildings, b => b._built == null || b._built <= this.year); cnt('future', this.d.future_dev); cnt('licenses', this.d.building_licenses, l => this.year >= (l._year || 2025)); cnt('mops', this.d.mops, m => m._year == null || (m._year <= this.year && m._year >= this.year - 1)); cnt('infra', this.d.public_infras); cnt('moves', this.d.registry_moves); cnt('zones', this.d.development_zones); cnt('parks', this.d.industrial_parks);
    c.renewal = (this.d.urban_renewal || []).filter(u => u._c && this.inBounds(bounds, u._c[0], u._c[1])).length; return c;
  }
  districtAt(lon, lat) { for (const d of this.base.districts || []) { for (const r of d.rings || []) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if (((a[1] > lat) !== (b[1] > lat)) && (lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } if (c) return d; } } return null; }
}
function arc(from, to, n) { const pts = []; const dist = Math.hypot((to[0] - from[0]) * 111320 * Math.cos(((from[1] + to[1]) / 2) * D2R), (to[1] - from[1]) * 110540); const H = Math.max(180, Math.min(2500, dist * 0.22)); for (let i = 0; i <= n; i++) { const u = i / n; pts.push(Cesium.Cartesian3.fromDegrees(from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u, Math.sin(Math.PI * u) * H + 5)); } return pts; }
export const fmtInt = n => Math.round(n || 0).toLocaleString('zh-TW');
export const fmtMoney = n => { if (n == null) return '—'; const a = Math.abs(n); if (a >= 1e8) return (n / 1e8).toFixed(a >= 1e9 ? 0 : 1) + ' 億'; if (a >= 1e4) return fmtInt(n / 1e4) + ' 萬'; return fmtInt(n); };
export { yearOf };
