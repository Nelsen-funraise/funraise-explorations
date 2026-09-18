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
npm run server         # http://localhost:8790  （/api/health, /api/agent；Vite dev 會把 /api 代理過去）
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

**0:00 開場（自動）** 地球 → 4.5 秒俯衝進信義計畫區。先按 `D` 切到「沉浸」給第一印象，要看數字再切「標註」。畫面上 5.7 萬棟真實建物、金色是 A 辦、青色是規劃中、紫色是都更多邊形。
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

## 8. 方向 C · 自適應 HUD（PickPeak Design System）

介面 chrome 只用 PickPeak 品牌 token（藍本藍 `#16A4C0` 為選取／啟用／AI；人文橘 `#FCBE83` 為金額、熱度、人為活動；建構灰 `#1E2939` 80% 為夜間面板；思源黑體 + Inter；The Glow 只給 AI 指令膠囊與「決策之心」）。圖層資料色是獨立類別盤，刻意避開選址藍，讓「被選到的東西」永遠一眼可辨（待 DS owner 確認）。

**三種密度，同一套元件**（右上角切換，快捷鍵 `D`，也可以說「沉浸」「標註模式」）：

| 密度 | 畫面 | 適合 |
|---|---|---|
| 沉浸 | 只留品牌、鏡、指令膠囊、讀數；左右面板收成 28 px 邊緣把手（滑過暫時展開、點一下釘住）；回答變成地圖上方的字幕 + 來源晶片 | 接待中心天眼牆、語音導覽、電影式場景（場景播放時自動切換） |
| 平衡（預設） | 左側資料面板 + 收合的圖層欄；**相機一動，面板 3.5 秒內自動淡出**，停下來再浮回 | 日常瀏覽、Mike 的 demo |
| 標註 | 資料欄全開；**agent 讓物件亮起時自動加編號 ①–⑧**，對應左側「地圖標註」清單（點清單飛過去）；工具呼叫完整展開 + 「來源與工具呼叫」區塊 | 桌機分析、簡報截圖 |

**釘在地圖上**：任何選取物件的面板都有「📌 釘在地圖上」，卡片變成帶引線的地圖標註，跟著物件移動、被地球遮住時自動隱藏；再按一次取消。標註與釘選都是 HTML overlay（`SceneTransforms.worldToWindowCoordinates` 每幀定位），不進 Cesium 場景，所以可以直接沿用 DS 元件。

**來源晶片（Provenance）**：每個回答下方顯示「N 次 MCP 呼叫 · ms · 快照日期／FUNRAISE MCP 即時」，點開看每個工具的參數與耗時。

## 9. FUNRAISE MCP 即時連線與 OAuth（產品邏輯）

`server/index.mjs` 對 `FUNRAISE_MCP_URL`（預設 `https://connector.mcp.funraise.ai/t/…/mcp`）做標準 MCP OAuth 2.1：`/.well-known/oauth-protected-resource` → 授權伺服器 metadata → 動態註冊 client（`token_endpoint_auth_method: none`）→ PKCE S256 → `/api/mcp/callback` 換 token（含 refresh）→ 存在 `server/.mcp-token.json`（已 gitignore）。

規則：**MCP 連不上或未授權時，產品不會壞**——右上角狀態膠囊顯示「FUNRAISE MCP · 點此授權」並在開場 toast 提醒；agent 先用 2026-09-14 快照回答並在來源晶片標「快照」。授權完成（彈出視窗自動關閉）後狀態變 LIVE，並自動切到 Claude 模式，之後的問題即時查 FUNRAISE MCP。

| 狀態 | 膠囊 | 行為 |
|---|---|---|
| `live` | 綠點 · LIVE | Claude 模式帶 `mcp_servers`（access token），回答標「FUNRAISE MCP 即時」 |
| `unauthorized` | 橘點閃爍 · 點此授權 | 點擊開 `/api/mcp/authorize` 彈窗；回答先用快照 |
| `unreachable` / `error` | 灰點 · 連不上 · 快照 | 點擊重新探測；回答用快照 |
| `noserver` | 灰點 · 快照（本地） | 未啟動 agent server：內建規則式 agent + 快照 |

`.env` 可選 `FUNRAISE_MCP_TOKEN`（靜態 token 跳過 OAuth）、`FUNRAISE_MCP_CLIENT_ID/SECRET`（預先註冊的 client）、`PUBLIC_URL`（server 對外網址，OAuth redirect 用）。`npm run check` 會探測一次並印出狀態。

## 10. 語音、主題、相機、動態（2026-09-14 下午更新）

**Fish Audio 語音**：右下 🔈 可選「關閉／系統語音／Nelsen／Eunice／台灣腔女生」。Nelsen 與 Eunice 是帳號內的聲音模型，台灣腔女生是 Fish Audio 公開模型（`3cb8677a…`）。免費模型 `s2.1-pro-free` 不需 API credit。五段場景的旁白已預錄成 `public/audio/<voice>/<hash>.mp3`（`npm run tts:prerender`），所以 GitHub Pages 靜態版也有真人聲；即時回答走 `/api/tts`（server 端持 key、磁碟快取）。**場景步驟現在會等旁白播完才換下一句**（`SceneDirector` 以音檔結束事件為準），不再被打斷。

**主題**：右上 ☀︎／☾（快捷鍵 `N`）切換「PickPeak 日間」（白底卡片、Esri 淺灰底圖、淺色 OSM 建物、深色標籤）與「夜間戰情室」（原本的深色）。預設日間。

**相機**：左鍵平移、**右鍵（或中鍵／Ctrl+左鍵）拖曳旋轉方位與俯仰**、滾輪縮放；右下方向盤可拖曳轉向、點 N 回正北，滑桿調俯角，`2D` 正俯視；鍵盤 ←→ 旋轉、↑↓ 俯仰、+/− 縮放、Home 回北。

**PickPeak 風格呈現**：遠看時商辦聚合成「N 棟」藍色圓圈（同 pickpeak.ai 地圖），點一下拉近；中距離顯示大樓圖示；近看只剩 3D 量體。點圖層（建照／交易／公建／園區／商圈／捷運）都有專屬 icon。

**趨勢動態**：時間軸每跨一年，新取得使照的大樓會「長出來」（金色量體 1.1 秒），當年上市櫃交易與完工案自動脈衝，畫面上方跳出年份與當年增量（+N 棟 · 建照 · 交易），左側面板顯示累計供給趨勢線與當年標記；KPI 數字以 0.7 秒 count-up 呈現。

**日照與陰影（2026-09-16）**：右上「☀ 日照」可選清晨／上午／正午／黃金時刻／暮色或拉時刻滑桿；開啟後場景改用該時刻的真實太陽位置（台北當地時間），57k 棟 OSM 量體與都更模擬量體全部投影（`viewer.shadows` + `Primitive.shadows`，shadow map 2048、7 km 內）。「▶ 播放一天」讓陰影從 06:30 掃到 18:15；對城市說「黃金時刻」「17:00 的日照」「播放一天的陰影」也行。Claude 工具 `set_sun`。

**Hover 卡**：滑過任何物件（商辦、交易、建照、都更、地號、聚合泡泡）會跟著游標出現一張小卡：層別、名稱、一行關鍵數字（等級／樓層／租金／金額／面積），點選才展開完整資料卡。

**分享視角**：右上「⤴ 分享」把相機、鏡、年份、主題、密度、圖層、日照時刻編進網址 `#v=…` 並複製；貼給同事打開就是同一個畫面，`#scene=investor` 還能直接播場景。網址列會隨操作即時同步（不寫入歷史）。Claude 工具 `share_view`。

**底圖、疊圖與畫質（2026-09-16）**：底圖新增 CARTO Positron／Dark Matter 與 Esri Dark Gray（皆免金鑰；CARTO 建議之後申請免費 key 防日後收緊），移除 OpenStreetMap 原始圖磚（其使用政策禁止應用程式流量，實測回 `x-blocked`）。時間軸拉到 2014–2025 時，國土測繪中心正射影像自動換成**該年度航照**（`PHOTO2014`–`PHOTO2025`），做時空對比。右欄「疊圖」可疊國土測繪中心 WMTS：段籍界（地段）、分棟建物框、公有土地、土壤液化潛勢、道路路網（都免金鑰，街廓尺度才顯示的會提示）。「畫質」可開環境光遮蔽（日間預設開，白色量體更有立體感）、泛光（夜間預設開）、HDR。河川改用有波紋的水面材質（依河名給 35–380 m 寬的帶狀水體），夜間主題的道路以暖色光帶呈現。右欄底部列出所有圖資出處。

**對焦／X-ray**：資料卡上的「🔦 對焦」（或說「對焦台北101」）讓其餘 5.7 萬棟量體退成低對比、320 m 外的標註淡出，只留這棟、兩圈地面光環、屋頂輪廓光邊與周邊脈絡（捷運站保留）；主題切換時自動重算退色。「取消對焦」恢復。Claude 工具 `focus`。

