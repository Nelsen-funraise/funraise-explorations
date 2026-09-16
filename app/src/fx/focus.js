// 對焦／X-ray 模式 (focus): when one building is under diligence, everything else recedes so the asset and its
// immediate context are the only things that read. The OSM city fabric recedes via `osm.focus()` (see
// layers/osmBuildings.js — palette-aware, chunked, idempotent). This module owns the FUNRAISE-layer side of the
// effect: fading distant labels/billboards, drawing a soft ground ring around the focal point, and outlining the
// focused footprint.
//
// Rim-highlight investigation (per task): Cesium's `PostProcessStageLibrary.createSilhouetteStage()` isolates
// geometry via `stage.selected = [feature]`, but that isolation is built on the same per-feature *pick id* pass
// Cesium uses for `scene.pick()` (see @cesium/engine Scene.js's `idTexture`/`idFramebuffer` — the selected-feature
// post-process literally re-renders the picking pass restricted to the selected id(s)). Our OSM footprints are
// batched into a handful of `Cesium.Primitive`s created with `allowPicking: false` (57k buildings — per-instance
// pick colours would be prohibitively expensive), so there is no pick id to select a single footprint with: at best
// `stage.selected = [primitive]` would silhouette an entire ~1500-building chunk, not one building. FUNRAISE `stock`
// entities are individually pickable, but not every focus target is a `stock` entity (osm-only footprints, renewal
// polygons, etc. have no such entity), so relying on silhouette would only work for a subset of cases. Conclusion:
// NOT feasible as a general mechanism → skipped in favour of the documented polyline-outline fallback below.
import * as Cesium from 'cesium';
import './focus.css';

const RING_COLOR = '#16A4C0'; // 藍本藍
const OUTLINE_COLOR = '#F29628'; // 人文橘
const C = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
const distM = (lon1, lat1, lon2, lat2) => Math.hypot((lon1 - lon2) * 111320 * Math.cos(lat2 * Math.PI / 180), (lat1 - lat2) * 110540);
const showVal = (prop) => (prop == null ? true : (typeof prop.getValue === 'function' ? prop.getValue() : !!prop)); // Cesium leaves an unset show as `undefined` (== visible)
const itemLonLat = (viewer, e, item) => {
  if (item && item.lat != null) return [item.lon, item.lat];
  if (item && item._c) return item._c; // renewal units: centroid computed after buildRenewal()
  if (e.position) { try { const c = e.position.getValue(viewer.clock.currentTime); if (c) { const carto = Cesium.Cartographic.fromCartesian(c); return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)]; } } catch { /* dynamic/unresolvable position */ } }
  return null;
};
const findEntity = (layers, key) => { if (!key) return null; if (layers.byKey.has(key)) return layers.byKey.get(key); for (const [k, e] of layers.byKey) if (k.startsWith(key + ':')) return e; return null; };

export function createFocus({ viewer, osm, layers }) {
  const fxDS = new Cesium.CustomDataSource('focus-fx'); viewer.dataSources.add(fxDS);
  let state = null; // { lon, lat, radiusM, key, dimmed:[[entity,'label'|'billboard'], …] }

  function restore() {
    if (!state) return;
    for (const [e, prop] of state.dimmed) { try { if (prop === 'label' && e.label) e.label.show = true; else if (prop === 'billboard' && e.billboard) e.billboard.show = true; } catch { /* entity may since have been removed */ } try { delete e._focusHidden; } catch { /* ignore */ } }
    fxDS.entities.removeAll();
    document.body.classList.remove('focusing');
  }

  function dimOthers(lon, lat, radiusM, key) {
    const dimmed = [];
    for (const ds of Object.values(layers.ds)) for (const e of ds.entities.values) {
      const plProp = e.properties && e.properties.pl; if (!plProp) continue;
      const pl = plProp.getValue(); if (!pl || pl.layer === 'mrt' || pl.key === key) continue; // 捷運站 & 對焦標的本身永遠不淡出
      const pos = itemLonLat(viewer, e, pl.item); if (!pos) continue; // can't localize it → leave untouched
      if (distM(pos[0], pos[1], lon, lat) <= radiusM) continue; // inside radius: stays fully visible (immediate context)
      if (e.label && showVal(e.label.show)) { e.label.show = false; e._focusHidden = true; dimmed.push([e, 'label']); }
      if (e.billboard && showVal(e.billboard.show)) { e.billboard.show = false; e._focusHidden = true; dimmed.push([e, 'billboard']); }
    }
    return dimmed;
  }

  function drawRings(lon, lat, radiusM) {
    const inner = Math.min(150, radiusM * 0.9);
    fxDS.entities.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 0.5), ellipse: { semiMajorAxis: radiusM, semiMinorAxis: radiusM, height: 0.5, material: C(RING_COLOR, 0.18), outline: true, outlineColor: C(RING_COLOR, 0.5), outlineWidth: 1 } });
    if (inner > 6) fxDS.entities.add({ position: Cesium.Cartesian3.fromDegrees(lon, lat, 0.6), ellipse: { semiMajorAxis: inner, semiMinorAxis: inner, height: 0.6, material: C(RING_COLOR, 0.05), outline: true, outlineColor: C(RING_COLOR, 0.4), outlineWidth: 1 } });
  }

  function drawOutline(lon, lat, key, near) {
    if (!near || !near.ring || near.ring.length < 6) return; // no matching OSM footprint here → nothing to outline
    const e = findEntity(layers, key); const pl = e && e.properties && e.properties.pl ? e.properties.pl.getValue() : null;
    const h = (pl && pl.item && pl.item._h) || near.h || 40;
    const flat = []; for (let k = 0; k < near.ring.length; k += 2) flat.push(near.ring[k], near.ring[k + 1], h + 0.8);
    const positions = Cesium.Cartesian3.fromDegreesArrayHeights(flat); positions.push(positions[0]); // close the loop
    fxDS.entities.add({ polyline: { positions, width: 2, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.3, taperPower: 1, color: C(OUTLINE_COLOR, 0.95) }) } });
  }

  const api = {
    enter({ lon, lat, radiusM = 320, key = null } = {}) {
      if (lon == null || lat == null) return null;
      restore(); // idempotent: undo any previous focus before recomputing from scratch (never blends from a receded state)
      const near = osm && osm.nearest ? osm.nearest(lon, lat, 60) : null; // the exact footprint under (lon,lat), if any — shared by osm.focus()'s keepIds and the outline
      if (osm && osm.focus) osm.focus({ lon, lat, radiusM, keepIds: near ? [near.i] : [] });
      const dimmed = dimOthers(lon, lat, radiusM, key);
      drawRings(lon, lat, radiusM);
      drawOutline(lon, lat, key, near);
      document.body.classList.add('focusing');
      if (key && layers.pulse) layers.pulse(key, 8000);
      state = { lon, lat, radiusM, key, dimmed };
      return api.active;
    },
    exit() {
      if (!state) return;
      restore();
      if (osm && osm.unfocus) osm.unfocus();
      state = null;
    },
    get active() { return state ? { lon: state.lon, lat: state.lat, radiusM: state.radiusM, key: state.key } : null; },
    setTheme(t) { if (osm && osm.setPalette) osm.setPalette(t); }, // ring/outline are fixed brand colours; only the OSM receded tone is theme-dependent, and it's re-applied for free (see osmBuildings.js)
  };
  return api;
}
