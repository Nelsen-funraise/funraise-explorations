#!/usr/bin/env node
// PeakLens agent server — Claude (official Anthropic SDK) + FUNRAISE MCP (OAuth 2.1 connector) + camera/layer tools executed by the browser.
// Routes:
//   GET  /api/health            → { ok, model, mcp: { status: live|unauthorized|unreachable|error, ... } }
//   GET  /api/mcp/authorize     → 302 to the FUNRAISE MCP authorization server (PKCE + dynamic client registration)
//   GET  /api/mcp/callback      → exchanges the code, stores the token, closes the popup
//   POST /api/mcp/logout        → forgets the stored token
//   POST /api/agent {messages, view} → { content, stop_reason, usage, source }
// Product rule: when the MCP is unreachable or unauthorized the app keeps working on the local snapshot and shows the user how to authorize.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createLLM } from './llm.mjs';
import { createSnapshot } from './snapshot.mjs';
import { createCache } from './cache.mjs';
import { createSetup } from './setup.mjs';
import { createOrsRoutes } from './routes/ors.mjs';
import { createLiveRoutes } from './routes/live.mjs';
import { resolveStateDir } from './statedir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
function loadEnv(file) {
  const out = {}; if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue; const eq = line.indexOf('='); if (eq < 0) continue;
    const k = line.slice(0, eq).trim(); let v = line.slice(eq + 1).trim();
    if (/^["']/.test(v)) v = v.slice(1, v.lastIndexOf(v[0]) > 0 ? v.lastIndexOf(v[0]) : undefined); else v = v.replace(/\s+#.*$/, '');
    out[k] = v;
  }
  return out;
}
const ENV_FILE = env_file_path(); const env = { ...loadEnv(ENV_FILE), ...process.env };
function env_file_path() { return process.env.PEAKLENS_ENV_FILE || path.join(root, '.env'); }
const PORT = +(env.PORT || 8790);
// FUNRAISE MCP exposes ~150 tools; importing all of them costs ~22k input tokens per model call. Only the ones 睿鏡 answers with are allowed
// (MCP_ALLOWED_TOOLS=comma list overrides; MCP_ALLOWED_TOOLS=all disables the filter). Paid transcripts/crawl tools are deliberately excluded.
const MCP_ALLOWED_DEFAULT = ['buildings__search_buildings', 'buildings__get_building', 'urban-renewal__search_urban_renewal', 'urban-renewal__get_urban_renewal', 'urban-renewal__aggregate_urban_renewal', 'urban-renewal__urban_renewal_at_point', 'actual-price-sale__search_actual_sales', 'actual-price-sale__aggregate_sales_by_district', 'actual-price-rental__search_actual_rentals', 'mops-property__search_mops_property', 'taipei-licenses__search_taipei_building_licenses', 'taipei-licenses__search_taipei_use_licenses', 'company-registry__search_registry_changes', 'company-registry__aggregate_registry_changes', 'company-registry__get_company_history', 'business-registry__search_business_registry', 'industrial-parks__search_industrial_parks', 'industrial-parks__companies_in_industrial_park', 'public-infras__search_public_infras', 'areas__search_areas', 'areas__get_area', 'land-info__coordinates_by_address', 'land-info__taipei_zoning_at_point', 'land-info__find_taipei_land_at_point', 'future-dev__search_future_dev', 'development-zones__search_development_zones', 'mrt__list_mrt_stations', 'mrt__get_mrt_station', 'key-enterprise__search_key_enterprises', 'stakeholders__search_stakeholders', 'ai-info__search_knowledge'];
const MCP_ALLOWED = () => { const v = (env.MCP_ALLOWED_TOOLS || '').trim(); if (!v) return MCP_ALLOWED_DEFAULT; if (v.toLowerCase() === 'all') return null; return v.split(',').map(x => x.trim()).filter(Boolean); };
let llm = createLLM(env); // provider adapter (OpenAI Responses API or Anthropic Messages API); null until a key is set
export function reloadEnv() { const f = loadEnv(ENV_FILE); for (const k of Object.keys(env)) if (!(k in process.env) && !(k in f)) delete env[k]; Object.assign(env, f, process.env); llm = createLLM(env); return env; }
const MODEL = () => llm ? llm.model : (env.OPENAI_MODEL || env.ANTHROPIC_MODEL || 'none');
const MCP_URL = env.FUNRAISE_MCP_URL || 'https://connector.mcp.funraise.ai/t/hkvmS7xU5N5TnxXalyUUA/mcp';
// Vercel 沒設 PUBLIC_URL 時，用平台自帶的環境變數推：VERCEL_PROJECT_PRODUCTION_URL（正式網域，優先——同一個
// redirect_uri 才能一直沿用同一個 OAuth client）或 VERCEL_URL（單次 deployment 網址，preview 用）；本機／
// Docker 都沒有這兩個變數，維持原本 localhost 預設。
const VERCEL_HOST = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL || '';
const PUBLIC_URL = (env.PUBLIC_URL || (VERCEL_HOST ? `https://${VERCEL_HOST}` : `http://localhost:${PORT}`)).replace(/\/$/, '');
const REDIRECT_URI = `${PUBLIC_URL}/api/mcp/callback`;
// Phase：Vercel — server 目錄在唯讀 function 檔案系統上寫不進去，STATE_DIR 會自動改道 os.tmpdir()
// （見 server/statedir.mjs）；本機／Docker 這裡照舊等於 server 自己，行為完全不變。
const PREFERRED_STATE_DIR = env.PEAKLENS_STATE_DIR || here;
const STATE_DIR = resolveStateDir(PREFERRED_STATE_DIR);
const STATE_IS_TMP = STATE_DIR !== PREFERRED_STATE_DIR;
const TOKEN_FILE = path.join(STATE_DIR, '.mcp-token.json');

/* ---------------- Phase 9G snapshot-first data layer (server/snapshot.mjs) ----------------
   Owner's complaint: 「資料大部分要先有個快照在上面，不用每次都要去呼叫 tools」. SNAPSHOT loads public/data/peaklens.json
   (+ timeseries.json once the other agent building it lands) ONCE at boot; the query_snapshot tool below lets the
   model answer from it instead of round-tripping FUNRAISE MCP. CACHE memoizes query_snapshot(input) results (see
   server/cache.mjs's header comment for why it can't yet cache the MCP calls themselves). */
const SNAPSHOT = createSnapshot({ dataDir: env.PEAKLENS_DATA_DIR });
const CACHE = createCache({ max: 200, ttlMs: (+(env.MCP_CACHE_TTL_S || 600)) * 1000 });
function cachedSnapshotQuery(input) {
  const key = CACHE.key('query_snapshot', input); const hit = CACHE.get(key); if (hit) return hit;
  const out = SNAPSHOT.query(input); CACHE.set(key, out); return out;
}

/* ---------------- Fish Audio TTS (server-side key, on-disk cache) ---------------- */
const FISH_KEY_ = () => env.FISH_API_KEY || ''; const FISH_MODEL_ = () => env.FISH_MODEL || 's2.1-pro-free';
export const DEFAULT_VOICES = [
  { id: 'nelsen', name: 'Nelsen', desc: '陳致瑋 · 沉穩敘事（帳號內聲音模型）', fish: 'ebebcafee7784ad6b5b1205723f936de', gender: 'male' },
  { id: 'eunice', name: 'Eunice', desc: '溫暖親切的台灣女聲（帳號內聲音模型）', fish: '0883de2699424fb5a19f84631d6d4c0d', gender: 'female' },
  { id: 'twf', name: '台灣腔女生', desc: '清晰專業的台灣女聲（Fish Audio 公開模型）', fish: '3cb8677aa52f4792b0153422dbf4e14b', gender: 'female' },
];
let VOICES = DEFAULT_VOICES; try { if (env.FISH_VOICES) VOICES = JSON.parse(env.FISH_VOICES); } catch { console.warn('[tts] FISH_VOICES is not valid JSON; using defaults'); }
const TTS_CACHE = path.join(STATE_DIR, '.tts-cache'); try { fs.mkdirSync(TTS_CACHE, { recursive: true }); } catch (e) { console.warn('[tts] cache dir unavailable, TTS 快取這次開機關掉:', e.message); }
export const fnv1a = (str) => { let h = 0x811c9dc5; for (const c of Buffer.from(str, 'utf8')) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
export async function synthesize(text, voiceId, { speed = 1 } = {}) {
  const v = VOICES.find(x => x.id === voiceId) || VOICES[0]; if (!FISH_KEY_()) throw Object.assign(new Error('FISH_API_KEY not set'), { status: 503 });
  text = String(text || '').trim().slice(0, 800); if (!text) throw Object.assign(new Error('empty text'), { status: 400 });
  const key = fnv1a(v.fish + '|' + speed + '|' + text); const file = path.join(TTS_CACHE, key + '.mp3');
  if (fs.existsSync(file)) return { file, cached: true, voice: v };
  const r = await fetch('https://api.fish.audio/v1/tts', { method: 'POST', headers: { authorization: `Bearer ${FISH_KEY_()}`, 'content-type': 'application/json', model: FISH_MODEL_() }, body: JSON.stringify({ text, reference_id: v.fish, format: 'mp3', mp3_bitrate: 64, latency: 'balanced', normalize: true, prosody: { speed } }), signal: AbortSignal.timeout(60000) });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw Object.assign(new Error(`fish ${r.status}: ${t.slice(0, 160)}`), { status: r.status === 402 ? 402 : 502 }); }
  const buf = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(file, buf); return { file, cached: false, voice: v };
}

/* ---------------- token store ---------------- */
const store = {
  load() { try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; } },
  save(t) { try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 }); } catch (e) { console.warn('[mcp] token 存檔失敗（' + STATE_DIR + '）：' + e.message); } return t; },
  clear() { try { fs.unlinkSync(TOKEN_FILE); } catch { /* none */ } },
};
const staticToken = env.FUNRAISE_MCP_TOKEN ? { access_token: env.FUNRAISE_MCP_TOKEN, static: true } : null;

