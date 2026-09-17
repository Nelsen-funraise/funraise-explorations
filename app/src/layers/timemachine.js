// 睿鏡 PeakLens v2 — Phase 9F 「價值時光機 2.0」: 12 個臺北市行政區的價值面（extruded choropleth），高度＝年度量、
// 顏色＝年增率（藍升／橘降／灰平），隨 timeline 的 year 平滑過渡（350ms lerp）；S1–S2 顯示，S3+ 交給既有的
// LAYERS/mask 機制自動隱藏（見 funraise.js 的 LAYERS.tm 與 applyScale()/_applyShow()，這裡完全不重造一套）。
// 資料來源：優先讀 public/data/timeseries.json（另一個 agent 正在產生，schema 見 TIMESERIES_README.md）；
// 檔案不存在／格式不符時，自動退回用 peaklens.json 快照（mops＋buildings＋building_licenses）逐年逐區計數，
// 保證這層永遠不會因為缺檔而整個炸掉。同時：MOPS 金額浮動標籤（S2–S3、2s 淡出）與商圈熱區標籤的季度數字
// （2024 年起，讀 business_areas[].self_series），皆由這個模組在既有實體上「外掛」，不改 funraise.js 的建圖邏輯。
import * as Cesium from 'cesium';
import { fmtInt, fmtMoney } from './funraise.js';

const DEFAULT_YEARS = Array.from({ length: 15 }, (_, i) => 2012 + i); // 2012..2026
const METRICS = {
  sales_all: { label: '成交件數', unit: '件' },
  sales_office: { label: '商辦成交', unit: '件' },
  licenses: { label: '建照', unit: '張' },
};
const S1_SPAN = [120, 1800]; // 全台北尺度（S1）：2012–2026 量體高度範圍（公尺）
const S2_SPAN = [60, 950]; // 拉近到行政區尺度（S2）：同一組正規化值改用較收斂的高度，避免貼臉時過度誇張
const TWEEN_MS = 350; // 年份／指標切換時的高度與顏色過渡
const PULSE_MS = 300; // 年度前進時的一次性 emissive 閃爍
const MOPS_FADE_MS = 2000; // MOPS 金額標籤存活時間
const FLAT_BAND = 0.02; // |yoy| 在此範圍內視為「持平」（灰）
const SATURATE_AT = 0.3; // |yoy| 到此飽和（顏色不再更深）
const GRAY = '#4A5565', GRAY_LIGHT = '#99A1AF', BLUE = '#16A4C0', ORANGE = '#F29628';
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const C = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
const lerpColor = (c1, c2, t) => Cesium.Color.lerp(c1, c2, Math.max(0, Math.min(1, t)), new Cesium.Color());
const pctNorm = v => v == null ? null : (Math.abs(v) > 1.5 ? v / 100 : v); // 防禦 yoy 是「12」還是「0.12」兩種可能寫法
const mkLabel = (textCB, o = {}) => ({ text: textCB, font: '600 13px "Inter","Noto Sans TC",sans-serif', fillColor: C(o.fill || '#F3F4F6'), outlineColor: C(o.outline || '#030712', .9), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -12), verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 55000), showBackground: true, backgroundColor: C(o.bg || '#030712', .6), backgroundPadding: new Cesium.Cartesian2(6, 3) });
const fetchTimeout = async (url, ms) => { const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms); try { const r = await fetch(url, { signal: ctrl.signal }); return r; } finally { clearTimeout(t); } };

