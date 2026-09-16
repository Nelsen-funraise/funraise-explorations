// 企業遷移動線 — animated "trips" for registry_moves (company relocations): glowing arc, a bright
// travelling head with a fading trail, and a landing ripple + label at the destination.
// Self-contained: its own CustomDataSource, its own RAF loop (does NOT rely on viewer.clock advancing —
// the sun/shadow feature may freeze clock.currentTime — it drives everything off performance.now()).
import * as Cesium from 'cesium';
import {
  sampleArc, easeInOutCubic, resolveOrigin, pickBatch, summarize, shortCompanyName,
} from './tripsMath.js';
// Re-exported so callers (and the node sanity script) can import the pure helpers straight from this module too.
export { groundDistanceM, sampleArc, easeInOutCubic, hashStr, fallbackOrigin, resolveOrigin, yearOfMove, groupByYear, pickBatch, summarize, shortCompanyName } from './tripsMath.js';

const ORANGE_DARK = '#F29628';  // 人文橘 — dark theme (夜間戰情室): bright on dark basemap
const ORANGE_LIGHT = '#DE7020'; // 人文橘 — light theme (PickPeak 日間): deeper ink for contrast on bright basemap
const RIPPLE_BLUE = '#16A4C0';  // 藍本藍 — landing ripple, theme-independent (already used this way across the app)
const MAX_PER_WAVE = 30;        // clamp on `max` so a wave can never approach the ~120-live-entity budget
const RIPPLE_MS = 1200, LABEL_MS = 4000;
const C = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);

