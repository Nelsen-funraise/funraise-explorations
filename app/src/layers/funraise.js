// FUNRAISE MCP data → Cesium entity layers (one CustomDataSource per layer, GEV-style layer registry)
import * as Cesium from 'cesium';
import { icon, clusterImage } from './icons.js';
const D2R = Math.PI / 180;
const BB = (name, color, size = 30, far = 26000) => ({ image: icon(name, color, 64), width: size, height: size, verticalOrigin: Cesium.VerticalOrigin.CENTER, disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new Cesium.NearFarScalar(600, 1.15, far, 0.45), translucencyByDistance: new Cesium.NearFarScalar(far * 0.8, 1, far * 1.6, 0.15) });
// scales: which camera-height bands (compose.js §16.1 S0..S4) show this layer at all — a mask ANDed with the user's own
// on/off toggle (ds.show = vis[k] && mask[k]), never the reverse. labelScales narrows further: outside it the layer's
// entities can still be visible, only their labels hide (still subject to the label budget/importance on top of that).
export const LAYERS = {
  stock:    { name: '商辦存量',        color: '#FCBE83', glyph: 'box',     desc: 'FUNRAISE 商辦資料庫 · 等級 / 屋齡 / 認證 / 捷運距離 / 照片', scales: ['S1', 'S2', 'S3', 'S4'], labelScales: ['S3', 'S4'] },
  future:   { name: '未來供給（規劃中）', color: '#93DCE6', glyph: 'ghost', icon: 'ghost',   desc: '興建中／規劃中建案 · 逐層用途 · 完工年（隨時間軸長高）', scales: ['S2', 'S3', 'S4'], labelScales: ['S2', 'S3', 'S4'] },
  licenses: { name: '建照（即將開工）',   color: '#50C0D4', glyph: 'pulse', icon: 'permit',   desc: '臺北市 114–115 年建照 · 未來 24–48 月新供給訊號', scales: ['S3', 'S4'], labelScales: ['S3', 'S4'] },
  renewal:  { name: '都更單元',        color: '#C4B5FD', glyph: 'polygon', icon: 'renew', desc: '都更地區／單元圖形 · 政府主導／已核定事業', scales: ['S2', 'S3', 'S4'], labelScales: ['S3'] },
  zones:    { name: '重劃／區段徵收',   color: '#A78BFA', glyph: 'hex',     desc: '臺北市 73 筆市地重劃／區段徵收', scales: ['S1', 'S2', 'S3'], labelScales: ['S1', 'S2'] },
  mops:     { name: '上市櫃資產交易',   color: '#F29628', glyph: 'diamond', icon: 'deal', desc: '公開資訊觀測站 取得／處分資產（近 12 月）', scales: ['S2', 'S3', 'S4'], labelScales: ['S2', 'S3', 'S4'] },
  moves:    { name: '企業遷徙',        color: '#DE7020', glyph: 'arc', icon: 'arrow',     desc: '公司登記地址跨區異動（2026-07）· 由原址飛向新址', scales: ['S2', 'S3', 'S4'], labelScales: ['S2', 'S3', 'S4'] },
  infra:    { name: '公共建設（興建中）', color: '#BBEAF0', glyph: 'square', icon: 'crane',  desc: '捷運環狀線／信義東延／汐東線 · TOD 開發', scales: ['S1', 'S2', 'S3', 'S4'], labelScales: ['S1', 'S2', 'S3', 'S4'] },
  parks:    { name: '產業園區',        color: '#6EE7B7', glyph: 'ring', icon: 'factory',    desc: '產業園區範圍', scales: ['S1', 'S2', 'S3'], labelScales: ['S1', 'S2', 'S3'] },
  heat:     { name: '商圈行情',        color: '#FCBE83', glyph: 'heat', icon: 'coin',    desc: '商圈租金／售價熱度', scales: ['S1', 'S2', 'S3'], labelScales: ['S1', 'S2', 'S3'] },
  parcels:  { name: '地號（都更模擬）',  color: '#93DCE6', glyph: 'polygon', icon: 'parcel', desc: '台北市地籤圖：選定都更單元內的地號、面積、使用分區（FUNRAISE MCP land-info）', scales: ['S2', 'S3', 'S4'], labelScales: ['S3', 'S4'] },
  mrt:      { name: '捷運路網',        color: '#99A1AF', glyph: 'line', icon: 'metro',    desc: '台北捷運 6 線（OSM）', scales: ['S1', 'S2', 'S3', 'S4'], labelScales: ['S2', 'S3', 'S4'] },
  tm:       { name: '價值面',          color: '#16A4C0', glyph: 'polygon', desc: '區級價值時光機 · 成交／建照隨年份長高，藍升橘降（Phase 9F）', scales: ['S1', 'S2'], labelScales: ['S1', 'S2'] },
};
const C = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
const MRT_COLOR = { '文湖線': '#C48C31', '淡水信義線': '#E3002C', '松山新店線': '#008659', '中和新蘂線': '#F8B61C', '中和新蘆線': '#F8B61C', '板南線': '#0070BD', '環狀線': '#FFDB00' };
// §18.1 效能（Phase 11P owner 反饋：實景場景播放時很卡）：future_dev／renewal 的材質顏色只有幾種固定狀態，
// 但包著它們的 CallbackProperty(fn,false) 每一幀都會被重新估值——先把 Color 物件建好、每幀只換參照，不要每
// 一幀都重新 parse hex 字串／配置新物件（Cesium 的 ColorMaterialProperty.getValue() 本來就會把值 clone 進自己
// 的 result，回傳同一個快取物件參照是安全的，不會被 Cesium 反過來修改）。
const FUTURE_MAT_DONE = C('#93DCE6', 0.78), FUTURE_MAT_HOT = C('#93DCE6', 0.45), FUTURE_MAT_COOL = C('#93DCE6', 0.2);
const RENEWAL_OUTLINE_BASE = Cesium.Color.fromCssColorString('#EDE9FE'); // 都更單元「呼吸」外框只有透明度在變，底色不用每一幀重 parse
// §18.3: softer/larger heat glow — a gentler multi-stop falloff (was a hard 0.9→0.42→0 two-step) and lower base alpha below.
const heatDisc = (() => { let url = null; return () => { if (url) return url; const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128); grd.addColorStop(0, 'rgba(255,255,255,0.68)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.34)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, 256, 256); url = c.toDataURL('image/png'); return url; }; })();
const heatTint = (hot, light, mul = 1) => light ? Cesium.Color.fromCssColorString('#16A4C0').withAlpha((0.14 + hot * 0.10) * mul) : Cesium.Color.fromCssColorString(`rgb(${Math.round(252 - 66 * hot)},${Math.round(190 - 98 * hot)},${Math.round(131 - 86 * hot)})`).withAlpha((0.22 + hot * 0.10) * mul);
const yearOf = s => { if (!s) return null; const m = String(s).match(/(\d{4})/); if (m) return +m[1]; const r = String(s).match(/^(\d{3})/); return r ? +r[1] + 1911 : null; };
// Phase 10R Harmony (§18.3): every label is a pill — showBackground always on (建構灰 @.78 dark / white @.88 light,
// set here and kept in sync per-theme by setTheme() below), 12px sans for names / 11px mono for numbers-as-label
// (one fact per label; the second line, if any, lives in the hover card), no stroke outline (the pill supplies
// contrast on its own, so a black outline just muddies the glass look the owner asked for).
const FONT = '500 12px "Inter", "Noto Sans TC", sans-serif', MONO = '600 11px "SF Mono", ui-monospace, Menlo, monospace';
const label = (text, opts = {}) => ({ text, font: opts.font || FONT, fillColor: C(opts.color || '#F3F4F6'), style: Cesium.LabelStyle.FILL, pixelOffset: new Cesium.Cartesian2(0, opts.dy ?? -14), verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(opts.near || 0, opts.far || 3500), scale: opts.scale || 1, showBackground: true, backgroundColor: C('#1E2939', .78), backgroundPadding: new Cesium.Cartesian2(8, 4) });
// view composer helpers (§16.1/§16.4): short renewal-unit names at S3 (full name stays in hover/select, which read the
// item, not the label), a local haversine-ish metre distance for the analysis-ring dim mask, and the z-bias that makes
// a selected/highlighted label win over an overlapping ordinary one (disableDepthTestDistance is already universal above).
export const shortName = s => { s = String(s ?? ''); return s.length > 10 ? s.slice(0, 9) + '…' : s; };
const distM = (lon1, lat1, lon2, lat2) => Math.hypot((lon1 - lon2) * 111320 * Math.cos(lat2 * Math.PI / 180), (lat1 - lat2) * 110540);
const EYE_BIAS = new Cesium.Cartesian3(0, 0, -3);

export class FunraiseLayers {
  constructor(viewer, data, basemap, osm) {
    this.viewer = viewer; this.d = data; this.base = basemap || {}; this.osm = osm; this.year = new Date().getFullYear(); this.now = this.year; this.t0 = performance.now();
    this.ds = {}; this.byKey = new Map(); this.highlight = new Map(); this.vis = Object.fromEntries(Object.keys(LAYERS).map(k => [k, true]));
    // compose.js state: mask = scale gate (separate from vis, the user's own toggle); scale/labelBudget/selectedKey drive
    // recomputeLabels(); _ringActive/_tripsDim are transient compat-matrix modes (§16.3); _themeLight mirrors setTheme().
    this.mask = Object.fromEntries(Object.keys(LAYERS).map(k => [k, true]));
    this.scale = 'S3'; this.labelBudget = 24; this.selectedKey = null; this._densityMinImp = 0; this._themeLight = true; this._ringActive = false; this._tripsDim = false; this._ring = null; this._viewBounds = null;
    for (const k of [...Object.keys(LAYERS), 'labels', 'markers', 'fx']) { this.ds[k] = new Cesium.CustomDataSource(k); viewer.dataSources.add(this.ds[k]); }
    this.prevYear = this.year; this.yearChangedAt = 0;
    this.districtCentroids = new Map(); for (const d of this.base.districts || []) { const r = d.rings && d.rings[0]; if (!r) continue; let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } this.districtCentroids.set(d.name, [x / r.length, y / r.length]); }
  }
  add(layer, key, item, ent) { ent.properties = { pl: { layer, key, item } }; const e = this.ds[layer].entities.add(ent); this.byKey.set(key, e); return e; }
  get t() { return (performance.now() - this.t0) / 1000; }
  isHot(key) { const u = this.highlight.get(key); return u && u > performance.now(); }
  pulse(key, ms = 7000) { this.highlight.set(key, performance.now() + ms); }
  setVisible(k, on) { if (!this.ds[k]) return; this.vis[k] = !!on; this._applyShow(k); }
  /* ---- view composer (compose.js): scale mask, separate from the user's own `vis` toggle — ds.show is their AND ---- */
  _applyShow(k) { const on = !!(this.vis[k] && this.mask[k] !== false); this.ds[k].show = (k === 'stock' && this._hideStockVolumes) ? false : on; if (k === 'stock' && this.ds.markers) this.ds.markers.show = on; }
  // 實景（Google 3D Tiles）下商辦的橘色量體會和 frames.js 的玻璃殼打架：只藏量體，icon／標籤照常（Phase 10P 交接事項）
  setStockVolumes(on) { this._hideStockVolumes = !on; this._applyShow('stock'); }
  setMask(k, on) { if (!(k in this.mask)) return; this.mask[k] = !!on; this._applyShow(k); }
  _scaleAllows(k) { const sc = LAYERS[k] && LAYERS[k].scales; return !sc || sc.includes(this.scale); }
  /** Called by compose.js after every scale re-evaluation (§16.1). Re-derives every layer's mask from LAYERS[k].scales,
   * forces heat/zones off while an analysis ring is active (§16.3), degrades zones to outline-only at S3, and re-runs
   * the label budget (labelScales can also change per scale even when the mask itself doesn't). */
  applyScale(scale) {
    this.scale = scale;
    for (const k of Object.keys(LAYERS)) { const allowed = this._scaleAllows(k); this.setMask(k, (this._ringActive && (k === 'heat' || k === 'zones')) ? false : allowed); }
    this._recomputeZoneOutline();
    this.recomputeLabels();
  }
  _recomputeZoneOutline() { // §16.1 S3: 重劃／區段徵收「太大，退成外框」— keep the mask on but fade the fill, drop the label (labelScales already excludes S3)
    const on = this.scale === 'S3';
    for (const e of this.ds.zones.entities.values) { if (!e.ellipse) continue; if (e._zoneAlpha0 == null) { const c = e.ellipse.material && e.ellipse.material.color; e._zoneAlpha0 = (c && c.getValue ? c.getValue().alpha : null) ?? 0.15; } e.ellipse.material = C('#A78BFA', on ? 0.02 : e._zoneAlpha0); }
  }
  /** Uniform billboard-icon alpha for a whole ds (heat glow discs included): factor 1 restores. Used by the overlay↔heat
   * and trips-playing↔stock-icon reactions in compose.js — never touches box/polygon materials (those keep their own
   * isHot()-driven CallbackProperty; overwriting `.material` there would freeze their pulse permanently). */
  setFlatAlpha(k, factor) {
    const ds = this.ds[k]; if (!ds) return; const full = factor >= 1;
    for (const e of ds.entities.values) { if (e.billboard) e.billboard.color = Cesium.Color.WHITE.withAlpha(full ? 1 : factor); if (e.ellipse && e._hot != null) e.ellipse.material = new Cesium.ImageMaterialProperty({ image: heatDisc(), transparent: true, color: heatTint(e._hot, this._themeLight, full ? 1 : factor) }); }
  }
  /** §16.3 分析圈（等時圈／生活圈）active: dim out-of-ring icons on the point layers to 30%, hide heat/zones (mask),
   * renewal keeps polygons only (its label is gated in recomputeLabels()). origin=null clears back to normal. */
  setRingDim(origin, radiusM) {
    // 'markers' (not 'stock'): the stock layer's own ds only holds the extruded polygon/box volumes — its billboard
    // icon lives in the separate cluster/marker ds built by buildMarkers(), which is what actually needs dimming here.
    const POINT_LAYERS = ['markers', 'future', 'licenses', 'mops', 'moves', 'infra', 'parks'];
    this._ring = origin ? { lon: origin[0], lat: origin[1], r: radiusM || 1200 } : null;
    for (const k of POINT_LAYERS) { const ds = this.ds[k]; if (!ds) continue;
      for (const e of ds.entities.values) { if (!e.billboard) continue; const pl = e.properties && e.properties.pl ? e.properties.pl.getValue() : null; const it = pl && pl.item;
        const inR = !this._ring || !it || it.lat == null || distM(it.lon, it.lat, this._ring.lon, this._ring.lat) <= this._ring.r;
        e.billboard.color = Cesium.Color.WHITE.withAlpha(inR ? 1 : 0.3); } }
    this._ringActive = !!this._ring;
    this.setMask('heat', this._ringActive ? false : this._scaleAllows('heat'));
    this.setMask('zones', this._ringActive ? false : this._scaleAllows('zones'));
    this.recomputeLabels();
  }
  /** §16.3 遷徙動線播放中: mops/licenses labels hide (recomputeLabels' gate), stock icons (the marker cluster billboards) dim to 40%. */
  setTripsDim(on) { this._tripsDim = !!on; this.setFlatAlpha('markers', on ? 0.4 : 1); this.recomputeLabels(); }
  setSelected(key) { this.selectedKey = key || null; this.recomputeLabels(); }
  setLabelBudget(n, { recompute = true } = {}) { this.labelBudget = n; if (recompute) this.recomputeLabels(); } // §18.1 效能：compose.js 的 apply() 在同一次尺度變更裡緊接著呼叫 applyScale()（尾端自己會 recompute 一次）——呼叫端可以傳 {recompute:false} 避免同一批變更算兩次全部標籤，預設值維持原行為不變
  /** compose.js passes rig.bounds() here on every apply() (not just on scale change) so the budget ranks labels that
   * are actually near the current camera first — a *global* top-N by importance (the previous behaviour) could easily
   * pick 24 labels scattered anywhere in Taipei, none of them on screen. null clears back to unscoped/global ranking. */
  setViewBounds(b) { this._viewBounds = b; }
  /** Entity → [lon,lat] for the view-bounds check in recomputeLabels() below: prefers the FUNRAISE item's own
   * lon/lat (or renewal-style centroid `_c`), falls back to reading the entity's own (static) position — mirrors
   * fx/focus.js's itemLonLat(). */
  _entityLonLat(e, pl) {
    if (pl && pl.item) { if (pl.item.lat != null) return [pl.item.lon, pl.item.lat]; if (pl.item._c) return pl.item._c; }
    if (e.position) { try { const c = e.position.getValue ? e.position.getValue(this.viewer.clock.currentTime) : e.position; if (c) { const carto = Cesium.Cartographic.fromCartesian(c); return [carto.longitude / D2R, carto.latitude / D2R]; } } catch { /* dynamic/unresolvable */ } }
    return null;
  }
  /** Unified label visibility pass (§16.1 label budget + §16.3 exclusions), replacing the old inline `e.label.show =`
   * in setDensity(): selected (map.selected, via compose's ui.select wrap) and highlighted (isHot(), pulse()) entities
   * always show and never count against the budget; everything else is gated by its layer's labelScales, the transient
   * ring/trips modes, the density importance floor, and finally ranked in-view-first by importance() against the
   * numeric budget (see setViewBounds() above — off-screen candidates only fill leftover budget, never crowd it out). */
  recomputeLabels() {
    const scale = this.scale, minImp = this._densityMinImp ?? 0, tripsDim = !!this._tripsDim, ringActive = !!this._ringActive;
    // §16.1 budget must reflect what's actually on screen: rank in-view candidates first, only spill into
    // off-screen ones (sorted the same way) if the budget isn't filled — a *global* top-N could fill the whole
    // budget with e.g. mops deals or district names scattered anywhere in Taipei, none of them near the camera.
    const b = this._viewBounds; const padLon = b ? (b[2] - b[0]) * 0.25 : 0, padLat = b ? (b[3] - b[1]) * 0.25 : 0;
    const inBounds = (lon, lat) => !b || (lon >= b[0] - padLon && lon <= b[2] + padLon && lat >= b[1] - padLat && lat <= b[3] + padLat);
    const inView = [], outView = [];
    // §18.1 效能：主力清單來自 build() 尾端快取的 this._labeled（見那裡的註解——大部分實體根本沒有 label，
    // 這裡不用再逐一 `if (!e.label) continue`）。兩個 datasource 沒有快取、現抓，因為它們的實體是在
    // FunraiseLayers.build() 完成之後才由「外部」加進來，_labeled 這個 build() 時期的快照本來就看不到：
    // 'fx' 是時間軸「長高」特效（onYearChange()，本檔自己的方法，但實體是動態新增/整批清空的）；
    // 'tm' 是價值時光機的 12 個行政區量體＋標籤（layers/timemachine.js 的 _build()，該模組在 main.js 裡是
    // compose 建好之後才 new 出來，晚於 layers.build() 很多——這裡如果沒有現抓，這 12 個標籤就永遠不會被
    // recomputeLabels() 摸到，會卡在 Cesium 預設的 show:true，不受尺度／標籤預算／選取狀態管控）。兩者都很
    // 小（'fx' 通常是空的，只有跨年動畫還沒消失的 2.5 秒才有內容；'tm' 固定 12 個），現抓的額外開銷可忽略。
    const visit = (e, pl, layer, key) => {
      if (!e.label) return;
      if (key && (key === this.selectedKey || this.isHot(key))) { e.label.show = true; e.label.eyeOffset = EYE_BIAS; return; }
      e.label.eyeOffset = Cesium.Cartesian3.ZERO;
      const L = layer ? LAYERS[layer] : null;
      if (L && L.labelScales && !L.labelScales.includes(scale)) { e.label.show = false; return; }
      if (ringActive && layer === 'renewal') { e.label.show = false; return; }
      if (tripsDim && (layer === 'mops' || layer === 'licenses')) { e.label.show = false; return; }
      const imp = e._imp == null ? 1 : e._imp; if (imp < minImp) { e.label.show = false; return; }
      const pos = this._entityLonLat(e, pl);
      (pos && !inBounds(pos[0], pos[1]) ? outView : inView).push({ e, imp });
    };
    for (const { e, pl, layer, key } of this._labeled || []) visit(e, pl, layer, key);
    for (const e of this.ds.fx.entities.values) { if (e.label) visit(e, null, null, null); }
    for (const e of this.ds.tm.entities.values) { if (!e.label) continue; const pl = e.properties && e.properties.pl ? e.properties.pl.getValue() : null; visit(e, pl, pl ? pl.layer : null, pl ? pl.key : null); }
    inView.sort((a, c) => c.imp - a.imp); outView.sort((a, c) => c.imp - a.imp);
    const budget = this.labelBudget == null ? Infinity : this.labelBudget; let shown = 0;
    for (const r of inView) { r.e.label.show = shown < budget; shown++; }
    for (const r of outView) { r.e.label.show = shown < budget; shown++; }
  }
  /* Density budget (Direction C): scale label reach and hide low-importance labels when immersive. */
  setTheme(theme) { // light: darker text on white halo + white-disc icons (PickPeak); dark: original glow colours on dark halo
    const light = theme === 'light'; this._themeLight = light; for (const d of this._heatDiscs || []) d.ellipse.material.color = heatTint(d._hot, light);
    const DARK_INK = { stock: '#9A4B12', heat: '#9A4B12', mops: '#B45309', moves: '#B45309', future: '#0F6A85', licenses: '#0F6A85', infra: '#0F6A85', renewal: '#6D28D9', zones: '#6D28D9', parks: '#047857', mrt: '#374151' };
    const ICON_INK = { stock: '#0C83A2', heat: '#BA5C2D', mops: '#DE7020', moves: '#BA5C2D', future: '#0F6A85', licenses: '#0C83A2', infra: '#0F6A85', renewal: '#6D28D9', zones: '#6D28D9', parks: '#047857', mrt: '#374151' };
    for (const ds of Object.values(this.ds)) for (const e of ds.entities.values) {
      const pl = e.properties && e.properties.pl ? e.properties.pl.getValue() : null;
      if (e.billboard && pl) { const name = ds === this.ds.markers ? 'tower' : (LAYERS[pl.layer] && LAYERS[pl.layer].icon); if (name && e.billboard.image) { if (!e._img0) e._img0 = e.billboard.image.getValue(); const ink = ds === this.ds.markers && /^[AP]$/.test(pl.item.grade || '') ? '#DE7020' : (ICON_INK[pl.layer] || '#1E2939'); e.billboard.image = light ? icon(name, ink, 64, { bg: 'rgba(255,255,255,0.94)' }) : e._img0; } }
      if (!e.label) continue; if (!e._fill) e._fill = e.label.fillColor ? e.label.fillColor.getValue() : Cesium.Color.WHITE;
      // §18.3 pill background: 建構灰 @.78 in dark, white @.88 in light — no outline now (style is FILL-only; the pill supplies contrast).
      e.label.fillColor = light ? Cesium.Color.fromCssColorString(pl ? (DARK_INK[pl.layer] || '#1E2939') : '#4A5565') : e._fill; e.label.backgroundColor = light ? Cesium.Color.fromCssColorString('#FFFFFF').withAlpha(.88) : Cesium.Color.fromCssColorString('#1E2939').withAlpha(.78); }
  }
  setDensity(mode) {
    const f = mode === 'immersive' ? 0.6 : mode === 'annotated' ? 1.7 : 1; this._densityMinImp = mode === 'immersive' ? 0.5 : 0;
    for (const ds of Object.values(this.ds)) for (const e of ds.entities.values) { if (!e.label) continue; if (e._far == null) { const d = e.label.distanceDisplayCondition && e.label.distanceDisplayCondition.getValue(); e._far = d ? d.far : 3500; }
      e.label.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(0, e._far * f); }
    this.recomputeLabels();
  }
  importance(layer, item) {
    switch (layer) { case 'stock': return item.grade === 'A' || item.grade === 'P' ? 0.9 : item.grade === 'F' ? 0.6 : 0.35; case 'future': return 0.8; case 'renewal': return item.category === '政府主導' ? 0.75 : 0.4; case 'mops': return Math.min(1, 0.5 + Math.log10(Math.max(1, item.total_price || 1)) / 20); case 'licenses': return 0.3; case 'zones': return 0.3; case 'infra': return 0.85; case 'parks': return 0.85; case 'heat': return 0.9; case 'mrt': return 0.4; case 'moves': return 0.45; default: return 0.5; }
  }
  build() { this.buildStock(); this.buildMarkers(); this.buildFuture(); this.buildParcels(); this.buildLicenses(); this.buildRenewal(); this.buildZones(); this.buildMops(); this.buildMoves(); this.buildInfra(); this.buildParks(); this.buildHeat(); this.buildMrt(); this.buildDistricts();
    // §18.1 效能：除了 'fx'（時間軸長高特效，onYearChange() 之後動態新增/整批清空）跟 'tm'（價值時光機的 12
    // 個行政區量體，layers/timemachine.js 建構時才補進來，晚於這裡）以外，每個 datasource 的實體在這之後都
    // 不會再變動——把「有 label 的實體」連同讀好的 pl/layer/key 快取起來，recomputeLabels() 之後只掃這個小
    // 很多的清單（'fx'／'tm' 現抓，見那裡的註解），不用每次都連「沒有 label」的量體/針腳/路網線段一起掃過。
    this._labeled = [];
    for (const ds of Object.values(this.ds)) for (const e of ds.entities.values) { if (!e.label) continue; const pl = e.properties && e.properties.pl ? e.properties.pl.getValue() : null; e._imp = pl ? this.importance(pl.layer, pl.item) : 1; this._labeled.push({ e, pl, layer: pl ? pl.layer : null, key: pl ? pl.key : null }); }
  }
  /* ---- 商辦存量 ---- */
  buildStock() {
    for (const b of this.d.buildings || []) {
      if (!b.lat) continue; const key = 'stock:' + b.id; const grade = b.grade || 'B'; const col = grade === 'A' ? '#FCBE83' : grade === 'F' ? '#6EE7B7' : grade === 'P' ? '#F29628' : '#E8C9A0';
      const built = yearOf(b.license_date); const floors = b.floor_above || 8; let h = floors * 3.6 + 4;
      const foot = this.osm ? this.osm.nearest(b.lon, b.lat, 48) : null; if (foot) h = Math.max(h, foot.h + 1.5);
      b._h = h; b._built = built;
      const show = new Cesium.CallbackProperty(() => built == null || built <= this.year, false);
      const matHot = C(col, 0.98), matCool = C(col, grade === 'A' ? 0.82 : 0.62); // §18.1 效能：兩種固定狀態算好快取，CallbackProperty 每幀只切換參照
      const mat = new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => this.isHot(key) ? matHot : matCool, false));
      const common = { show, properties: null };
      if (foot) this.add('stock', key, b, { ...common, polygon: { shadows: Cesium.ShadowMode.ENABLED, hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(foot.ring)), height: 0, extrudedHeight: h, material: mat, outline: true, outlineColor: C(col, .95), outlineWidth: 1 } });
      else { const side = Math.max(18, Math.min(60, Math.sqrt((b.total_floor_area || 6000) / Math.max(1, floors + (b.floor_below || 0))) * 1.2)); this.add('stock', key, b, { ...common, position: Cesium.Cartesian3.fromDegrees(b.lon, b.lat, h / 2), box: { dimensions: new Cesium.Cartesian3(side, side, h), material: mat, outline: true, outlineColor: C(col, .95) } }); }
      this.ds.labels.entities.add({ show: new Cesium.CallbackProperty(() => this.vis.stock && (built == null || built <= this.year), false), position: Cesium.Cartesian3.fromDegrees(b.lon, b.lat, h + 6), label: label(b.name, { color: grade === 'A' || grade === 'P' ? '#FFDAA0' : grade === 'F' ? '#B9F0C9' : '#F3E5CF', far: grade === 'A' || grade === 'P' ? 2600 : 1400, dy: -6 }), properties: { pl: { layer: 'stock', key, item: b } } });
    }
  }
  /* ---- 商辦 markers：PickPeak 風格 —— 遠看是「N 棟」群聚圓，近看是大樓圖示，再近就只剩 3D 量體 ---- */
  buildMarkers() {
    const ds = this.ds.markers; const cl = ds.clustering; cl.enabled = true; cl.pixelRange = 64; cl.minimumClusterSize = 3; cl.clusterBillboards = true; cl.clusterLabels = false; cl.clusterPoints = false;
    for (const b of this.d.buildings || []) { if (!b.lat) continue; const key = 'stock:' + b.id; const grade = b.grade || 'B'; const col = grade === 'A' ? '#FCBE83' : grade === 'F' ? '#6EE7B7' : grade === 'P' ? '#F29628' : '#E8C9A0';
      const h = b._h || 40; const sz = grade === 'A' || grade === 'P' ? 34 : 26; // §18.3 size-by-importance: P/A 34px, others 26px
      const show = new Cesium.CallbackProperty(() => b._built == null || b._built <= this.year, false);
      ds.entities.add({ position: Cesium.Cartesian3.fromDegrees(b.lon, b.lat, h + 10), show,
        billboard: { image: icon('tower', col, 64), width: sz, height: sz, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(2200, 70000), scaleByDistance: new Cesium.NearFarScalar(3000, 1, 40000, 0.6) },
        properties: { pl: { layer: 'stock', key, item: b } } });
      // §18.3 needle: 1px hairline from the roof up to the floating chip, so it reads as attached rather than adrift.
      ds.entities.add({ show, polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights([b.lon, b.lat, h, b.lon, b.lat, h + 10]), width: 1, material: C(col, .5), disableDepthTestDistance: Number.POSITIVE_INFINITY } }); }
    cl.clusterEvent.addEventListener((entities, cluster) => { cluster.label.show = false; cluster.billboard.show = true; cluster.billboard.image = clusterImage(entities.length); cluster.billboard.width = entities.length >= 10 ? 56 : 46; cluster.billboard.height = cluster.billboard.width; cluster.billboard.verticalOrigin = Cesium.VerticalOrigin.CENTER; cluster.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY; cluster.billboard.id = { cluster: entities }; });
  }
  /* ---- 地號（都更模擬用）：選定單元內的地籤 polygon ---- */
  buildParcels() {
    const units = (this.d.parcels && this.d.parcels.units) || {};
    for (const [uid, u] of Object.entries(units)) for (const pc of u.parcels || []) { if (!pc.ring || pc.ring.length < 3) continue; const key = `parcel:${pc.sectcode}/${pc.landcode}`; const flat = []; let cx = 0, cy = 0; for (const q of pc.ring) { flat.push(q[0], q[1]); cx += q[0]; cy += q[1]; } cx /= pc.ring.length; cy /= pc.ring.length; const item = { ...pc, unit_id: uid, unit_name: u.name, name: `${pc.town} ${pc.section1}段 ${pc.landcode} 地號`, lon: cx, lat: cy };
      this.add('parcels', key, item, { polygon: { hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)), height: 0.8, material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C('#93DCE6', this.isHot(key) ? .45 : .14), false)), outline: true, outlineColor: C('#E3F8FA', .95), outlineWidth: 1.5 },
        position: Cesium.Cartesian3.fromDegrees(cx, cy, 3), label: label(pc.landcode, { color: '#E3F8FA', far: 900, font: MONO, dy: 0 }) }); }
  }
  /* ---- 時間軸動態：跨年時新出現的大樓「長出來」、當年交易「ping」 ---- */
  onYearChange(prev, year) {
    this.prevYear = prev; this.yearChangedAt = performance.now(); const fx = this.ds.fx; fx.entities.removeAll(); if (year <= prev) return;
    const born = (this.d.buildings || []).filter(b => b.lat && b._built != null && b._built > prev && b._built <= year).slice(0, 24);
    const t0 = performance.now();
    // Phase 9F：光柱＋樓層數標籤壽命拉到 2.5s（成長 900ms 到頂，維持到 1.8s，再淡出到 2.5s）——比舊版的 1.1s/1.5s
    // 更容易「看到它在哪裡長出來」；光柱顏色沿用 PickPeak 藍本藍／人文橘兩個色族，依目前鏡頭（investor 鏡＝橘／
    // 其餘＝藍）挑一個，讀 window.PL.agent.lens（此時 boot() 早已跑完，一定有值；沒有就預設藍）。
    const lens = () => { try { return (window.PL && window.PL.agent && window.PL.agent.lens) || null; } catch { return null; } };
    for (const b of born) { const h = b._h || 40; const side = Math.max(22, Math.min(64, Math.sqrt((b.total_floor_area || 6000) / Math.max(1, (b.floor_above || 8))) * 1.5));
      const grow = () => Math.min(1, (performance.now() - t0) / 900); const ease = () => 1 - Math.pow(1 - grow(), 3);
      const vis = () => { const el = performance.now() - t0; return el < 1800 ? 1 : Math.max(0, 1 - (el - 1800) / 700); }; // 滿 2.5s 才整批清掉（見下方 setTimeout）
      const beamCol = lens() === 'investor' ? '#F29628' : '#50C0D4'; const beamH = Math.max(150, Math.min(400, (b.floor_above || 8) * 5));
      fx.entities.add({ position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(b.lon, b.lat, h * 1.35 * ease() / 2), false), box: { dimensions: new Cesium.CallbackProperty(() => new Cesium.Cartesian3(side, side, Math.max(1, h * 1.35 * ease())), false), material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C('#FCBE83', 0.55 * vis()), false)), outline: true, outlineColor: C('#FFDAA0', .9) } });
      fx.entities.add({ position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(b.lon, b.lat, h + beamH * ease() / 2), false), cylinder: { topRadius: 2.5, bottomRadius: 2.5, length: new Cesium.CallbackProperty(() => Math.max(1, beamH * ease()), false), material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C(beamCol, 0.5 * vis()), false)), outline: false } });
      fx.entities.add({ position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(b.lon, b.lat, h + beamH * ease() + 14), false), label: { text: `+ ${b.name} · ${b.floor_above || '?'}F`, font: MONO, fillColor: new Cesium.CallbackProperty(() => C('#FFDAA0', vis()), false), outlineColor: C('#030712', .9), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY, scale: 1 } }); }
    for (const m of this.d.mops || []) if (m.lat && m._year === year) this.pulse('mops:' + m.id, 4000);
    for (const f of this.d.future_dev || []) if (f.lat && f._year === year) this.pulse('future:' + f.id, 4000);
    setTimeout(() => { if (this.yearChangedAt === t0 || performance.now() - t0 > 2600) fx.entities.removeAll(); }, 2500);
  }
  yearStats(year) { const d = this.d; return { stock: (d.buildings || []).filter(b => b._built === year).length, licenses: (d.building_licenses || []).filter(l => l._year === year).length, mops: (d.mops || []).filter(m => m._year === year).length, future: (d.future_dev || []).filter(f => f._year === year).length, total: (d.buildings || []).filter(b => b._built == null || b._built <= year).length }; }
  /* ---- 未來供給（幽靈建物，隨時間長高）---- */
  buildFuture() {
    for (const f of this.d.future_dev || []) {
      if (!f.lat) continue; const key = 'future:' + f.id; const done = yearOf(f.completion_date) || 2028; f._year = done; const h = (f.floors_above || 20) * (f.typical_floor_height || 3.6) + 4; const side = Math.max(22, Math.min(70, Math.sqrt(f.max_floor_area || 1000) * 1.15));
      const prog = () => Math.max(0.12, Math.min(1, (this.year - (done - 3)) / 3));
      const pos = new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(f.lon, f.lat, h * prog() / 2), false);
      const dims = new Cesium.CallbackProperty(() => new Cesium.Cartesian3(side, side, h * prog()), false);
      const mat = new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => this.year >= done ? FUTURE_MAT_DONE : (this.isHot(key) ? FUTURE_MAT_HOT : FUTURE_MAT_COOL), false));
      this.add('future', key, f, { position: pos, box: { shadows: Cesium.ShadowMode.ENABLED, dimensions: dims, material: mat, outline: true, outlineColor: C('#BBEAF0', .9) } });
      // §18.3 needle: box-top (its current, animated height) up to the floating chip, so the ghost volume reads as "claimed" rather than a bare box.
      this.ds.future.entities.add({ polyline: { positions: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegreesArrayHeights([f.lon, f.lat, Math.max(0, h * prog()), f.lon, f.lat, h * prog() + 8]), false), width: 1, material: C('#93DCE6', .5), disableDepthTestDistance: Number.POSITIVE_INFINITY } });
      this.ds.labels.entities.add({ show: new Cesium.CallbackProperty(() => this.vis.future, false), position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(f.lon, f.lat, h * prog() + 8), false), billboard: BB('ghost', '#93DCE6', 26, 7000), label: label(f.name, { color: '#BBEAF0', far: 4500 }), properties: { pl: { layer: 'future', key, item: f } } });
    }
  }
  /* ---- 建照脈衝 ---- */
  buildLicenses() {
    for (const l of this.d.building_licenses || []) {
      if (!l.lat) continue; const key = 'license:' + l.license_number; const y = yearOf(l.issue_date); l._year = y; const ph = Math.random() * 6.28;
      this.add('licenses', key, l, { position: Cesium.Cartesian3.fromDegrees(l.lon, l.lat, 6), show: new Cesium.CallbackProperty(() => this.year >= (y || 2025), false),
        point: { pixelSize: new Cesium.CallbackProperty(() => 4 + (this.isHot(key) ? 6 : 0), false), color: C('#50C0D4', .0), outlineColor: C('#50C0D4', .35), outlineWidth: new Cesium.CallbackProperty(() => 10 + 10 * (0.5 + 0.5 * Math.sin(this.t * 2.2 + ph)), false), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        billboard: BB('permit', '#50C0D4', 22, 9000),
        label: label(l.construction_type || l.license_number, { color: '#93DCE6', far: 1800, dy: -12 }) });
    }
  }
  /* ---- 都更多邊形 ---- */
  buildRenewal() {
    for (const u of this.d.urban_renewal || []) {
      if (!u.rings) continue; const key = 'renewal:' + u.id; const gov = u.category === '政府主導'; let cx = 0, cy = 0, n = 0;
      const fillHot = C(gov ? '#DDD6FE' : '#C4B5FD', .75), fillCool = C(gov ? '#DDD6FE' : '#C4B5FD', .08); // §18.1 效能：同一個單元的每一圈共用同一對快取色
      for (const ring of u.rings) { const flat = []; for (const p of ring) { flat.push(p[0], p[1]); cx += p[0]; cy += p[1]; n++; } if (flat.length < 6) continue;
        // §18.3: 8% base fill (keep hue) + a breathing edge — outline alpha oscillates .35↔.6 over a 2.4s cycle so the unit reads as "alive" even when nothing else is happening.
        this.add('renewal', key + ':' + n, u, { polygon: { hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)), height: 0.5, extrudedHeight: 3, material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => this.isHot(key) ? fillHot : fillCool, false)), outline: true, outlineColor: new Cesium.CallbackProperty(() => RENEWAL_OUTLINE_BASE.withAlpha(.475 + .125 * Math.sin(this.t * (Math.PI * 2 / 2.4))), false) } }); }
      if (n) { u._c = [cx / n, cy / n]; this.ds.labels.entities.add({ show: new Cesium.CallbackProperty(() => this.vis.renewal, false), position: Cesium.Cartesian3.fromDegrees(cx / n, cy / n, 10), billboard: { ...BB(gov ? 'renew' : 'renew', gov ? '#DDD6FE' : '#C4B5FD', gov ? 24 : 18, 7000), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, gov ? 9000 : 4000) }, label: label(shortName(u.name), { color: '#DDD6FE', far: 2600, dy: -16 }), properties: { pl: { layer: 'renewal', key, item: u } } }); }
    }
  }
  /* ---- 重劃／區段徵收 ---- */
  buildZones() {
    // §18.3: thin ring instead of a filled hex — the polygon is almost all outline now, fill only enough to keep the shape pickable.
    for (const z of this.d.development_zones || []) { if (!z.lat) continue; const key = 'zone:' + z.id; const r = z.category === '區段徵收' ? 240 : 180;
      this.add('zones', key, z, { position: Cesium.Cartesian3.fromDegrees(z.lon, z.lat, 0), ellipse: { semiMajorAxis: r, semiMinorAxis: r, height: 0.3, material: C('#A78BFA', .03), outline: true, outlineWidth: 2, outlineColor: C('#A78BFA', .85) },
        label: label(z.name.replace(/^臺北市/, ''), { color: '#DDD6FE', far: 5000, dy: -4 }) }); }
  }
  /* ---- 上市櫃資產交易 ---- */
  buildMops() {
    for (const m of this.d.mops || []) { if (!m.lat) continue; const key = 'mops:' + m.id; const y = yearOf(m.announcement_date); m._year = y; const size = Math.max(9, Math.min(26, 6 + Math.log10(Math.max(1e6, m.total_price || 1e6)) * 2.2));
      const show = new Cesium.CallbackProperty(() => y == null || (y <= this.year && y >= this.year - 1), false);
      this.add('mops', key, m, { position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 14), show,
        billboard: { ...BB('deal', '#F29628', Math.round(size * 1.6)), scale: new Cesium.CallbackProperty(() => this.isHot(key) ? 1.15 + 0.2 * Math.sin(this.t * 5) : 1, false) },
        label: label(fmtMoney(m.total_price), { color: '#FFDAA0', far: 4200, dy: -16, font: MONO }) });
      // §18.3 needle: mops isn't tied to a roof, so it lands on the ground point instead.
      this.ds.mops.entities.add({ show, polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights([m.lon, m.lat, 0, m.lon, m.lat, 14]), width: 1, material: C('#F29628', .5), disableDepthTestDistance: Number.POSITIVE_INFINITY } }); }
  }
  /* ---- 企業遷徙弧線 ---- */
  buildMoves() {
    const orig = this.originFor.bind(this);
    for (const mv of this.d.registry_moves || []) { if (!mv.lat) continue; const key = 'move:' + mv.uniform_number; const from = orig(mv.before); if (!from) continue; const to = [mv.lon, mv.lat]; const pts = arc(from, to, 44); mv._from = from;
      this.add('moves', key, mv, { polyline: { positions: pts, width: 2.2, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, taperPower: 0.6, color: C('#DE7020', .85) }), arcType: Cesium.ArcType.NONE } });
      const ph = Math.random(); this.ds.moves.entities.add({ position: new Cesium.CallbackProperty(() => { const u = (this.t * 0.18 + ph) % 1; return pts[Math.min(pts.length - 1, Math.floor(u * pts.length))]; }, false), point: { pixelSize: 5, color: C('#FFDAA0'), disableDepthTestDistance: Number.POSITIVE_INFINITY } });
      this.ds.moves.entities.add({ position: Cesium.Cartesian3.fromDegrees(to[0], to[1], 30), billboard: BB('arrow', '#DE7020', 20, 6000), label: label(mv.company_name.replace(/股份有限公司|有限公司/, ''), { color: '#FFDAA0', far: 2200, dy: -14 }), properties: { pl: { layer: 'moves', key, item: mv } } }); }
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
        const mid = p.line[Math.floor(p.line.length / 2)]; this.ds.labels.entities.add({ show: new Cesium.CallbackProperty(() => this.vis.infra, false), position: Cesium.Cartesian3.fromDegrees(mid[0], mid[1], 30), label: label(p.name, { color: '#E3F8FA', far: 30000, dy: -6 }), properties: { pl: { layer: 'infra', key, item: p } } }); continue; }
      if (!p.lat) continue;
      this.ds.infra.entities.add({ position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 175), billboard: BB('crane', '#BBEAF0', 30, 40000), properties: { pl: { layer: 'infra', key, item: p } } });
      this.add('infra', key, p, { position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0), cylinder: { length: new Cesium.CallbackProperty(() => 120 + 30 * Math.sin(this.t * 1.5), false), topRadius: 22, bottomRadius: 60, material: C('#BBEAF0', cons ? .35 : .15), outline: true, outlineColor: C('#BBEAF0', .8) },
        label: label(p.name, { color: '#E3F8FA', far: 12000, dy: -60 }) }); }
  }
  /* ---- 產業園區 ---- */
  buildParks() {
    for (const p of this.d.industrial_parks || []) { if (!p.lat) continue; const key = 'ipark:' + p.id; const r = Math.max(120, Math.sqrt((p.area_ha || 10) * 1e4) * 0.62);
      this.ds.parks.entities.add({ position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 70), billboard: BB('factory', '#6EE7B7', 30, 40000), properties: { pl: { layer: 'parks', key, item: p } } });
      this.add('parks', key, p, { position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0), ellipse: { semiMajorAxis: r, semiMinorAxis: r, height: 0.4, material: C('#6EE7B7', .06), outline: true, outlineColor: C('#6EE7B7', .9), outlineWidth: 2 }, label: label(p.name, { color: '#A7F3D0', far: 20000, dy: -4 }) }); }
  }
  /* ---- 商圈行情 ---- */
  buildHeat() {
    for (const a of this.d.business_areas || []) { if (!a.lat) continue; const key = 'heat:' + a.id; const mp = a.market_price || {}; const rent = mp.actual_rent_avg || 1500; const hot = Math.max(0, Math.min(1, (rent - 1200) / 1600)); const col = `rgb(${Math.round(252 - 66 * hot)},${Math.round(190 - 98 * hot)},${Math.round(131 - 86 * hot)})`;
      const r = 640 + hot * 340; // §18.3: softer/larger glow — radius up, heatDisc()/heatTint() below carry the softened falloff
      const disc = this.ds.heat.entities.add({ position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 0), ellipse: { semiMajorAxis: r, semiMinorAxis: r, height: 0.2, material: new Cesium.ImageMaterialProperty({ image: heatDisc(), transparent: true, color: heatTint(hot, false) }) }, properties: { pl: { layer: 'heat', key, item: a } } }); disc._hot = hot; (this._heatDiscs = this._heatDiscs || []).push(disc); void col;
      this.ds.heat.entities.add({ position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 40), billboard: BB('coin', '#FCBE83', 26, 30000), properties: { pl: { layer: 'heat', key, item: a } } });
      this.add('heat', key, a, { position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 40), label: label((a.name || '').replace(/^台北市/, ''), { color: '#FCBE83', far: 16000, dy: -18 }) }); }
  }
  /* ---- 捷運 ---- */
  buildMrt() {
    for (const l of this.base.mrt_lines || []) { const col = MRT_COLOR[l.name] || l.color || '#8FA3C8'; for (const seg of l.coords || []) { const flat = []; for (const q of seg) flat.push(q[0], q[1], 3); if (flat.length < 6) continue; this.ds.mrt.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat), width: 3.5, material: C(col, .85), arcType: Cesium.ArcType.GEODESIC } }); } }
    for (const s of this.base.mrt_stations || []) { const key = 'mrt:' + s.name; this.add('mrt', key, s, { position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 4), billboard: { ...BB('metro', '#D1D5DB', 18, 9000), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 14000) }, label: label(s.name, { color: '#D1D5DB', far: 2800, dy: -8 }) }); }
  }
  buildDistricts() {
    // District names are a region-level tier above data-point labels, so they keep a slightly larger size (14px vs
    // the 12/11px rule below) but share the same pill-glass construction via label() — one visual language throughout.
    for (const [name, c] of this.districtCentroids) { const tp = (this.base.districts || []).find(d => d.name === name); if (!tp || !/臺北市|台北市/.test(tp.county)) continue; this.ds.labels.entities.add({ position: Cesium.Cartesian3.fromDegrees(c[0], c[1], 80), label: label(name, { color: '#99A1AF', font: '600 14px "Noto Sans TC", sans-serif', near: 5000, far: 120000 }) }); }
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
