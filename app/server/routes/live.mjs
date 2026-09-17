// 「即時城市」資料代理 — 中央氣象署（CWA）天氣、環境部（MOENV）AQI、YouBike 2.0 即時站點、
// 交通部 TDX 捷運站間耗時（S2STravelTime）。純 Node http 路由，不依賴 index.mjs（避免循環 import），
// 只用 env（server/index.mjs 已合併 .env + process.env 那份物件）與全域 fetch（測試時可整個替換 globalThis.fetch）。
//
// 設計原則（配合 PeakLens「沒有 key 也要能跑」的產品規則）：
//   - 缺對應的 .env key → 該部分回傳 null（/api/env）或直接回應 503 + { fallback:true }（/api/tdx/s2s），
//     never a 500：任何上游錯誤都在這支檔案內被吃掉、記錄一行 console.warn，不讓例外炸到呼叫端。
//   - 三個路由分別對應 server/index.mjs 既有的「路由表」慣例：export 一個 `{ '/path': async ({url}) => ({status,json}) }`
//     的物件，讓 index.mjs 用同一套 `if (LIVE[url.pathname]) { … }` 掛載（見本檔案最上層 createLiveRoutes 的回傳值）。
//   - 每個 handler 只依賴 env + fetch，沒有模組級可變狀態（快取／TDX token 都收在 createLiveRoutes() 的
//     closure 裡），所以測試可以在同一個 process 內多次呼叫 createLiveRoutes(fakeEnv) 而不互相污染。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // .../app/server/routes

/* ---------------- 共用小工具（純函式，無狀態，模組層級共用安全） ---------------- */
const pick = (obj, ...keys) => { if (!obj) return null; for (const k of keys) { const v = obj[k]; if (v !== undefined && v !== null && v !== '') return v; } return null; };
const numOf = v => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }; // Number(null)===0／Number('')===0 都是陷阱，這裡先擋掉

/** 統一的「打上游、盡量拿到 JSON」小工具；上游不是 JSON 也不丟例外（json 會是 null，呼叫端自己判斷）。 */
async function getJson(url, init = {}) {
  const { timeoutMs = 10000, ...rest } = init;
  const r = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* 上游沒回 JSON（例如純文字錯誤訊息），交給呼叫端判斷 */ }
  return { ok: r.ok, status: r.status, json, text };
}

