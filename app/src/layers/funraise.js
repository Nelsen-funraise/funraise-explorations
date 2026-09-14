// FUNRAISE MCP data → Cesium entity layers (one CustomDataSource per layer, GEV-style layer registry)
import * as Cesium from 'cesium';
const D2R = Math.PI / 180;
export const LAYERS = {
  stock:    { name: '商辦存量',        color: '#F2B84B', glyph: 'box',     desc: 'FUNRAISE 商辦資料庫 · 等級 / 屋齡 / 認證 / 捷運距離 / 照片' },
  future:   { name: '未來供給（規劃中）', color: '#3ED2E8', glyph: 'ghost',   desc: '興建中／規劃中建案 · 逐層用途 · 完工年（隨時間軸長高）' },
  licenses: { name: '建照（即將開工）',   color: '#3ED2E8', glyph: 'pulse',   desc: '臺北市 114–115 年建照 · 未來 24–48 月新供給訊號' },
  renewal:  { name: '都更單元',        color: '#B48CFF', glyph: 'polygon', desc: '都更地區／單元圖形 · 政府主導／已核定事業' },
  zones:    { name: '重劃／區段徵收',   color: '#B48CFF', glyph: 'hex',     desc: '臺北市 73 筆市地重劃／區段徵收' },
  mops:     { name: '上市櫃資產交易',   color: '#FF7A59', glyph: 'diamond', desc: '公開資訊觀測站 取得／處分資產（近 12 月）' },
  moves:    { name: '企業遷徙',        color: '#FF7A59', glyph: 'arc',     desc: '公司登記地址跨區異動（2026-07）· 由原址飛向新址' },
  infra:    { name: '公共建設（興建中）', color: '#4C8DFF', glyph: 'square',  desc: '捷運環狀線／信義東延／汐東線 · TOD 開發' },
  parks:    { name: '產業園區',        color: '#58C97B', glyph: 'ring',    desc: '產業園區範圍' },
  heat:     { name: '商圈行情',        color: '#F2B84B', glyph: 'heat',    desc: '商圈租金／售價熱度' },
  mrt:      { name: '捷運路網',        color: '#8FA3C8', glyph: 'line',    desc: '台北捷運 6 線（OSM）' },
};
const C = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
const MRT_COLOR = { '文湖線': '#C48C31', '淡水信義線': '#E3002C', '松山新店線': '#008659', '中和新蘂線': '#F8B61C', '中和新蘆線': '#F8B61C', '板南線': '#0070BD', '環狀線': '#FFDB00' };
const yearOf = s => { if (!s) return null; const m = String(s).match(/(\d{4})/); if (m) return +m[1]; const r = String(s).match(/^(\d{3})/); return r ? +r[1] + 1911 : null; };
const FONT = '500 13px "Noto Sans TC", sans-serif', MONO = '600 11px "IBM Plex Mono", monospace';
const label = (text, opts = {}) => ({ text, font: opts.font || FONT, fillColor: C(opts.color || '#E9EFFA'), outlineColor: C('#070B14', .9), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, opts.dy ?? -14), verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, opts.far || 3500), scale: opts.scale || 1, showBackground: !!opts.bg, backgroundColor: C('#070B14', .65), backgroundPadding: new Cesium.Cartesian2(6, 3) });