// Phase：Vercel 沒有持久硬碟時的 MCP token 備援。owner 在自己電腦上 /setup → 授權一次會產生 server/.mcp-token.json；
// FUNRAISE_MCP_TOKEN_JSON 讓他把那份 JSON 整包貼進 Vercel 環境變數，開機時（TOKEN_FILE 還不存在才會做，
// 絕不覆蓋本機已經授權好的真檔案）拿來種一份到 STATE_DIR——STATE_DIR 是 tmp 的話這份種子只活這個 function
// instance 的壽命，重啟要重貼；是真的磁碟（本機／Docker）就直接變成正式 token 檔。
let tokenRotatedOnTmp = false; // refresh 時如果剛好在 tmp 上輪替了 refresh_token，見 tokenRequest() 與 mcpSummary()
if (!staticToken && !fs.existsSync(TOKEN_FILE) && env.FUNRAISE_MCP_TOKEN_JSON) {
  try {
    const seeded = JSON.parse(env.FUNRAISE_MCP_TOKEN_JSON);
    if (seeded && seeded.access_token) { store.save(seeded); console.log(`[mcp] token 已從 FUNRAISE_MCP_TOKEN_JSON 還原（存到 ${STATE_DIR}${STATE_IS_TMP ? '，暫存' : ''}）`); }
    else console.warn('[mcp] FUNRAISE_MCP_TOKEN_JSON 缺 access_token，略過');
  } catch (e) { console.warn('[mcp] FUNRAISE_MCP_TOKEN_JSON 不是合法 JSON：' + e.message); }
}
function tokenPersistMode() { if (staticToken) return 'env'; return store.load() ? (STATE_IS_TMP ? 'tmp' : 'file') : 'none'; }

/* ---------------- OAuth 2.1 discovery (MCP authorization spec) ---------------- */
let metaCache = null;
async function fetchJson(url, init) { const r = await fetch(url, init); const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ } return { status: r.status, headers: r.headers, json, text }; }
async function discover() {
  if (metaCache) return metaCache;
  const u = new URL(MCP_URL); const origin = u.origin;
  let prm = null;
  for (const cand of [`${origin}/.well-known/oauth-protected-resource${u.pathname}`, `${origin}/.well-known/oauth-protected-resource`]) { try { const r = await fetchJson(cand); if (r.status === 200 && r.json) { prm = r.json; break; } } catch { /* next */ } }
  const as = (prm && prm.authorization_servers && prm.authorization_servers[0]) || origin;
  let meta = null;
  for (const cand of [`${as.replace(/\/$/, '')}/.well-known/oauth-authorization-server`, `${as.replace(/\/$/, '')}/.well-known/openid-configuration`]) { try { const r = await fetchJson(cand); if (r.status === 200 && r.json && r.json.authorization_endpoint) { meta = r.json; break; } } catch { /* next */ } }
  if (!meta) throw new Error('OAuth metadata not found for ' + as);
  metaCache = { issuer: meta.issuer || as, authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint, registration_endpoint: meta.registration_endpoint, scopes: (prm && prm.scopes_supported) || meta.scopes_supported || ['mcp'], resource: (prm && prm.resource) || MCP_URL };
  return metaCache;
}
async function ensureClient(meta) {
  if (env.FUNRAISE_MCP_CLIENT_ID) return { client_id: env.FUNRAISE_MCP_CLIENT_ID, client_secret: env.FUNRAISE_MCP_CLIENT_SECRET || null };
  const saved = store.load(); if (saved && saved.client && saved.client.redirect_uri === REDIRECT_URI && saved.client.issuer === meta.issuer) return saved.client;
  if (!meta.registration_endpoint) throw new Error('authorization server offers no dynamic client registration; set FUNRAISE_MCP_CLIENT_ID');
  const r = await fetchJson(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'PeakLens 睿鏡 (local agent server)', redirect_uris: [REDIRECT_URI], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: meta.scopes.join(' ') }) });
  if (!r.json || !r.json.client_id) throw new Error('client registration failed: ' + r.status + ' ' + r.text.slice(0, 200));
  const clientRec = { client_id: r.json.client_id, client_secret: r.json.client_secret || null, redirect_uri: REDIRECT_URI, issuer: meta.issuer };
  store.save({ ...(saved || {}), client: clientRec });
  return clientRec;
}
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pending = new Map(); // state → { verifier, created }
async function beginAuthorize() {
  const meta = await discover(); const c = await ensureClient(meta);
  const verifier = b64url(crypto.randomBytes(32)); const challenge = b64url(crypto.createHash('sha256').update(verifier).digest()); const state = b64url(crypto.randomBytes(16));
  pending.set(state, { verifier, created: Date.now() }); for (const [k, v] of pending) if (Date.now() - v.created > 600000) pending.delete(k);
  const q = new URLSearchParams({ response_type: 'code', client_id: c.client_id, redirect_uri: REDIRECT_URI, code_challenge: challenge, code_challenge_method: 'S256', state, scope: meta.scopes.join(' '), resource: meta.resource });
  return `${meta.authorization_endpoint}?${q}`;
}
async function tokenRequest(params) {
  const meta = await discover(); const saved0 = store.load() || {};
  // A refresh token is bound to the client that obtained it: reuse that client even if REDIRECT_URI (port) changed since —
  // registering a fresh client and refreshing with it yields 400 invalid_grant「Client ID mismatch」(seen in the field).
  const c = (params.grant_type === 'refresh_token' && saved0.token_client && saved0.token_client.client_id) ? saved0.token_client : await ensureClient(meta);
  const body = new URLSearchParams({ ...params, client_id: c.client_id, resource: meta.resource }); if (c.client_secret) body.set('client_secret', c.client_secret);
  const r = await fetchJson(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
  if (!r.json || !r.json.access_token) throw new Error('token endpoint ' + r.status + ': ' + r.text.slice(0, 300));
  const saved = store.load() || {}; const tok = { ...saved, access_token: r.json.access_token, refresh_token: r.json.refresh_token || saved.refresh_token || null, token_type: r.json.token_type || 'Bearer', scope: r.json.scope || meta.scopes.join(' '), expires_at: r.json.expires_in ? Date.now() + r.json.expires_in * 1000 : null, token_client: { client_id: c.client_id, client_secret: c.client_secret || null }, obtained_at: Date.now() };
  store.save(tok);
  // STATE_DIR 是 tmp 備援時，剛剛存的（可能是輪替過的新 refresh_token）這份只活這個 instance——記一筆旗標，
  // /api/health 會提醒 owner 回 /setup 重新匯出 FUNRAISE_MCP_TOKEN_JSON，不然下次冷啟動舊的 env 值可能已經失效。
  if (params.grant_type === 'refresh_token' && STATE_IS_TMP) tokenRotatedOnTmp = true;
  mcpState = { status: 'unknown', checked: 0 }; return tok;
}
async function finishAuthorize(code, state) { const p = pending.get(state); if (!p) throw new Error('unknown or expired state'); pending.delete(state); return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: p.verifier }); }
async function validToken() {
  if (staticToken) return staticToken; const t = store.load(); if (!t || !t.access_token) return null;
  if (t.expires_at && Date.now() > t.expires_at - 60000 && t.refresh_token) { try { return await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token }); } catch (e) { console.warn('[mcp] refresh failed', e.message); if (/invalid_grant|mismatch|400/i.test(e.message)) { store.save({ ...(store.load() || {}), access_token: null, refresh_token: null }); mcpState = { status: 'unauthorized', checked: Date.now(), reason: 'refresh token rejected — 請重新授權' }; } return null; } }
  return t;
}

