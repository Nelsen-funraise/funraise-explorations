// 樓層視角 (floor walk): first-person "stand on floor N inside a building and look out".
// Takes over the camera + a small HUD while active; restores everything on exit(). No dependency on main.js/ui.js.
import * as Cesium from 'cesium';
import './floorwalk.css';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COMPASS_W = 220, PXDEG = 3; // compass strip: px per degree, matches --width in floorwalk.css .fw-compass

/* ---- flat-earth helpers (same small-distance approximation used elsewhere: osmBuildings.js nearest(), layers/funraise.js arc()/originFor()) ---- */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const distM = (lat1, lon1, lat2, lon2) => Math.hypot((lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * D2R), (lat2 - lat1) * 110540);
const bearingDeg = (lat1, lon1, lat2, lon2) => { const e = (lon2 - lon1) * 111320 * Math.cos(lat1 * D2R), n = (lat2 - lat1) * 110540; return (Math.atan2(e, n) * R2D + 360) % 360; };
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
// move from (lon,lat) toward (tx,ty) by `meters`
const moveToward = (lon, lat, tx, ty, meters) => { const mLon = 111320 * Math.cos(lat * D2R), mLat = 110540; const ex = (tx - lon) * mLon, ny = (ty - lat) * mLat, len = Math.hypot(ex, ny) || 1; return [lon + (ex / len) * meters / mLon, lat + (ny / len) * meters / mLat]; };
// walk `meters` along compass heading (0=N,90=E) from (lon,lat)
const walkOffset = (lon, lat, headingDeg, meters) => { const r = headingDeg * D2R, e = Math.sin(r) * meters, n = Math.cos(r) * meters; return [lon + e / (111320 * Math.cos(lat * D2R)), lat + n / 110540]; };
const squareRing = (lon, lat, half = 15) => { const mLon = 111320 * Math.cos(lat * D2R), mLat = 110540, dx = half / mLon, dy = half / mLat; return [lon - dx, lat - dy, lon + dx, lat - dy, lon + dx, lat + dy, lon - dx, lat + dy]; };
const ringCentroid = (ring) => { let x = 0, y = 0; const n = ring.length / 2; for (let k = 0; k < ring.length; k += 2) { x += ring[k]; y += ring[k + 1]; } return [x / n, y / n]; };
const farthestBearing = (ring, cx, cy) => { let bd = -1, best = 0; for (let k = 0; k < ring.length; k += 2) { const d = distM(cy, cx, ring[k + 1], ring[k]); if (d > bd) { bd = d; best = bearingDeg(cy, cx, ring[k + 1], ring[k]); } } return best; };
// pick the ring edge (midpoint of two consecutive vertices) whose outward bearing from the centroid best matches targetHeading
const pickEdge = (ring, cx, cy, targetHeading) => {
  const n = ring.length / 2; let best = null, bd = 361;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; const mx = (ring[i * 2] + ring[j * 2]) / 2, my = (ring[i * 2 + 1] + ring[j * 2 + 1]) / 2;
    const brg = bearingDeg(cy, cx, my, mx), diff = angDiff(brg, targetHeading); if (diff < bd) { bd = diff; best = { lon: mx, lat: my, bearing: brg }; } }
  return best;
};

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CARDS = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
function tickHtml() { let h = ''; for (let d = -60; d <= 420; d += 30) { const n = ((d % 360) + 360) % 360; const c = CARDS[n]; h += `<span class="fw-tick${c ? ' major' : ''}" style="left:${(d + 60) * PXDEG}px">${c ? `<b>${c}</b>` : ''}</span>`; } return h; }

