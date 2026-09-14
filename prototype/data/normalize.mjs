// Normalize the curated FUNRAISE MCP snapshot (+ supplements) into the engine's data contract.
//   node data/normalize.mjs   (run from prototype/)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const J = f => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'));
const raw = J('raw/taipei_demo.raw.json'), geo = J('raw/geocode_supplement.json'), poly = J('raw/polygons_supplement.json');
const PING = 3.305785;
const districtOf = s => { const m = (s || '').match(/(信義|大安|中山|松山|內湖|南港|中正|萬華|大同|士林|北投|文山|板橋|新莊|三重|中和|永和|新店|汐止|土城|蘆洲|淡水|林口)區?/); return m ? m[1] + '區' : null; };
const withGeo = (item, tbl, key) => { const g = tbl && tbl[key]; if (!g) return { ...item, geo_precision: item.lat ? (item.geo_precision || 'exact') : 'none' }; return { ...item, lon: item.lon ?? g[0], lat: item.lat ?? g[1], geo_precision: item.lat ? (item.geo_precision || 'exact') : (g[2] || 'address') }; };
const out = {};
out.meta = { ...raw.meta, area_unit: 'm²', normalized_at: new Date().toISOString(), tools_used: raw.meta.tools_used || raw.meta.tool_call_summary || raw.meta.tools || null,
  notes: ['buildings/mrt/urban_renewal polygons: exact API coordinates', 'building_licenses/mops: geocoded with land-info.coordinates_by_address (address) or area centroid (area_centroid)', 'future_dev: area_centroid approximations (no address in source) — demo only', 'registry_moves: after-address geocoded where available'] };