/* ---------------- MCP probe ---------------- */
let mcpState = { status: 'unknown', checked: 0 };
async function mcpProbe(force = false) {
  if (!force && Date.now() - mcpState.checked < 45000 && mcpState.status !== 'unknown') return mcpState;
  const tok = await validToken();
  if (!tok) { mcpState = { status: 'unauthorized', checked: Date.now(), reason: 'no token' }; return mcpState; }
  try {
    const r = await fetchJson(MCP_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'peaklens-server', version: '2.0' } } }), signal: AbortSignal.timeout(12000) });
    if (r.status === 401 || r.status === 403) { if (!tok.static && !force) { store.save({ ...(store.load() || {}), access_token: null }); } mcpState = { status: 'unauthorized', checked: Date.now(), reason: r.json && r.json.error_description || 'invalid token' }; }
    else if (r.status >= 200 && r.status < 300) { let info = null; try { const m = r.text.match(/data:\s*(\{.*\})/); info = (r.json || (m && JSON.parse(m[1])) || {}).result || null; } catch { /* sse */ } mcpState = { status: 'live', checked: Date.now(), server: info && info.serverInfo ? info.serverInfo : null, expires_at: tok.expires_at || null }; }
    else mcpState = { status: 'error', checked: Date.now(), reason: 'HTTP ' + r.status };
  } catch (e) { mcpState = { status: 'unreachable', checked: Date.now(), reason: e.message }; }
  return mcpState;
}
const mcpSummary = s => ({ status: s.status, url: MCP_URL, reason: s.reason || null, server: s.server || null, expires_at: s.expires_at || null, authorize_url: '/api/mcp/authorize', static_token: !!staticToken, persist: tokenPersistMode(), ...(tokenRotatedOnTmp ? { warning: 'refresh token 剛在暫存空間（tmp）被輪替過，這個 function instance 重啟或換機就會遺失——請到 /setup「匯出 MCP token」重新複製，貼回 Vercel 的 FUNRAISE_MCP_TOKEN_JSON。' } : {}) });

