// 生活圈（步行／騎車／開車 walkshed）— 呼叫 server/routes/ors.mjs 打 OpenRouteService 的真實道路網路
// isochrone。繪圖與資料結構之外的所有慣例（CustomDataSource、setTheme、label 樣式）都照抄
// src/analysis/isochrone.js 的 IsochroneLayer；差別只在等時圈本身是「後端 API 回傳的道路網路多邊形」，
// 不是本地算出來的捷運路網樹。
//
/**
 * @module analysis/walkshed
 *
 * `new WalkshedLayer(viewer, { api })` 建立一個獨立的 `CustomDataSource('walkshed')`；`api` 是
 * agent server 的 origin（同源時可以是空字串，比照 src/agent/claudeClient.js 的 API_BASE 用法）。
 *
 * `show({ lon, lat, name, minutes=[5,10,15], profile='foot-walking' })`：
 *   1. 呼叫 `${api}/api/walkshed?lon=&lat=&profile=&minutes=` 拿 ORS 的 GeoJSON。
 *   2. 成功：每一個時間帶畫成一塊貼地面多邊形（`height:.4`），由「時間最長／面積最大」畫到
 *      「時間最短／面積最小」，讓小圈疊在大圈上面才看得到自己的顏色（ORS 的等時圈本來就是同心的：
 *      15 分鐘那塊本身就整個蓋住 10 分鐘那塊）。多邊形可能是 Polygon（含 hole）或 MultiPolygon
 *      （例如被河流切成好幾塊互不相連的可及範圍），兩種都處理；MultiPolygon 只有「填色」蓋滿全部
 *      分塊，「外框線」只描最大那一塊，避免分塊太多把 entity 數炸掉。每一帶再疊一個小標籤
 *      「5 分」「10 分」「15 分」，放在這一帶多邊形最北邊的頂點。出發點另外點一個 icon＋
 *      一行「（地點）· 步行 15 分」的標籤（15 分＝這次問到的最大時間帶）。
 *   3. 失敗（fetch 本身丟例外，或伺服器回非 200——包含明講的 503 { fallback:true }，也包含
 *      額度用盡的 429／ORS 掛掉的 5xx）：整個退化成「以固定速度換算半徑」的同心圓——步行
 *      80 m/分、騎車 250 m/分、開車 500 m/分（跟 isochrone.js 的 WALK_MPM 是同一種簡化模型，
 *      只是這裡沒有路網可以貼合，純粹是視覺參考圈）——顏色配置照舊，出發點標籤加註「（估算）」，
 *      讓使用者知道這不是真的路網等時圈。
 *   4. 面積：對每一帶的每一塊 outer ring（扣掉 hole）在「以該 ring 自己重心為原點的東-北向局部
 *      投影」上做 shoelace（跟 src/tools/measure.js 的 ringAreaSqm 是同一套公式，這裡自己留一份
 *      小副本，維持每個 analysis 模組零依賴、可獨立閱讀的慣例）。
 *
 * 顏色：人文橘（步行）／偏 cyan 的藍本藍（騎車）／建構灰的藍灰（開車），三階由淺入深＝由近到遠，
 * alpha .22 → .26 → .30，都是 style.css 裡已經有的 PickPeak token，沒有另外發明新色票。
 *
 * entity 數量上限抓 40：正常情況（單一 Polygon、每帶 1 塊）大概是 3 帶 ×(1 填色+1 外框+1 標籤)
 * + 出發點 1 個（point 跟 label 是同一個 entity 上的兩種 graphics）＝10 個。畫的順序是先把外框／
 * 標籤（一定要看得到的東西）畫完，剩下的預算才拿去畫填色多邊形，MultiPolygon 分塊異常多時，
 * 犧牲的只會是多餘的填色小塊。
 */

import * as Cesium from 'cesium';
import { apiUrl } from '../api.js';
import { groundPolygon } from '../layers/groundmode.js';

// Phase 10P §18.1：實景（Google 3D Tiles）底下地面疊圖要貼在真正的地表上，不能再用固定小高度擠出——讀
// map.groundMode（compose.js／photoreal.js 進出「實景」時維護，見 groundmode.js 開頭的說明）；生活圈是使用者
// 操作後才 show()，main.js 的 boot() 早就跑完了，讀 window.PL 永遠讀得到最新狀態，不需要建構子多傳一份 map。
const groundModeOn = () => { try { return !!(window.PL && window.PL.map && window.PL.map.groundMode); } catch { return false; } };

/* ---------------- 純幾何（跟 src/tools/measure.js 的 ringAreaSqm 同一套公式，自己留一份小副本） ---------------- */
const M_PER_DEG_LAT = 110540;
const mPerDegLon = lat => 111320 * Math.cos(lat * Math.PI / 180);