/** 球面距離（公尺），用來挑「離 lon/lat 最近的測站」。 */
function haversine(lon1, lat1, lon2, lat2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 簡單的 TTL 記憶體快取，內建「同時多個請求進來只打一次上游」（in-flight dedupe）。 */
function makeCache(ttlMs) {
  let value, at = 0, pending = null;
  return {
    async get(fetcher) {
      if (at && Date.now() - at < ttlMs) return value;
      if (pending) return pending;
      pending = Promise.resolve().then(fetcher).then(v => { value = v; at = Date.now(); pending = null; return v; }, e => { pending = null; throw e; });
      return pending;
    },
    clear() { at = 0; pending = null; },
  };
}

/* ============================================================
 * 中央氣象署（CWA）：現在天氣觀測 O-A0003-001 ＋ 36 小時預報 F-C0032-001
 * ============================================================ */
// CWA 缺測常見用 -99 / -990 / -999 這類負值代表「沒有值」；台北的氣溫、濕度物理上不可能低於 -90，用這條線擋掉。
const cwaNum = v => { const n = numOf(v); return n != null && n > -90 ? n : null; };

/**
 * @param {Record<string,string>} env
 * @returns {Promise<{temp:number|null,desc:string|null,humidity:number|null,pop:number|null,minT:number|null,maxT:number|null,at:string|null}|null>}
 */
async function fetchCwaWeather(env) {
  if (!env.CWA_API_KEY) return null;
  const key = env.CWA_API_KEY;
  let obs = null, fc = null;
  try {
    const r = await getJson(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001?Authorization=${encodeURIComponent(key)}&StationName=${encodeURIComponent('臺北')}`);
    if (r.ok && r.json) obs = r.json; else console.warn('[live] CWA O-A0003-001 HTTP', r.status);
  } catch (e) { console.warn('[live] CWA O-A0003-001 failed:', e.message); }
  try {
    const r = await getJson(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001?Authorization=${encodeURIComponent(key)}&locationName=${encodeURIComponent('臺北市')}`);
    if (r.ok && r.json) fc = r.json; else console.warn('[live] CWA F-C0032-001 HTTP', r.status);
  } catch (e) { console.warn('[live] CWA F-C0032-001 failed:', e.message); }
  if (!obs && !fc) return null;

  // O-A0003-001 官方文件為 PascalCase：records.Station[0].WeatherElement.{AirTemperature,Weather,RelativeHumidity,...}
  // （lowercase 分支是防呆備援，實測未見過，但不驗證一次就出包不值得）
  const station = (pick(obs && obs.records, 'Station', 'station') || [])[0] || null;
  const we = (station && pick(station, 'WeatherElement', 'weatherElement')) || {};
  const temp = cwaNum(pick(we, 'AirTemperature', 'airTemperature'));
  const humidity = cwaNum(pick(we, 'RelativeHumidity', 'relativeHumidity'));
  let desc = pick(we, 'Weather', 'weather'); if (desc === '-99') desc = null;
  const obsTime = station && pick(station, 'ObsTime', 'obsTime');
  const obsAt = (obsTime && pick(obsTime, 'DateTime', 'dateTime')) || null;

  // F-C0032-001 官方樣式為 lowerCamelCase：records.location[0].weatherElement[].time[0].parameter.parameterName
  const loc = (pick(fc && fc.records, 'location', 'Location') || [])[0] || null;
  const els = (loc && pick(loc, 'weatherElement', 'WeatherElement')) || [];
  const elByName = name => (Array.isArray(els) ? els.find(e => pick(e, 'elementName', 'ElementName') === name) : null);
  const firstParam = el => { const t = pick(el, 'time', 'Time'); const slot = Array.isArray(t) ? t[0] : null; const p = slot && pick(slot, 'parameter', 'Parameter'); return p ? pick(p, 'parameterName', 'ParameterName') : null; };
  const fcWx = firstParam(elByName('Wx'));
  const pop = cwaNum(firstParam(elByName('PoP')));
  const minT = cwaNum(firstParam(elByName('MinT')));
  const maxT = cwaNum(firstParam(elByName('MaxT')));

  return { temp, desc: desc || fcWx || null, humidity, pop, minT, maxT, at: obsAt };
}

/* ============================================================
 * 環境部（MOENV）空氣品質指標 aqx_p_432
 * ============================================================ */
const AQI_COUNTY_RE = /臺北市|台北市/;
// 官方資料集頁面（data.moenv.gov.tw/en/dataset/detail/aqx_p_432）標的欄位是 PascalCase：
// SiteName / County / AQI / Status / PM2.5（含字面句點）/ Longitude / Latitude / PublishTime。
function normalizeAqiRecord(rec) {
  return {
    county: pick(rec, 'County', 'county'),
    site: pick(rec, 'SiteName', 'sitename', 'siteName'),
    aqi: numOf(pick(rec, 'AQI', 'aqi')),
    status: pick(rec, 'Status', 'status'),
    pm25: numOf(pick(rec, 'PM2.5', 'pm2.5', 'PM25')),
    lon: numOf(pick(rec, 'Longitude', 'longitude')),
    lat: numOf(pick(rec, 'Latitude', 'latitude')),
    at: pick(rec, 'PublishTime', 'publishtime', 'publishTime'),
  };
}
/** @returns {Promise<Array|null>} 台北市測站清單（已正規化），key 缺失或上游失敗回 null。 */
async function fetchAqiList(env) {
  if (!env.MOENV_AQI_API_KEY) return null;
  try {
    const r = await getJson(`https://data.moenv.gov.tw/api/v2/aqx_p_432?api_key=${encodeURIComponent(env.MOENV_AQI_API_KEY)}&limit=100`);
    if (!r.ok || !r.json) { console.warn('[live] MOENV AQI HTTP', r.status); return null; }
    const raw = Array.isArray(r.json.records) ? r.json.records : (Array.isArray(r.json) ? r.json : []);
    return raw.map(normalizeAqiRecord).filter(rec => rec.site && AQI_COUNTY_RE.test(rec.county || ''));
  } catch (e) { console.warn('[live] MOENV AQI failed:', e.message); return null; }
}
/** 從台北市測站清單挑一個：有 lon/lat 就挑最近；否則預設中山；都沒有就挑清單第一筆。 */
function pickAqiSite(list, lon, lat) {
  if (!list || !list.length) return null;
  let rec = null;
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    let best = Infinity;
    for (const r of list) { if (r.lon == null || r.lat == null) continue; const d = haversine(lon, lat, r.lon, r.lat); if (d < best) { best = d; rec = r; } }
  }
  if (!rec) rec = list.find(r => r.site === '中山') || list[0];
  return rec ? { value: rec.aqi, status: rec.status, pm25: rec.pm25, site: rec.site, at: rec.at } : null;
}

