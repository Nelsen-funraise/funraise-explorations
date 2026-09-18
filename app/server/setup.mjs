// /setup — a localhost-only page to paste API keys into app/.env, test each one and rebuild the front end. Never reachable from another host.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { testOrs } from './routes/ors.mjs';
import { testLive } from './routes/live.mjs';

export const KEYS = [
  { k: 'OPENAI_API_KEY', label: 'OpenAI API key', group: 'AI agent（對城市說話的大腦）', hint: 'Responses API + FUNRAISE MCP 工具；有這把就會自動用 OpenAI', test: 'llm' },
  { k: 'OPENAI_MODEL', label: 'OpenAI 模型', group: 'AI agent（對城市說話的大腦）', hint: '預設 gpt-4.1；可填 gpt-5（會用 reasoning: low）', secret: false },
  { k: 'ANTHROPIC_API_KEY', label: 'Anthropic API key（可選）', group: 'AI agent（對城市說話的大腦）', hint: '兩把都有時預設 OpenAI，用 LLM_PROVIDER 指定', test: 'llm' },
  { k: 'LLM_PROVIDER', label: 'LLM_PROVIDER（可空）', group: 'AI agent（對城市說話的大腦）', hint: 'openai 或 anthropic', secret: false },
  { k: 'FISH_API_KEY', label: 'Fish Audio', group: '語音', hint: 'Nelsen／Eunice 聲音模型；免費模型 s2.1-pro-free', test: 'fish' },
  { k: 'CWA_API_KEY', label: '中央氣象署 授權碼', group: '即時資料（server 代理）', hint: 'opendata.cwa.gov.tw → 取得授權碼', test: 'cwa' },
  { k: 'MOENV_AQI_API_KEY', label: '環境部 api_key', group: '即時資料（server 代理）', hint: 'data.moenv.gov.tw', test: 'moenv' },
  { k: 'TDX_CLIENT_ID', label: 'TDX client_id', group: '即時資料（server 代理）', hint: 'tdx.transportdata.tw 會員中心 → 應用管理', secret: false, test: 'tdx' },
  { k: 'TDX_CLIENT_SECRET', label: 'TDX client_secret', group: '即時資料（server 代理）', test: 'tdx' },
  { k: 'ORS_API_KEY', label: 'OpenRouteService', group: '分析（server 代理）', hint: '真實路網步行／開車等時圈', test: 'ors' },
  { k: 'MAPILLARY_ACCESS_TOKEN', label: 'Mapillary（可選）', group: '分析（server 代理）', test: 'mapillary' },
  { k: 'CARTO_API_KEY', label: 'CARTO（可選）', group: '底圖', hint: '目前無 key 也能跑' },
  { k: 'VITE_CESIUM_ION_TOKEN', label: 'Cesium ion token', group: '實景 3D 與前端金鑰（存檔後要按「重新 build」）', hint: '有這把就會載入 Google 相片級 3D Tiles（實景 Look，透過 Cesium ion 資產 2275207，不需另外的 Google 金鑰）與 World Terrain', test: 'ion' },
  { k: 'VITE_GOOGLE_MAPS_API_KEY', label: 'Google Maps Platform（可選）', group: '實景 3D 與前端金鑰（存檔後要按「重新 build」）', hint: '可選：直接向 Google 取相片級 3D Tiles（不經 ion，配額算在你的 Google Cloud 專案；要啟用 Map Tiles API）' },
  { k: 'FUNRAISE_MCP_URL', label: 'FUNRAISE MCP URL', group: 'FUNRAISE', secret: false, hint: '改了要重啟 server' },
];
const mask = v => !v ? '' : v.length <= 8 ? '••••' : v.slice(0, 3) + '…' + v.slice(-4);
const isLocal = (req) => { const a = req.socket && req.socket.remoteAddress || ''; const host = (req.headers.host || '').split(':')[0]; return /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(a) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host); };

export function writeEnv(file, values) { // replace / append / remove KEY=value lines, keep everything else as-is
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : []; const seen = new Set();
  const out = lines.map(line => { const m = line.match(/^\s*([A-Z0-9_]+)\s*=/); if (!m || !(m[1] in values)) return line; seen.add(m[1]); const v = values[m[1]]; return v ? `${m[1]}=${v}` : null; }).filter(l => l !== null);
  for (const [k, v] of Object.entries(values)) if (!seen.has(k) && v) out.push(`${k}=${v}`);
  while (out.length && out[out.length - 1] === '') out.pop();
  fs.writeFileSync(file, out.join('\n') + '\n', { mode: 0o600 }); try { fs.chmodSync(file, 0o600); } catch { /* windows */ }
}