/* ---------------- Claude agent ---------------- */
const LAYER_KEYS = ['stock', 'future', 'licenses', 'renewal', 'zones', 'mops', 'moves', 'infra', 'parks', 'heat', 'mrt'];
const CAMERA_TOOLS = [
  { name: 'fly_to', description: '把相機飛到一個地點。可給地名（大樓、商圈、行政區、捷運站、園區，前端會用本地快照解析）或經緯度。', input_schema: { type: 'object', properties: { place: { type: 'string', description: '地名，例如「台北101」「信義計畫區」「內湖科技園區」「南港展覽館站」' }, lon: { type: 'number' }, lat: { type: 'number' }, range_m: { type: 'number', description: '相機到目標的距離（公尺）。單棟 500–900，街廓 1500–3000，行政區 5000–9000，全市 15000' }, pitch: { type: 'number', description: '俯角，-90 為正俯視；街景 -14、單棟 -32、區域 -50、全市 -62' }, heading: { type: 'number', description: '方位角（度）' } } } },
  { name: 'set_camera_mode', description: '切換相機模式：city 俯視、orbit 環繞（可指定地點）、street 街景、globe 全台。', input_schema: { type: 'object', properties: { mode: { type: 'string', enum: ['city', 'orbit', 'street', 'globe'] }, place: { type: 'string' }, range_m: { type: 'number' } }, required: ['mode'] } },
  { name: 'set_lens', description: '切換使用者視角（鏡）：investor 投資人、developer 開發商、occupier 企業選址、city 城市治理、research 學研。會套用該鏡的預設圖層。', input_schema: { type: 'object', properties: { lens: { type: 'string', enum: ['investor', 'developer', 'occupier', 'city', 'research'] } }, required: ['lens'] } },
  { name: 'set_layers', description: `顯示／隱藏圖層。可用鍵：${LAYER_KEYS.join(', ')}（stock 商辦存量、future 未來供給、licenses 建照、renewal 都更單元、zones 重劃區、mops 上市櫃資產交易、moves 企業遷徙、infra 公共建設、parks 產業園區、heat 商圈行情、mrt 捷運）。`, input_schema: { type: 'object', properties: { show: { type: 'array', items: { type: 'string', enum: LAYER_KEYS } }, hide: { type: 'array', items: { type: 'string', enum: LAYER_KEYS } } } } },
  { name: 'set_year', description: '設定時間軸年份（2012–2030）。過去年份只顯示當年已存在的大樓；未來年份讓規劃中建案長高變實體。', input_schema: { type: 'object', properties: { year: { type: 'integer', minimum: 2012, maximum: 2030 } }, required: ['year'] } },
  { name: 'set_sensor', description: '切換畫面感測濾鏡：normal、night 夜視、thermal 熱感、blueprint 藍圖。', input_schema: { type: 'object', properties: { sensor: { type: 'string', enum: ['normal', 'night', 'thermal', 'blueprint'] } }, required: ['sensor'] } },
  { name: 'set_density', description: '切換 HUD 密度：immersive 沉浸（只留地圖與字幕）、balanced 平衡、annotated 標註（資料欄 + 地圖編號標註）。使用者說「沉浸」「乾淨一點」「多一點資料」「標註模式」時使用。', input_schema: { type: 'object', properties: { density: { type: 'string', enum: ['immersive', 'balanced', 'annotated'] } }, required: ['density'] } },
  { name: 'highlight', description: '讓地圖上的物件脈衝發光，並在標註模式下加上編號標註。key 格式：stock:<building_id>、future:<id>、renewal:<id>、mops:<id>、license:<建照號>、move:<統編>、infra:<id>、ipark:<id>、zone:<id>、heat:<area_id>、mrt:<站名>。id 可用 search_local_snapshot 查。', input_schema: { type: 'object', properties: { keys: { type: 'array', items: { type: 'string' } }, ms: { type: 'integer' } }, required: ['keys'] } },
  { name: 'simulate_renewal', description: '智慧都更模擬：對一個都更單元套用地號、使用分區容積率／建蔽率與建照套繪，畫出可建量體並回傳基準容積、獎勵容積、總樓地板、樓層、屋齡與整合難度。使用者說「模擬○○都更」「這個單元可以蓋多高」時使用；unit_id 或 name 其一。', input_schema: { type: 'object', properties: { unit_id: { type: 'string' }, name: { type: 'string', description: '都更單元名稱關鍵字，例如「兒福B1-2」' }, bonus: { type: 'number', description: '容積獎勵比例 0–0.5，預設 0.3' } } } },
  { name: 'set_theme', description: '切換主題：light（PickPeak 日間）或 dark（夜間戰情室）。', input_schema: { type: 'object', properties: { theme: { type: 'string', enum: ['light', 'dark'] } }, required: ['theme'] } },
  { name: 'set_sun', description: '日照與陰影：設定台北當地時刻（hour 5.5–19.5，例如 17 = 黃金時刻）或 preset（dawn/morning/noon/golden/dusk/off）；sweep=true 播放一天的陰影變化。開啟後所有建物與都更量體會投影。', input_schema: { type: 'object', properties: { hour: { type: 'number' }, preset: { type: 'string', enum: ['dawn', 'morning', 'noon', 'golden', 'dusk', 'off'] }, sweep: { type: 'boolean' } } } },
  { name: 'start_tool', description: '啟動量測／畫基地工具：distance 量距離、area 量面積、site 畫基地（完成後自動用手繪範圍模擬容積量體）；off 關閉。使用者要量多遠、量面積、自己畫基地時使用。', input_schema: { type: 'object', properties: { mode: { type: 'string', enum: ['distance', 'area', 'site', 'off'] } }, required: ['mode'] } },
  { name: 'floor_view', description: '樓層視角：第一人稱走進一棟大樓的第幾層向外看。給 key（stock:<building_id>）或 lon/lat＋floors；floor 省略自動挑約 12 樓；exit:true 離開。', input_schema: { type: 'object', properties: { key: { type: 'string' }, lon: { type: 'number' }, lat: { type: 'number' }, name: { type: 'string' }, floors: { type: 'integer' }, floor: { type: 'integer' }, heading: { type: 'number' }, exit: { type: 'boolean' } } } },
  { name: 'show_isochrone', description: '畫出從一個點出發、N 分鐘內搭捷運可到的等時圈（走到站＋每站停靠＋轉乘罰時，內建捷運路網計算，不需外部 API）：範圓圈、可達站、實際路線。用於「從○○搭捷運 20 分鐘能到哪」「等時圈」「通勤圈」。', input_schema: { type: 'object', properties: { place: { type: 'string', description: '地名或站名（沒有座標時用它解析）' }, lon: { type: 'number' }, lat: { type: 'number' }, name: { type: 'string' }, maxMin: { type: 'integer', minimum: 5, maximum: 60 } } } },
  { name: 'set_live_layer', description: '開關即時圖層：youbike（YouBike 2.0 即時站點，可借／可還車柱數，每分鐘更新）。', input_schema: { type: 'object', properties: { layer: { type: 'string', enum: ['youbike'] }, on: { type: 'boolean' } }, required: ['layer', 'on'] } },
  { name: 'get_environment', description: '台北現在天氣（天氣現象、氣溫、濕度、降雨機率、今日溫度範圍）與空氣品質 AQI（可給 lon/lat 挑最近測站）。每 10 分鐘更新；缺金鑰時對應欄位為 null。', input_schema: { type: 'object', properties: { lon: { type: 'number' }, lat: { type: 'number' } } } },
  { name: 'show_walkshed', description: '步行／騎車／開車 N 分鐘的真實路網生活圈（OpenRouteService；沒有 ORS_API_KEY 時退回固定速度估算圈，回傳 source 會標明）。用於「這裡走路 15 分鐘能到哪」「生活圈」「騎車 10 分鐘範圍」。', input_schema: { type: 'object', properties: { place: { type: 'string' }, lon: { type: 'number' }, lat: { type: 'number' }, name: { type: 'string' }, profile: { type: 'string', enum: ['foot-walking', 'cycling-regular', 'driving-car'] }, minutes: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 60 }, maxItems: 3 } } } },
  { name: 'clear_walkshed', description: '收起生活圈。', input_schema: { type: 'object', properties: {} } },
  { name: 'clear_isochrone', description: '收起等時圈。', input_schema: { type: 'object', properties: {} } },
  { name: 'presenter', description: '展示模式（投影用）：隱藏編輯 HUD、放大字幕、←→ 切場景。on 省略則切換。', input_schema: { type: 'object', properties: { on: { type: 'boolean' } } } },
  { name: 'play_trips', description: '播放「企業遷徙動線」動畫：公司登記地址異動的弧線（原址→新址）依序飛行，落地有漣漪與公司名稱。可指定 year（預設目前時間軸年份；快照只有 2026 的異動）。', input_schema: { type: 'object', properties: { year: { type: 'integer', minimum: 2012, maximum: 2030 } } } },
  { name: 'focus', description: '對焦／X-ray：只保留一棟大樓與周邊脈絡可讀，其餘量體與標註淡出。給 key（同 highlight）或 lon/lat；off:true 離開對焦。', input_schema: { type: 'object', properties: { key: { type: 'string' }, lon: { type: 'number' }, lat: { type: 'number' }, radius_m: { type: 'number' }, off: { type: 'boolean' } } } },
  { name: 'set_overlay', description: '疊加／移除國土測繪中心 WMTS 疊圖：landsect（段籍界）、buildx（分棟建物框）、publicland（公有土地）、liquefaction（土壤液化潛勢）、road（道路路網）。', input_schema: { type: 'object', properties: { overlay: { type: 'string', enum: ['landsect', 'buildx', 'publicland', 'liquefaction', 'road'] }, on: { type: 'boolean' } }, required: ['overlay'] } },
  { name: 'set_basemap', description: '切換底圖：nlsc_photo（正射影像；時間軸 2014–2025 會自動換該年航照）、nlsc_emap、esri（衛星）、esri_light、carto_light（Positron）、carto_dark（Dark Matter）、esri_dark。', input_schema: { type: 'object', properties: { key: { type: 'string', enum: ['nlsc_photo', 'nlsc_emap', 'esri', 'esri_light', 'carto_light', 'carto_dark', 'esri_dark'] } }, required: ['key'] } },
  { name: 'set_quality', description: '畫質開關：ao（環境光遮蔽）、bloom（泛光）、hdr。', input_schema: { type: 'object', properties: { ao: { type: 'boolean' }, bloom: { type: 'boolean' }, hdr: { type: 'boolean' } } } },
  { name: 'share_view', description: '把目前視角（相機、鏡、年份、主題、圖層、日照）做成可分享連結並複製到剪貼簿，回傳 URL。', input_schema: { type: 'object', properties: {} } },
  { name: 'pin', description: '把一個物件的資料卡釘在地圖上（帶引線的標註，跟著物件移動）。key 同 highlight。', input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'get_view_state', description: '取得目前畫面狀態：相機中心、行政區、年份、鏡、密度、可見圖層、選取物件、視野內各圖層數量。', input_schema: { type: 'object', properties: {} } },
  { name: 'search_local_snapshot', description: '在前端本地資料快照中用名稱搜尋物件（商辦、建案、都更單元、上市櫃交易、公建、園區、重劃區），回傳 key 與座標，用於 highlight / fly_to / pin / select_entity。', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'query_snapshot', description: '查詢 server 端本地資料快照（優先於 FUNRAISE MCP：免費、即時、不耗 token）。kind 決定查哪個資料集：buildings 商辦（district/grade/name）、mops 上市櫃資產交易（district/since/min_price）、licenses 建照（district/year）、renewal 都更單元（district/category）、future 未來供給（district/year＝累計到該年為止）、moves 企業遷徙（district＝遷入區/from＝遷出區）、zones 重劃區（name/category）、infra 公共建設（name/year）、parks 產業園區（name）、areas 商圈行情含季度租售序列與 YoY（name）、districts 行政區統計：公司數／成長率／行情／商辦分布／產業結構（district）、timeseries 年度成交／建照趨勢：district 省略＝全市（year/since）、summary 快照總覽一段話。回傳精簡列（預設 ≤12 筆，可用 top 調整）與可用 highlight／focus 點亮的 keys。快照涵蓋信義／大安／中山／松山／內湖／南港等區；查不到再用 FUNRAISE MCP。', input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['buildings', 'mops', 'licenses', 'renewal', 'future', 'moves', 'zones', 'infra', 'parks', 'areas', 'districts', 'timeseries', 'summary'] }, district: { type: 'string', description: '行政區，例如「信義區」（可省略「區」字）' }, name: { type: 'string', description: '名稱關鍵字（大樓、商圈、園區、公建等）' }, year: { type: 'integer', description: '西元年：buildings/licenses/infra 為當年、future/timeseries 為該年（或累計到該年）' }, since: { type: 'string', description: 'YYYY-MM-DD，用於 mops/moves/timeseries' }, grade: { type: 'string', description: '商辦等級 A/B/F/P，僅 buildings' }, category: { type: 'string', description: '都更類別或重劃分類' }, min_price: { type: 'number', description: '最低交易總額（元），僅 mops' }, from: { type: 'string', description: '遷出行政區，僅 moves' }, top: { type: 'integer', description: '回傳筆數上限，預設 12，最多 50' }, sort: { type: 'string', enum: ['asc', 'desc'], description: '依該 kind 的主要數值欄位排序，預設多為 desc' } }, required: ['kind'] } },
  { name: 'show_chart', description: '在資料面板顯示長條圖（比較、排名、金額）。', input_schema: { type: 'object', properties: { title: { type: 'string' }, rows: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' }, display: { type: 'string', description: '顯示用文字，例如「4.8 億」' } }, required: ['label', 'value'] } } }, required: ['title', 'rows'] } },
  { name: 'select_entity', description: '選取地圖物件並在面板顯示其詳細資料（key 同 highlight）。', input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'present_place', description: '展示巨集：一次完成「飛過去／環繞＋擺出風格＋套用外觀 Look」，取代好幾個單獨的鏡頭工具。使用者說「用更好的視角幫我呈現」「展示一下○○」「帶我去○○，環繞＋黃金時刻」時優先用這個，一回合解決，不要分成多次 fly_to／set_camera_mode／set_look。', input_schema: { type: 'object', properties: { place: { type: 'string', description: '地名（大樓、商圈、行政區、捷運站、園區）' }, style: { type: 'string', enum: ['orbit', 'street', 'overview'], description: '呈現風格：orbit 環繞（預設，最適合展示）、street 街景、overview 拉遠俯視' }, look: { type: 'string', enum: ['white', 'sun', 'golden', 'night', 'photoreal'], description: '外觀 Look：white 白模、sun 日照、golden 黃金時刻（展示首選）、night 夜景、photoreal 相片級' }, range_m: { type: 'number' } }, required: ['place'] } },
  { name: 'set_look', description: '切換外觀 Look（取代分別呼叫 set_theme／set_sun／set_quality 三個工具）：white 白模（預設，分析用）、sun 日照（可給 hour 5.5–19.5）、golden 黃金時刻（展示用）、night 夜景、photoreal 相片級（需 Google 金鑰，沒有則維持白模）。', input_schema: { type: 'object', properties: { look: { type: 'string', enum: ['white', 'sun', 'golden', 'night', 'photoreal'] }, hour: { type: 'number' } }, required: ['look'] } },
  // Phase 11A 場景與腳本（docs/11-v2-cesium-app.md §20.1）：讓 agent 不只「跳去一個地方開關圖層」，而是像導演一樣一次排好整段導覽。
  { name: 'list_scenes', description: '列出內建電影式場景（id／標題／副標／步數），供 play_scene 使用。', input_schema: { type: 'object', properties: {} } },
  { name: 'play_scene', description: '播放內建場景（旁白、鏡頭、圖層、物件標示全自動編排）：investor 資本流向・投資人巡航、developer 供給雷達・開發商、occupier 企業選址、city 城市治理・首長戰情室、time 時光 2012→2030、land 地政巡禮（段籤界／公有土地／重劃與區段徵收／都更地號模擬／歷年航照／實價登錄價值面，給地政單位看）。使用者說「播放○○場景」「放一段給地政局看」且有合適的內建場景時直接用；要客製才用 play_script。', input_schema: { type: 'object', properties: { id: { type: 'string', enum: ['investor', 'developer', 'occupier', 'city', 'time', 'land'] } }, required: ['id'] } },
  { name: 'play_script', description: '像導演一樣編排並播放一段客製導覽腳本：使用者要「幫我做／規劃／編排一個給○○看的場景、腳本、導覽、簡報流程」時用。先用 query_snapshot／search_local_snapshot 查好要講的數字與物件 key，再「一次」呼叫本工具把 4–7 段全部排好（不要一段一段分開呼叫，也不要改用 fly_to／set_layers 慢慢調）。每段 steps[i]：text 旁白（繁中 1–2 句、含具體數字與地名，會被念出來並顯示在語音列）、place 地名（大樓／商圈／行政區／捷運站／園區，前端用快照解析）或 lon／lat、range 公尺（500 街廓・1500 街區・5000 行政區・15000 全市）、pitch（-30 貼近～-75 俯視）、heading、mode（fly／orbit／street）、look（photoreal／sun／golden／night／white）、lens、layers {show,hide}（stock、future、licenses、renewal、zones、mops、moves、infra、parks、heat、parcels、mrt、tm）、keys（要框起來加編號的物件 key，最多 6 個）、overlays（landsect 段籤界／publicland 公有土地／buildx 分棟建物框；每段列出這段要疊的，沒列＝全關）、year（時間軸年份）、lapse {from,to}（這段播放時間軸）、simulate_renewal（都更單元 id 或名稱：跑智慧都更模擬長出可建量體）。呼叫後只用 2–3 句列出段落大綱與資料來源，不要重複整段旁白。', input_schema: { type: 'object', properties: { title: { type: 'string' }, sub: { type: 'string' }, steps: { type: 'array', minItems: 1, maxItems: 9, items: { type: 'object', properties: { text: { type: 'string' }, place: { type: 'string' }, lon: { type: 'number' }, lat: { type: 'number' }, range: { type: 'number' }, pitch: { type: 'number' }, heading: { type: 'number' }, mode: { type: 'string', enum: ['fly', 'orbit', 'street'] }, look: { type: 'string', enum: ['photoreal', 'sun', 'golden', 'night', 'white'] }, lens: { type: 'string', enum: ['investor', 'developer', 'occupier', 'city', 'research'] }, layers: { type: 'object', properties: { show: { type: 'array', items: { type: 'string' } }, hide: { type: 'array', items: { type: 'string' } } } }, keys: { type: 'array', items: { type: 'string' } }, overlays: { type: 'array', items: { type: 'string', enum: ['landsect', 'publicland', 'buildx', 'liquefaction', 'road'] } }, year: { type: 'integer' }, lapse: { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' } } }, simulate_renewal: { type: 'string' } }, required: ['text'] } } }, required: ['title', 'steps'] } },
];
const SYSTEM = `你是「睿鏡 PeakLens」的地圖 agent：FUNRAISE 方睿科技的台灣不動產上帝視角（God's Eye View × FUNRAISE MCP）。使用者是不動產投資人、開發商、企業選址主管、政府局處或學研人員，用口語（繁體中文）對城市發問；你同時「操作畫面」與「回答問題」。

規則：
1. 先動畫面再說話：地點問題先 fly_to／set_camera_mode；清單或比較問題用 highlight + show_chart（標註模式會自動編號）；時間問題用 set_year；視角問題用 set_lens；使用者要「乾淨／沉浸」或「多一點資料」用 set_density。一次可呼叫多個工具。
2. 快照優先：問題只要落在下面「## 快照內容」涵蓋的範圍（商辦、上市櫃交易、建照、都更、重劃、未來供給、公共建設、產業園區、商圈行情與季度序列、行政區統計、年度成交／建照趨勢），先呼叫 query_snapshot 用本地資料回答，結尾標「來源：${SNAPSHOT.stats.date}」；只有 (a) 快照查不到的特定物件、(b) 需要特定地址／地號／公司登記／謄本等即時資料、或 (c) 使用者明確要「最新」「即時」時才呼叫 FUNRAISE MCP（商辦 buildings、都更 urban-renewal、實價登錄 actual-price-*、上市櫃資產 mops-property、建照 taipei-licenses、公司登記 company-registry、產業園區 industrial-parks、公共建設 public-infras、商圈 areas、土地與使用分區 land-info），單一回合最多呼叫 3 個 MCP 工具，優先用聚合類工具。query_snapshot 或 MCP 查到的物件，用回傳的 key（或 search_local_snapshot 查到的 key）highlight / pin / select_entity 點亮。
3. 回答簡潔：3 句內講結論與數字，最後一行用「來源：<工具>·<資料期間>」標註。沒有資料就明說，不要編造。
4. 台北市行政區、商圈與捷運站名用正體中文；金額用「億／萬」；面積用坪並附 m²。
5. 若使用者只是閒聊或問產品，簡短回答並建議一個可示範的指令。
6. 專用工具：捷運等時圈／通勤圈 → show_isochrone；步行／騎車／開車生活圈 → show_walkshed；天氣／空氣品質 → get_environment；YouBike → set_live_layer；對焦／只看這棟 → focus；企業遷徙動線 → play_trips；日照／陰影 → set_sun（或直接用 set_look／present_place）；疊圖（段籍界、公有土地、液化）→ set_overlay；展示模式 → presenter；樓層視角／站上 N 樓 → floor_view；分享視角 → share_view；外觀（白模／日照／黃金時刻／夜景／相片級）一律用 set_look，不要分別呼叫 set_theme／set_sun／set_quality；「用更好的視角呈現」「展示一下」這類籠統要求優先用 present_place 一次完成。
7. 畫面工具在同一回合平行呼叫（一次回傳多個 function_call），鏡頭／外觀最多一回合就決定好、不要分成好幾回合慢慢調；查完資料立刻用文字回答，不要再多繞一輪確認；每次回覆一定要有文字，即使只是一句確認也好，絕不能只呼叫工具卻不留一句話。
8. 場景與腳本：使用者說「播放○○場景」「放一段給○○看」→ 有合適的內建場景（investor／developer／occupier／city／time／land 地政）就用 play_scene（不確定有哪些就先 list_scenes）；「幫我做／規劃／編排一個給○○（地政局長官、投資人、董事會、客戶…）看的場景／腳本／導覽／簡報」→ 你就是導演：先用 query_snapshot 查 2–3 個會講到的數字與物件 key，再用 play_script「一次」排好 4–7 段（開場全景 → 每個主題一段：一個鏡頭 + 要亮的圖層與 keys + 一句有數字的旁白 → 收尾），絕不要一段一段用 fly_to／set_layers 慢慢調；回覆只列段落大綱與資料來源。
畫面狀態與資料來源狀態會附在下方（由 server 提供）。` + '\n\n## 快照內容\n' + SNAPSHOT.describe();

function json(res, code, body) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': env.ALLOWED_ORIGIN || '*', 'access-control-allow-headers': 'content-type, x-peaklens-code', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
function html(res, code, body) { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); }
function readBody(req, limit = 2e6) { return new Promise((resolve, reject) => { let n = 0; const chunks = []; req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); }); req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } }); req.on('error', reject); }); }
function sanitizeMessages(msgs) {
  if (!Array.isArray(msgs)) throw new Error('messages must be an array');
  const out = msgs.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content != null);
  // Trim to the last 8 real user turns (§ Phase 9G token-spend reduction) — a "turn" starts at a plain-string user
  // message (a genuine new question); everything after it (assistant tool_use/text, user tool_result replies) rides
  // along as part of that same turn. Walk from the end so we cut BEFORE a turn-start message, never mid-turn.
  let turns = 0, startIdx = 0;
  for (let i = out.length - 1; i >= 0; i--) { if (out[i].role === 'user' && typeof out[i].content === 'string') { turns++; startIdx = i; if (turns >= 8) break; } }
  const trimmed = out.slice(startIdx).slice(-60); // 60 = generous hard ceiling against a pathological single turn
  if (!trimmed.length || trimmed[0].role !== 'user') throw new Error('conversation must start with a user message');
  return trimmed;
}
async function agentContext(final) {
  if (!llm) { const e = new Error('沒有 LLM 金鑰：在 app/.env 設 OPENAI_API_KEY（或 ANTHROPIC_API_KEY），或開 http://localhost:' + PORT + '/setup 貼上'); e.status = 503; throw e; }
  const mcp = await mcpProbe(); const tok = mcp.status === 'live' ? await validToken() : null;
  // Phase 9G: snapshot-first even when MCP is LIVE — the curated snapshot answers most questions for free, so MCP is
  // reserved for what it doesn't cover (see SYSTEM rule 2 and "## 快照內容" below).
  const sourceNote = tok ? `資料來源：query_snapshot（本地快照，${SNAPSHOT.stats.date}）優先；FUNRAISE MCP 即時（LIVE）備援，只用於快照查不到的物件、特定地址／地號／公司登記／謄本，或使用者明確要「最新」「即時」時。` : `資料來源：本地快照（FUNRAISE MCP ${mcp.status === 'unauthorized' ? '尚未授權：請使用者按右上角「授權」' : '目前連不上'}）。用 query_snapshot／search_local_snapshot 與畫面工具；回答時註明「來源：${SNAPSHOT.stats.date}」。`;
  const finalNote = final ? '\n\n## 收尾\n這是最後一輪，不能再呼叫任何工具（包括 MCP）；請根據以上已經執行的操作與查到的資料，直接用 1–2 句繁體中文回答使用者，即使只是確認「已完成」也要留下文字。' : '';
  return { tok, sourceNote, finalNote };
}
// Phase 9G: drop zero-count in_view keys and round a couple of numeric fields before the view state rides into the
// system prompt — it's re-sent on every single round of every turn, so trimming it is pure token savings.
function compactView(view) {
  if (!view || typeof view !== 'object') return view;
  const v = { ...view };
  if (v.in_view && typeof v.in_view === 'object') { const iv = {}; for (const [k, n] of Object.entries(v.in_view)) if (n) iv[k] = n; v.in_view = iv; }
  if (typeof v.lon === 'number') v.lon = +v.lon.toFixed(4);
  if (typeof v.lat === 'number') v.lat = +v.lat.toFixed(4);
  if (typeof v.height_m === 'number') v.height_m = Math.round(v.height_m / 10) * 10;
  return v;
}
const systemFor = (view, sourceNote, finalNote) => SYSTEM + '\n\n## 資料來源狀態\n' + sourceNote + '\n\n## 目前畫面狀態\n' + JSON.stringify(compactView(view) || {}) + finalNote;
function noteMcpRejection(content) { for (const b of content) if (b.type === 'mcp_tool_result' && b.is_error && /401|unauthori|invalid_token|forbidden/i.test(JSON.stringify(b.content || ''))) mcpState = { status: 'unauthorized', checked: Date.now(), reason: 'MCP rejected the token during a call' }; }

// ---- server-side query_snapshot sub-loop (Phase 9G) ----
// When the model calls query_snapshot we execute it HERE — never round-tripping to the browser — feed the compact
// JSON result back as a tool_result in the SAME conversation, and call the model again, up to SNAPSHOT_TOOL_MAX
// times, so a data question resolves inside this one /api/agent call instead of costing the browser extra rounds.
// We only keep looping while a round's tool_use blocks are query_snapshot ONLY: if the model also asked for a
// camera/UI tool in the same round we stop and return everything as-is — the browser executes the camera tool, and
// the unexecuted query_snapshot tool_use is the rare edge case claudeClient.js's `case 'query_snapshot'` no-op
// fallback exists for. (We can't keep looping in that mixed case: the next provider call would replay `msgs` with
// the camera tool_use still unanswered, which both the OpenAI and Anthropic APIs reject — the server has no browser
// to execute it and get a real result from.)
const SNAPSHOT_TOOL_MAX = 4;
async function snapshotSubLoop(baseArgs, callFn, onSnapshot) {
  let msgs = baseArgs.messages;
  for (let used = 0; ; ) {
    const res = await callFn(msgs);
    noteMcpRejection(res.content); // checked every round (not just the last) — an MCP call can happen on any round
    const toolUses = res.content.filter(b => b.type === 'tool_use');
    const snapUses = toolUses.filter(b => b.name === 'query_snapshot');
    const otherUses = toolUses.some(b => b.name !== 'query_snapshot');
    if (baseArgs.final || !snapUses.length || otherUses || used >= SNAPSHOT_TOOL_MAX) return res;
    used += snapUses.length;
    const results = snapUses.map(tu => { const out = cachedSnapshotQuery(tu.input); if (onSnapshot) onSnapshot(tu, out); return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) }; });
    msgs = [...msgs, { role: 'assistant', content: res.content }, { role: 'user', content: results }];
  }
}
export async function runAgent({ messages, view, final }) {
  const { tok, sourceNote, finalNote } = await agentContext(final);
  const args = { system: systemFor(view, sourceNote, finalNote), messages: sanitizeMessages(messages), tools: CAMERA_TOOLS, mcp: tok ? { url: MCP_URL, name: 'funraise', token: tok.access_token, allowedTools: MCP_ALLOWED() } : null, final: !!final };
  const res = await snapshotSubLoop(args, msgs => llm.run({ ...args, messages: msgs }));
  return { content: res.content, stop_reason: res.stop_reason, usage: res.usage, model: res.model, provider: llm.provider, source: tok ? 'live' : 'snapshot' };
}
// SSE variant for POST /api/agent {stream:true}: send(event, data) is the caller's SSE writer. Streams real
// response.output_text.delta chunks when the provider supports it (OpenAI); otherwise sends the full text as one
// `text` event and still emits `tool` + `done` so the client's SSE contract stays identical either way. Each
// server-side query_snapshot call (see snapshotSubLoop) emits its own `tool` event as it happens, so a raw SSE
// transcript shows the snapshot lookup even though the browser's own tool-execution loop never receives it.
export async function runAgentStream({ messages, view, final }, send) {
  const { tok, sourceNote, finalNote } = await agentContext(final);
  const args = { system: systemFor(view, sourceNote, finalNote), messages: sanitizeMessages(messages), tools: CAMERA_TOOLS, mcp: tok ? { url: MCP_URL, name: 'funraise', token: tok.access_token, allowedTools: MCP_ALLOWED() } : null, final: !!final };
  const callFn = msgs => typeof llm.stream === 'function' ? llm.stream({ ...args, messages: msgs }, delta => send('text', { delta })) : (async () => { const r = await llm.run({ ...args, messages: msgs }); for (const b of r.content) if (b.type === 'text' && b.text) send('text', { delta: b.text }); return r; })();
  const res = await snapshotSubLoop(args, callFn, (tu, out) => send('tool', { name: 'query_snapshot', input: tu.input, count: out.count }));
  for (const b of res.content) if (b.type === 'tool_use' || b.type === 'mcp_tool_use') send('tool', { name: b.name, input: b.input });
  const out = { content: res.content, stop_reason: res.stop_reason, usage: res.usage, model: res.model, provider: llm.provider, source: tok ? 'live' : 'snapshot' };
  send('done', out); return out;
}

