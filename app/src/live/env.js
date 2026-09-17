// 即時天氣 + AQI 頂列徽章。跟 server/routes/live.mjs 的 /api/env 配對：那支路由永遠不丟 500（缺 key／上游掛了都回
// null），這裡對應地「兩邊都 null 就整個徽章藏起來」，never 半殘留一個空徽章卡在畫面上。
//
// createEnvBadge({ api, container, viewer }):
//   - api：跟 src/api.js 一樣形狀的物件（{ apiFetch, apiUrl }）；沒有就整個退化成裸 fetch(path)（同源、沒有存取碼
//     的最常見狀況一樣能動）。main.js 建議 `import * as api from './api.js'` 後原樣傳進來（見本檔案 INTEGRATION 段落）。
//   - container：徽章要插入的父元素（例如 `#topbar .status`）；有找到 `#clock` 子節點就插在它前面，找不到就 append。
//   - viewer：Cesium viewer（給「大氣微調」用 viewer.scene.fog / skyAtmosphere；也用 camera 位置猜「現在大概在看哪」，
//     讓 AQI 挑最近測站更準——這兩件事都是 best-effort，viewer 缺失或任何一步失敗都不影響徽章本身正常顯示天氣/AQI）。
import './env.css';

const REFRESH_MS = 10 * 60 * 1000;
const RAIN_RE = /雨|雷|颱/; // desc 命中任一個字就視為「有雨／有雷／有颱風」，觸發大氣微調
const AQI_DOT = { '良好': '#22C55E', '普通': '#EAB308', '對敏感族群不健康': '#F29628', '不健康': '#EF4444', '非常不健康': '#8B5CF6', '危害': '#7C2D12' };
const AQI_DOT_FALLBACK = '#99A1AF';

function weatherIcon(desc) {
  const s = String(desc || '');
  if (/雷/.test(s)) return '⛈'; if (/雨/.test(s)) return '🌧'; if (/雪/.test(s)) return '❄';
  if (/陰/.test(s)) return '☁'; if (/多雲/.test(s)) return '⛅'; if (/晴/.test(s)) return '☀';
  return '☁';
}
/** 跟 src/api.js 的 apiFetch/apiUrl 對接；沒有這兩個 helper 就退化成裸 fetch(path)，永遠不丟例外（失敗回 null）。 */
async function fetchEnv(api, path) {
  try {
    const url = (api && typeof api.apiUrl === 'function') ? api.apiUrl(path) : path;
    const fetcher = (api && typeof api.apiFetch === 'function') ? api.apiFetch : fetch;
    const r = await fetcher(url);
    if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
    return await r.json();
  } catch (e) { console.warn('[env] /api/env fetch failed:', e.message); return null; }
}

/**
 * @param {{api?:object, container?:Element, viewer?:import('cesium').Viewer}} opts
 * @returns {{refresh():Promise<any>, destroy():void, data:any}}
 */