async function testKey(key, env, getLLM) {
  const t = async (url, init) => { const r = await fetch(url, init); let j = null; try { j = await r.json(); } catch { /* not json */ } return { r, j }; };
  try {
    switch (KEYS.find(x => x.k === key)?.test) {
      case 'llm': { const llm = getLLM(); if (!llm) return { ok: false, detail: '沒有可用的 LLM 金鑰' }; const res = await llm.test(); return { ...res, detail: `${llm.provider} · ${llm.model} · ${res.detail}` }; }
      case 'fish': { if (!env.FISH_API_KEY) return { ok: false, detail: '未設定' }; const { r, j } = await t('https://api.fish.audio/model?self=true&page_size=3', { headers: { authorization: `Bearer ${env.FISH_API_KEY}` } }); return r.ok ? { ok: true, detail: `帳號內 ${j && j.total != null ? j.total : '?'} 個聲音模型` } : { ok: false, detail: `HTTP ${r.status}` }; }
      case 'cwa': { if (!(env.CWA_API_KEY)) return { ok: false, detail: '未設定' }; const all = await testLive(env); return all.cwa || { ok: false, detail: '無回應' }; }
      case 'moenv': { if (!(env.MOENV_AQI_API_KEY)) return { ok: false, detail: '未設定' }; const all = await testLive(env); return all.moenv || { ok: false, detail: '無回應' }; }
      case 'tdx': { if (!(env.TDX_CLIENT_ID && env.TDX_CLIENT_SECRET)) return { ok: false, detail: '未設定' }; const all = await testLive(env); return all.tdx || { ok: false, detail: '無回應' }; }
      case 'ors': { if (!env.ORS_API_KEY) return { ok: false, detail: '未設定' }; return testOrs(env); }
      case 'mapillary': { if (!env.MAPILLARY_ACCESS_TOKEN) return { ok: false, detail: '未設定' }; const { r, j } = await t(`https://graph.mapillary.com/images?access_token=${encodeURIComponent(env.MAPILLARY_ACCESS_TOKEN)}&fields=id&bbox=121.56,25.03,121.57,25.04&limit=1`); return r.ok ? { ok: true, detail: `影像 API 可用（${j && j.data ? j.data.length : 0} 張）` } : { ok: false, detail: `HTTP ${r.status}` }; }
      case 'ion': { if (!env.VITE_CESIUM_ION_TOKEN) return { ok: false, detail: '未設定' }; const { r, j } = await t('https://api.cesium.com/v1/me', { headers: { authorization: `Bearer ${env.VITE_CESIUM_ION_TOKEN}` } }); return r.ok ? { ok: true, detail: `ion 帳號 ${j && (j.username || j.email) || ''} · 記得重新 build` } : { ok: false, detail: `HTTP ${r.status}` }; }
      default: return { ok: !!env[key], detail: env[key] ? '已設定（此項無線上測試）' : '未設定' };
    }
  } catch (e) { return { ok: false, detail: e.message }; }
}

export function createSetup({ env, envFile, reload, getLLM, appRoot, getMcpToken }) {
  let build = { running: false, log: '', code: null, at: 0 };
  const state = () => ({ envFile, provider: getLLM() ? getLLM().provider : null, model: getLLM() ? getLLM().model : null, build: { running: build.running, code: build.code, at: build.at, tail: build.log.slice(-1200) }, keys: KEYS.map(d => ({ ...d, set: !!env[d.k], masked: d.secret === false ? (env[d.k] || '') : mask(env[d.k] || '') })) });
  const startBuild = () => { if (build.running) return false; build = { running: true, log: '', code: null, at: Date.now() }; const p = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: appRoot, env: { ...process.env, ...Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('VITE_'))) } }); const onData = d => { build.log = (build.log + d.toString()).slice(-20000); }; p.stdout.on('data', onData); p.stderr.on('data', onData); p.on('close', code => { build.running = false; build.code = code; }); p.on('error', e => { build.running = false; build.code = -1; build.log += '\n' + e.message; }); return true; };
  return {
    isLocal,
    async api(req, res, url, readBody, json) {
      if (!isLocal(req)) return json(res, 403, { error: 'setup 只允許從本機（localhost）存取' });
      if (url.pathname === '/api/setup' && req.method === 'GET') return json(res, 200, state());
      if (url.pathname === '/api/setup' && req.method === 'POST') { const body = await readBody(req, 64000); const values = {}; for (const [k, v] of Object.entries(body.values || {})) if (KEYS.some(d => d.k === k)) values[k] = String(v ?? '').trim(); writeEnv(envFile, values); reload(); return json(res, 200, { saved: Object.keys(values), ...state() }); }
      if (url.pathname === '/api/setup/test' && req.method === 'POST') { const body = await readBody(req, 4000); const out = await testKey(String(body.key || ''), env, getLLM); return json(res, 200, { key: body.key, ...out }); }
      // Phase：Vercel — 「匯出 MCP token」：本機授權一次之後，把 server/.mcp-token.json 整份內容原樣交給前端，
      // 讓 owner 貼進 Vercel 的 FUNRAISE_MCP_TOKEN_JSON（見 index.mjs 開機時的 seed 邏輯）。跟其他 /api/setup/*
      // 一樣只限本機（上面已經擋過 isLocal），內容本身也只在按下「顯示」之後才會被前端拿去畫面上顯示。
      if (url.pathname === '/api/setup/mcp-token' && req.method === 'GET') { const info = getMcpToken ? getMcpToken() : { token: null, static: false, persist: 'none' }; return json(res, 200, info); }
      if (url.pathname === '/api/setup/build' && req.method === 'POST') return json(res, 200, { started: startBuild(), running: true });
      if (url.pathname === '/api/setup/build' && req.method === 'GET') return json(res, 200, state().build);
      return json(res, 404, { error: 'unknown setup route' });
    },
    page(req, res) {
      if (!isLocal(req)) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('setup 只允許從本機（localhost）存取'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(PAGE);
    },
  };
}

