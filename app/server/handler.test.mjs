// server/handler.test.mjs — Phase：Vercel。端對端測試 `export const handler`（app/api/index.mjs 這支
// Vercel adapter 實際會 import 並呼叫的同一個函式）：用 PEAKLENS_NO_LISTEN=1 匯入 server/index.mjs（不要它自己
// .listen()），自己接一個 ephemeral port 的 http.createServer(handler)，像真的 client 一樣打過去。
// 同一套風格：純 Node、沒有測試框架、`node server/handler.test.mjs` 或 `node --test`（在 server/ 裡跑，見
// docs/12-hosting.md 的驗證章節）都能執行。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

let pass = 0, fail = 0;
function assert(label, cond, extra) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : extra !== undefined ? `\n   ${JSON.stringify(extra)}` : ''}`); if (cond) pass++; else fail++; }
function check(label, got, want) { const g = JSON.stringify(got), w = JSON.stringify(want); const ok = g === w; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n   got:  ${g}\n   want: ${w}`}`); if (ok) pass++; else fail++; }

// ---- 逼出一個「唯讀」狀態目錄，不靠 chmod（sandbox 常常是 root，chmod 對 root 沒有意義）：讓路徑的某一段
// 本身是「檔案」而不是目錄，mkdir -p 在任何權限（含 root）下都一定 ENOTDIR，效果跟 Vercel function 上的
// EROFS/EACCES 一樣——「這個目錄用不了」。用它當整支測試的 PEAKLENS_STATE_DIR，一次驗證「唯讀狀態目錄
// 不會讓開機掛掉、其餘功能照常」，比只測 resolveStateDir() 本身更接近真實情境。
// resolveStateDir() 的 tmp 備援永遠是同一個固定路徑（os.tmpdir()/peaklens）——這是設計上刻意的（同一台機器
// 上不同 process／同一個 Lambda instance 重複呼叫都要找得到同一份），但也代表它是「共用、跨這支測試存活」
// 的位置：先前手動驗證或上一次測試如果在同一台機器留過 .mcp-token.json，這裡會撿到，把「應該是空的」斷言
// 弄髒。開頭先清掉，確保這支測試從乾淨狀態開始，不受機器上其他 process 的歷史殘留影響。
try { fs.rmSync(path.join(os.tmpdir(), 'peaklens'), { recursive: true, force: true }); } catch { /* 沒有就算了 */ }

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'peaklens-handler-test-'));
const blockerFile = path.join(tmpRoot, 'this-is-a-file-not-a-dir');
fs.writeFileSync(blockerFile, 'x');
const BROKEN_STATE_DIR = path.join(blockerFile, 'nested-state'); // mkdirSync(recursive:true) 在這裡一定丟 ENOTDIR

console.log('=== resolveStateDir()：壞路徑（ENOTDIR）不丟例外，回退到 os.tmpdir()/peaklens ===');
{
  const { resolveStateDir } = await import('./statedir.mjs');
  const warned = []; const realWarn = console.warn; console.warn = (...a) => warned.push(a.join(' '));
  let out, threw = false;
  try { out = resolveStateDir(BROKEN_STATE_DIR); } catch { threw = true; } finally { console.warn = realWarn; }
  assert('resolveStateDir 不丟例外', !threw);
  check('回退到 os.tmpdir()/peaklens', out, path.join(os.tmpdir(), 'peaklens'));
  assert('印了一次警告，內容提到「不可寫」', warned.length === 1 && /不可寫/.test(warned[0]), warned);
}

// ---- 整支 server：PEAKLENS_NO_LISTEN=1（不要 .listen()，下面自己接 http.createServer(handler)）、
// PEAKLENS_STATE_DIR 指到上面那個壞路徑（驗證「唯讀狀態目錄不會讓開機掛掉」）、PEAKLENS_DEMO_LIVE=1（/api/env
// 才有擬真資料可斷言）、PEAKLENS_ACCESS_CODE 設一組碼（驗證存取碼擋門）。這些都是「匯入當下」就定案的環境
// 變數，必須在 import server/index.mjs 之前設好；PEAKLENS_DIST 指到一個空目錄，讓這支測試不必依賴專案的
// dist/ 是否已經 build 過。
process.env.PEAKLENS_NO_LISTEN = '1';
process.env.PEAKLENS_STATE_DIR = BROKEN_STATE_DIR;
process.env.PEAKLENS_DEMO_LIVE = '1';
process.env.PEAKLENS_ACCESS_CODE = 'test-code-123'; // HTTP header 值只能是 ByteString（ASCII），不能用中文
const emptyDist = fs.mkdtempSync(path.join(os.tmpdir(), 'peaklens-handler-test-dist-'));
process.env.PEAKLENS_DIST = emptyDist;

console.log('\n=== import server/index.mjs（PEAKLENS_STATE_DIR 是壞路徑）不應該丟例外 ===');
let mod, importThrew = null;
try { mod = await import('./index.mjs'); } catch (e) { importThrew = e; }
assert('import 沒有丟例外（唯讀／壞狀態目錄不會讓開機掛掉）', !importThrew, importThrew && (importThrew.stack || String(importThrew)));
if (importThrew || typeof mod.handler !== 'function') {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

const server = http.createServer(mod.handler);
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
const PORT = server.address().port;
const base = `http://127.0.0.1:${PORT}`;
const CODE = process.env.PEAKLENS_ACCESS_CODE;
async function get(p, headers) { const r = await fetch(base + p, { headers }); let j = null; try { j = await r.json(); } catch { /* 非 JSON 回應（例如 dist 缺檔的純文字 404）就留 null */ } return { status: r.status, json: j }; }

