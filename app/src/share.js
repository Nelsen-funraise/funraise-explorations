// View-state deep links: the URL hash carries camera + lens + year + theme + density + layers (+ sun hour, scene) so a view can be shared or bookmarked.
// #v=lon,lat,height,heading,pitch&lens=investor&y=2026&t=light&d=balanced&L=stock,mops&sun=17&scene=investor
import * as Cesium from 'cesium';
const D2R = Math.PI / 180;

export function readState(hash = location.hash) {
  const h = String(hash || '').replace(/^#/, ''); if (!h) return null; const p = new URLSearchParams(h); const st = {};
  const v = p.get('v'); if (v) { const a = v.split(',').map(Number); if (a.length === 5 && a.every(Number.isFinite)) st.view = { lon: a[0], lat: a[1], height: a[2], heading: a[3], pitch: a[4] }; }
  for (const k of ['lens', 't', 'd', 'scene']) if (p.get(k)) st[k] = p.get(k);
  if (p.get('y') && Number.isFinite(+p.get('y'))) st.year = +p.get('y');
  if (p.get('L')) st.layers = p.get('L').split(',').filter(Boolean);
  if (p.get('sun') && Number.isFinite(+p.get('sun'))) st.sun = +p.get('sun');
  return Object.keys(st).length ? st : null;
}

export function writeState({ map, ui, agent }) {
  const [lon, lat, h] = map.rig.lonlat;
  const parts = [`v=${lon.toFixed(5)},${lat.toFixed(5)},${Math.round(h)},${(+map.heading).toFixed(1)},${(+map.pitch).toFixed(1)}`];
  if (agent && agent.lens) parts.push('lens=' + agent.lens);
  parts.push('y=' + map.year, 't=' + (ui.theme || 'light'), 'd=' + (ui.density || 'balanced'));
  const L = ui.visibleLayers ? ui.visibleLayers() : []; if (L.length) parts.push('L=' + L.join(','));
  if (ui.sunHour != null) parts.push('sun=' + (+ui.sunHour).toFixed(2).replace(/\.?0+$/, ''));
  const url = location.pathname + location.search + '#' + parts.join('&');
  try { history.replaceState(null, '', url); } catch { /* sandboxed */ }
  return location.origin + url;
}

export function applyView(viewer, view) {
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(view.lon, view.lat, Math.max(30, view.height)), orientation: { heading: view.heading * D2R, pitch: view.pitch * D2R, roll: 0 } });
}

export async function copyLink(url) {
  try { await navigator.clipboard.writeText(url); return true; } catch { /* fall through */ }
  try { const ta = document.createElement('textarea'); ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
}