/** 一個 ring（[[lon,lat],…]，首尾可重複可不重複）在自己重心為原點的局部投影上的面積（m²）。 */
function ringAreaSqm(ring) {
  if (!ring || ring.length < 3) return 0;
  let clon = 0, clat = 0; for (const p of ring) { clon += p[0]; clat += p[1]; }
  const n = ring.length; clon /= n; clat /= n;
  const mLon = mPerDegLon(clat);
  const pts = ring.map(p => [(p[0] - clon) * mLon, (p[1] - clat) * M_PER_DEG_LAT]);
  const closed = pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  const open = closed ? pts.slice(0, -1) : pts;
  if (open.length < 3) return 0;
  let sum = 0; for (let i = 0; i < open.length; i++) { const a = open[i], b = open[(i + 1) % open.length]; sum += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(sum) / 2;
}

/** GeoJSON Polygon 或 MultiPolygon → 統一成 [{outer:[[lon,lat],…], holes:[[[lon,lat],…],…]}, …]。 */
function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.length ? [{ outer: geometry.coordinates[0], holes: geometry.coordinates.slice(1) }] : [];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.filter(p => p.length).map(p => ({ outer: p[0], holes: p.slice(1) }));
  return [];
}

/** 一個時間帶（可能好幾塊 MultiPolygon）扣掉 hole 之後的總面積（m²）。 */
function bandAreaSqm(parts) {
  let sum = 0;
  for (const { outer, holes } of parts) { sum += ringAreaSqm(outer); for (const h of holes || []) sum -= ringAreaSqm(h); }
  return Math.max(0, sum);
}

/** 面積最大的那一塊（拿來畫外框用；MultiPolygon 只描最大塊，見檔頭說明）。 */
function largestPart(parts) {
  let best = null, bestArea = -1;
  for (const part of parts) { const a = ringAreaSqm(part.outer); if (a > bestArea) { bestArea = a; best = part; } }
  return best;
}

/** 好幾塊裡最北邊的那個頂點（給小標籤定位用）。 */
function northernmost(parts) {
  let best = null;
  for (const { outer } of parts) for (const p of outer) if (!best || p[1] > best[1]) best = p;
  return best;
}

const hexDarken = (hex, t) => { const n = parseInt(hex.slice(1), 16); const r = Math.round(((n >> 16) & 255) * (1 - t)), g = Math.round(((n >> 8) & 255) * (1 - t)), b = Math.round((n & 255) * (1 - t)); return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''); };

/* ---------------- 交通速度模型 / 色票 ---------------- */
// 人文橘（步行）／藍本藍系（騎車，偏 cyan）／建構灰系（開車，偏藍灰）——都是 style.css 既有 token，
// 三階由淺入深＝由近到遠，跟 isochrone.js 的 BAND_BASE_COLORS 同一套配色邏輯。
const DEFAULT_BANDS = [5, 10, 15];
const PROFILE_META = {
  'foot-walking': { label: '步行', mpm: 80, colors: ['#FCBE83', '#F29628', '#BA5C2D'] },
  'cycling-regular': { label: '騎車', mpm: 250, colors: ['#50C0D4', '#16A4C0', '#0C83A2'] },
  'driving-car': { label: '開車', mpm: 500, colors: ['#99A1AF', '#4A5565', '#1E2939'] },
};
const BAND_ALPHA = [.22, .26, .30];
const MAX_ENTITIES = 40;

/**
 * 把 walkshed API 的結果（或退化估算）畫成 Cesium entities 的圖層。
 * 不碰相機、不改 main.js/ui.js 既有的圖層——純粹疊加自己的資料源，`clear()` 會整個清空。
 */
export class WalkshedLayer {
  /** @param {Cesium.Viewer} viewer @param {{api?: string}} [opts] api：agent server origin，同源可留空字串 */
  constructor(viewer, { api } = {}) {
    this.viewer = viewer;
    this.api = (api || '').replace(/\/$/, '');
    this.ds = new Cesium.CustomDataSource('walkshed');
    viewer.dataSources.add(this.ds);
    this.theme = 'light';
    this._active = false;
    this._budget = 0;
    /** @type {object|null} 最近一次 show() 的完整摘要（跟回傳值同一份） */
    this.lastSummary = null;
  }

  get active() { return this._active; }

  /** 清空這個生活圈圖層畫的所有東西。 */
  clear() { this.ds.entities.removeAll(); this._active = false; this.lastSummary = null; }

  /** 從資料源移除（頁面真的不再需要這個圖層時呼叫；一般只需要 clear()）。 */
  destroy() { this.clear(); this.viewer.dataSources.remove(this.ds); }

