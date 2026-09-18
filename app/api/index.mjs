// Vercel Node.js function adapter — 把整個 PeakLens agent server（server/index.mjs 的 `export const handler`，
// 就是本機 `node server/index.mjs` 時餵給 http.createServer 的同一支 (req,res) callback）掛到 /api/*。
//
// 路由方式：vercel.json 的 rewrites 把 /api/(.*) 全部導到這支 api/index.mjs（Vercel 官方「Express on Vercel」指南就是
// 同一招：一支 api/index 函式 + rewrite，函式收到的 req.url 仍是瀏覽器原本打的真實路徑 /api/health、/api/agent、
// /api/mcp/callback……，不是被改寫成檔名）——這正是 handler 需要的：它完全靠自己 `new URL(req.url, 'http://x')`
// 解析 pathname 來決定路由，見 server/index.mjs 的路由表。不用括號式 catch-all 檔名（[...path]）是因為那個慣例
// 在非 Next.js 專案上的支援文件不明確，rewrite 則是明文支援、也是最常見的整包路由器部署法。
//
import { handler } from '../server/index.mjs';

export default handler;

// ---- 串流（SSE）備忘 ----
// /api/agent?stream=1 靠 res.write() 逐段送出 text/event-stream；截至目前查到的 Vercel 文件，Node.js
// runtime 的 (req,res) 函式已經預設支援串流回應（不需要額外設定，舊版需要的 VERCEL_FORCE_NODEJS_STREAMING
// 環境變數已經不需要了），vercel.json 的 functions 設定裡目前也已經找不到 supportsResponseStreaming 這個
// 欄位——這裡不用加任何東西。如果之後部署發現 SSE 又變成整包一次送出才到前端，可以往這兩個方向查：
//   1. 專案的 Fluid compute 開關／方案是否影響串流（見 vercel.com/docs/functions/streaming-functions）；
//   2. 是不是中間多了一層真的會 buffer 的 CDN/rewrite（這支檔案本身沒有做任何 buffering）。
