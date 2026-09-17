// 洞察 · INSIGHTS rail (Phase 10R Harmony §18.3) — "annotated density = smart": 3–5 auto-generated chips computed
// from the snapshot (PL.data) + ./data/timeseries.json for whichever district sits under the camera right now
// (map.districtAtCamera()), falling back to a city-wide set when the camera isn't over a Taipei district (S0/S1,
// or panned outside the city). Refreshes on camera settle (400ms debounce, polled — this module only gets
// {map, layers, ui, data}, no direct Cesium camera-event access) and on timeline year change. Visible only in
// body.d-annotated, discovered purely by watching body's class list (MutationObserver), so ui.js needs no hook.
// Public API: createInsights({ map, layers, ui, data }) → { refresh(), setVisible(on), chips }.
import { LAYERS, fmtInt, fmtMoney } from '../layers/funraise.js';
import { icon } from '../layers/icons.js';
import './insights.css';

const TAIPEI = /臺北市|台北市/;
const HOME = [121.5650, 25.0350]; // 信義計畫區 — fallback fly-to for city-wide chips with no specific point
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stripPrefix = s => String(s || '').replace(/^台北市|^臺北市/, '');
const trendOf = (p, flat = 1) => p == null ? null : p > flat ? 'up' : p < -flat ? 'down' : 'flat';
const arrowGlyph = t => t === 'up' ? '▲' : t === 'down' ? '▼' : t === 'ytd' ? 'YTD' : '●';
const arrowText = (t, p) => t == null ? '' : ' ' + arrowGlyph(t) + (p == null || t === 'ytd' ? '' : Math.abs(p) + '%');
const arrowHtml = (t, p) => t == null ? '' : ` <span class="ins-arrow ${t}">${arrowGlyph(t)}${p == null || t === 'ytd' ? '' : Math.abs(p) + '%'}</span>`;
const lineHtml = c => `${esc(c.lead)} <span class="ins-num mono">${esc(c.value)}</span>${c.unit ? ' ' + esc(c.unit) : ''}${arrowHtml(c.arrowT, c.arrowP)}`;
const plainText = c => `${c.lead} ${c.value}${c.unit ? ' ' + c.unit : ''}${arrowText(c.arrowT, c.arrowP)}`;

async function fetchTimeseries() { try { const r = await fetch('./data/timeseries.json'); return r.ok ? await r.json() : null; } catch { return null; } }

