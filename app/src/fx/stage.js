// Phase 10Q 場景導演 2.0 — 舞台強調層 (src/fx/stage.js). Owner complaint: 場景裡的虛線/多邊形 highlight 不夠明顯，
// 既然是場景就該主動 take over 確保看得清楚. This module never edits how layers/funraise.js BUILDS entities — it only
// post-processes already-built entity graphics at runtime (same pattern explain.js already uses for its own mask),
// storing small undo closures so every mutation is perfectly reversible. Two independent knobs, both idempotent:
//   emphasize(level, keys) — polylines width×3 + PolylineGlowMaterialProperty, polygon/box/ellipse outline pulse
//     (alpha .35↔.6 · 2.4s @ level 2), billboard/point scale ×1.4 — for the handful of entities a scene step points at.
//   dim(exceptLayers)      — fades every OTHER FUNRAISE layer to ~20% so the emphasized set reads unmistakably;
//     tries layers.setFlatAlpha (billboards/hot-ellipses) first per spec, then also dims polygon/box/ellipse fills
//     directly (setFlatAlpha alone is a no-op for polygon-only layers like renewal/future/tm — see funraise.js).
// restore() undoes both. Read-only against layers.byKey/ds — the only two funraise.js surfaces this file touches.
import * as Cesium from 'cesium';

const TAU = Math.PI * 2;
const getNum = (p, d) => { if (p == null) return d; if (typeof p.getValue === 'function') { try { const v = p.getValue(); return typeof v === 'number' ? v : d; } catch { return d; } } return typeof p === 'number' ? p : d; };
const sampleColor = (mat, fallback) => { try { if (mat && mat.color && typeof mat.color.getValue === 'function') { const c = mat.color.getValue(); if (c) return c.clone(new Cesium.Color()); } if (mat && typeof mat.getValue === 'function') { const v = mat.getValue(); if (v && v.color) return v.color.clone(new Cesium.Color()); } } catch { /* dynamic/unreadable material */ } return Cesium.Color.fromCssColorString(fallback); };
const pulseAlpha = (lo, hi, periodS) => lo + (hi - lo) * (0.5 + 0.5 * Math.sin(performance.now() / 1000 * (TAU / periodS)));

/** Every key in `keys` resolved to every matching entity in layers.byKey — bidirectional prefix match (same rule
 * explain.js's keyMatches uses), so a bare 'renewal:id' also reaches its ring sub-entities 'renewal:id:0','...:1',… */
function matchingEntities(layers, keys) {
  const want = [...new Set((keys || []).filter(Boolean))]; if (!want.length) return [];
  const out = new Set();
  for (const [k, e] of layers.byKey) for (const w of want) if (k === w || k.startsWith(w + ':') || w.startsWith(k + ':')) { out.add(e); break; }
  return [...out];
}

export function createStage({ layers }) {
  let undoEmph = [], undoDim = [], flatKeys = new Set();
  const restoreEmphasis = () => { for (const u of undoEmph.splice(0)) try { u(); } catch { /* entity gone since */ } };
  const restoreDim = () => { for (const u of undoDim.splice(0)) try { u(); } catch { /* entity gone since */ } for (const k of flatKeys) try { layers.setFlatAlpha && layers.setFlatAlpha(k, 1); } catch { /* ignore */ } flatKeys.clear(); };

  function emphLine(e, level) {
    const pl = e.polyline; if (!pl) return; const w0 = pl.width, m0 = pl.material; const base = sampleColor(m0, '#50C0D4');
    pl.width = getNum(w0, 2) * (level >= 2 ? 3 : 1.6);
    if (level >= 2) pl.material = new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.35, taperPower: 0.35, color: base.withAlpha(0.95) });
    undoEmph.push(() => { pl.width = w0; pl.material = m0; });
  }
  function emphArea(e, level) {
    const g = e.polygon || e.box || e.ellipse; if (!g) return; let oc0, ow0; try { oc0 = g.outlineColor; ow0 = g.outlineWidth; } catch { return; }
    const base = sampleColor(g.material, '#16A4C0');
    try {
      g.outline = true; g.outlineWidth = Math.max(getNum(ow0, 1), level >= 2 ? 2.5 : 1.8);
      g.outlineColor = level >= 2 ? new Cesium.CallbackProperty(() => base.withAlpha(pulseAlpha(0.35, 0.6, 2.4)), false) : base.withAlpha(0.78);
    } catch { return; }
    undoEmph.push(() => { g.outlineColor = oc0; g.outlineWidth = ow0; });
  }
  function emphPoint(e, level) {
    const f = level >= 2 ? 1.4 : 1.15;
    if (e.billboard) { const s0 = e.billboard.scale; e.billboard.scale = new Cesium.CallbackProperty(() => getNum(s0, 1) * f, false); undoEmph.push(() => { e.billboard.scale = s0; }); }
    if (e.point) { const s0 = e.point.pixelSize; e.point.pixelSize = new Cesium.CallbackProperty(() => getNum(s0, 6) * f, false); undoEmph.push(() => { e.point.pixelSize = s0; }); }
  }
  function dimArea(e, factor) {
    for (const kind of ['polygon', 'box', 'ellipse']) {
      const g = e[kind]; if (!g || !g.material) continue; const m0 = g.material; const base = sampleColor(m0, '#99A1AF');
      g.material = new Cesium.ColorMaterialProperty(base.withAlpha(Math.max(0.03, (base.alpha ?? 0.5) * factor)));
      undoDim.push(() => { g.material = m0; });
    }
  }

  const api = {
    /** level 0 = clear only; 1 = modest bump (×1.6 width /×1.15 icons, static brighter outline); 2 (scene default) =
     * full treatment per docs §18.2. Returns the pl.key of every entity actually touched (debugging/verification). */
    emphasize(level, keys) {
      restoreEmphasis(); if (!level) return [];
      const ents = matchingEntities(layers, keys);
      for (const e of ents) { emphLine(e, level); emphArea(e, level); emphPoint(e, level); }
      return ents.map(e => { try { return e.properties.pl.getValue().key; } catch { return null; } }).filter(Boolean);
    },
    /** Fades every FUNRAISE layer NOT in `exceptLayers` to ~20%: layers.setFlatAlpha where it has something to dim
     * (billboards / hot-tagged ellipses), plus a direct polygon/box/ellipse material fade for the rest (setFlatAlpha
     * is a no-op there) — reversed together by restore(). */
    dim(exceptLayers) {
      restoreDim(); const except = new Set(exceptLayers || []);
      for (const k of Object.keys(layers.vis || {})) {
        if (except.has(k) || !layers.ds[k]) continue;
        if (typeof layers.setFlatAlpha === 'function') { layers.setFlatAlpha(k, 0.2); flatKeys.add(k); }
        for (const e of layers.ds[k].entities.values) dimArea(e, 0.2);
      }
    },
    restore() { restoreEmphasis(); restoreDim(); },
  };
  return api;
}
