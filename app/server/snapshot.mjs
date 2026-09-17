// server/snapshot.mjs — Phase 9G snapshot-first data layer (docs/11-v2-cesium-app.md §16.6 follow-up).
// Owner's complaint: 「資料大部分要先有個快照在上面，不用每次都要去呼叫 tools」— today a question like「信義區最近一年上市
// 公司買了什麼」makes 5–15 FUNRAISE MCP round trips even though the answer already lives in public/data/peaklens.json.
// This module loads that snapshot (+ public/data/timeseries.json when the other agent building it has landed) ONCE at
// startup, builds a couple of small lookup indexes, and exposes query({kind,...}) so index.mjs's query_snapshot tool
// can answer from local memory instead of touching MCP. Every result is capped and compact (§ ~4 KB/call target) so
// feeding it back to the model doesn't itself become the token cost the owner is trying to avoid.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(here, '..'); // app/server → app/
const DEFAULT_DIR = path.join(APP_ROOT, 'public', 'data');
const KINDS = ['buildings', 'mops', 'licenses', 'renewal', 'future', 'moves', 'zones', 'infra', 'parks', 'areas', 'districts', 'timeseries', 'summary'];
const SERIES = ['sales_all', 'sales_office', 'licenses'];
// District names actually seen across peaklens.json's various address/district fields, plus a few 新北市 names the
// app already recognizes (agent.js ALIASES) — used only to pull a district out of free-text license/capital addresses.
const DISTRICT_RE = /(信義區|大安區|中山區|松山區|內湖區|南港區|中正區|萬華區|大同區|士林區|北投區|文山區|板橋區|新莊區|三重區|中和區|永和區|新店區|汐止區|土城區|蘆洲區|淡水區|林口區)/;

function readJSON(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
const norm = s => (s || '').toString().replace(/^台北市|^臺北市|^新北市/, '').replace(/區$/, '').toLowerCase();
const includesNorm = (hay, needle) => !needle || (hay || '').toLowerCase().includes(String(needle).toLowerCase());
const round = (n, d = 0) => n == null || isNaN(n) ? null : +(+n).toFixed(d);
const yearOf = s => { const m = /^(\d{4})/.exec(s || ''); return m ? +m[1] : null; }; // "2026-07-31" → 2026
const licenseYear = s => { s = String(s || ''); if (s.length < 5) return null; const roc = +s.slice(0, s.length - 4); return roc ? roc + 1911 : null; }; // "1141201" (民國114年12月01日) → 2025
const clampTop = top => Math.max(1, Math.min(50, +top || 12));
const dirMul = d => d === 'asc' ? 1 : -1;
const groupBy = (arr, fn) => { const m = new Map(); for (const it of arr || []) { const k = fn(it); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(it); } return m; };

// timeseries.json (produced by a concurrent data-build agent; no TIMESERIES_README.md yet) shape, confirmed against
// the real file: { meta:{ years:[2012..2026], ytd_year:2026, ... }, districts:["中正區",...12 Taipei districts...],
// sales_all: { "<district>": [15 numbers, index-aligned to meta.years] }, sales_office: {...}, licenses: {...},
// city: { sales_all:[15], sales_office:[15], licenses:[15] }, alltime: {...}, peaks: {...}, yoy: {...} }. We only need
// years/districts/sales_all/sales_office/licenses/city below — yoy and peak-year are RECOMPUTED here from the raw
// counts (not read from the file's own precomputed `yoy`/`peaks` blocks) so a district query and a city-totals query
// (which the file doesn't precompute yoy/peaks for at all) share identical math; spot-checked against the file's own
// `yoy` numbers and they match exactly, mod unit (file uses %, we use decimal fractions like every other *_yoy field
// in this module). Falls back to null (→ a graceful empty result, never a throw) if the file is missing or malformed.
function normalizeTimeseries(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.meta && raw.meta.years) || !raw.meta.years.length) return null;
  const years = raw.meta.years.map(Number); const idx = new Map(years.map((y, i) => [y, i]));
  const districts = raw.districts || Object.keys(raw.sales_all || {});
  if (!districts.length) return null;
  return { years, idx, ytdYear: raw.meta.ytd_year || null, districts, series: { sales_all: raw.sales_all || {}, sales_office: raw.sales_office || {}, licenses: raw.licenses || {} }, city: raw.city || {} };
}

