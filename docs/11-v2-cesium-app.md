# 11 · 睿鏡 PeakLens v2（CesiumJS 真實 3D 版）— 架構、資料、Demo 腳本

> v1（`prototype/`）是純 Canvas 的 2.5D 模擬，用來講概念。v2（`app/`）把 God's Eye View 的核心體驗——**真實 3D 城市、可對話的相機、圖層即資料、電影式巡航**——搬到 CesiumJS 上，疊上 FUNRAISE MCP 的真實資料快照。這一版的目標是「不需要任何 API key 就能開起來、五分鐘讓 Mike 看懂為什麼這是下一代產品」。

## 0. 一眼看懂

| | v1 原型（prototype/） | **v2 睿鏡（app/）** |
|---|---|---|
| 地圖引擎 | 自寫 Canvas 2.5D | **CesiumJS 1.124**（與 God's Eye View 相同底座） |
| 城市 | 行政區／捷運向量 | **57,458 棟 OpenStreetMap 建物擠出 3D**（含 154 棟 ≥60 m 地標，台北101 = 508 m）＋ 國土測繪中心正射影像 |
| FUNRAISE 圖層 | 點與多邊形 | 11 個圖層：商辦以真實 OSM 足跡擠出、都更為真實多邊形、企業遷徙為原址→新址弧線、規劃中建案隨時間軸「長高」 |
| 相機 | 平移／縮放／假俯仰 | flyTo／**環繞**／**街景**／俯視／全台，皆為真 3D 相機 |
| 感測 | CSS filter | GLSL PostProcessStage：夜視／熱感／藍圖 |
| Agent | 規則式 + 模擬 MCP 卡片 | 規則式（離線可用）＋ **Claude 模式**（server 端官方 SDK + 11 個相機工具 + FUNRAISE MCP connector） |
| 場景 | 導覽 | 5 段有旁白的電影式場景 + 全部連播 |
| 部署 | claude.ai Artifact | GitHub Pages（`.github/workflows/pages.yml`）／本機 `npm run dev` |

## 1. 怎麼跑

```bash
cd app
npm ci
npm run dev            # http://localhost:5173  （keyless：NLSC 正射影像 + OSM 3D 建物）
# 選配：Claude 模式（需 ANTHROPIC_API_KEY；FUNRAISE MCP 需 URL + token）
cp .env.example .env && $EDITOR .env
npm run server         # http://localhost:8787  （/api/health, /api/agent；Vite dev 會把 /api 代理過去）
# 正式打包 + 單一 server 同時提供靜態檔與 API
npm run build && npm run server
npm run check          # 只印出 server 設定（有沒有 key、模型、工具清單）
npm run smoke          # 無頭 Chromium 冒煙測試 + 截圖（需 Playwright）
```

`.env` 全部選配：

| 變數 | 作用 |
|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | 開啟 **Google Photorealistic 3D Tiles**（GEV 的相片級城市；計量收費）。有 key 時自動略過 OSM 建物 |
| `VITE_CESIUM_ION_TOKEN` | Cesium World Terrain 地形（ion Community 僅限非商業） |
| `VITE_API_BASE` | agent server 不同源時的位址（例如 Pages 前端 + Cloud Run 後端） |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Claude 模式；預設模型 `claude-opus-5`，adaptive thinking |
| `FUNRAISE_MCP_URL` / `FUNRAISE_MCP_TOKEN` | 把「Funraise Data Team」MCP 接進 Claude 的 MCP connector（`mcp_servers` + `mcp_toolset`），讓 agent 即時查真實資料而不是快照 |

GitHub Pages：repo Settings → Pages → Source 選 **GitHub Actions**，之後 `main` 上 `app/**` 有變動就自動部署到 `https://nelsen-funraise.github.io/funraise-explorations/`。

## 2. 架構（app/src）

