// Map icons as inline SVG data URIs (stroke-based, 24px grid), tinted per layer. Used for Cesium billboards and the rail legend.
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
  const k = `${name}|${color}|${size}|${opts.bg || ''}`; if (cache.has(k)) return cache.get(k);
  const body = SVGS[name] || SVGS.pin; const bg = opts.bg === false ? '' : `<circle cx="12" cy="12" r="11" fill="${opts.bg || 'rgba(3,7,18,0.72)'}" stroke="${color}" stroke-opacity=".9" stroke-width="1.4"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${bg}<g transform="translate(12 12) scale(0.62) translate(-12 -12)">${body}</g></svg>`;
  const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); cache.set(k, uri); return uri;
}
export const ICON_NAMES = Object.keys(SVGS);

// PickPeak-style cluster bubble: brand-blue disc, white count "N 棟"
const clusterCache = new Map();
export function clusterImage(n) {
  if (clusterCache.has(n)) return clusterCache.get(n);
  const size = n >= 10 ? 112 : 92; const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); const r = size / 2 - 4;
  g.beginPath(); g.arc(size / 2, size / 2, r + 3, 0, Math.PI * 2); g.fillStyle = 'rgba(22,164,192,0.28)'; g.fill();
  g.beginPath(); g.arc(size / 2, size / 2, r, 0, Math.PI * 2); g.fillStyle = 'rgba(22,164,192,0.92)'; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
  g.fillStyle = '#FFFFFF'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${n >= 10 ? 30 : 26}px Inter, "Noto Sans TC", sans-serif`; g.fillText(String(n), size / 2, size / 2 - (n >= 10 ? 8 : 7));
  g.font = `500 ${n >= 10 ? 18 : 16}px Inter, "Noto Sans TC", sans-serif`; g.fillText('棟', size / 2, size / 2 + (n >= 10 ? 20 : 17));
  const url = c.toDataURL('image/png'); clusterCache.set(n, url); return url;
}
