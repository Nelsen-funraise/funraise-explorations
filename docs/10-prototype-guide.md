# 10 · 原型說明：睿鏡 PeakLens（Canvas 2.5D 互動模擬）

> 位置：`prototype/`。單一 HTML、零外部函式庫、零金鑰；資料為 FUNRAISE MCP 的真實快照（2026-09-14）。它是 UX 規格與銷售腳本，不是正式版架構（正式版走 GEV fork ＋ Cesium，見 06）。

## 1. 它模擬了什麼

| GEV 核心體驗 | 原型中的對應 |
|---|---|
| 即時圖層 | 11 個圖層：商辦存量（擠出）、未來供給（幽靈建物＋完工年）、建照脈衝、都更多邊形、重劃六角、上市櫃交易菱形、企業遷徙弧線、公共建設方塊、產業園區環、商圈行情熱區、捷運路網 |
| 語音互動 | 指令列＋瀏覽器語音辨識（zh-TW，Chrome／Edge）＋可選語音回覆；18 類意圖；每次回答附「工具呼叫卡」（工具名、參數、筆數、延遲） |
| 多視角 | 俯視／環繞／街景／全台／時光；右鍵或 Shift 拖曳可自由旋轉俯仰 |
| 感測風格 | 一般／夜視／熱感／藍圖（鍵盤 1–4） |
| 五字 HUD | 左上角即時讀出：所在行政區、視野內各層數量、年份 |
| Scene director | 「▶ 導覽」：17 步 90 秒自動巡航（切鏡→飛行→查詢→街景→時光） |
| **時間軸（GEV 沒有）** | 2012–2030 滑桿：過去只留當年已存在的大樓；未來建物在完工年變實體並標 NEW |

## 2. 五個鏡（Lens）
切換鏡會改變：圖層預設、左側 KPI、建議指令、強調色。投資人鏡（MOPS、租售、收益率）、開發商鏡（都更、分區容積、建照、未來供給）、企業選址鏡（存量、租金、捷運、租戶）、城市治理鏡（公建、遷徙、都更統計、園區）、學研鏡（成交統計、時間軸）。

## 3. 可以說的話（節錄）
- 導航：「帶我去信義計畫區／內科／南軟／台北車站／富邦信義A25」「環繞模式 台北101」「街景模式看南港軟體園區」「俯視」「全台」
- 鏡與圖層：「切換投資人視角」「顯示都更」「隱藏建照」「只看上市公司交易」
- 查詢：「這裡容積率多少」「2028 年南港會長出什麼」「最近一年信義區上市公司買了什麼」「信義區有哪些都更單元」「哪些公司最近遷入信義區」「台北101 的租戶是誰」「歷史成交」「幫我做這棟的 DD memo」「簡報現在看到的」
- 比較：「比較信義基隆商圈和民生敦北商圈的租金」「比較大安區和中山區的房價」「台北市各區成交量排名」
- 時間：「回到 2015 年」「時光模式」
- 感測：「夜視」「熱感」「藍圖」「一般感測」

## 4. 資料來源與精度
- 全部來自 FUNRAISE MCP（連接器「Funraise Data Team」）：`buildings`、`urban-renewal`、`future-dev`、`taipei-licenses`、`mops-property`、`development-zones`、`industrial-parks`、`public-infras`、`areas`、`actual-price-sale`、`actual-price-rental`、`company-registry`、`key-enterprise`、`land-info`、`mrt`、`providers`。
- 座標精度以 `geo_precision` 標示：`exact`（API 直接回傳）、`address`（門牌地理編碼）、`area_centroid`（僅知商圈／行政區，示範用近似位置）。未來開發案件在來源中沒有地址，全部為 `area_centroid`——正式版以建照座標或地號邊界定位。
- 底圖：g0v／OSM（ODbL）行政區、捷運、河川、道路，簡化後內嵌。
- 面積單位：大樓總樓地板為 m²；租售單價為元／坪；MOPS 面積為坪。

## 5. 執行與擴充
```bash
cd prototype
node data/normalize.mjs   # raw/ → taipei_demo.json（引擎契約）
node build.mjs            # → dist/index.html（可直接開）與 dist/artifact.html（claude.ai Artifact 片段）
```
- `src/engine.js`：投影、相機、圖層渲染、點選。加圖層＝新增一個 `drawX()` 並在 `LAYERS` 登錄。
- `src/agent.js`：意圖、模擬 MCP 呼叫、鏡定義、導覽腳本。正式版把 `call()` 換成真實 MCP 呼叫即可，工具名與參數已對齊。
- `src/ui.js`：面板、指令列、語音、時間軸、行動版。
- 換成 Cesium：保留 `agent.js` 與 Lens 定義，把 `engine.js` 的相機動詞映射到 GEV 的 `cameraVerbs`／`locations`，圖層改用 `gods-eye-view/infrastructure` 載入同一份 JSON。

## 6. 已知限制
- 沒有相片級 3D 與真實路網細節（刻意，為了零金鑰可分享）。
- 語音辨識依賴瀏覽器；沙箱或未授權麥克風時會提示改用輸入。
- 資料為快照；正式版每層帶 `data_as_of` 與承諾更新節奏。
