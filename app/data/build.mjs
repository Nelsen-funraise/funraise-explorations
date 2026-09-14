// Merge the v1 normalized snapshot + expanded raw pulls + geocodes + polygons → public/data/peaklens.json
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '..');
const J = (p, fallback) => { const f = path.isAbsolute(p) ? p : path.join(here, p); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback; };
const v1 = J(path.join(root, '../prototype/data/taipei_demo.json'), {});
const rows = (f) => { const d = J('raw/' + f, null); if (!d) return []; return d.rows.map(r => Object.fromEntries(d._fields.map((k, i) => [k, r[i]]))); };
const geoA = J('raw/geo_a.json', {}), geoB = J('raw/geo_b.json', {}), polys = J('raw/renewal_polys.json', {});
const districtOf = s => { const m = (s || '').match(/(信義|大安|中山|松山|內湖|南港|中正|萬華|大同|士林|北投|文山|板橋|新莊|三重|中和|永和|新店|汐止|土城|蘆洲|淡水|林口)區?/); return m ? m[1] + '區' : null; };
const photoUrl = p => p ? 'https://images.pickpeak.ai/?size=thumb&path=' + encodeURIComponent(p) : null;
const out = {}; const stats = {};
// buildings
const bmap = new Map(); for (const b of v1.buildings || []) bmap.set(b.id, { ...b, district: districtOf(b.district) || b.district });
for (const r of rows('buildings_extra.json')) { if (bmap.has(r.id)) continue; const g = geoA['b:' + r.id]; bmap.set(r.id, { id: r.id, name: r.name, rep_address: r.addr, grade: r.grade, floor_above: r.fa, floor_below: r.fb, total_floor_area: r.area_m2, license_date: r.license_date, business_area: r.business_area ? '台北市' + r.business_area : null, usage_types: (r.usage || '').split(',').filter(Boolean), certifications: (r.certs || '').split(';').filter(Boolean).map(s => { const m = s.match(/^(EEWH綠建築|EEWH|LEED|WELL|智慧建築)(.*)$/); return m ? { type: m[1] === 'EEWH' ? 'EEWH綠建築' : m[1], grade: m[2] } : { type: s, grade: '' }; }), mrt: r.mrt ? [{ station_name: r.mrt, distance: r.mrt_m }] : [], photo_thumb: photoUrl(r.photo), district: districtOf(r.addr), lon: g ? g[0] : null, lat: g ? g[1] : null, geo_precision: g ? 'address' : 'none' }); }
out.buildings = [...bmap.values()]; stats.buildings = out.buildings.filter(b => b.lat).length + '/' + out.buildings.length;
// mops
const mmap = new Map(); for (const m of v1.mops || []) mmap.set(m.id, m);
for (const r of rows('mops_extra.json')) { if (mmap.has(r.id)) continue; const g = r.geo_hint || geoA['m:' + r.id]; mmap.set(r.id, { id: r.id, announcement_date: r.date, company_name: r.company, company_id: r.cid, industry: r.industry, product_type: r.type, property_name: r.name, building_address: r.addr, district: r.district, land_area_ping: r.land_ping, building_area_ping: r.bldg_ping, total_price: r.price, buyer_name: r.buyer, buyer_type: r.buyer_type, seller_name: r.seller, seller_type: r.seller_type, lon: g ? g[0] : null, lat: g ? g[1] : null, geo_precision: r.geo_hint ? 'area_centroid' : (g ? 'address' : 'none') }); }
out.mops = [...mmap.values()].filter(m => m.total_price > 0 || /都更|地號/.test(m.property_name || '')); stats.mops = out.mops.filter(m => m.lat).length + '/' + out.mops.length;
// licenses
const lmap = new Map(); for (const l of v1.building_licenses || []) lmap.set(l.license_number, l);
for (const r of rows('licenses_extra.json')) { if (lmap.has(r.n)) continue; const g = geoB['l:' + r.n]; lmap.set(r.n, { license_number: r.n, issue_date: r.d, construction_type: r.t, address: r.addr, designer: r.designer, developer_masked: r.dev, lon: g ? g[0] : null, lat: g ? g[1] : null, geo_precision: g ? (/號/.test(r.addr) ? 'address' : 'road') : 'none' }); }
out.building_licenses = [...lmap.values()]; stats.licenses = out.building_licenses.filter(l => l.lat).length + '/' + out.building_licenses.length;
// moves
const vmap = new Map(); for (const m of v1.registry_moves || []) vmap.set(m.uniform_number, m);
for (const r of rows('moves_extra.json')) { if (vmap.has(r.uniform_number)) continue; const g = geoB['v:' + r.uniform_number]; vmap.set(r.uniform_number, { uniform_number: r.uniform_number, company_name: r.company_name, date: r.date, before: r.before, after: r.after, move_scope: /臺北市|台北市/.test(r.before) ? 'cross_district' : 'cross_city', district: districtOf(r.after), from_district: districtOf(r.before), lon: g ? g[0] : null, lat: g ? g[1] : null, geo_precision: g ? 'address' : 'none' }); }
out.registry_moves = [...vmap.values()]; stats.moves = out.registry_moves.filter(m => m.lat).length + '/' + out.registry_moves.length;
// urban renewal
const umap = new Map(); for (const u of v1.urban_renewal || []) umap.set(u.id, u);
for (const r of rows('renewal_index.json')) { if (umap.has(r.id)) continue; const p = polys[r.id]; umap.set(r.id, { id: r.id, name: r.name, code: r.code, district: r.district, area_sqm: r.area_sqm, category: r.category, layer: r.layer, designation_method: r.designation, announce_date: r.date || (p && p.announce_date) || null, rings: p ? p.rings : null, geo_precision: p ? 'exact' : 'none' }); }
out.urban_renewal = [...umap.values()]; stats.renewal = out.urban_renewal.filter(u => u.rings).length + '/' + out.urban_renewal.length;
out.urban_renewal_stats = v1.urban_renewal_stats || {};
// zones (all Taipei)
out.development_zones = rows('zones_all.json').filter(z => z.lat).map(z => ({ ...z, city: '臺北市' })); stats.zones = out.development_zones.length;
// passthrough
for (const k of ['future_dev', 'public_infras', 'industrial_parks', 'business_areas', 'districts_analytics', 'district_sales', 'tenants', 'sample_transactions', 'zoning_samples', 'providers_summary', 'capital_increases', 'mrt_stations']) out[k] = v1[k] || (Array.isArray(v1[k]) ? [] : {});
out.meta = { ...(v1.meta || {}), built_at: new Date().toISOString(), counts: stats, source: 'FUNRAISE MCP (Funraise Data Team) snapshot 2026-09-14 + expanded pulls', notes: ['buildings: exact (get_building) or address geocode', 'future_dev: area_centroid approximations', 'licenses/mops/moves: address geocode; road-only addresses approximate'] };
const parcelsFile = path.join(root, 'data/raw/parcels.json');
if (fs.existsSync(parcelsFile)) { try { const pj = JSON.parse(fs.readFileSync(parcelsFile, 'utf8')); out.parcels = { generated_at: pj.generated_at, source: pj.source, units: pj.units || {} }; stats.parcel_units = Object.keys(out.parcels.units).length; stats.parcels = Object.values(out.parcels.units).reduce((n, u) => n + (u.parcels || []).length, 0); } catch (e) { console.warn('parcels.json unreadable', e.message); } }
fs.mkdirSync(path.join(root, 'public/data'), { recursive: true });
fs.writeFileSync(path.join(root, 'public/data/peaklens.json'), JSON.stringify(out));
console.log('peaklens.json', (fs.statSync(path.join(root, 'public/data/peaklens.json')).size / 1024).toFixed(0) + ' KB', JSON.stringify(stats));