export function createInsights({ map, layers, ui, data }) {
  const stage = document.getElementById('stage') || document.body;
  const panel = document.createElement('aside'); panel.id = 'insights'; panel.className = 'panel hidden'; panel.setAttribute('aria-label', '洞察'); stage.appendChild(panel);
  let ts = null, wanted = true, chips = [], lastKey = null, settleT = null;
  fetchTimeseries().then(j => { ts = j; if (isVisible()) refresh(); });

  const isAnnotated = () => { try { return document.body.classList.contains('d-annotated'); } catch { return false; } };
  const isVisible = () => !panel.classList.contains('hidden');
  const districtFocus = name => (map.districtCentroid && map.districtCentroid(stripPrefix(name))) || null;
  const clampYear = y => { const ys = ts && ts.meta && ts.meta.years; if (!ys || !ys.length) return y; if (y == null) return ys[ys.length - 1]; return Math.max(ys[0], Math.min(ys[ys.length - 1], y)); };
  const stockKeys = (dn, onlyAP) => (data.buildings || []).filter(b => b.district === dn && (!onlyAP || /^[AP]$/.test(b.grade || ''))).slice(0, 5).map(b => 'stock:' + b.id);

  /* ---- per-district chip candidates, in priority order — filtered for availability, capped to 5 in refresh() ---- */
  function districtChips(d) {
    const dn = d.name, pdn = '台北市' + dn, focus = districtFocus(dn), y = clampYear(map.year), list = [];
    const da = (data.districts_analytics || []).find(x => x.name === pdn || x.name === '臺北市' + dn);
    if (da) { const gp = Math.round((da.company_growth_rate || 0) * 100);
      list.push({ id: 'company', iconName: 'coin', color: '#16A4C0', lead: `${dn} 公司數`, value: fmtInt(da.company_total), unit: '家', arrowT: trendOf(gp), arrowP: gp,
        sub: da.top_industries && da.top_industries[0] ? `最大宗 · ${da.top_industries[0].name} ${Math.round((da.top_industries[0].percentage || 0) * 100)}%` : '', keys: [], focus }); }
    if (ts && ts.sales_all && ts.sales_all[dn] && ts.meta) { const years = ts.meta.years; let idx = years.indexOf(y); if (idx < 0) idx = years.length - 1;
      const v = ts.sales_all[dn][idx]; const ytd = years[idx] === ts.meta.ytd_year; const yoyArr = ts.yoy && ts.yoy.sales_all && ts.yoy.sales_all[dn]; const raw = yoyArr ? yoyArr[idx] : null; const p = ytd || raw == null ? null : Math.round(raw);
      if (v != null) list.push({ id: 'sales', iconName: 'deal', color: p != null && p < 0 ? '#F29628' : '#16A4C0', lead: `${dn} ${years[idx]}${ytd ? ' 至今' : ''} 成交`, value: fmtInt(v), unit: '件', arrowT: ytd ? 'ytd' : trendOf(p, 2), arrowP: p, keys: [], focus }); }
    if (da && da.market_price && da.market_price.actual_rent_avg) { const apCount = (data.buildings || []).filter(b => b.district === dn && /^[AP]$/.test(b.grade || '')).length;
      const allCount = (data.buildings || []).filter(b => b.district === dn).length; const count = apCount > 0 ? apCount : allCount; const tag = apCount > 0 ? 'A／P 級商辦' : '商辦';
      const rp = Math.round((da.market_price.actual_rent_yoy || 0) * 100);
      list.push({ id: 'rent', iconName: 'tower', color: LAYERS.stock.color, lead: `${dn} ${tag} ${count} 棟 · 租`, value: fmtInt(da.market_price.actual_rent_avg), unit: '元/坪', arrowT: trendOf(rp), arrowP: rp, keys: stockKeys(dn, apCount > 0), focus }); }
    const win = [y, y + 2]; const fs = (data.future_dev || []).filter(f => f.district === dn && f._year >= win[0] && f._year <= win[1]);
    if (fs.length) list.push({ id: 'future', iconName: 'ghost', color: LAYERS.future.color, lead: `${dn} ${win[0]}–${win[1]} 新供給`, value: String(fs.reduce((s, f) => s + (f.floors_above || 0), 0)), unit: `層 · ${fs.length} 案`, keys: fs.slice(0, 5).map(f => 'future:' + f.id), focus });
    const mp = (data.mops || []).filter(m => m.district === dn && (m._year == null || (m._year <= y && m._year >= y - 1)));
    if (mp.length) list.push({ id: 'mops', iconName: 'deal', color: LAYERS.mops.color, lead: `${dn} 上市櫃交易 ${mp.length} 筆 · 合計`, value: fmtMoney(mp.reduce((s, m) => s + (m.total_price || 0), 0)), unit: '元', keys: mp.slice(0, 5).map(m => 'mops:' + m.id), focus });
    const rn = (data.urban_renewal || []).filter(u => u.district === dn);
    if (rn.length) list.push({ id: 'renewal', iconName: 'renew', color: LAYERS.renewal.color, lead: `${dn} 都更`, value: String(rn.length), unit: `單元 · ${rn.filter(u => u.category === '政府主導').length} 政府主導`, keys: rn.slice(0, 5).map(u => 'renewal:' + u.id), focus });
    if (ts && ts.licenses && ts.licenses[dn] && ts.meta) { const years = ts.meta.years; let idx = years.indexOf(y); if (idx < 0) idx = years.length - 1;
      const v = ts.licenses[dn][idx]; const ytd = years[idx] === ts.meta.ytd_year; const yoyArr = ts.yoy && ts.yoy.licenses && ts.yoy.licenses[dn]; const raw = yoyArr ? yoyArr[idx] : null; const p = ytd || raw == null ? null : Math.round(raw);
      if (v != null) list.push({ id: 'licenses', iconName: 'permit', color: LAYERS.licenses.color, lead: `${dn} ${years[idx]}${ytd ? ' 至今' : ''} 建照核發`, value: fmtInt(v), unit: '件', arrowT: ytd ? 'ytd' : trendOf(p, 3), arrowP: p, keys: [], focus }); }
    const infra = (data.public_infras || []).filter(p => p.lat && p.status === 'constructing' && layers.districtAt && (layers.districtAt(p.lon, p.lat) || {}).name === dn);
    if (infra.length) list.push({ id: 'infra', iconName: 'crane', color: LAYERS.infra.color, lead: `${dn} 興建中公共建設`, value: String(infra.length), unit: '項', keys: infra.slice(0, 5).map(p => 'infra:' + p.id), focus });
    return list;
  }
  /* ---- city-wide fallback when the camera isn't over a Taipei district (S0/S1, or panned outside the city) ---- */
  function cityChips() {
    const y = clampYear(map.year), list = [];
    if (ts && ts.city && ts.meta) { const years = ts.meta.years; let idx = years.indexOf(y); if (idx < 0) idx = years.length - 1; const ytd = years[idx] === ts.meta.ytd_year;
      const arr = ts.city.sales_all || []; const v = arr[idx]; const prev = idx > 0 ? arr[idx - 1] : null; const p = (!ytd && prev) ? Math.round((v - prev) / prev * 100) : null;
      if (v != null) list.push({ id: 'city-sales', iconName: 'deal', color: '#16A4C0', lead: `台北市 ${years[idx]}${ytd ? ' 至今' : ''} 成交`, value: fmtInt(v), unit: '件', arrowT: ytd ? 'ytd' : trendOf(p, 2), arrowP: p, keys: [], focus: null }); }
    const win = [y, y + 2]; const fs = (data.future_dev || []).filter(f => f._year >= win[0] && f._year <= win[1]);
    if (fs.length) list.push({ id: 'city-future', iconName: 'ghost', color: LAYERS.future.color, lead: `台北市 ${win[0]}–${win[1]} 新供給`, value: String(fs.reduce((s, f) => s + (f.floors_above || 0), 0)), unit: `層 · ${fs.length} 案`, keys: fs.slice(0, 5).map(f => 'future:' + f.id), focus: null });
    const das = data.districts_analytics || []; const top = das.reduce((a, b) => ((b.market_price || {}).actual_rent_avg || 0) > ((a && a.market_price && a.market_price.actual_rent_avg) || 0) ? b : a, null);
    if (top) list.push({ id: 'city-toprent', iconName: 'tower', color: LAYERS.stock.color, lead: `全市租金最高 · ${stripPrefix(top.name)}`, value: fmtInt(top.market_price.actual_rent_avg), unit: '元/坪', keys: [], focus: districtFocus(top.name) });
    const mopsAll = (data.mops || []).filter(m => m._year == null || (m._year <= y && m._year >= y - 1));
    if (mopsAll.length) list.push({ id: 'city-mops', iconName: 'deal', color: LAYERS.mops.color, lead: `台北市上市櫃交易 ${mopsAll.length} 筆 · 合計`, value: fmtMoney(mopsAll.reduce((s, m) => s + (m.total_price || 0), 0)), unit: '元', keys: mopsAll.slice(0, 5).map(m => 'mops:' + m.id), focus: null });
    const rnAll = data.urban_renewal || [];
    if (rnAll.length) list.push({ id: 'city-renewal', iconName: 'renew', color: LAYERS.renewal.color, lead: '台北市都更', value: String(rnAll.length), unit: `單元 · ${rnAll.filter(u => u.category === '政府主導').length} 政府主導`, keys: [], focus: null });
    return list;
  }

  function districtScope() { const d = layers.districtAt && map.districtAtCamera && map.districtAtCamera(); return d && TAIPEI.test(d.county || '') ? d : null; }

  function onChipClick(c) {
    const p = c.focus || HOME; if (map.flyTo) map.flyTo(p[0], p[1], { range: 1800, pitch: -42 });
    if (c.keys && c.keys.length && map.explain) map.explain.enter(c.keys, { text: plainText(c) });
    else if (ui && ui.toast) ui.toast(plainText(c));
  }
  function render() {
    panel.innerHTML = '<div class="ins-head"><span class="eyebrow">洞察 · INSIGHTS</span></div>' + chips.map(c =>
      `<button class="ins-chip" data-id="${esc(c.id)}"><img class="ins-ic" alt="" src="${icon(c.iconName, c.color, 40)}"><span class="ins-body"><span class="ins-line">${lineHtml(c)}</span>${c.sub ? `<span class="ins-sub">${esc(c.sub)}</span>` : ''}</span></button>`
    ).join('');
    panel.querySelectorAll('.ins-chip').forEach((b, i) => { b.onclick = () => onChipClick(chips[i]); });
  }
  /* Positions #insights in the live gap between #rail and #gimbal (measured, not guessed, so it never overlaps
     either regardless of viewport height or how tall the rail's own content happens to be) and caps its height
     to that gap, scrolling internally if 4–5 chips don't all fit. */
  function layout() {
    if (!isVisible()) return;
    const rail = document.getElementById('rail'), gimbal = document.getElementById('gimbal');
    const rr = rail && rail.getBoundingClientRect(), gr = gimbal && gimbal.getBoundingClientRect();
    const top = Math.round((rr && rr.height ? rr.bottom : 100) + 12);
    const bottomEdge = Math.round((gr && gr.height ? gr.top : innerHeight - 16) - 12);
    panel.style.top = top + 'px'; panel.style.maxHeight = Math.max(96, bottomEdge - top) + 'px';
  }
  function refresh() { const d = districtScope(); chips = (d ? districtChips(d) : cityChips()).slice(0, 5); render(); layout(); }
  function applyVisible() { const on = wanted && isAnnotated(); panel.classList.toggle('hidden', !on); if (on) refresh(); }
  function setVisible(on) { wanted = on !== false; applyVisible(); }

  let wasAnnotated = isAnnotated();
  new MutationObserver(() => { const now = isAnnotated(); if (now !== wasAnnotated) { wasAnnotated = now; applyVisible(); } }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', () => layout());
  // camera-settle (400ms debounce) + year-change: this module only holds {map,layers,ui,data} (no direct Cesium
  // camera-event access by design), so it polls at the same cadence compose.js already uses for its own
  // trips-playing watcher rather than adding a new event path.
  setInterval(() => { if (!isVisible()) return; let key; try { const c = map.center(); key = `${c.lon.toFixed(4)}|${c.lat.toFixed(4)}|${Math.round(c.height)}|${map.year}`; } catch { return; }
    if (key !== lastKey) { lastKey = key; clearTimeout(settleT); settleT = setTimeout(refresh, 400); } }, 300);

  applyVisible();
  const api = { refresh, setVisible }; Object.defineProperty(api, 'chips', { get: () => chips.slice() }); return api;
}