export class FunraiseLayers {
  constructor(viewer, data, basemap, osm) {
    this.viewer = viewer; this.d = data; this.base = basemap || {}; this.osm = osm; this.year = new Date().getFullYear(); this.now = this.year; this.t0 = performance.now();
    this.ds = {}; this.byKey = new Map(); this.highlight = new Map(); this.vis = Object.fromEntries(Object.keys(LAYERS).map(k => [k, true]));
    for (const k of [...Object.keys(LAYERS), 'labels']) { this.ds[k] = new Cesium.CustomDataSource(k); viewer.dataSources.add(this.ds[k]); }
    this.districtCentroids = new Map(); for (const d of this.base.districts || []) { const r = d.rings && d.rings[0]; if (!r) continue; let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } this.districtCentroids.set(d.name, [x / r.length, y / r.length]); }
  }
  add(layer, key, item, ent) { ent.properties = { pl: { layer, key, item } }; const e = this.ds[layer].entities.add(ent); this.byKey.set(key, e); return e; }
  get t() { return (performance.now() - this.t0) / 1000; }
  isHot(key) { const u = this.highlight.get(key); return u && u > performance.now(); }
  pulse(key, ms = 7000) { this.highlight.set(key, performance.now() + ms); }
  setVisible(k, on) { if (this.ds[k]) { this.ds[k].show = on; this.vis[k] = on; } }
  build() { this.buildStock(); this.buildFuture(); this.buildLicenses(); this.buildRenewal(); this.buildZones(); this.buildMops(); this.buildMoves(); this.buildInfra(); this.buildParks(); this.buildHeat(); this.buildMrt(); this.buildDistricts(); }
  /* ---- 商辦存量 ---- */
  buildStock() {
    for (const b of this.d.buildings || []) {
      if (!b.lat) continue; const key = 'stock:' + b.id; const grade = b.grade || 'B'; const col = grade === 'A' ? '#F2B84B' : grade === 'F' ? '#58C97B' : grade === 'P' ? '#3ED2E8' : '#C89B4E';
      const built = yearOf(b.license_date); const floors = b.floor_above || 8; let h = floors * 3.6 + 4;
      const foot = this.osm ? this.osm.nearest(b.lon, b.lat, 48) : null; if (foot) h = Math.max(h, foot.h + 1.5);
      b._h = h; b._built = built;
      const show = new Cesium.CallbackProperty(() => built == null || built <= this.year, false);
      const mat = new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C(col, this.isHot(key) ? 0.98 : (grade === 'A' ? 0.82 : 0.62)), false));
      const common = { show, properties: null };
      if (foot) this.add('stock', key, b, { ...common, polygon: { hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(foot.ring)), height: 0, extrudedHeight: h, material: mat, outline: true, outlineColor: C(col, .95), outlineWidth: 1 } });
      else { const side = Math.max(18, Math.min(60, Math.sqrt((b.total_floor_area || 6000) / Math.max(1, floors + (b.floor_below || 0))) * 1.2)); this.add('stock', key, b, { ...common, position: Cesium.Cartesian3.fromDegrees(b.lon, b.lat, h / 2), box: { dimensions: new Cesium.Cartesian3(side, side, h), material: mat, outline: true, outlineColor: C(col, .95) } }); }
      this.ds.labels.entities.add({ show: new Cesium.CallbackProperty(() => this.vis.stock && (built == null || built <= this.year), false), position: Cesium.Cartesian3.fromDegrees(b.lon, b.lat, h + 6), label: label(b.name, { color: grade === 'A' ? '#FFE1A8' : grade === 'F' ? '#B9F0C9' : '#E9D8B0', far: grade === 'A' ? 2600 : 1400, dy: -6 }), properties: { pl: { layer: 'stock', key, item: b } } });
    }
  }
  /* ---- 未來供給（幽靈建物，隨時間長高）---- */
  buildFuture() {
    for (const f of this.d.future_dev || []) {
      if (!f.lat) continue; const key = 'future:' + f.id; const done = yearOf(f.completion_date) || 2028; f._year = done; const h = (f.floors_above || 20) * (f.typical_floor_height || 3.6) + 4; const side = Math.max(22, Math.min(70, Math.sqrt(f.max_floor_area || 1000) * 1.15));
      const prog = () => Math.max(0.12, Math.min(1, (this.year - (done - 3)) / 3));
      const pos = new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(f.lon, f.lat, h * prog() / 2), false);
      const dims = new Cesium.CallbackProperty(() => new Cesium.Cartesian3(side, side, h * prog()), false);
      const mat = new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C('#3ED2E8', this.year >= done ? 0.78 : (this.isHot(key) ? 0.45 : 0.2)), false));
      this.add('future', key, f, { position: pos, box: { dimensions: dims, material: mat, outline: true, outlineColor: C('#9BE9F5', .9) } });
      this.ds.labels.entities.add({ show: new Cesium.CallbackProperty(() => this.vis.future, false), position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(f.lon, f.lat, h * prog() + 8), false), label: label(new Cesium.CallbackProperty(() => `${f.name} · ${this.year >= done ? '完工' : done}`, false), { color: '#9BE9F5', far: 4500, font: MONO }), properties: { pl: { layer: 'future', key, item: f } } });
    }
  }
  /* ---- 建照脈衝 ---- */
  buildLicenses() {
    for (const l of this.d.building_licenses || []) {
      if (!l.lat) continue; const key = 'license:' + l.license_number; const y = yearOf(l.issue_date); l._year = y; const ph = Math.random() * 6.28;
      this.add('licenses', key, l, { position: Cesium.Cartesian3.fromDegrees(l.lon, l.lat, 6), show: new Cesium.CallbackProperty(() => this.year >= (y || 2025), false),
        point: { pixelSize: new Cesium.CallbackProperty(() => 7 + 4 * (0.5 + 0.5 * Math.sin(this.t * 2.2 + ph)) + (this.isHot(key) ? 6 : 0), false), color: C('#3ED2E8', .95), outlineColor: C('#3ED2E8', .25), outlineWidth: new Cesium.CallbackProperty(() => 6 + 8 * (0.5 + 0.5 * Math.sin(this.t * 2.2 + ph)), false), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: label(`${l.license_number} · ${l.construction_type || ''}`, { color: '#9BE9F5', far: 1800, font: MONO, dy: -12 }) });
    }
  }
  /* ---- 都更多邊形 ---- */
  buildRenewal() {
    for (const u of this.d.urban_renewal || []) {
      if (!u.rings) continue; const key = 'renewal:' + u.id; const gov = u.category === '政府主導'; let cx = 0, cy = 0, n = 0;
      for (const ring of u.rings) { const flat = []; for (const p of ring) { flat.push(p[0], p[1]); cx += p[0]; cy += p[1]; n++; } if (flat.length < 6) continue;
        this.add('renewal', key + ':' + n, u, { polygon: { hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)), height: 0.5, extrudedHeight: 3, material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C(gov ? '#C9A8FF' : '#B48CFF', this.isHot(key) ? .75 : .38), false)), outline: true, outlineColor: C('#E0C3FF', .95) } }); }
      if (n) { u._c = [cx / n, cy / n]; this.ds.labels.entities.add({ show: new Cesium.CallbackProperty(() => this.vis.renewal, false), position: Cesium.Cartesian3.fromDegrees(cx / n, cy / n, 10), label: label(`${u.name}`, { color: '#D8C3FF', far: 2600, dy: -8 }), properties: { pl: { layer: 'renewal', key, item: u } } }); }
    }
  }
  /* ---- 重劃／區段徵收 ---- */
  buildZones() {
    for (const z of this.d.development_zones || []) { if (!z.lat) continue; const key = 'zone:' + z.id; const r = z.category === '區段徵收' ? 240 : 180;
      this.add('zones', key, z, { position: Cesium.Cartesian3.fromDegrees(z.lon, z.lat, 0), ellipse: { semiMajorAxis: r, semiMinorAxis: r, height: 0.3, material: C('#B48CFF', z.status === '規劃中' ? .22 : .10), outline: true, outlineColor: C('#B48CFF', .75) },
        label: label(z.name.replace(/^臺北市/, ''), { color: '#D8C3FF', far: 5000, dy: -4, font: MONO }) }); }
  }
  /* ---- 上市櫃資產交易 ---- */
  buildMops() {
    for (const m of this.d.mops || []) { if (!m.lat) continue; const key = 'mops:' + m.id; const y = yearOf(m.announcement_date); m._year = y; const size = Math.max(9, Math.min(26, 6 + Math.log10(Math.max(1e6, m.total_price || 1e6)) * 2.2));
      this.add('mops', key, m, { position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 14), show: new Cesium.CallbackProperty(() => y == null || (y <= this.year && y >= this.year - 1), false),
        point: { pixelSize: new Cesium.CallbackProperty(() => size + (this.isHot(key) ? 8 * (0.5 + 0.5 * Math.sin(this.t * 5)) : 0), false), color: C('#FF7A59', .92), outlineColor: C('#FFD9CC', .9), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: label(`${m.company_name} · ${fmtMoney(m.total_price)}`, { color: '#FFC2AE', far: 4200, dy: -16, font: MONO, bg: true }) }); }
  }
  /* ---- 企業遷徙弧線 ---- */
  buildMoves() {
    const orig = this.originFor.bind(this);
    for (const mv of this.d.registry_moves || []) { if (!mv.lat) continue; const key = 'move:' + mv.uniform_number; const from = orig(mv.before); if (!from) continue; const to = [mv.lon, mv.lat]; const pts = arc(from, to, 44); mv._from = from;
      this.add('moves', key, mv, { polyline: { positions: pts, width: 2.2, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, taperPower: 0.6, color: C('#FF7A59', .85) }), arcType: Cesium.ArcType.NONE } });
      const ph = Math.random(); this.ds.moves.entities.add({ position: new Cesium.CallbackProperty(() => { const u = (this.t * 0.18 + ph) % 1; return pts[Math.min(pts.length - 1, Math.floor(u * pts.length))]; }, false), point: { pixelSize: 5, color: C('#FFD9CC'), disableDepthTestDistance: Number.POSITIVE_INFINITY } });
      this.ds.moves.entities.add({ position: Cesium.Cartesian3.fromDegrees(to[0], to[1], 30), label: label(mv.company_name.replace(/股份有限公司|有限公司/, ''), { color: '#FFC2AE', far: 2200, font: MONO, dy: -10 }), properties: { pl: { layer: 'moves', key, item: mv } } }); }
  }
  originFor(before) {
    if (!before) return null; const m = before.match(/(臺北市|台北市)(\S{2}區)/); if (m && this.districtCentroids.has(m[2])) return this.districtCentroids.get(m[2]);
    const CITY = { '板橋': [121.459, 25.012], '三重': [121.488, 25.062], '永和': [121.514, 25.008], '中和': [121.499, 24.999], '新莊': [121.450, 25.036], '汐止': [121.646, 25.064], '五股': [121.438, 25.083], '蘆洲': [121.474, 25.085], '新店': [121.541, 24.968], '土城': [121.443, 24.972], '淡水': [121.444, 25.169], '林口': [121.392, 25.077], '桃園': [121.301, 24.994], '觀音': [121.093, 25.036], '竹北': [121.004, 24.839], '臺中': [120.679, 24.147], '台中': [120.679, 24.147], '臺南': [120.213, 22.997], '台南': [120.213, 22.997], '頭份': [120.905, 24.687], '基隆': [121.741, 25.128], '金門': [118.318, 24.436], '高雄': [120.302, 22.627] };
    for (const [k, v] of Object.entries(CITY)) if (before.includes(k)) return v; return null;
  }
  /* ---- 公共建設 ---- */
  buildInfra() {
    for (const p of this.d.public_infras || []) { const key = 'infra:' + p.id; const cons = p.status === 'constructing';
      if (p.line && p.line.length > 1) { const flat = []; for (const q of p.line) flat.push(q[0], q[1], 12); this.add('infra', key, p, { polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat), width: 5, material: new Cesium.PolylineDashMaterialProperty({ color: C('#4C8DFF', .95), gapColor: C('#4C8DFF', .15), dashLength: 24 }), arcType: Cesium.ArcType.GEODESIC } });
        const mid = p.line[Math.floor(p.line.length / 2)]; this.ds.labels.entities.add({ show: new Cesium.CallbackProperty(() => this.vis.infra, false), position: Cesium.Cartesian3.fromDegrees(mid[0], mid[1], 30), label: label(`${p.name} · ${cons ? '興建中' : '規劃中'} ${p.completion_year || ''}`, { color: '#A9C6FF', far: 30000, bg: true, dy: -6 }), properties: { pl: { layer: 'infra', key, item: p } } }); continue; }
      if (!p.lat) continue;
      this.add('infra', key, p, { position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0), cylinder: { length: new Cesium.CallbackProperty(() => 120 + 30 * Math.sin(this.t * 1.5), false), topRadius: 22, bottomRadius: 60, material: C('#4C8DFF', cons ? .35 : .15), outline: true, outlineColor: C('#4C8DFF', .8) },
        label: label(`${p.name} · ${cons ? '興建中' : '規劃中'} ${p.completion_year || ''}`, { color: '#A9C6FF', far: 12000, bg: true, dy: -60 }) }); }
  }
  /* ---- 產業園區 ---- */
  buildParks() {
    for (const p of this.d.industrial_parks || []) { if (!p.lat) continue; const key = 'ipark:' + p.id; const r = Math.max(120, Math.sqrt((p.area_ha || 10) * 1e4) * 0.62);
      this.add('parks', key, p, { position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0), ellipse: { semiMajorAxis: r, semiMinorAxis: r, height: 0.4, material: C('#58C97B', .10), outline: true, outlineColor: C('#58C97B', .9), outlineWidth: 2 }, label: label(p.name, { color: '#7FDCA0', far: 20000, dy: -4, bg: true }) }); }
  }
  /* ---- 商圈行情 ---- */
  buildHeat() {
    for (const a of this.d.business_areas || []) { if (!a.lat) continue; const key = 'heat:' + a.id; const mp = a.market_price || {}; const rent = mp.actual_rent_avg || 1500; const hot = Math.max(0, Math.min(1, (rent - 1200) / 1600)); const col = `rgb(242,${Math.round(184 - 110 * hot)},${Math.round(75 - 40 * hot)})`;
      [[700, .05], [480, .09], [260, .15]].forEach(([r, al], i) => this.ds.heat.entities.add({ position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 0), ellipse: { semiMajorAxis: r, semiMinorAxis: r, height: 0.2 + i * 0.1, material: Cesium.Color.fromCssColorString(col).withAlpha(al + hot * 0.06) }, properties: { pl: { layer: 'heat', key, item: a } } }));
      this.add('heat', key, a, { position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 40), label: label(`${(a.name || '').replace(/^台北市/, '')}\n租 ${fmtInt(rent)}/坪 · 售 ${fmtInt((mp.actual_sale_avg || 0) / 1e4)} 萬/坪`, { color: '#F2B84B', far: 16000, bg: true, dy: -4 }) }); }
  }
  /* ---- 捷運 ---- */
  buildMrt() {
    for (const l of this.base.mrt_lines || []) { const col = MRT_COLOR[l.name] || l.color || '#8FA3C8'; for (const seg of l.coords || []) { const flat = []; for (const q of seg) flat.push(q[0], q[1], 3); if (flat.length < 6) continue; this.ds.mrt.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat), width: 3.5, material: C(col, .85), arcType: Cesium.ArcType.GEODESIC } }); } }
    for (const s of this.base.mrt_stations || []) { const key = 'mrt:' + s.name; this.add('mrt', key, s, { position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 4), point: { pixelSize: 6, color: C('#0B1222'), outlineColor: C('#C9D6EE'), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 14000) }, label: label(s.name, { color: '#C9D6EE', far: 2800, font: '11px "Noto Sans TC", sans-serif', dy: -8 }) }); }
  }
  buildDistricts() {
    for (const [name, c] of this.districtCentroids) { const tp = (this.base.districts || []).find(d => d.name === name); if (!tp || !/臺北市|台北市/.test(tp.county)) continue; this.ds.labels.entities.add({ position: Cesium.Cartesian3.fromDegrees(c[0], c[1], 80), label: { text: name, font: '600 15px "Noto Sans TC", sans-serif', fillColor: C('#A0B2D2', .85), outlineColor: C('#070B14', .9), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(5000, 120000) } }); }
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
