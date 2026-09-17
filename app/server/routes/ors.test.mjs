// Node unit test for server/routes/ors.mjs — plain Node, no test runner, no real network calls.
// Run with: node app/server/routes/ors.test.mjs
import { createOrsRoutes } from './ors.mjs';

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
const urlOf = q => new URL('http://x/api/walkshed?' + q);

console.log('=== 1) 沒有 ORS_API_KEY → 503 fallback ===');
{
  const routes = createOrsRoutes({});
  const r = await routes['/api/walkshed']({ url: urlOf('lon=121.5645&lat=25.0339') });
  check('status', r.status, 503);
  check('error message', r.json.error, 'ORS_API_KEY not set');
  check('fallback flag', r.json.fallback, true);
}

console.log('\n=== 2) lon/lat 缺漏或不是數字 → 400（在金鑰檢查之前就該擋下） ===');
{
  const routes = createOrsRoutes({ ORS_API_KEY: 'k' });
  const r1 = await routes['/api/walkshed']({ url: urlOf('lat=25.0339') }); // 缺 lon
  check('missing lon: status', r1.status, 400);
  const r2 = await routes['/api/walkshed']({ url: urlOf('lon=abc&lat=25.0339') }); // lon 不是數字
  check('non-numeric lon: status', r2.status, 400);
}

