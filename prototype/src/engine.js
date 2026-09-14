/* PeakLens 睿鏡 — canvas 2.5D map engine (no external libraries)
   Coordinates: WGS84 lon/lat → Web Mercator world units → screen.
   Camera: center lon/lat, zoom (256·2^z px per world), bearing (deg), pitch (deg; affine squash + extrusion). */
'use strict';
const EARTH = 40075016.686;
const D2R = Math.PI / 180;
const mercX = lon => lon / 360 + 0.5;
const mercY = lat => { const s = Math.sin(lat * D2R); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const invMerc = (x, y) => [(x - 0.5) * 360, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / D2R];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
const fmtInt = n => Math.round(n).toLocaleString('zh-TW');
const fmtMoney = n => { if (n == null) return '—'; const a = Math.abs(n); if (a >= 1e8) return (n / 1e8).toFixed(a >= 1e9 ? 0 : 1) + ' 億'; if (a >= 1e4) return fmtInt(n / 1e4) + ' 萬'; return fmtInt(n); };
const yearOf = s => { if (!s) return null; const m = String(s).match(/(\d{4})/); if (m) return +m[1]; const r = String(s).match(/^(\d{3})/); return r ? +r[1] + 1911 : null; };
const distM = (a, b) => { const dx = (a[0] - b[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * D2R); const dy = (a[1] - b[1]) * 110540; return Math.hypot(dx, dy); };

class Camera {
  constructor() { this.lon = 121.5654; this.lat = 25.0330; this.zoom = 12.2; this.bearing = 0; this.pitch = 0; this.anim = null; this.orbit = false; }
  worldScale() { return 256 * Math.pow(2, this.zoom); }
  pxPerMeter() { return this.worldScale() / (EARTH * Math.cos(this.lat * D2R)); }
  flyTo(t, ms = 1600, done) {
    const from = { lon: this.lon, lat: this.lat, zoom: this.zoom, bearing: this.bearing, pitch: this.pitch };
    const to = { lon: t.lon ?? from.lon, lat: t.lat ?? from.lat, zoom: t.zoom ?? from.zoom, bearing: t.bearing ?? from.bearing, pitch: t.pitch ?? from.pitch };
    let db = ((to.bearing - from.bearing + 540) % 360) - 180; to.bearing = from.bearing + db;
    this.anim = { from, to, t0: performance.now(), ms, done };
  }
  tick(now) {
    if (this.orbit && !this.anim) this.bearing = (this.bearing + 0.06) % 360;
    if (!this.anim) return this.orbit;
    const a = this.anim; let t = clamp((now - a.t0) / a.ms, 0, 1); const e = easeInOut(t);
    // zoom out slightly mid-flight for long hops (arc)
    const d = Math.hypot(mercX(a.to.lon) - mercX(a.from.lon), mercY(a.to.lat) - mercY(a.from.lat)) * 256 * Math.pow(2, Math.min(a.from.zoom, a.to.zoom));
    const dip = d > 400 ? Math.min(2.2, d / 900) * Math.sin(Math.PI * t) : 0;
    this.lon = lerp(a.from.lon, a.to.lon, e); this.lat = lerp(a.from.lat, a.to.lat, e);
    this.zoom = lerp(a.from.zoom, a.to.zoom, e) - dip; this.bearing = lerp(a.from.bearing, a.to.bearing, e); this.pitch = lerp(a.from.pitch, a.to.pitch, e);
    if (t >= 1) { this.bearing = ((this.bearing % 360) + 360) % 360; const cb = a.done; this.anim = null; cb && cb(); }
    return true;
  }
}

/* ---------- layer registry ---------- */
const LAYERS = {
  stock:    { name: '商辦存量',        color: '#F2B84B', glyph: 'box',     desc: '5,488 棟商辦（雙北＋台中）· 等級 / 屋齡 / 認證 / 捷運距離' },
  future:   { name: '未來供給（規劃中）', color: '#3ED2E8', glyph: 'ghost',   desc: '興建中／規劃中建案 · 逐層用途與完工年' },
  licenses: { name: '建照（即將開工）',   color: '#3ED2E8', glyph: 'pulse',   desc: '台北市建照 · 未來 24–48 月新供給最早訊號' },
  renewal:  { name: '都更單元',        color: '#B48CFF', glyph: 'polygon', desc: '全台 ~3,500 筆都更地區／單元 · 含圖形' },
  zones:    { name: '重劃／區段徵收',   color: '#B48CFF', glyph: 'hex',     desc: '全台 ~1,011 筆市地重劃／區段徵收' },
  mops:     { name: '上市櫃資產交易',   color: '#FF7A59', glyph: 'diamond', desc: '公開資訊觀測站 取得／處分資產 · 6,055 筆' },
  moves:    { name: '企業遷徙',        color: '#FF7A59', glyph: 'arc',     desc: '公司登記地址異動（跨區）· 增資訊號' },
  infra:    { name: '公共建設（興建中）', color: '#4C8DFF', glyph: 'square',  desc: '捷運／轉運站／場館 · 完工年' },
  parks:    { name: '產業園區',        color: '#58C97B', glyph: 'ring',    desc: '全國 212 個產業園區 · 園區內公司與地號' },
  heat:     { name: '商圈行情',        color: '#F2B84B', glyph: 'heat',    desc: '商圈租金／售價 · YoY · 企業數' },
  mrt:      { name: '捷運路網',        color: '#8FA3C8', glyph: 'line',    desc: '台北捷運 6 線 118 站（OSM）' },
};

/* ---------- engine ---------- */
class Engine {
  constructor(canvas, basemap, demo) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.cam = new Camera();
    this.base = basemap || {}; this.data = demo || {};
    this.visible = new Set(['stock', 'future', 'licenses', 'renewal', 'mops', 'infra', 'mrt', 'parks']);
    this.year = new Date().getFullYear(); this.now = new Date().getFullYear();
    this.hover = null; this.selected = null; this.hits = []; this.labels = [];
    this.highlight = new Map(); // key -> until timestamp
    this.arcs = []; this.dirty = true; this.onSelect = null; this.onIdle = null; this.idleTimer = null;
    this.mode = 'city'; this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.prep(); this.resize(); this.bind();
    requestAnimationFrame(t => this.frame(t));
  }
  prep() {
    const d = this.data, b = this.base;
    const cen = rings => { let x = 0, y = 0, n = 0; for (const p of rings[0] || []) { x += p[0]; y += p[1]; n++; } return n ? [x / n, y / n] : null; };
    (b.districts || []).forEach(z => { z.c = cen(z.rings); });
    (b.parks || []).forEach(z => { z.c = cen(z.rings); });
    (d.urban_renewal || []).forEach(u => { if (u.polygon && !u.rings) u.rings = [u.polygon]; if (u.rings) u.c = cen(u.rings); });
    (d.buildings || []).forEach(x => { x.year = yearOf(x.license_date); x.h = ((x.floor_above || 8) * 3.8) * 1.6; x.side = clamp(Math.sqrt((x.total_floor_area || 6000) / Math.max(1, (x.floor_above || 8) + (x.floor_below || 0))) * 1.25, 18, 64); });
    (d.future_dev || []).forEach(x => { x.year = yearOf(x.completion_date) || 2028; x.h = ((x.floors_above || 20) * (x.typical_floor_height || 3.8)) * 1.6; x.side = clamp(Math.sqrt(x.max_floor_area || 1000) * 1.25, 18, 70); });
    (d.building_licenses || []).forEach(x => { x.year = yearOf(x.issue_date); });
    (d.mops || []).forEach(x => { x.year = yearOf(x.announcement_date); });
    (d.registry_moves || []).forEach(x => { x.year = yearOf(x.date); });
    this.mrtColor = { '文湖線': '#C48C31', '淡水信義線': '#E3002C', '松山新店線': '#008659', '中和新蘆線': '#F8B61C', '板南線': '#0070BD', '環狀線': '#FFDB00' };
  }
  resize() { const r = this.cv.getBoundingClientRect(); this.w = r.width; this.h = r.height; this.cv.width = this.w * this.dpr; this.cv.height = this.h * this.dpr; this.cx = this.w / 2; this.cy = this.h * 0.56; this.vb = this.viewBounds(); this.dirty = true; }
  /* projection */
  project(lon, lat, out) {
    const s = this.cam.worldScale(); const dx = (mercX(lon) - mercX(this.cam.lon)) * s; const dy = (mercY(lat) - mercY(this.cam.lat)) * s;
    const b = -this.cam.bearing * D2R, c = Math.cos(b), sn = Math.sin(b); const rx = dx * c - dy * sn, ry = dx * sn + dy * c; const k = Math.cos(this.cam.pitch * D2R);
    out = out || [0, 0]; out[0] = this.cx + rx; out[1] = this.cy + ry * k; return out;
  }
  unproject(sx, sy) {
    const k = Math.cos(this.cam.pitch * D2R); const rx = sx - this.cx, ry = (sy - this.cy) / k; const b = this.cam.bearing * D2R, c = Math.cos(b), sn = Math.sin(b);
    const dx = rx * c - ry * sn, dy = rx * sn + ry * c; const s = this.cam.worldScale();
    return invMerc(mercX(this.cam.lon) + dx / s, mercY(this.cam.lat) + dy / s);
  }
  metersToPx(m) { return m * this.cam.pxPerMeter(); }
  /* interaction */
  bind() {
    const cv = this.cv; let drag = null, pinch = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); const p = pos(e); drag = { id: e.pointerId, x: p[0], y: p[1], moved: false, rot: e.button === 2 || e.shiftKey || e.ctrlKey, lon: this.cam.lon, lat: this.cam.lat }; this.cam.orbit = false; this.cam.anim = null; cv.classList.add('dragging'); });
    cv.addEventListener('pointermove', e => {
      const p = pos(e);
      if (drag && drag.id === e.pointerId) {
        const dx = p[0] - drag.x, dy = p[1] - drag.y; if (Math.hypot(dx, dy) > 3) drag.moved = true;
        if (drag.rot) { this.cam.bearing = (this.cam.bearing - dx * 0.35 + 360) % 360; this.cam.pitch = clamp(this.cam.pitch - dy * 0.3, 0, 72); }
        else { const a = this.unproject(drag.x, drag.y), b = this.unproject(p[0], p[1]); this.cam.lon -= (b[0] - a[0]); this.cam.lat -= (b[1] - a[1]); }
        drag.x = p[0]; drag.y = p[1]; this.dirty = true; this.idle();
      } else { this.hoverAt(p[0], p[1]); }
    });
    const up = e => { if (drag && drag.id === e.pointerId) { if (!drag.moved) this.clickAt(drag.x, drag.y); drag = null; cv.classList.remove('dragging'); this.idle(); } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', e => { e.preventDefault(); const p = pos(e); const before = this.unproject(p[0], p[1]); this.cam.zoom = clamp(this.cam.zoom - e.deltaY * 0.0018, 9.5, 18.5); const after = this.unproject(p[0], p[1]); this.cam.lon += before[0] - after[0]; this.cam.lat += before[1] - after[1]; this.cam.anim = null; this.dirty = true; this.idle(); }, { passive: false });
    // touch pinch
    cv.addEventListener('touchstart', e => { if (e.touches.length === 2) { pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), z: this.cam.zoom }; } }, { passive: true });
    cv.addEventListener('touchmove', e => { if (pinch && e.touches.length === 2) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); this.cam.zoom = clamp(pinch.z + Math.log2(d / pinch.d), 9.5, 18.5); this.dirty = true; } }, { passive: true });
    cv.addEventListener('touchend', () => { pinch = null; });
    window.addEventListener('resize', () => this.resize());
  }
  idle() { clearTimeout(this.idleTimer); this.idleTimer = setTimeout(() => this.onIdle && this.onIdle(), 350); }
  hoverAt(x, y) { const h = this.pick(x, y); if ((h && h.key) !== (this.hover && this.hover.key)) { this.hover = h; this.dirty = true; this.cv.style.cursor = h ? 'pointer' : 'grab'; } this.mouse = [x, y]; }
  clickAt(x, y) { const h = this.pick(x, y); this.selected = h || null; this.dirty = true; this.onSelect && this.onSelect(h ? h.item : null, h ? h.layer : null); }
  pick(x, y) {
    let best = null, bd = 1e9;
    for (const h of this.hits) { if (h.poly) { if (this.inPoly(x, y, h.poly)) { if (bd > 1e8) { best = h; bd = 1e8; } } } else { const d = Math.hypot(h.x - x, h.y - y); if (d < h.r + 6 && d < bd) { best = h; bd = d; } } }
    return best;
  }
  inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if (((a[1] > y) !== (b[1] > y)) && (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; }
  /* public camera verbs */
  flyTo(lon, lat, zoom, pitch, bearing, ms, done) { this.cam.orbit = false; this.cam.flyTo({ lon, lat, zoom, pitch, bearing }, ms || 1800, done); this.dirty = true; }
  setMode(mode, target) {
    this.mode = mode; const c = this.cam; const t = target || { lon: c.lon, lat: c.lat };
    if (mode === 'city') { c.orbit = false; c.flyTo({ lon: t.lon, lat: t.lat, zoom: Math.min(c.zoom, 12.4), pitch: 0, bearing: 0 }, 1400); }
    if (mode === 'orbit') { c.flyTo({ lon: t.lon, lat: t.lat, zoom: Math.max(c.zoom, 14.6), pitch: 58 }, 1600, () => { c.orbit = true; }); }
    if (mode === 'street') { c.orbit = false; c.flyTo({ lon: t.lon, lat: t.lat, zoom: 16.8, pitch: 70, bearing: c.bearing }, 1700); }
    if (mode === 'globe') { c.orbit = false; c.flyTo({ lon: 120.98, lat: 23.75, zoom: 8.2, pitch: 0, bearing: 0 }, 1800); }
    this.dirty = true;
  }
  pulse(key, ms = 6000) { this.highlight.set(key, performance.now() + ms); this.dirty = true; }
  addArc(from, to, color, label, ms = 5000) { this.arcs.push({ from, to, color, label, t0: performance.now(), ms }); this.dirty = true; }
  /* frame */
  frame(now) {
    const moving = this.cam.tick(now); const live = moving || this.arcs.length || this.highlight.size || (this.cam.pitch > 0) || true; // pulses need continuous paint
    if (this.dirty || live) { this.render(now); this.dirty = false; }
    if (moving) this.idle();
    requestAnimationFrame(t => this.frame(t));
  }
  viewBounds() { const a = this.unproject(0, 0), b = this.unproject(this.w, 0), c = this.unproject(0, this.h), d = this.unproject(this.w, this.h); return [Math.min(a[0], b[0], c[0], d[0]), Math.min(a[1], b[1], c[1], d[1]), Math.max(a[0], b[0], c[0], d[0]), Math.max(a[1], b[1], c[1], d[1])]; }
  inView(lon, lat, pad = 0.02) { const v = this.vb || (this.vb = this.viewBounds()); return lon > v[0] - pad && lon < v[2] + pad && lat > v[1] - pad && lat < v[3] + pad; }
  /* visibility by timeline */
  showByYear(item, kind) {
    const y = this.year;
    if (kind === 'stock') return item.year == null || item.year <= y;
    if (kind === 'future') return true; // drawn as ghost or solid depending on year
    if (kind === 'event') return item.year != null && item.year <= y && item.year >= y - 1;
    return true;
  }
  render(now) {
    const ctx = this.ctx, w = this.w, h = this.h, z = this.cam.zoom, k = Math.cos(this.cam.pitch * D2R);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    this.hits = []; this.labels = []; this.vb = this.viewBounds();
    const t = now / 1000;
    // ground
    ctx.fillStyle = '#070B14'; ctx.fillRect(0, 0, w, h);
    this.drawGrid(ctx);
    this.drawDistricts(ctx, z);
    this.drawParksGreen(ctx, z);
    this.drawRivers(ctx, z);
    this.drawRoads(ctx, z);
    if (this.visible.has('mrt')) this.drawMRT(ctx, z);
    if (this.visible.has('heat')) this.drawHeat(ctx, z, t);
    if (this.visible.has('zones')) this.drawZones(ctx, z, t);
    if (this.visible.has('parks')) this.drawIndustrial(ctx, z, t);
    if (this.visible.has('renewal')) this.drawRenewal(ctx, z, t);
    // extrusions (painter's algorithm, sorted by screen y)
    const ext = [];
    if (this.visible.has('stock')) for (const b of this.data.buildings || []) if (b.lat && this.showByYear(b, 'stock') && this.inView(b.lon, b.lat)) ext.push({ kind: 'stock', it: b });
    if (this.visible.has('future')) for (const f of this.data.future_dev || []) if (f.lat && this.inView(f.lon, f.lat)) ext.push({ kind: 'future', it: f });
    const P = [0, 0]; for (const e of ext) { this.project(e.it.lon, e.it.lat, P); e.sx = P[0]; e.sy = P[1]; }
    ext.sort((a, b) => a.sy - b.sy);
    for (const e of ext) this.drawBox(ctx, e, z, t);
    if (this.visible.has('licenses')) this.drawLicenses(ctx, z, t);
    if (this.visible.has('infra')) this.drawInfra(ctx, z, t);
    if (this.visible.has('mops')) this.drawMops(ctx, z, t);
    if (this.visible.has('moves')) this.drawMoves(ctx, z, t);
    this.drawArcs(ctx, now);
    this.drawLabels(ctx, z);
    this.drawHover(ctx);
    if (this.cam.pitch > 5) this.drawFog(ctx);
    this.drawCompass(ctx);
  }
  drawGrid(ctx) { // faint graticule for the cockpit feel
    ctx.save(); ctx.strokeStyle = 'rgba(120,150,210,.05)'; ctx.lineWidth = 1; const step = 0.02; const v = this.vb; const P = [0, 0], Q = [0, 0];
    if ((v[2] - v[0]) / step < 60) { for (let lon = Math.floor(v[0] / step) * step; lon < v[2]; lon += step) { this.project(lon, v[1], P); this.project(lon, v[3], Q); ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(Q[0], Q[1]); ctx.stroke(); } for (let lat = Math.floor(v[1] / step) * step; lat < v[3]; lat += step) { this.project(v[0], lat, P); this.project(v[2], lat, Q); ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(Q[0], Q[1]); ctx.stroke(); } }
    ctx.restore();
  }
  path(ctx, ring) { const P = [0, 0]; for (let i = 0; i < ring.length; i++) { this.project(ring[i][0], ring[i][1], P); if (i === 0) ctx.moveTo(P[0], P[1]); else ctx.lineTo(P[0], P[1]); } }
  drawDistricts(ctx, z) {
    const ds = this.base.districts || []; let i = 0;
    for (const d of ds) { if (!d.rings) continue; ctx.beginPath(); for (const r of d.rings) { this.path(ctx, r); ctx.closePath(); } const tp = d.county === '臺北市' || d.county === '台北市'; ctx.fillStyle = tp ? (i++ % 2 ? '#111A2E' : '#0F1729') : '#0B1222'; ctx.fill('evenodd'); ctx.strokeStyle = tp ? '#26365A' : '#18223A'; ctx.lineWidth = tp ? 1 : .8; ctx.stroke(); if (z < 13.4 && d.c) this.labels.push({ lon: d.c[0], lat: d.c[1], text: d.name, cls: 'district', pri: 1 }); }
  }
  drawParksGreen(ctx, z) { for (const p of this.base.parks || []) { ctx.beginPath(); for (const r of p.rings) { this.path(ctx, r); ctx.closePath(); } ctx.fillStyle = '#0E2A1C'; ctx.fill(); if (z > 13.6 && p.c && p.name) this.labels.push({ lon: p.c[0], lat: p.c[1], text: p.name, cls: 'park', pri: 4 }); } }
  drawRivers(ctx, z) { ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; for (const r of this.base.rivers || []) { if (r.rings) { ctx.beginPath(); for (const ring of r.rings) { this.path(ctx, ring); ctx.closePath(); } ctx.fillStyle = '#0B2340'; ctx.fill(); } else if (r.coords) { ctx.beginPath(); this.path(ctx, r.coords); ctx.strokeStyle = '#123A66'; ctx.lineWidth = clamp(this.metersToPx(r.width_m || 120), 2, 60); ctx.stroke(); } } ctx.restore(); }
  drawRoads(ctx, z) {
    if (z < 10.8) return; ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const r of this.base.roads || []) { const major = r.cls === 'motorway' || r.cls === 'trunk'; if (!major && z < 12.2) continue; if (!r.coords.some(p => this.inView(p[0], p[1], 0.01))) continue; ctx.beginPath(); this.path(ctx, r.coords); ctx.strokeStyle = major ? '#2A3B63' : '#1B2742'; ctx.lineWidth = major ? clamp(this.metersToPx(22), 1.2, 7) : clamp(this.metersToPx(14), .8, 4); ctx.stroke(); }
    ctx.restore();
  }
  drawMRT(ctx, z) {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const l of this.base.mrt_lines || []) { const col = this.mrtColor[l.name] || l.color || '#8FA3C8'; for (const seg of l.coords || []) { ctx.beginPath(); this.path(ctx, seg); ctx.strokeStyle = hexA(col, z > 13 ? .85 : .6); ctx.lineWidth = clamp(this.metersToPx(18), 1.5, 5); ctx.stroke(); } }
    const P = [0, 0]; if (z > 12.6) for (const s of this.base.mrt_stations || []) { if (!this.inView(s.lon, s.lat)) continue; this.project(s.lon, s.lat, P); const r = clamp(this.metersToPx(40), 2.2, 6); ctx.beginPath(); ctx.arc(P[0], P[1], r, 0, 7); ctx.fillStyle = '#0B1222'; ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = '#C9D6EE'; ctx.stroke(); if (z > 13.6) this.labels.push({ lon: s.lon, lat: s.lat, text: s.name, cls: 'mrt', pri: 3, dy: -r - 3 }); this.hits.push({ key: 'mrt:' + s.name, layer: 'mrt', item: s, x: P[0], y: P[1], r: r + 4 }); }
    ctx.restore();
  }
  drawHeat(ctx, z, t) {
    const P = [0, 0]; for (const a of this.data.business_areas || []) { if (!a.lat) continue; this.project(a.lon, a.lat, P); const rent = a.market_price && a.market_price.actual_rent_avg || 1500; const r = clamp(this.metersToPx(650), 30, 320); const g = ctx.createRadialGradient(P[0], P[1], 0, P[0], P[1], r); const hot = clamp((rent - 1200) / 1600, 0, 1); g.addColorStop(0, `rgba(${Math.round(242)},${Math.round(184 - 120 * hot)},${Math.round(75 - 40 * hot)},${.22 + .1 * hot})`); g.addColorStop(1, 'rgba(242,184,75,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(P[0], P[1], r, 0, 7); ctx.fill(); if (z > 11.8) this.labels.push({ lon: a.lon, lat: a.lat, text: (a.name || '').replace(/^台北市|^新北市/, ''), cls: 'area', pri: 2, sub: a.market_price ? `租 ${fmtInt(rent)}/坪 · 售 ${fmtInt((a.market_price.actual_sale_avg || 0) / 1e4)} 萬/坪` : '' }); this.hits.push({ key: 'heat:' + a.id, layer: 'heat', item: a, x: P[0], y: P[1], r: Math.min(r * .5, 40) }); }
  }
  drawZones(ctx, z, t) {
    const P = [0, 0]; for (const d of this.data.development_zones || []) { if (!d.lat || !this.inView(d.lon, d.lat)) continue; this.project(d.lon, d.lat, P); const r = clamp(this.metersToPx(180), 5, 26); ctx.save(); ctx.translate(P[0], P[1]); ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; const x = Math.cos(a) * r, y = Math.sin(a) * r * Math.cos(this.cam.pitch * D2R); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.fillStyle = hexA('#B48CFF', d.status === '辦理中' ? .18 : .08); ctx.fill(); ctx.setLineDash(d.status === '辦理完成' ? [] : [4, 3]); ctx.strokeStyle = hexA('#B48CFF', .8); ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore(); if (z > 12.8) this.labels.push({ lon: d.lon, lat: d.lat, text: d.name, cls: 'zone', pri: 4, dy: -r - 3 }); this.hits.push({ key: 'zone:' + d.id, layer: 'zones', item: d, x: P[0], y: P[1], r }); }
  }
  drawIndustrial(ctx, z, t) {
    const P = [0, 0]; for (const p of this.data.industrial_parks || []) { if (!p.lat || !this.inView(p.lon, p.lat)) continue; this.project(p.lon, p.lat, P); const r = clamp(this.metersToPx(Math.sqrt((p.area_ha || 10) * 1e4) * .6), 8, 60); const k = Math.cos(this.cam.pitch * D2R); ctx.save(); ctx.translate(P[0], P[1]); ctx.scale(1, k); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.strokeStyle = hexA('#58C97B', .9); ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -t * 12; ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(0, 0, r * .35, 0, 7); ctx.fillStyle = hexA('#58C97B', .25); ctx.fill(); ctx.restore(); this.labels.push({ lon: p.lon, lat: p.lat, text: p.name, cls: 'park', pri: 3, dy: -r * k - 4 }); this.hits.push({ key: 'ipark:' + p.id, layer: 'parks', item: p, x: P[0], y: P[1], r }); }
  }
  drawRenewal(ctx, z, t) {
    if (z < 11.6) return; const nowt = performance.now();
    for (const u of this.data.urban_renewal || []) { if (!u.rings || !u.c || !this.inView(u.c[0], u.c[1], 0.01)) continue; ctx.beginPath(); const scr = []; const P = [0, 0]; for (const ring of u.rings) { for (let i = 0; i < ring.length; i++) { this.project(ring[i][0], ring[i][1], P); scr.push([P[0], P[1]]); i ? ctx.lineTo(P[0], P[1]) : ctx.moveTo(P[0], P[1]); } ctx.closePath(); }
      const hl = this.highlight.get('renewal:' + u.id) > nowt; const sel = this.selected && this.selected.key === 'renewal:' + u.id; const gov = u.category === '政府主導'; const a = hl ? .55 : sel ? .45 : .22;
      ctx.fillStyle = hexA('#B48CFF', a + (hl ? .15 * Math.sin(t * 6) : 0)); ctx.fill(); ctx.strokeStyle = hexA(gov ? '#E0C3FF' : '#B48CFF', .9); ctx.lineWidth = hl || sel ? 2.2 : 1.2; ctx.setLineDash(gov ? [] : [5, 3]); ctx.stroke(); ctx.setLineDash([]);
      if (z > 13.8) this.labels.push({ lon: u.c[0], lat: u.c[1], text: u.name, cls: 'renewal', pri: 3, sub: `${u.category || ''} · ${fmtInt(u.area_sqm || 0)} m²` });
      this.hits.push({ key: 'renewal:' + u.id, layer: 'renewal', item: u, poly: scr, x: 0, y: 0, r: 0 });
    }
  }
  drawBox(ctx, e, z, t) {
    const it = e.it, ghost = e.kind === 'future' && it.year > this.year, built = e.kind === 'future' && it.year <= this.year; const col = e.kind === 'stock' ? (it.grade === 'A' ? '#F2B84B' : '#C89B4E') : '#3ED2E8';
    const key = (e.kind === 'stock' ? 'stock:' : 'future:') + it.id; const hl = this.highlight.get(key) > performance.now(); const sel = this.selected && this.selected.key === key; const hov = this.hover && this.hover.key === key;
    const ppm = this.cam.pxPerMeter(); const side = it.side * ppm; const pitch = this.cam.pitch * D2R; const k = Math.cos(pitch); const H = it.h * ppm * Math.sin(pitch) * (ghost ? .85 : 1);
    if (z < 12.3) { // far: dot
      const r = clamp(side * .5, 1.6, 4); ctx.beginPath(); ctx.arc(e.sx, e.sy, r, 0, 7); ctx.fillStyle = hexA(col, ghost ? .5 : .85); ctx.fill(); this.hits.push({ key, layer: e.kind, item: it, x: e.sx, y: e.sy, r: r + 2 }); return;
    }
    const b = -this.cam.bearing * D2R, c = Math.cos(b), s = Math.sin(b); const hs = Math.max(2, side / 2);
    const corners = [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]].map(([x, y]) => [e.sx + (x * c - y * s), e.sy + (x * s + y * c) * k]);
    ctx.save(); if (ghost) ctx.setLineDash([4, 3]);
    // sides: draw those whose outward normal faces the viewer (positive screen y)
    const faces = [];
    for (let i = 0; i < 4; i++) { const a = corners[i], bb = corners[(i + 1) % 4]; const nx = (bb[1] - a[1]), ny = -(bb[0] - a[0]); faces.push({ i, a, b: bb, facing: ny, mid: (a[1] + bb[1]) / 2 }); }
    faces.sort((p, q) => p.mid - q.mid);
    for (const f of faces) { if (H < 1) break; const shade = f.facing > 0 ? .55 : .3; const light = clamp(.35 + .35 * ((f.b[0] - f.a[0]) / (Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]) || 1)), .2, .75);
      ctx.beginPath(); ctx.moveTo(f.a[0], f.a[1]); ctx.lineTo(f.b[0], f.b[1]); ctx.lineTo(f.b[0], f.b[1] - H); ctx.lineTo(f.a[0], f.a[1] - H); ctx.closePath(); ctx.fillStyle = ghost ? hexA(col, .06) : hexA(col, shade * light * .9); ctx.fill(); ctx.strokeStyle = hexA(col, ghost ? .8 : .35); ctx.lineWidth = .8; ctx.stroke(); }
    // top
    ctx.beginPath(); corners.forEach((p, i) => i ? ctx.lineTo(p[0], p[1] - H) : ctx.moveTo(p[0], p[1] - H)); ctx.closePath();
    ctx.fillStyle = ghost ? hexA(col, .12) : hexA(col, hl || sel || hov ? .95 : (e.kind === 'stock' ? .72 : .8)); ctx.fill(); ctx.strokeStyle = hexA(col, .9); ctx.lineWidth = hl || sel ? 2 : 1; ctx.stroke();
    if (hl) { ctx.beginPath(); ctx.arc(e.sx, e.sy - H, side * (.9 + .4 * Math.sin(t * 5)), 0, 7); ctx.strokeStyle = hexA(col, .6); ctx.lineWidth = 1.5; ctx.stroke(); }
    if (built) { ctx.fillStyle = hexA('#3ED2E8', .9); ctx.font = '600 9px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText('NEW', e.sx, e.sy - H - 6); }
    if (ghost && z > 13.8) { ctx.fillStyle = hexA('#3ED2E8', .95); ctx.font = '600 10px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(String(it.year), e.sx, e.sy - H - 6); }
    ctx.restore();
    const topR = Math.max(6, side * .8);
    this.hits.push({ key, layer: e.kind, item: it, x: e.sx, y: e.sy - H, r: topR });
    if (z > 14.2 || sel || hov) this.labels.push({ lon: it.lon, lat: it.lat, text: it.name, cls: e.kind, pri: sel || hov ? 0 : 2, dy: -H - (ghost ? 18 : 8), sub: e.kind === 'stock' ? `${it.grade || ''}辦 · ${it.floor_above || '?'}F · ${it.year || ''}` : `${it.developer || ''} · ${it.year} 完工` });
  }
  drawLicenses(ctx, z, t) {
    const P = [0, 0]; for (const l of this.data.building_licenses || []) { if (!l.lat || !this.inView(l.lon, l.lat)) continue; if (this.year < (l.year || 2025)) continue; this.project(l.lon, l.lat, P); const ph = (t * .8 + (l.license_number || '').length * .13) % 1; const r0 = clamp(this.metersToPx(30), 3, 8); const k = Math.cos(this.cam.pitch * D2R);
      ctx.save(); ctx.translate(P[0], P[1]); ctx.scale(1, k); ctx.beginPath(); ctx.arc(0, 0, r0 + ph * r0 * 3.5, 0, 7); ctx.strokeStyle = hexA('#3ED2E8', (1 - ph) * .7); ctx.lineWidth = 1.5; ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r0 * .7, 0, 7); ctx.fillStyle = '#3ED2E8'; ctx.fill(); ctx.restore();
      if (z > 13.6) this.labels.push({ lon: l.lon, lat: l.lat, text: l.license_number, cls: 'license', pri: 3, dy: -r0 - 4, sub: l.construction_type });
      this.hits.push({ key: 'license:' + l.license_number, layer: 'licenses', item: l, x: P[0], y: P[1], r: r0 + 4 }); }
  }
  drawInfra(ctx, z, t) {
    const P = [0, 0];
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const p of this.data.public_infras || []) { if (!p.line || !p.line.some(q => this.inView(q[0], q[1], 0.02))) continue; ctx.beginPath(); this.path(ctx, p.line); ctx.strokeStyle = hexA('#4C8DFF', .9); ctx.lineWidth = clamp(this.metersToPx(20), 2, 6); ctx.setLineDash([10, 8]); ctx.lineDashOffset = -t * 30; ctx.stroke(); ctx.setLineDash([]); if (z > 12) { const mid = p.line[Math.floor(p.line.length / 2)]; this.labels.push({ lon: mid[0], lat: mid[1], text: p.name, cls: 'infra', pri: 2, dy: -8, sub: `${p.status === 'constructing' ? '興建中' : '規劃中'} · ${p.completion_year || ''}` }); } }
    ctx.restore();
    for (const p of this.data.public_infras || []) { if (!p.lat || p.line || !this.inView(p.lon, p.lat)) continue; this.project(p.lon, p.lat, P); const r = clamp(this.metersToPx(90), 5, 12); const k = Math.cos(this.cam.pitch * D2R); ctx.save(); ctx.translate(P[0], P[1]); ctx.scale(1, k); ctx.rotate(-this.cam.bearing * D2R); ctx.beginPath(); ctx.rect(-r, -r, 2 * r, 2 * r); ctx.fillStyle = hexA('#4C8DFF', p.status === 'constructing' ? .35 : .12); ctx.fill(); ctx.setLineDash(p.status === 'constructing' ? [] : [3, 3]); ctx.strokeStyle = '#4C8DFF'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
      // construction crane tick
      ctx.beginPath(); ctx.moveTo(P[0], P[1] - r * k); ctx.lineTo(P[0], P[1] - r * k - 14 - 4 * Math.sin(t * 2)); ctx.strokeStyle = hexA('#4C8DFF', .8); ctx.lineWidth = 1; ctx.stroke();
      if (z > 12.4) this.labels.push({ lon: p.lon, lat: p.lat, text: p.name, cls: 'infra', pri: 2, dy: -r * k - 18, sub: `${p.status === 'constructing' ? '興建中' : '規劃中'} · ${p.completion_year || ''}` });
      this.hits.push({ key: 'infra:' + p.id, layer: 'infra', item: p, x: P[0], y: P[1], r: r + 4 }); }
  }
  drawMops(ctx, z, t) {
    const P = [0, 0]; for (const m of this.data.mops || []) { if (!m.lat || !this.inView(m.lon, m.lat)) continue; if (!this.showByYear(m, 'event')) continue; this.project(m.lon, m.lat, P); const r = clamp(Math.sqrt((m.total_price || 1e7) / 1e6) * .9, 5, 26); const k = Math.cos(this.cam.pitch * D2R); const hl = this.highlight.get('mops:' + m.id) > performance.now();
      ctx.save(); ctx.translate(P[0], P[1]); ctx.scale(1, k); ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.rect(-r * .7, -r * .7, r * 1.4, r * 1.4); ctx.fillStyle = hexA('#FF7A59', hl ? .9 : .55); ctx.fill(); ctx.strokeStyle = '#FFB199'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore();
      if (hl) { ctx.beginPath(); ctx.arc(P[0], P[1], r * (1.4 + .5 * Math.sin(t * 5)), 0, 7); ctx.strokeStyle = hexA('#FF7A59', .7); ctx.stroke(); }
      if (z > 13 || hl) this.labels.push({ lon: m.lon, lat: m.lat, text: `${m.company_name} · ${fmtMoney(m.total_price)}`, cls: 'mops', pri: hl ? 0 : 2, dy: -r - 4, sub: `${m.product_type || ''} · ${m.buyer_type || ''} ← ${m.seller_type || ''}` });
      this.hits.push({ key: 'mops:' + m.id, layer: 'mops', item: m, x: P[0], y: P[1], r: r + 3 }); }
  }
  drawMoves(ctx, z, t) {
    const P = [0, 0]; for (const mv of this.data.registry_moves || []) { if (!mv.lat || !this.inView(mv.lon, mv.lat)) continue; if (!this.showByYear(mv, 'event')) continue; this.project(mv.lon, mv.lat, P); const r = 5; ctx.beginPath(); ctx.moveTo(P[0], P[1] - r); ctx.lineTo(P[0] + r, P[1] + r); ctx.lineTo(P[0] - r, P[1] + r); ctx.closePath(); ctx.fillStyle = hexA('#FF7A59', .8); ctx.fill(); if (z > 13.5) this.labels.push({ lon: mv.lon, lat: mv.lat, text: mv.company_name, cls: 'move', pri: 3, dy: -r - 4, sub: `遷入 ← ${(mv.before || '').slice(0, 9)}…` }); this.hits.push({ key: 'move:' + mv.uniform_number, layer: 'moves', item: mv, x: P[0], y: P[1], r: r + 3 }); }
  }
  drawArcs(ctx, now) {
    const A = [0, 0], B = [0, 0]; this.arcs = this.arcs.filter(a => now - a.t0 < a.ms);
    for (const a of this.arcs) { const p = clamp((now - a.t0) / a.ms, 0, 1); this.project(a.from[0], a.from[1], A); this.project(a.to[0], a.to[1], B); const mx = (A[0] + B[0]) / 2, my = Math.min(A[1], B[1]) - Math.hypot(B[0] - A[0], B[1] - A[1]) * .35; const seg = 40; ctx.beginPath(); for (let i = 0; i <= seg; i++) { const u = (i / seg) * Math.min(1, p * 1.25); const x = (1 - u) * (1 - u) * A[0] + 2 * (1 - u) * u * mx + u * u * B[0]; const y = (1 - u) * (1 - u) * A[1] + 2 * (1 - u) * u * my + u * u * B[1]; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.strokeStyle = hexA(a.color || '#FF7A59', .9 * (1 - Math.max(0, p - .7) / .3)); ctx.lineWidth = 2; ctx.stroke();
      const u = Math.min(1, p * 1.25); const hx = (1 - u) * (1 - u) * A[0] + 2 * (1 - u) * u * mx + u * u * B[0]; const hy = (1 - u) * (1 - u) * A[1] + 2 * (1 - u) * u * my + u * u * B[1]; ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, 7); ctx.fillStyle = '#FFD9CC'; ctx.fill(); if (a.label) { ctx.font = '11px IBM Plex Mono, monospace'; ctx.fillStyle = hexA('#FFB199', .95); ctx.textAlign = 'left'; ctx.fillText(a.label, hx + 8, hy - 6); } }
  }
  drawLabels(ctx, z) {
    const placed = []; const P = [0, 0]; const fontFor = c => c === 'district' ? '600 13px Noto Sans TC, sans-serif' : c === 'area' ? '600 12px Noto Sans TC, sans-serif' : c === 'mrt' ? '10px Noto Sans TC, sans-serif' : '500 11px Noto Sans TC, sans-serif';
    const colFor = c => ({ district: 'rgba(160,178,210,.75)', area: '#F2B84B', mrt: 'rgba(200,214,238,.9)', park: '#7FDCA0', stock: '#FFE1A8', future: '#9BE9F5', license: '#9BE9F5', renewal: '#D8C3FF', mops: '#FFC2AE', move: '#FFC2AE', infra: '#A9C6FF', zone: '#D8C3FF' }[c] || '#E9EFFA');
    this.labels.sort((a, b) => a.pri - b.pri);
    for (const l of this.labels) { this.project(l.lon, l.lat, P); const x = P[0], y = P[1] + (l.dy || -6); if (x < -50 || x > this.w + 50 || y < 40 || y > this.h - 60) continue; ctx.font = fontFor(l.cls); const tw = ctx.measureText(l.text).width; const bh = l.sub ? 28 : 14; const box = [x - tw / 2 - 4, y - bh, tw + 8, bh + 2]; if (placed.some(b => !(box[0] > b[0] + b[2] || box[0] + box[2] < b[0] || box[1] > b[1] + b[3] || box[1] + box[3] < b[1]))) { if (l.pri > 0) continue; } placed.push(box);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; if (l.cls !== 'district') { ctx.fillStyle = 'rgba(7,11,20,.7)'; ctx.fillRect(box[0], box[1], box[2], box[3]); } ctx.fillStyle = colFor(l.cls); ctx.fillText(l.text, x, y - (l.sub ? 14 : 2)); if (l.sub) { ctx.font = '10px IBM Plex Mono, monospace'; ctx.fillStyle = 'rgba(167,183,211,.9)'; ctx.fillText(l.sub, x, y - 2); } }
  }
  drawHover(ctx) { const h = this.hover; if (!h || h.poly) return; ctx.beginPath(); ctx.arc(h.x, h.y, h.r + 4, 0, 7); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]); }
  drawFog(ctx) { const g = ctx.createLinearGradient(0, 0, 0, this.h * .45); g.addColorStop(0, 'rgba(7,11,20,.85)'); g.addColorStop(1, 'rgba(7,11,20,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h * .45); }
  drawCompass(ctx) { const x = this.w - 42, y = this.h - 140; if (this.w < 820) return; ctx.save(); ctx.translate(x, y); ctx.rotate(-this.cam.bearing * D2R); ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(5, 4); ctx.lineTo(0, 1); ctx.lineTo(-5, 4); ctx.closePath(); ctx.fillStyle = '#F2B84B'; ctx.fill(); ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(5, -4); ctx.lineTo(0, -1); ctx.lineTo(-5, -4); ctx.closePath(); ctx.fillStyle = 'rgba(167,183,211,.5)'; ctx.fill(); ctx.restore(); ctx.font = '10px IBM Plex Mono, monospace'; ctx.fillStyle = 'rgba(167,183,211,.8)'; ctx.textAlign = 'center'; ctx.fillText('N', x, y - 20); }
  /* analytics helpers for the agent */
  countInView() {
    const c = {}; const add = (k, arr, pred) => { c[k] = (arr || []).filter(x => x.lat && this.inView(x.lon, x.lat) && (!pred || pred(x))).length; };
    add('stock', this.data.buildings, b => this.showByYear(b, 'stock')); add('future', this.data.future_dev); add('licenses', this.data.building_licenses); add('mops', this.data.mops, m => this.showByYear(m, 'event')); add('infra', this.data.public_infras); add('moves', this.data.registry_moves); add('zones', this.data.development_zones); add('parks', this.data.industrial_parks);
    c.renewal = (this.data.urban_renewal || []).filter(u => u.c && this.inView(u.c[0], u.c[1])).length; return c;
  }
  districtAt(lon, lat) { for (const d of this.base.districts || []) { if (!d.rings) continue; for (const r of d.rings) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if (((a[1] > lat) !== (b[1] > lat)) && (lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } if (c) return d; } } return null; }
}
window.PL = Object.assign(window.PL || {}, { Engine, LAYERS, fmtInt, fmtMoney, yearOf, distM, clamp, hexA });
