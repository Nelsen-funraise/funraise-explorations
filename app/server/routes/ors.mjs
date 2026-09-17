// OpenRouteService 等時圈 route（真實道路網路的步行／騎車／開車生活圈）——對照 src/analysis/isochrone.js
// 自製、零外部 API 的捷運等時圈：道路網路遠比捷運路網複雜，這裡改成直接呼叫 ORS Isochrones API
// （需要 ORS_API_KEY，owner 端的金鑰）。沒有金鑰或 ORS 打不通時，前端 src/analysis/walkshed.js 會整個
// 退回「均速估算的同心圓」，所以這支路由的每一種失敗都用可預期的 { status, json } 型態回傳、幾乎不丟例外
// 給呼叫端（server/index.mjs 外層的 try/catch 只是最後一道防線）。
//
/**
 * @module server/routes/ors
 *
 * GET /api/walkshed?lon=&lat=&profile=foot-walking|cycling-regular|driving-car&minutes=5,10,15
 *   → 200  ORS 原始 GeoJSON FeatureCollection（features[].properties.value = 秒）
 *          再疊上 { source:'ors', profile, minutes }（minutes 是實際拿去問 ORS 的分鐘數，已做過
 *          去重／限三個／收斂到 ≤60 的處理，可能跟原始 query string 不完全一樣）。
 *   → 400  { error } —— lon/lat 缺漏或不是數字。
 *   → 503  { error:'ORS_API_KEY not set', fallback:true } —— demo 沒設金鑰（keyless 模式）。
 *   → 429  { error, fallback:true } —— 超過每分鐘 30 次的配額保護（保護 ORS 免費額度；快取命中不計數）。
 *   → <ORS 的 status>  { error } —— ORS 本身回錯（額度用盡／參數錯誤／伺服器錯誤等），原樣傳回。
 *   → 502  { error, fallback:true } —— fetch 本身失敗（斷線、逾時、DNS）。
 *
 * 200 的結果會存進一個 ≤200 筆、24 小時 TTL 的記憶體 LRU 快取，key＝profile + minutes + 四捨五入到
 * 小數點後 4 位的經緯度（約 11m 網格：同一棟樓再問一次會命中快取，附近不同地點不會誤用同一份等時圈）。
 *
 * `createOrsRoutes(env)` 回傳的物件形狀是給 server/index.mjs 用同一個 pattern 掛路由：
 *   const ORS = createOrsRoutes(env);
 *   if (ORS[url.pathname]) { const r = await ORS[url.pathname]({ url, req, res, readBody }); return json(res, r.status, r.json); }
 *
 * 另外匯出 `testOrs(env)`：設定頁用的「測試 ORS 金鑰」，對台北101打一個 60 秒範圍的最小請求，
 * 不經過上面的快取／配額保護（單次、人工觸發的健檢，不是示範流程的一部分）。
 *
 * 用 Node 22 內建的全域 fetch；它不會自動吃 HTTPS_PROXY（跟這個 sandbox 幫 curl/WebFetch 設的代理
 * 無關），這裡是刻意的——ORS 是要打真的公網 API。
 */

const ORS_BASE = 'https://api.openrouteservice.org/v2/isochrones';
const PROFILES = new Set(['foot-walking', 'cycling-regular', 'driving-car']);
const DEFAULT_MINUTES = [5, 10, 15];
const MAX_BANDS = 3;
const MAX_MINUTES = 60;
const CACHE_MAX = 200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RATE_MAX_PER_MIN = 30;
const RATE_WINDOW_MS = 60 * 1000;
const TAIPEI_101 = [121.5645, 25.0339];

/** 極簡 LRU + TTL 快取：Map 保留插入順序，命中時 delete+set 搬到尾端＝最近使用，滿了從最舊的開始丟。 */
function createLru(max, ttlMs) {
  const map = new Map();
  return {
    get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (Date.now() > e.exp) { map.delete(key); return undefined; }
      map.delete(key); map.set(key, e);
      return e.val;
    },
    set(key, val) {
      map.delete(key);
      map.set(key, { val, exp: Date.now() + ttlMs });
      while (map.size > max) map.delete(map.keys().next().value);
    },
  };
}