console.log('\n=== 3) 假 fetch：回應形狀、快取命中不重打、不同座標才重打 ===');
{
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true, status: 200,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { value: 900 }, geometry: { type: 'Polygon', coordinates: [[[121.56, 25.03], [121.561, 25.03], [121.561, 25.031], [121.56, 25.03]]] } }],
      }),
    };
  };
  try {
    const routes = createOrsRoutes({ ORS_API_KEY: 'test-key-123' });
    const q = 'lon=121.5645&lat=25.0339&profile=foot-walking&minutes=5,10,15';

    const r1 = await routes['/api/walkshed']({ url: urlOf(q) });
    check('status', r1.status, 200);
    check('source', r1.json.source, 'ors');
    check('profile', r1.json.profile, 'foot-walking');
    check('minutes (parsed/sorted)', r1.json.minutes, [5, 10, 15]);
    check('features passthrough', r1.json.features.length, 1);
    assert('exactly one outbound fetch so far', calls.length === 1);
    check('outbound URL', calls[0].url, 'https://api.openrouteservice.org/v2/isochrones/foot-walking');
    const body = JSON.parse(calls[0].opts.body);
    check('outbound body.locations', body.locations, [[121.5645, 25.0339]]);
    check('outbound body.range (minutes*60)', body.range, [300, 600, 900]);
    check('outbound body.range_type', body.range_type, 'time');
    check('outbound body.smoothing', body.smoothing, 25);
    check('outbound Authorization header', calls[0].opts.headers.Authorization, 'test-key-123');
    check('outbound Content-Type header', calls[0].opts.headers['Content-Type'], 'application/json');

    const r2 = await routes['/api/walkshed']({ url: urlOf(q) }); // 一模一樣的參數，應該命中快取
    check('cache hit: status', r2.status, 200);
    assert('cache hit: fetch NOT called again', calls.length === 1);
    check('cache hit: payload identical', r2.json, r1.json);

    const r3 = await routes['/api/walkshed']({ url: urlOf('lon=121.7000&lat=25.0400&profile=foot-walking&minutes=5,10,15') }); // 不同座標
    check('different location: status', r3.status, 200);
    assert('different location: fetch called again', calls.length === 2);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('\n=== 4) 每分鐘 30 次配額保護：第 31 個不同座標的請求應該被擋下 ===');
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: [] }) });
  try {
    const routes = createOrsRoutes({ ORS_API_KEY: 'k' });
    let last;
    for (let i = 0; i < 31; i++) last = await routes['/api/walkshed']({ url: urlOf(`lon=${(121.5 + i * 0.01).toFixed(4)}&lat=25.03&minutes=5`) });
    check('31st distinct-location call this minute: status', last.status, 429);
    assert('31st: fallback flag set', last.json.fallback === true);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('\n=== 5) ORS 回錯（例如額度用盡）→ 原樣傳回 status + message ===');
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: { message: 'Access to this API has been disallowed' } }) });
  try {
    const routes = createOrsRoutes({ ORS_API_KEY: 'k' });
    const r = await routes['/api/walkshed']({ url: urlOf('lon=100&lat=10&minutes=5') });
    check('status passthrough', r.status, 403);
    check('message extracted from ORS error body', r.json.error, 'Access to this API has been disallowed');
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('\n=== 6) PEAKLENS_DEMO_LIVE=1：沒有 ORS_API_KEY 時回擬真等時圈（200 + demo:true），旗標關掉或有真金鑰都不受影響 ===');
{
  console.log('-- 6a) 沒有金鑰、demo 旗標關掉（預設）→ 跟第 1 節一樣還是 503，行為不變 --');
  const routesOff = createOrsRoutes({});
  const rOff = await routesOff['/api/walkshed']({ url: urlOf('lon=121.5645&lat=25.0339&minutes=5,10,15') });
  check('demo off: status', rOff.status, 503);
  assert('demo off: no demo flag leaks in', rOff.json.demo === undefined);

  console.log('-- 6b) 沒有金鑰、demo 旗標開 → 200，GeoJSON 形狀跟 walkshed.js 的 polygonsOf()/_drawOrs() 期待的一致 --');
  const routesDemo = createOrsRoutes({ PEAKLENS_DEMO_LIVE: '1' });
  const q = 'lon=121.5645&lat=25.0339&profile=foot-walking&minutes=5,10,15';
  const r1 = await routesDemo['/api/walkshed']({ url: urlOf(q) });
  check('demo on: status', r1.status, 200);
  check('demo on: source', r1.json.source, 'ors');
  check('demo on: demo flag', r1.json.demo, true);
  check('demo on: minutes echoed back (parsed/sorted)', r1.json.minutes, [5, 10, 15]);
  assert('demo on: one feature per band', Array.isArray(r1.json.features) && r1.json.features.length === 3);
  assert('demo on: each feature is a Polygon with a closed-enough ring (>=4 pts) and properties.value in seconds',
    r1.json.features.every((f, i) => f.geometry.type === 'Polygon' && f.geometry.coordinates[0].length >= 4 && f.properties.value === [5, 10, 15][i] * 60));
  const maxDistM = ring => { let best = 0; for (const [lo, la] of ring) { const d = Math.hypot((lo - 121.5645) * 111320 * Math.cos(25.0339 * Math.PI / 180), (la - 25.0339) * 110540); if (d > best) best = d; } return best; };
  const radii = r1.json.features.map(f => maxDistM(f.geometry.coordinates[0]));
  assert('demo on: bands nest (5min radius < 10min radius < 15min radius, same angular shape)', radii[0] < radii[1] && radii[1] < radii[2]);

  console.log('-- 6c) 同樣的 lon/lat/profile 但换一個全新的 routes 實例（沒有共用快取）→ 種子化偽隨機仍算出同一組 blob --');
  const routesDemo2 = createOrsRoutes({ PEAKLENS_DEMO_LIVE: '1' });
  const r2 = await routesDemo2['/api/walkshed']({ url: urlOf(q) });
  check('demo on: deterministic across fresh instances (no shared cache)', r2.json, r1.json);

  console.log('-- 6d) 有真金鑰時 demo 旗標不該蓋掉真資料（never override real keys）：一律照樣打 ORS --');
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { value: 300 }, geometry: { type: 'Polygon', coordinates: [[[121.56, 25.03], [121.561, 25.03], [121.561, 25.031], [121.56, 25.03]]] } }] }) }; };
  try {
    const routesKeyed = createOrsRoutes({ ORS_API_KEY: 'real-key', PEAKLENS_DEMO_LIVE: '1' });
    const r3 = await routesKeyed['/api/walkshed']({ url: urlOf('lon=25&lat=25&minutes=5') });
    check('real key + demo on: status', r3.status, 200);
    assert('real key + demo on: real ORS actually called', calls === 1);
    assert('real key + demo on: response is NOT the demo fixture', r3.json.demo === undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
