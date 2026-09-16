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

## 7. 截圖（無頭 Chromium 冒煙測試自動產生 · PickPeak DS 版）

| | |
|---|---|
| ![overview](assets/v2-overview.jpg) 平衡模式：PickPeak chrome、讀數膠囊、右側圖層邊緣把手 | ![immersive](assets/v2-immersive.jpg) 沉浸模式：只留鏡、指令膠囊與字幕，面板收成邊緣把手 |
| ![annotated](assets/v2-annotated.jpg) 標註模式：亮起的交易加編號 ①–③，對應左側「地圖標註」與來源晶片 | ![pin](assets/v2-pin.jpg) 釘在地圖上：台北101 的資料卡帶引線跟著物件 |
| ![renewal](assets/v2-renewal.jpg) 「信義區有哪些都更單元」 | ![future](assets/v2-future-2028.jpg) 「2028 年南港會長出什麼」 |
| ![street](assets/v2-street.jpg) 街景：南港軟體園區 | ![thermal](assets/v2-thermal.jpg) 熱感測 |
| ![light clusters](assets/v2-light-clusters.jpg) PickPeak 日間主題：淺色底圖 + 白色量體，建物聚合成青色「N 棟」泡泡 | ![light xinyi](assets/v2-light-xinyi.jpg) 日間主題拉近信義計畫區：icon 標註（交易／執照／基建）與資料卡 |
| ![timelapse](assets/v2-timelapse.jpg) 時光機：年份 HUD、當年新增量體長高 + 脈衝 | ![renewal sim](assets/v2-renewal-sim.jpg) 智慧都更模擬：地號拼成基地 → 容積量體 + 獎勵滑桿 |
| ![dark scene](assets/v2-scene-dark.jpg) 夜間戰情室主題（保留）：投資人鏡場景，正射影像 + 玻璃量體 | |
