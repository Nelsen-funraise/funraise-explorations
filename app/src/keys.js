// Phase 11C 線上版金鑰填寫處 — client-side keys a visitor (or the person sharing a hosted build) can supply at runtime,
// without rebuilding: Cesium ion token (實景 3D Tiles／地形), Google Maps key (optional direct Google 3D Tiles), the
// agent server origin (AI 模式／語音／MCP — e.g. a Vercel deployment) and its access code. Build-time VITE_* values
// still work; a runtime value wins so one hosted front end can be pointed at different servers/keys.
// Sources, in order: URL query (?ion=…&gkey=…&api=…&code=…) → absorbed into localStorage on first load and then
// scrubbed from the address bar (so a pasted link doesn't keep the token visible) → localStorage (pl.ion／pl.gkey／
// pl.api／pl.code). Everything is wrapped in try/catch: private mode / blocked storage just means "no runtime keys".
export const KEY_NAMES = ['ion', 'gkey', 'api', 'code'];
const store = k => 'pl.' + k;
export const getKey = k => { try { return localStorage.getItem(store(k)) || ''; } catch { return ''; } };
export const setKey = (k, v) => { try { if (v) localStorage.setItem(store(k), v); else localStorage.removeItem(store(k)); } catch { /* private mode */ } };
export const hasAnyKey = () => KEY_NAMES.some(k => !!getKey(k));
/** Pull ?ion=／?gkey=／?api=／?code= out of the URL into localStorage and rewrite the URL without them (keeps the #hash). */
export function absorbUrlKeys() {
  try {
    const u = new URL(location.href); let touched = false;
    for (const k of KEY_NAMES) { const v = u.searchParams.get(k); if (v != null) { setKey(k, v.trim()); u.searchParams.delete(k); touched = true; } }
    if (touched) history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash);
    return touched;
  } catch { return false; }
}
if (typeof window !== 'undefined') absorbUrlKeys(); // module evaluates before viewer.js reads the ion token (main.js import order)
