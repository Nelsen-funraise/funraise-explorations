// Node unit test for server/routes/live.mjs — plain Node, no test runner, no real network calls.
// Run with: node app/server/routes/live.test.mjs
import fs from 'node:fs';
import { createLiveRoutes } from './live.mjs';

let pass = 0, fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n   got:  ${g}\n   want: ${w}`}`);
  if (ok) pass++; else fail++;
}
function assert(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (cond) pass++; else fail++;
}
const urlOf = (path, q = '') => new URL(`http://x${path}${q ? '?' + q : ''}`);
// 每個 createLiveRoutes() 都導去 scratchpad，絕不碰真的 app/server/.cache/（跟本檔案既有慣例一致）。
const CACHE_DIR = '/tmp/claude-0/-home-user-funraise-explorations/f4927650-32e5-5d1c-89ba-fa24fae47d2c/scratchpad/live-test-cache';
const noDemo = extra => ({ PEAKLENS_CACHE_DIR: CACHE_DIR, ...extra });
const demo = extra => ({ PEAKLENS_CACHE_DIR: CACHE_DIR, PEAKLENS_DEMO_LIVE: '1', ...extra });
// 每次重跑這支測試都先清掉上一次留下的 24h TDX 磁碟快取，不然「real key 一定會真的打 fetch」那個斷言
// 會在第二次執行時被上一輪寫下的快取命中蓋過去（fetch 根本不會被呼叫，但那不是這個 test 想驗證的事）。
for (const dir of [CACHE_DIR, CACHE_DIR + '-keyed']) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 沒有就算了 */ } }

console.log('=== 1) /api/env — PEAKLENS_DEMO_LIVE 關掉時行為完全不變（缺 key 兩邊都是 null，沒有 demo 旗標） ===');
{
  const routes = createLiveRoutes(noDemo({}));
  const r = await routes['/api/env']({ url: urlOf('/api/env') });
  check('status', r.status, 200);
  check('weather (no CWA key)', r.json.weather, null);
  check('aqi (no MOENV key)', r.json.aqi, null);
  check('available', r.json.available, { cwa: false, moenv: false });
  assert('no demo flag leaks in when the flag is off', r.json.demo === undefined);
}

console.log('\n=== 2) /api/env — demo 開、兩把 key 都缺 → §16.8 指定的固定讀數，demo:true ===');
{
  const routes = createLiveRoutes(demo({}));
  const r = await routes['/api/env']({ url: urlOf('/api/env') });
  check('status', r.status, 200);
  check('weather', r.json.weather && { temp: r.json.weather.temp, desc: r.json.weather.desc, humidity: r.json.weather.humidity, pop: r.json.weather.pop, minT: r.json.weather.minT, maxT: r.json.weather.maxT },
    { temp: 30, desc: '多雲', humidity: 70, pop: 20, minT: 27, maxT: 33 });
  check('aqi', r.json.aqi && { value: r.json.aqi.value, status: r.json.aqi.status, site: r.json.aqi.site }, { value: 43, status: '良好', site: '松山' });
  check('demo flag', r.json.demo, true);
  check('available still reflects the real (missing) keys, demo does not fake this', r.json.available, { cwa: false, moenv: false });
}

console.log('\n=== 3) /api/env — 只缺 MOENV（CWA 有效）→ 只有 aqi 是 demo，weather 用真的上游資料，demo 旗標仍是 true ===');
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('O-A0003-001')) return { ok: true, status: 200, text: async () => JSON.stringify({ records: { Station: [{ WeatherElement: { AirTemperature: '26.5', RelativeHumidity: '81', Weather: '晴時多雲' }, ObsTime: { DateTime: '2026-09-17T10:00:00+08:00' } }] } }) };
    if (String(url).includes('F-C0032-001')) return { ok: true, status: 200, text: async () => JSON.stringify({ records: { location: [{ weatherElement: [] }] } }) };
    throw new Error('unexpected fetch ' + url);
  };
  try {
    const routes = createLiveRoutes(demo({ CWA_API_KEY: 'k' }));
    const r = await routes['/api/env']({ url: urlOf('/api/env') });
    check('status', r.status, 200);
    check('weather comes from the fake upstream, not the demo fixture', r.json.weather.temp, 26.5);
    check('aqi still demo (MOENV key missing)', r.json.aqi && { value: r.json.aqi.value, site: r.json.aqi.site }, { value: 43, site: '松山' });
    check('demo flag still true (partial demo)', r.json.demo, true);
    check('available.cwa true, available.moenv false', r.json.available, { cwa: true, moenv: false });
  } finally { globalThis.fetch = realFetch; }
}