try {
  console.log("\n=== /api/health：200、JSON，mcp.persist 有值（GATE_FREE 裡的路徑，沒帶存取碼也放行） ===");
  {
    const r = await get('/api/health');
    check('status', r.status, 200);
    assert('body 是物件、ok 是 boolean', r.json && typeof r.json.ok === 'boolean', r.json);
    assert('mcp.persist 是 file/env/tmp/none 其中之一', r.json && ['file', 'env', 'tmp', 'none'].includes(r.json.mcp && r.json.mcp.persist), r.json && r.json.mcp);
    check('沒有 token、也沒有 FUNRAISE_MCP_TOKEN_JSON → mcp.persist = none', r.json.mcp.persist, 'none');
  }

  console.log('\n=== 存取碼：PEAKLENS_ACCESS_CODE 已設、缺 header → 401 + need_code；帶對的 header → 通過 ===');
  {
    const noHeader = await get('/api/env');
    check('缺存取碼: status', noHeader.status, 401);
    check('缺存取碼: need_code', noHeader.json && noHeader.json.need_code, true);
    const wrongHeader = await get('/api/env', { 'x-peaklens-code': 'not-the-code' });
    check('存取碼錯誤: status', wrongHeader.status, 401);
    const withHeader = await get('/api/env', { 'x-peaklens-code': CODE });
    check('存取碼正確: status', withHeader.status, 200);
  }

  console.log('\n=== /api/env：PEAKLENS_DEMO_LIVE=1 時回擬真資料（demo:true，§16.8 固定讀數） ===');
  {
    const r = await get('/api/env', { 'x-peaklens-code': CODE });
    check('status', r.status, 200);
    check('demo flag', r.json.demo, true);
    assert('weather 是固定讀數（多雲 30 度）', r.json.weather && r.json.weather.temp === 30 && r.json.weather.desc === '多雲', r.json.weather);
    assert('aqi 是固定讀數（松山、良好）', r.json.aqi && r.json.aqi.site === '松山' && r.json.aqi.status === '良好', r.json.aqi);
  }

  console.log('\n=== /setup：不受存取碼影響（不是 /api/*），從 127.0.0.1 打照樣算本機，回 200 ===');
  { const r = await fetch(base + '/setup'); check('status', r.status, 200); }

  console.log('\n=== 未知 /api/* 路徑：404 ===');
  { const r = await get('/api/not-a-real-route', { 'x-peaklens-code': CODE }); check('status', r.status, 404); }
} finally {
  server.close();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  try { fs.rmSync(emptyDist, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