**企業遷徙動線**：說「播放企業遷徙動線」（或問某區的企業遷入）時，82 筆公司登記地址異動化成 deck.gl 風格的弧線：橘色光點沿弧線飛行、拖尾、落地漣漪、公司名浮出再淡去；時間軸年份對到異動年份也會自動觸發。原址不明的以估算方向示意並在回答中註明。Claude 工具 `play_trips`。

**捷運等時圈**：資料卡「🚇 捷運 20 分圈」或說「從南港軟體園區搭捷運 20 分鐘能到哪」——用內建的捷運路網（把 6 條線的 OSM 線段合成可路由的圖、站點以圖 Voronoi 找相鄰站、真實沿線距離）跑 Dijkstra：走到站 80 m/分、每站停靠 0.7 分、轉乘 +4 分；畫出 8 分鐘步行圈、可達站（10／20／30 分三色）、實際走過的路線與擴散波前。不用任何外部 API。Claude 工具 `show_isochrone`。

**開場定軌鏡頭**：首次載入從外太空三段緩動降到信義計畫區 3/4 視角，配品牌標題卡，任意鍵略過；有分享連結時直接還原視角不播開場。

**展示模式**：右上「🖥 展示」或按 `P`：隱藏編輯用 HUD、字幕放大成下三分之一、右下顯示「場景 n／5」、游標閒置 2.5 秒自動隱藏；←→ 切換場景、空白鍵播放／停止、Esc 離開。Claude 工具 `presenter`。

**樓層視角**：商辦資料卡「👁 站上 12 樓看出去」或說「站上台北101的 20 樓看出去」——相機走進足跡邊緣朝最近捷運站的方向，第一人稱：拖曳看四周、滾輪換樓層、W/S 前進、A/D 轉向、右側樓層滑桿與方位帶（顯示面對的捷運站與行政區）。Claude 工具 `floor_view`。

**量測與畫基地**：右欄「工具」：📏 量距離（分段長度與合計）、⬠ 量面積（m²／坪／周長）、🏗 畫基地→模擬（手繪一塊基地，完成即跑容積量體試算並長出量體）；點擊加點、雙擊或 Enter 完成、右鍵退一步、Esc 取消。全部自建（Cesium 的量測元件是付費 ion SDK）。Claude 工具 `start_tool`。

**夜景窗燈（程序化立面）**：夜間主題預設開，「畫質」可關。5.7 萬棟量體的立面用著色器長出 3.3 m 樓層 × 3.6 m 開間的窗格，約四成暖色燈光、街面假 AO、屋頂維持素面；樓高與足跡尺寸以每棟的 batch-table 屬性傳入，與調色盤無關，所以對焦退色、主題切換都不受影響。

**步行／騎車／開車生活圈（OpenRouteService）**：資料卡「🚶 步行 15 分圈」或說「這裡走路 15 分鐘能到哪」「騎車 10 分鐘範圍」——server 帶 `ORS_API_KEY` 呼叫 OpenRouteService 真實路網等時圈（含 MultiPolygon 與洞），三段帶狀著色、面積 km²；server 沒金鑰或掛掉時自動退回固定速度（步行 80、騎車 250、開車 500 m/分）的估算圈並標示「估算」。Claude／OpenAI 工具 `show_walkshed`。

**即時資料（需 server 與金鑰）**：右上角多一顆「☁ 28° · AQI 42 良好」角標——中央氣象署現在天氣與 36 小時預報、環境部最近測站 AQI，每 10 分鐘更新，下雨或 AQI ≥ 100 時大氣會略微變灰；圖層欄多「YouBike 即時」（點大小＝可借車數，藍 ≥5、橘 1–4、灰 0，1.2 km 內看可借／可還）；若 server 有交通部 TDX 金鑰，捷運等時圈的站間時間會換成 TDX 的真實行車＋停靠秒數（主控台會印出配對到幾條邊）。對城市說「現在天氣」「空氣品質」「顯示 YouBike」也行。工具 `get_environment`、`set_live_layer`。

## 11. 智慧都更模擬（first cut）與地號資料

**做了什麼**：用 FUNRAISE MCP 的 `land-info` 工具，對 6 個政府主導都更單元（信義 兒福B1-2及B3-2、逸仙二小段、兒福B1-1；大安 忠孝懷生、敦南安和；中山 長安市民）在單元多邊形內做格點取樣 → `find_taipei_land_at_point` 反查地號與地籤 polygon → `taipei_zoning_at_point` 帶回使用分區與法定容積率／建蔽率 → `taipei_bldg_overlay_at_point` 帶回建照套繪（民國年 → 屋齡）。共 17 筆地號、7 張建照，存於 `app/data/raw/parcels.json`，併入快照。

**怎麼玩**：切到開發商鏡 → 說「模擬兒福B1-2及B3-2都更」或點都更多邊形 → 面板「🏗 模擬都更量體」。地圖上長出半透明藍色量體（高度 = 估算樓層 × 3.6 m），面板顯示基地面積（坪）、地號數、分區與容積率／建蔽率、基準容積、獎勵容積、總樓地板（含免計 15%）、樓層、現況最舊建照與屋齡、整合難度（地號密度 proxy）；**拉動容積獎勵滑桿（0–50%）量體即時長高**。Claude 模式有 `simulate_renewal` 工具。

**誠實標註的限制**：6 個單元中 4 個落在特定區（住4-1、商三特、敦化專用區B、住3-1(特)），法定容積不是單一數字，工具回傳 `far_decimal: null` 並附條件說明；模擬器改用住三 225% 作假設並在面板標「（假設）」。兒福B1-2及B3-2 有兩個不相連街廓，這次只取樣了 B1-2。產權人數（整合難度的真正關鍵）需要土地謄本（`transcripts` 工具，付費爬取），這輪沒動。

**MCP 裡還有什麼厲害的（值得下一輪接進來）**：
- `land-info.taipei_bldg_overlay_at_point` / `taipei_bldg_overlay_by_permit`：29 萬筆建照套繪，民國 57 年起 —— 屋齡與危老資格（30 年以上）的全市掃描來源。
- `land-info.taipei_zoning_regulation_get`：240 列分區管制對照表（容積、建蔽、高度、特定區條款）—— 全市容積潛力地圖的基礎。
- `urban-renewal.urban_renewal_at_point` / `aggregate_urban_renewal`：任一點落在哪些更新地區／單元、各區件數與面積。
- `transcripts.*`（土地／建物謄本、地籤圖、地址→地號）：所有權人數、抵押、面積 —— 都更整合難度的真資料（付費、需授權）。
- `dd-memo.find_property_lifecycle`：預售 → 成交 → 建照／使照的時序事件，一棟樓的生命週期。
- `key-enterprise` / `company-registry.aggregate_registry_changes` / `capital_increases`：企業遷徙、增資 —— 需求端訊號。
- `actual-price-presale` / `properties` / `rtube`：預售案、物件掛牌 —— 供給端與價格訊號。
- `newtaipei-cadastral.*`：新北地籤，把模擬擴到雙北。

## 12. 想要「真正有貼圖紋理」的 3D 城市，要補什麼

| 方案 | 要補的東西 | 成本／限制 | 建議 |
|---|---|---|---|
| **Google Photorealistic 3D Tiles**（GEV 用的） | Google Maps Platform 專案啟用 Map Tiles API，把 key 放 `VITE_GOOGLE_MAPS_API_KEY`（Pages 用 repo secret）。程式已支援：有 key 自動載入、略過 OSM 量體 | 計量收費（每千次 root tile 請求計價，每月有免費額度；demo 等級幾乎免費）；必須保留 Google 標示；不能把其他底圖蓋在上面 | **最快看到效果**，一把 key 就能 demo；FUNRAISE 圖層需改成「貼在 3D Tiles 上」的分類多邊形 + 浮空標籤（下一步我可以做） |
| 臺北市 3D 建物模型（市府開放資料 LOD1/LOD2） | 下載模型 → 轉 3D Tiles（Cesium ion 上傳或 `3d-tiles-tools`）→ 自架或 ion 託管 | 只有幾何 + 簡單貼圖，非相片級；授權需確認可商用 | 中期自有資產：不受 Google 條款限制 |
| 國土測繪中心 3D 建物（全臺 LOD1） | 同上流程 | 無貼圖，高度來自建物模型；適合全國尺度 | 搭配 OSM 補台北以外縣市 |
| 自拍攝影測量（接待中心案場、重點街廓） | 無人機拍攝 → RealityCapture/Metashape → Cesium ion → 3D Tiles | 每案數萬～數十萬；最真實 | 建商天眼牆的獨賣素材 |
| 加地形 | `VITE_CESIUM_ION_TOKEN`（Cesium World Terrain，ion Community 僅非商業） | 商用需 ion 付費方案 | 台北盆地平坦，優先度低 |