```
main.js            boot：Viewer → 資料 → OSM 3D → FUNRAISE 圖層 → 相機/感測/時間軸 → agent → HUD → 拾取
viewer.js          Cesium Viewer（無預設 widget）、4 種 keyless 底圖（NLSC 正射/電子地圖、Esri、OSM）、夜間色調、選配 Google 3D Tiles / ion 地形
layers/osmBuildings.js   OSM 足跡 → 量化 JSON → 批次 Primitive 擠出（依高度上色）；centroid 網格供 FUNRAISE 商辦對位
layers/funraise.js       11 個 CustomDataSource：stock / future / licenses / renewal / zones / mops / moves / infra / parks / heat / mrt
camera.js          CameraRig：flyTo(range,pitch,heading)、city、street、globe、startOrbit（clock tick 上 lookAt）、bounds()
sensors.js         PostProcessStage GLSL：night / thermal / blueprint
time.js            Timeline 2012→2030：圖層透過 CallbackProperty 讀年份（商辦依使照年出現、規劃案依完工年長高、建照/交易依年份亮起）
agent/agent.js     規則式 agent：意圖 → 模擬 MCP 呼叫卡片（工具名與參數對齊真實 MCP）→ 相機/圖層動作 → 回答
agent/claudeClient.js    Claude 模式：把對話 + 畫面狀態送到 /api/agent，執行回傳的 tool_use（fly_to、set_layers、highlight…）
scenes.js          SceneDirector：5 段有旁白的場景腳本（文字 + 語音 + 相機 + 圖層 + 時間軸）
ui.js              HUD：鏡（lens）、圖層、相機模式、感測、底圖、時間軸、檢視面板、對話紀錄、語音輸入/輸出、場景選單、快捷鍵
server/index.mjs   Node http：GET /api/health、POST /api/agent（@anthropic-ai/sdk，client.beta.messages.create，adaptive thinking，MCP connector 選配），並可直接服務 dist/
```

**「圖層即資料」的對位**（GEV 的 infrastructure package 精神）：每個地圖物件都帶 `properties.pl = { layer, key, item }`，key 與 agent／Claude 工具共用（`stock:<id>`、`renewal:<id>`、`mops:<id>`、`license:<建照號>`、`move:<統編>`…），所以「講一句話 → 找到物件 → 相機飛過去 → 面板展開 → 發光」是一條線。

## 3. 資料與授權

| 來源 | 內容 | 授權／備註 |
|---|---|---|
| FUNRAISE MCP（Funraise Data Team）快照 2026-09-14 | 商辦 156 棟（等級、樓層、使照、認證、捷運距離、實價租金/買賣均價、照片）、規劃中建案 13、臺北市建照 98、都更單元 81（真實多邊形）、重劃/區段徵收 73、上市櫃資產交易 33、企業跨區遷徙 82、公共建設 25、產業園區 7、商圈行情 7、各區實價統計 | 公司內部資料 + 政府開放資料經 FUNRAISE 清洗；建照起造人已遮罩；`geo_precision` 標示定位精度（exact / address / area_centroid） |
| OpenStreetMap | 57,458 棟建物足跡與高度（`height` 或 `building:levels`×3.2+1，無標籤依用途預設） | ODbL 1.0，需保留「© OpenStreetMap contributors」 |
| 國土測繪中心 NLSC WMTS | 正射影像 PHOTO2、通用版電子地圖 EMAP | 政府資料開放授權條款；畫面右下保留出處 |
| g0v twTown1982 | 行政區界（雙北） | CC BY 4.0 |
| Esri World Imagery / OSM tiles | 備用底圖 | 各自 ToS；正式版建議只用 NLSC + Google |
| God's Eye View | 借鏡其「圖層註冊表、相機動詞、感測著色、語音 agent 工具清單」等模式；**未複製其程式碼**；其海纜資料 CC BY-NC-SA 不可商用 | MIT（程式）|

## 4. 給 Mike 的 Demo 腳本（8 分鐘）

> 建議設備：Chrome，1920×1080 以上，開聲音（旁白用系統 zh-TW 語音）。開場前先開好 `npm run dev`，讓 OSM 建物載完（約 5 秒）。

**0:00 開場（自動）** 地球 → 4.5 秒俯衝進信義計畫區。畫面上 5.7 萬棟真實建物、金色是 A 辦、青色是規劃中、紫色是都更多邊形。
> 一句話：「這是 God's Eye View 的底座，但每一個亮起的東西都是 FUNRAISE MCP 的一筆真實資料。」

**0:30 場景 ① 投資人巡航**（按「▶ 場景」→ 資本流向）
上市櫃交易點 → 台北101 環繞 → 南港。旁白會自己講。
> 重點：「GEV 是通用地圖，我們有的是『誰在哪買了什麼』——這是台灣沒有人整合過的即時資本流向。」

**1:45 對城市說話**（輸入或按麥克風）
- 「最近一年信義區上市公司買了什麼」→ 三筆公告亮起 + 右側長條圖 + 來源標註（公開資訊觀測站）。
- 「比較信義基隆商圈和民生敦北商圈的租金」→ 兩商圈熱區 + 長條圖。

**2:45 場景 ② 供給雷達（開發商）**
建照脈衝 → 都更多邊形（臺北機廠、華山、南港高鐵站區）→ **時間軸 2026→2030 幽靈建物長高**（南港之星、HCBD、南山 A21/A26）。
> 重點：「GEV 只有『現在』；我們的護城河是『過去』（2012 起實價）和『未來』（建照、都更、規劃案）。」