/* ---------------- static (dist/) ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2', '.woff2': 'font/woff2', '.woff': 'font/woff', '.xml': 'application/xml', '.map': 'application/json', '.webp': 'image/webp', '.czml': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown' };
const DIST = env.PEAKLENS_DIST || path.join(root, 'dist'); // PEAKLENS_DIST lets tests serve a private build
function serveStatic(req, res) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) return json(res, 404, { error: 'no dist/ build yet — run `npm run build`, or use `npm run dev` (Vite proxies /api here)' });
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(DIST, p)); if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': p === '/index.html' ? 'no-cache' : 'public, max-age=3600' }); fs.createReadStream(file).pipe(res);
}
const CALLBACK_PAGE = (ok, msg) => `<!doctype html><meta charset="utf-8"><title>PeakLens · FUNRAISE MCP</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#030712;color:#F3F4F6;font:15px Inter,'Noto Sans TC',sans-serif"><div style="text-align:center;max-width:420px;padding:24px"><div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.14em;color:#93DCE6">FUNRAISE MCP</div><h1 style="font-size:20px;margin:8px 0">${ok ? '已授權，睿鏡可以即時查資料了' : '授權失敗'}</h1><p style="color:#99A1AF">${msg}</p><p style="color:#6A7282;font-size:12px">${ok ? '這個視窗會自動關閉。' : '請關閉視窗後再試一次。'}</p></div><script>try{(window.opener||window.parent).postMessage({type:'peaklens-mcp-authorized',ok:${ok ? 'true' : 'false'}},'*')}catch(e){} ${ok ? 'setTimeout(()=>window.close(),1400);' : ''}</script></body>`;

if (process.argv.includes('--check')) { const m = await mcpProbe(true).catch(e => ({ status: 'error', reason: e.message })); console.log(JSON.stringify({ ok: !!llm, provider: llm ? llm.provider : null, model: MODEL(), mcp: mcpSummary(m), snapshot: SNAPSHOT.stats, tts: FISH_KEY_() ? 'fish:' + FISH_MODEL_() : 'none', voices: VOICES.map(v => v.id), redirect_uri: REDIRECT_URI, tools: CAMERA_TOOLS.map(t => t.name), port: PORT }, null, 2)); process.exit(0); }

// abuse guard for a shared/hosted server: per-IP sliding window (agent 30/min, tts 60/min, others 240/min)
const GATE_FREE = new Set(['/api/health', '/api/mcp/callback']); const rateBuckets = new Map();
function rateOk(ip, pathname) { const limit = pathname === '/api/agent' ? +(env.RATE_AGENT_PER_MIN || 30) : pathname === '/api/tts' ? +(env.RATE_TTS_PER_MIN || 60) : 240; const key = ip + '|' + (pathname === '/api/agent' || pathname === '/api/tts' ? pathname : 'other'); const now = Date.now(); const arr = (rateBuckets.get(key) || []).filter(t => now - t < 60000); arr.push(now); rateBuckets.set(key, arr); if (rateBuckets.size > 5000) rateBuckets.clear(); return arr.length <= limit; }
const ORS = createOrsRoutes(env); const LIVE = createLiveRoutes(env);
const SETUP = createSetup({ env, envFile: ENV_FILE, reload: reloadEnv, getLLM: () => llm, appRoot: root, getMcpToken: () => ({ token: store.load(), static: !!staticToken, persist: tokenPersistMode() }) });
// Phase：Vercel — 這支 handler 本身跟 host 無關（單純 (req,res) → 用 req.url 自己解析路由），本機／Docker 用
// http.createServer(handler).listen(PORT) 直接跑；Vercel 的 Node function（app/api/[[...path]].mjs）改成
// import { handler } 再 export default，讓 Vercel 自己呼叫，不需要也不應該再 .listen() 一次（Vercel 的 runtime
// 才是真正在聽 port 的那一層）。IS_MAIN 判斷「這個檔案是不是被直接執行」（node server/index.mjs）；
// PEAKLENS_NO_LISTEN=1 額外提供一個手動關掉 .listen() 的旋鈕，主要給 server/handler.test.mjs 這類測試用——
// 它們自己建一個 http.createServer(handler) 打在別的 ephemeral port 上，不需要（也不該跟）這裡的 PORT 搶。
const IS_MAIN = import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
export const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'OPTIONS') return json(res, 204, {});
      if (url.pathname.startsWith('/api/') && !GATE_FREE.has(url.pathname) && !url.pathname.startsWith('/api/setup')) {
        const code = env.PEAKLENS_ACCESS_CODE; if (code) { const given = req.headers['x-peaklens-code'] || url.searchParams.get('code') || ''; if (given !== code) return json(res, 401, { error: '這個 PeakLens server 需要存取碼', need_code: true }); }
        const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim(); if (!rateOk(ip, url.pathname)) return json(res, 429, { error: '請求太頻繁，稍後再試' });
      }
      if (url.pathname === '/setup') return SETUP.page(req, res);
      if (url.pathname.startsWith('/api/setup')) return SETUP.api(req, res, url, readBody, json);
      if (url.pathname === '/api/health') { const m = await mcpProbe(url.searchParams.has('force')); return json(res, 200, { ok: !!llm, provider: llm ? llm.provider : null, model: MODEL(), mcp: mcpSummary(m), tools: CAMERA_TOOLS.length, tts: FISH_KEY_() ? 'fish' : 'none', voices: VOICES.map(v => ({ id: v.id, name: v.name, desc: v.desc, gender: v.gender })) }); }
      if (url.pathname === '/api/voices') return json(res, 200, { fish: !!FISH_KEY_(), model: FISH_MODEL_(), voices: VOICES.map(v => ({ id: v.id, name: v.name, desc: v.desc, gender: v.gender })) });
      if (url.pathname === '/api/tts' && req.method === 'POST') { const body = await readBody(req, 64000); const t0 = Date.now(); const out = await synthesize(body.text, body.voice, { speed: Math.min(2, Math.max(0.5, +body.speed || 1)) }); console.log(`[tts] ${out.voice.id} ${out.cached ? 'cache' : 'fish'} ${Date.now() - t0} ms · ${String(body.text).slice(0, 40)}`); const st = fs.statSync(out.file); res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': st.size, 'cache-control': 'public, max-age=86400', 'x-tts-voice': out.voice.id, 'x-tts-cached': out.cached ? '1' : '0', 'access-control-allow-origin': '*' }); return fs.createReadStream(out.file).pipe(res); }
      if (url.pathname === '/api/mcp/authorize') { const loc = await beginAuthorize(); res.writeHead(302, { location: loc, 'cache-control': 'no-store' }); return res.end(); }
      if (url.pathname === '/api/mcp/callback') { const err = url.searchParams.get('error'); if (err) return html(res, 400, CALLBACK_PAGE(false, `${err}: ${url.searchParams.get('error_description') || ''}`)); try { await finishAuthorize(url.searchParams.get('code'), url.searchParams.get('state')); const m = await mcpProbe(true); return html(res, 200, CALLBACK_PAGE(m.status === 'live', m.status === 'live' ? `已連上 ${m.server && m.server.name ? m.server.name : 'FUNRAISE MCP'}。` : `已取得 token，但探測回報 ${m.status}（${m.reason || ''}）。`)); } catch (e) { return html(res, 400, CALLBACK_PAGE(false, e.message)); } }
      if (url.pathname === '/api/mcp/logout' && req.method === 'POST') { store.clear(); mcpState = { status: 'unknown', checked: 0 }; return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/agent' && req.method === 'POST') {
        const body = await readBody(req); const t0 = Date.now();
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': env.ALLOWED_ORIGIN || '*' });
          const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ } };
          try { const out = await runAgentStream(body, send); console.log(`[agent] stream ${out.stop_reason} · ${out.source} · ${Date.now() - t0} ms`); }
          catch (e) { console.error('[agent] stream error', e); send('error', { error: e.message || String(e) }); }
          return res.end();
        }
        const out = await runAgent(body); console.log(`[agent] ${out.stop_reason} · ${out.source} · ${out.usage ? out.usage.input_tokens + '→' + out.usage.output_tokens + ' tok' : ''} · ${Date.now() - t0} ms`); return json(res, 200, out);
      }
      if (LIVE[url.pathname]) { const r = await LIVE[url.pathname]({ url }); return json(res, r.status, r.json); }
      if (ORS[url.pathname]) { const r = await ORS[url.pathname]({ url, req, res, readBody }); return json(res, r.status, r.json); }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown route' });
      return serveStatic(req, res);
    } catch (e) { console.error('[error]', e); return json(res, e.status || 500, { error: e.message || String(e) }); }
};
if (IS_MAIN && env.PEAKLENS_NO_LISTEN !== '1') {
  http.createServer(handler).listen(PORT, async () => {
    const m = await mcpProbe(true).catch(e => ({ status: 'error', reason: e.message }));
    console.log(`PeakLens agent server on http://localhost:${PORT}  llm=${llm ? llm.provider + ':' + llm.model : 'OFF (set OPENAI_API_KEY or ANTHROPIC_API_KEY, or open /setup)'}  mcp=${m.status}${m.reason ? ' (' + m.reason + ')' : ''}  snapshot=${SNAPSHOT.stats.date}(${Object.values(SNAPSHOT.stats.counts).reduce((a, b) => a + b, 0)} rows${SNAPSHOT.stats.hasTimeseries ? '+ts' : ''})  tts=${FISH_KEY_() ? 'fish' : 'none'}  access=${env.PEAKLENS_ACCESS_CODE ? 'code-protected' : 'open'}  setup=${PUBLIC_URL}/setup  authorize=${PUBLIC_URL}/api/mcp/authorize  static=${fs.existsSync(path.join(DIST, 'index.html')) ? 'dist/' : 'none'}  state=${STATE_DIR}${STATE_IS_TMP ? '(tmp fallback)' : ''}`);
  });
}