  _col(hex, a = 1) { return Cesium.Color.fromCssColorString(hex).withAlpha(a); }
  _label(text, color, dy = -14) {
    return {
      text, font: '600 11px "Noto Sans TC", "Inter", sans-serif',
      fillColor: this._col(color, 1), outlineColor: this._col('#030712', .9), outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, dy),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6500),
      showBackground: true, backgroundColor: this._col('#030712', .65), backgroundPadding: new Cesium.Cartesian2(6, 3),
    };
  }

  /** 花一個 entity 的預算；回傳 false 代表已經到上限，這次不畫。 */
  _spend(n = 1) { this._budget -= n; return this._budget >= 0; }

  _addFill(part, color, alpha) {
    const outerPos = Cesium.Cartesian3.fromDegreesArray(part.outer.flat());
    const holes = (part.holes || []).map(h => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(h.flat())));
    const e = this.ds.entities.add({ polygon: { ...groundPolygon({ on: groundModeOn(), height: .4 }), hierarchy: new Cesium.PolygonHierarchy(outerPos, holes), material: this._col(color, alpha), outline: false } });
    e._plKind = 'band'; e._baseColor = color;
    return e;
  }

  _addOutline(part, color, alpha) {
    const flat = part.outer.flat(); const withH = [];
    for (let i = 0; i < flat.length; i += 2) withH.push(flat[i], flat[i + 1], .6);
    const e = this.ds.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights(withH), width: 1.5, material: this._col(color, Math.min(1, alpha + .4)), arcType: Cesium.ArcType.GEODESIC } });
    e._plKind = 'outline'; e._baseColor = color;
    return e;
  }

  _addBandLabel(lon, lat, text, color) {
    const e = this.ds.entities.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, .8), label: this._label(text, color, -10) });
    e._plKind = 'bandlabel'; e._baseColor = color;
    return e;
  }

  _addOrigin(lon, lat, text, color) {
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 1.2);
    const e = this.ds.entities.add({ position: pos, point: { pixelSize: 10, color: this._col('#FFFFFF', 1), outlineColor: this._col(color, 1), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: this._label(text, color, -16) });
    e._plKind = 'origin'; e._baseColor = color;
    return e;
  }

  /**
   * 畫一個生活圈（有 ORS 就是真的路網等時圈，沒有就退化成估算同心圓）。
   * @param {{lon:number, lat:number, name?:string, minutes?:number[], profile?:'foot-walking'|'cycling-regular'|'driving-car'}} params
   * @returns {Promise<{origin:{lon:number,lat:number,name:string}, minutes:number[], areasKm2:number[], source:'ors'|'estimate', bounds:[number,number,number,number]|null}>}
   */
  async show({ lon, lat, name, minutes = DEFAULT_BANDS, profile = 'foot-walking' } = {}) {
    this.clear();
    if (lon == null || lat == null) throw new Error('WalkshedLayer.show: 需要 lon/lat');
    const prof = PROFILE_META[profile] ? profile : 'foot-walking';
    const meta = PROFILE_META[prof];
    const rawList = Array.isArray(minutes) && minutes.length ? minutes : DEFAULT_BANDS;
    const bands = [...new Set(rawList.map(m => Math.max(1, Math.min(60, Math.round(+m || 1)))))].sort((a, b) => a - b).slice(0, 3);
    const originName = name || '出發點';
    this._budget = MAX_ENTITIES - 1; // 留 1 個名額給下面一定要畫的出發點 entity

    let ors = null; // 有拿到就是 { features:[...], … }
    let source = 'estimate';
    try {
      const qs = new URLSearchParams({ lon: String(lon), lat: String(lat), profile: prof, minutes: bands.join(',') });
      const r = await fetch(apiUrl('/api/walkshed?' + qs));
      if (r.ok) {
        const j = await r.json();
        if (j && Array.isArray(j.features) && j.features.length) { ors = j; source = 'ors'; }
        else console.warn('[walkshed] ORS 回應沒有可用的 features，改用估算圈');
      } else {
        console.warn(`[walkshed] /api/walkshed 回 ${r.status}，改用估算圈`);
      }
    } catch (err) {
      console.warn('[walkshed] 連不到 /api/walkshed，改用估算圈', err);
    }

    const result = source === 'ors' ? this._drawOrs(ors, meta) : this._drawEstimate(lon, lat, bands, meta);
    const maxMin = result.minutes.length ? result.minutes[result.minutes.length - 1] : (bands[bands.length - 1] || 0);
    const topColor = meta.colors[meta.colors.length - 1];
    const label = `${name ? name + ' · ' : ''}${meta.label} ${maxMin} 分${source === 'estimate' ? '（估算）' : ''}`;
    this._addOrigin(lon, lat, label, topColor);

    this._active = true;
    this.setTheme(this.theme);
    this.lastSummary = { origin: { lon, lat, name: originName }, minutes: result.minutes, areasKm2: result.areasKm2, source, bounds: result.bounds };
    return this.lastSummary;
  }

  /** 真的路網等時圈：ORS 的 FeatureCollection → 畫圖 + 摘要數字。 */
  _drawOrs(fc, meta) {
    const feats = fc.features.filter(f => f && f.geometry).slice().sort((a, b) => (a.properties?.value ?? 0) - (b.properties?.value ?? 0));
    const perFeat = feats.map(f => ({ f, parts: polygonsOf(f.geometry) })).filter(x => x.parts.length);
    const minutes = perFeat.map(x => Math.round((x.f.properties?.value ?? 0) / 60));
    const areasKm2 = perFeat.map(x => bandAreaSqm(x.parts) / 1e6);

    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const { parts } of perFeat) for (const { outer } of parts) for (const p of outer) { if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; }

    // 先保留預算給外框／標籤（一定要看得到的東西），填色多邊形再依剩下的預算畫；兩邊都是「時間最長→最短」。
    for (let i = perFeat.length - 1; i >= 0; i--) {
      const { parts } = perFeat[i];
      const idx = Math.min(i, meta.colors.length - 1);
      const color = meta.colors[idx], alpha = BAND_ALPHA[Math.min(i, BAND_ALPHA.length - 1)];
      const big = largestPart(parts);
      if (big && this._spend(1)) this._addOutline(big, color, alpha);
      const north = northernmost(parts);
      if (north && this._spend(1)) this._addBandLabel(north[0], north[1], `${minutes[i]} 分`, color);
    }
    for (let i = perFeat.length - 1; i >= 0; i--) {
      const { parts } = perFeat[i];
      const idx = Math.min(i, meta.colors.length - 1);
      const color = meta.colors[idx], alpha = BAND_ALPHA[Math.min(i, BAND_ALPHA.length - 1)];
      for (const part of parts) { if (!this._spend(1)) break; this._addFill(part, color, alpha); }
    }
    return { minutes, areasKm2, bounds: perFeat.length ? [w, s, e, n] : null };
  }

  /** 沒有 ORS（沒金鑰／打不通／被擋）：用固定速度換算半徑，畫同心圓當作視覺參考。 */
  _drawEstimate(lon, lat, bands, meta) {
    const areasKm2 = bands.map(m => Math.PI * (meta.mpm * m) ** 2 / 1e6);
    for (let i = bands.length - 1; i >= 0; i--) {
      const radius = meta.mpm * bands[i];
      const idx = Math.min(i, meta.colors.length - 1);
      const color = meta.colors[idx], alpha = BAND_ALPHA[Math.min(i, BAND_ALPHA.length - 1)];
      if (this._spend(1)) {
        const e = this.ds.entities.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, .4), ellipse: { ...groundPolygon({ on: groundModeOn(), height: .4 }), semiMajorAxis: radius, semiMinorAxis: radius, material: this._col(color, alpha), outline: true, outlineColor: this._col(color, Math.min(1, alpha + .4)), outlineWidth: 1.5 } });
        e._plKind = 'band'; e._baseColor = color;
      }
      if (this._spend(1)) this._addBandLabel(lon, lat + radius / M_PER_DEG_LAT, `${bands[i]} 分`, color);
    }
    const R = bands.length ? meta.mpm * bands[bands.length - 1] : 0;
    const mLon = mPerDegLon(lat);
    const bounds = bands.length ? [lon - R / mLon, lat - R / M_PER_DEG_LAT, lon + R / mLon, lat + R / M_PER_DEG_LAT] : null;
    return { minutes: bands, areasKm2, bounds };
  }

  /** 'light'（PickPeak 日間，深色字＋白底）或 'dark'（夜間戰情室，亮色字＋深底）——跟 isochrone.js 同一套邏輯。 */
  setTheme(theme) {
    this.theme = theme === 'dark' ? 'dark' : 'light';
    const light = this.theme === 'light';
    for (const e of this.ds.entities.values) {
      if (e.label) {
        const base = e._baseColor || '#F29628';
        e.label.fillColor = this._col(light ? hexDarken(base, .55) : base, 1);
        e.label.outlineColor = light ? this._col('#FFFFFF', .92) : this._col('#030712', .9);
        e.label.backgroundColor = light ? this._col('#FFFFFF', .85) : this._col('#030712', .65);
      }
      if (e.point) e.point.outlineColor = light ? this._col('#1E2939', .55) : this._col('#FFFFFF', .9);
    }
  }
}
