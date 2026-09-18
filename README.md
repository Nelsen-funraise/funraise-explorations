# 睿鏡 PeakLens · FUNRAISE 下一代 Agent Native 產品規劃

> God's Eye View 的即時上帝視角 × FUNRAISE MCP 的台灣不動產資料 × 語音 × 多視角 × 時間軸。
> 本 repo 是策略提案（繁體中文）與可互動原型；2026-09-14 由 Nelsen 委託 Claude 規劃與製作。

**線上原型（claude.ai Artifact）**：https://claude.ai/code/artifact/699569fa-bcaa-4911-bcbe-b0cf78ea9807
**本機開啟**：`prototype/dist/index.html`（單一 HTML，不需伺服器；語音辨識需 Chrome／Edge 並允許麥克風）

## 🆕 v2 · 睿鏡真實 3D 版（`app/`，CesiumJS）
God's Eye View 同款底座：**57,458 棟 OpenStreetMap 3D 建物 × 國土測繪中心正射影像**，疊上 FUNRAISE MCP 快照的 11 個圖層（商辦以真實足跡擠出、都更真實多邊形、企業遷徙弧線、規劃案隨時間軸長高），真 3D 相機（環繞／街景／俯視／全台）、GLSL 感測、5 段有旁白的電影式場景、規則式 agent 與 **Claude 模式**（官方 SDK + FUNRAISE MCP connector，**OAuth 授權自動導引、未授權時退回快照**）。HUD 套用 **PickPeak Design System**：日間／夜間雙主題、三種密度（沉浸／平衡／標註）、PickPeak 風格「N 棟」聚合圓與圖層 icon、面板自動淡出、地圖編號標註、卡片釘選、右鍵旋轉俯仰 + 方向盤。**Fish Audio 語音**（Nelsen／Eunice／台灣腔女生，場景旁白預錄、等講完再換句）。**智慧都更模擬**：地號 + 使用分區容積 + 建照套繪 → 可建量體與獎勵滑桿。不需要任何 API key 就能跑。 另有 **日照陰影**（真實太陽位置、播放一天）、**hover 資料小卡**、**可分享的視角連結**。 底圖可換 CARTO／Esri 深淺色設計底圖，時間軸 2014–2025 自動換國土測繪中心該年航照；右欄可疊段籍界、建物框、公有土地、土壤液化等免金鑰疊圖；河川為波紋水面、夜間道路光帶。 Phase 7 再加上：**夜景窗燈**（5.7 萬棟量體的程序化立面）、**日照陰影**（真實太陽、播放一天）、**捷運等時圈**（內建路網計算）、**企業遷徙動線**、**對焦／X-ray**、**樓層視角**（第一人稱站上 N 樓）、**量測與畫基地→容積試算**、**展示模式**、**開場定軌鏡頭**、**分享視角連結**。免金鑰資料源盤點與申請清單見 `docs/11-v2-cesium-app.md` §13。

```bash
cd app && npm ci && npm run dev        # http://localhost:5173
npm run server                          # 選配：AI agent server（OpenAI 或 Anthropic 金鑰、氣象／AQI／TDX／ORS 金鑰都貼在 http://localhost:8790/setup）
# Mac：Finder 進 app/ 雙擊 PeakLens.command 即可（自動安裝、建置、啟動並開設定頁）
```
- 線上版（GitHub Pages，需在 repo Settings → Pages 選 GitHub Actions 後由 `main` 自動部署）：https://nelsen-funraise.github.io/funraise-explorations/
- 說明、架構、資料授權與 **給 Mike 的 8 分鐘 demo 腳本**：[`docs/11-v2-cesium-app.md`](docs/11-v2-cesium-app.md)；金鑰怎麼放（§14）、Mac／純網頁／自架 server 評估（§15）、**視圖語法與合成規則**（§16–17：尺度預算、Look 預設、說明模式、快照優先的 agent、價值時光機、台北101 分段量體）

![v2 overview](docs/assets/v2-overview.jpg)

## 先讀這三份
1. [`docs/00-executive-summary.md`](docs/00-executive-summary.md) — 一頁結論與本季三件事
2. [`docs/03-product-concepts.md`](docs/03-product-concepts.md) — 12 個概念與打分排序
3. [`docs/07-roadmap.md`](docs/07-roadmap.md) — 0→24 個月路線圖與停損條件

## 線上版（同仁／訪客直接開）

