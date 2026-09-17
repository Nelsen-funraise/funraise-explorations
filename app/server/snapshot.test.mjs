// Node unit test for server/snapshot.mjs — plain Node, no test runner, no network calls, no fixtures beyond the real
// app/public/data/peaklens.json (already in the repo) plus one hand-built timeseries.json fixture written to a temp
// dir for the "file present" cases. Run with: node server/snapshot.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSnapshot } from './snapshot.mjs';

let pass = 0, fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n   got:  ${g}\n   want: ${w}`}`);
  if (ok) pass++; else fail++;
}
function assert(label, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : extra !== undefined ? `\n   ${JSON.stringify(extra)}` : ''}`);
  if (cond) pass++; else fail++;
}

const snap = createSnapshot({}); // real app/public/data (no PEAKLENS_DATA_DIR override) — the actual shipped snapshot

console.log('=== load & describe ===');
assert('loaded real peaklens.json (156 buildings)', snap.stats.counts.buildings === 156, snap.stats.counts);
assert('stats.date looks like a YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(snap.stats.date), snap.stats.date);
assert('describe() is a non-empty zh-TW string mentioning 快照', typeof snap.describe() === 'string' && snap.describe().includes('快照') && snap.describe().length > 50);
assert('describe() stays near the ~600-token budget (< 1200 chars, generous margin)', snap.describe().length < 1200, snap.describe().length);
assert('real data dir has no timeseries.json yet (other agent hasn\'t landed it)', snap.stats.hasTimeseries === false);

console.log('\n=== buildings: kind returns rows, district/name/grade filters ===');
{
  const all = snap.query({ kind: 'buildings' });
  assert('buildings: count > 0 and rows non-empty', all.count > 0 && all.rows.length > 0, all.count);
  assert('buildings: every row has a stock: key', all.rows.every(r => r.key.startsWith('stock:')), all.rows.map(r => r.key));
  const dist = snap.query({ kind: 'buildings', district: '信義區' });
  assert('buildings: district filter — every row is in 信義區', dist.rows.length > 0 && dist.rows.every(r => r.district === '信義區'), dist.rows.map(r => r.district));
  const dist2 = snap.query({ kind: 'buildings', district: '信義' }); // without the trailing 區
  check('buildings: district filter tolerates a missing trailing 區', dist2.count, dist.count);
  const name = snap.query({ kind: 'buildings', name: '101' });
  assert('buildings: name substring filter — every row name includes "101"', name.rows.length > 0 && name.rows.every(r => r.name.includes('101')), name.rows.map(r => r.name));
  const grade = snap.query({ kind: 'buildings', district: '信義區', grade: 'A' });
  assert('buildings: grade filter — every row graded A', grade.rows.length > 0 && grade.rows.every(r => r.grade === 'A'), grade.rows.map(r => r.grade));
}

console.log('\n=== mops: district + since (the owner\'s sample question) ===');
{
  const q = snap.query({ kind: 'mops', district: '信義區', since: '2025-09-01' });
  assert('mops: at least one row', q.count > 0, q);
  assert('mops: every row in 信義區', q.rows.every(r => r.district === '信義區'), q.rows.map(r => r.district));
  assert('mops: every row on/after 2025-09-01', q.rows.every(r => new Date(r.date) >= new Date('2025-09-01')), q.rows.map(r => r.date));
  assert('mops: every row has a mops: key', q.rows.every(r => r.key.startsWith('mops:')), q.rows.map(r => r.key));
  assert('mops: keys array mirrors row keys', JSON.stringify(q.keys) === JSON.stringify(q.rows.map(r => r.key)));
  const min = snap.query({ kind: 'mops', min_price: 1e9 });
  assert('mops: min_price filter — every row >= 10億', min.rows.every(r => r.amount >= 1e9), min.rows.map(r => r.amount));
  const asc = snap.query({ kind: 'mops', sort: 'asc', top: 50 }); const desc = snap.query({ kind: 'mops', sort: 'desc', top: 50 });
  assert('mops: sort asc vs desc actually reverses amount order', asc.rows[0].amount <= asc.rows.at(-1).amount && desc.rows[0].amount >= desc.rows.at(-1).amount && asc.rows[0].id !== desc.rows[0].id, { asc0: asc.rows[0].amount, desc0: desc.rows[0].amount });
}

console.log('\n=== licenses: year filter (ROC→western) + district via address substring ===');
{
  const y = snap.query({ kind: 'licenses', year: 2025, top: 50 });
  assert('licenses: year filter — every row year === 2025', y.count > 0 && y.rows.every(r => r.year === 2025), y.rows.map(r => r.year));
  const d = snap.query({ kind: 'licenses', district: '北投區', top: 50 });
  assert('licenses: district filter — every row address mentions 北投', d.count > 0 && d.rows.every(r => r.address.includes('北投')), d.rows.map(r => r.address));
  assert('licenses: every row has a license: key', d.rows.every(r => r.key.startsWith('license:')));
}

console.log('\n=== renewal: district + category ===');
{
  const cat = snap.query({ kind: 'renewal', category: '政府主導', top: 50 });
  assert('renewal: category filter — every row is 政府主導', cat.count > 0 && cat.rows.every(r => r.category === '政府主導'), cat.rows.map(r => r.category));
  assert('renewal: every row has a renewal: key; area_sqm numeric or null (one real record lacks it)', cat.rows.every(r => r.key.startsWith('renewal:') && (typeof r.area_sqm === 'number' || r.area_sqm === null)), cat.rows.map(r => r.area_sqm));
}

console.log('\n=== future: cumulative "by year Y" + district ===');
{
  const y2028 = snap.query({ kind: 'future', year: 2028, top: 50 }); const y2026 = snap.query({ kind: 'future', year: 2026, top: 50 });
  assert('future: cumulative — 2028 sees at least as many projects as 2026', y2028.count >= y2026.count, { y2026: y2026.count, y2028: y2028.count });
  assert('future: every 2026-cutoff row completes by 2026', y2026.rows.every(r => r.year <= 2026), y2026.rows.map(r => r.year));
  const dist = snap.query({ kind: 'future', district: '信義區', top: 50 });
  assert('future: district filter', dist.rows.every(r => r.district === '信義區'));
}

console.log('\n=== moves: district (to) vs from ===');
{
  const to = snap.query({ kind: 'moves', district: '信義區', top: 50 });
  assert('moves: district filter — every row moved TO 信義區', to.count > 0 && to.rows.every(r => r.to === '信義區'), to.rows.map(r => r.to));
  const from = snap.query({ kind: 'moves', from: '內湖區', top: 50 });
  assert('moves: from filter — every row moved FROM 內湖區', from.count > 0 && from.rows.every(r => r.from === '內湖區'), from.rows.map(r => r.from));
  assert('moves: every row has a move: key', to.rows.every(r => r.key.startsWith('move:')));
}

console.log('\n=== zones / infra / parks: name filter + keys ===');
{
  const z = snap.query({ kind: 'zones', top: 50 }); assert('zones: non-empty, zone: keys', z.count > 0 && z.rows.every(r => r.key.startsWith('zone:')));
  const i = snap.query({ kind: 'infra', name: '圖書館' }); assert('infra: name filter matches, infra: key', i.count > 0 && i.rows.every(r => r.name.includes('圖書館') && r.key.startsWith('infra:')), i.rows);
  const p = snap.query({ kind: 'parks', name: '南港' }); assert('parks: name filter matches, ipark: key', p.count > 0 && p.rows.every(r => r.name.includes('南港') && r.key.startsWith('ipark:')), p.rows);
}

console.log('\n=== areas: name filter + quarterly series with YoY ===');
{
  const a = snap.query({ kind: 'areas', name: '信義基隆' });
  assert('areas: exactly one match for 信義基隆', a.count === 1, a);
  assert('areas: has a heat: key', a.rows[0].key.startsWith('heat:'));
  assert('areas: carries a non-empty quarterly rent_series', Array.isArray(a.rows[0].rent_series) && a.rows[0].rent_series.length > 0, a.rows[0].rent_series);
  assert('areas: carries rent_yoy as a number', typeof a.rows[0].rent_yoy === 'number', a.rows[0].rent_yoy);
}

console.log('\n=== districts: analytics (company_total/growth/market_price/building_stats/top_industries) ===');
{
  const d = snap.query({ kind: 'districts', district: '信義區' });
  assert('districts: exactly one row for 信義區', d.count === 1, d);
  const row = d.rows[0];
  assert('districts: has company_total, growth, market_price fields, building_stats, top_industries', typeof row.company_total === 'number' && typeof row.growth === 'number' && typeof row.rent_avg === 'number' && Array.isArray(row.building_stats) && Array.isArray(row.top_industries), row);
  assert('districts: has no highlight key (districts aren\'t a highlightable layer)', d.keys.length === 0, d.keys);
}

console.log('\n=== summary: one paragraph, no keys ===');
{
  const s = snap.query({ kind: 'summary' });
  assert('summary: exactly one row with non-empty text mentioning the source date', s.count === 1 && s.rows[0].text.includes(snap.stats.date), s);
  assert('summary: no highlight keys', s.keys.length === 0);
}

console.log('\n=== timeseries: graceful null when the file is absent ===');
{
  const t = snap.query({ kind: 'timeseries', district: '信義區' });
  assert('timeseries (absent): count 0, empty rows, a helpful note — never throws', t.count === 0 && t.rows.length === 0 && typeof t.note === 'string', t);
}

console.log('\n=== timeseries: yoy math + peaks when the file IS present (synthetic fixture) ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peaklens-snap-test-'));
  fs.copyFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'data', 'peaklens.json'), path.join(tmp, 'peaklens.json'));
  const fixture = { meta: { years: [2023, 2024, 2025] }, by_district: { 信義區: { sales_all: { 2023: 100, 2024: 150, 2025: 120 }, sales_office: { 2023: 10, 2024: 20, 2025: 15 }, licenses: { 2023: 5, 2024: 5, 2025: 10 } } } };
  fs.writeFileSync(path.join(tmp, 'timeseries.json'), JSON.stringify(fixture));
  const snap2 = createSnapshot({ dataDir: tmp });
  assert('timeseries (present): stats.hasTimeseries true', snap2.stats.hasTimeseries === true);
  const q = snap2.query({ kind: 'timeseries', district: '信義區' });
  assert('timeseries (present): 3 yearly rows (2023-2025)', q.rows.length === 3, q.rows);
  const r2024 = q.rows.find(r => r.year === 2024), r2025 = q.rows.find(r => r.year === 2025);
  check('timeseries yoy: 2024 sales_all yoy = (150-100)/100 = 0.5', r2024.sales_all_yoy, 0.5);
  check('timeseries yoy: 2025 sales_all yoy = (120-150)/150 = -0.2', r2025.sales_all_yoy, -0.2);
  check('timeseries: 2023 yoy is null (no prior year in range)', q.rows.find(r => r.year === 2023).sales_all_yoy, null);
  assert('timeseries: peak year for sales_all is 2024 (value 150)', q.peaks.sales_all.year === 2024 && q.peaks.sales_all.value === 150, q.peaks);
  const since = snap2.query({ kind: 'timeseries', district: '信義區', since: '2024-06-01' });
  check('timeseries: since filters to years >= 2024', since.rows.map(r => r.year), [2024, 2025]);
  const year = snap2.query({ kind: 'timeseries', district: '信義區', year: 2025 });
  check('timeseries: year filter returns exactly that year', year.rows.map(r => r.year), [2025]);
  const city = snap2.query({ kind: 'timeseries' }); // no district → city totals, auto-summed from the one district in the fixture
  check('timeseries: city totals (single-district fixture) mirror that district', city.rows.map(r => r.sales_all), q.rows.map(r => r.sales_all));
  const missing = snap2.query({ kind: 'timeseries', district: '中山區' });
  assert('timeseries: unknown district in the fixture → graceful empty + note, not a throw', missing.count === 0 && typeof missing.note === 'string', missing);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n=== envelope shape, unknown kind, size budget ===');
{
  const bad = snap.query({ kind: 'not_a_kind' });
  assert('unknown kind: count 0 and an error string, never throws', bad.count === 0 && typeof bad.error === 'string', bad);
  assert('query({}) with no kind at all does not throw', (() => { try { return snap.query({}).count === 0; } catch { return false; } })());
  assert('query(undefined) does not throw', (() => { try { snap.query(); return true; } catch { return false; } })());
  const top3 = snap.query({ kind: 'buildings', district: '信義區', top: 3 });
  assert('top: limits rows to 3 and sets truncated when more exist', top3.rows.length === 3 && top3.truncated === true, top3);
  for (const kind of ['buildings', 'mops', 'licenses', 'renewal', 'future', 'moves', 'zones', 'infra', 'parks', 'areas', 'districts']) {
    const size = JSON.stringify(snap.query({ kind, top: 12 })).length;
    assert(`size budget: kind=${kind} default call stays under ~4.2 KB`, size < 4300, size);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
