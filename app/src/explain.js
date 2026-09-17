// 說明模式 Explain mode (spec §16.5): when the agent's answer references entities on the map, the referenced things pop
// and everything else recedes, REGARDLESS of HUD density (unlike the existing annotated-only callouts in ui.js). Self-
// contained: owns its own DOM (vignette + numbered callouts + answer card), its own world→screen overlay (mirrors the
// unexported `createOverlay` in main.js), and its own FUNRAISE-layer fade (deliberately not reusing fx/focus.js's
// `dimOthers` — that hides labels/billboards outright for a single focal point, while explain fades a *set* of up to 8
// points to ~22–25% so context stays legible, per the spec). OSM building recede is reused as-is via `map.osm.focus()`
// (the same call fx/focus.js makes) over a bounding circle that covers every referenced point.
import * as Cesium from 'cesium';
import { fmtInt, fmtMoney } from './layers/funraise.js';
import './explain.css';

const D2R = Math.PI / 180;
const $s = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const escapeHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduce = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const WARM = new Set(['stock', 'mops', 'moves', 'heat']);
const distM = (lon1, lat1, lon2, lat2) => Math.hypot((lon1 - lon2) * 111320 * Math.cos(lat2 * D2R), (lat1 - lat2) * 110540);
const showVal = p => (p == null ? true : (typeof p.getValue === 'function' ? p.getValue() : !!p));
const evalNum = (p, dflt = 1) => { if (p == null) return dflt; if (typeof p.getValue === 'function') { try { const v = p.getValue(); return typeof v === 'number' ? v : dflt; } catch { return dflt; } } return typeof p === 'number' ? p : dflt; };
const itemLonLat = (viewer, e, item) => { // entity position or item lon/lat or item._c (renewal centroid) — same fallback chain as fx/focus.js
  if (item && item.lat != null) return [item.lon, item.lat];
  if (item && item._c) return item._c;
  if (e && e.position) { try { const c = e.position.getValue(viewer.clock.currentTime); if (c) { const g = Cesium.Cartographic.fromCartesian(c); return [Cesium.Math.toDegrees(g.longitude), Cesium.Math.toDegrees(g.latitude)]; } } catch { /* dynamic/unresolvable */ } }
  return null;
};
const titleOf = it => (it && (it.name || it.company_name || it.license_number)) || '—';
const statFor = (layer, it) => ({
  mops: () => fmtMoney(it.total_price), stock: () => (it.grade ? it.grade + ' 級' : ''), future: () => `${it.floors_above || '?'}F${it._year ? ' · ' + it._year : ''}`,
  renewal: () => (it.area_sqm ? fmtInt(it.area_sqm) + ' m²' : it.category || ''), licenses: () => it.construction_type || '', moves: () => it.date || '',
  infra: () => (it.status === 'constructing' ? '興建中' : '規劃中'), parks: () => it.park_type || '', zones: () => it.category || '',
  heat: () => (it.market_price ? fmtInt(it.market_price.actual_rent_avg) + ' 元/坪' : ''), mrt: () => (Array.isArray(it.lines) ? it.lines.join('・') : ''),
})[layer]?.() || '';
const firstSentence = (text, max = 90) => { // first sentence of the answer, ≤ max chars — a bare "." only ends a sentence when it isn't a decimal point (e.g. "4.9 億元")
  const s = String(text || '').replace(/\s+/g, ' ').trim(); if (!s) return '';
  const m = s.match(/[!?！？。\n]|(?<!\d)\.(?!\d)/); let seg = (m ? s.slice(0, m.index + 1) : s).trim() || s;
  return seg.length > max ? seg.slice(0, max - 1) + '…' : seg;
};

/* HTML overlay anchored to world positions — a small self-contained equivalent of main.js's (unexported) createOverlay,
   so explain.js never needs to import from a module it doesn't own. Same postRender-driven placement + occlusion test. */