export class TimeMachine {
  constructor({ viewer, layers, data, basemap, timeline }) {
    this.viewer = viewer; this.layers = layers; this.data = data; this.basemap = basemap; this.timeline = timeline;
    this.metric = 'sales_all'; this._ts = null; this._src = 'snapshot'; this.years = DEFAULT_YEARS;
    this._districts = (basemap.districts || []).filter(d => /臺北市|台北市/.test(d.county || '') && d.rings && d.rings[0] && d.rings[0].length >= 3);
    this._anim = new Map(); this._entities = new Map(); this._range = {}; this._mopsSpawnedAt = 0;
    this.fx = new Cesium.CustomDataSource('tm-fx'); viewer.dataSources.add(this.fx);
    this._ready = this._init();
  }
  get ready() { return this._ready; }
  get source() { return this._src; }
  async _init() {
    await this._loadTimeseries();
    this._buildFallback();
    this._computeRanges();
    this._build();
    this._patchHeatLabels();
    this.timeline.onChange((y, prev) => this._onYear(y, prev));
    this._onYear(this.layers.year, this.layers.year); // seed：從 0 平滑長到目前年份，不觸發脈衝
    return true;
  }
  /* ---- 資料：優先 timeseries.json，缺檔／格式不符則靜默退回快照計數，永遠不丟例外 ---- */
  async _loadTimeseries() {
    try {
      const r = await fetchTimeout('./data/timeseries.json', 3000);
      if (r && r.ok) { const j = await r.json(); if (j && j.sales_all && j.city) { this._ts = j; this._src = 'timeseries'; if (Array.isArray(j.meta && j.meta.years) && j.meta.years.length) this.years = j.meta.years; return; } }
    } catch { /* 尚未產生／逾時／格式不符：退回快照 */ }
    this._ts = null; this._src = 'snapshot';
  }
  /** 快照 fallback：peaklens.json 的 mops／buildings／building_licenses 依 lat/lon 落在哪個行政區、依年份桶計數
   * （對照 owner 抱怨的訴求——即使沒有真正的年度統計檔，這層也要有「每年都在變」的內容，而不是全部掛零）。 */
  _buildFallback() {
    const names = this._districts.map(d => d.name); const zero = () => Object.fromEntries(names.map(n => [n, this.years.map(() => 0)]));
    const sales_all = zero(), sales_office = zero(), licenses = zero();
    const idxOf = y => this.years.indexOf(y);
    const bump = (t, name, y) => { const i = idxOf(y); if (name && i >= 0 && t[name]) t[name][i]++; };
    const distOf = (lon, lat) => { const d = this.layers.districtAt && this.layers.districtAt(lon, lat); return d && names.includes(d.name) ? d.name : null; };
    for (const m of this.data.mops || []) { if (!m.lat) continue; const name = names.includes(m.district) ? m.district : distOf(m.lon, m.lat); bump(sales_all, name, m._year); }
    for (const b of this.data.buildings || []) { if (!b.lat) continue; const name = names.includes(b.district) ? b.district : distOf(b.lon, b.lat); bump(sales_all, name, b._built); bump(sales_office, name, b._built); }
    for (const l of this.data.building_licenses || []) { if (!l.lat) continue; const name = distOf(l.lon, l.lat); bump(licenses, name, l._year); }
    const city = {}; for (const [k, t] of [['sales_all', sales_all], ['sales_office', sales_office], ['licenses', licenses]]) city[k] = this.years.map((_, i) => names.reduce((s, n) => s + t[n][i], 0));
    this._fallback = { sales_all, sales_office, licenses, city };
  }
  _seriesEntry(table, name) { if (!table) return null; return table[name] || table['台北市' + name] || table['臺北市' + name] || null; }
  seriesFor(metric, name) { const t = this._ts && this._ts[metric]; const arr = t && this._seriesEntry(t, name); if (arr && arr.length) return arr; const fb = this._fallback[metric] && this._seriesEntry(this._fallback[metric], name); return fb || this.years.map(() => 0); }
  citySeriesFor(metric) { const c = this._ts && this._ts.city && this._ts.city[metric]; if (c && c.length) return c; return (this._fallback.city && this._fallback.city[metric]) || this.years.map(() => 0); }
  yoyFor(metric, name, idx) { const y = this._ts && this._ts.yoy && this._ts.yoy[metric]; const arr = y && this._seriesEntry(y, name); if (arr && arr.length > idx && arr[idx] != null) return pctNorm(arr[idx]); const s = this.seriesFor(metric, name); if (idx <= 0) return null; const prev = s[idx - 1], cur = s[idx]; if (!prev) return cur > 0 ? 1 : null; return (cur - prev) / prev; }
  _idxForYear(y) { const yy = Math.max(this.years[0], Math.min(this.years[this.years.length - 1], Math.round(y))); return this.years.indexOf(yy); }
  _computeRanges() { for (const metric of Object.keys(METRICS)) { let mn = Infinity, mx = -Infinity; for (const d of this._districts) for (const v of this.seriesFor(metric, d.name)) { if (v < mn) mn = v; if (v > mx) mx = v; } if (!isFinite(mn)) mn = 0; if (!isFinite(mx) || mx <= mn) mx = mn + 1; this._range[metric] = { min: mn, max: mx }; } }
  heightFor(metric, value, scale) { const r = this._range[metric] || { min: 0, max: 1 }; const t = Math.max(0, Math.min(1, (value - r.min) / ((r.max - r.min) || 1))); const span = scale === 'S2' ? S2_SPAN : S1_SPAN; return span[0] + t * (span[1] - span[0]); }
  colorFor(yoy) { if (yoy == null) return C(GRAY, .55); const sat = Math.min(1, Math.abs(yoy) / SATURATE_AT); if (yoy > FLAT_BAND) return lerpColor(C(GRAY, .55), C(BLUE, .85), sat); if (yoy < -FLAT_BAND) return lerpColor(C(GRAY, .55), C(ORANGE, .85), sat); return C(GRAY_LIGHT, .42); }
  /* ---- 逐幀動畫讀值：350ms 內從 v0/c0 補間到 v1/c1，高度依「目前尺度」即時換算（S1↔S2 邊界自然改變誇張倍率）---- */
  _curValue(name) { const a = this._anim.get(name); if (!a) return 0; const u = Math.min(1, (performance.now() - a.t0) / TWEEN_MS); return a.v0 + (a.v1 - a.v0) * u; }
  _colorNow(name) { const a = this._anim.get(name); if (!a) return C(GRAY, .55); const u = Math.min(1, (performance.now() - a.t0) / TWEEN_MS); return Cesium.Color.lerp(a.c0, a.c1, u, new Cesium.Color()); }
  _heightNow(name) { return this.heightFor(this.metric, this._curValue(name), this.layers.scale); }
  _labelText(name) { const idx = this._idxForYear(this.layers.year); const v = Math.round(this.seriesFor(this.metric, name)[idx] || 0); const yoy = pctNorm(this.yoyFor(this.metric, name, idx)); const unit = METRICS[this.metric].unit;
    const arrow = yoy == null ? '持平' : yoy > FLAT_BAND ? `▲${Math.round(yoy * 100)}%` : yoy < -FLAT_BAND ? `▼${Math.abs(Math.round(yoy * 100))}%` : '持平';
    return `${name} · ${fmtInt(v)}${unit} · ${arrow}`; }
  /* ---- 建圖：12 個行政區各一個 extruded polygon + label，掛進 layers.ds.tm（LAYERS.tm 已在 funraise.js 註冊，
   * 尺度遮罩／標籤預算沿用既有 applyScale()/recomputeLabels()，這裡完全不用另外處理 S3+ 隱藏）。---- */
  _build() {
    if (!this.layers.ds.tm) return; // 防禦：funraise.js 沒有註冊 LAYERS.tm 時，靜默跳過而不是丟例外
    const light = !!this.layers._themeLight; const fill = light ? '#1E2939' : '#F3F4F6', outline = light ? '#FFFFFF' : '#030712', bg = light ? '#FFFFFF' : '#030712';
    for (const d of this._districts) {
      const name = d.name; const ring = d.rings[0]; const flat = []; for (const p of ring) flat.push(p[0], p[1]);
      const centroid = this.layers.districtCentroids.get(name) || [ring[0][0], ring[0][1]];
      const key = 'tm:' + name; const item = { name, category: '區級價值面（時光機）', lat: centroid[1], lon: centroid[0], get status() { return self._labelText(name); } };
      const self = this;
      const posCB = new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(centroid[0], centroid[1], this._heightNow(name) + 30), false);
      const ent = this.layers.add('tm', key, item, {
        polygon: { hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)), height: 0.5, extrudedHeight: new Cesium.CallbackProperty(() => this._heightNow(name), false), material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => this._colorNow(name), false)), outline: true, outlineColor: new Cesium.CallbackProperty(() => C(outline === '#FFFFFF' ? '#FFFFFF' : '#FFFFFF', this.layers.isHot(key) ? .95 : .3), false), outlineWidth: new Cesium.CallbackProperty(() => this.layers.isHot(key) ? 3 : 1, false) },
        position: posCB,
        label: mkLabel(new Cesium.CallbackProperty(() => this._labelText(name), false), { fill, outline, bg }),
      });
      ent._imp = 0.92; this._entities.set(name, ent);
    }
  }
  /* ---- 年份變化：對每個行政區起一段 350ms 補間；往前推進時順便對它閃一次（重用既有 pulse/isHot，不另造機制），
   * 並在 S2–S3 補上當年 MOPS 金額浮動標籤（S1／圖層關閉時完全不生成，避免無謂 entity）。---- */
  _onYear(year, prev) {
    const idx = this._idxForYear(year);
    for (const d of this._districts) {
      const name = d.name; const v = this.seriesFor(this.metric, name)[idx] || 0; const yoy = pctNorm(this.yoyFor(this.metric, name, idx)); const c1 = this.colorFor(yoy);
      const had = this._anim.has(name); const curV = had ? this._curValue(name) : 0; const curC = had ? this._colorNow(name) : C(GRAY, .55);
      this._anim.set(name, { v0: curV, v1: v, c0: curC, c1, t0: performance.now() });
      if (prev != null && year > prev) this.layers.pulse('tm:' + name, PULSE_MS);
    }
    this._spawnMopsLabels(year, prev);
  }
  _spawnMopsLabels(year, prev) {
    this.fx.entities.removeAll(); // 立刻清掉上一批（跟 funraise.js 的成長特效同一個「先清後補」慣例）
    if (prev == null || year <= prev) return; if (!this.layers.vis.tm) return;
    const scale = this.layers.scale; if (scale !== 'S2' && scale !== 'S3') return;
    const list = (this.data.mops || []).filter(m => m.lat && m._year === year).slice(0, 8); if (!list.length) return;
    const spawnedAt = performance.now(); this._mopsSpawnedAt = spawnedAt;
    list.forEach((m, i) => { const num = CIRCLED[i] || ('#' + (i + 1)); const fade = () => Math.max(0, 1 - (performance.now() - spawnedAt) / MOPS_FADE_MS);
      this.fx.entities.add({ position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 55),
        point: { pixelSize: 7, color: new Cesium.CallbackProperty(() => C('#F29628', fade()), false), outlineColor: new Cesium.CallbackProperty(() => C('#FFDAA0', fade()), false), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: `${num} ${fmtMoney(m.total_price)}`, font: '600 13px "SF Mono",ui-monospace,monospace', fillColor: new Cesium.CallbackProperty(() => C('#FFDAA0', fade()), false), outlineColor: new Cesium.CallbackProperty(() => C('#030712', .9 * fade()), false), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -10), disableDepthTestDistance: Number.POSITIVE_INFINITY, showBackground: true, backgroundColor: new Cesium.CallbackProperty(() => C('#030712', .55 * fade()), false) } }); });
    setTimeout(() => { if (this._mopsSpawnedAt === spawnedAt) this.fx.entities.removeAll(); }, MOPS_FADE_MS + 100);
  }
  /* ---- 商圈熱區標籤外掛季度數字（deliverable #4 後半）：2024 年起，讀 business_areas 自己的 self_series，
   * 用 CallbackProperty 取代原本的靜態字串；找不到當年季度資料就顯示原本兩行，不強加假數字。---- */
  _patchHeatLabels() {
    const ds = this.layers.ds.heat; if (!ds) return;
    for (const e of ds.entities.values) {
      if (!e.label) continue; const pl = e.properties && e.properties.pl ? e.properties.pl.getValue() : null; if (!pl || pl.layer !== 'heat') continue;
      const a = pl.item; const mp = a.market_price || {}; const base = `${(a.name || '').replace(/^台北市|^臺北市/, '')}\n租 ${fmtInt(mp.actual_rent_avg || 0)}/坪 · 售 ${fmtInt((mp.actual_sale_avg || 0) / 1e4)} 萬/坪`;
      const rentArr = (a.self_series && a.self_series.rent) || a.rent_series || []; const saleArr = (a.self_series && a.self_series.sale) || a.sale_series || [];
      const self = this;
      e.label.text = new Cesium.CallbackProperty(() => { const y = Math.round(self.layers.year); if (y < 2024) return base;
        const rp = rentArr.filter(p => p.year === y), sp = saleArr.filter(p => p.year === y); if (!rp.length && !sp.length) return base;
        const r = rp[rp.length - 1], s = sp[sp.length - 1]; const q = (r && r.quarter) || (s && s.quarter);
        const parts = []; if (r) parts.push(`租 ${fmtInt(r.value)}/坪`); if (s) parts.push(`售 ${fmtInt(s.value / 1e4)} 萬/坪`);
        return `${base}\n${y} Q${q} ${parts.join(' · ')}`; }, false);
    }
  }
  /* ---- 對外查詢（供 #yearhud、scenes.js 敘事、agent 讀取，皆為唯讀計算，不改任何實體）---- */
  cityStats(year) { const idx = this._idxForYear(year); const salesAllArr = this.citySeriesFor('sales_all');
    const salesAll = Math.round(salesAllArr[idx] || 0), salesOffice = Math.round(this.citySeriesFor('sales_office')[idx] || 0), licenses = Math.round(this.citySeriesFor('licenses')[idx] || 0);
    const yoyPct = idx > 0 && salesAllArr[idx - 1] ? (salesAllArr[idx] - salesAllArr[idx - 1]) / salesAllArr[idx - 1] : null;
    return { salesAll, salesOffice, licenses, yoyPct, year: this.years[idx] ?? year }; }
  districtStats(name, year) { const idx = this._idxForYear(year); const value = Math.round(this.seriesFor(this.metric, name)[idx] || 0); return { name, year: this.years[idx] ?? year, value, yoyPct: pctNorm(this.yoyFor(this.metric, name, idx)) }; }
  topMover(year) { const idx = this._idxForYear(year); let best = null; for (const d of this._districts) { const yoy = pctNorm(this.yoyFor(this.metric, d.name, idx)); if (yoy == null) continue; if (!best || Math.abs(yoy) > Math.abs(best.yoyPct)) best = { name: d.name, yoyPct: yoy, value: Math.round(this.seriesFor(this.metric, d.name)[idx] || 0) }; } return best; }
  /* ---- public API：main.js 掛到 map.timemachine／window.PL.timemachine ---- */
  get api() {
    const self = this;
    return {
      get metric() { return self.metric; }, metrics: Object.keys(METRICS), metricLabel: m => (METRICS[m] || {}).label || m,
      setMetric(m) { if (!METRICS[m] || m === self.metric) return self.metric; self.metric = m; self._computeRanges(); self._onYear(self.layers.year, self.layers.year); return self.metric; },
      get visible() { return !!(self.layers.ds.tm && self.layers.ds.tm.show); },
      setVisible(on) { self.layers.setVisible('tm', !!on); return !!(self.layers.ds.tm && self.layers.ds.tm.show); },
      get source() { return self._src; },
      cityStats: y => self.cityStats(y), districtStats: (n, y) => self.districtStats(n, y), topMover: y => self.topMover(y),
      ready: self._ready,
    };
  }
}
