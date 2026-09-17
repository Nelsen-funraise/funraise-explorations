// Map icons as inline SVG "glass chips" (Phase 10R Harmony, docs/11-v2-cesium-app.md §18.3): outer 1.5px ring + 12%
// tinted fill + crisp glyph + a soft outer glow, all baked into one cached data-URI image so Cesium billboards get
// the glass look for free (no per-frame cost — one PNG/SVG per name+color+size+variant, same caching contract as
// before). Every layer (stock/cluster/mops/licenses/infra/renewal/zones/parks/mrt) shares this one construction and
// only differs by hue, so the whole map reads as one system instead of flat filled dots. opts.bg (a css color
// string) switches to the light-theme solid-disc variant (used by funraise.js's setTheme() on white/photoreal
// basemaps, where a translucent glow would wash out); opts.bg===false skips the disc entirely (glyph only).
const SVGS = {
  deal: '<path d="M12 2l9 10-9 10L3 12z"/><path d="M9 12h6M12 9v6"/>',                       // 上市櫃資產交易
  permit: '<path d="M4 20h16"/><path d="M6 20V9l6-5 6 5v11"/><path d="M10 20v-5h4v5"/><path d="M9 12h.01M15 12h.01"/>', // 建照（即將開工）
  crane: '<path d="M4 21h16"/><path d="M8 21V6l10-3"/><path d="M8 9h9"/><path d="M17 9v5"/><path d="M15 14h4"/><path d="M8 6H5"/>',   // 公共建設
  factory: '<path d="M3 21V10l5 3V10l5 3V10l5 3v8"/><path d="M3 21h18"/><path d="M7 21v-4M11 21v-4M15 21v-4"/>',       // 產業園區
  arrow: '<path d="M5 12h12"/><path d="M13 6l6 6-6 6"/>',                                     // 企業遷徙
  coin: '<circle cx="12" cy="12" r="9"/><path d="M9 9h6M9 15h6M12 7v10"/>',                   // 商圈行情
  metro: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14"/><path d="M9 14h.01M15 14h.01"/><path d="M8 21l2-3M16 21l-2-3"/>', // 捷運
  renew: '<path d="M4 20V8l8-5 8 5v12"/><path d="M4 20h16"/><path d="M9 20v-6h6v6"/><path d="M16 4l4 2"/>',  // 都更
  ghost: '<path d="M6 21V9a6 6 0 0 1 12 0v12l-3-2-3 2-3-2-3 2z"/><path d="M10 10h.01M14 10h.01"/>',          // 未來供給
  pin: '<path d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  parcel: '<path d="M4 6l7-3 9 4-7 3z"/><path d="M4 6v12l7 3V9"/><path d="M11 21l9-4V7"/>',                    // 地號
  tower: '<path d="M7 21V7l5-3 5 3v14"/><path d="M4 21h16"/><path d="M10 9h1M13 9h1M10 12h1M13 12h1M10 15h1M13 15h1"/><path d="M12 4V2"/>', // 商辦
};
const cache = new Map();
export function icon(name, color = '#F3F4F6', size = 32, opts = {}) {
  const bg = opts.bg; const noDisc = bg === false; const glow = opts.glow !== false && !bg && !noDisc;
  const k = `${name}|${color}|${size}|${bg || ''}|${glow ? 1 : 0}`; if (cache.has(k)) return cache.get(k);
  const body = SVGS[name] || SVGS.pin; const c = size / 2;
  const R = size * 0.30, sw = Math.max(1, size * 0.054); // chip ring: ~1.5px at typical ~28px display size
  const gScale = size / 24 * 0.5; // glyph authored on a 24-unit grid; scaled + recentred into the chip
  const gStroke = Math.max(0.75, (size * 0.075) / gScale); // effective glyph stroke ≈ same weight as the ring, pre-divided by the group's own scale
  const glowR = size * 0.5;
  const disc = noDisc ? '' : `<circle cx="${c}" cy="${c}" r="${R.toFixed(2)}" fill="${bg || color}" fill-opacity="${bg ? 1 : 0.12}" stroke="${color}" stroke-width="${sw.toFixed(2)}" stroke-opacity="${bg ? 0.85 : 0.92}"/>`;
  const haze = glow ? `<circle cx="${c}" cy="${c}" r="${glowR.toFixed(2)}" fill="url(#g)"/>` : '';
  const defs = glow ? `<defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${color}" stop-opacity=".35"/><stop offset="52%" stop-color="${color}" stop-opacity=".14"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>` : '';
  const glyph = `<g fill="none" stroke="${color}" stroke-width="${gStroke.toFixed(3)}" stroke-linecap="round" stroke-linejoin="round" transform="translate(${c} ${c}) scale(${gScale.toFixed(4)}) translate(-12 -12)">${body}</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${defs}${haze}${disc}${glyph}</svg>`;
  const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); cache.set(k, uri); return uri;
}
export const ICON_NAMES = Object.keys(SVGS);

// Cluster bubble ("N 棟"): a frosted-glass disc (soft brand-blue outer glow → translucent white/blue frosted fill →
// thin bright ring) with mono digits, replacing the old flat 92%-opaque blue disc — reads as the same glass material
// as the chip icons above, just bigger and theme-agnostic (translucent enough to work on both light and dark basemaps).
const clusterCache = new Map();
export function clusterImage(n) {
  if (clusterCache.has(n)) return clusterCache.get(n);
  const size = n >= 10 ? 116 : 96; const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size / 2 - 6;
  const glow = g.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 1.32); glow.addColorStop(0, 'rgba(22,164,192,.32)'); glow.addColorStop(1, 'rgba(22,164,192,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, r * 1.32, 0, Math.PI * 2); g.fill();
  const frost = g.createRadialGradient(cx, cy - r * 0.32, r * 0.1, cx, cy, r); frost.addColorStop(0, 'rgba(255,255,255,.42)'); frost.addColorStop(.55, 'rgba(225,247,250,.26)'); frost.addColorStop(1, 'rgba(22,164,192,.24)');
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = frost; g.fill();
  g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,.8)'; g.stroke();
  g.beginPath(); g.arc(cx, cy, r - 2, 0, Math.PI * 2); g.lineWidth = 1; g.strokeStyle = 'rgba(22,164,192,.7)'; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#F3F4F6';
  g.font = `700 ${n >= 10 ? 32 : 28}px "SF Mono", ui-monospace, Menlo, monospace`; g.fillText(String(n), cx, cy - (n >= 10 ? 8 : 7));
  g.font = `600 ${n >= 10 ? 16 : 14}px "SF Mono", ui-monospace, Menlo, monospace`; g.fillStyle = 'rgba(243,244,246,.82)'; g.fillText('棟', cx, cy + (n >= 10 ? 19 : 17));
  const url = c.toDataURL('image/png'); clusterCache.set(n, url); return url;
}