## 13. 免費資料源盤點與申請清單（Phase 7 研究，2026-09-16 實測）

以下每個端點都在本次 session 用 `curl` 實際打過（含 tile magic bytes）；標 UNVERIFIED 者是沙盒網路擋住，非資料源失效。

### 13.1 不用申請、已接或可直接接

| 來源 | 內容 | 狀態 | PeakLens 用法 |
|---|---|---|---|
| NLSC WMTS `PHOTO2` / `EMAP` | 正射影像／電子地圖 | 已接 | 底圖 |
| NLSC WMTS `PHOTO2014`–`PHOTO2025` | 12 年歷年航照 | 已接 | 時間軸 2014–2025 自動換年份 |
| NLSC WMTS `LANDSECT` `BUILDX` `LAND_OPENDATA` `SoilLiquefaction` `ROAD` | 段籍界／分棟建物框／公有土地／土壤液化／道路 | 已接 | 右欄疊圖 |
| NLSC WMTS `LUIMAP` `Village` `TOWN` `MOI_HILLSHADE` `GeoSensitive` | 國土利用調查／村里界／陰影圖／地質敏感 | 200 | 候選疊圖（未接） |
| CARTO Positron／Dark Matter、Esri Light／Dark Gray | 淺／深色設計底圖 | 200 | 底圖（已接） |
| 內政部實價登錄批次 ZIP（`plvr.land.moi.gov.tw/DownloadSeason?season=115S1&type=zip`） | 季度買賣／租賃實價 | 200，14 MB | 成交均價熱力圖（候選；FUNRAISE MCP 已有實價工具，可先用 MCP） |
| 內政部村里界圖 SHP（data.gov.tw/dataset/7438） | 全國里界向量 | 200 | 里級人口 choropleth 的幾何 |
| data.taipei 各里人口、各區人口戶數 | 人口統計 | 200 | 人口熱區 |
| YouBike 2.0 即時 JSON（`tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json`） | 站點即時車位 | 200 | 即時圖層（候選） |
| Overture Maps buildings PMTiles（2026-08-19 release） | 全球建物 footprint＋高度 | 200/206 | 補強／校正 OSM 建物高度 |
| OSM Overpass（kumi.systems 鏡像）、Wikidata SPARQL、Wikimedia Commons API | 水體／POI／地標資料與照片 | 200 | 地標卡補照片、河流多邊形 |
| OSRM／Valhalla 公開示範站 | 路徑、等時圈 | 200 | 等時圈備援（非正式 SLA） |
| 建築技術規則 §39-1（冬至日一小時有效日照） | 法規 | 已核對 | 「日照檢核」功能依據；Cesium 自算太陽位置，不需 API |

### 13.2 需要申請（都免費）— 建議依序

| 順序 | 服務 | 申請處 | 額度／等待 | `.env`（server 端） | 解鎖功能 |
|---|---|---|---|---|---|
| 1 | Anthropic API | console.anthropic.com | 依方案 | `ANTHROPIC_API_KEY` | Claude 模式（真正的 agent，接 FUNRAISE MCP 即時查） |
| 2 | 交通部 TDX | tdx.transportdata.tw 會員中心「應用管理」 | 免費，即時～短暫審核 | `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` | 捷運各站進出人次（人流圖層）、公車、停車 |
| 3 | OpenRouteService | openrouteservice.org/dev | 免費，即時，約 2,000 次/日 | `ORS_API_KEY` | 真實路網的步行／開車等時圈（捷運等時圈不需要它） |
| 4 | 中央氣象署開放資料 | opendata.cwa.gov.tw/user/authkey | 免費，即時 | `CWA_API_KEY` | 現在天氣 HUD、天空色調 |
| 5 | 環境部資料開放平臺 | data.moenv.gov.tw | 免費，即時 | `MOENV_AQI_API_KEY` | 台北測站 AQI 角標 |
| 6 | Mapillary | mapillary.com/dashboard/developers | 免費，即時 | `MAPILLARY_ACCESS_TOKEN` | 選定建物的街景縮圖 |
| 7 | CARTO 免費 key | carto.com/basemaps | 免費，5M tiles/月，可商用 | `CARTO_API_KEY` | Positron／Dark Matter 長期穩定（目前無 key 也能跑） |
| 8 | TGOS 門牌坐標 API | api.tgos.tw | 免費，需審核 | `TGOS_API_KEY` | 地址轉坐標（補無座標紀錄） |
| 9 | Google Maps Platform（Map Tiles API） | console.cloud.google.com（需綁帳單） | 有免費額度，金額 UNVERIFIED | `VITE_GOOGLE_MAPS_API_KEY` | 相片級 3D Tiles（程式已就位） |
| 10 | Cesium ion | cesium.com/ion/signup | Community 版限非商業／評估；商用 $149/月 | `VITE_CESIUM_ION_TOKEN` | World Terrain、Cesium OSM Buildings |

**最值得人工探路**：國土測繪中心「多維度國家空間資訊服務平臺」（3dmaps.nlsc.gov.tw）宣稱提供全國 500 多萬棟 LOD1 3D 建物的 OGC 3D Tiles／I3S 服務、免登入；沙盒無法驗證憑證鏈，請用一般瀏覽器開 devtools 找 tileset.json 端點——若可用，可直接取代手工擠出的 OSM 量體。臺北市也有「自動化 3D 建物近似模型」開放資料（KMZ/COLLADA），可自建 3D Tiles。

所有金鑰一律放 server 端 `.env`，由 `server/index.mjs` 代理（同 Fish Audio 模式）；不要放 `VITE_*` 進前端 bundle（Google／ion 除外，那兩者本身就是前端金鑰）。


## 14. 金鑰怎麼放：本機 `/setup` 頁（2026-09-17）

線上的 GitHub Pages 版是純靜態站，任何需要金鑰的功能都由**你電腦上的 server** 代理；金鑰只寫進 `app/.env`（已 gitignore）。

```bash
git clone https://github.com/Nelsen-funraise/funraise-explorations && cd funraise-explorations/app
npm install && npm run build
npm run server              # http://localhost:8790
```
開 **http://localhost:8790/setup**：分組貼上金鑰 → 「儲存到 .env」→ 每一把旁邊有「測試」（真的打一次 API 回 ✓／✗）。這一頁只接受來自 localhost 的連線，其他 host 一律 403。

| 群組 | 變數 | 生效方式 |
|---|---|---|
| AI agent | `OPENAI_API_KEY`（預設用它）、`OPENAI_MODEL`（預設 gpt-4.1，可填 gpt-5）、`ANTHROPIC_API_KEY`（可選）、`LLM_PROVIDER` | 存檔即生效；`/api/health` 會顯示 provider／model |
| 語音 | `FISH_API_KEY` | 存檔即生效 |
| 即時資料 | `CWA_API_KEY`、`MOENV_AQI_API_KEY`、`TDX_CLIENT_ID`／`TDX_CLIENT_SECRET` | 存檔即生效（天氣／AQI 角標、YouBike、捷運真實站間時間） |
| 分析 | `ORS_API_KEY`、`MAPILLARY_ACCESS_TOKEN` | 存檔即生效（步行／開車等時圈） |
| 前端金鑰 | `VITE_CESIUM_ION_TOKEN`、`VITE_GOOGLE_MAPS_API_KEY` | 存檔後按「重新 build」（或 `npm run build`）；要讓 Pages 線上版也有，到 repo Settings → Secrets and variables → Actions 新增同名 secret，workflow 會在 build 時帶入 |

**OpenAI 模式怎麼運作**：server 走 OpenAI Responses API，把畫面工具（fly_to、set_sun、show_isochrone…）當 function tools，FUNRAISE MCP 用 OpenAI 的 hosted `mcp` tool 直接接 connector（帶你在右上角授權取得的 OAuth token）。前端迴圈不變：模型回傳的畫面工具由瀏覽器執行後回填。兩把金鑰都有時預設 OpenAI，`LLM_PROVIDER=anthropic` 可切回 Claude。

## 15. 在哪裡跑：Mac 本機 vs. 純網頁 vs. 自架 server（評估）

| 方案 | 能用的功能 | 需要什麼 | 適合 |
|---|---|---|---|
| **純網頁（GitHub Pages）** | 所有免金鑰功能：3D 城市、夜景窗燈、日照、等時圈、對焦、樓層視角、量測、場景與預錄語音、快照資料 | 什麼都不用，網址直接分享 | 到處分享、隨手 demo |
| **Mac 本機**（雙擊 `app/PeakLens.command`） | 上面全部 + OpenAI 對話、FUNRAISE MCP 即時查詢、Fish 即時語音、天氣／AQI／YouBike／捷運真實時間、ORS 步行圈 | Node 22（`brew install node`）；金鑰貼在 `/setup` | 自己用、面對面 demo |
| **自架 server + Pages 前端**（`app/Dockerfile`） | 全部功能，而且網址可以分享 | 一個容器主機（Cloud Run／Render／Fly，免費層即可）；在主機環境變數放金鑰與 `PEAKLENS_ACCESS_CODE`；repo variable `PEAKLENS_API_BASE` 指向主機網址 | 分享給投資人／同事，不用他們裝任何東西 |