/** 60 秒滑動視窗計數器；只在「真的要打 ORS」之前呼叫一次，回傳 false 代表這次該擋下來。 */
function createRateGuard(maxPerMin, windowMs) {
  let hits = [];
  return () => {
    const now = Date.now();
    hits = hits.filter(t => now - t < windowMs);
    if (hits.length >= maxPerMin) return false;
    hits.push(now);
    return true;
  };
}

function numParam(url, name) {
  const v = url.searchParams.get(name);
  if (v == null || v.trim() === '') return NaN;
  return Number(v);
}

/** "5,10,15" → [5,10,15]：去重、只留正數、最多 3 個、每個 ≤60、由小到大排序；缺漏或全部無效時用預設值。 */
function parseMinutes(raw) {
  const nums = String(raw ?? '').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
  const uniq = [...new Set(nums.length ? nums : DEFAULT_MINUTES)];
  return uniq.slice(0, MAX_BANDS).map(n => Math.min(MAX_MINUTES, n)).sort((a, b) => a - b);
}

/** POST 到 ORS Isochrones API；!ok 時把錯誤訊息包成一個帶 .status 的 Error（讓呼叫端原樣傳回狀態碼）。 */
async function callOrs(env, profile, lon, lat, minutes) {
  const r = await fetch(`${ORS_BASE}/${profile}`, {
    method: 'POST',
    headers: { Authorization: env.ORS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: [[lon, lat]], range: minutes.map(m => m * 60), range_type: 'time', smoothing: 25 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    let msg = text;
    try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || j.message || text; } catch { /* 不是 JSON，就用原始文字 */ }
    throw Object.assign(new Error(String(msg || `ORS ${r.status}`).slice(0, 300)), { status: r.status });
  }
  return r.json();
}

/* ============================================================
 * PEAKLENS_DEMO_LIVE=1 — 沒有 ORS_API_KEY 時，用 irregular 的「不規則 blob」頂替真的路網等時圈，讓
 * walkshed.js（src/analysis/walkshed.js 的 _drawOrs）可以在沒有金鑰的環境下照樣走「真的路網」那條分支
 * （而不是退化成同心圓估算圈），適合無頭冒煙測試／截圖。見 docs/11-v2-cesium-app.md §16.8。
 * 真金鑰永遠優先：這段只在 callOrs() 完全不會被呼叫到的分支（ORS_API_KEY 缺席）才會用到，見下面 walkshed()。
 * ============================================================ */
const DEMO_ON = env => env.PEAKLENS_DEMO_LIVE === '1' || env.PEAKLENS_DEMO_LIVE === 'true';
const DEMO_MPM = { 'foot-walking': 80, 'cycling-regular': 250, 'driving-car': 500 }; // 跟 src/analysis/walkshed.js 的 PROFILE_META.mpm 同一組假設
/** FNV-1a → mulberry32：seed 字串固定就永遠吐出同一串 [0,1) 亂數（同一個 lon/lat/profile 重打結果一樣，適合快取與截圖比對）。 */
function seedRng(str) {
  let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  let t = h >>> 0;
  return () => { t = (t + 0x6D2B79F5) | 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
/**
 * 每個時間帶一個「不規則 blob」多邊形（不是正圓）：同一次請求的所有 band 共用同一組角度諧波（相位／振幅
 * 只依 profile+lon+lat 決定，不含 minutes），保證半徑較大的 band 在每個角度都嚴格包住半徑較小的 band——
 * 跟真的 ORS 等時圈一樣是同心的（見 walkshed.js 檔頭「15 分鐘那塊本身就整個蓋住 10 分鐘那塊」）。
 * @returns {{type:'FeatureCollection', features:Array}} 形狀跟 ORS Isochrones API 的回應相容：
 *   features[].properties.value = 秒，features[].geometry 是 GeoJSON Polygon（walkshed.js 的 polygonsOf() 認得）。
 */
function demoWalkshedFC(profile, lon, lat, minutesList) {
  const mpm = DEMO_MPM[profile] || DEMO_MPM['foot-walking'];
  const rnd = seedRng(`ws:${profile}:${lon.toFixed(4)}:${lat.toFixed(4)}`);
  const h1 = 0.10 + rnd() * 0.08, h2 = 0.05 + rnd() * 0.05, p1 = rnd() * Math.PI * 2, p2 = rnd() * Math.PI * 2, p3 = rnd() * Math.PI * 2;
  const shape = th => 1 + h1 * Math.sin(2 * th + p1) + h2 * Math.sin(5 * th + p2) + 0.03 * Math.sin(9 * th + p3); // 恆正（|h1|+|h2|+0.03 < 1），band 之間永遠嚴格同心
  const mLon = 111320 * Math.cos(lat * Math.PI / 180), mLat = 110540, N = 28;
  const features = minutesList.map(minutes => {
    const radiusM = mpm * minutes; const ring = [];
    for (let k = 0; k <= N; k++) { const th = (k / N) * Math.PI * 2; const r = radiusM * shape(th); ring.push([lon + (r * Math.cos(th)) / mLon, lat + (r * Math.sin(th)) / mLat]); }
    return { type: 'Feature', properties: { value: minutes * 60, group_index: 0 }, geometry: { type: 'Polygon', coordinates: [ring] } };
  });
  return { type: 'FeatureCollection', features };
}

/**
 * @param {Record<string,string>} env 已合併 .env + process.env 的環境變數（見 server/index.mjs 的 loadEnv）
 * @returns {{ '/api/walkshed': (ctx: { url: URL }) => Promise<{status:number, json:any}> }}
 */
export function createOrsRoutes(env) {
  const cache = createLru(CACHE_MAX, CACHE_TTL_MS);
  // RATE_WALKSHED_PER_MIN is optional — same override convention server/index.mjs already uses for
  // RATE_AGENT_PER_MIN / RATE_TTS_PER_MIN; unset (the default) keeps the spec'd 30/min.
  const allow = createRateGuard(+(env.RATE_WALKSHED_PER_MIN || RATE_MAX_PER_MIN), RATE_WINDOW_MS);

  async function walkshed({ url }) {
    const lon = numParam(url, 'lon'), lat = numParam(url, 'lat');
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return { status: 400, json: { error: 'lon/lat required' } };
    const profileParam = url.searchParams.get('profile') || 'foot-walking';
    const profile = PROFILES.has(profileParam) ? profileParam : 'foot-walking';
    const minutes = parseMinutes(url.searchParams.get('minutes'));

    const key = `${profile}|${minutes.join(',')}|${lon.toFixed(4)}|${lat.toFixed(4)}`;
    const cached = cache.get(key);
    if (cached) return { status: 200, json: cached }; // 快取命中：不佔配額、不管有沒有金鑰

    if (!env.ORS_API_KEY) {
      if (DEMO_ON(env)) { const out = { ...demoWalkshedFC(profile, lon, lat, minutes), source: 'ors', profile, minutes, demo: true }; cache.set(key, out); return { status: 200, json: out }; }
      return { status: 503, json: { error: 'ORS_API_KEY not set', fallback: true } };
    }
    if (!allow()) return { status: 429, json: { error: `已超過每分鐘 ${RATE_MAX_PER_MIN} 次的配額保護，稍後再試`, fallback: true } };

    try {
      const fc = await callOrs(env, profile, lon, lat, minutes);
      const out = { ...fc, source: 'ors', profile, minutes };
      cache.set(key, out);
      return { status: 200, json: out };
    } catch (e) {
      if (e.status) return { status: e.status, json: { error: e.message } }; // ORS 自己回的錯，原樣傳回
      return { status: 502, json: { error: 'ORS request failed: ' + e.message, fallback: true } }; // fetch 失敗（斷線/逾時/DNS）
    }
  }

  return { '/api/walkshed': walkshed };
}

/** 設定頁用：測試 ORS 金鑰是否可用。對台北101打一個 60 秒範圍的最小請求，不經過快取／配額保護。 */
export async function testOrs(env) {
  if (!env.ORS_API_KEY) return { ok: false, detail: 'ORS_API_KEY not set' };
  try {
    const fc = await callOrs(env, 'foot-walking', TAIPEI_101[0], TAIPEI_101[1], [1]); // range = 60s
    const n = Array.isArray(fc.features) ? fc.features.length : 0;
    return { ok: true, detail: `ORS 連線成功：台北101 60 秒步行圈回傳 ${n} 個 feature` };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}
