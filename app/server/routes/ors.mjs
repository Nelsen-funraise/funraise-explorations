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

/**
 * @param {Record<string,string>} env 已合併 .env + process.env 的環境變數（見 server/index.mjs 的 loadEnv）
 * @returns {{ '/api/walkshed': (ctx: { url: URL }) => Promise<{status:number, json:any}> }}
 */
export function createOrsRoutes(env) {
  const cache = createLru(CACHE_MAX, CACHE_TTL_MS);
  const allow = createRateGuard(RATE_MAX_PER_MIN, RATE_WINDOW_MS);

  async function walkshed({ url }) {
    const lon = numParam(url, 'lon'), lat = numParam(url, 'lat');
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return { status: 400, json: { error: 'lon/lat required' } };
    const profileParam = url.searchParams.get('profile') || 'foot-walking';
    const profile = PROFILES.has(profileParam) ? profileParam : 'foot-walking';
    const minutes = parseMinutes(url.searchParams.get('minutes'));

    const key = `${profile}|${minutes.join(',')}|${lon.toFixed(4)}|${lat.toFixed(4)}`;
    const cached = cache.get(key);
    if (cached) return { status: 200, json: cached }; // 快取命中：不佔配額、不管有沒有金鑰

    if (!env.ORS_API_KEY) return { status: 503, json: { error: 'ORS_API_KEY not set', fallback: true } };
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