**為什麼純網頁跑不動有金鑰的功能**：金鑰放進靜態網頁等於公開；所以所有金鑰只住在 server 的環境變數，前端透過 `/api/*` 代理。要「網頁能跑而且能分享」，就走第三種：server 放雲端，前端仍是 Pages。

**分享安全**：server 設 `PEAKLENS_ACCESS_CODE=<任意口令>` 後，所有 `/api/*` 都要帶口令；前端第一次被拒會跳出一次輸入框並記住。另有每 IP 速率限制（agent 30 次／分、語音 60 次／分）避免被刷爆 OpenAI 額度。`ALLOWED_ORIGIN` 可限定只接受 Pages 網域。

**自架步驟（以 Cloud Run 為例）**
1. `cd app && gcloud run deploy peaklens --source . --region asia-east1 --allow-unauthenticated --set-env-vars OPENAI_API_KEY=…,FISH_API_KEY=…,CWA_API_KEY=…,MOENV_AQI_API_KEY=…,TDX_CLIENT_ID=…,TDX_CLIENT_SECRET=…,ORS_API_KEY=…,PEAKLENS_ACCESS_CODE=…,PUBLIC_URL=https://<服務網址>`（Render／Fly 用同一個 Dockerfile，環境變數在它們的介面設）。
2. repo Settings → Secrets and variables → Actions → Variables：`PEAKLENS_API_BASE = https://<服務網址>`；Secrets：`VITE_CESIUM_ION_TOKEN`（要地形才需要）。
3. 重跑 Pages workflow（或推一個 commit）。Pages 前端會把 `/api/*` 打到雲端 server；FUNRAISE MCP 授權按鈕會彈出 OAuth 視窗，回呼到 `PUBLIC_URL/api/mcp/callback`（動態註冊，不用預先登記）。
4. 分享網址 + 存取碼。

**Mac 本機步驟**：`git clone …`，Finder 進 `app/`，雙擊 `PeakLens.command`（第一次會 `npm install` + build，之後直接啟動並開 `/setup`）。或終端機：`cd app && npm install && npm start`。

## 7. 截圖（無頭 Chromium 冒煙測試自動產生 · PickPeak DS 版）

| | |
|---|---|
| ![overview](assets/v2-overview.jpg) 平衡模式：PickPeak chrome、讀數膠囊、右側圖層邊緣把手 | ![immersive](assets/v2-immersive.jpg) 沉浸模式：只留鏡、指令膠囊與字幕，面板收成邊緣把手 |
| ![annotated](assets/v2-annotated.jpg) 標註模式：亮起的交易加編號 ①–③，對應左側「地圖標註」與來源晶片 | ![pin](assets/v2-pin.jpg) 釘在地圖上：台北101 的資料卡帶引線跟著物件 |
| ![renewal](assets/v2-renewal.jpg) 「信義區有哪些都更單元」 | ![future](assets/v2-future-2028.jpg) 「2028 年南港會長出什麼」 |
| ![street](assets/v2-street.jpg) 街景：南港軟體園區 | ![thermal](assets/v2-thermal.jpg) 熱感測 |
| ![light clusters](assets/v2-light-clusters.jpg) PickPeak 日間主題：淺色底圖 + 白色量體，建物聚合成青色「N 棟」泡泡 | ![light xinyi](assets/v2-light-xinyi.jpg) 日間主題拉近信義計畫區：icon 標註（交易／執照／基建）與資料卡 |
| ![timelapse](assets/v2-timelapse.jpg) 時光機：年份 HUD、當年新增量體長高 + 脈衝 | ![renewal sim](assets/v2-renewal-sim.jpg) 智慧都更模擬：地號拼成基地 → 容積量體 + 獎勵滑桿 |
| ![dark scene](assets/v2-scene-dark.jpg) 夜間戰情室主題（保留）：投資人鏡場景，正射影像 + 玻璃量體 | ![night facade](assets/v2-night-facade.jpg) 夜景窗燈：5.7 萬棟量體長出窗格與暖色燈光（程序化著色器）+ 泛光 |
| ![night street](assets/v2-night-street.jpg) 街景尺度的夜景：窗格、未來供給幽靈量體 | ![night rivers](assets/v2-night-rivers.jpg) 夜間的河川水面（波紋材質）與道路光帶，CARTO／Esri 深色底圖 |
| ![golden](assets/v2-golden-shadows.jpg) 日照 17:00：真實太陽位置，量體與都更模擬同時投影 | ![hover](assets/v2-hover.jpg) Hover 小卡：滑過即讀 |
| ![focus](assets/v2-focus.jpg) 對焦／X-ray：其餘量體退色，只留台北101 與周邊脈絡 | ![measure](assets/v2-measure-area.jpg) 量面積：m²／坪／周長，畫基地可直接跑容積量體 |
| ![isochrone](assets/v2-isochrone.jpg) 捷運 20 分鐘等時圈（內建路網計算） | ![trips](assets/v2-trips.jpg) 企業遷徙動線：弧線飛行、落地漣漪與公司名 |
| ![presenter](assets/v2-presenter.jpg) 展示模式：只留字幕與場景進度 | ![overlays](assets/v2-overlays.jpg) 國土測繪中心疊圖：段籍界 + 公有土地 |
| ![explain](assets/v2-explain.jpg) 說明模式：回答提到的物件自動編號、引線、暈影與說明卡（Phase 9） | ![101 parts](assets/v2-101-parts.jpg) 台北101 改用 OSM building:part 分段量體，階梯狀輪廓（Phase 9） |
| ![white S3](assets/v2-white-s3.jpg) 白模 Look · 街廓尺度：視野內優先的標籤預算（≤ 24） | ![night S1](assets/v2-night-s1.jpg) 夜景 Look · 城市尺度：合成器強制關閉泛光／HDR，不再糊成一片 |
| ![golden S4](assets/v2-golden-s4.jpg) 黃金時刻 Look · 建物尺度：泛光與 HDR 只在 S3–S4 開 | ![time machine](assets/v2-timemachine.jpg) 價值時光機 2.0：12 區依年度成交件數長高、依年增率上色，HUD 即時計數 |
| ![scene stage](assets/v2-scene-stage.jpg) 場景導演 2.0：舞台接管（黃金＋沉浸）、編號標註、底部統一語音列與步驟進度（Phase 10） | ![annotated insights](assets/v2-annotated-insights.jpg) 標註模式：玻璃晶片 icon、膠囊標籤、右側自動洞察列（Phase 10） |
| ![immersive](assets/v2-immersive-letterbox.jpg) 沉浸模式：上下遮幕，只留地圖、標註與語音列（Phase 10） | |

## 16. 視圖語法與合成規則（Phase 9 設計，2026-09-17）

Phase 8 之後的實測（本機、金鑰齊全）暴露了三個結構性問題：圖層各自為政、說明時重點不突出、AI 迴圈慢且會在只動鏡頭之後沒有回覆。這一節定義「誰在什麼時候可以出現、疊在誰上面、跟誰互斥」，程式碼落在 `src/compose.js`（合成器），所有開關（rail、快捷鍵、agent 工具）都經過它。

### 16.1 尺度（Scale）：相機高度決定資訊預算

| 尺度 | 相機高度 | 該看到什麼 | 不該出現 | 標籤預算 |
|---|---|---|---|---|
| S0 全島 | > 60 km | 地球、台灣輪廓、都會區光點 | 一切點位與多邊形 | 0 |
| S1 城市 | 8–60 km | 商圈行情熱區（柔光）、重劃／區段徵收六角、捷運線與公建線、行政區名、商辦聚合泡泡 | 建物標籤、建照、YouBike、都更多邊形（縮成點）、hover 小卡、泛光／HDR／AO | 行政區名 12 |
| S2 行政區 | 2–8 km | 聚合泡泡拆成 icon、都更多邊形（只有政府主導才有標籤）、重劃六角＋名稱、捷運站、未來供給量體、上市櫃交易前 N 筆、遷徙動線 | YouBike、建照標籤、商圈行情文字（只留熱區） | 12 |
| S3 街廓 | 0.5–2 km | 所有 icon、都更多邊形＋短標籤（≤ 10 字，全名在 hover／選取）、建照、YouBike、等時圈／生活圈、對焦 | 重劃六角（太大，退成外框） | 24 |
| S4 建物／街景／樓層 | < 0.5 km | 選取的建物卡、對焦／X-ray、樓層視角、hover、夜景窗燈、相片級 3D | 除了選取／釘選／說明標註以外的所有標籤 | 選取＋釘選＋標註 |

