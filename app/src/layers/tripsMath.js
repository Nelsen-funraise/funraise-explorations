// Pure, Cesium-free math + data helpers for the 企業遷移動線 (trips) layer.
// Kept separate from trips.js (which imports Cesium + ./trips.css) so these can be
// unit-sanity-checked with plain `node` — no browser, no WebGL, no bundler.
const D2R = Math.PI / 180;

/** Equirectangular ground distance in meters between [lon,lat] points (same approximation used by layers/funraise.js's arc()). */
export function groundDistanceM(from, to) {
  const midLat = (from[1] + to[1]) / 2 * D2R;
  const dx = (to[0] - from[0]) * 111320 * Math.cos(midLat);
  const dy = (to[1] - from[1]) * 110540;
  return Math.hypot(dx, dy);
}

/**
 * Sample a lifted (great-circle-ish) arc from `from` to `to` as plain [lon,lat,heightMeters] tuples.
 * Peak height ≈ 12% of ground distance, clamped to [60, 900] m. Returns n+1 points (u = 0..1 inclusive).
 */
export function sampleArc(from, to, n = 48) {
  const dist = groundDistanceM(from, to);
  const peak = Math.max(60, Math.min(900, dist * 0.12));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const lon = from[0] + (to[0] - from[0]) * u;
    const lat = from[1] + (to[1] - from[1]) * u;
    const h = Math.sin(Math.PI * u) * peak;
    pts.push([lon, lat, h]);
  }
  return pts;
}

export function easeInOutCubic(t) {
  t = Math.max(0, Math.min(1, t));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Deterministic 32-bit string hash (company name → stable pseudo-random direction). */
export function hashStr(s) {
  let h = 0; s = String(s || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** A deterministic point ~distM away from `dest`, direction derived from hashing `seed` (e.g. company name + uniform number). */
export function fallbackOrigin(seed, dest, distM = 900) {
  const angle = (hashStr(seed) % 360) * D2R;
  const dLon = (distM * Math.sin(angle)) / (111320 * Math.cos(dest[1] * D2R));
  const dLat = (distM * Math.cos(angle)) / 110540;
  return [dest[0] - dLon, dest[1] - dLat];
}

/** districtCentroids: a Map (or plain object) name → [lon,lat], e.g. FunraiseLayers#districtCentroids. */
function lookupCentroid(districtCentroids, name) {
  if (!districtCentroids || !name) return null;
  if (typeof districtCentroids.get === 'function') return districtCentroids.get(name) || null;
  return districtCentroids[name] || null;
}

/**
 * Resolve a registry_moves record's flight origin:
 *  - real origin district centroid when from_district is known and differs from the destination district
 *  - otherwise a deterministic ~900 m fallback point (approxOrigin: true) so the trip still reads as a move
 */
export function resolveOrigin(mv, districtCentroids, fallbackDistM = 900) {
  const dest = [mv.lon, mv.lat];
  const from = mv.from_district || null;
  if (from && from !== mv.district) {
    const c = lookupCentroid(districtCentroids, from);
    if (c) return { origin: c, approxOrigin: false, fromDistrict: from };
  }
  const seed = `${mv.company_name || ''}${mv.uniform_number || ''}`;
  return { origin: fallbackOrigin(seed, dest, fallbackDistM), approxOrigin: true, fromDistrict: from };
}

/** Parse a registry_moves `date` ("YYYY-MM-DD", or minguo "YYY年…") into a Gregorian year. Mirrors layers/funraise.js's yearOf(). */
export function yearOfMove(mv) {
  const s = mv && mv.date; if (!s) return null;
  const m = String(s).match(/(\d{4})/); if (m) return +m[1];
  const r = String(s).match(/^(\d{3})/); return r ? +r[1] + 1911 : null;
}

/** Group registry_moves by Gregorian year → Map<year, moves[]>. Moves with no parseable date are skipped. */
export function groupByYear(moves) {
  const map = new Map();
  for (const mv of moves || []) {
    const y = yearOfMove(mv); if (y == null) continue;
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(mv);
  }
  return map;
}

/** Pick (and order) the batch of moves a play() call should fire: filtered by year (if given), sorted chronologically, capped to `max`. */
export function pickBatch(moves, { year = null, max = 14 } = {}) {
  const filtered = (moves || []).filter(m => m && m.lon != null && m.lat != null && (year == null || yearOfMove(m) === year));
  const sorted = [...filtered].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.company_name || '').localeCompare(b.company_name || ''));
  return sorted.slice(0, Math.max(0, max | 0));
}

/**
 * Summarize a fired batch: { fired, byDistrict: {destDistrict: n}, netFlow: [{district,in,out,net}], approxOrigin }.
 * `entries` = [{ toDistrict, fromDistrict, approxOrigin }] (one per fired trip).
 */
export function summarize(entries) {
  const byDistrict = {}; const flows = new Map(); let approxOrigin = 0;
  const bump = (d, key) => { if (!d) return; if (!flows.has(d)) flows.set(d, { district: d, in: 0, out: 0 }); flows.get(d)[key]++; };
  for (const e of entries || []) {
    byDistrict[e.toDistrict] = (byDistrict[e.toDistrict] || 0) + 1;
    bump(e.toDistrict, 'in');
    if (e.fromDistrict && !e.approxOrigin) bump(e.fromDistrict, 'out');
    if (e.approxOrigin) approxOrigin++;
  }
  const netFlow = [...flows.values()].map(f => ({ ...f, net: f.in - f.out })).sort((a, b) => b.net - a.net);
  return { fired: (entries || []).length, byDistrict, netFlow, approxOrigin };
}

/** Company short name: same regex as layers/funraise.js's buildMoves() label — strip the legal-entity suffix. */
export function shortCompanyName(name) {
  return (name || '').replace(/股份有限公司|有限公司/, '');
}