export function createFloorWalk({ viewer, rig, osm, layers }) {
  const camera = viewer.camera, scc = viewer.scene.screenSpaceCameraController;
  const st = { active: false, lon: 0, lat: 0, originLon: 0, originLat: 0, name: '', floor: 1, floors: 1, floorHeightM: 3.4, heading: 0, defaultHeading: 0, saved: null };
  let hud = null, els = null, mrtCache = null;

  /* ---- nearest / facing MRT, from layers' own mrt datasource (falls back to the raw basemap list) ---- */
  function mrtList() {
    if (mrtCache) return mrtCache;
    const out = []; const ds = layers && layers.ds && layers.ds.mrt;
    if (ds) for (const e of ds.entities.values) { const pl = e.properties && e.properties.pl; if (!pl) continue; let v = null; try { v = pl.getValue(); } catch { v = null; } if (v && v.item && v.item.lat != null) out.push({ name: v.item.name, lon: v.item.lon, lat: v.item.lat }); }
    if (!out.length && layers && layers.base && layers.base.mrt_stations) for (const s of layers.base.mrt_stations) out.push({ name: s.name, lon: s.lon, lat: s.lat });
    mrtCache = out; return out;
  }
  function nearestMrt(lon, lat, maxM) { let best = null, bd = maxM; for (const s of mrtList()) { const d = distM(lat, lon, s.lat, s.lon); if (d < bd) { bd = d; best = s; } } return best; }
  function facingMrt(lon, lat, headingDeg, maxM, sector) { let best = null, bd = maxM; for (const s of mrtList()) { const d = distM(lat, lon, s.lat, s.lon); if (d > maxM) continue; if (angDiff(bearingDeg(lat, lon, s.lat, s.lon), headingDeg) > sector) continue; if (d < bd) { bd = d; best = s; } } return best; }

  /* ---- camera tween: short eases for discrete actions, the initial enter() gets the cinematic 1.6s flight; instant under prefers-reduced-motion ---- */
  function animate(ms, pitchRad, done) {
    const destination = Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.floor * st.floorHeightM + 1.6);
    const orientation = { heading: st.heading * D2R, pitch: pitchRad, roll: 0 };
    if (REDUCE) { camera.setView({ destination, orientation }); done && done(); return; }
    camera.flyTo({ destination, orientation, duration: ms / 1000, easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT, complete: done });
  }

  function setupGestures() {
    st.saved = { enableRotate: scc.enableRotate, enableTranslate: scc.enableTranslate, enableZoom: scc.enableZoom, enableTilt: scc.enableTilt, enableLook: scc.enableLook };
    scc.enableRotate = scc.enableTranslate = scc.enableZoom = scc.enableTilt = scc.enableLook = false;
  }

  /* ---- HUD ---- */
  function buildOrUpdateHud() {
    if (!hud) {
      hud = el('div', 'panel fw-hud'); hud.id = 'floorhud';
      hud.innerHTML = `<div class="fw-top"><div class="fw-name" id="fw-name"></div><button class="fw-exit" id="fw-exit" title="離開樓層視角（Esc）">離開樓層視角 <kbd>Esc</kbd></button></div>
        <div class="fw-body">
          <div class="fw-floorcol"><input id="fw-slider" class="fw-slider" type="range" min="1" max="1" step="1" value="1" aria-label="樓層"><div class="fw-floornum"><span id="fw-n">1</span><span class="fw-f">F</span></div></div>
          <div class="fw-main"><div class="fw-compass"><div class="fw-strip" id="fw-strip">${tickHtml()}</div><div class="fw-needle"></div></div><div class="fw-facing" id="fw-facing"></div><div class="hint">拖曳看四周 · 滾輪換樓層 · W/S 前進 · A/D 轉向</div></div>
        </div>`;
      $('#stage').appendChild(hud);
      els = { name: hud.querySelector('#fw-name'), slider: hud.querySelector('#fw-slider'), n: hud.querySelector('#fw-n'), strip: hud.querySelector('#fw-strip'), facing: hud.querySelector('#fw-facing'), exit: hud.querySelector('#fw-exit') };
      els.exit.onclick = () => exit();
      els.slider.oninput = () => setFloor(+els.slider.value);
    }
    els.name.textContent = st.name || '（未命名建物）';
    els.slider.max = String(st.floors);
    updateHud(true);
  }
  let lastFacingT = 0, facingHtml = '';
  function updateHud(force) {
    if (!els) return;
    const norm = ((st.heading % 360) + 360) % 360;
    els.n.textContent = st.floor; if (document.activeElement !== els.slider) els.slider.value = String(st.floor);
    els.strip.style.transform = `translateX(${(COMPASS_W / 2 - (norm + 60) * PXDEG).toFixed(1)}px)`;
    const now = performance.now();
    if (force || now - lastFacingT > 150) { // facing text is a bit heavier (MRT scan + district point-in-polygon); throttle during continuous drag
      lastFacingT = now;
      const mrt = facingMrt(st.lon, st.lat, norm, 1200, 20);
      const d = layers && layers.districtAt ? layers.districtAt(st.lon, st.lat) : null;
      const bits = []; if (mrt) bits.push('🚇' + esc(mrt.name)); if (d) bits.push(esc(d.name));
      facingHtml = `<span class="mono">${Math.round(norm)}°</span>${bits.length ? ' · ' + bits.join(' · ') : ''}`;
    }
    els.facing.innerHTML = facingHtml;
  }

  /* ---- public API ---- */
  function enter(opts = {}) {
    const { lon, lat, name = '', floors, floorHeightM = 3.4, floor = null, heading = null } = opts;
    rig.stopOrbit();
    const foot = osm ? osm.nearest(lon, lat, 60) : null;
    const ring = foot ? foot.ring : squareRing(lon, lat, 15);
    const [cx, cy] = ringCentroid(ring);
    const floorsN = Math.max(1, Math.round(floors || (foot ? foot.h / floorHeightM : 20)));
    const floor0 = clamp(floor != null ? Math.round(floor) : Math.min(12, floorsN), 1, floorsN);
    let target;
    if (heading != null) target = ((heading % 360) + 360) % 360;
    else { const mrt = nearestMrt(lon, lat, 1500); target = mrt ? bearingDeg(lat, lon, mrt.lat, mrt.lon) : farthestBearing(ring, cx, cy); }
    const edge = pickEdge(ring, cx, cy, target);
    const [elon, elat] = moveToward(edge.lon, edge.lat, cx, cy, 1.5); // 1.5 m inside the wall

    st.lon = elon; st.lat = elat; st.originLon = lon; st.originLat = lat; st.name = name;
    st.floors = floorsN; st.floorHeightM = floorHeightM; st.floor = floor0; st.heading = target; st.defaultHeading = target;

    if (!st.active) setupGestures();
    st.active = true; rig.mode = 'floor';
    buildOrUpdateHud();
    animate(1600, -4 * D2R);
  }
  function setFloor(n) { if (!st.active) return; n = clamp(Math.round(n), 1, st.floors); if (n === st.floor) return; st.floor = n; animate(350, camera.pitch); updateHud(true); }
  function look(headingDeg) { if (!st.active) return; st.heading = ((headingDeg % 360) + 360) % 360; animate(400, camera.pitch); updateHud(true); }
  function step(dir) { const [nlon, nlat] = walkOffset(st.lon, st.lat, st.heading, dir * 3); st.lon = nlon; st.lat = nlat; animate(300, camera.pitch); updateHud(true); }
  function turn(delta) { st.heading = ((st.heading + delta) % 360 + 360) % 360; animate(250, camera.pitch); updateHud(true); }
  function exit() {
    if (!st.active) return;
    st.active = false;
    if (st.saved) { Object.assign(scc, st.saved); st.saved = null; }
    if (hud) { hud.remove(); hud = null; els = null; }
    rig.mode = 'city';
    rig.flyTo(st.originLon, st.originLat, { range: 650, pitch: -35 });
  }

  /* ---- keyboard: capture phase so we run (and can stopPropagation) before ui.js's own bubble-phase shortcuts on window ---- */
  const KEYS = ['w', 's', 'a', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'escape'];
  function onKeyDown(e) {
    if (!st.active) return;
    const tag = e.target && e.target.tagName; if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag || '') || (e.target && e.target.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase(); if (!KEYS.includes(k)) return;
    e.preventDefault(); e.stopPropagation();
    if (k === 'escape') exit();
    else if (k === 'w' || k === 'arrowup') step(1);
    else if (k === 's' || k === 'arrowdown') step(-1);
    else if (k === 'a' || k === 'arrowleft') turn(-6);
    else if (k === 'd' || k === 'arrowright') turn(6);
    else if (k === 'q') setFloor(st.floor - 1);
    else if (k === 'e') setFloor(st.floor + 1);
    else if (k === 'home') look(st.defaultHeading);
  }
  window.addEventListener('keydown', onKeyDown, true);

  /* ---- wheel: change floor, ±1 per notch, time-debounced so a trackpad swipe doesn't jump many floors at once ---- */
  let wheelT = 0;
  function onWheel(e) { if (!st.active) return; e.preventDefault(); const now = performance.now(); if (now - wheelT < 110) return; wheelT = now; setFloor(st.floor + (e.deltaY > 0 ? -1 : 1)); }
  viewer.canvas.addEventListener('wheel', onWheel, { passive: false });

  /* ---- left-drag: look around, applied immediately (no easing) so it tracks the pointer 1:1; pitch clamped [-35°, 45°] ---- */
  let dragging = false, dragX = 0, dragY = 0, dragH = 0, dragP = 0;
  function onPointerDown(e) { if (!st.active || e.button !== 0) return; dragging = true; dragX = e.clientX; dragY = e.clientY; dragH = st.heading; dragP = camera.pitch * R2D; try { viewer.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
  function onPointerMove(e) {
    if (!st.active || !dragging) return;
    const dx = e.clientX - dragX, dy = e.clientY - dragY;
    st.heading = ((dragH + dx * 0.12) % 360 + 360) % 360; const pitch = clamp(dragP - dy * 0.12, -35, 45);
    camera.setView({ orientation: { heading: st.heading * D2R, pitch: pitch * D2R, roll: 0 } });
    updateHud();
  }
  function onPointerUp(e) { if (!dragging) return; dragging = false; try { viewer.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }
  viewer.canvas.addEventListener('pointerdown', onPointerDown);
  viewer.canvas.addEventListener('pointermove', onPointerMove);
  viewer.canvas.addEventListener('pointerup', onPointerUp);
  viewer.canvas.addEventListener('pointercancel', onPointerUp);

  return {
    enter, setFloor, look, exit,
    get active() { return st.active; },
    get state() { return { floor: st.floor, floors: st.floors, heading: st.heading, name: st.name }; },
  };
}
