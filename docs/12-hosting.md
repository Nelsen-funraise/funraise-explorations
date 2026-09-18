# 12 · 5 分鐘把睿鏡放上 Vercel（線上版給大家看）

> GitHub Pages 版（`https://nelsen-funraise.github.io/funraise-explorations/`）是純靜態站，3D 城市、場景、快照資料都能跑，但 AI 模式、語音、FUNRAISE MCP 即時資料都需要 `server/index.mjs` 這支 Node agent server——那些金鑰不能放進靜態網頁（等於公開）。這篇教你把同一份 `app/` 部署到 **Vercel**：前端（`npm run build` 的 `dist/`）與 API（`server/index.mjs`）會在**同一個網域**，金鑰全部只存在 Vercel 的 Environment Variables，不進 git、不進 build 產物。跟 docs/11 §14–15 的差別：§14/§15 講本機 `/setup` 與「隨便一台有 Docker 的主機」；這篇專門講 Vercel 這條路徑的每一步。

全程可以在筆電或手機瀏覽器上操作，不需要裝任何東西、不需要碰終端機。

## 1. 部署步驟

1. 開 **[vercel.com](https://vercel.com)**，用 GitHub 帳號登入（第一次會要你「Install Vercel」到 GitHub 帳號或組織，選擇要開放哪些 repo——至少要包含 `funraise-explorations`；之後隨時可以到 GitHub → Settings → Applications → Vercel 調整）。
2. 儀表板右上角 **Add New… → Project**。
3. **Import Git Repository** 清單裡找到 `Nelsen-funraise/funraise-explorations` → **Import**（沒看到就按清單旁的「Adjust GitHub App Permissions」把這個 repo 加進授權範圍）。
4. **Configure Project** 畫面：
   - **Root Directory**：按「Edit」，選 `app`（這一步最容易漏——沒選對，Vercel 會在 repo 根目錄找 `package.json`，找不到就會建置失敗）。
   - **Framework Preset**：選到 `app` 之後 Vercel 通常會自動判斷不出特定框架，選 **Other**／保持預設即可——`app/vercel.json` 已經把 `framework` 明講成 `null`、`buildCommand`／`outputDirectory` 也都寫死了，這裡不用手動改建置指令。
   - **Environment Variables**：展開這一區，照下面第 2 節的表格貼上你要開的功能。**第一次部署至少建議填 `PEAKLENS_ACCESS_CODE`**（自己想一組口令），不然網址一生成，任何人都能連上你的 AI／語音額度。
5. 按 **Deploy**。第一次建置約 1–2 分鐘（`npm install` + `vite build`）。
6. 完成後會拿到一個網址，長得像 `https://funraise-explorations-xxxx.vercel.app`（或你自訂的專案名）。打開它——這就是完整版睿鏡：地圖、場景、AI 對話、語音、FUNRAISE 即時資料看你填了哪些金鑰。
7. 之後每次 `git push` 到 `main`（`app/**` 有變動）Vercel 會自動重新部署；PR 會拿到獨立的 Preview 網址，方便先看過再合併。

> 小抄：Vercel 專案設定頁隨時可以回去改 Environment Variables（Settings → Environment Variables）；改完金鑰要按右上角 **Redeploy** 才會生效（Vercel 不會自動重跑 build 只因為你改了環境變數）。

## 2. Environment Variables 一覽

在 Vercel 專案的 **Settings → Environment Variables**（或部署當下的 Configure 畫面）逐項貼上。「必填？」欄的意思是「要開對應那一排功能就必填」，不是整體必填——完全不填也能部署，睿鏡會用跟 GitHub Pages 一樣的 keyless 模式跑（3D 城市、場景、本地快照資料，沒有 AI 對話、沒有語音）。

| 變數 | 解鎖什麼 | 去哪裡拿 | 必填？ |
|---|---|---|---|
| `OPENAI_API_KEY` | AI 對話（推薦：預設用它，Responses API + function tools + hosted MCP） | [platform.openai.com](https://platform.openai.com/api-keys) → API keys | 要「+AI」才填；跟 `ANTHROPIC_API_KEY` 二選一 |
| `OPENAI_MODEL` | 指定模型（預設 `gpt-4.1`；填 `gpt-5` 系列會自動用低推理量設定） | 同上帳號的可用模型清單 | 選填 |
| `ANTHROPIC_API_KEY` | AI 對話走 Claude（Messages API + MCP connector）而不是 OpenAI | [console.anthropic.com](https://console.anthropic.com/) → API Keys | 要「+AI」且想用 Claude 才填；兩把都填時預設用 OpenAI，`LLM_PROVIDER=anthropic` 可強制切回 |
| `ANTHROPIC_MODEL` | 指定 Claude 模型（預設 `claude-opus-5`） | 同上 | 選填 |
| `FISH_API_KEY` | 語音（Fish Audio TTS：旁白、AI 回答用聲音唸出來） | [fish.audio](https://fish.audio/) 帳號設定 → API Keys；免費 `s2.1-pro-free` 模型不用信用卡 | 要「+語音」才填 |
| `FISH_MODEL` | 指定 Fish 模型（預設 `s2.1-pro-free`） | 同上 | 選填 |
| `FUNRAISE_MCP_TOKEN_JSON` | FUNRAISE 即時資料（超出本地快照涵蓋範圍的問題、即時查詢） | 見下方「MCP token 怎麼拿」——本機 `/setup` 頁「匯出 MCP token」按鈕，整段 JSON 貼過來 | 要「+MCP 即時」才填；跟 `FUNRAISE_MCP_TOKEN` 二選一 |
| `FUNRAISE_MCP_TOKEN` | 同上，但用固定 bearer token（不會過期輪替，設定最簡單） | 跟方睿內部要一組固定 token（如果有發的話） | 同上，二選一 |
| `PEAKLENS_ACCESS_CODE` | 存取碼：`/api/*` 都要帶這組碼才能用，網址公開分享時的基本防線 | 自己想一組（英數字，例如 `raise2026`） | **強烈建議**（見下方安全性） |
| `PUBLIC_URL` | FUNRAISE MCP OAuth 的 redirect_uri 基準網址 | 不填會自動用 Vercel 的 `VERCEL_PROJECT_PRODUCTION_URL`／`VERCEL_URL` 推出來 | 選填（OAuth 跑起來怪怪的再手動填 `https://<project>.vercel.app`） |
| `ALLOWED_ORIGIN` | CORS 允許的來源網域 | 你的 GitHub Pages 網址，例如 `https://nelsen-funraise.github.io` | 只有「GitHub Pages 前端打這個 Vercel API」的架構才要填（見第 3 節） |
| `VITE_CESIUM_ION_TOKEN` | 相片級 3D（Google Photorealistic 3D Tiles，經 ion 資產）＋ Cesium World Terrain 地形 | [ion.cesium.com](https://ion.cesium.com/) → Access Tokens；免費額度、Community plan 僅限非商業 | 選填，但沒有這把畫面就是白模，是最值得填的一把 |
| `VITE_GOOGLE_MAPS_API_KEY` | 直接走 Google Map Tiles API 的相片級 3D（不經 ion，算你自己 Google Cloud 專案的量） | Google Cloud Console 啟用 Map Tiles API 後建立金鑰 | 選填，通常有 ion token 就夠了 |
| `CWA_API_KEY` | 天氣角標（中央氣象署即時觀測＋預報） | [opendata.cwa.gov.tw](https://opendata.cwa.gov.tw/) 註冊拿授權碼 | 選填（即時圖層） |
| `MOENV_AQI_API_KEY` | 空氣品質 AQI 角標 | [data.moenv.gov.tw](https://data.moenv.gov.tw/) 註冊拿 api_key | 選填（即時圖層） |
| `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` | 捷運真實站間耗時、YouBike／公車資料源 | [tdx.transportdata.tw](https://tdx.transportdata.tw/) 會員中心 → 應用管理 | 選填（即時圖層），YouBike 本身不需要這把 |
| `ORS_API_KEY` | 真實路網步行／開車等時圈（不然退回估算圈） | [openrouteservice.org](https://openrouteservice.org/dev/#/signup) 免費額度 | 選填 |
| `MCP_ALLOWED_TOOLS` | 覆蓋 FUNRAISE MCP 工具白名單（預設 31 個睿鏡用得到的工具，省 token） | 填 `all` 關掉過濾，或自己列逗號分隔的工具名 | 選填，通常不用動 |

**沒列在表上、也不需要填**：`VITE_API_BASE`（同源部署用不到，見第 3 節）、`FUNRAISE_MCP_URL`（已經內建方睿的 connector 網址）、`PORT`（Vercel 自己決定）、`FUNRAISE_MCP_CLIENT_ID`/`_SECRET`（動態註冊，通常不用手動指定）。

### 最小組合速查

| 想要 | 最少要填 |
|---|---|
| 只要地圖＋場景＋本地快照（跟 GitHub Pages 一樣） | 什麼都不用填 |
| + AI 對話 | `OPENAI_API_KEY`（或 `ANTHROPIC_API_KEY`） |
| + 語音 | 上面 + `FISH_API_KEY` |
| + FUNRAISE 即時資料 | 上面 + `FUNRAISE_MCP_TOKEN_JSON`（或 `FUNRAISE_MCP_TOKEN`） |
| 網址要公開分享（任何一層都建議） | 上面 + `PEAKLENS_ACCESS_CODE` |

### MCP token 怎麼拿（`FUNRAISE_MCP_TOKEN_JSON`）

Vercel 的 function 沒有持久硬碟，存不住 `server/.mcp-token.json`；FUNRAISE MCP 走 OAuth 2.1，需要一份 token 檔。做法：

1. 在自己電腦（或 Docker）跑一次 `app`：`npm install && npm run build && npm run server`。
2. 開 `http://localhost:8790`，按右上角「授權」，走完一次 FUNRAISE MCP 登入（一次性，之後不用再做）。
3. 開 `http://localhost:8790/setup`，捲到「**匯出 MCP token（貼到 Vercel 的 FUNRAISE_MCP_TOKEN_JSON）**」區塊，按「顯示」→「複製」。
4. 貼到 Vercel 專案的 Environment Variable `FUNRAISE_MCP_TOKEN_JSON`（整段 JSON，單一個變數）。
5. Redeploy。開機時如果還沒有 token 檔就會用這把種一份出來；打 `/api/health` 看 `mcp.persist`：`env`＝用固定 token、`file`／`tmp`＝有 OAuth token（`tmp` 代表存在暫存空間，見第 4 節「限制」）、`none`＝還沒有。

refresh token 過期輪替後，如果剛好存在 Vercel 的暫存空間（`mcp.persist: 'tmp'`），`/api/health` 的 `mcp.warning` 會提醒你——這時候回本機 `/setup` 重新做一次第 3–4 步、更新 Vercel 上的值即可，不用重新走一次完整 OAuth 登入。

## 3. 讓 GitHub Pages 前端改打 Vercel 的 API

如果你想繼續用 `https://nelsen-funraise.github.io/funraise-explorations/` 這個好記的網址當入口，但 AI／語音／MCP 由 Vercel 的 server 提供，有兩種做法：

**做法 A — 幫所有訪客設定好（repo 層級，一次性）**
1. Vercel 那邊：Environment Variables 加一筆 `ALLOWED_ORIGIN = https://nelsen-funraise.github.io`（限定 CORS 只接受 Pages 網域）。
2. GitHub 這邊：repo **Settings → Secrets and variables → Actions → Variables**，新增 `PEAKLENS_API_BASE = https://<你的專案>.vercel.app`（`.github/workflows/pages.yml` 已經接好：build 時會變成 `VITE_API_BASE`）。
3. 重新跑一次 Pages 的 workflow（Actions 分頁手動 Run，或隨便 push 一個 `app/**` 的小改動）。之後所有訪客打開 Pages 網址，前端會自動打 Vercel 的 API。

**做法 B — 訪客自己貼一次（不用改 repo，適合先試用）**
前端右上角有一個 **🔑 金鑰** 按鈕（`src/ui/keys.js`），裡面「Agent server 網址」欄貼上 `https://<你的專案>.vercel.app`，「存取碼」欄貼上 `PEAKLENS_ACCESS_CODE`（如果有設）——存在對方瀏覽器的 localStorage，不影響其他人。更快的方式是直接分享一個帶參數的連結，對方一開就自動設定好（載入後網址列會自動清乾淨，不留下痕跡）：
```
https://nelsen-funraise.github.io/funraise-explorations/?api=https://<你的專案>.vercel.app&code=<你的存取碼>
```

兩種做法都可以同時存在——做法 B（🔑 對話框或帶參數連結）的值優先於做法 A（build 時內建的 `VITE_API_BASE`），適合「repo 預設打某個環境，但這次想讓特定客戶連到另一個」的情境。

如果前後端乾脆都在 Vercel（不用 Pages），就完全不用管這一節——同源，`API` 留空即可，這也是第 1 節「一路部署」出來的預設狀態。

## 4. 限制

- **Function 逾時**：`app/vercel.json` 設 `maxDuration: 60`（60 秒）。Vercel 現在的官方文件寫 Hobby 方案的 function 逾時預設與上限都是 300 秒（前提是專案有開 Fluid compute，新專案預設就是開的）——這裡故意設保守一點的 60 秒，一般一問一答遠低於這個時間；如果你的帳號方案上限更低、或常常被截斷，把 `app/vercel.json` 裡的 `maxDuration` 調高（同時留意 Vercel 官方文件本身這個數字時常調整，部署前可以重新確認一次 [Function 逾時文件](https://vercel.com/docs/functions/limitations#max-duration)）。
- **冷啟動**：一段時間沒人用，第一個請求會慢個一兩秒（Node function 重新開機、重新載入本地快照）。之後的請求都是溫的，很快。
- **沒有持久硬碟**：除了 `FUNRAISE_MCP_TOKEN_JSON` 已經處理的 MCP token，Fish TTS 的語音檔快取（`server/.tts-cache`）在 Vercel 上也只能存在 `/tmp`——function instance 重啟或換機就會清空（不影響功能，只是快取沒了、下次要重新跟 Fish 要一次語音）。這些都是 `server/statedir.mjs` 自動處理，不會讓 server 掛掉，只是「這台機器上的暫存」本來就不保證活多久。
- **request body／回應大小上限** 4.5 MB（睿鏡目前沒有任何一支 API 會逼近這個量）。

## 5. 另一條路：自己的伺服器（Docker / Cloud Run）

不想用 Vercel、或想要不受 serverless 逾時限制的長對話，`app/Dockerfile` 已經包好前端＋API 在同一個容器——完整步驟、環境變數與 `gcloud run deploy` 範例指令見 **docs/11-v2-cesium-app.md §15**。這條路徑跟 Vercel 唯一的差別是「金鑰放哪裡填」（容器主機的環境變數 vs. Vercel 的 Environment Variables）與「MCP token 有沒有持久硬碟」（Cloud Run／Render 這類「有磁碟」的主機不需要 `FUNRAISE_MCP_TOKEN_JSON`，`server/.mcp-token.json` 直接存著就好，本文件第 4 節的限制只適用於 Vercel 這種完全無狀態的 function）。

## 6. 安全性

- **金鑰只放環境變數**：任何 server 端金鑰（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`FISH_API_KEY`、`FUNRAISE_MCP_TOKEN(_JSON)`、`CWA_API_KEY`、`MOENV_AQI_API_KEY`、`TDX_CLIENT_*`、`ORS_API_KEY`）只填在 Vercel 的 Environment Variables，絕對不要寫進 `VITE_*` 開頭的變數——`VITE_*` 會被打包進前端 JS，任何人打開瀏覽器開發者工具都看得到。`VITE_*` 只留給本來就設計成「前端直接用」的兩把：`VITE_CESIUM_ION_TOKEN`、`VITE_GOOGLE_MAPS_API_KEY`（這兩把本身就是給瀏覽器直接呼叫 Cesium ion／Google 用的，公開是預期行為，頂多注意有沒有在 ion／Google Cloud 後台設網域白名單）。
- **不要把金鑰貼在聊天視窗、Slack、Issue 裡**：如果 `FISH_API_KEY` 之前曾經貼在對話紀錄或聊天訊息裡讓人幫忙設定過，部署前先到 [fish.audio](https://fish.audio/) 帳號後台重新產生一把新的、把舊的作廢——當作已經外流處理，不要繼續沿用。其他金鑰（OpenAI、Anthropic、FUNRAISE MCP token）如果有類似情況，一律比照辦理。
- **公開網址一定要開 `PEAKLENS_ACCESS_CODE`**：沒有存取碼的話，任何人拿到網址就能無限次用你的 AI／語音額度（會直接燒 OpenAI／Fish 帳單）。存取碼不是帳號密碼系統，只是「一組大家都知道的口令」，夠擋隨機路過的人跟爬蟲，跟同事／客戶分享時口頭或訊息告知即可。
- **`ALLOWED_ORIGIN`**：只有在「Vercel 只服務 API、真正的前端在別的網域（例如 GitHub Pages）」時才需要設，把 CORS 鎖到只接受那個網域，減少 API 被其他網站盜連的機會。前後端同在 Vercel（第 1 節的預設路徑）不用設。
- **`FUNRAISE_MCP_TOKEN_JSON` 本身就是一把可以直接查資料的憑證**：跟其他金鑰一樣，只放在 Vercel 的 Environment Variables（Vercel 預設會遮蔽 UI 上已存的值），不要貼進 commit、Issue 或截圖分享。