function makeOverlay(scene, container) {
  const items = new Set(); const toWin = Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
  const occ = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, scene.camera.position); const scratch = new Cesium.Cartesian2();
  scene.postRender.addEventListener(() => {
    if (!items.size) return; occ.cameraPosition = scene.camera.position;
    for (const it of items) { const win = toWin(scene, it.pos, scratch); const vis = win && occ.isPointVisible(it.pos) && win.x > -200 && win.y > -200 && win.x < scene.canvas.clientWidth + 200 && win.y < scene.canvas.clientHeight + 200; if (!vis) { it.el.classList.add('behind'); continue; } it.el.classList.remove('behind'); it.el.style.transform = `translate(${win.x.toFixed(1)}px, ${win.y.toFixed(1)}px)`; if (it.onPlace) it.onPlace(win); }
  });
  return { add(lon, lat, height, el, onPlace) { const it = { pos: Cesium.Cartesian3.fromDegrees(lon, lat, height || 0), el, onPlace }; container.appendChild(el); items.add(it); return { remove() { items.delete(it); el.remove(); } }; } };
}

export function createExplain({ viewer, map, layers, ui, rig }) {
  const scene = viewer.scene;
  const stage = document.getElementById('stage') || document.body;
  let active = false, theme = 'light', mask = null, savedOsmFocus, exitTimer = null, exitCanvasFn = null, exitKeyFn = null;
  const keysList = []; let anchorHandles = []; const winByKey = new Map();

  /* ---- DOM: vignette · numbered-callout overlay · answer card (self-built, never edits ui.js/index.html) ---- */
  const vignette = $s('div'); vignette.id = 'explain-vignette'; vignette.setAttribute('aria-hidden', 'true'); stage.appendChild(vignette);
  const overlayBox = $s('div'); overlayBox.id = 'explain-overlay'; overlayBox.setAttribute('aria-hidden', 'true'); stage.appendChild(overlayBox);
  const explainOverlay = makeOverlay(scene, overlayBox);
  const card = $s('div', 'panel hidden', `<div class="ehead"><span class="eyebrow">說明中 · EXPLAIN</span><button class="x" title="關閉說明">×</button></div><div class="etext"></div><div class="elist"></div>`);
  card.id = 'explain-card'; stage.appendChild(card);
  const cardText = card.querySelector('.etext'), cardList = card.querySelector('.elist');
  card.querySelector('.x').onclick = () => exit({ clearCallouts: true });
  scene.postRender.addEventListener(() => { // keep the vignette centred on the referenced points' current screen bbox
    if (!active || !winByKey.size) return; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const w of winByKey.values()) { if (w.x < x0) x0 = w.x; if (w.x > x1) x1 = w.x; if (w.y < y0) y0 = w.y; if (w.y > y1) y1 = w.y; }
    if (x0 > x1) return; const W = viewer.canvas.clientWidth || 1, H = viewer.canvas.clientHeight || 1;
    vignette.style.setProperty('--vx', Math.max(0, Math.min(100, (x0 + x1) / 2 / W * 100)).toFixed(1) + '%');
    vignette.style.setProperty('--vy', Math.max(0, Math.min(100, (y0 + y1) / 2 / H * 100)).toFixed(1) + '%');
  });

  /* ---- resolve a key → {entity,item,layer,pos} via the same map.entityByKey lookup ui.js uses ---- */
  function resolveKey(key) {
    const e = map.entityByKey(key); if (!e || !e.properties || !e.properties.pl) return null;
    const pl = e.properties.pl.getValue(); if (!pl) return null;
    const pos = itemLonLat(viewer, e, pl.item); if (!pos) return null;
    return { key, entity: e, item: pl.item, layer: pl.layer, pos, height: (pl.item._h || 0) + 6 };
  }

  /* ---- 取景 camera framing: flyToBoundingSphere fitting every referenced point, skipped if all already on-screen ---- */
  function allInView(points) { try { const [w, s, e, n] = rig.bounds(); return points.every(([lo, la]) => lo >= w && lo <= e && la >= s && la <= n); } catch { return false; } }
  function frameAll(points) {
    if (!points.length || allInView(points)) return;
    if (rig.stopOrbit) rig.stopOrbit();
    const heading = viewer.camera.heading, pitch = -45 * D2R, dur = reduce() ? 0 : 1.7, ease = Cesium.EasingFunction.QUADRATIC_IN_OUT;
    if (points.length === 1) { viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(points[0][0], points[0][1]), 1), { offset: new Cesium.HeadingPitchRange(heading, pitch, 900), duration: dur, easingFunction: ease }); return; }
    const sphere = Cesium.BoundingSphere.fromPoints(points.map(([lo, la]) => Cesium.Cartesian3.fromDegrees(lo, la, 0))); sphere.radius = Math.max(sphere.radius * 1.4, 260);
    viewer.camera.flyToBoundingSphere(sphere, { offset: new Cesium.HeadingPitchRange(heading, pitch, 0), duration: dur, easingFunction: ease }); // range 0 → Cesium fits the sphere itself
  }

  /* ---- 遮罩 masking: OSM recede over a bounding circle (reuses osm.focus(), the same call fx/focus.js makes); FUNRAISE
     labels hidden + billboards/polygons alpha-faded to ~22–25% for every entity NOT among the referenced keys (mrt exempt,
     same as fx/focus.js's dimOthers). Deliberately not a reused dimOthers: that hides billboards outright, this fades them. */
  function osmRecede(points) {
    if (!map.osm || !map.osm.focus) return undefined;
    const prev = map.osm.focused;
    if (!points.length) return prev;
    let cx = 0, cy = 0; for (const [lo, la] of points) { cx += lo; cy += la; } cx /= points.length; cy /= points.length;
    let maxR = 0; for (const [lo, la] of points) maxR = Math.max(maxR, distM(lo, la, cx, cy));
    const radiusM = Math.min(3200, Math.max(340, maxR + 240));
    if (radiusM >= 3200 && maxR > 2900) return prev; // referenced points too spread out for a meaningful circle at this scale — skip, don't grey out most of the city
    map.osm.focus({ lon: cx, lat: cy, radiusM, keepIds: [] });
    return prev;
  }
  function keyMatches(plKey, keeps) { for (const k of keeps) if (plKey === k || plKey.startsWith(k + ':') || k.startsWith(plKey + ':')) return true; return false; } // bidirectional: a renewal unit's several ring entities are keyed 'renewal:id:ringN' while its one label/billboard entity keeps the bare 'renewal:id' — a keep-key picked from either form (e.g. straight out of layers.byKey) must still reach the other
  function sampleColor(mat) { try { const c = mat && mat.color && mat.color.getValue && mat.color.getValue(viewer.clock.currentTime); if (c) return c.clone(new Cesium.Color()); } catch { /* dynamic material without a plain colour */ } return Cesium.Color.GRAY.clone(); }
  function applyMask(keeps, pulseMs) {
    const dimmed = [], billboardSaved = [], materialSaved = [], bumped = [];
    for (const ds of Object.values(layers.ds)) for (const e of ds.entities.values) {
      const plProp = e.properties && e.properties.pl; if (!plProp) continue; const pl = plProp.getValue(); if (!pl) continue;
      if (keyMatches(pl.key, keeps)) { // referenced: bump to the front (the callout list itself is built separately, from `resolved` in enter())
        if (e.label) { bumped.push([e, 'label', e.label.disableDepthTestDistance, e.label.eyeOffset, e.label.show]); e.label.disableDepthTestDistance = Number.POSITIVE_INFINITY; e.label.eyeOffset = new Cesium.Cartesian3(0, 0, -14); e.label.show = true; } // force-show: compose.js's own scale/label-budget gate may have hidden this label before it became "referenced"
        if (e.billboard) { bumped.push([e, 'billboard', e.billboard.disableDepthTestDistance, e.billboard.eyeOffset]); e.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY; e.billboard.eyeOffset = new Cesium.Cartesian3(0, 0, -14); }
        // layers.recomputeLabels() (compose.js §16.1: scale/budget/ring/trips gates) can re-run at any time on its own
        // triggers (e.g. a scale change from THIS module's own camera flight) and would otherwise overwrite the label
        // show/eyeOffset we just set; pulsing this entity's own key makes recomputeLabels' own isHot() branch keep it
        // shown+biased regardless, so the two systems don't fight — a no-op if layers.pulse isn't present (older layers.js).
        if (layers.pulse && pulseMs) layers.pulse(pl.key, pulseMs);
        continue;
      }
      if (pl.layer === 'mrt') continue; // 捷運站永遠不淡出（沿用 fx/focus.js 的既有規則）
      if (e.label && showVal(e.label.show)) { dimmed.push([e, 'label', e.label.show]); e.label.show = false; }
      if (e.billboard) { const c0 = e.billboard.color, s0 = e.billboard.scale; billboardSaved.push([e, c0, s0]); e.billboard.color = Cesium.Color.WHITE.withAlpha(0.25); e.billboard.scale = Math.min(evalNum(s0, 1), 0.85) * 0.55; }
      for (const kind of ['polygon', 'box', 'ellipse', 'cylinder']) { const g = e[kind]; if (g && g.material) { const orig = g.material; materialSaved.push([e, kind, orig]); g.material = new Cesium.ColorMaterialProperty(sampleColor(orig).withAlpha(0.22)); } }
    }
    return { dimmed, billboardSaved, materialSaved, bumped };
  }
  function undoMask(m) {
    if (!m) return;
    for (const [e, kind, orig] of m.dimmed) try { if (kind === 'label' && e.label) e.label.show = orig; } catch { /* entity removed since */ }
    for (const [e, c0, s0] of m.billboardSaved) try { if (e.billboard) { e.billboard.color = c0; e.billboard.scale = s0; } } catch { /* ignore */ }
    for (const [e, kind, orig] of m.materialSaved) try { if (e[kind]) e[kind].material = orig; } catch { /* ignore */ }
    for (const [e, kind, d0, eo0, show0] of m.bumped) try { if (kind === 'label' && e.label) { e.label.disableDepthTestDistance = d0; e.label.eyeOffset = eo0; e.label.show = show0; } else if (kind === 'billboard' && e.billboard) { e.billboard.disableDepthTestDistance = d0; e.billboard.eyeOffset = eo0; } } catch { /* ignore */ }
  }

  /* ---- 標註 numbered callouts — always rendered regardless of ui.density (that gate lives only in ui.js's own annotated-mode list) ---- */
  function placeCallout(a, win, dx, dy) {
    const c = a.querySelector('.callout'); const w = c.offsetWidth || 220, h = c.offsetHeight || 34; const W = viewer.canvas.clientWidth, H = viewer.canvas.clientHeight;
    const flip = win.x + dx + w > W - 16; const x = flip ? -dx - w : dx; let y = dy;
    if (win.y + y < 60) y = Math.abs(dy) * 0.6 + 12; if (win.y + y + h > H - 110) y = -h - Math.abs(dy) * 0.6;
    c.style.left = x + 'px'; c.style.top = y + 'px';
    const line = a.querySelector('svg.leader'); const ex = flip ? x + w : x, ey = y + 16;
    line.style.left = Math.min(0, ex) + 'px'; line.style.top = Math.min(0, ey) + 'px'; line.setAttribute('width', Math.abs(ex) + 2); line.setAttribute('height', Math.abs(ey) + 2);
    const l = line.firstElementChild; l.setAttribute('x1', ex < 0 ? -ex : 0); l.setAttribute('y1', ey < 0 ? -ey : 0); l.setAttribute('x2', ex < 0 ? 0 : ex); l.setAttribute('y2', ey < 0 ? 0 : ey);
  }
  function goTo(info) { ui.select(info.item, info.layer); map.flyTo(info.pos[0], info.pos[1], { range: 900, pitch: -38 }); if (map.pulse) map.pulse(info.key, 4000); }
  function clearCallouts() { anchorHandles.forEach(h => h.remove()); anchorHandles = []; winByKey.clear(); keysList.length = 0; renderCardList(); }
  function buildCallouts(resolved) {
    clearCallouts();
    resolved.forEach((info, i) => {
      const warm = WARM.has(info.layer); const title = titleOf(info.item); const stat = statFor(info.layer, info.item);
      const a = $s('div', 'anchor callout-anchor explain-anchor' + (warm ? ' warm' : ''));
      a.innerHTML = `<div class="dot"></div><svg class="leader"><line x1="0" y1="0" x2="0" y2="0" stroke="${warm ? '#F29628' : '#16A4C0'}" stroke-width="1.4" stroke-opacity=".95"></line></svg><div class="callout"><span class="n">${i + 1}</span><span class="t">${escapeHtml(title)}</span>${stat ? `<span class="s">${escapeHtml(stat)}</span>` : ''}</div>`;
      a.querySelector('.callout').onclick = () => goTo(info);
      anchorHandles.push(explainOverlay.add(info.pos[0], info.pos[1], info.height, a, win => { placeCallout(a, win, 56 + (i % 3) * 14, -40 - (i % 4) * 16); winByKey.set(info.key, win); }));
      keysList.push(info.key);
    });
    renderCardList();
  }
  function renderCardList() {
    cardList.innerHTML = keysList.map((key, i) => { const info = resolveKey(key); if (!info) return ''; const warm = WARM.has(info.layer);
      return `<div class="erow${warm ? ' warm' : ''}" data-i="${i}"><span class="n">${CIRCLED[i] || i + 1}</span><span class="t">${escapeHtml(titleOf(info.item))}</span><span class="s">${escapeHtml(statFor(info.layer, info.item))}</span></div>`; }).join('');
    cardList.querySelectorAll('.erow').forEach(r => r.onclick = () => { const info = resolveKey(keysList[+r.dataset.i]); if (info) goTo(info); });
  }

  /* ---- 說明卡 answer card (a caption strip under body.d-immersive via explain.css) ---- */
  function showCard(text) { cardText.textContent = firstSentence(text); card.classList.remove('hidden'); requestAnimationFrame(() => card.classList.add('show')); }
  function hideCard() { card.classList.remove('show'); }

  /* ---- 退出 exit triggers: duration timeout, or the first pointerdown/wheel on the canvas / keydown anywhere, ignoring #explain-card ---- */
  function armExit(durationMs) {
    disarmExit();
    exitTimer = setTimeout(() => exit(), Math.max(1000, durationMs || 12000));
    exitCanvasFn = e => { if (!card.contains(e.target)) exit(); }; exitKeyFn = e => { if (!card.contains(e.target)) exit(); };
    viewer.canvas.addEventListener('pointerdown', exitCanvasFn, { passive: true }); viewer.canvas.addEventListener('wheel', exitCanvasFn, { passive: true }); window.addEventListener('keydown', exitKeyFn);
  }
  function disarmExit() {
    clearTimeout(exitTimer); exitTimer = null;
    if (exitCanvasFn) { viewer.canvas.removeEventListener('pointerdown', exitCanvasFn); viewer.canvas.removeEventListener('wheel', exitCanvasFn); exitCanvasFn = null; }
    if (exitKeyFn) { window.removeEventListener('keydown', exitKeyFn); exitKeyFn = null; }
  }
  function teardownVisual() {
    disarmExit();
    if (mask) { undoMask(mask); mask = null; }
    if (savedOsmFocus !== undefined && map.osm) { if (savedOsmFocus) map.osm.focus(savedOsmFocus); else if (map.osm.unfocus) map.osm.unfocus(); savedOsmFocus = undefined; }
    document.body.classList.remove('explaining'); vignette.classList.remove('show'); hideCard();
  }

  /* ---- public API ---- */
  function enter(keys, opts = {}) {
    keys = [...new Set((keys || []).filter(Boolean))].slice(0, 8); if (!keys.length) return false;
    if (map.focus && map.focus.active) map.focus.exit(); // 對焦是獨佔狀態；說明模式進來時視同新的獨佔情境
    teardownVisual(); // idempotent: undo any previous explain state before recomputing from scratch
    const seenItems = new Set(); // a renewal unit's several ring keys (byKey stores 'renewal:id:ringN') resolve to the same shared item — one callout each, not one per ring
    const resolved = keys.map(resolveKey).filter(r => r && !seenItems.has(r.item) && seenItems.add(r.item)); if (!resolved.length) return false;
    const points = resolved.map(r => r.pos);
    frameAll(points);
    savedOsmFocus = osmRecede(points);
    mask = applyMask(resolved.map(r => r.key), (opts.durationMs ?? 12000) + 4000);
    buildCallouts(resolved);
    document.body.classList.add('explaining'); vignette.classList.add('show'); showCard(opts.text || '');
    active = true; armExit(opts.durationMs ?? 12000);
    return true;
  }
  function exit(opts = {}) {
    if (!active) { if (opts.clearCallouts) clearCallouts(); return false; }
    active = false; teardownVisual(); if (opts.clearCallouts) clearCallouts();
    return true;
  }
  function onAnswer(turn, text, keys) { // turn is accepted for API symmetry with ui.type(turn,text); keys lets the orchestrator pass explicit references, since ui.js exposes no public callout list
    const set = new Set(keys || []);
    if (layers && layers.highlight) { const now = performance.now(); for (const [k, until] of layers.highlight) if (until > now) set.add(k); }
    const list = [...set]; if (!list.length) return false;
    return enter(list, { text });
  }
  function setTheme(t) { theme = t === 'light' ? 'light' : 'dark'; card.classList.toggle('light', theme === 'light'); vignette.classList.toggle('light', theme === 'light'); }

  return { enter, exit, onAnswer, setTheme, get active() { return active; } };
}