/* ============================================================
 * YouBike 2.0 即時站點（免 key）
 * ============================================================ */
const TAIPEI_BBOX = [121.44, 24.95, 121.68, 25.22]; // [west, south, east, north]，涵蓋台北市 12 行政區（含邊界留餘裕）
function normTime(v) { // 常見 mday 格式 20260917140012 → ISO+08:00；格式對不上就原樣回傳，絕不丟例外
  if (v == null) return null; const s = String(v); const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00` : s;
}
async function fetchYouBike() {
  try {
    const r = await getJson('https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json');
    if (!r.ok || !Array.isArray(r.json)) { console.warn('[live] YouBike HTTP', r.status); return []; }
    const out = [];
    for (const s of r.json) {
      const lat = numOf(pick(s, 'lat')), lon = numOf(pick(s, 'lng', 'lon'));
      if (lat == null || lon == null) continue;
      if (lon < TAIPEI_BBOX[0] || lon > TAIPEI_BBOX[2] || lat < TAIPEI_BBOX[1] || lat > TAIPEI_BBOX[3]) continue;
      const bikes = numOf(pick(s, 'available_rent_bikes', 'sbi')) ?? 0;
      const docks = numOf(pick(s, 'available_return_bikes', 'bemp')) ?? 0;
      const total = numOf(pick(s, 'total', 'tot')) ?? (bikes + docks);
      out.push({
        id: pick(s, 'sno', 'SNO'),
        name: String(pick(s, 'sna', 'SNA') || '').replace(/^YouBike2\.0_/, '').trim(),
        lat, lon, total, bikes, docks,
        updated: normTime(pick(s, 'updateTime', 'mday', 'srcUpdateTime')),
      });
    }
    return out;
  } catch (e) { console.warn('[live] YouBike failed:', e.message); return []; }
}

/* ============================================================
 * 交通部 TDX：OAuth2 client_credentials + Rail/Metro/S2STravelTime/TRTC
 * ============================================================
 * Schema 假設（本次環境連不到需要登入的 Swagger UI，交叉核對公開範例/文件後採用此結構，
 * 詳見 https://tdx.transportdata.tw/api-service/swagger，之後有機會請直接核對一次）：
 *   回應頂層通常是「依路線分組」的陣列，每組帶 LineID/SubRouteID 等識別碼，內含巢狀 TravelTimes[]；
 *   TravelTimes[] 每筆＝ { Sequence, FromStationID, FromStationName:{Zh_tw,En}, ToStationID,
 *   ToStationName:{Zh_tw,En}, RunTime(秒), StopTime(秒) }。
 *   mapper 同時容忍「頂層就是扁平 hop 陣列」這種形狀（不同路線/版本回應結構可能不同），
 *   兩種都會被攤平成同一份 { from, to, line, runSec, stopSec }。任何一筆缺 from/to/runSec 就整筆丟棄。
 */
const TDX_TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TDX_S2S_URL = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/S2STravelTime/TRTC?$format=JSON';
const TDX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normHop(h, lineFallback) {
  if (!h) return null;
  const fromRaw = pick(h, 'FromStationName', 'fromStationName'); const toRaw = pick(h, 'ToStationName', 'toStationName');
  const from = typeof fromRaw === 'string' ? fromRaw : pick(fromRaw, 'Zh_tw', 'ZhTw', 'zh_tw');
  const to = typeof toRaw === 'string' ? toRaw : pick(toRaw, 'Zh_tw', 'ZhTw', 'zh_tw');
  const runSec = numOf(pick(h, 'RunTime', 'runSec', 'RunSec'));
  const stopSec = numOf(pick(h, 'StopTime', 'stopSec', 'StopSec')) ?? 0;
  if (!from || !to || runSec == null) return null;
  const line = pick(h, 'LineID', 'LineNo', 'line') || lineFallback || null;
  return { from: String(from), to: String(to), line: line != null ? String(line) : null, runSec, stopSec };
}
/** 把「巢狀（每路線一組 TravelTimes[]）」或「扁平 hop 陣列」兩種可能形狀都攤平成 hop[]。 */
function flattenS2S(raw) {
  const top = Array.isArray(raw) ? raw : (Array.isArray(raw && raw.S2STravelTimes) ? raw.S2STravelTimes : []);
  const out = [];
  for (const item of top) {
    const nested = item && Array.isArray(item.TravelTimes) ? item.TravelTimes : null;
    if (nested) { const line = pick(item, 'LineID', 'LineNo', 'SubRouteID', 'RouteID'); for (const t of nested) { const h = normHop(t, line); if (h) out.push(h); } }
    else { const h = normHop(item); if (h) out.push(h); }
  }
  return out;
}

/* ============================================================
 * createLiveRoutes(env) — server/index.mjs 開機時呼叫一次；快取與 TDX token 狀態都收在這個 closure 裡，
 * 讓多次呼叫（例如測試裡對不同 fake env 各建一份）彼此獨立，不會互相污染。
 * ============================================================ */
export function createLiveRoutes(env) {
  // 磁碟快取目錄可用 env.PEAKLENS_CACHE_DIR 覆寫（比照 index.mjs 的 PEAKLENS_DIST 慣例），
  // 讓測試能把 24h 快取導到 scratchpad，不要動到真的 app/server/.cache/。
  const cacheDir = env.PEAKLENS_CACHE_DIR ? path.resolve(env.PEAKLENS_CACHE_DIR) : path.join(here, '..', '.cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) { console.warn('[live] cache dir unavailable:', e.message); }
  const tdxCacheFile = path.join(cacheDir, 'tdx_s2s.json');

  const weatherCache = makeCache(10 * 60 * 1000);
  const aqiCache = makeCache(10 * 60 * 1000);
  const youbikeCache = makeCache(60 * 1000);
  let tdxToken = null; // { access_token, expires_at } — 記憶體快取到 expiry − 60s

  function readTdxCache({ freshOnly }) {
    try {
      const raw = JSON.parse(fs.readFileSync(tdxCacheFile, 'utf8'));
      if (!raw || !raw.fetched_at) return null;
      if (freshOnly && Date.now() - Date.parse(raw.fetched_at) >= TDX_CACHE_TTL_MS) return null;
      return raw;
    } catch { return null; } // 沒有檔案或壞檔都當作沒有快取
  }
  function writeTdxCache(data) { try { fs.writeFileSync(tdxCacheFile, JSON.stringify(data)); } catch (e) { console.warn('[live] tdx disk cache write failed:', e.message); } }

  async function getTdxToken() {
    if (tdxToken && tdxToken.expires_at - 60000 > Date.now()) return tdxToken.access_token;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: env.TDX_CLIENT_ID, client_secret: env.TDX_CLIENT_SECRET });
    const r = await getJson(TDX_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (!r.ok || !r.json || !r.json.access_token) throw new Error(`TDX token HTTP ${r.status}: ${(r.text || '').slice(0, 200)}`);
    tdxToken = { access_token: r.json.access_token, expires_at: Date.now() + (numOf(r.json.expires_in) || 1800) * 1000 };
    return tdxToken.access_token;
  }
  async function fetchTdxS2s() {
    const token = await getTdxToken();
    const r = await getJson(TDX_S2S_URL, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, timeoutMs: 15000 });
    if (!r.ok) throw new Error(`TDX S2STravelTime HTTP ${r.status}: ${(r.text || '').slice(0, 200)}`);
    const data = { hops: flattenS2S(r.json), fetched_at: new Date().toISOString() };
    writeTdxCache(data);
    return data;
  }

  return {
    /** 現在天氣（CWA）＋ 36 小時預報（CWA）＋ AQI（MOENV，可用 ?lon=&lat= 挑最近測站，預設中山）。 */
    async '/api/env'({ url }) {
      const lon = numOf(url.searchParams.get('lon'));
      const lat = numOf(url.searchParams.get('lat'));
      const [weather, aqiList] = await Promise.all([
        weatherCache.get(() => fetchCwaWeather(env)),
        aqiCache.get(() => fetchAqiList(env)),
      ]);
      return {
        status: 200,
        json: {
          weather: weather || null,
          aqi: pickAqiSite(aqiList, lon, lat),
          available: { cwa: !!env.CWA_API_KEY, moenv: !!env.MOENV_AQI_API_KEY },
        },
      };
    },
    /** YouBike 2.0 即時站點（台北市 bbox 內），60 秒快取。 */
    async '/api/youbike'() {
      const list = await youbikeCache.get(fetchYouBike);
      return { status: 200, json: list };
    },
    /** 捷運站間實際搭乘秒數（TDX），24h 磁碟快取；缺 TDX key 或上游失敗都回 503 + fallback:true。 */
    async '/api/tdx/s2s'() {
      if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) return { status: 503, json: { error: 'TDX_CLIENT_ID/TDX_CLIENT_SECRET not set', fallback: true } };
      const fresh = readTdxCache({ freshOnly: true });
      if (fresh) return { status: 200, json: fresh };
      try {
        return { status: 200, json: await fetchTdxS2s() };
      } catch (e) {
        console.warn('[live] TDX S2S failed:', e.message);
        const stale = readTdxCache({ freshOnly: false }); // 上游掛了但還有舊快取，回舊資料好過完全沒有
        if (stale) return { status: 200, json: { ...stale, stale: true } };
        return { status: 503, json: { error: e.message, fallback: true } };
      }
    },
  };
}

/* ============================================================
 * testLive(env) — 給設定頁用的即時探測：三把 key 各自「真的打一次」，回報 ok/detail。
 * 不碰上面的 24h/10min/60s 快取（設定頁要的是「現在這把 key 到底行不行」，不是快取結果）。
 * ============================================================ */
export async function testLive(env) {
  const [cwa, moenv, tdx] = await Promise.all([testCwa(env), testMoenv(env), testTdx(env)]);
  return { cwa, moenv, tdx };
}
async function testCwa(env) {
  if (!env.CWA_API_KEY) return { ok: false, detail: 'CWA_API_KEY 未設定' };
  try {
    const r = await getJson(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001?Authorization=${encodeURIComponent(env.CWA_API_KEY)}&StationName=${encodeURIComponent('臺北')}`);
    if (r.status === 401 || r.status === 403) return { ok: false, detail: `CWA_API_KEY 被拒絕（HTTP ${r.status}）` };
    const station = (pick(r.json && r.json.records, 'Station', 'station') || [])[0];
    if (r.ok && station) { const we = pick(station, 'WeatherElement', 'weatherElement') || {}; const t = pick(we, 'AirTemperature', 'airTemperature'); return { ok: true, detail: `臺北測站 · ${pick(we, 'Weather', 'weather') || '—'}${t != null ? ' ' + t + '°' : ''}` }; }
    return { ok: false, detail: `HTTP ${r.status}：回應沒有臺北測站資料` };
  } catch (e) { return { ok: false, detail: e.message }; }
}
async function testMoenv(env) {
  if (!env.MOENV_AQI_API_KEY) return { ok: false, detail: 'MOENV_AQI_API_KEY 未設定' };
  try {
    const r = await getJson(`https://data.moenv.gov.tw/api/v2/aqx_p_432?api_key=${encodeURIComponent(env.MOENV_AQI_API_KEY)}&limit=5`);
    const raw = r.json && (Array.isArray(r.json.records) ? r.json.records : (Array.isArray(r.json) ? r.json : null));
    if (r.ok && raw && raw.length) return { ok: true, detail: `${raw.length} 筆測站資料（例：${pick(raw[0], 'SiteName', 'sitename') || '—'}）` };
    if (r.json && /api_key/i.test(JSON.stringify(r.json))) return { ok: false, detail: 'api_key 無效或未設定' };
    return { ok: false, detail: `HTTP ${r.status}` };
  } catch (e) { return { ok: false, detail: e.message }; }
}
async function testTdx(env) {
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) return { ok: false, detail: 'TDX_CLIENT_ID/TDX_CLIENT_SECRET 未設定' };
  try {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: env.TDX_CLIENT_ID, client_secret: env.TDX_CLIENT_SECRET });
    const r = await getJson(TDX_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (r.ok && r.json && r.json.access_token) return { ok: true, detail: 'OAuth2 token 取得成功（尚未呼叫 S2STravelTime）' };
    return { ok: false, detail: `token HTTP ${r.status}：${(r.json && r.json.error_description) || (r.text || '').slice(0, 160)}` };
  } catch (e) { return { ok: false, detail: e.message }; }
}
