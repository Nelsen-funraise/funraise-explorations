// Sun & shadows (日照 / 陰影): time-of-day lighting for the whole city. When a sun hour is set, the scene uses the real sun position for that
// Taipei local time (UTC+8) and every OSM extrusion (plus the renewal envelope) casts shadows onto the ground and its neighbours.
import * as Cesium from 'cesium';
export const SUN_PRESETS = { dawn: { hour: 6.5, name: '清晨', time: '06:30' }, morning: { hour: 9, name: '上午', time: '09:00' }, noon: { hour: 12, name: '正午', time: '12:00' }, golden: { hour: 17, name: '黃金時刻', time: '17:00' }, dusk: { hour: 18.25, name: '暮色', time: '18:15' } };
export const fmtHour = h => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60) % 60; return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };

export function createLighting(viewer, osm) {
  const scene = viewer.scene, clock = viewer.clock; let hour = null, date = new Date(), sweepRaf = null; const extra = new Set();
  const targets = () => [...((osm && osm.primitives) || [])];
  const apply = () => {
    const on = hour != null; viewer.shadows = on; scene.globe.enableLighting = on; scene.globe.dynamicAtmosphereLighting = on; scene.globe.dynamicAtmosphereLightingFromSun = on;
    for (const p of targets()) p.shadows = on ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED;
    for (const g of extra) { try { g.shadows = on ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED; } catch { /* graphics may be gone */ } }
    if (on) {
      const sm = viewer.shadowMap; sm.size = 2048; sm.softShadows = false; sm.darkness = 0.42; sm.maximumDistance = 7000; sm.fadingEnabled = true; sm.normalOffset = true;
      const hh = Math.floor(hour), mm = Math.round((hour - hh) * 60); clock.currentTime = Cesium.JulianDate.fromDate(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hh - 8, mm))); clock.shouldAnimate = false; clock.multiplier = 1;
    } else clock.currentTime = Cesium.JulianDate.now();
    if (scene.requestRenderMode) scene.requestRender();
  };
  const api = {
    presets: SUN_PRESETS, get hour() { return hour; }, get enabled() { return hour != null; }, get date() { return date; },
    set(h, { date: dt } = {}) { if (sweepRaf) { cancelAnimationFrame(sweepRaf); sweepRaf = null; } if (dt instanceof Date) date = dt; hour = h == null || !Number.isFinite(+h) ? null : Math.max(5.5, Math.min(19.5, +h)); apply(); return hour; },
    off() { return api.set(null); },
    preset(id) { const p = SUN_PRESETS[id]; return p ? api.set(p.hour) : api.set(null); },
    addShadowCaster(graphics) { if (graphics) { extra.add(graphics); try { graphics.shadows = hour != null ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED; } catch { /* ignore */ } } },
    sweep({ from = 6.5, to = 18.25, ms = 9000, onTick, onDone } = {}) { // play a whole day: shadows sweep across the city
      if (sweepRaf) cancelAnimationFrame(sweepRaf); const t0 = performance.now();
      const step = () => { const u = Math.min(1, (performance.now() - t0) / ms); const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; hour = from + (to - from) * e; apply(); onTick && onTick(hour); if (u < 1) sweepRaf = requestAnimationFrame(step); else { sweepRaf = null; onDone && onDone(hour); } };
      step();
    },
    get sweeping() { return !!sweepRaf; },
    sunAltitude() { // sun elevation (deg) above the horizon at the camera, for the HUD
      try { const t = clock.currentTime; const inertial = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(t, new Cesium.Cartesian3()); const m = Cesium.Transforms.computeIcrfToFixedMatrix(t) || Cesium.Transforms.computeTemeToPseudoFixedMatrix(t); const fixed = Cesium.Matrix3.multiplyByVector(m, inertial, new Cesium.Cartesian3()); const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(scene.camera.positionWC, new Cesium.Cartesian3()); return Math.round(Math.asin(Cesium.Cartesian3.dot(Cesium.Cartesian3.normalize(fixed, fixed), up)) * 180 / Math.PI); } catch { return null; }
    },
  };
  return api;
}