- 尺度由 `rig.lonlat[2]` 連續判定，帶 15% 遲滯避免在邊界抖動；切換時圖層用 400 ms 淡入淡出，不可瞬間出現。
- 每個圖層宣告自己的 `scales`（哪些尺度可見）與 `labelScales`；合成器在相機停止移動後套用，不需要各模組自己判斷。
- 標籤預算以重要度排序（既有 `importance()`），超出預算的標籤隱藏；選取、釘選、說明標註永遠不計入預算。

### 16.2 外觀（Look）：一個控制取代五個開關

主題、底圖、日照、夜間、畫質原本是五個互不知情的開關，可以同時按出「☀ 17:00 + 🌙 夜 + HDR + 泛光 + 正射影像 + 13 km」這種糊成一片的畫面。改成一組互斥的 **Look 預設**，每個預設是一個完整、可被信任的組合；細項仍在 rail 可以微調，但一換預設就整組重設。

| Look | 主題 | 底圖 | 日照 | 建物 | 後製 | 用途 |
|---|---|---|---|---|---|---|
| 白模（預設） | 日間 | 正射影像（S3 以下）／淺色底圖（S2 以上） | 關（平光） | 白色量體 | 全關 | 分析、閱讀資料 |
| 日照 | 日間 | 同上 | 開，可選時刻／播放一天 | 白色量體＋陰影 | 全關 | 日照權、量體研究 |
| 黃金時刻 | 日間 | 正射影像 | 17:00 固定，暖色 | 白色量體 | 泛光弱、HDR（僅 S3–S4） | 展示、簡報 |
| 夜景 | 夜間 | 深色底圖（不是正射） | 關 | 夜景窗燈、道路光帶、水面 | 泛光（S2–S4）、HDR（S3–S4） | 戰情室、夜間展示 |
| 相片級 | 日間 | 正射 | 關 | Google Photorealistic 3D Tiles，白模隱藏（只留對焦外框） | 全關 | 「看起來像真的」；需要 Google 金鑰，沒有就灰掉 |

- 尺度約束優先於預設：S1 以上一律關閉泛光／HDR／AO（城市尺度的正射影像加泛光就是那張糊掉的截圖）；AO 只在 S3–S4 且白模／日照時允許。
- 夜間主題不允許正射影像當底圖（會變成灰泥）；使用者硬選正射時自動套 60% 暗化去飽和。
- 「☀ 日照」與「🌙 夜」兩顆 pill 合併成 Look 分段控制，時刻滑桿是「日照／黃金」底下的子控制；舊的 `set_theme／set_sun／set_quality／set_basemap` 工具保留但都會經過合成器修正並回報「已調整為…」。

### 16.3 圖層相容矩陣

| 互斥／退讓 | 規則 |
|---|---|
| 地面疊圖（段籍界、建物框、公有土地、液化、道路）之間 | 最多同時兩層；第三層開啟時最舊的一層自動關閉並提示 |
| 地面疊圖 vs 商圈行情熱區 | 兩者都畫在地面：疊圖開啟時熱區退成 25% |
| 等時圈 vs 生活圈 | 只能有一個；開新的就清舊的 |
| 等時圈／生活圈 vs 熱區、重劃六角、都更標籤 | 分析圈開啟時，圈外的點位淡到 30%，熱區與六角隱藏，都更只留多邊形 |
| 對焦 vs 等時圈／生活圈／展示模式 | 對焦是獨佔狀態：進入時清分析圈，退出時還原 |
| 遷徙動線播放中 | 隱藏上市櫃、建照標籤，商辦 icon 淡到 40%，動線完成 3 秒後還原 |
| YouBike | 只在 S3–S4；拉高自動隱藏、拉回自動出現，不需要重按 |
| 夜間主題 vs NLSC 疊圖 | 疊圖是為白底設計：夜間時疊圖線條亮度提高、粗細加一 |

### 16.4 疊放順序（由上到下）

1. HTML 覆蓋層：釘選卡、說明標註、hover 小卡、量測讀數
2. 選取／高亮的物件：外框＋帶底色的標籤，`disableDepthTestDistance = ∞`
3. icon（商辦、交易、建照、公建、捷運站）
4. 一般標籤（受預算控制）
5. 面：都更多邊形（h 0.5）、公園（0.4）、重劃六角（0.3）
6. 分析圈：等時圈／生活圈（h 0.2，半透明）
7. 地面疊圖（NLSC WMTS）
8. 底圖

### 16.5 說明模式（Explain）：回答時讓重點自己浮出來

agent 回答若牽涉到畫面上的物件（highlight／select／pin／callouts），自動進入 12 秒的說明模式，使用者一動滑鼠或鍵盤就退出：

1. **取景**：相機移到能同時看到所有被提到物件的位置（`flyToBoundingSphere`），最多 8 個。
2. **遮罩**：非相關的 OSM 量體退成灰（沿用對焦的 `dimOthers`），無關的 FUNRAISE 圖層淡到 25%，畫面四周加一層徑向暈影，讓眼睛落在中間。
3. **標註**：被提到的物件掛編號 ①–⑧ 與引線，**不論目前密度**（原本只有標註模式才有）；標籤永遠置頂。
4. **說明卡**：回答第一句＋物件清單以一張浮在地圖上的卡片呈現（沉浸模式改成字幕列），點清單項目會把相機帶過去。
5. **退出**：淡出遮罩、還原圖層，但編號保留到下一個問題。

### 16.6 AI 迴圈與語音

| 問題 | 修法 |
|---|---|
| 只動鏡頭沒有回覆（迴圈跑滿 6 回合就靜音結束） | 回合用完或連續兩回合只有鏡頭工具時，server 以 `tool_choice: none` 強制收尾一句話；client 保證每次提問都有文字與語音 |
| 每回合 4–20 秒（gpt-5 一次只呼叫一個工具） | 純鏡頭／外觀／圖層指令先走內建意圖路由（0 ms，直接執行、直接說），只有資料問題才送 LLM；系統提示要求「一回合內平行呼叫所有畫面工具」；新增 `present_place` 巨集工具一口氣完成飛行、環繞、Look |
| gpt-5 慢 | `reasoning.effort` 預設 low、可設 minimal；`text.verbosity: low`；串流 `output_text.delta` 讓文字邊出邊念 |
| 語音只念了第一次 | 每次提問先 `speech.stop()`；只念前兩句且 ≤ 110 字、去掉條列符號；只有工具沒有文字時念工具摘要（「已飛到台北101，黃金時刻」） |
| 參數壞掉（`}！！=` 這種 key） | server 端依工具 schema 丟掉未知欄位；解析失敗回傳錯誤給模型重試 |
| 聊天視窗蓋住地圖 | 工具卡預設收合成一行進度（「查詢產業園區… 第 3 步」），對話框固定在左下、最寬 560 px、最高 22vh，hover 才展開；沉浸模式只留字幕 |

### 16.7 地標形狀

OSM 對台北 101、南山廣場等地標有 `building:part`（分段量體，各自有 `min_height`／`height`）。`scripts/fetch-osm-parts.mjs` 抓 bbox 內所有 building:part，輸出 `public/data/osm_parts_taipei.json`；載入時有分段的母建物不再畫成單一柱體，改畫分段。有 Google 金鑰時「相片級」Look 直接切到 Photorealistic 3D Tiles，白模隱藏。

### 16.8 金鑰齊全情境的模擬

`PEAKLENS_DEMO_LIVE=1` 讓 server 在缺金鑰時回傳標記為 DEMO 的擬真資料（天氣、AQI、YouBike 站點、TDX 站間時間、ORS 生活圈），角標顯示「DEMO」。用途只有一個：讓無頭冒煙測試與截圖能在金鑰齊全的完整合成下驗證外觀。

## 17. Phase 9 落地紀錄（2026-09-17）

§16 的規則實作在以下模組；每一項都有無頭冒煙測試或子任務的 Playwright 驗證。

### 17.1 合成器 `src/compose.js`

