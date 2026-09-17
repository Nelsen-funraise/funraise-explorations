// Single place for talking to the agent server: base URL (VITE_API_BASE for a hosted server, '' when same-origin) and the optional access code.
// When the server runs with PEAKLENS_ACCESS_CODE, every /api call must carry it; the first 401 asks the visitor once and remembers the answer.
export const API = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const KEY = 'pl.code';
export const getCode = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setCode = (c) => { try { if (c) localStorage.setItem(KEY, c); else localStorage.removeItem(KEY); } catch { /* private mode */ } };
export const apiUrl = (path, params = {}) => { const u = new URL(API + path, location.href); for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v); const c = getCode(); if (c) u.searchParams.set('code', c); return u.toString(); };
let asking = null;
async function askCode(reason) {
  if (asking) return asking;
  asking = (async () => { const c = window.prompt(reason || '這個 PeakLens server 需要存取碼（向分享給你的人索取）：', getCode() || ''); if (c != null) setCode(c.trim()); asking = null; return c != null; })();
  return asking;
}
export async function apiFetch(path, init = {}, { retry = true } = {}) {
  const headers = { ...(init.headers || {}) }; const c = getCode(); if (c) headers['x-peaklens-code'] = c;
  const r = await fetch(API + path, { ...init, headers });
  if (r.status === 401 && retry) { let j = null; try { j = await r.clone().json(); } catch { /* not json */ } if (j && j.need_code) { const ok = await askCode(j.error); if (ok && getCode()) return apiFetch(path, init, { retry: false }); } }
  return r;
}
