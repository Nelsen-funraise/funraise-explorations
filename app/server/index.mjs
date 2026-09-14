#!/usr/bin/env node
// PeakLens agent server — Claude (official Anthropic SDK) + FUNRAISE MCP connector + camera/layer tools executed by the browser.
// Routes: GET /api/health · POST /api/agent {messages, view} → {content, stop_reason, usage}. Also serves ../dist when built.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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
const MCP_URL = env.FUNRAISE_MCP_URL || '';
const MCP_TOKEN = env.FUNRAISE_MCP_TOKEN || '';
const useMcp = !!(MCP_URL && MCP_TOKEN);
const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

const LAYER_KEYS = ['stock', 'future', 'licenses', 'renewal', 'zones', 'mops', 'moves', 'infra', 'parks', 'heat', 'mrt'];
const CAMERA_TOOLS = [
  { name: 'fly_to', description: '把相機飛到一個地點。可給地名（大樓、商圈、行政區、捷運站、園區，前端會用本地快照解析）或經緯度。', input_schema: { type: 'object', properties: { place: { type: 'string', description: '地名，例如「台北101」「信義計畫區」「內湖科技園區」「南港展覽館站」' }, lon: { type: 'number' }, lat: { type: 'number' }, range_m: { type: 'number', description: '相機到目標的距離（公尺）。單棟 500–900，街廓 1500–3000，行政區 5000–9000，全市 15000' }, pitch: { type: 'number', description: '俯角，-90 為正俯視；街景 -14、單棟 -32、區域 -50、全市 -62' }, heading: { type: 'number', description: '方位角（度）' } } } },
  { name: 'set_camera_mode', description: '切換相機模式：city 俯視、orbit 環繞（可指定地點）、street 街景、globe 全台。', input_schema: { type: 'object', properties: { mode: { type: 'string', enum: ['city', 'orbit', 'street', 'globe'] }, place: { type: 'string' }, range_m: { type: 'number' } }, required: ['mode'] } },
  { name: 'set_lens', description: '切換使用者視角（鏡）：investor 投資人、developer 開發商、occupier 企業選址、city 城市治理、research 學研。會套用該鏡的預設圖層。', input_schema: { type: 'object', properties: { lens: { type: 'string', enum: ['investor', 'developer', 'occupier', 'city', 'research'] } }, required: ['lens'] } },
  { name: 'set_layers', description: `顯示／隱藏圖層。可用鍵：${LAYER_KEYS.join(', ')}（stock 商辦存量、future 未來供給、licenses 建照、renewal 都更單元、zones 重劃區、mops 上市櫃資產交易、moves 企業遷徙、infra 公共建設、parks 產業園區、heat 商圈行情、mrt 捷運）。`, input_schema: { type: 'object', properties: { show: { type: 'array', items: { type: 'string', enum: LAYER_KEYS } }, hide: { type: 'array', items: { type: 'string', enum: LAYER_KEYS } } } } },
  { name: 'set_year', description: '設定時間軸年份（2012–2030）。過去年份只顯示當年已存在的大樓；未來年份讓規劃中建案長高變實體。', input_schema: { type: 'object', properties: { year: { type: 'integer', minimum: 2012, maximum: 2030 } }, required: ['year'] } },
  { name: 'set_sensor', description: '切換畫面感測濾鏡：normal、night 夜視、thermal 熱感、blueprint 藍圖。', input_schema: { type: 'object', properties: { sensor: { type: 'string', enum: ['normal', 'night', 'thermal', 'blueprint'] } }, required: ['sensor'] } },
  { name: 'highlight', description: '讓地圖上的物件脈衝發光。key 格式：stock:<building_id>、future:<id>、renewal:<id>、mops:<id>、license:<建照號>、move:<統編>、infra:<id>、ipark:<id>、zone:<id>、heat:<area_id>、mrt:<站名>。id 可用 search_local_snapshot 查。', input_schema: { type: 'object', properties: { keys: { type: 'array', items: { type: 'string' } }, ms: { type: 'integer' } }, required: ['keys'] } },
  { name: 'get_view_state', description: '取得目前畫面狀態：相機中心、行政區、年份、鏡、可見圖層、選取物件、視野內各圖層數量。', input_schema: { type: 'object', properties: {} } },
  { name: 'search_local_snapshot', description: '在前端本地資料快照中用名稱搜尋物件（商辦、建案、都更單元、上市櫃交易、公建、園區、重劃區），回傳 key 與座標，用於 highlight / fly_to / select_entity。', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'show_chart', description: '在右側面板顯示長條圖（比較、排名、金額）。', input_schema: { type: 'object', properties: { title: { type: 'string' }, rows: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' }, display: { type: 'string', description: '顯示用文字，例如「4.8 億」' } }, required: ['label', 'value'] } } }, required: ['title', 'rows'] } },
  { name: 'select_entity', description: '選取地圖物件並在面板顯示其詳細資料（key 同 highlight）。', input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
];
const SYSTEM = `你是「睿鏡 PeakLens」的地圖 agent：FUNRAISE 方睿科技的台灣不動產上帝視角（God's Eye View × FUNRAISE MCP）。使用者是不動產投資人、開發商、企業選址主管、政府局處或學研人員，用口語（繁體中文）對城市發問；你同時「操作畫面」與「回答問題」。

規則：
1. 先動畫面再說話：地點問題先 fly_to／set_camera_mode；清單或比較問題用 highlight + show_chart；時間問題用 set_year；視角問題用 set_lens。一次可呼叫多個工具。
2. 資料以 FUNRAISE MCP 工具（若可用）的查詢結果為準：商辦 buildings、都更 urban-renewal、實價登錄 actual-price-*、上市櫃資產 mops-property、建照 taipei-licenses、公司登記 company-registry、產業園區 industrial-parks、公共建設 public-infras、商圈 areas、土地與使用分區 land-info。查到的物件若在前端快照裡，用 search_local_snapshot 找到 key 後 highlight / select_entity。
3. 回答簡潔：3 句內講結論與數字，最後一行用「來源：<工具>·<資料期間>」標註。沒有資料就明說，不要編造。
4. 台北市行政區、商圈與捷運站名用正體中文；金額用「億／萬」；面積用坪並附 m²。
5. 若使用者只是閒聊或問產品，簡短回答並建議一個可示範的指令。
畫面狀態會附在下方（由前端提供）。`;

function json(res, code, body) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); res.end(JSON.stringify(body)); }
function readBody(req, limit = 2e6) { return new Promise((resolve, reject) => { let n = 0; const chunks = []; req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); }); req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } }); req.on('error', reject); }); }
function sanitizeMessages(msgs) {
  if (!Array.isArray(msgs)) throw new Error('messages must be an array');
  const out = msgs.filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content != null).slice(-24);
  if (!out.length || out[0].role !== 'user') throw new Error('conversation must start with a user message');
  return out;
}
export async function runAgent({ messages, view }) {
  if (!client) throw new Error('ANTHROPIC_API_KEY not set');
  const tools = [...CAMERA_TOOLS]; const extra = {};
  if (useMcp) { tools.push({ type: 'mcp_toolset', mcp_server_name: 'funraise' }); extra.mcp_servers = [{ type: 'url', url: MCP_URL, name: 'funraise', authorization_token: MCP_TOKEN }]; extra.betas = ['mcp-client-2025-11-20']; }
  const res = await client.beta.messages.create({ model: MODEL, max_tokens: 6000, thinking: { type: 'adaptive' }, system: SYSTEM + '\n\n## 目前畫面狀態\n' + JSON.stringify(view || {}), messages: sanitizeMessages(messages), tools, ...extra });
  return { content: res.content, stop_reason: res.stop_reason, usage: res.usage, model: res.model };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2', '.woff2': 'font/woff2', '.woff': 'font/woff', '.xml': 'application/xml', '.map': 'application/json', '.webp': 'image/webp', '.czml': 'application/json', '.txt': 'text/plain' };
const DIST = path.join(root, 'dist');
function serveStatic(req, res) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) return json(res, 404, { error: 'no dist/ build yet — run `npm run build`, or use `npm run dev` (Vite proxies /api here)' });
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(DIST, p)); if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': p === '/index.html' ? 'no-cache' : 'public, max-age=3600' }); fs.createReadStream(file).pipe(res);
}