export function createEnvBadge({ api, container, viewer } = {}) {
  const el = document.createElement('div');
  el.id = 'envbadge'; el.className = 'pill mono hidden'; el.setAttribute('role', 'status');
  el.innerHTML = '<i class="dot"></i><span class="txt"></span>';
  const dotEl = el.querySelector('.dot'), txtEl = el.querySelector('.txt');
  if (container) { const before = container.querySelector('#clock'); if (before) container.insertBefore(el, before); else container.appendChild(el); }

  let data = null, destroyed = false, timer = null;
  // 「remember and restore originals」：只記一次進去前的值，退回時原樣還原；不嘗試跟蹤 setTheme() 之後的動態基準
  // （日/夜切換本來就會自己改 fog/atmosphere，這裡只保證「拿掉微調」不會把畫面留在被我們調過的狀態）。
  const atmo = { applied: false, fogDensity: null, brightnessShift: null };

  function applyAtmosphere(w, a) {
    if (!viewer || !viewer.scene) return;
    const scene = viewer.scene; if (!scene.fog || !scene.skyAtmosphere) return;
    const rain = !!(w && RAIN_RE.test(w.desc || ''));
    const hazy = !!(a && a.value != null && a.value >= 100);
    const shouldTweak = rain || hazy;
    if (shouldTweak && !atmo.applied) {
      try {
        atmo.fogDensity = scene.fog.density; atmo.brightnessShift = scene.skyAtmosphere.brightnessShift;
        // 兩個條件都成立時取「較大」的霧密度倍率而不是相乘（1.6*1.8=2.88 對「subtle」這個詞來說太誇張），
        // brightnessShift 只在下雨/打雷/颱風時調暗，AQI 高不影響天空亮度。
        const mult = Math.max(rain ? 1.6 : 1, hazy ? 1.8 : 1);
        scene.fog.density = atmo.fogDensity * mult;
        if (rain) scene.skyAtmosphere.brightnessShift = atmo.brightnessShift - 0.08;
        atmo.applied = true;
      } catch (e) { console.warn('[env] atmosphere tweak failed:', e.message); }
    } else if (!shouldTweak && atmo.applied) {
      try { if (atmo.fogDensity != null) scene.fog.density = atmo.fogDensity; if (atmo.brightnessShift != null) scene.skyAtmosphere.brightnessShift = atmo.brightnessShift; }
      catch (e) { console.warn('[env] atmosphere restore failed:', e.message); }
      atmo.applied = false; atmo.fogDensity = null; atmo.brightnessShift = null;
    }
  }

  function render() {
    const w = data && data.weather, a = data && data.aqi;
    applyAtmosphere(w, a); // 永遠先評估一次，即使徽章本身因為兩邊都沒資料而要被藏起來（例如 server 剛好斷線）
    if (!w && !a) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const parts = [];
    if (w && w.temp != null) parts.push(`${weatherIcon(w.desc)} ${Math.round(w.temp)}°`);
    if (a && a.value != null) parts.push(`AQI ${Math.round(a.value)}${a.status ? ' ' + a.status : ''}`);
    txtEl.textContent = parts.length ? parts.join(' · ') : '—';
    if (a && a.status) { dotEl.style.background = AQI_DOT[a.status] || AQI_DOT_FALLBACK; dotEl.style.display = ''; }
    else { dotEl.style.display = 'none'; }
    const tip = [];
    if (w) { if (w.desc) tip.push(w.desc); if (w.humidity != null) tip.push(`濕度 ${w.humidity}%`); if (w.pop != null) tip.push(`降雨機率 ${w.pop}%`); if (w.minT != null && w.maxT != null) tip.push(`今日 ${w.minT}–${w.maxT}°`); if (w.at) tip.push(`觀測時間 ${w.at}`); }
    if (a) { if (a.site) tip.push(`AQI 測站：${a.site}`); if (a.pm25 != null) tip.push(`PM2.5 ${a.pm25} μg/m³`); if (a.at) tip.push(`AQI 發布 ${a.at}`); }
    el.title = tip.join('\n');
  }

  /** best-effort：camera 目前大致在看哪（經緯度，弧度轉角度），讓 /api/env 挑更近的 AQI 測站；任何一步失敗就不帶參數。 */
  function cameraLonLat() {
    try {
      const c = viewer && viewer.camera && viewer.camera.positionCartographic; if (!c) return null;
      const lon = c.longitude * 180 / Math.PI, lat = c.latitude * 180 / Math.PI;
      return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
    } catch { return null; }
  }

  async function refresh() {
    if (destroyed) return data;
    const p = cameraLonLat();
    const qs = p ? `?lon=${p.lon.toFixed(4)}&lat=${p.lat.toFixed(4)}` : '';
    data = await fetchEnv(api, '/api/env' + qs);
    render();
    return data;
  }

  refresh();
  timer = setInterval(refresh, REFRESH_MS);

  return {
    refresh,
    destroy() {
      if (destroyed) return; destroyed = true;
      if (timer) clearInterval(timer);
      if (atmo.applied && viewer && viewer.scene) { try { if (atmo.fogDensity != null) viewer.scene.fog.density = atmo.fogDensity; if (atmo.brightnessShift != null) viewer.scene.skyAtmosphere.brightnessShift = atmo.brightnessShift; } catch { /* best effort */ } }
      el.remove();
    },
    get data() { return data; },
  };
}