- 相機停止移動 250 ms 後判定尺度 S0–S4（15% 遲滯），對每個圖層套用 `scales`／`labelScales` 遮罩（與使用者開關分開存放，拉遠自動隱藏、拉近自動出現，不必重按）。
- 標籤預算改成**視野內優先**：以 `rig.bounds()` 加 25% 邊界先排視野內的候選，再依重要度補滿；原本是全台排名，常常一個都不在畫面上。實測 S1 12、S3 24、S4 只留選取／釘選／說明標註。
- Look 預設 `white / sun / golden / night / photoreal` 各是一組完整設定（主題、底圖、日照、窗燈、後製）；尺度約束優先：S0–S1 一律關泛光／HDR／AO。header 上原本的「☀ 日照」「🌙 夜」「主題」三顆 pill 合併成一顆 Look pill 加彈出選單，時刻滑桿是日照／黃金底下的子控制；Shift+L 循環。
- 相容矩陣：地面疊圖最多兩層（第三層自動關掉最舊的並提示）、疊圖開啟時熱區退到 25%、等時圈與生活圈互斥、分析圈開啟時圈外點位退到 30%、對焦進入時清分析圈、遷徙動線播放中隱藏交易／建照標籤並把商辦 icon 淡到 40%（結束 3 秒後還原）。
- `ui.setTheme/setSun/setBasemap/setNight/setQuality/setOverlay` 仍可呼叫（agent 工具與舊程式碼都在用），但都經過合成器：手動微調視為覆寫，下一次換 Look 整組重設；被尺度修正的請求回傳 `{ adjusted: true, note }`。
- 分享連結多了 `look=`。

### 17.2 說明模式 `src/explain.js`

- 回答完成（`ui.type` 與串流 `typeStream.done` 共用的 `settle`）時，從 `layers.highlight` 收集被點亮的物件 key；有物件就進入說明模式 12 秒：取景（單點 900 m、多點 `BoundingSphere` 1.4 倍邊界）、非相關 OSM 量體退灰（沿用對焦模組）、無關 FUNRAISE 圖層淡到 25%、徑向暈影、編號 ①–⑧ 引線標註（不論密度）、右側說明卡（沉浸模式改字幕列）。
- 使用者一動滑鼠、滾輪或鍵盤就退出；編號保留到下一個問題。
- 為了不和合成器的標籤預算打架，被提到的物件同時以 `layers.pulse` 標為 hot，預算重算時永遠保留。

### 17.3 AI 迴圈與語音（`src/agent/claudeClient.js`、`server/llm.mjs`、`server/index.mjs`）

- **一定有回覆**：迴圈連續兩回合只有鏡頭工具、或跑滿回合數時，client 以 `final: true` 再叫一次 server，server 用 `tool_choice: none` 且不掛 MCP，逼模型收尾；再失敗就由 client 依已執行的工具合成一句（「已飛到台北101並切到黃金時刻。」）。
- **快速路由**：`Agent.tryLocal(text)` 先處理純鏡頭／外觀／圖層／密度／鏡別／場景指令（0 ms、不打 LLM）；含「哪些／多少／比較／交易／租金／都更／建照／公司／開在哪」等資料字眼的問題才送 LLM。
- **少回合**：系統提示要求畫面工具同回合平行呼叫；新增 `present_place`（飛行＋環繞＋Look 一次完成）與 `set_look`；OpenAI 端 `parallel_tool_calls: true`，推理模型 `reasoning.effort` 預設 low（可設 `OPENAI_REASONING=minimal`）、`text.verbosity: low`。
- **串流**：`/api/agent` 帶 `stream: true` 回 SSE（`text` delta、`tool`、`done`、`error`），client 邊收邊打字，第一個句號就開始念；任何不對就退回非串流路徑。Anthropic 路徑目前整段一次送出。
- **參數清洗**：server 依工具 schema 丟掉未知欄位、字串轉數字／布林，JSON 壞掉回 `{ _error }` 讓模型重試（實測那個 `}！！=` key 就是這樣被吃掉的）。
- **語音**：每次提問先 `speech.stop()`；只念前兩句、去條列與「來源：」、上限 110 字；工具有動作但沒文字時念合成摘要。
- **對話 dock**：左下角、最寬 560 px、最高 22vh（hover 46vh）；工具卡收成一行即時進度（「查詢…第 N 步 · X s」），點開才展開；舊的對話收成一行；連續提問排隊執行、打字互不干擾。

### 17.4 快照優先的資料層（`server/snapshot.mjs`、`server/cache.mjs`）

- server 啟動時載入 `peaklens.json` 與 `timeseries.json`，建好行政區／名稱／年份索引；新工具 `query_snapshot`（kind：buildings、mops、licenses、renewal、future、moves、zones、infra、parks、areas、districts、timeseries、summary）回傳 ≤ 12 筆精簡列與可點亮的 keys，每次 ≤ 4 KB。
- 模型呼叫 `query_snapshot` 時 **server 自己執行並在同一次請求內把結果餵回模型**（最多 4 次），不再繞回瀏覽器；串流路徑以 `tool` 事件讓對話框看得到。混合回合（快照＋鏡頭工具）則原樣回瀏覽器。
- 系統提示改成快照優先：快照涵蓋的東西一律先查快照並標「來源：快照 日期」，FUNRAISE MCP 只用在快照沒有的物件、即時價格／地號／公司登記／謄本、或使用者明說「最新／即時」，且每回合最多 3 個 MCP 工具。`## 快照內容` 一段告訴模型快照裡有什麼。畫面狀態壓縮、歷史只留最近 8 輪。
- 實測（mock OpenAI，重現真實請求形狀）「信義區最近一年上市公司買了什麼」：從 5–15 次 MCP 呼叫、約 98 秒，變成 2 次模型呼叫、1 次快照查詢、0 次 MCP。
- `cache.mjs`：LRU＋TTL（`MCP_CACHE_TTL_S`，預設 600 s），目前用於快照查詢結果；MCP 呼叫在 OpenAI 端由 hosted mcp tool 執行、Anthropic 端由 API 端執行，server 都看不到，所以還快取不到，註解裡有寫。
- 測試：`node server/snapshot.test.mjs`（74 項）、整合測試（mock OpenAI 19 項）、`ors.test.mjs` 40 項無回歸。

### 17.5 地標分段量體與 DEMO_LIVE（`scripts/fetch-osm-parts.mjs`、`src/layers/osmBuildings.js`、`server/routes/*`）

- `fetch-osm-parts.mjs` 從 Overpass 抓 bbox 內所有 `building:part`（0.02° 分格、逾時自動四分、ODbL 標示），高度只採 `height` 或 `building:levels × 3.2`，沒有就不畫；以點在多邊形內比對母建物，母建物被分段覆蓋 ≥ 60% 面積就不再畫成單一柱體。結果 `public/data/osm_parts_taipei.json`：10,526 段、1,688 棟母建物改畫分段（台北101 508 m、台北天空塔 280 m、國泰置地廣場 192 m…）。載入器把分段與建物當同一組 primitive 管理，調色、窗燈、對焦、相片級隱藏都一起生效；`osm.partCount`、`osm.setVisible(on)`。
- 抓取當天 Overpass 不穩，20 個子格失敗（列在 `meta.tiles_missing`），其中含南山廣場那一格；補抓模式 `--bbox … --merge` 可只補該格並合併。
- `PEAKLENS_DEMO_LIVE=1`：缺金鑰時 `/api/env`、`/api/youbike`（60 站）、`/api/tdx/s2s`（106 段站間時間）、`/api/walkshed` 回帶 `demo: true` 的擬真資料，角標顯示「DEMO」；有真金鑰一律優先。只用於無頭測試與截圖。測試：`live.test.mjs` 35 項、`ors.test.mjs` 40 項。

### 17.6 價值時光機 2.0（`src/layers/timemachine.js`、`src/scenes.js`）

- 原本的時光機在 7–10 km 高度看一年長出一棟樓，看不出變化。改成 **區級價值面**：12 個行政區多邊形依當年數值長高、依年增率上色（藍升、橘降、灰平），三個指標 `sales_all` 成交件數（預設）、`sales_office` 商辦成交、`licenses` 建照核發，資料來自 `public/data/timeseries.json`（FUNRAISE MCP 抓的 2012–2026 每區每年計數，方法與註記見 `TIMESERIES_README.md`）；缺檔時退回快照計數。年份切換 350 ms 動畫，只在 S1–S2 出現（rail 開關「價值面」，圖層 key `tm`）。
- 年度脈衝：年份前進時各區依年增率閃一下；S2–S3 掉出該年的上市櫃交易金額標籤，2 秒淡出。
- 新建物找得到：長出來的建物多一道 150–400 m 光柱與「+ 名稱 · NF」標籤 2.5 秒。
- HUD：`#yearhud` 顯示「2016 · 台北市成交 18,325 件 ▼17% · 商辦 13 · 建照核發 207」這種即時累計；2026 標「至今」不算年增率；商辦成交 2012–2016 標「資料涵蓋不足」（早年 main_use 標記不足，不是市場事實）。
- 場景：「時光 2012→2030」改成五段：S1 全市 2012→2019 面量體 → S2 信義 2019→2026 脈衝、金額、光柱 → S3 南港 2026→2030 未來供給 → 回 S1；旁白讀即時資料（如「大同區這幾年變化最大」）。投資人場景第一步改在 S2 讀最近一季商圈租金。
- 已知：指標切換目前只有 `map.timemachine.setMetric()`（agent／場景用），rail 尚無選單；S1 極遠時兩三個區的面量體標籤與區名可能靠近。