console.log('\n=== 4) /api/youbike — demo 關掉時形狀不變（裸陣列，沒有 demo 旗標） ===');
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify([{ sno: '1', sna: 'YouBike2.0_test', lat: 25.03, lng: 121.55, available_rent_bikes: 3, available_return_bikes: 5 }]) });
  try {
    const routes = createLiveRoutes(noDemo({}));
    const r = await routes['/api/youbike']({ url: urlOf('/api/youbike') });
    check('status', r.status, 200);
    assert('bare array shape (unchanged from before this feature)', Array.isArray(r.json) && r.json.length === 1);
  } finally { globalThis.fetch = realFetch; }
}

console.log('\n=== 5) /api/youbike — demo 開 → ~60 站、demo:true、每站 bikes+docks===total、座標落在台北市範圍內 ===');
{
  const routes = createLiveRoutes(demo({}));
  const r = await routes['/api/youbike']({ url: urlOf('/api/youbike') });
  check('status', r.status, 200);
  check('demo flag', r.json.demo, true);
  const stations = r.json.stations;
  assert('stations is an array', Array.isArray(stations));
  assert('roughly 60 stations (spec: ~60)', stations.length >= 55 && stations.length <= 65);
  assert('every station: bikes+docks===total, finite lat/lon in the Taipei area, unique id',
    new Set(stations.map(s => s.id)).size === stations.length &&
    stations.every(s => s.bikes + s.docks === s.total && Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.lon > 121.4 && s.lon < 121.7 && s.lat > 24.9 && s.lat < 25.2));
}

console.log('\n=== 6) /api/youbike — demo 開，兩個全新的 routes 實例 → 偽隨機是「穩定」的，可重現（updated 是當下時間，本來就會變，比對時排除） ===');
{
  const strip = json => ({ demo: json.demo, stations: json.stations.map(({ updated, ...rest }) => rest) });
  const r1 = await createLiveRoutes(demo({}))['/api/youbike']({ url: urlOf('/api/youbike') });
  const r2 = await createLiveRoutes(demo({}))['/api/youbike']({ url: urlOf('/api/youbike') });
  check('deterministic across fresh instances (ignoring the live "updated" timestamp)', strip(r2.json), strip(r1.json));
}

console.log('\n=== 7) /api/tdx/s2s — demo 關掉時行為不變（缺 key → 503 fallback） ===');
{
  const routes = createLiveRoutes(noDemo({}));
  const r = await routes['/api/tdx/s2s']({ url: urlOf('/api/tdx/s2s') });
  check('status', r.status, 503);
  check('fallback flag', r.json.fallback, true);
}

console.log('\n=== 8) /api/tdx/s2s — demo 開、缺 TDX key → 200，hops 是「沿線相鄰站」，demo:true ===');
{
  const routes = createLiveRoutes(demo({}));
  const r = await routes['/api/tdx/s2s']({ url: urlOf('/api/tdx/s2s') });
  check('status', r.status, 200);
  check('demo flag', r.json.demo, true);
  const hops = r.json.hops;
  assert('hops non-empty array', Array.isArray(hops) && hops.length > 50);
  assert('every hop: from/to strings, line string, runSec finite>0, stopSec===30',
    hops.every(h => typeof h.from === 'string' && h.from && typeof h.to === 'string' && h.to && typeof h.line === 'string' && Number.isFinite(h.runSec) && h.runSec > 0 && h.stopSec === 30));
  assert('fetched_at present (ISO string)', typeof r.json.fetched_at === 'string' && !Number.isNaN(Date.parse(r.json.fetched_at)));
}

console.log('\n=== 9) /api/tdx/s2s — 有真的 TDX key + demo 開 → 一律照樣走真的 OAuth+S2S（never override real keys） ===');
{
  const realFetch = globalThis.fetch; let tokenCalls = 0, s2sCalls = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('openid-connect/token')) { tokenCalls++; return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'tok', expires_in: 1800 }) }; }
    if (u.includes('S2STravelTime')) { s2sCalls++; return { ok: true, status: 200, text: async () => JSON.stringify([{ FromStationName: 'A', ToStationName: 'B', RunTime: 90, StopTime: 30 }]) }; }
    throw new Error('unexpected fetch ' + u);
  };
  try {
    const routes = createLiveRoutes(demo({ TDX_CLIENT_ID: 'id', TDX_CLIENT_SECRET: 'secret', PEAKLENS_CACHE_DIR: CACHE_DIR + '-keyed' }));
    const r = await routes['/api/tdx/s2s']({ url: urlOf('/api/tdx/s2s') });
    check('status', r.status, 200);
    assert('real OAuth token endpoint was called', tokenCalls === 1);
    assert('real S2STravelTime endpoint was called', s2sCalls === 1);
    assert('response is the real (flattened) hop, not the demo fixture', r.json.hops.length === 1 && r.json.hops[0].from === 'A' && r.json.hops[0].to === 'B');
    assert('no demo flag on the real path', r.json.demo === undefined);
  } finally { globalThis.fetch = realFetch; }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
