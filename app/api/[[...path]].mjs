// Vercel Node.js function adapter — 把整個 PeakLens agent server（server/index.mjs 的 `export const handler`，
// 就是本機 `node server/index.mjs` 時餵給 http.createServer 的同一支 (req,res) callback）掛到 /api/*。
//
// 檔名 [[...path]] 是 Vercel 的「optional catch-all」檔案系統路由慣例：/api、/api/health、/api/agent、
// /api/mcp/callback……不管幾層都會落到這一支函式，而且函式收到的 req.url／request.url 是瀏覽器原本打的那個
// 真實路徑（不是被改寫成 /api/[[...path]] 這個檔名本身）——這正是 handler 需要的：它完全靠自己
// `new URL(req.url, 'http://x')` 解析 pathname 來決定路由，見 server/index.mjs 開頭的路由表。这也是
// Express／Hono／tRPC 這類「整包路由器掛一支 Vercel function」的專案在 Vercel 上一貫的部署方式。
//
// 不需要（也不應該）在這裡呼叫 handler.listen()——Vercel 的 runtime 才是真正在聽對外 port 的那一層，
// 這支檔案只是把 (req,res) 轉交給它。server/index.mjs 自己用 `IS_MAIN` 判斷「是不是被直接執行」，透過
// import 進來這裡的話那個判斷本來就是 false，不會誤觸發 .listen()（PEAKLENS_NO_LISTEN 環境變數是給
// server/handler.test.mjs 這類「用 node 直接執行、但還是想拿 handler 自己接 port」的測試用的，這裡不需要設）。
import { handler } from '../server/index.mjs';

export default handler;

// ---- 串流（SSE）備忘 ----
// /api/agent?stream=1 靠 res.write() 逐段送出 text/event-stream；截至目前查到的 Vercel 文件，Node.js
// runtime 的 (req,res) 函式已經預設支援串流回應（不需要額外設定，舊版需要的 VERCEL_FORCE_NODEJS_STREAMING
// 環境變數已經不需要了），vercel.json 的 functions 設定裡目前也已經找不到 supportsResponseStreaming 這個
// 欄位——這裡不用加任何東西。如果之後部署發現 SSE 又變成整包一次送出才到前端，可以往這兩個方向查：
//   1. 專案的 Fluid compute 開關／方案是否影響串流（見 vercel.com/docs/functions/streaming-functions）；
//   2. 是不是中間多了一層真的會 buffer 的 CDN/rewrite（這支檔案本身沒有做任何 buffering）。