export function createSnapshot({ dataDir } = {}) {
  const dir = dataDir || process.env.PEAKLENS_DATA_DIR || DEFAULT_DIR;
  const peak = readJSON(path.join(dir, 'peaklens.json')) || {};
  const timeseries = normalizeTimeseries(readJSON(path.join(dir, 'timeseries.json'))); // null when the file is missing or unparseable — callers get a graceful empty result, never a throw
  const DATE = ((peak.meta && (peak.meta.built_at || peak.meta.generated_at)) || '2026-09-14T00:00:00Z').slice(0, 10);
  const SOURCE = `快照 ${DATE}`;

  const buildings = peak.buildings || [], mops = peak.mops || [], licenses = peak.building_licenses || [], renewal = peak.urban_renewal || [], future = peak.future_dev || [], moves = peak.registry_moves || [], zones = peak.development_zones || [], infra = peak.public_infras || [], parks = peak.industrial_parks || [], areas = peak.business_areas || [], districts = peak.districts_analytics || [];
  const districtSales = (peak.district_sales && peak.district_sales['台北市']) || [];

  // ---- small indexes: district is an exact-match lookup (worth a Map); name/category stay substring scans since
  // these collections top out at ~200 rows — a linear .filter() over that is effectively instant, a trie would not
  // be "small". ----
  const byDistrict = {
    buildings: groupBy(buildings, b => norm(b.district)),
    mops: groupBy(mops, m => norm(m.district)),
    renewal: groupBy(renewal, u => norm(u.district)),
    future: groupBy(future, f => norm(f.district)),
    movesTo: groupBy(moves, m => norm(m.district)),
    movesFrom: groupBy(moves, m => norm(m.from_district)),
  };
  const byYear = { licenses: groupBy(licenses, l => licenseYear(l.issue_date)) };

  function rowsBuildings(q) {
    let out = q.district ? (byDistrict.buildings.get(norm(q.district)) || []) : buildings;
    if (q.grade) out = out.filter(b => (b.grade || '').toUpperCase() === String(q.grade).toUpperCase());
    if (q.name) out = out.filter(b => includesNorm(b.name, q.name));
    if (q.year) out = out.filter(b => yearOf(b.license_date) === +q.year);
    out = [...out].sort((a, b) => ((a.actual_rent_avg_ntd_per_ping ?? -1) - (b.actual_rent_avg_ntd_per_ping ?? -1)) * dirMul(q.sort || 'desc'));
    return out.map(b => ({ key: `stock:${b.id}`, id: b.id, name: b.name, district: b.district, grade: b.grade, floors: b.floor_above, year: yearOf(b.license_date), rent_avg: b.actual_rent_avg_ntd_per_ping ?? null, sale_avg: round(b.actual_sale_avg_ntd_per_ping), mrt: b.mrt && b.mrt[0] ? `${b.mrt[0].station_name} ${b.mrt[0].distance}m` : null }));
  }
  function rowsMops(q) {
    let out = q.district ? (byDistrict.mops.get(norm(q.district)) || []) : mops;
    if (q.since) { const s = new Date(q.since); out = out.filter(m => new Date(m.announcement_date) >= s); }
    if (q.min_price) out = out.filter(m => (m.total_price || 0) >= +q.min_price);
    out = [...out].sort((a, b) => ((a.total_price || 0) - (b.total_price || 0)) * dirMul(q.sort || 'desc'));
    return out.map(m => ({ key: `mops:${m.id}`, id: m.id, date: m.announcement_date, company: m.company_name, amount: m.total_price, buyer: m.buyer_name, buyer_type: m.buyer_type, seller: m.seller_name, seller_type: m.seller_type, district: m.district, product_type: m.product_type }));
  }
  function rowsLicenses(q) {
    let out = q.year ? (byYear.licenses.get(+q.year) || []) : licenses;
    if (q.district) out = out.filter(l => (l.address || l.first_address || '').includes(norm(q.district)));
    out = [...out].sort((a, b) => ((licenseYear(a.issue_date) || 0) - (licenseYear(b.issue_date) || 0)) * dirMul(q.sort || 'desc'));
    return out.map(l => { const dm = DISTRICT_RE.exec(l.address || l.first_address || ''); return { key: `license:${l.license_number}`, number: l.license_number, district: dm ? dm[1] : null, year: licenseYear(l.issue_date), type: l.construction_type, address: l.address || l.first_address }; });
  }
  function rowsRenewal(q) {
    let out = q.district ? (byDistrict.renewal.get(norm(q.district)) || []) : renewal;
    if (q.category) out = out.filter(u => includesNorm(u.category, q.category));
    out = [...out].sort((a, b) => ((a.area_sqm || 0) - (b.area_sqm || 0)) * dirMul(q.sort || 'desc'));
    return out.map(u => ({ key: `renewal:${u.id}`, id: u.id, name: u.name, code: u.code, district: u.district, category: u.category, area_sqm: round(u.area_sqm) }));
  }
  function rowsFuture(q) {
    let out = q.district ? (byDistrict.future.get(norm(q.district)) || []) : future;
    if (q.year) out = out.filter(f => (yearOf(f.completion_date) ?? 9999) <= +q.year); // cumulative "supply by year Y", matching agent.js's supply() semantics
    out = [...out].sort((a, b) => ((yearOf(a.completion_date) ?? 9999) - (yearOf(b.completion_date) ?? 9999)) * dirMul(q.sort || 'asc'));
    return out.map(f => ({ key: `future:${f.id}`, id: f.id, name: f.name, developer: f.developer, district: f.district, year: yearOf(f.completion_date), floors: f.floors_above }));
  }
  function rowsMoves(q) {
    let out = q.district ? (byDistrict.movesTo.get(norm(q.district)) || []) : (q.from ? (byDistrict.movesFrom.get(norm(q.from)) || []) : moves);
    if (q.district && q.from) out = out.filter(m => norm(m.from_district) === norm(q.from));
    if (q.since) { const s = new Date(q.since); out = out.filter(m => new Date(m.date) >= s); }
    out = [...out].sort((a, b) => (new Date(a.date || 0) - new Date(b.date || 0)) * dirMul(q.sort || 'desc'));
    return out.map(m => ({ key: `move:${m.uniform_number}`, company: m.company_name, uniform_number: m.uniform_number, date: m.date, from: m.from_district, to: m.district, scope: m.move_scope }));
  }
  function rowsZones(q) {
    let out = zones;
    if (q.name) out = out.filter(z => includesNorm(z.name, q.name));
    if (q.category) out = out.filter(z => includesNorm(z.category, q.category));
    return out.map(z => ({ key: `zone:${z.id}`, id: z.id, name: z.name, category: z.category, status: z.status, city: z.city }));
  }
  function rowsInfra(q) {
    let out = infra;
    if (q.name) out = out.filter(i => includesNorm(i.name, q.name));
    if (q.year) out = out.filter(i => i.completion_year === +q.year);
    out = [...out].sort((a, b) => ((a.completion_year ?? 9999) - (b.completion_year ?? 9999)) * dirMul(q.sort || 'asc'));
    return out.map(i => ({ key: `infra:${i.id}`, id: i.id, name: i.name, subcategory: i.subcategory, status: i.status, year: i.completion_year }));
  }
  function rowsParks(q) {
    let out = parks;
    if (q.name) out = out.filter(p => includesNorm(p.name, q.name));
    out = [...out].sort((a, b) => ((a.area_ha || 0) - (b.area_ha || 0)) * dirMul(q.sort || 'desc'));
    return out.map(p => ({ key: `ipark:${p.id}`, id: p.id, name: p.name, type: p.park_type, status: p.status, area_ha: p.area_ha, city: p.city }));
  }
  function rowsAreas(q) {
    let out = areas; if (q.name) out = out.filter(a => includesNorm(a.name, q.name));
    const seriesLimit = q.name ? 20 : 4; // unfiltered (list-all) calls trim quarterly history to stay near the size budget
    return out.map(a => ({ key: `heat:${a.id}`, id: a.id, name: (a.name || '').replace(/^台北市|^臺北市/, ''), company_total: a.company_total, growth: round(a.company_growth_rate, 2), rent_avg: a.market_price && a.market_price.actual_rent_avg, rent_yoy: a.market_price && round(a.market_price.actual_rent_yoy, 2), sale_avg: a.market_price && round(a.market_price.actual_sale_avg), sale_yoy: a.market_price && round(a.market_price.actual_sale_yoy, 2), top_industries: (a.top_industries || []).slice(0, 2).map(t => ({ name: t.name, pct: round(t.percentage, 2) })), rent_series: (a.rent_series || []).slice(-seriesLimit).map(s => ({ y: s.year, q: s.quarter, v: s.value })), sale_series: (a.sale_series || []).slice(-seriesLimit).map(s => ({ y: s.year, q: s.quarter, v: s.value })) }));
  }
  function rowsDistricts(q) {
    let out = districts; if (q.district) out = out.filter(d => norm(d.name) === norm(q.district));
    out = [...out].sort((a, b) => ((a.company_total || 0) - (b.company_total || 0)) * dirMul(q.sort || 'desc'));
    return out.map(d => { const dn = (d.name || '').replace(/^台北市|^臺北市/, ''); const ds = districtSales.find(x => x.district === dn); return { name: dn, company_total: d.company_total, growth: round(d.company_growth_rate, 2), rent_avg: d.market_price && d.market_price.actual_rent_avg, rent_yoy: d.market_price && round(d.market_price.actual_rent_yoy, 2), sale_avg: d.market_price && round(d.market_price.actual_sale_avg), sale_yoy: d.market_price && round(d.market_price.actual_sale_yoy, 2), building_stats: (d.building_stats || []).filter(g => g.count), top_industries: (d.top_industries || []).slice(0, 2).map(t => ({ name: t.name, pct: round(t.percentage, 2) })), transaction_count: ds && ds.transaction_count, median_price: ds && ds.median_price }; });
  }
  function rowsTimeseries(q) {
    if (!timeseries) return { rows: [], note: 'timeseries.json 尚未產生，暫無年度趨勢資料（改用 FUNRAISE MCP 或稍後再試）', peaks: null, scope: q.district || '全市' };
    let dn = null;
    if (q.district) { dn = timeseries.districts.find(x => norm(x) === norm(q.district)) || null; if (!dn) return { rows: [], note: `timeseries 沒有「${q.district}」的資料`, peaks: null, scope: q.district }; }
    const arrOf = s => dn ? timeseries.series[s][dn] : timeseries.city[s];
    let years = timeseries.years;
    if (q.year) years = years.filter(y => y === +q.year);
    if (q.since) { const sy = yearOf(q.since) || +String(q.since).slice(0, 4); if (sy) years = years.filter(y => y >= sy); }
    const rows = years.map(y => {
      const i = timeseries.idx.get(y); const row = { year: y };
      for (const s of SERIES) { const arr = arrOf(s); const cur = arr ? arr[i] ?? null : null; const pi = timeseries.idx.get(y - 1); const prev = (arr && pi != null) ? arr[pi] : null; row[s] = cur; row[`${s}_yoy`] = (cur != null && prev) ? round((cur - prev) / prev, 3) : null; }
      return row;
    });
    const peaks = {}; for (const s of SERIES) { const arr = arrOf(s); let best = null; if (arr) arr.forEach((v, i) => { if (v != null && (!best || v > best.value)) best = { year: timeseries.years[i], value: v }; }); peaks[s] = best; }
    const note = (timeseries.ytdYear && years.includes(timeseries.ytdYear)) ? `${timeseries.ytdYear} 為年初至今（YTD）資料，非全年度，與其他完整年度比較時請留意基期不同。` : undefined;
    return { rows, peaks, scope: dn || '全市', ...(note ? { note } : {}) };
  }
  function summaryRow() {
    const text = `本地快照（${SOURCE}）涵蓋台北市信義／大安／中山／松山／內湖／南港等區：商辦 ${buildings.length} 棟、上市櫃資產交易 ${mops.length} 筆、建照 ${licenses.length} 張、都更單元 ${renewal.length} 筆、重劃區 ${zones.length} 處、未來供給 ${future.length} 案、公共建設 ${infra.length} 項、產業園區 ${parks.length} 處、商圈 ${areas.length} 個（含季度租售序列與 YoY）、行政區統計 ${districts.length} 區、企業遷徙 ${moves.length} 筆${timeseries ? `，另有 ${timeseries.years[0]}–${timeseries.years[timeseries.years.length - 1]} 年年度成交／建照趨勢` : ''}。多數問題可直接用 query_snapshot 回答，不必呼叫 FUNRAISE MCP。`;
    return { text };
  }

  function query(q) {
    q = q || {}; const kind = q.kind; const top = clampTop(q.top); let rows, extra = {};
    switch (kind) {
      case 'buildings': rows = rowsBuildings(q); break;
      case 'mops': rows = rowsMops(q); break;
      case 'licenses': rows = rowsLicenses(q); break;
      case 'renewal': rows = rowsRenewal(q); break;
      case 'future': rows = rowsFuture(q); break;
      case 'moves': rows = rowsMoves(q); break;
      case 'zones': rows = rowsZones(q); break;
      case 'infra': rows = rowsInfra(q); break;
      case 'parks': rows = rowsParks(q); break;
      case 'areas': rows = rowsAreas(q); break;
      case 'districts': rows = rowsDistricts(q); break;
      case 'timeseries': { const r = rowsTimeseries(q); rows = r.rows; extra = { scope: r.scope, peaks: r.peaks, ...(r.note ? { note: r.note } : {}) }; break; }
      case 'summary': rows = [summaryRow()]; break;
      default: return { kind: kind || null, count: 0, rows: [], truncated: false, source: SOURCE, keys: [], error: `未知的 kind「${kind}」，可用：${KINDS.join('/')}` };
    }
    const count = rows.length; const clipped = rows.slice(0, top); const keys = clipped.map(r => r.key).filter(Boolean);
    return { kind, count, rows: clipped, truncated: count > clipped.length, source: SOURCE, keys, ...extra };
  }

  function describe() {
    return [
      `本地快照（${SOURCE}）涵蓋台北市信義／大安／中山／松山／內湖／南港（另有少量萬華／新北參考列）：`,
      `商辦 ${buildings.length} 棟、上市櫃資產交易（MOPS）${mops.length} 筆、建照 ${licenses.length} 張、都更單元 ${renewal.length} 筆（都更區位統計 ${((peak.urban_renewal_stats && peak.urban_renewal_stats.by_district) || []).length} 區）、重劃區 ${zones.length} 處、未來供給 ${future.length} 案、公共建設 ${infra.length} 項、產業園區 ${parks.length} 處、企業遷徙 ${moves.length} 筆、商圈 ${areas.length} 個（各含 2024–2026 季度租售序列與 YoY）、行政區統計 ${districts.length} 區（公司數／成長率／行情／商辦分布／產業結構）。`,
      timeseries ? `另有 timeseries：${timeseries.years[0]}–${timeseries.years[timeseries.years.length - 1]} 年台北市 12 個行政區與全市年度實價登錄成交量、辦公室成交量、建照量（含 YoY 與高峰年；${timeseries.ytdYear} 為年初至今 YTD，非全年度）。` : `timeseries.json 尚未產生：年度趨勢類問題目前答不了，之後補上或改用 FUNRAISE MCP。`,
      `用 query_snapshot({kind,district?,name?,year?,since?,top?,sort?,...}) 取得精簡列（≤ top，預設 12）與可 highlight／focus 的 keys；kind 涵蓋 ${KINDS.join('、')}。快照已涵蓋的問題不必呼叫 FUNRAISE MCP。`,
    ].join('\n');
  }

  const stats = { date: DATE, source: SOURCE, dataDir: dir, hasTimeseries: !!timeseries, counts: { buildings: buildings.length, mops: mops.length, licenses: licenses.length, renewal: renewal.length, zones: zones.length, future: future.length, infra: infra.length, parks: parks.length, areas: areas.length, districts: districts.length, moves: moves.length } };
  return { query, describe, stats };
}