- 前端：<https://nelsen-funraise.github.io/funraise-explorations/>（GitHub Pages，`main` 一推就自動部署）。右上 **▶ 場景** 有六個內建場景（含「地政巡禮 · 從地籍到城市」），對話框直接說「播放地政場景」也行。
- 金鑰：右上 **🔑 金鑰** 可以貼 Cesium ion token（實景 3D）、agent server 網址與存取碼，只存在自己的瀏覽器；也可以用網址帶參數 `?ion=…&api=…&code=…` 分享。
- AI 模式／語音／FUNRAISE MCP 即時資料需要 agent server：一鍵放上 Vercel 的步驟與環境變數表見 [`docs/12-hosting.md`](docs/12-hosting.md)。

## 文件地圖
| # | 文件 | 內容 |
|---|---|---|
| 00 | [執行摘要](docs/00-executive-summary.md) | 結論、怎麼賣、怎麼做、風險 |
| 01 | [脈絡](docs/01-context.md) | FUNRAISE 現況、MCP 資料資產、GEV 證明了什麼、台灣競局 |
| 02 | [願景](docs/02-vision.md) | Agent Native 的定義、三個設計原則、GEV→睿鏡對照 |
| 03 | [產品概念](docs/03-product-concepts.md) | 12 個概念、四維打分、組合拳 |
| 04 | [五鏡與客群](docs/04-lenses-and-customers.md) | 投資人／開發商／企業選址／城市治理／學研 |
| 05 | [商業模式與 GTM](docs/05-business-model-and-gtm.md) | 五條收入線、四波進入市場、指標 |
| 06 | [架構](docs/06-architecture.md) | GEV fork、MCP、Taiwan Live MCP、Agent 運行時、3D 底圖策略 |
| 07 | [路線圖](docs/07-roadmap.md) | 階段 0–4、里程碑、團隊預算、與現有產品關係 |
| 08 | [風險倫理合規](docs/08-risks-ethics-compliance.md) | 風險矩陣、倫理邊界、授權清單、個資 |
| 09 | [學界與政府](docs/09-academia-and-government.md) | 政大／台大／北大方案、補助與試點 |
| 10 | [原型說明](docs/10-prototype-guide.md) | 原型模擬了什麼、可以說的話、如何擴充成 Cesium 版 |
| 11 | [v2 真實 3D 版](docs/11-v2-cesium-app.md) | CesiumJS 架構、資料與授權、Claude 模式、給 Mike 的 demo 腳本 |
| A | [資料盤點](docs/appendix-a-data-inventory.md) | FUNRAISE MCP 工具與規模 |
| B | [來源](docs/appendix-b-sources.md) | 內部／公開來源與未確認事項 |

## v2 應用（`app/`）
```
app/
  src/            main.js（boot）· viewer.js（Cesium + 底圖）· camera.js · sensors.js · time.js · ui.js · scenes.js
  src/layers/     osmBuildings.js（OSM 3D 建物）· funraise.js（11 個 FUNRAISE 圖層）
  src/agent/      agent.js（規則式）· claudeClient.js（Claude 模式前端）
  server/         index.mjs（Node：/api/health、/api/agent；@anthropic-ai/sdk + MCP connector；可服務 dist/）
  data/           build.mjs（快照 + 地理編碼 + 都更多邊形 → public/data/peaklens.json）· raw/
  public/data/    peaklens.json · taipei_basemap.json · osm_buildings_taipei.json（ODbL）· osm_landmarks.json
  scripts/        smoke.mjs（無頭 Chromium 冒煙測試 + 截圖）
```

## 原型 v1（`prototype/`）
```
prototype/
  src/            engine.js（Canvas 2.5D 引擎）· agent.js（意圖與模擬 MCP 呼叫）· ui.js · style.css · index.template.html
  data/           normalize.mjs（raw → 引擎契約）· taipei_demo.json（FUNRAISE MCP 快照）· taipei_basemap.json（OSM／g0v 底圖）· raw/
  build.mjs       內嵌成單檔 → dist/index.html、dist/artifact.html
```
```bash
cd prototype && node data/normalize.mjs && node build.mjs
```
試著說：「帶我去信義計畫區」「切換開發商視角」「信義區有哪些都更單元」「這裡容積率多少」「2028 年南港會長出什麼」「最近一年信義區上市公司買了什麼」「哪些公司最近遷入信義區」「環繞模式」「時光模式」，或按「▶ 導覽」。

## 資料與授權
- 原型資料為 FUNRAISE MCP（連接器「Funraise Data Team」）2026-09-14 快照，僅供內部示範；座標精度以 `geo_precision` 標示（未來開發案為商圈近似位置）。
- 底圖：g0v（CC BY 4.0）／OpenStreetMap（ODbL）／國土測繪中心 WMTS（政府資料開放授權）。GEV 程式碼 MIT（資料另計，海纜資料 CC BY-NC-SA 不可商用）。
- 本 repo 文件為方睿科技內部策略草稿。