### 17.7 MCP 工具白名單（Phase 9.1，2026-09-17）

實機 log 顯示每回合送給模型的輸入約 3 萬 token，其中約 2.2 萬是 FUNRAISE MCP 一百多個工具的描述被 hosted mcp tool 整包帶進每一回合。server 現在只允許 31 個睿鏡真正用得到的工具（商辦、都更、實價登錄買賣／租賃、上市櫃交易、建照／使照、公司登記、產業園區、公建、商圈、土地與分區、未來供給、重劃、捷運、關鍵企業、利害關係人、大樓知識庫），付費的謄本爬取工具刻意排除。OpenAI 走 `allowed_tools`，Anthropic 走 `tool_configuration.allowed_tools`。`MCP_ALLOWED_TOOLS` 可自訂，填 `all` 關掉過濾。server 預設埠統一為 8790（與 `PeakLens.command`、文件、UI 提示一致）。

## 18. Phase 10 設計：實景底座、場景導演 2.0、視覺語言（2026-09-17）

Nelsen 第二輪實測回饋：為什麼不用真實 3D 紋理；場景裡的虛線與高亮不夠明顯，場景應該自己接管設定；語音與動畫沒對齊；圖層配置像 90 年代 GIS，缺科技感、AI 感，沉浸不夠沉浸、標註不夠聰明；場景字幕框和 AI 對話框互相干擾。

### 18.1 實景底座（Photoreal base）

- **預設實景**：Google Photorealistic 3D Tiles 有 Cesium ion token 就能載（ion 資產 2275207，`createGooglePhotorealistic3DTileset()` 不給 key 就走 ion）；有 `VITE_GOOGLE_MAPS_API_KEY` 則直接走 Google。有任一把就把 Look 預設設成「實景」，白模、日照、黃金、夜景退為分析與展示用；兩把都沒有才維持白模預設。載入失敗（額度、網路、權限）自動退回白模並在角標說明原因，`window.PL.photoreal.status` 可查。
- **有資料的建物才「框」起來**：156 棟 FUNRAISE 商辦與未來供給用 OSM 足跡畫成玻璃殼（半透明量體外擴 1.5 m，等級配色：P／A 藍本藍、B 建構灰藍、F 人文橘）、屋頂一圈發光輪廓線（PolylineGlow）、往上的細針腳接到浮空晶片 icon。這是「這棟有資料、可以點」的統一暗示；在白模 Look 也保留屋頂光環。實景下其餘 5.7 萬棟白模隱藏，未來供給的幽靈量體仍畫（實景裡本來就沒有）。
- **地面圖層貼附**：實景的地表在網格上，都更多邊形、重劃、公園、等時圈、生活圈、價值面底部一律改成 `classificationType: BOTH` 貼在 3D Tiles 上（不再擠出 0.5–3 m）；河川與道路光帶在實景下隱藏（影像本來就有）；icon 與標籤沿用 OSM 高度，另加 `CLAMP_TO_3D_TILE` 的地面 icon（建照、捷運站、YouBike）。
- **效能**：`maximumScreenSpaceError` 依尺度 16–32，`dynamicScreenSpaceError` 開，`skipLevelOfDetail`；載入進度顯示在讀數膠囊；S0–S1 全島尺度改回白模或底圖以省流量。
- **夜景**：Google tiles 是白天影像，實景下的「夜景」以藍調色調＋道路／捷運光帶＋窗燈玻璃殼模擬，不做假貼皮。

### 18.2 場景導演 2.0

- **舞台接管**：每個場景步驟宣告 `stage`：Look、密度、要開的圖層、要點亮的 keys、強調等級。導演進場時存下使用者狀態，逐步強制套用（含把無關圖層淡到 20%、把該步的物件交給說明模式取景與編號），結束還原。虛線與多邊形在場景中用「強調等級 2」：線寬 2→6 加發光、多邊形邊緣脈衝、icon 放大 1.4 倍。
- **旁白節拍**：`speech.speak(text, { onProgress })` 用 `audio.currentTime / duration` 回報進度；步驟的 `beats: [{ at: 0.0, run }, { at: 0.55, run }]` 在旁白讀到該比例時觸發；時光機 `startLapse({ durationMs })` 綁定旁白長度，旁白唸完的那一刻剛好到終點。步驟結束條件是「旁白唸完且動畫 promise 完成」，不是固定 hold。Web Speech 備援用 `onboundary` 估進度。
- **統一語音列**：`#voicebar` 取代 `#cinebar`＋`#caption`：底部一條玻璃橫列，左邊模式標（「場景 2／5 · 投資人巡航」或「睿鏡」），中間大字幕（當前句子），右邊步驟進度點與 ▶／⏸；AI 回答時同一條列顯示回答第一句，完整內容留在對話 dock。場景播放中使用者提問就暫停場景，回答完提供「▶ 繼續」。
- **展示模式**：進入時自動沉浸密度、大字幕、隱藏 rail 與 inspector，Esc 離開；字幕與語音列合一。

### 18.3 視覺語言（Harmony）

- **晶片 icon**：圓形實心 icon 改成玻璃晶片：外圈細環＋內填 12% 底色＋字形，外側 24 px 柔光暈；依重要度縮放；離地 icon 有 1 px 針腳連到屋頂或地面。聚合泡泡改為霜面玻璃圓，數字用 mono。
- **標籤**：帶半透明深色膠囊背景（日間主題用白色 88%）、字級 12／11、眉標 mono；每個標籤只講一件事（名稱或數字），第二行交給 hover。
- **面**：都更多邊形用邊緣呼吸脈衝（alpha 0.35↔0.6，2.4 s）＋內部 8% 填色；重劃六角改細環；等時圈用同心漸層而不是實色帶。
- **HUD**：面板統一玻璃（背景 72% 模糊 18 px、1 px 邊線、頂部 1 px 藍本藍高光線）、圓角 14、陰影兩層；數字用 mono 大字；「AI 思考中」有流光。
- **標註模式要聰明**：右側「洞察列」自動從快照與時序資料產生 3–5 張晶片（如「信義區 2025 成交 ▼24%」「南港 2026–2028 新供給 45 層」「大安區公司數 16,850 ▲6%」），點一張就飛過去並進說明模式；畫面上被提到的物件掛編號與引線；標籤預算提高到 32。
- **沉浸模式要沉浸**：只留語音列與右下小羅盤，上下各 6% 漆黑遮幕（letterbox），面板全部收成邊緣把手；hover 小卡仍可用。

## 19. Phase 10 落地紀錄（2026-09-17）

### 19.1 實景底座（`src/layers/photoreal.js`、`frames.js`、`groundmode.js`）

- 有 `VITE_CESIUM_ION_TOKEN` 或 `VITE_GOOGLE_MAPS_API_KEY` 任一把就把 Look 預設設成「實景」：Google Photorealistic 3D Tiles 透過 Cesium ion 資產 2275207 載入（有 Google 金鑰則直連）。`photoreal.status` idle→loading→ready｜failed；失敗自動退回白模並 toast 原因，`PL.photoreal.diagnostics()` 可查；同一個 session 不重試，除非 `retry()`。
- 156 棟 FUNRAISE 商辦中 143 棟對到 OSM 足跡，畫成玻璃殼（外擴 1.5 m、半透明、等級配色）＋屋頂發光輪廓＋針腳到晶片 icon；屋頂光環在所有 Look 都保留當「有資料」的暗示；未來供給幽靈量體加虛線屋頂線。實景下白模與橘色商辦量體隱藏（`layers.setStockVolumes(false)`），icon／標籤照常。
- 地面圖層在實景下改成 `classificationType: BOTH` 貼附網格（都更、重劇、公園、熱區；等時圈與生活圈透過 `groundPolygon()`），河川道路光帶隱藏；地面 icon 用 `CLAMP_TO_3D_TILE`。畫質 SSE 依尺度 12–32。
- 夜景在有實景時＝藍色調的 tiles＋道路／捷運光帶＋更亮的屋頂光環。
- 沙盒沒有 token 也連不到 Google：驗證了建立、失敗退回、地面模式切換、玻璃殼外觀（30 項斷言），真實貼圖由 Nelsen 在 Mac 上第一次確認。
- 已知：等時圈／生活圈的線仍是固定高度；YouBike 站點未貼附網格。

### 19.2 場景導演 2.0（`src/scenes.js`、`src/fx/stage.js`、`src/ui/voicebar.js`、`src/speech.js`、`src/time.js`）

