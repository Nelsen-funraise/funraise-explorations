// intro.js — 開場定軌鏡頭 (cinematic cold open, Google Earth style)
// Three eased camera legs from the boot-time far globe view down to the app's normal Xinyi
// establishing shot, plus a fading title card. Self-contained: pulls in its own stylesheet.
import * as Cesium from 'cesium';
import './intro.css';

const D2R = Math.PI / 180;
const SAFETY_MS = 15000;

export function playIntro({ viewer, rig, home = { lon: 121.5650, lat: 25.0350 }, onDone } = {}) {
  const camera = viewer.camera, canvas = viewer.canvas;
  const target = Cesium.Cartesian3.fromDegrees(home.lon, home.lat, 0);
  const bs = new Cesium.BoundingSphere(target, 1);
  // leg (b) must land exactly on today's rig.flyTo(HOME, { range: 9500, pitch: -55, heading: 20 })
  const FINAL = { heading: 20 * D2R, pitch: -55 * D2R, range: 9500 };

  let stage = 'a';        // 'a' | 'b' | 'c' | 'done'
  let doneCalled = false;
  let driftRaf = 0;
  let safetyTimer = null;
  let card = null;

  const clearSafety = () => { if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; } };
  const fireDone = () => { if (doneCalled) return; doneCalled = true; clearSafety(); if (typeof onDone === 'function') { try { onDone(); } catch (e) { console.warn('[intro] onDone failed', e); } } };
  const stopDrift = () => { if (driftRaf) { cancelAnimationFrame(driftRaf); driftRaf = 0; } try { camera.lookAtTransform(Cesium.Matrix4.IDENTITY); } catch { /* not engaged */ } };
  const removeCardNow = () => { if (card) { card.remove(); card = null; } };
  const fadeCardOut = () => { if (!card) return; const c = card; card = null; c.classList.remove('show'); c.classList.add('hide'); setTimeout(() => c.remove(), 1200); };

  function buildCard() {
    const host = document.getElementById('stage') || document.body;
    const c = document.createElement('div'); c.id = 'titlecard'; c.setAttribute('aria-hidden', 'true');
    c.innerHTML = '<div class="tc-inner"><div class="tc-brand">睿鏡 <em>PeakLens</em></div><div class="tc-sub">對城市說話 · FUNRAISE MCP × PickPeak</div><div class="tc-hint">按任意鍵略過</div></div>';
    host.appendChild(c); return c;
  }
  function showCard() { card = buildCard(); requestAnimationFrame(() => requestAnimationFrame(() => card && card.classList.add('show'))); }

  function onInterrupt() { skip(); }
  function attachListeners() { canvas.addEventListener('pointerdown', onInterrupt, { passive: true }); canvas.addEventListener('wheel', onInterrupt, { passive: true }); window.addEventListener('keydown', onInterrupt); }
  function detachListeners() { canvas.removeEventListener('pointerdown', onInterrupt); canvas.removeEventListener('wheel', onInterrupt); window.removeEventListener('keydown', onInterrupt); }

  // (a) far globe view (set by main.js's boot, ≈1,700 km over Taiwan, straight down) → ~55 km over Taipei, pitch -72°, heading drifts 0→12°
  function legA() {
    stage = 'a'; showCard();
    camera.flyToBoundingSphere(bs, { offset: new Cesium.HeadingPitchRange(12 * D2R, -72 * D2R, 55000), duration: 2.8, easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT, complete: legB });
  }
  // (b) descend & rotate to the 3/4 信義 view — lands exactly on FINAL, so the rest of the app is unaffected
  function legB() {
    if (stage === 'done') return; stage = 'b'; fadeCardOut();
    camera.flyToBoundingSphere(bs, { offset: new Cesium.HeadingPitchRange(FINAL.heading, FINAL.pitch, FINAL.range), duration: 3.4, easingFunction: Cesium.EasingFunction.QUARTIC_OUT, complete: legC });
  }
  // (c) a slow, cancellable 6° heading drift — purely decorative, runs after the hand-off to onDone
  function legC() {
    if (stage === 'done') return;
    fireDone(); // camera is exactly at today's HOME view now — let the rest of the app proceed
    stage = 'c';
    const center = rig.centerPoint() || target;
    const h0 = camera.heading, p0 = camera.pitch, r0 = Cesium.Cartesian3.distance(camera.position, center);
    const h1 = h0 + 6 * D2R; const t0 = performance.now(); const DUR = 6000;
    const step = () => {
      if (stage !== 'c') return;
      const u = Math.min(1, (performance.now() - t0) / DUR);
      camera.lookAt(center, new Cesium.HeadingPitchRange(h0 + (h1 - h0) * u, p0, r0));
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      if (u < 1) driftRaf = requestAnimationFrame(step); else { driftRaf = 0; stage = 'done'; detachListeners(); }
    };
    driftRaf = requestAnimationFrame(step);
  }

  function skip() {
    if (stage === 'done') return; stage = 'done';
    stopDrift(); camera.cancelFlight(); removeCardNow(); detachListeners(); clearSafety();
    camera.flyToBoundingSphere(bs, { offset: new Cesium.HeadingPitchRange(FINAL.heading, FINAL.pitch, FINAL.range), duration: 0.8, easingFunction: Cesium.EasingFunction.QUADRATIC_OUT, complete: fireDone });
  }
  // 15s safety net: if a backgrounded/throttled tab never fires a flight's `complete` callback, force the hand-off.
  function forceFinish() {
    if (stage === 'done') return; stage = 'done';
    stopDrift(); camera.cancelFlight(); removeCardNow(); detachListeners();
    camera.flyToBoundingSphere(bs, { offset: new Cesium.HeadingPitchRange(FINAL.heading, FINAL.pitch, FINAL.range), duration: 0, complete: fireDone });
  }

  attachListeners();
  safetyTimer = setTimeout(forceFinish, SAFETY_MS);
  legA();
  return { skip };
}
