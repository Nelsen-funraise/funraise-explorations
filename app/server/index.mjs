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
import Anthropic from '@anthropic-ai/sdk';

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
const env = { ...loadEnv(path.join(root, '.env')), ...process.env };
const PORT = +(env.PORT || 8787);
const MODEL = env.ANTHROPIC_MODEL || 'claude-opus-5';
const MCP_URL = env.FUNRAISE_MCP_URL || 'https://connector.mcp.funraise.ai/t/hkvmS7xU5N5TnxXalyUUA/mcp';
const PUBLIC_URL = (env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const REDIRECT_URI = `${PUBLIC_URL}/api/mcp/callback`;
const TOKEN_FILE = path.join(here, '.mcp-token.json');
const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

/* ---------------- Fish Audio TTS (server-side key, on-disk cache) ---------------- */
const FISH_KEY = env.FISH_API_KEY || ''; const FISH_MODEL = env.FISH_MODEL || 's2.1-pro-free';
export const DEFAULT_VOICES = [
  { id: 'nelsen', name: 'Nelsen', desc: '陳致瑋 · 沉穩敘事（帳號內聲音模型）', fish: 'ebebcafee7784ad6b5b1205723f936de', gender: 'male' },
  { id: 'eunice', name: 'Eunice', desc: '溫暖親切的台灣女聲（帳號內聲音模型）', fish: '0883de2699424fb5a19f84631d6d4c0d', gender: 'female' },
  { id: 'twf', name: '台灣腔女生', desc: '清晰專業的台灣女聲（Fish Audio 公開模型）', fish: '3cb8677aa52f4792b0153422dbf4e14b', gender: 'female' },
];
let VOICES = DEFAULT_VOICES; try { if (env.FISH_VOICES) VOICES = JSON.parse(env.FISH_VOICES); } catch { console.warn('[tts] FISH_VOICES is not valid JSON; using defaults'); }
const TTS_CACHE = path.join(here, '.tts-cache'); fs.mkdirSync(TTS_CACHE, { recursive: true });
export const fnv1a = (str) => { let h = 0x811c9dc5; for (const c of Buffer.from(str, 'utf8')) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
export async function synthesize(text, voiceId, { speed = 1 } = {}) {
  const v = VOICES.find(x => x.id === voiceId) || VOICES[0]; if (!FISH_KEY) throw Object.assign(new Error('FISH_API_KEY not set'), { status: 503 });
  text = String(text || '').trim().slice(0, 800); if (!text) throw Object.assign(new Error('empty text'), { status: 400 });
  const key = fnv1a(v.fish + '|' + speed + '|' + text); const file = path.join(TTS_CACHE, key + '.mp3');
  if (fs.existsSync(file)) return { file, cached: true, voice: v };
  const r = await fetch('https://api.fish.audio/v1/tts', { method: 'POST', headers: { authorization: `Bearer ${FISH_KEY}`, 'content-type': 'application/json', model: FISH_MODEL }, body: JSON.stringify({ text, reference_id: v.fish, format: 'mp3', mp3_bitrate: 64, latency: 'balanced', normalize: true, prosody: { speed } }), signal: AbortSignal.timeout(60000) });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw Object.assign(new Error(`fish ${r.status}: ${t.slice(0, 160)}`), { status: r.status === 402 ? 402 : 502 }); }
  const buf = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(file, buf); return { file, cached: false, voice: v };
}

/* ---------------- token store ---------------- */
const store = {
  load() { try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; } },
  save(t) { fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 }); return t; },
  clear() { try { fs.unlinkSync(TOKEN_FILE); } catch { /* none */ } },
};
const staticToken = env.FUNRAISE_MCP_TOKEN ? { access_token: env.FUNRAISE_MCP_TOKEN, static: true } : null;

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
  const meta = await discover(); const c = await ensureClient(meta);
  const body = new URLSearchParams({ ...params, client_id: c.client_id, resource: meta.resource }); if (c.client_secret) body.set('client_secret', c.client_secret);
  const r = await fetchJson(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
  if (!r.json || !r.json.access_token) throw new Error('token endpoint ' + r.status + ': ' + r.text.slice(0, 300));
  const saved = store.load() || {}; const tok = { ...saved, access_token: r.json.access_token, refresh_token: r.json.refresh_token || saved.refresh_token || null, token_type: r.json.token_type || 'Bearer', scope: r.json.scope || meta.scopes.join(' '), expires_at: r.json.expires_in ? Date.now() + r.json.expires_in * 1000 : null, obtained_at: Date.now() };
  store.save(tok); mcpState = { status: 'unknown', checked: 0 }; return tok;
}
async function finishAuthorize(code, state) { const p = pending.get(state); if (!p) throw new Error('unknown or expired state'); pending.delete(state); return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: p.verifier }); }
async function validToken() {
  if (staticToken) return staticToken; const t = store.load(); if (!t || !t.access_token) return null;
  if (t.expires_at && Date.now() > t.expires_at - 60000 && t.refresh_token) { try { return await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token }); } catch (e) { console.warn('[mcp] refresh failed', e.message); return null; } }
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
const mcpSummary = s => ({ status: s.status, url: MCP_URL, reason: s.reason || null, server: s.server || null, expires_at: s.expires_at || null, authorize_url: '/api/mcp/authorize', static_token: !!staticToken });

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
  { name: 'show_chart', description: '在資料面板顯示長條圖（比較、排名、金額）。', input_schema: { type: 'object', properties: { title: { type: 'string' }, rows: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' }, display: { type: 'string', description: '顯示用文字，例如「4.8 億」' } }, required: ['label', 'value'] } } }, required: ['title', 'rows'] } },
  { name: 'select_entity', description: '選取地圖物件並在面板顯示其詳細資料（key 同 highlight）。', input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
];
const SYSTEM = `你是「睿鏡 PeakLens」的地圖 agent：FUNRAISE 方睿科技的台灣不動產上帝視角（God's Eye View × FUNRAISE MCP）。使用者是不動產投資人、開發商、企業選址主管、政府局處或學研人員，用口語（繁體中文）對城市發問；你同時「操作畫面」與「回答問題」。

規則：
1. 先動畫面再說話：地點問題先 fly_to／set_camera_mode；清單或比較問題用 highlight + show_chart（標註模式會自動編號）；時間問題用 set_year；視角問題用 set_lens；使用者要「乾淨／沉浸」或「多一點資料」用 set_density。一次可呼叫多個工具。
2. 資料以 FUNRAISE MCP 工具（若可用）的查詢結果為準：商辦 buildings、都更 urban-renewal、實價登錄 actual-price-*、上市櫃資產 mops-property、建照 taipei-licenses、公司登記 company-registry、產業園區 industrial-parks、公共建設 public-infras、商圈 areas、土地與使用分區 land-info。查到的物件若在前端快照裡，用 search_local_snapshot 找到 key 後 highlight / pin / select_entity。
3. 回答簡潔：3 句內講結論與數字，最後一行用「來源：<工具>·<資料期間>」標註。沒有資料就明說，不要編造。
4. 台北市行政區、商圈與捷運站名用正體中文；金額用「億／萬」；面積用坪並附 m²。
5. 若使用者只是閒聊或問產品，簡短回答並建議一個可示範的指令。
6. 專用工具：等時圈／通勤圈／幾分鐘能到 → show_isochrone；對焦／只看這棟 → focus；企業遷徙動線 → play_trips；日照／陰影 → set_sun；疊圖（段籍界、公有土地、液化）→ set_overlay；展示模式 → presenter；樓層視角／站上 N 樓 → floor_view；分享視角 → share_view。
畫面狀態與資料來源狀態會附在下方（由 server 提供）。`;

function json(res, code, body) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
function html(res, code, body) { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); }
function readBody(req, limit = 2e6) { return new Promise((resolve, reject) => { let n = 0; const chunks = []; req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); }); req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } }); req.on('error', reject); }); }
function sanitizeMessages(msgs) {
  if (!Array.isArray(msgs)) throw new Error('messages must be an array');
  const out = msgs.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content != null).slice(-24);
  if (!out.length || out[0].role !== 'user') throw new Error('conversation must start with a user message');
  return out;
}
export async function runAgent({ messages, view }) {
  if (!client) throw new Error('ANTHROPIC_API_KEY not set');
  const mcp = await mcpProbe(); const tok = mcp.status === 'live' ? await validToken() : null;
  const tools = [...CAMERA_TOOLS]; const extra = {};
  if (tok) { tools.push({ type: 'mcp_toolset', mcp_server_name: 'funraise' }); extra.mcp_servers = [{ type: 'url', url: MCP_URL, name: 'funraise', authorization_token: tok.access_token }]; extra.betas = ['mcp-client-2025-11-20']; }
  const sourceNote = tok ? '資料來源：FUNRAISE MCP 即時（LIVE）。優先用 MCP 工具查詢，快照只用來定位畫面物件。' : `資料來源：本地快照（FUNRAISE MCP ${mcp.status === 'unauthorized' ? '尚未授權：請使用者按右上角「授權」' : '目前連不上'}）。只能用 search_local_snapshot 與畫面工具；回答時註明「快照 2026-09-14」。`;
  const res = await client.beta.messages.create({ model: MODEL, max_tokens: 6000, thinking: { type: 'adaptive' }, system: SYSTEM + '\n\n## 資料來源狀態\n' + sourceNote + '\n\n## 目前畫面狀態\n' + JSON.stringify(view || {}), messages: sanitizeMessages(messages), tools, ...extra });
  for (const b of res.content) if (b.type === 'mcp_tool_result' && b.is_error && /401|unauthori|invalid_token|forbidden/i.test(JSON.stringify(b.content || ''))) { mcpState = { status: 'unauthorized', checked: Date.now(), reason: 'MCP rejected the token during a call' }; }
  return { content: res.content, stop_reason: res.stop_reason, usage: res.usage, model: res.model, source: tok ? 'live' : 'snapshot' };
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

if (process.argv.includes('--check')) { const m = await mcpProbe(true).catch(e => ({ status: 'error', reason: e.message })); console.log(JSON.stringify({ ok: !!client, model: MODEL, mcp: mcpSummary(m), tts: FISH_KEY ? 'fish:' + FISH_MODEL : 'none', voices: VOICES.map(v => v.id), redirect_uri: REDIRECT_URI, tools: CAMERA_TOOLS.map(t => t.name), port: PORT }, null, 2)); process.exit(0); }

if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'OPTIONS') return json(res, 204, {});
      if (url.pathname === '/api/health') { const m = await mcpProbe(url.searchParams.has('force')); return json(res, 200, { ok: !!client, model: MODEL, mcp: mcpSummary(m), tools: CAMERA_TOOLS.length, tts: FISH_KEY ? 'fish' : 'none', voices: VOICES.map(v => ({ id: v.id, name: v.name, desc: v.desc, gender: v.gender })) }); }
      if (url.pathname === '/api/voices') return json(res, 200, { fish: !!FISH_KEY, model: FISH_MODEL, voices: VOICES.map(v => ({ id: v.id, name: v.name, desc: v.desc, gender: v.gender })) });
      if (url.pathname === '/api/tts' && req.method === 'POST') { const body = await readBody(req, 64000); const t0 = Date.now(); const out = await synthesize(body.text, body.voice, { speed: Math.min(2, Math.max(0.5, +body.speed || 1)) }); console.log(`[tts] ${out.voice.id} ${out.cached ? 'cache' : 'fish'} ${Date.now() - t0} ms · ${String(body.text).slice(0, 40)}`); const st = fs.statSync(out.file); res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': st.size, 'cache-control': 'public, max-age=86400', 'x-tts-voice': out.voice.id, 'x-tts-cached': out.cached ? '1' : '0', 'access-control-allow-origin': '*' }); return fs.createReadStream(out.file).pipe(res); }
      if (url.pathname === '/api/mcp/authorize') { const loc = await beginAuthorize(); res.writeHead(302, { location: loc, 'cache-control': 'no-store' }); return res.end(); }
      if (url.pathname === '/api/mcp/callback') { const err = url.searchParams.get('error'); if (err) return html(res, 400, CALLBACK_PAGE(false, `${err}: ${url.searchParams.get('error_description') || ''}`)); try { await finishAuthorize(url.searchParams.get('code'), url.searchParams.get('state')); const m = await mcpProbe(true); return html(res, 200, CALLBACK_PAGE(m.status === 'live', m.status === 'live' ? `已連上 ${m.server && m.server.name ? m.server.name : 'FUNRAISE MCP'}。` : `已取得 token，但探測回報 ${m.status}（${m.reason || ''}）。`)); } catch (e) { return html(res, 400, CALLBACK_PAGE(false, e.message)); } }
      if (url.pathname === '/api/mcp/logout' && req.method === 'POST') { store.clear(); mcpState = { status: 'unknown', checked: 0 }; return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/agent' && req.method === 'POST') { const body = await readBody(req); const t0 = Date.now(); const out = await runAgent(body); console.log(`[agent] ${out.stop_reason} · ${out.source} · ${out.usage ? out.usage.input_tokens + '→' + out.usage.output_tokens + ' tok' : ''} · ${Date.now() - t0} ms`); return json(res, 200, out); }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown route' });
      return serveStatic(req, res);
    } catch (e) { console.error('[error]', e); return json(res, e.status || 500, { error: e.message || String(e) }); }
  }).listen(PORT, async () => {
    const m = await mcpProbe(true).catch(e => ({ status: 'error', reason: e.message }));
    console.log(`PeakLens agent server on http://localhost:${PORT}  model=${MODEL}  claude=${client ? 'on' : 'OFF (set ANTHROPIC_API_KEY)'}  mcp=${m.status}${m.reason ? ' (' + m.reason + ')' : ''}  tts=${FISH_KEY ? 'fish' : 'none'}  authorize=${PUBLIC_URL}/api/mcp/authorize  static=${fs.existsSync(path.join(DIST, 'index.html')) ? 'dist/' : 'none'}`);
  });
}
