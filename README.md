# 睿鏡 PeakLens · FUNRAISE 下一代 Agent Native 產品規劃

> God's Eye View 的即時上帝視角 × FUNRAISE MCP 的台灣不動產資料 × 語音 × 多視角 × 時間軸。
> 本 repo 是策略提案（繁體中文）與可互動原型；2026-09-14 由 Nelsen 委託 Claude 規劃與製作。

**線上原型（claude.ai Artifact）**：https://claude.ai/code/artifact/699569fa-bcaa-4911-bcbe-b0cf78ea9807
**本機開啟**：`prototype/dist/index.html`（單一 HTML，不需伺服器；語音辨識需 Chrome／Edge 並允許麥克風）

## 先讀這三份
1. [`docs/00-executive-summary.md`](docs/00-executive-summary.md) — 一頁結論與本季三件事
2. [`docs/03-product-concepts.md`](docs/03-product-concepts.md) — 12 個概念與打分排序
3. [`docs/07-roadmap.md`](docs/07-roadmap.md) — 0→24 個月路線圖與停損條件

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
| A | [資料盤點](docs/appendix-a-data-inventory.md) | FUNRAISE MCP 工具與規模 |
| B | [來源](docs/appendix-b-sources.md) | 內部／公開來源與未確認事項 |

## 原型（`prototype/`）
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
- 底圖：g0v／OpenStreetMap（ODbL）。GEV 程式碼 MIT（資料另計）。
- 本 repo 文件為方睿科技內部策略草稿。
