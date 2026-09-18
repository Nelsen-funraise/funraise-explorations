// server/statedir.mjs — 可寫入狀態目錄的共用邏輯（Phase：Vercel 部署）。
// 本機／Docker／Cloud Run 整個檔案系統可寫，server/ 自己就是狀態目錄，跟 Phase 9G 之前完全一樣。但 Vercel
// 的 Node function 檔案系統除了 os.tmpdir()（/tmp）都是唯讀的（EROFS）——server/.mcp-token.json、
// server/.tts-cache 這類「開機後才寫」的檔案在那裡會直接炸掉。resolveStateDir() 統一擋掉這件事：
//   1. 先試呼叫端給的偏好目錄（通常是 env.PEAKLENS_STATE_DIR || server 本身）；
//   2. mkdir 之後再「真的寫一個探針檔」確認可寫——唯讀掛載通常 mkdirSync(recursive) 對已存在的目錄不會丟例外，
//      只有真的 write 才會踩到 EROFS/EACCES，所以只驗 mkdir 不夠；
//   3. 寫不進去就整個改道 os.tmpdir()/peaklens，同一個偏好目錄只警告一次（不然每個 request/cold start 都洗版）。
// 呼叫端（index.mjs 的 TOKEN_FILE/TTS_CACHE、routes/live.mjs 的 24h 磁碟快取）自己的每次讀寫仍然各自包
// try/catch——這裡只保證「回傳的目錄本身當下可寫」，不保證之後每一次操作都成功（磁碟滿、競態等邊界情況）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_BASE = path.join(os.tmpdir(), 'peaklens');
const warnedFor = new Set(); // 同一個偏好目錄只印一次 warning，避免每次呼叫都洗 log

function canWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.wtest-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}

/**
 * @param {string} preferredDir 呼叫端原本想用的目錄（本機／Docker 這裡就會成功，直接回傳原樣）
 * @returns {string} 一個「剛剛驗證過可寫」的目錄：preferredDir 本身，或 os.tmpdir()/peaklens 備援
 */
export function resolveStateDir(preferredDir) {
  if (canWrite(preferredDir)) return preferredDir;
  if (!warnedFor.has(preferredDir)) {
    warnedFor.add(preferredDir);
    console.warn(`[state] "${preferredDir}" 不可寫（唯讀檔案系統，例如 Vercel function 只有 /tmp 能寫）→ 改用 ${TMP_BASE}；這個位置會在 function instance 重啟或換機時清空。FUNRAISE MCP token 請改用 FUNRAISE_MCP_TOKEN_JSON 環境變數（見 docs/12-hosting.md），不要只依賴這裡的檔案長期存在。`);
  }
  canWrite(TMP_BASE); // 盡量先 mkdir 好；万一這裡也失敗，呼叫端自己寫檔那一刻的 try/catch 會再擋一次
  return TMP_BASE;
}