**4:15 開發商問答**
- 「2028 年南港會長出什麼」→ 時間軸跳到 2028，規劃案與建照亮起，列出案名／開發商／樓層。
- 點任一棟大樓 → 「這裡容積率多少」→ 使用分區與容積（land-info 工具）。

**5:00 企業選址（PickPeak 核心客群）**
切「企業選址鏡」→「帶我去內湖科技園區」→「台北101的租戶是誰」→ 點面板「街景」→「街景模式看南港軟體園區」→「幫我做這棟的 DD memo」。
> 重點：「同一張地圖換一個鏡，圖層、KPI、建議問題全換——這就是 Agent Native：產品不是功能選單，是對話。」

**6:30 城市治理鏡**
「哪些公司最近遷入中山區」→ 82 條原址→新址弧線飛進來。「興建中的公共建設有哪些」→ 環狀線東環、信義東延、汐東線虛線亮起。
> 重點：「首長戰情室／局處版本，只要換鏡和權限。」

**7:15 感測與底圖**
鍵盤 `2` 夜視、`3` 熱感、`4` 藍圖、`1` 還原；`N` 日／夜；`B` 換底圖（正射 → 電子地圖 → 衛星 → OSM）。`G` 拉到全台收尾。

**7:45 收尾**
「按一下『內建』會切成 Claude 模式：同樣的話，改由 Claude Opus 5 透過 MCP 即時查我們的資料庫、再操作這張地圖。今天示範的是快照版，資料一筆都沒有假的。」

### 快捷鍵
`/` 指令列 · `O` 環繞 · `S` 街景 · `C` 俯視 · `G` 全台 · `T` 時光 · `L` 換鏡 · `1`–`4` 感測 · `N` 日夜 · `B` 底圖 · `P` 場景選單 · `Esc` 停止場景／取消選取 · 左鍵點選物件、雙擊飛過去 · 中鍵／Ctrl+左鍵 旋轉俯仰

## 5. Claude 模式（server）怎麼運作

1. 前端把最近 12 則對話 + `view`（相機中心、行政區、年份、鏡、可見圖層、選取物件、視野內數量）POST 到 `/api/agent`。
2. server 以官方 `@anthropic-ai/sdk` 呼叫 `client.beta.messages.create`（`claude-opus-5`、adaptive thinking），工具 = 11 個相機/圖層工具（`fly_to`、`set_camera_mode`、`set_lens`、`set_layers`、`set_year`、`set_sensor`、`highlight`、`get_view_state`、`search_local_snapshot`、`show_chart`、`select_entity`）+（有 token 時）`mcp_toolset: funraise`。
3. MCP 工具由 Anthropic 端直接呼叫 FUNRAISE MCP（回傳 `mcp_tool_use`/`mcp_tool_result` 區塊，前端顯示為卡片）；相機工具由瀏覽器執行後把結果回傳，最多 6 回合。
4. 系統提示要求「先動畫面再說話、3 句內、結尾標來源與資料期間、沒有資料就明說」。

## 6. 已知限制與下一步

- **定位精度**：規劃中建案與部分上市櫃交易只有區域中心座標（`geo_precision: area_centroid`），面板會標示；正式版接地籤／地號即可精確。
- **OSM 高度**：約 6 成建物沒有高度標籤，依用途預設（住宅 21 m、辦公 30 m…）；有 `VITE_GOOGLE_MAPS_API_KEY` 時可切成相片級 3D Tiles。
- **語音**：目前用瀏覽器 Web Speech（zh-TW 辨識 + 合成）；GEV 的即時語音（OpenAI Realtime）可換成 Anthropic 語音管線或串流 TTS，見 `docs/06-architecture.md`。
- **資料是快照**：Claude 模式接上 FUNRAISE MCP 後即為即時；快照仍保留作為離線／展示備援。
- **下一步**（對應 `docs/07-roadmap.md` Phase 1）：接待中心天眼牆版（大螢幕 + 語音 + 自動場景循環）、Deal/Move Radar 每日推播、選址提案一鍵匯出 PickPeak Solutions。

## 7. 截圖（無頭 Chromium 冒煙測試自動產生）

| | |
|---|---|
| ![overview](assets/v2-overview.jpg) 開場：信義計畫區俯視 | ![renewal](assets/v2-renewal.jpg) 「信義區有哪些都更單元」：多邊形亮起 + 各區件數長條圖 |
| ![future](assets/v2-future-2028.jpg) 「2028 年南港會長出什麼」：時間軸跳到 2028 | ![street](assets/v2-street.jpg) 街景模式：南港軟體園區（OSM 樓高） |
| ![thermal](assets/v2-thermal.jpg) 熱感測（GLSL PostProcessStage） | |