/** Small soft radial-glow sprite (canvas → data URI), cached per color — the travelling "head" glyph. */
const glowCache = new Map();
function glowSprite(hex) {
  if (glowCache.has(hex)) return glowCache.get(hex);
  const size = 64; const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'); const r = size / 2; const rgb = hexToRgb(hex);
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${rgb},1)`); grad.addColorStop(0.28, `rgba(${rgb},0.95)`); grad.addColorStop(0.6, `rgba(${rgb},0.32)`); grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  const url = cv.toDataURL('image/png'); glowCache.set(hex, url); return url;
}
function hexToRgb(hex) { const h = hex.replace('#', ''); const n = parseInt(h, 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; }

export class TripsLayer {
  constructor(viewer, data, layers) {
    this.viewer = viewer; this.data = data || {}; this.layers = layers || {};
    this.theme = 'light'; this._visible = true;
    this._trips = []; this._playing = false; this._pausedAt = null; this._raf = null; this._onAllLanded = null;
    this.ds = new Cesium.CustomDataSource('trips'); viewer.dataSources.add(this.ds);
    this.ds.show = this._shouldShow();
  }
  get playing() { return this._playing; }
  _shouldShow() { return this._visible !== false && !(this.layers && this.layers.vis && this.layers.vis.moves === false); }
  _now() { return this._pausedAt != null ? this._pausedAt : performance.now(); }

  setVisible(on) { this._visible = !!on; if (this.ds) this.ds.show = this._shouldShow(); }
  setTheme(theme) { this.theme = theme === 'light' ? 'light' : 'dark'; } // applies to newly-fired trips; a live label re-colors itself (see _land), arc/head/trail of an already-flying trip keep their color for their short (~3–7s) remaining life

  /** Called by the timeline on every year change. Cheap no-op when nothing matches that year (true for all years but 2026 in the current snapshot). */
  setYear(y) { return this.play({ year: y }); }

  /**
   * Fire trips: those whose date's year == year (if given), else all — at most `max`, staggered by `staggerMs`.
   * Always returns a Promise resolving to { fired, byDistrict, netFlow, approxOrigin } once every fired trip has landed
   * (or immediately if nothing was fired / the layer is hidden). Each call starts a fresh wave (clears any previous one).
   */
  async play(opts = {}) {
    const { year = null, staggerMs = 180, durationMs = 2600, max = 14 } = opts || {};
    this.clear();
    if (!this._shouldShow()) return summarize([]);
    const rawMax = Number.isFinite(max) ? Math.trunc(max) : 14;
    const cappedMax = Math.min(Math.max(0, rawMax), MAX_PER_WAVE);
    const batch = pickBatch(this.data.registry_moves, { year, max: cappedMax });
    if (!batch.length) return summarize([]);

    const now0 = performance.now();
    const trips = batch.map((mv, i) => this._makeTrip(mv, i, staggerMs, durationMs, now0));
    const summary = summarize(trips.map(t => ({ toDistrict: t.mv.district, fromDistrict: t.fromDistrict, approxOrigin: t.approxOrigin })));
    this._trips = trips; this._playing = true; this._pausedAt = null;
    return new Promise(resolve => {
      this._onAllLanded = () => { this._onAllLanded = null; this._playing = false; resolve(summary); };
      this._startLoop();
    });
  }

  /** Pause in place (freezes every in-flight visual at its current position); does not remove entities. Resolves any pending play() promise so callers never hang. */
  stop() {
    this._pausedAt = this._now(); this._stopLoop(); this._playing = false;
    if (this._onAllLanded) { const cb = this._onAllLanded; this._onAllLanded = null; cb(); }
  }
  /** Remove every trip entity and reset. Resolves any pending play() promise so callers never hang. */
  clear() {
    this._stopLoop();
    if (this._onAllLanded) { const cb = this._onAllLanded; this._onAllLanded = null; cb(); }
    if (this.ds) this.ds.entities.removeAll();
    this._trips = []; this._playing = false; this._pausedAt = null;
  }

  _makeTrip(mv, i, staggerMs, durationMs, now0) {
    const dest = [mv.lon, mv.lat];
    const { origin, approxOrigin, fromDistrict } = resolveOrigin(mv, this.layers.districtCentroids);
    const samples = sampleArc(origin, dest, 48);
    const cartesians = samples.map(p => Cesium.Cartesian3.fromDegrees(p[0], p[1], Math.max(0, p[2])));
    return {
      mv, dest, origin, approxOrigin, fromDistrict, cartesians,
      fireAt: now0 + i * staggerMs, duration: Math.max(400, durationMs),
      state: 'pending', startAt: null, landedAt: null, rippleGone: false,
      arcEnt: null, headEnt: null, trailEnt: null, rippleEnt: null, labelEnt: null,
    };
  }
  _headColorHex() { return this.theme === 'light' ? ORANGE_LIGHT : ORANGE_DARK; }

  _startLoop() { if (this._raf) return; const step = () => { this._raf = requestAnimationFrame(step); this._update(); }; this._raf = requestAnimationFrame(step); }
  _stopLoop() { if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; } }

  _update() {
    if (this.ds) this.ds.show = this._shouldShow();
    if (!this._trips.length) { this._stopLoop(); return; }
    const now = this._now(); let landed = 0, total = this._trips.length;
    for (const t of this._trips) {
      if (t.state === 'pending') { if (now >= t.fireAt) this._begin(t, now); }
      else if (t.state === 'flying') { if ((now - t.startAt) / t.duration >= 1) this._land(t, now); }
      if (t.state === 'landed' || t.state === 'done') {
        landed++;
        const dt = now - t.landedAt;
        if (!t.rippleGone && dt >= RIPPLE_MS) { this._removeEnt(t, 'rippleEnt'); t.rippleGone = true; }
        if (t.state !== 'done' && dt >= LABEL_MS) { this._removeEnt(t, 'labelEnt'); this._removeEnt(t, 'arcEnt'); t.state = 'done'; }
      }
    }
    if (landed === total && this._onAllLanded) { const cb = this._onAllLanded; this._onAllLanded = null; cb(); }
    if (this._trips.every(t => t.state === 'done')) { this._trips = []; this._stopLoop(); }
  }
  _removeEnt(t, field) { if (t[field]) { this.ds.entities.remove(t[field]); t[field] = null; } }

  _begin(t, now) {
    t.state = 'flying'; t.startAt = now;
    const headHex = this._headColorHex(); const arcAlpha = this.theme === 'light' ? 0.5 : 0.32;
    t.arcEnt = this.ds.entities.add({ polyline: { positions: t.cartesians, width: 2, arcType: Cesium.ArcType.NONE, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.12, color: C(headHex, arcAlpha) }) } });
    t.headEnt = this.ds.entities.add({
      position: new Cesium.CallbackProperty(() => this._headPos(t), false),
      billboard: { image: glowSprite(headHex), width: 22, height: 22, disableDepthTestDistance: Number.POSITIVE_INFINITY, scaleByDistance: new Cesium.NearFarScalar(500, 1.15, 20000, 0.45) },
    });
    t.trailEnt = this.ds.entities.add({ polyline: { positions: new Cesium.CallbackProperty(() => this._trailPos(t), false), width: 3, arcType: Cesium.ArcType.NONE, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.35, taperPower: 0.35, color: C(headHex, 0.85) }) } });
  }
  _headPos(t) {
    const raw = (this._now() - t.startAt) / t.duration; const u = easeInOutCubic(raw);
    const n = t.cartesians.length - 1; const f = u * n; const i0 = Math.min(n - 1, Math.floor(f)); const i1 = Math.min(n, i0 + 1);
    return Cesium.Cartesian3.lerp(t.cartesians[i0], t.cartesians[i1], f - i0, new Cesium.Cartesian3());
  }
  _trailPos(t) {
    const raw = (this._now() - t.startAt) / t.duration; const u = easeInOutCubic(raw);
    const n = t.cartesians.length - 1; const i0 = Math.min(n, Math.floor(u * n));
    const arr = t.cartesians.slice(Math.max(0, i0 - 9), i0 + 1); arr.push(this._headPos(t));
    return arr.length >= 2 ? arr : [t.cartesians[0], t.cartesians[0]];
  }

  _land(t, now) {
    t.state = 'landed'; t.landedAt = now;
    this._removeEnt(t, 'headEnt'); this._removeEnt(t, 'trailEnt');
    const [lon, lat] = t.dest;
    t.rippleEnt = this.ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 1),
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => this._rippleRadius(t), false), semiMinorAxis: new Cesium.CallbackProperty(() => this._rippleRadius(t), false), height: 0.5,
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => C(RIPPLE_BLUE, this._rippleAlpha(t)), false)),
        outline: true, outlineColor: new Cesium.CallbackProperty(() => C('#E3F8FA', this._rippleAlpha(t) * 0.9), false),
      },
    });
    t.labelEnt = this.ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 30),
      label: {
        text: shortCompanyName(t.mv.company_name), font: '600 13px "Inter","Noto Sans TC",sans-serif',
        fillColor: new Cesium.CallbackProperty(() => C(this.theme === 'light' ? ORANGE_LIGHT : ORANGE_DARK, this._labelAlpha(t)), false),
        outlineColor: new Cesium.CallbackProperty(() => C(this.theme === 'light' ? '#FFFFFF' : '#030712', this._labelAlpha(t) * (this.theme === 'light' ? 0.92 : 0.9)), false),
        outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -10),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: new Cesium.CallbackProperty(() => this.theme === 'light', false),
        backgroundColor: new Cesium.CallbackProperty(() => C('#FFFFFF', this._labelAlpha(t) * 0.82), false),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
      },
    });
  }
  _rippleRadius(t) { const u = Math.min(1, (this._now() - t.landedAt) / RIPPLE_MS); return 6 + 130 * (1 - Math.pow(1 - u, 2)); }
  _rippleAlpha(t) { const u = Math.min(1, (this._now() - t.landedAt) / RIPPLE_MS); return 0.5 * (1 - u); }
  _labelAlpha(t) { const u = Math.min(1, (this._now() - t.landedAt) / LABEL_MS); return u < 0.6 ? 1 : Math.max(0, 1 - (u - 0.6) / 0.4); }
}
