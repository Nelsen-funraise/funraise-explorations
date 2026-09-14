// PeakLens v2 — HUD wiring: lenses, layers, camera modes, sensors, basemaps, timeline, inspector, transcript, voice, scenes.
import { LAYERS, fmtInt, fmtMoney } from './layers/funraise.js';
import { LENSES } from './agent/agent.js';
import { BASEMAPS } from './viewer.js';
import { SCENES } from './scenes.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const escapeHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtDist = m => m >= 1000 ? (m / 1000).toFixed(m >= 100000 ? 0 : 1) + ' km' : Math.round(m) + ' m';
const KEY_OF = { stock: it => 'stock:' + it.id, future: it => 'future:' + it.id, renewal: it => 'renewal:' + it.id, mops: it => 'mops:' + it.id, infra: it => 'infra:' + it.id, parks: it => 'ipark:' + it.id, zones: it => 'zone:' + it.id, heat: it => 'heat:' + it.id, mrt: it => 'mrt:' + it.name, licenses: it => 'license:' + it.license_number, moves: it => 'move:' + it.uniform_number };
const USAGE = { office: '辦公', hotel: '旅館', house: '住宅', store: '零售', parking: '停車', others: '其他' };

export function createUI({ map, data, basemap, layers, timeline, sensors, viewerApi, cameraMode }) {
  const ui = { tts: true, claudeMode: false, sceneId: null };
  let agent = null, claude = null, director = null;
  const meta = data.meta || {};

  /* ---- dispatch ---- */
  const cmd = $('#cmd');
  const say = text => { text = (text || '').trim(); if (!text) return; cmd.value = ''; if (ui.claudeMode && claude) claude.handle(text); else if (agent) agent.handle(text); };
  ui.say = say;
  ui.attach = r => { agent = r.agent; claude = r.claude; director = r.director; renderSuggest(agent.lens); };

  /* ---- clock & status ---- */
  const tick = () => { $('#clock').textContent = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()) + ' TPE'; }; tick(); setInterval(tick, 1000);
  $('#datastamp').textContent = meta.generated_at ? '資料快照 ' + String(meta.generated_at).slice(0, 10) : '示範資料';
  ui.setMcpStatus = t => { $('#mcpstat').textContent = t; };
  ui.setMcpStatus('FUNRAISE MCP · 快照');

  /* ---- lenses ---- */
  const lensBox = $('#lenses');
  for (const [id, L] of Object.entries(LENSES)) { const b = el('button', 'lens-btn', `<span class="dot" style="--c:${L.color}"></span>${L.name}`); b.dataset.lens = id; b.setAttribute('aria-pressed', 'false'); b.title = L.who; b.onclick = () => { agent && agent.setLens(id); toast(`${L.name} · ${L.who}`); }; lensBox.appendChild(b); }
  ui.applyLens = id => {
    const L = LENSES[id]; if (!L) return;
    lensBox.querySelectorAll('.lens-btn').forEach(b => { const on = b.dataset.lens === id; b.setAttribute('aria-pressed', on); const dot = b.querySelector('.dot'); dot.style.background = on ? L.color : ''; dot.style.boxShadow = on ? `0 0 8px ${L.color}` : ''; });
    document.documentElement.style.setProperty('--accent', L.color);
    for (const k of Object.keys(LAYERS)) ui.setLayer(k, L.layers.includes(k) || k === 'mrt');
    renderSuggest(id); renderLensKPIs(id); $('#readout .eyebrow').textContent = `${L.name} · LENS`;
  };

  /* ---- layers ---- */
  const list = $('#layers'); const visible = new Set(Object.keys(LAYERS));
  const counts = { stock: (data.buildings || []).length, future: (data.future_dev || []).length, licenses: (data.building_licenses || []).length, renewal: (data.urban_renewal || []).length, zones: (data.development_zones || []).length, mops: (data.mops || []).length, moves: (data.registry_moves || []).length, infra: (data.public_infras || []).length, parks: (data.industrial_parks || []).length, heat: (data.business_areas || []).length, mrt: (basemap.mrt_stations || []).length };
  for (const [k, L] of Object.entries(LAYERS)) { const b = el('button', 'layer', `<span class="sw ${L.glyph}" style="background:${L.color};color:${L.color}"></span><span class="lbl">${L.name}</span><span class="cnt">${counts[k] || ''}</span>`); b.dataset.layer = k; b.title = L.desc; b.setAttribute('aria-pressed', 'true'); b.onclick = () => ui.setLayer(k, !visible.has(k)); list.appendChild(b); }
  ui.setLayer = (k, on) => { if (!LAYERS[k]) return; if (on) visible.add(k); else visible.delete(k); layers.setVisible(k, !!on); const b = list.querySelector(`[data-layer="${k}"]`); if (b) b.setAttribute('aria-pressed', !!on); };
  ui.visibleLayers = () => [...visible];

  /* ---- camera modes ---- */
  const MODES = { city: '俯視', orbit: '環繞', street: '街景', globe: '全台', timelapse: '時光' }; const mbox = $('#modes');
  ui.setMode = m => { mbox.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m)); if (m === 'timelapse') timeline.startLapse({ from: 2012, to: 2030, stepMs: reduce ? 1200 : 700, onDone: () => ui.setMode('city') }); else timeline.stopLapse(); };
  ui.userMode = m => { cameraMode(m); ui.setMode(m); };
  for (const [m, n] of Object.entries(MODES)) { const b = el('button', null, n); b.dataset.mode = m; b.setAttribute('aria-pressed', m === 'city'); b.onclick = () => ui.userMode(m); mbox.appendChild(b); }

  /* ---- sensors ---- */
  const SENSORS = { normal: '一般', night: '夜視', thermal: '熱感', blueprint: '藍圖' }; const sbox = $('#sensors');
  ui.setSensor = s => { s = sensors.set(s); $('#stage').className = 'sensor-' + s; sbox.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.sensor === s)); };
  for (const [s, n] of Object.entries(SENSORS)) { const b = el('button', null, n); b.dataset.sensor = s; b.setAttribute('aria-pressed', s === 'normal'); b.onclick = () => ui.setSensor(s); sbox.appendChild(b); }

  /* ---- basemaps & night ---- */
  const bbox = $('#basemaps'); let night = true;
  for (const [k, B] of Object.entries(BASEMAPS)) { const b = el('button', null, k === 'osm' ? 'OSM' : B.name.split('（')[0]); b.dataset.base = k; b.title = B.name; b.setAttribute('aria-pressed', k === viewerApi.basemapKey); b.onclick = () => ui.setBasemap(k); bbox.appendChild(b); }
  const nb = el('button', null, '🌙 夜'); nb.title = '夜間色調／日間影像'; nb.setAttribute('aria-pressed', 'true'); nb.onclick = () => ui.setNight(!night); bbox.appendChild(nb);
  ui.setBasemap = k => { viewerApi.setBasemap(k); bbox.querySelectorAll('[data-base]').forEach(b => b.setAttribute('aria-pressed', b.dataset.base === k)); };
  ui.setNight = on => { night = !!on; viewerApi.setNight(night); nb.setAttribute('aria-pressed', night); nb.textContent = night ? '🌙 夜' : '☀️ 日'; };
  ui.cycleBasemap = () => { const ks = Object.keys(BASEMAPS); ui.setBasemap(ks[(ks.indexOf(viewerApi.basemapKey) + 1) % ks.length]); };

  /* ---- timeline ---- */
  const yr = $('#year'), yl = $('#yearlbl');
  yr.oninput = () => { timeline.stopLapse(); map.setYear(+yr.value); };
  timeline.onChange(y => { yr.value = y; yl.textContent = y; updateReadout(); });
  yr.value = timeline.year; yl.textContent = timeline.year;

  /* ---- readout ---- */
  const rLine = $('#readout .line'), rCoords = $('#readout .coords'); let lastReadout = 0;
  function updateReadout(force) {
    const now = performance.now(); if (!force && now - lastReadout < 250) return; lastReadout = now;
    try { const c = map.center(); const d = map.districtAtCamera(); const n = map.countInView(); const parts = [d ? d.name : (c.height > 200000 ? '台灣' : '雙北')];
      if (n.stock) parts.push(`商辦 ${n.stock}`); if (n.future) parts.push(`規劃中 ${n.future}`); if (n.renewal) parts.push(`都更 ${n.renewal}`); if (n.mops) parts.push(`法人交易 ${n.mops}`); if (n.infra) parts.push(`公建 ${n.infra}`); if (map.year !== new Date().getFullYear()) parts.push(`${map.year} 年`);
      rLine.textContent = parts.join(' · '); rCoords.textContent = `${c.lat.toFixed(4)}N ${c.lon.toFixed(4)}E · ${fmtDist(c.height)} · ${Math.round(map.pitch)}° · ${Math.round(((map.heading % 360) + 360) % 360)}°`; } catch (e) { /* camera not ready */ }
  }
  ui.updateReadout = updateReadout;

  /* ---- inspector: lens KPIs ---- */
  const lensKPIs = $('#lens-kpis'); const kpiHtml = (v, l, cls) => `<div class="kpi ${cls || ''}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  function renderLensKPIs(id) {
    const k = []; const ds = (data.district_sales && data.district_sales['台北市']) || []; const mops = data.mops || []; const vol12 = mops.reduce((s, m) => s + (m.total_price || 0), 0); const areas = data.business_areas || [];
    const rents = areas.filter(a => a.market_price).map(a => a.market_price.actual_rent_avg); const avgRent = rents.length ? rents.reduce((a, b) => a + b, 0) / rents.length : 0;
    const yields = areas.filter(a => a.market_price && a.market_price.actual_sale_avg).map(a => a.market_price.actual_rent_avg * 12 / a.market_price.actual_sale_avg); const yld = yields.length ? yields.reduce((a, b) => a + b, 0) / yields.length : 0;
    const ren = (data.urban_renewal_stats && data.urban_renewal_stats.by_district) || []; const renTotal = ren.reduce((s, r) => s + (r.count || 0), 0); const infra = data.public_infras || []; const moves = data.registry_moves || [];
    if (id === 'investor') k.push(kpiHtml(fmtMoney(vol12), '上市櫃不動產交易額 · 近 12 月 · 台北市'), kpiHtml(mops.length, '公告筆數（快照）'), kpiHtml((yld * 100).toFixed(2) + '<small>%</small>', '商辦毛租金收益率（商圈均值）'), kpiHtml(fmtInt(avgRent) + '<small>元/坪/月</small>', '商圈平均租金'));
    if (id === 'developer') k.push(kpiHtml(fmtInt(renTotal), '台北市都更地區／單元'), kpiHtml((data.building_licenses || []).length, '114–115 年建照（快照）'), kpiHtml((data.future_dev || []).length, '規劃／興建中案（快照）'), kpiHtml((data.development_zones || []).length, '重劃／區段徵收（北市）'));
    if (id === 'occupier') k.push(kpiHtml((data.buildings || []).length, '商辦（快照）'), kpiHtml(fmtInt(avgRent) + '<small>元/坪/月</small>', '商圈平均租金'), kpiHtml((basemap.mrt_stations || []).length, '捷運站'), kpiHtml((data.providers_summary && data.providers_summary.total) || 39, '生態系服務商'));
    if (id === 'city') k.push(kpiHtml(infra.filter(i => i.status === 'constructing').length, '興建中公共建設'), kpiHtml(moves.length, '跨區遷入企業 · 2026-07（快照）'), kpiHtml(fmtInt(renTotal), '都更地區／單元'), kpiHtml((data.industrial_parks || []).length, '產業園區（雙北）'));
    if (id === 'research') { const tot = ds.reduce((s, d) => s + d.transaction_count, 0); k.push(kpiHtml(fmtInt(tot), '台北市實價登錄成交（2012–）'), kpiHtml('477<small>萬</small>', '全國實價登錄筆數'), kpiHtml(ds.length, '行政區'), kpiHtml('2012→2030', '時間軸')); }
    lensKPIs.innerHTML = k.join(''); $('#lens-who').textContent = LENSES[id].who; $('#lens-title').textContent = LENSES[id].name;
  }

  /* ---- inspector: selection ---- */
  const sel = $('#selection');
  const row = (k, v) => v == null || v === '' || v === 'null' ? '' : `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const precision = p => p === 'area_centroid' ? '約略（區域中心）' : p === 'address' ? '地址定位' : p === 'exact' ? '精確' : p;
  ui.select = (item, layer) => { map.selected = item ? { key: (KEY_OF[layer] || (it => layer + ':' + it.id))(item), item, layer } : null; renderSelection(item, layer); if (item && innerWidth < 820) document.body.classList.add('show-inspector'); };
  function renderSelection(it, layer) {
    if (!it) { sel.innerHTML = ''; sel.classList.add('hidden'); return; } sel.classList.remove('hidden'); let h = '';
    const title = it.name || it.company_name || it.license_number || '—'; const L = LAYERS[layer] || { name: layer, color: 'var(--ink-3)' };
    h += `<div class="eyebrow" style="color:${L.color}">${L.name}</div><h3>${escapeHtml(title)}</h3>`;
    if (layer === 'stock') { h += it.photo_thumb ? `<img class="thumb" alt="${escapeHtml(title)} 外觀" src="${it.photo_thumb}" loading="lazy" onerror="this.remove()">` : '';
      h += `<div class="rows">${row('地址', it.rep_address || it.address)}${row('等級', it.grade ? it.grade + ' 級' : null)}${row('樓層', `${it.floor_above || '?'}F / B${it.floor_below || '?'}`)}${row('總樓地板', it.total_floor_area ? fmtInt(it.total_floor_area) + ' m²' : null)}${row('使照', it.license_date)}${row('用途', (it.usage_types || []).join('、'))}${row('認證', (it.certifications || []).map(c => c.type + (c.grade ? '·' + c.grade : '')).join('、'))}${(it.mrt || []).slice(0, 2).map(m => row('捷運', `${m.station_name || m.station} ${m.exit || ''} ${m.distance} m`)).join('')}${row('商圈', it.business_area && (it.business_area.name || it.business_area))}${row('實價租金', it.actual_rent_avg_ntd_per_ping ? `均 ${fmtInt(it.actual_rent_avg_ntd_per_ping)} 元/坪/月 · ${it.actual_rent_count || 0} 筆` : null)}${row('實價買賣', it.actual_sale_avg_ntd_per_ping ? `均 ${fmtInt(it.actual_sale_avg_ntd_per_ping / 1e4)} 萬/坪 · ${it.actual_sale_count || 0} 筆` : null)}</div>`;
      h += `<div class="chips"><button class="chip" data-say="${escapeHtml(title)}的租戶是誰">租戶</button><button class="chip" data-say="這裡容積率多少">容積率</button><button class="chip" data-say="${escapeHtml(title)}的歷史成交">歷史成交</button><button class="chip" data-say="幫我做這棟的 DD memo">DD memo</button><button class="chip" data-say="環繞模式 ${escapeHtml(title)}">環繞</button><button class="chip" data-say="街景模式 ${escapeHtml(title)}">街景</button></div>`; }
    if (layer === 'future') { const mix = Object.entries(it.usage_mix || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${USAGE[k] || k} ${Math.round(v * 100)}%`).join('、'); h += `<div class="rows">${row('開發商', it.developer)}${row('完工', it.completion_date)}${row('樓層', `${it.floors_above || '?'}F / B${it.floors_below || '?'}`)}${row('標準層', it.max_floor_area ? fmtInt(it.max_floor_area) + ' m²' : null)}${row('用途', mix)}${row('商圈', it.business_area)}${row('定位', precision(it.geo_precision))}</div><div class="chips"><button class="chip" data-say="回到 ${it._year || 2028} 年">看 ${it._year || 2028} 年</button></div>`; }
    if (layer === 'renewal') h += `<div class="rows">${row('編號', it.code)}${row('類別', it.category)}${row('圖層', it.layer)}${row('劃定', it.designation_method)}${row('面積', it.area_sqm ? fmtInt(it.area_sqm) + ' m²（' + fmtInt(it.area_sqm / 3.3058) + ' 坪）' : null)}${row('公告', it.announce_date)}${row('行政區', it.district)}</div>`;
    if (layer === 'mops') h += `<div class="rows">${row('公告日', it.announcement_date)}${row('公司', `${it.company_name} (${it.company_id})`)}${row('產業', it.industry)}${row('類型', it.product_type)}${row('標的', it.property_name)}${row('地址', it.building_address)}${row('土地', it.land_area_ping ? fmtInt(it.land_area_ping) + ' 坪' : null)}${row('建物', it.building_area_ping ? fmtInt(it.building_area_ping) + ' 坪' : null)}${row('金額', fmtMoney(it.total_price) + ' 元')}${row('買方', `${it.buyer_name || ''}（${it.buyer_type || ''}）`)}${row('賣方', `${it.seller_name || ''}（${it.seller_type || ''}）`)}${row('定位', precision(it.geo_precision))}</div>`;
    if (layer === 'infra') h += `<div class="rows">${row('類別', it.subcategory)}${row('狀態', it.status === 'constructing' ? '興建中' : '規劃中')}${row('完工年', it.completion_year)}</div>`;
    if (layer === 'parks') h += `<div class="rows">${row('類型', it.park_type)}${row('法令', it.legal_basis)}${row('狀態', it.status)}${row('面積', it.area_ha + ' 公頃')}${row('主管', it.manager)}</div><div class="chips"><button class="chip" data-say="帶我去${escapeHtml(title)}">飛過去</button></div>`;
    if (layer === 'zones') h += `<div class="rows">${row('類別', it.category)}${row('狀態', it.status)}${row('城市', it.city)}</div>`;
    if (layer === 'licenses') h += `<div class="rows">${row('證號', it.license_number)}${row('發照', it.issue_date)}${row('類型', it.construction_type)}${row('地址', it.address || it.first_address)}${row('設計人', it.designer)}${row('起造人', it.developer_masked ? it.developer_masked + '（來源遮罩）' : null)}</div>`;
    if (layer === 'moves') h += `<div class="rows">${row('統編', it.uniform_number)}${row('日期', it.date)}${row('原址', it.before)}${row('新址', it.after)}${row('範圍', it.move_scope === 'cross_district' ? '跨區' : it.move_scope)}</div>`;
    if (layer === 'heat') { const mp = it.market_price || {}; h += `<div class="meta">${escapeHtml(it.pp_insight || it.description || '')}</div><div class="kpis">${kpiHtml(fmtInt(mp.actual_rent_avg) + '<small>元/坪/月</small>', '平均租金 · YoY ' + ((mp.actual_rent_yoy || 0) * 100).toFixed(1) + '%', mp.actual_rent_yoy >= 0 ? 'up' : 'down')}${kpiHtml(fmtInt((mp.actual_sale_avg || 0) / 1e4) + '<small>萬/坪</small>', '平均售價 · YoY ' + ((mp.actual_sale_yoy || 0) * 100).toFixed(1) + '%', mp.actual_sale_yoy >= 0 ? 'up' : 'down')}${kpiHtml(fmtInt((it.company_stats || {}).total || it.company_total || 0), '企業數 · 成長 ' + (((it.company_stats || {}).growth_rate ?? it.company_growth_rate ?? 0) * 100).toFixed(0) + '%')}${kpiHtml((it.building_stats || []).filter(b => b.grade === 'A').map(b => b.count)[0] ?? '—', 'A 辦棟數')}</div>`; const ser = it.rent_series || []; if (ser.length >= 3) h += sparkSVG('租金季線（元/坪/月）', ser.map(s => ({ t: `${s.year}Q${s.quarter}`, v: s.value }))); }
    if (layer === 'mrt') h += `<div class="rows">${row('路線', (it.lines || []).join('、'))}</div><div class="chips"><button class="chip" data-say="帶我去${escapeHtml(it.name)}">500m 內商辦</button></div>`;
    sel.innerHTML = h; sel.querySelectorAll('[data-say]').forEach(b => b.onclick = () => say(b.dataset.say));
  }

  /* ---- charts ---- */
  function sparkSVG(title, pts) { const w = 280, h = 56, p = 6; const vs = pts.map(x => x.v); const min = Math.min(...vs), max = Math.max(...vs); const X = i => p + i * (w - 2 * p) / Math.max(1, pts.length - 1), Y = v => h - p - (v - min) / ((max - min) || 1) * (h - 2 * p); const d = pts.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x.v).toFixed(1)}`).join(' '); const last = pts[pts.length - 1]; return `<div class="eyebrow">${title} · ${pts[0].t}–${last.t}</div><svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}"><path d="${d} L${X(pts.length - 1).toFixed(1)},${h - p} L${p},${h - p} Z" fill="rgba(201,142,44,.15)"/><path d="${d}" fill="none" stroke="#C98E2C" stroke-width="2"/><circle cx="${X(pts.length - 1).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="3.5" fill="#F2B84B" stroke="#0B1222" stroke-width="2"/><text x="${w - p}" y="${Math.max(10, Y(last.v) - 8)}" text-anchor="end" font-size="10" font-family="IBM Plex Mono, monospace" fill="#E9EFFA">${fmtInt(last.v)}</text><text x="${p}" y="${h - 1}" font-size="9" font-family="IBM Plex Mono, monospace" fill="#66789A">${fmtInt(min)}–${fmtInt(max)}</text></svg>`; }
  ui.showSpark = (title, pts) => { const box = $('#analysis'); box.innerHTML = sparkSVG(title, pts); box.classList.remove('hidden'); };
  ui.showBars = (title, rows, color) => { const box = $('#analysis'); rows = (rows || []).filter(r => r && r.v != null); const max = Math.max(...rows.map(r => +r.v || 0)) || 1; box.innerHTML = `<div class="eyebrow">${escapeHtml(title)}</div><div class="bars">${rows.map(r => `<div class="bar"><span class="k" title="${escapeHtml(r.k)}">${escapeHtml(r.k)}</span><span class="t"><i style="width:${((+r.v || 0) / max * 100).toFixed(1)}%;background:${color || 'var(--ch-1)'}"></i></span><span class="v">${r.label != null ? escapeHtml(r.label) : fmtInt(r.v)}</span></div>`).join('')}</div>`; box.classList.remove('hidden'); if (innerWidth < 820) document.body.classList.add('show-inspector'); };

  /* ---- transcript & tool cards ---- */
  const tr = $('#transcript');
  ui.userTurn = text => { const t = el('div', 'turn user', `<div class="who">你</div><div class="body">${escapeHtml(text)}</div>`); tr.appendChild(t); tr.scrollTop = tr.scrollHeight; return t; };
  ui.agentTurn = () => { const t = el('div', 'turn agent', `<div class="who">睿鏡${ui.claudeMode ? ' · Claude' : ''}</div><div class="body"><div class="tools"></div><div class="answer caret"></div></div>`); tr.appendChild(t); tr.scrollTop = tr.scrollHeight; return t; };
  ui.toolStart = (turn, name, params) => { const p = Object.entries(params || {}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${typeof v === 'string' ? '"' + v + '"' : JSON.stringify(v)}`).join(', '); const c = el('div', 'tool run', `<span class="st"></span><span class="name"><b>${escapeHtml(name)}</b> (${escapeHtml(p.length > 160 ? p.slice(0, 160) + '…' : p)})</span><span class="res">…</span>`); turn.querySelector('.tools').appendChild(c); tr.scrollTop = tr.scrollHeight; c._t0 = performance.now(); return c; };
  ui.toolDone = (card, summary) => { card.classList.remove('run'); card.classList.add('ok'); card.querySelector('.res').textContent = `${summary} · ${Math.round(performance.now() - card._t0)} ms`; };
  ui.type = async (turn, text) => { const ans = turn.querySelector('.answer'); const spd = reduce ? 0 : 8; if (!spd) ans.textContent = text; else { for (let i = 0; i <= text.length; i += 3) { ans.textContent = text.slice(0, i); tr.scrollTop = tr.scrollHeight; await new Promise(r => setTimeout(r, spd)); } ans.textContent = text; } ans.classList.remove('caret'); if (ui.tts && !ui.sceneId) speak(text.split('\n')[0]); tr.scrollTop = tr.scrollHeight; };

  /* ---- command bar, suggestions ---- */
  $('#send').onclick = () => say(cmd.value); cmd.addEventListener('keydown', e => { if (e.key === 'Enter') say(cmd.value); });
  function renderSuggest(id) { const box = $('#suggest'); box.innerHTML = ''; for (const s of (LENSES[id] || LENSES.occupier).suggest) { const b = el('button', 'chip', s); b.onclick = () => say(s); box.appendChild(b); } }

  /* ---- speech in / out ---- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const mic = $('#mic'); let rec = null;
  if (!SR) mic.title = '此瀏覽器不支援語音辨識，請改用輸入框';
  mic.onclick = () => { if (!SR) { toast('此瀏覽器不支援語音辨識（Chrome／Edge 可用），請直接輸入'); cmd.focus(); return; } if (rec) { rec.stop(); return; } try { rec = new SR(); rec.lang = 'zh-TW'; rec.interimResults = true; rec.onresult = e => { const t = Array.from(e.results).map(r => r[0].transcript).join(''); cmd.value = t; if (e.results[e.results.length - 1].isFinal) say(t); }; rec.onend = () => { rec = null; mic.classList.remove('listening'); }; rec.onerror = ev => { toast('語音辨識無法使用：' + (ev.error === 'not-allowed' ? '未取得麥克風權限，請改用輸入框' : ev.error)); rec = null; mic.classList.remove('listening'); }; rec.start(); mic.classList.add('listening'); toast('聆聽中…請說出指令'); } catch (e) { toast('語音辨識啟動失敗，請直接輸入'); } };
  const ttsBtn = $('#tts'); ttsBtn.setAttribute('aria-pressed', 'true');
  ttsBtn.onclick = () => { ui.tts = !ui.tts; ttsBtn.setAttribute('aria-pressed', ui.tts); if (!ui.tts && 'speechSynthesis' in window) speechSynthesis.cancel(); toast(ui.tts ? '語音回覆／場景旁白：開' : '語音回覆／場景旁白：關'); };
  function speak(text) { try { if (!('speechSynthesis' in window) || !text) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.slice(0, 200)); u.lang = 'zh-TW'; u.rate = 1.05; const v = speechSynthesis.getVoices().find(v => /zh[-_]TW/i.test(v.lang)) || speechSynthesis.getVoices().find(v => /^zh/i.test(v.lang)); if (v) u.voice = v; speechSynthesis.speak(u); } catch (e) { /* no tts */ } }
  ui.speak = text => { if (ui.tts) speak(text); };

  /* ---- agent mode (built-in ⇄ Claude) ---- */
  const am = $('#agentmode');
  ui.setAgentMode = on => { ui.claudeMode = !!on; am.setAttribute('aria-pressed', ui.claudeMode); am.textContent = ui.claudeMode ? 'Claude' : '內建'; };
  am.onclick = async () => { if (ui.claudeMode) { ui.setAgentMode(false); ui.setMcpStatus('FUNRAISE MCP · 快照'); toast('切回內建 agent（本地快照，模擬 MCP 呼叫）'); return; } if (!claude) return; toast('偵測 agent server…'); const h = await claude.probe(); if (h.ok) { ui.setAgentMode(true); ui.setMcpStatus(`FUNRAISE MCP · ${h.mcp ? 'LIVE' : '未連線'} · ${h.model}`); toast(`Claude 模式：${h.model}${h.mcp ? ' + FUNRAISE MCP 即時查詢' : '（未設定 MCP token：只能操作畫面與本地快照）'}`); } else toast('找不到 agent server。請在 app/ 執行 npm run server，並在 .env 設定 ANTHROPIC_API_KEY。'); };

  /* ---- scenes ---- */
  const menu = $('#scenemenu'), sb = $('#scenes');
  for (const sc of SCENES) { const b = el('button', null, `<b>▶ ${sc.title}</b><span>${sc.sub}</span>`); b.onclick = () => { menu.classList.add('hidden'); director && director.play(sc.id); }; menu.appendChild(b); }
  const all = el('button', null, '<b>▶▶ 全部連播（約 4 分鐘）</b><span>投資人 → 開發商 → 選址 → 城市治理 → 時光</span>');
  all.onclick = async () => { menu.classList.add('hidden'); if (!director) return; for (const sc of SCENES) { await director.play(sc.id); if (director.stopFlag) break; } };
  menu.appendChild(all);
  sb.onclick = () => { if (director && director.playing) { director.stop(); toast('場景停止'); return; } menu.classList.toggle('hidden'); };
  ui.cine = (title, text) => { const bar = $('#cinebar'); if (!title) { bar.classList.add('hidden'); sb.textContent = '▶ 場景'; document.body.classList.remove('cinema'); ui.sceneId = null; return; } bar.classList.remove('hidden'); $('#cine-title').textContent = title; $('#cine-text').textContent = text || ''; sb.textContent = '■ 停止'; document.body.classList.add('cinema'); ui.sceneId = title; };

  /* ---- toast, keyboard, mobile ---- */
  let toastT; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); } ui.toast = toast;
  addEventListener('keydown', e => {
    if (e.target === cmd || e.metaKey || e.ctrlKey || e.altKey) { if (e.key === 'Escape') cmd.blur(); return; }
    const k = e.key.toLowerCase();
    if (k === '/') { e.preventDefault(); cmd.focus(); } else if (k === 'escape') { if (director && director.playing) director.stop(); menu.classList.add('hidden'); ui.select(null); }
    else if (k === '1') ui.setSensor('normal'); else if (k === '2') ui.setSensor('night'); else if (k === '3') ui.setSensor('thermal'); else if (k === '4') ui.setSensor('blueprint');
    else if (k === 'o') ui.userMode('orbit'); else if (k === 's') ui.userMode('street'); else if (k === 'c') ui.userMode('city'); else if (k === 'g') ui.userMode('globe'); else if (k === 't') ui.userMode('timelapse');
    else if (k === 'l') { const ids = Object.keys(LENSES); agent && agent.setLens(ids[(ids.indexOf(agent.lens) + 1) % ids.length]); } else if (k === 'n') ui.setNight(!night); else if (k === 'b') ui.cycleBasemap(); else if (k === 'p') sb.click();
  });
  $('#m-layers').onclick = () => { document.body.classList.toggle('show-rail'); document.body.classList.remove('show-inspector'); };
  $('#m-insp').onclick = () => { document.body.classList.toggle('show-inspector'); document.body.classList.remove('show-rail'); };
  $('#m-tour').onclick = () => sb.click();
  return ui;
}