const PAGE = `<!doctype html><html lang="zh-Hant-TW"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>睿鏡 PeakLens · 金鑰設定</title>
<style>
:root{--blue:#16A4C0;--blue-d:#0C83A2;--warm:#F29628;--ink:#1E2939;--ink2:#4A5565;--ink3:#99A1AF;--line:#E5E7EB;--bg:#F3F4F6;--panel:#fff}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 Inter,"Noto Sans TC",system-ui,sans-serif;color:var(--ink);background:var(--bg)}
header{display:flex;align-items:center;gap:14px;padding:18px 24px;background:var(--panel);border-bottom:1px solid var(--line)}header h1{margin:0;font-size:18px}header h1 em{color:var(--blue);font-style:normal}
.status{margin-left:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--ink2)}
main{max-width:900px;margin:0 auto;padding:20px 24px 60px}.note{background:#fff7ed;border:1px solid #fed7aa;color:#9a4b12;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px}
section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:14px}section h2{margin:0 0 10px;font-size:13px;letter-spacing:.06em;color:var(--ink3);text-transform:uppercase}
.row{display:grid;grid-template-columns:230px 1fr auto auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}
label b{display:block;font-weight:600}label small{color:var(--ink3);display:block;line-height:1.3}
input{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font:13px ui-monospace,Menlo,monospace;color:var(--ink)}input:focus{outline:2px solid var(--blue);border-color:transparent}
button{padding:7px 12px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);cursor:pointer;font-size:13px}button.primary{background:var(--blue-d);border-color:transparent;color:#fff;font-weight:600}button:disabled{opacity:.5;cursor:default}
.res{font-size:12px;min-width:150px;max-width:260px;color:var(--ink2)}.res.ok{color:#047857}.res.bad{color:#b91c1c}.masked{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--ink3)}
footer{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px}pre{background:#0b1220;color:#cbd5e1;padding:10px;border-radius:8px;font-size:11px;max-height:200px;overflow:auto;white-space:pre-wrap}
@media(max-width:720px){.row{grid-template-columns:1fr}}
</style>
<header><h1>睿鏡 <em>PeakLens</em> · 金鑰設定</h1><div class="status" id="status">載入中…</div></header>
<main>
<div class="note">這一頁只在你自己的電腦（localhost）看得到；貼上的金鑰只寫進 <code id="envfile">app/.env</code>，不會進 git、不會傳到別的地方。server 端金鑰存檔後立即生效；<b>前端金鑰（VITE_*）</b>存檔後要按下方「重新 build」。</div>
<form id="f" onsubmit="return false"></form>
<footer><button class="primary" id="save">儲存到 .env</button><button id="testall">全部測試</button><button id="build">重新 build（前端金鑰）</button><span class="res" id="saveres"></span></footer>
<pre id="buildlog" hidden></pre>
<section>
<h2>匯出 MCP token（貼到 Vercel 的 FUNRAISE_MCP_TOKEN_JSON）</h2>
<p style="margin:0 0 10px;color:var(--ink2);font-size:13px">部署到 Vercel 的 server 沒有持久硬碟，存不住 <code>server/.mcp-token.json</code>。在這台電腦上完成一次 FUNRAISE MCP 授權後，把下面這段 JSON 整包貼進 Vercel 專案的環境變數 <code>FUNRAISE_MCP_TOKEN_JSON</code>，開機時就會用它還原 token，不用再授權一次。refresh token 過期輪替後（<code>/api/health</code> 的 <code>mcp.warning</code> 會提醒）記得回來重新匯出、更新 Vercel 上的值。</p>
<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><button type="button" id="mcpReveal">顯示</button><button type="button" id="mcpCopy" disabled>複製</button><span class="res" id="mcpRes"></span></div>
<pre id="mcpJson" style="user-select:none">••••••••••••••••••••••••••••••••••••••••</pre>
</section>
</main>
<script>
const $=s=>document.querySelector(s);let ST=null;
async function load(){ST=await (await fetch('/api/setup')).json();$('#envfile').textContent=ST.envFile;$('#status').textContent=ST.provider?('AI agent：'+ST.provider+' · '+ST.model):'AI agent：尚未設定金鑰';render();}
function render(){const groups={};for(const k of ST.keys)(groups[k.group]=groups[k.group]||[]).push(k);const f=$('#f');f.innerHTML='';for(const [g,keys] of Object.entries(groups)){const s=document.createElement('section');s.innerHTML='<h2>'+g+'</h2>'+keys.map(k=>'<div class="row"><label for="i-'+k.k+'"><b>'+k.label+'</b><small>'+(k.hint||'')+' <span class="masked">'+(k.set?('目前：'+(k.masked||'（已設）')):'未設定')+'</span></small></label><input id="i-'+k.k+'" name="'+k.k+'" type="'+(k.secret===false?'text':'password')+'" placeholder="'+(k.set?'貼上新值可覆蓋，留空不變':'貼上')+'" autocomplete="off" spellcheck="false">'+(k.test?'<button type="button" data-test="'+k.k+'">測試</button>':'<span></span>')+'<span class="res" id="r-'+k.k+'"></span></div>').join('');f.appendChild(s);}
 f.querySelectorAll('[data-test]').forEach(b=>b.onclick=()=>test(b.dataset.test));}
async function test(k){const r=$('#r-'+k);r.textContent='測試中…';r.className='res';const j=await (await fetch('/api/setup/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:k})})).json();r.textContent=(j.ok?'✓ ':'✗ ')+(j.detail||'');r.className='res '+(j.ok?'ok':'bad');}
$('#save').onclick=async()=>{const values={};for(const inp of $('#f').querySelectorAll('input'))if(inp.value.trim())values[inp.name]=inp.value.trim();if(!Object.keys(values).length){$('#saveres').textContent='沒有新值';return;}$('#saveres').textContent='儲存中…';const j=await (await fetch('/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({values})})).json();ST=j;$('#saveres').textContent='已寫入 '+j.saved.join(', ')+(j.saved.some(k=>k.startsWith('VITE_'))?'（含前端金鑰：請按「重新 build」）':'');$('#saveres').className='res ok';render();$('#status').textContent=ST.provider?('AI agent：'+ST.provider+' · '+ST.model):'AI agent：尚未設定金鑰';for(const k of j.saved)if(ST.keys.find(x=>x.k===k&&x.test))test(k);};
$('#testall').onclick=()=>{for(const k of ST.keys)if(k.test&&k.set)test(k.k);};
$('#build').onclick=async()=>{await fetch('/api/setup/build',{method:'POST'});$('#buildlog').hidden=false;const tick=async()=>{const b=await (await fetch('/api/setup/build')).json();$('#buildlog').textContent=b.tail||'…';if(b.running)setTimeout(tick,1500);else $('#buildlog').textContent+='\\n[完成 · exit '+b.code+'] 重新整理 http://localhost:'+location.port+'/ 即可';};tick();};
let mcpRevealed=null;
$('#mcpReveal').onclick=async()=>{const r=$('#mcpRes');r.textContent='讀取中…';r.className='res';const j=await (await fetch('/api/setup/mcp-token')).json();
 if(j.static){$('#mcpJson').textContent='目前用的是固定 Token（環境變數 FUNRAISE_MCP_TOKEN），把同一把貼到 Vercel 的 FUNRAISE_MCP_TOKEN 就好，不需要這段 JSON。';r.textContent='';return;}
 if(!j.token){$('#mcpJson').textContent='尚未授權——先在主畫面按右上角「授權」，走完一次 FUNRAISE MCP 登入再回來這頁。';r.textContent='';return;}
 mcpRevealed=JSON.stringify(j.token,null,2);$('#mcpJson').textContent=mcpRevealed;$('#mcpJson').style.userSelect='text';$('#mcpCopy').disabled=false;r.textContent='persist：'+j.persist;r.className='res ok';};
$('#mcpCopy').onclick=async()=>{if(!mcpRevealed)return;try{await navigator.clipboard.writeText(mcpRevealed);$('#mcpRes').textContent='已複製';$('#mcpRes').className='res ok';}catch(e){$('#mcpRes').textContent='複製失敗，請手動選取複製';$('#mcpRes').className='res bad';}};
load();
</script></html>`;