out.buildings = (raw.buildings || []).map(b => ({ ...b, rep_address: b.rep_address || b.address || null, mrt: b.mrt ? (Array.isArray(b.mrt) ? b.mrt : [b.mrt]) : [], district_short: districtOf(b.district) }));
out.tenants = {}; for (const [name, t] of Object.entries(raw.tenants || {})) { if (t && t.building_id) out.tenants[t.building_id] = (t.companies || []).map(c => ({ company: c.name, industry: c.industry, capital: c.capital })); }
const ur = raw.urban_renewal || {}; out.urban_renewal = (ur.items || []).map(u => { const rings = u.polygon ? [u.polygon] : (poly.urban_renewal_rings[u.id] || null); const m = poly.urban_renewal_meta[u.id] || {}; return { id: u.id, name: u.name, code: u.code, district: u.district, area_sqm: u.area_sqm, category: u.category, layer: u.layer || '中央及市府主導', designation_method: u.designation_method || null, announce_date: u.announce_date || m.announce_date || null, rings, geo_precision: rings ? 'exact' : 'none' }; });
out.urban_renewal_stats = { by_district: ur.aggregate_by_district_taipei || [], by_category: ur.aggregate_by_category_taipei || [] };
out.future_dev = (raw.future_dev || []).map(f => withGeo({ ...f, floors_below: Math.abs(f.floors_below || 0) }, geo.future_dev, f.id));
out.building_licenses = (raw.building_licenses || []).map(l => withGeo({ ...l, address: l.first_address || l.address }, geo.licenses, l.license_number));
out.mops = (raw.mops || []).map(m => withGeo(m, geo.mops, m.id));
out.development_zones = raw.development_zones || []; out.industrial_parks = raw.industrial_parks || []; out.mrt_stations = raw.mrt_stations || [];
out.public_infras = (raw.public_infras || []).map(p => { const x = withGeo(p, poly.public_infras, p.id); const line = (poly.public_infra_lines || {})[p.id]; if (line) { x.line = line; const mid = line[Math.floor(line.length / 2)]; x.lon = x.lon ?? mid[0]; x.lat = x.lat ?? mid[1]; x.geo_precision = 'exact'; } return x; });
const areaCentroid = name => { const bs = out.buildings.filter(b => b.lat && b.business_area === name); if (bs.length) return [bs.reduce((s, b) => s + b.lon, 0) / bs.length, bs.reduce((s, b) => s + b.lat, 0) / bs.length]; return geo.business_area_centroids[name] || { '台北市台北車站商圈': [121.5170, 25.0470], '台北市敦化南路商圈': [121.5490, 25.0400] }[name] || null; };
const normArea = a => { const c = areaCentroid(a.name); const mp = a.market_price || {}; return { ...a, lon: c ? c[0] : null, lat: c ? c[1] : null, market_price: { actual_rent_avg: mp.rent_avg ?? mp.actual_rent_avg, actual_rent_yoy: mp.rent_yoy ?? mp.actual_rent_yoy, actual_sale_avg: mp.sale_avg ?? mp.actual_sale_avg, actual_sale_yoy: mp.sale_yoy ?? mp.actual_sale_yoy }, company_stats: { total: a.company_total, growth_rate: a.company_growth_rate }, rent_series: (a.self_series && a.self_series.rent) || [], sale_series: (a.self_series && a.self_series.sale) || [] }; };
out.business_areas = (raw.business_areas || []).map(normArea); out.districts_analytics = (raw.districts || []).map(a => normArea({ ...a, lat: null }));
out.district_sales = {}; for (const [city, rows] of Object.entries(raw.district_sales || {})) out.district_sales[city] = rows.map(r => ({ district: r.district, transaction_count: r.count ?? r.transaction_count, avg_price: r.avg_price, median_price: r.median_price }));
const rm = raw.registry_moves || {}; out.registry_moves = (rm.cross_district_or_city_moves || []).map(m => withGeo({ ...m, district: districtOf(m.after), from_district: districtOf(m.before) }, geo.registry_moves, m.uniform_number));
out.capital_increases = (rm.large_capital_increases || []).map(m => withGeo(m, geo.capital_increases, m.uniform_number));
const st = raw.sample_transactions || {}; const rent = ((st.rentals || {}).records || []).map(r => ({ date: r.load_date, floor: r.floor, monthly_rent: r.monthly_rent_ntd, unit_rent: r.unit_rent_ntd_per_sqm ? Math.round(r.unit_rent_ntd_per_sqm * PING) : null, area_ping: r.area_sqm ? +(r.area_sqm / PING).toFixed(1) : null, building_type: r.building_type }));
const b101 = out.buildings.find(b => /101/.test(b.name)); const alt = poly.sales_alt;
out.sample_transactions = { items: [
  { name: '台北101', address: '臺北市信義區信義路五段7號', lon: b101 ? b101.lon : 121.5645, lat: b101 ? b101.lat : 25.0339, sales: [], sales_note: (st.sales || {}).note || '無個別單位買賣紀錄', rentals: rent, rentals_total: (st.rentals || {}).total_found || rent.length },
  alt ? { name: alt.name, address: alt.address, lon: alt.lon, lat: alt.lat, sales: alt.records.map(r => ({ date: r.date, floor: r.floor, total_price: r.total_price, unit_price: Math.round(r.unit_price_per_sqm * PING), area_ping: +(r.area_sqm / PING).toFixed(1), building_type: r.building_type })), rentals: [] } : null].filter(Boolean) };
const zs = raw.zoning_samples || {}; const land = zs.land_parcel_101 || Object.entries(zs).find(([k]) => k.startsWith('land_'))?.[1]; out.zoning_samples = (zs.zoning_samples || []).map(z => ({ ...z, land: (/101/.test(z.point_name || '') && land) ? (typeof land === 'string' ? land : [land.section_name || land.section || land.sect, land.land_number || land.landno || land.number].filter(Boolean).join(' ') || JSON.stringify(land).slice(0, 80)) : null }));
const ps = raw.providers_summary || {}; out.providers_summary = { total: ps.total_providers ?? ps.total ?? 39, by_category: ps.by_category || [] };
fs.writeFileSync(path.join(here, 'taipei_demo.json'), JSON.stringify(out));
const count = k => Array.isArray(out[k]) ? out[k].length : Object.keys(out[k] || {}).length; const geoOK = k => (out[k] || []).filter(x => x.lat).length;
console.log('normalized →', (fs.statSync(path.join(here, 'taipei_demo.json')).size / 1024).toFixed(0) + ' KB');
for (const k of ['buildings', 'future_dev', 'building_licenses', 'mops', 'public_infras', 'registry_moves', 'business_areas', 'development_zones', 'industrial_parks']) console.log(`  ${k}: ${count(k)} (with coords ${geoOK(k)})`);
console.log(`  urban_renewal: ${count('urban_renewal')} (with rings ${out.urban_renewal.filter(u => u.rings).length})`);