if (process.argv.includes('--check')) { console.log(JSON.stringify({ ok: !!client, model: MODEL, mcp: useMcp, mcp_url: useMcp ? MCP_URL : null, tools: CAMERA_TOOLS.map(t => t.name), port: PORT }, null, 2)); process.exit(0); }

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'OPTIONS') return json(res, 204, {});
      if (url.pathname === '/api/health') return json(res, 200, { ok: !!client, model: MODEL, mcp: useMcp, tools: CAMERA_TOOLS.length });
      if (url.pathname === '/api/agent' && req.method === 'POST') { const body = await readBody(req); const t0 = Date.now(); const out = await runAgent(body); console.log(`[agent] ${out.stop_reason} · ${out.usage ? out.usage.input_tokens + '→' + out.usage.output_tokens + ' tok' : ''} · ${Date.now() - t0} ms`); return json(res, 200, out); }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown route' });
      return serveStatic(req, res);
    } catch (e) { console.error('[error]', e); const code = e.status || 500; return json(res, code, { error: e.message || String(e) }); }
  }).listen(PORT, () => console.log(`PeakLens agent server on http://localhost:${PORT}  model=${MODEL}  claude=${client ? 'on' : 'OFF (set ANTHROPIC_API_KEY)'}  mcp=${useMcp ? 'on' : 'off (set FUNRAISE_MCP_URL + FUNRAISE_MCP_TOKEN)'}  static=${fs.existsSync(path.join(DIST, 'index.html')) ? 'dist/' : 'none'}`));
}