- 25 個場景步驟每一步都宣告 `stage`（鏡別、Look、密度、要開的圖層、要點亮的 keys）；導演 `play()` 先存下使用者的 Look／密度／圖層／年份／鏡別／相機，逐步強制套用，無關圖層淡到 20%，該步的物件交給說明模式取景編號；`stop()` 或播完自動還原。強調等級 2：線寬 ×3 加發光、多邊形邊緣呼吸脈衝、icon ×1.4。
- 旁白節拍：`speech.speak(text, { onProgress })` 用音檔進度回報；步驟的 `beats: [{ at, run }]` 在旁白讀到該比例時才觸發；時光機 `startLapse({ durationMs })` 綁定旁白長度。步驟結束條件是旁白唸完且動畫完成，不再是固定秒數。
- 統一語音列 `#voicebar` 取代舊的 `#cinebar` 與 `#caption`：模式標（場景 n／N 或 睿鏡）、當前句子大字幕、步驟進度點、▶⏸⏹；AI 回答也走同一條列；場景播放中提問會暫停場景，答完出現「▶ 繼續場景」。展示模式下變成下三分之一大字幕，空白鍵暫停／繼續。
- 語音清洗與分句：`speakable()` 把 →、×、▲▼、①–⑧、m²、｜、/ 等改成口語並去掉「來源：」；長文依句號分段、逐段合成並預載下一段，`stop()` 中止整個隊列。預錄好的場景旁白仍用原本的整段 mp3。
- 已知：`stage.dim` 對只有多邊形的圖層是靠自己補的材質淡化；WebGL 線寬受平台限制時靠發光材質撐效果；沙盒計時器被節流，節拍時間在實機上才準。

### 19.3 視覺語言（`src/layers/icons.js`、`funraise.js`、`style.css`、`src/ui/insights.js`）

- icon 改玻璃晶片（細環＋12% 底色＋字形＋柔光暈），P／A 級 34 px、其餘 26 px；商辦、未來供給、上市櫃交易有 1 px 針腳；聚合泡泡改霜面玻璃圓加 mono 數字。
- 標籤一律膠囊底（暗色 78%／日間白 88%），一個標籤只講一件事；都更多邊形 8% 填色＋邊緣呼吸脈衝、重劃改細環、公園 6%；熱區更柔更大。
- HUD 玻璃系統：面板 72% 加 18 px 模糊、1 px 邊線、頂部藍本藍高光線、圓角 14、雙層陰影；「AI 思考中」流光；hover 小卡有圖層色的側邊條。
- 標註模式多一條「洞察 · INSIGHTS」列：依相機下的行政區從快照與時序資料算出最多 5 張晶片（公司數與成長率、當年成交與年增率、A 級租金、未來供給、上市櫃交易），點了就飛過去進說明模式；沉浸模式上下 6vh 遮幕。

### 19.4 實測回饋修正

- AI 模式在 server 有模型時自動開啟並記住選擇；AI 一句失敗改用內建 agent 回答該句，不再整個切回內建；內建的「聽不懂」會提示切到 AI 模式。
- MCP refresh token 綁定取得它的 client：換埠（8787→8790）後不再因重新註冊 client 而 400「Client ID mismatch」；refresh 被拒就清 token 並提示重新授權。
- `/setup` 說明 ion token 就能開實景，Google 金鑰可選。

## 20. Phase 11：地政參訪場景、agent 導演、遮罩修正、線上版金鑰、效能與 Vercel（2026-09-18）

觸發：地政長官當日到訪、Nelsen 出差，需要同仁能直接開的線上版；加上三個實測回饋——「跑場景時來不及 render、糊成一坨、一直在重新 loading」、「上下有一個深色遮罩把 UI 都擋住」、「agent 一次只會跳去一個地方開關圖層，沒辦法像腳本那麼細緻」。

### 20.1 地政巡禮場景與 agent 導演（`src/scenes.js`、`src/agent/*`、`server/index.mjs`）

- **新場景 `land`「地政巡禮 · 從地籍到城市」（7 段）**：① 開場全景（有金鑰用實景，否則日照）→ ② 國土測繪中心段籍界＋公有土地 WMTS 疊在 3D 城市上（切到日照 Look：疊圖畫在地球影像層，實景 tileset 蓋著看不到）→ ③ 全市 73 處市地重劃／區段徵收（54＋19，`zone:` 脈衝，框南港經貿園區、基隆河截彎取直段、新隆里）→ ④ 都更：2,337 處更新地區與單元（大安區 360 最多），走進信義區公辦都更「兒福B1-2及B3-2」跑智慧都更模擬（3 筆地號、住3、容積率 225%／建蔽率 45%、30% 獎勵 → 8 層 29 m 量體；這一段切到平衡密度並用 `body.sim-open` 讓模擬卡在電影模式下保持不透明）→ ⑤ 南港經貿園區歷年正射影像 2014→2025 跟時間軸自動換年 → ⑥ 實價登錄價值面 2012→2026（`tm` 12 區，旁白現算高點 2013 年 34,705 件、2026 年到目前 8,693 件）→ ⑦ 收尾回實景環繞。旁白數字全部從快照／timeseries 現算。場景快照多記了 **NLSC 疊圖清單與模擬卡狀態**，結束時一併還原（`_snapshotState`／`_restoreSnapshotNow`）。
- **agent 導演**：三個新工具。`list_scenes`；`play_scene {id}`（六個內建場景）；`play_script {title, sub, steps[]}` —— 每段 `{text, place|lon/lat, range, pitch, heading, mode fly|orbit|street, look, lens, layers{show,hide}, keys[], overlays[], year, lapse{from,to}, simulate_renewal}`。前端 `compileScript(input, ctx)`（`scenes.js`）逐段驗證（圖層鍵、物件 key 必須存在，不存在的回報在 `dropped`；photoreal 沒金鑰退成 sun；數值夾範圍；第一段進沉浸、都更模擬段用平衡）並翻成與內建場景完全相同的 `stage + beats` 結構，`SceneDirector.play()` 現在同時接受 id 或場景物件。SYSTEM 新增規則 8：「幫我做一個給○○看的場景／腳本」→ 先 `query_snapshot` 查 2–3 個數字與 key，再**一次**呼叫 `play_script` 排好 4–7 段，不要一段一段用 `fly_to`／`set_layers` 慢慢調。工具回傳後模型只列段落大綱；場景一開始 `ui.cine()` 就設了 `ui.sceneId`，所以收尾文字只顯示、不搶語音。
- **內建模式也能播**：`Agent.sceneIntent()`（`handle()` 與 AI 模式的 `tryLocal()` 共用）——「播放地政場景」「來一段給投資人看的」「全部連播」「停」「有哪些場景」0 次 LLM 呼叫；「幫我做一個…場景」在內建模式會提示切到 AI 模式。
- 全部連播改為六段（投資人 → 開發商 → 選址 → 城市治理 → 地政 → 時光，約 6 分鐘）。

### 20.3 遮罩修正（`src/style.css`、`src/ui.js`）

根因兩個：(a) §18.3 的 6vh 上下黑帶掛在 `body.d-immersive` 上、`z-index:3`，而 `#topbar`／`#console` 是 6——理論上在下面，但 `body.d-immersive #topbar{opacity:.28}` 把整條 header 淡到幾乎看不見；(b) 場景與展示模式用 `ui.setDensity('immersive', true)` 接管密度，而 `setDensity` 不分 quiet 一律寫 `localStorage pl.density`，所以場景一播（或中途重新整理），下次開機就卡在沉浸密度＋黑帶＋淡掉的 header。修法：黑帶只在 `body.cinema`（場景播放中）或 `body.presenting` 出現，`z-index:2`（低於所有控制項）、高度 5vh；header 只在 `cinema` 淡出；`setDensity(mode, quiet)` 只有使用者自己按（`!quiet`）才寫 localStorage。冒煙：沉浸密度無場景 → `::before` content `none`、topbar opacity 1；場景中 → 黑帶出現、topbar .28；停止 → 全部還原、`pl.density` 不變。

### 20.5 線上版金鑰填寫處（`src/keys.js`、`src/ui/keys.js`、`viewer.js`、`api.js`）

GitHub Pages 這種靜態託管沒有 `/setup`，所以前端多了 **🔑 金鑰** pill → 對話框，四個欄位只存 `localStorage`（`pl.ion`／`pl.gkey`／`pl.api`／`pl.code`），不上傳、不進 build：Cesium ion token（實景 3D＋地形）、Google Maps key（選填）、agent server 網址（AI 模式／語音／MCP 即時；留空＝同網域）、存取碼。網址也能帶參數分享 `?ion=…&api=…&code=…`，載入後自動存起來並從網址列移除（`absorbUrlKeys()`）。runtime 值優先於 build 時的 `VITE_*`。右上 MCP 狀態在非 localhost 且沒有 server 時，點一下直接開這個對話框。server 端金鑰（OpenAI／Fish／MCP token）永遠不在這裡——見 `docs/12-hosting.md`。
