// YouBike 2.0 即時站點圖層 — 一個獨立的 CustomDataSource('youbike')，資料來自 server/routes/live.mjs 的
// /api/youbike（已經濾成台北市 bbox、正規化過欄位、60 秒快取）。這裡只負責「畫」跟「多久 refetch 一次」。
//
// createYouBikeLayer({ viewer, api }):
//   - api：跟 src/api.js 一樣形狀（{ apiFetch, apiUrl }）；沒有就退化成裸 fetch(path)（同源、無存取碼時一樣能動）。
//     main.js 建議跟 createEnvBadge 共用同一個 `import * as api from './api.js'`。
import * as Cesium from 'cesium';

const REFRESH_MS = 60 * 1000;
const POINT_FAR_M = 6000;   // 點本身：~6 km 內才顯示
const LABEL_FAR_M = 1200;   // 站名 + 可借/可還：更近（~1.2 km）才顯示，避免遠景時滿版文字
const C = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
const colorFor = bikes => (bikes >= 5 ? '#16A4C0' /* 藍本藍：站點健康 */ : bikes >= 1 ? '#F29628' /* 人文橘：所剩不多 */ : '#99A1AF' /* 建構灰：目前沒車 */);
const sizeFor = bikes => Math.max(6, Math.min(14, 6 + (Number(bikes) || 0) * 0.4)); // 6–14 px，隨可借車輛數增加（線性，未特別調校曲線）

async function fetchYouBike(api) {
  try {
    const url = (api && typeof api.apiUrl === 'function') ? api.apiUrl('/api/youbike') : '/api/youbike';
    const fetcher = (api && typeof api.apiFetch === 'function') ? api.apiFetch : fetch;
    const r = await fetcher(url);
    if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
    const json = await r.json();
    return Array.isArray(json) ? json : [];
  } catch (e) { console.warn('[youbike] /api/youbike fetch failed:', e.message); return null; } // null = 這次沒拿到；跟上一次的畫面保持不動，不要清空
}

/**
 * @param {{viewer:import('cesium').Viewer, api?:object}} opts
 * @returns {{setVisible(on:boolean):void, refresh():Promise<void>, visible:boolean, setTheme(t:'light'|'dark'):void, count:number}}
 */
export function createYouBikeLayer({ viewer, api } = {}) {
  const ds = new Cesium.CustomDataSource('youbike');
  viewer.dataSources.add(ds);
  ds.show = false; // 預設關閉（新的可選圖層，跟其他選配圖層一樣預設不佔頻寬/畫面；main.js 可在 rail 開關上改成預設開）

  let visible = false, theme = 'light', timer = null, stations = [], destroyed = false;

  function labelStyle() { // 跟 FunraiseLayers.setTheme() / IsochroneLayer.setTheme() 同一套「淺色主題深字白底，深色主題淺字深底」邏輯
    const light = theme !== 'dark';
    return { fill: C(light ? '#1E2939' : '#F3F4F6', 1), outline: light ? C('#FFFFFF', .92) : C('#030712', .9), bg: light ? C('#FFFFFF', .82) : C('#030712', .65) };
  }
  function labelGraphics(it) {
    const s = labelStyle();
    return {
      text: `${it.name || '—'}\n${it.bikes ?? 0} 可借 · ${it.docks ?? 0} 可還`,
      font: '500 12px "Inter", "Noto Sans TC", sans-serif',
      fillColor: s.fill, outlineColor: s.outline, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -14), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, LABEL_FAR_M),
      showBackground: true, backgroundColor: s.bg, backgroundPadding: new Cesium.Cartesian2(6, 3),
    };
  }
  function buildEntities(list) {
    ds.entities.removeAll();
    for (const it of list) {
      if (it.lat == null || it.lon == null) continue;
      const key = 'youbike:' + it.id;
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(it.lon, it.lat, 2),
        point: {
          pixelSize: sizeFor(it.bikes), color: C(colorFor(it.bikes), .95), outlineColor: C('#FFFFFF', .85), outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, POINT_FAR_M),
        },
        label: labelGraphics(it),
        properties: { pl: { layer: 'youbike', key, item: it } }, // 讓既有 hover.js 的 hover card 認得（見 hover.js 的 LINES.youbike）
      });
    }
  }

  async function refresh() {
    if (destroyed) return;
    const list = await fetchYouBike(api);
    if (list == null) return; // 上游/網路失敗：保留上一次畫面，不要清空
    stations = list;
    buildEntities(stations);
  }
  function startTimer() { stopTimer(); timer = setInterval(refresh, REFRESH_MS); }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  return {
    setVisible(on) {
      visible = !!on; ds.show = visible;
      if (visible) { refresh(); startTimer(); } else { stopTimer(); }
    },
    async refresh() { await refresh(); },
    get visible() { return visible; },
    setTheme(t) {
      theme = t === 'dark' ? 'dark' : 'light';
      const s = labelStyle();
      for (const e of ds.entities.values) { if (!e.label) continue; e.label.fillColor = s.fill; e.label.outlineColor = s.outline; e.label.backgroundColor = s.bg; }
    },
    get count() { return stations.length; },
    /** main.js 沒被要求呼叫，但提供給想徹底移除圖層（例如卸載頁面）的呼叫端；一般只需要 setVisible(false)。 */
    destroy() { destroyed = true; stopTimer(); ds.entities.removeAll(); viewer.dataSources.remove(ds); },
  };
}
