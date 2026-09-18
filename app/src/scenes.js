// Cinematic scene director (GEV-style): narrated camera scripts over real FUNRAISE layers.
// Phase 9F: a step's `text` may be a function `(ctx) => string` so narration can read live numbers (timeseries
// city/district stats, mops counts, quarterly rent) instead of hard-coding them.
// Phase 10Q (docs/11-v2-cesium-app.md §18.2 場景導演 2.0) — three owner complaints this rewrite answers:
//   1. 「場景中地圖上的虛線或區塊highlight都不夠明顯」→ each step may declare `stage`: Look/density/layers/keys/emphasis/
//      lens. play() snapshots the user's state on entry and restores it on stop/end; per step it enforces `stage`
//      through the public APIs, fades layers the step doesn't care about to 20% and hands `keys` to
//      map.explain.enter() (framed + numbered) AND map.stage.emphasize() (thicker/glowing/pulsing) — see fx/stage.js.
//   2. 「語音跟動畫沒對齊」→ steps may add `beats: [{at, run}]`, fired once when narration progress frac ≥ at (the
//      legacy bare `run` is still exactly "the beat at 0"). A step no longer ends on a fixed `hold`; it ends when the
//      (measured or estimated) narration duration has elapsed AND every due beat has resolved, +≤600ms settle.
//   3. 「場景字幕框和AI對話框互相干擾」→ narration now flows through ui.speak()/ui.cine(), which route to the single
//      #voicebar (src/ui/voicebar.js) instead of the old separate #cinebar/#caption.
const wait = ms => new Promise(r => setTimeout(r, ms));
const LAND_UNIT = 'urf04f7256b2128'; // 信義區公辦都更「兒福B1-2及B3-2」：快照 parcels.units 裡有地號／使用分區／建照套繪的單元之一（地政場景第 4 段）
export const SCENES = [
  { id: 'investor', title: '資本流向 · 投資人巡航', sub: '上市櫃資產交易 × 商圈行情 × 台北101 環繞', steps: [
    { text: (c) => { const areas = (c.data.business_areas || []).filter(a => ((a.self_series && a.self_series.rent) || a.rent_series || []).length);
        let best = null; for (const a of areas) { const arr = (a.self_series && a.self_series.rent) || a.rent_series || []; const last = arr[arr.length - 1]; if (last && (!best || (last.year * 4 + last.quarter) > (best.q.year * 4 + best.q.quarter))) best = { a, q: last }; }
        const n = (c.data.mops || []).length;
        return best ? `這是台北。${best.q.year} 年第 ${best.q.quarter} 季，${(best.a.name || '').replace(/^台北市|^臺北市/, '')}平均租金約 ${Math.round(best.q.value).toLocaleString('zh-TW')} 元/坪；過去十二個月，上市櫃公司在這座城市公告了 ${n} 筆不動產取得與處分。` : `這是台北。過去十二個月，上市櫃公司在這座城市公告了幾十筆不動產取得與處分。`; },
      stage: (c) => { const areas = (c.data.business_areas || []).filter(a => ((a.self_series && a.self_series.rent) || a.rent_series || []).length);
        let best = null; for (const a of areas) { const arr = (a.self_series && a.self_series.rent) || a.rent_series || []; const last = arr[arr.length - 1]; if (last && (!best || (last.year * 4 + last.quarter) > (best.q.year * 4 + best.q.quarter))) best = { a, q: last }; }
        return { lens: 'investor', look: 'golden', density: 'immersive', keys: best ? ['heat:' + best.a.id] : [] }; },
      run: async (c) => { c.map.setYear(2026); c.map.flyTo(121.561, 25.047, { range: 5400, pitch: -46, heading: 15 }); } },
    { text: '每一個橘色光點就是一筆公告：大小代表金額，來源是公開資訊觀測站，經 FUNRAISE 結構化解析。',
      stage: { keys: ['mops:2501-1150911-1', 'mops:2534-1150806-1', 'mops:5880-1150831-1', 'mops:9940-1150812-1', 'mops:8926-1150807-1'] },
      run: async (c) => { (c.data.mops || []).forEach(m => c.map.pulse('mops:' + m.id, 9000)); c.map.flyTo(121.560, 25.040, { range: 7000, pitch: -50, heading: 25 }); } },
    { text: '信義計畫區：安泰銀以 4.8 億取得台北101 使用權資產；富邦金控家族在遼寧街與基隆路之間調度樓層。',
      stage: { keys: ['mops:2849-1150820-3', 'stock:bud84cd402', 'mops:2881-1150806-1'] },
      run: async (c) => { c.map.orbit(121.5645, 25.0339, 900, -30); } },
    { text: '把鏡頭拉到南港：雲豹能源進駐台灣人壽南港大樓 3.1 億、宜鼎處分忠孝東路商辦 1.68 億。資本正在往東流。',
      stage: { keys: ['mops:6869-1150811-3', 'mops:5289-1150821-2', 'stock:bud68af5ef'] },
      run: async (c) => { c.map.flyTo(121.612, 25.056, { range: 2600, pitch: -38, heading: -30 }); } },
    { text: '這就是投資人鏡：每一筆交易都能回溯到一個 MCP 工具呼叫與資料期間。', stage: { keys: [] },
      run: async (c) => { c.map.flyTo(121.560, 25.045, { range: 9000, pitch: -60, heading: 0 }); } },
  ] },
  { id: 'developer', title: '供給雷達 · 開發商鏡', sub: '建照脈衝 × 都更多邊形 × 2026→2030 幽靈建物長高', steps: [
    { text: '開發商最想知道的是：接下來三年，誰在哪裡蓋什麼。', stage: { lens: 'developer', keys: [] },
      run: async (c) => { c.map.setYear(2026); c.map.flyTo(121.575, 25.045, { range: 11000, pitch: -58, heading: 0 }); } },
    { text: '青色脈衝是臺北市 114、115 年建照：起造人雖被遮罩，但地址、設計人與開工時序都在。這是新供給最早的訊號。',
      stage: { keys: ['license:114建字第0159號', 'license:114建字第0112號', 'license:114建字第0155號', 'license:115建字第0030號', 'license:115建字第0072號', 'license:114建字第0036號'] },
      run: async (c) => { (c.data.building_licenses || []).forEach(l => c.map.pulse('license:' + l.license_number, 9000)); } },
    { text: '紫色多邊形是都更單元：政府主導與已核定事業。臺北機廠 20 公頃、華山行政專區 5.4 公頃、南港高鐵站區生技產業 7.2 公頃。',
      stage: { keys: ['renewal:urf3f49e1cd8ac4', 'renewal:urf25aab955ea3f', 'renewal:urf69264244e97f'] },
      run: async (c) => { (c.data.urban_renewal || []).forEach(u => c.map.pulse('renewal:' + u.id, 9000)); c.map.flyTo(121.561, 25.047, { range: 4200, pitch: -48, heading: 20 }); } },
    { text: '現在把時間往前推。南港：南港之星、HCBD、調車場公辦都更；信義：南山 A21、A26、四季酒店。看它們長出來。',
      stage: { keys: ['future:fdf3859e5', 'future:fde23aebc', 'future:fda667c9d', 'future:fd29f4415', 'future:fdca95752', 'future:fd68f53199'] },
      beats: [
        { at: 0, run: async (c) => { c.map.flyTo(121.598, 25.050, { range: 5200, pitch: -40, heading: -20 }); } },
        { at: 0.22, run: async (c) => { c.timeline.startLapse({ from: 2026, to: 2030, durationMs: Math.max(6000, Math.round((c.stepMs || 9000) * 0.72)) }); } },
      ] },
    { text: '2030 年的天際線，今天就能看見。這是 God\'s Eye View 沒有、而 FUNRAISE 有的東西：未來。',
      stage: { keys: ['future:fdf3859e5', 'future:fde23aebc', 'future:fda667c9d', 'future:fd29f4415', 'future:fdca95752', 'future:fd68f53199'] },
      run: async (c) => { c.map.orbit(121.601, 25.052, 2200, -32); } },
  ] },
  { id: 'occupier', title: '企業選址 · 內科到南軟', sub: '商辦等級 × 捷運 × 租戶 × 街景', steps: [
    { text: '企業選址鏡是 PickPeak 的核心：CFO 要的是三個可比較的方案。', stage: { lens: 'occupier', keys: [] },
      run: async (c) => { c.map.setYear(new Date().getFullYear()); c.map.flyTo(121.576, 25.077, { range: 4200, pitch: -48, heading: 0 }); } },
    { text: '內湖科技園區：綠色是廠辦，輝達、鴻海、BENQ 的總部都在這一區；金色是 A 級商辦。',
      stage: { keys: ['stock:budbe17c02', 'stock:bud148154a', 'stock:bude0e045f'] },
      run: async (c) => { (c.data.buildings || []).filter(b => (b.district || '').includes('內湖')).forEach(b => c.map.pulse('stock:' + b.id, 8000)); } },
    { text: '走到街上看：台北企業總部園區三棟 16 層 LEED 白金級，是 OSM 樓高與 FUNRAISE 屋齡、認證、租金資料疊在一起的結果。',
      stage: { keys: ['stock:bud8d8b7be', 'stock:bud2f2df91', 'stock:bud673a23e'] },
      run: async (c) => { c.map.street(121.5878, 25.0592); } },
    { text: '沿藍線往東，南港經貿園區：中國信託金融大樓、台灣人壽南港大樓，捷運 200 公尺內。',
      stage: { keys: ['stock:budfe58ee7', 'stock:bud68af5ef'] },
      run: async (c) => { c.map.flyTo(121.614, 25.057, { range: 1800, pitch: -35, heading: 40 }); } },
    { text: '選好三棟，就能直接產出選址提案與搬遷計畫，交給 39 家生態系夥伴。', stage: { keys: [] },
      run: async (c) => { c.map.flyTo(121.585, 25.062, { range: 9000, pitch: -60, heading: 0 }); } },
  ] },
  { id: 'city', title: '城市治理 · 首長戰情室', sub: '興建中公共建設 × 企業遷徙 × 都更統計', steps: [
    { text: '換到城市治理鏡：局處與首長關心的是建設、產業、更新三件事。', stage: { lens: 'city', keys: [] },
      run: async (c) => { c.map.flyTo(121.560, 25.055, { range: 16000, pitch: -62, heading: 0 }); } },
    { text: '藍色虛線是興建中的捷運：環狀線東環段、信義線東延段、汐東捷運；劍潭、士林、劍南路站 TOD 開發同步啟動。',
      stage: { keys: ['infra:puif07f205e', 'infra:puif87a7cf9', 'infra:puifbd997f7', 'mrt:劍潭', 'mrt:士林', 'mrt:劍南路'] },
      run: async (c) => { c.map.flyTo(121.575, 25.060, { range: 12000, pitch: -55, heading: 15 }); } },
    { text: '橘色弧線是 2026 年 7 月遷入台北各區的公司：從新北、桃園、台中、金門飛進中山、大安、內湖、南港。',
      stage: { keys: ['move:22318678', 'move:60490694', 'move:83475615', 'move:82967042', 'move:96849469'] },
      run: async (c) => { (c.data.registry_moves || []).forEach(m => c.map.pulse('move:' + m.uniform_number, 9000)); c.map.flyTo(121.545, 25.052, { range: 9000, pitch: -45, heading: -10 }); } },
    { text: '都更統計：台北市 2,300 多個更新地區與單元，中山區最多。政府主導的案子用亮紫色標示。',
      stage: { keys: ['renewal:urf6de52b1ec29b', 'renewal:urf411550f5cfa6', 'renewal:urf249d81305d66'] },
      run: async (c) => { c.map.flyTo(121.535, 25.055, { range: 6000, pitch: -52, heading: 0 }); } },
    { text: '同一張地圖，換一個鏡，就是另一份簡報。', stage: { keys: [] },
      run: async (c) => { c.map.flyTo(121.548, 25.047, { range: 15000, pitch: -62, heading: 0 }); } },
  ] },
  // Phase 11A 地政巡禮（docs/11-v2-cesium-app.md §20.1）：給地政單位長官看的場景 —— 段籍界／公有土地疊圖 → 73 處重劃與區段徵收
  // → 公辦都更單元的地號、使用分區、容積率與智慧都更模擬 → 歷年正射影像 2014→2025 → 實價登錄 12 區價值面 2012→2026。
  // 開場／收尾在有金鑰時用實景（Google 相片級 3D Tiles）；中段一律切到日照 Look（正射影像底圖＋白模），因為 NLSC WMTS
  // 疊圖畫在地球影像層上，實景 tileset 蓋著看不到（compose.js enterPhotoreal 也會主動關掉疊圖）。旁白數字全部從快照／
  // timeseries 現算，不寫死。
  { id: 'land', title: '地政巡禮 · 從地籍到城市', sub: '段籍界 × 公有土地 × 重劃區段徵收 × 都更地號模擬 × 歷年航照 × 實價登錄價值面', steps: [
    { text: (c) => `歡迎地政局的長官。這是台北的上帝視角：真實的 3D 城市，疊上地政資料。地籍圖、使用分區、建照套繪、實價登錄，${c.map.photoreal && c.map.photoreal.available ? '底下這一層是 Google 相片級 3D 實景，' : ''}全部在同一個畫面裡回答問題。`,
      stage: (c) => ({ lens: 'city', look: c.map.photoreal && c.map.photoreal.available ? 'photoreal' : 'sun', density: 'immersive', layers: { show: ['renewal', 'zones', 'licenses'], hide: ['stock', 'mops', 'moves', 'heat', 'parks', 'future', 'tm', 'parcels'] }, keys: [] }),
      run: async (c) => { c.map.setYear(new Date().getFullYear()); c.map.flyTo(121.5645, 25.0339, { range: 5200, pitch: -48, heading: 20 }); } },
    { text: '先把國土測繪中心的段籍界與公有土地地籍，直接疊在 3D 城市上：每一條地段界線、每一塊公有地，都在它真正的位置，不用再對圖。',
      stage: { look: 'sun', layers: { show: ['renewal'] }, keys: [] },
      run: async (c) => { c.ui.setOverlay('landsect', true); c.ui.setOverlay('publicland', true); c.map.flyTo(121.5665, 25.031, { range: 1500, pitch: -62, heading: 20 }); } },
    { text: (c) => { const z = c.data.development_zones || []; const n1 = z.filter(x => x.category === '市地重劃').length, n2 = z.filter(x => x.category === '區段徵收').length;
        return `拉高到全市：臺北市 ${z.length} 處市地重劃與區段徵收，${n1} 處市地重劃、${n2} 處區段徵收。南港經貿園區、基隆河成美橋到南湖大橋段、新隆里，都是區段徵收辦理完成的案子。`; },
      stage: { lens: 'city', look: 'sun', layers: { show: ['zones'] }, keys: ['zone:TUW2244651796', 'zone:SGI2244638699', 'zone:HCF2244516339'] },
      run: async (c) => { c.ui.setOverlay('landsect', false); c.ui.setOverlay('publicland', false); (c.data.development_zones || []).forEach(z => c.map.pulse('zone:' + z.id, 9000)); c.map.flyTo(121.565, 25.055, { range: 15000, pitch: -62, heading: 0 }); } },
    { text: (c) => { const st = (c.data.urban_renewal_stats && c.data.urban_renewal_stats.by_district) || []; const total = st.reduce((s, d) => s + (d.count || 0), 0); const top = st.slice().sort((a, b) => (b.count || 0) - (a.count || 0))[0];
        const u = (c.data.urban_renewal || []).find(x => x.id === LAND_UNIT); const pd = c.data.parcels && c.data.parcels.units ? c.data.parcels.units[LAND_UNIT] : null; const n = pd ? (pd.parcels || []).length : 0; const zn = pd && pd.zoning && pd.zoning[0];
        const far = zn && zn.far_decimal ? `容積率 ${Math.round(zn.far_decimal * 100)}%` : '', bcr = zn && zn.bcr_decimal ? `建蔽率 ${Math.round(zn.bcr_decimal * 100)}%` : '';
        return `都更是地政與都發的交會點：臺北市 ${total.toLocaleString('zh-TW')} 處更新地區與單元${top ? `，${top.district}最多、${top.count} 處` : ''}。走進信義區公辦都更「${u ? u.name : '兒福B1-2及B3-2'}」：${n} 筆地號、${zn ? zn.zone_name : '第三種住宅區'}${far ? '，' + far : ''}${bcr ? '、' + bcr : ''}，套上 30% 容積獎勵，可建量體直接長出來。`; },
      stage: { look: 'sun', density: 'balanced', layers: { show: ['renewal', 'parcels'] }, keys: ['renewal:' + LAND_UNIT] },
      run: async (c) => { const u = (c.data.urban_renewal || []).find(x => x.id === LAND_UNIT); c.ui.setOverlay('landsect', true); if (u && c.ui.simulateRenewal) c.ui.simulateRenewal(u, { bonus: 0.3 }); else c.map.flyTo(121.5708, 25.0424, { range: 900, pitch: -42, heading: 10 }); } },
    { text: '同一塊地、十二年的變化。這是國土測繪中心 2014 到 2025 年的歷年正射影像，跟著時間軸自動換年份：南港經貿園區從區段徵收完成，到今天的天際線。',
      stage: { look: 'sun', density: 'immersive', layers: { show: ['zones', 'future'] }, keys: ['zone:TUW2244651796'], emphasis: 1 },
      beats: [
        { at: 0, run: async (c) => { c.ui.clearSim && c.ui.clearSim(); c.ui.setOverlay('landsect', false); c.ui.setOverlay('publicland', false); c.map.setYear(2014); c.map.flyTo(121.6177, 25.0619, { range: 1700, pitch: -58, heading: -25 }); } },
        { at: 0.12, run: async (c) => { c.timeline.startLapse({ from: 2014, to: 2025, durationMs: Math.max(8000, Math.round((c.stepMs || 12000) * 0.85)) }); } },
      ] },
    { text: (c) => { const tm = c.map.timemachine; let peak = null, last = null; if (tm && tm.cityStats) { for (let y = 2012; y <= 2026; y++) { const s = tm.cityStats(y); if (!s || !s.salesAll) continue; if (!s.ytd && (!peak || s.salesAll > peak.salesAll)) peak = s; last = s; } }
        return `最後是地政局最重要的資料：實價登錄。12 個行政區、2012 到 2026 年，每一年的成交量長成一面：藍色年增、橘色年減，高度就是當年的量。${peak ? `${peak.year} 年 ${peak.salesAll.toLocaleString('zh-TW')} 件是高點` : ''}${last && last.ytd ? `，${last.year} 年到目前 ${last.salesAll.toLocaleString('zh-TW')} 件` : ''}。同一面牆也能切成商辦成交或建照。`; },
      stage: (c) => { const tm = c.map.timemachine; const top = tm && tm.topMover ? tm.topMover(2020) : null; return { lens: 'research', look: 'sun', density: 'immersive', layers: { show: ['tm'] }, keys: top ? ['tm:' + top.name] : [] }; },
      beats: [
        { at: 0, run: async (c) => { c.map.timemachine && c.map.timemachine.setMetric('sales_all'); c.map.setYear(2012); c.map.flyTo(121.56, 25.05, { range: 16000, pitch: -74, heading: 15 }); } },
        { at: 0.12, run: async (c) => { c.timeline.startLapse({ from: 2012, to: 2026, durationMs: Math.max(9000, Math.round((c.stepMs || 12000) * 0.85)) }); } },
      ] },
    { text: '地籍、分區、建照、都更、實價登錄，本來就是這座城市的骨架。睿鏡把它們放回真實的 3D 台北，讓每一個決策都看得見。歡迎現場直接問它，用說的就行。',
      stage: (c) => ({ look: c.map.photoreal && c.map.photoreal.available ? 'photoreal' : 'sun', layers: { show: ['renewal', 'zones'] }, keys: [] }),
      run: async (c) => { c.map.setYear(new Date().getFullYear()); c.map.orbit(121.5645, 25.0339, 3200, -40, 0.03); } },
  ] },
  { id: 'time', title: '時光 · 2012 → 2030', sub: '過去與未來同框 × 12 區價值面', steps: [
    { text: '最後，把時間軸整個播一遍：2012 到 2030 年。這次不只是大樓一棟一棟長出來——先看整個台北市 12 個行政區的價值面怎麼隨時間起伏。',
      stage: { lens: 'research', layers: { show: ['tm', 'future'] }, keys: [] },
      run: async (c) => { c.map.timemachine && c.map.timemachine.setMetric('sales_all'); c.map.setYear(2012); c.map.flyTo(121.560, 25.050, { range: 16000, pitch: -74, heading: 15 }); } },
    { text: (c) => { const tm = c.map.timemachine; const top = tm && tm.topMover ? tm.topMover(2019) : null; const label = tm ? tm.metricLabel(tm.metric) : '成交件數';
        return top && top.yoyPct != null ? `藍色代表${label}年增、橘色代表年減，灰色持平；高度就是當年的量。${top.name} 這幾年變化最大，來到 ${top.yoyPct > 0 ? '▲' : '▼'}${Math.abs(Math.round(top.yoyPct * 100))}%。` : `藍色代表成交量年增、橘色代表年減，灰色持平；高度就是當年的量——12 個區一起長高、一起變色。`; },
      stage: (c) => { const tm = c.map.timemachine; const top = tm && tm.topMover ? tm.topMover(2019) : null; return { keys: top ? ['tm:' + top.name] : [] }; },
      run: async (c) => { c.timeline.startLapse({ from: 2012, to: 2019, durationMs: Math.max(6000, c.stepMs || 10000) }); c.map.orbit(121.560, 25.050, 16000, -72, 0.02); } },
    { text: (c) => { const mopsN = (c.data.mops || []).filter(m => m.district === '信義區').length; return `拉近到信義計畫區：年份往前跳的時候，這一區的量體會跟著閃一下，當年的上市櫃公告會冒出金額標籤——信義區累積 ${mopsN} 筆上市櫃資產交易。同時繼續看大樓長出來：新完工的會有一根光柱標出樓層數。`; },
      stage: { keys: ['tm:信義區', 'mops:2849-1150820-3', 'mops:7826-1150812-1'] },
      beats: [
        { at: 0, run: async (c) => { const xy = (c.map.districtCentroid && c.map.districtCentroid('信義區')) || [121.5645, 25.0339]; c.map.flyTo(xy[0], xy[1], { range: 5200, pitch: -46, heading: 20 }); } },
        { at: 0.15, run: async (c) => { c.timeline.startLapse({ from: 2019, to: 2026, durationMs: Math.max(6000, Math.round((c.stepMs || 12000) * 0.8)) }); } },
      ] },
    { text: (c) => { const n = (c.data.future_dev || []).filter(f => f.district === '南港區').length; return `2026 年之後，價值面沒有實際資料可以畫了——但南港的供給 pipeline 看得到：${n} 個規劃中／興建中案，未來四年會陸續完工，幽靈量體逐年長高。`; },
      stage: { keys: ['future:fdf3859e5', 'future:fde23aebc', 'future:fda667c9d'] },
      beats: [
        { at: 0, run: async (c) => { const ng = (c.map.districtCentroid && c.map.districtCentroid('南港區')) || [121.610, 25.055]; c.map.flyTo(ng[0], ng[1], { range: 1500, pitch: -40, heading: -20 }); } },
        { at: 0.15, run: async (c) => { c.timeline.startLapse({ from: 2026, to: 2030, durationMs: Math.max(6000, Math.round((c.stepMs || 12000) * 0.8)) }); } },
      ] },
    { text: 'God\'s Eye View 只做出了「現在」。睿鏡把「過去」和「未來」也放進同一個畫面——這就是價值時光機。', stage: { keys: [] },
      run: async (c) => { c.map.flyTo(121.548, 25.047, { range: 16000, pitch: -60, heading: 0 }); } },
  ] },
];

/* ---- Phase 11A agent 導演（§20.1）：把 agent 工具 play_script 給的 steps 編成 SceneDirector 吃的場景物件 ----
 * 老闆的痛點：「agent 一次只會跳去一個地方開關圖層，沒有像我們腳本安排那麼細緻」。play_script 讓模型一次交出 4–7 段
 * {text, place|lon/lat, range, pitch, heading, mode, look, lens, layers, keys, overlays, year, lapse, simulate_renewal}，
 * 這裡逐段驗證（圖層鍵、物件 key 必須真的存在；photoreal 沒金鑰退成 sun；數值夾在安全範圍）並翻成 stage + beats，
 * 之後和內建場景走完全相同的播放路徑（舞台接管、旁白節拍、暫停／恢復、結束還原）。純函式，便於 smoke 直接測。 */
const SCRIPT_OVERLAYS = ['landsect', 'publicland', 'buildx', 'liquefaction', 'road'];
const SCRIPT_LOOKS = ['photoreal', 'sun', 'golden', 'night', 'white'], SCRIPT_LENSES = ['investor', 'developer', 'occupier', 'city', 'research'];
const clampNum = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const clampYear = (y) => clampNum(y, 2012, 2030, 2026);
function findUnit(data, ref) { const s = String(ref || '').trim(); if (!s) return null; const arr = (data && data.urban_renewal) || []; return arr.find(u => u.id === s) || arr.find(u => (u.name || '') === s) || arr.find(u => (u.name || '').includes(s)) || null; }
export function compileScript(input, ctx) {
  const { map, agent, data } = ctx || {}; const src = input || {};
  const rawSteps = Array.isArray(src.steps) ? src.steps.slice(0, 9) : [];
  const layerKeys = (map && map.layerKeys) || []; const dropped = [];
  const steps = rawSteps.map((s, i) => {
    s = s && typeof s === 'object' ? s : {};
    const text = String(s.text || '').trim().slice(0, 400);
    const stage = { keys: [] };
    if (SCRIPT_LENSES.includes(s.lens)) stage.lens = s.lens;
    if (SCRIPT_LOOKS.includes(s.look)) stage.look = (s.look === 'photoreal' && !(map && map.photoreal && map.photoreal.available)) ? 'sun' : s.look;
    if (s.layers && typeof s.layers === 'object') { const pick = a => (Array.isArray(a) ? a : []).filter(k => layerKeys.includes(k)); const show = pick(s.layers.show), hide = pick(s.layers.hide); if (show.length || hide.length) stage.layers = { show, hide }; }
    for (const k of (Array.isArray(s.keys) ? s.keys : []).slice(0, 12)) { if (typeof k !== 'string') continue; if (map && map.entityByKey && map.entityByKey(k)) { if (stage.keys.length < 6) stage.keys.push(k); } else dropped.push(k); }
    const simUnit = s.simulate_renewal ? findUnit(data || (map && map.data), s.simulate_renewal) : null; if (s.simulate_renewal && !simUnit) dropped.push('renewal:' + s.simulate_renewal);
    stage.density = simUnit ? 'balanced' : (i === 0 ? 'immersive' : undefined); // 第一段進沉浸（電影框），都更模擬那段要看到左側模擬卡
    if (!stage.density) delete stage.density;
    const overlays = (Array.isArray(s.overlays) ? s.overlays : []).filter(k => SCRIPT_OVERLAYS.includes(k));
    const beats = [{ at: 0, run: async (c) => {
      if (c.ui.setOverlay) for (const k of SCRIPT_OVERLAYS) c.ui.setOverlay(k, overlays.includes(k)); // 每段自己宣告要疊的；沒宣告＝全關（跟內建場景一樣乾淨）
      if (s.year != null) c.map.setYear(clampYear(s.year));
      if (simUnit && c.ui.simulateRenewal) { c.ui.simulateRenewal(simUnit, { bonus: clampNum(s.bonus, 0, 0.5, 0.3) }); return; } // simulateRenewal 自己會飛過去
      const p = s.place && agent && agent.resolvePlace ? agent.resolvePlace(String(s.place)) : null;
      const lon = Number.isFinite(+s.lon) ? +s.lon : (p && p.lon), lat = Number.isFinite(+s.lat) ? +s.lat : (p && p.lat);
      if (lon == null || lat == null) return; // 沒給地點也解析不到：鏡頭不動，只換舞台與旁白
      const range = clampNum(s.range, 150, 60000, (p && p.range) || 1500), pitch = clampNum(s.pitch, -89, -5, -45), heading = Number.isFinite(+s.heading) ? +s.heading : null;
      if (s.mode === 'orbit') c.map.orbit(lon, lat, range, pitch); else if (s.mode === 'street') c.map.street(lon, lat); else c.map.flyTo(lon, lat, { range, pitch, heading });
    } }];
    if (s.lapse && typeof s.lapse === 'object' && s.lapse.from != null && s.lapse.to != null) beats.push({ at: 0.12, run: async (c) => { c.timeline.startLapse({ from: clampYear(s.lapse.from), to: clampYear(s.lapse.to), durationMs: Math.max(6000, Math.round((c.stepMs || 10000) * 0.8)) }); } });
    return { text, stage, beats, place: s.place || null };
  }).filter(st => st.text);
  return { id: 'script:' + Date.now().toString(36), title: String(src.title || '自訂導覽').trim().slice(0, 40) || '自訂導覽', sub: String(src.sub || '').trim().slice(0, 80), steps, custom: true, dropped };
}

export class SceneDirector {
  constructor(ctx) { this.c = ctx; this.playing = null; this.paused = false; this.stopFlag = false; this.stepIndex = 0; this._snapshot = null; this._resumeFn = null; this._torndown = true; this._token = 0; }

  /* ---- state the scene borrows from the user (§18.2 舞台接管): look/density/visible layers/year/lens/camera ---- */
  _snapshotState() {
    const { map, ui, agent } = this.c;
    let camera = null; try { const p = map.center(); camera = { lon: p.lon, lat: p.lat, height: p.height, heading: map.heading, pitch: map.pitch }; } catch { /* not ready */ }
    return { look: map.compose ? map.compose.look : null, density: ui.density, layers: ui.visibleLayers ? ui.visibleLayers() : [], year: map.year, lens: agent && agent.lens, camera,
      overlays: ui.overlays ? [...ui.overlays()] : [], simOpen: typeof document !== 'undefined' && document.body.classList.contains('sim-open') }; // Phase 11A: scenes now toggle NLSC overlays and open the 智慧都更模擬 card — both go back to how the user had them
  }
  async _restoreSnapshotNow() {
    const s = this._snapshot; if (!s) return; this._snapshot = null; const { map, ui, agent } = this.c;
    if (s.lens && agent) agent.setLens(s.lens);
    if (s.look && map.compose) await map.compose.setLook(s.look, { quiet: true }).catch(() => {});
    if (s.density) ui.setDensity(s.density, true);
    if (s.layers && map.layerKeys) for (const k of map.layerKeys) ui.setLayer(k, s.layers.includes(k));
    if (s.year != null) map.setYear(s.year);
    if (s.overlays && ui.overlays && ui.setOverlay) for (const k of new Set([...ui.overlays(), ...s.overlays])) ui.setOverlay(k, s.overlays.includes(k));
    if (!s.simOpen && ui.clearSim && typeof document !== 'undefined' && document.body.classList.contains('sim-open')) ui.clearSim();
    if (s.camera) map.flyTo(s.camera.lon, s.camera.lat, { range: s.camera.height, pitch: s.camera.pitch, heading: s.camera.heading, duration: 1.4 });
  }

  /* ---- resolve a step's `text`/`stage` (may be functions of ctx, Phase 9F/10Q) once, up front ---- */
  _resolveStep(st) {
    let text = st.text; if (typeof text === 'function') { try { text = text(this.c) || ''; } catch (e) { console.warn('scene text failed', e); text = ''; } }
    let stage = st.stage; if (typeof stage === 'function') { try { stage = stage(this.c) || {}; } catch (e) { console.warn('scene stage failed', e); stage = {}; } }
    return { ...st, text, stage: stage || {} };
  }

  /** §18.2 舞台接管: apply this step's declared stage through the public APIs, fade what it doesn't care about to
   * 20%, and hand `keys` to explain mode (framed, numbered, and — via map.stage.emphasize — visually unmistakable). */
  async _applyStage(stage, text, durationMs) {
    const { map, ui, agent } = this.c; stage = stage || {};
    if (stage.lens && agent) agent.setLens(stage.lens);
    if (stage.look && map.compose) await map.compose.setLook(stage.look, { quiet: true }).catch(() => {});
    if (stage.density && ui.setDensity) ui.setDensity(stage.density, true);
    if (stage.layers) { for (const k of stage.layers.hide || []) ui.setLayer(k, false); for (const k of stage.layers.show || []) ui.setLayer(k, true); }
    const except = (stage.layers && stage.layers.show) || (ui.visibleLayers ? ui.visibleLayers() : []);
    const level = stage.emphasis == null ? 2 : stage.emphasis;
    if (map.stage) { map.stage.dim(except); map.stage.emphasize(level, stage.keys || []); }
    if (stage.keys && stage.keys.length && map.explain) map.explain.enter(stage.keys, { text, durationMs });
    else if (map.explain) map.explain.exit();
  }

  /** Runs one step to completion: applies its stage, fires beats in order as narration progress crosses each `at`
   * (a bare `run`, no `beats`, is exactly "the beat at 0" — unchanged legacy shape), and only returns once narration
   * has finished AND every due beat has resolved (+≤600ms settle) — never a fixed `hold` unless there's no narration
   * at all. Timers are polled rather than trusted (`await wait()` in a loop, re-checking performance.now() each time)
   * so this stays correct even when setInterval/setTimeout are throttled under load. Returns 'done' | 'paused'. */
  async _runStep(sc, st, idx, total, token) {
    const { ui } = this.c; const text = st.text, stage = st.stage || {};
    // §18.2 舞台接管 must be IMMEDIATE — never blocked behind a (possibly slow, real-network) TTS duration probe, or
    // the map would sit unchanged for however long that fetch takes. Stage + beat@0 (camera) fire first; the
    // duration probe (for pacing/lapse-sizing only) runs after, and speak() itself reuses its cached fetch anyway.
    // Every checkpoint below checks `this._token !== token` rather than just `this.stopFlag`: stop() bumps _token,
    // so a step orphaned behind a slow await (a scene stopped, or superseded by a new play()) can never mutate state
    // that belongs to a later run — even one whose own stopFlag has since been reset back to false by that new play().
    const stale = () => this._token !== token;
    ui.cine(sc.title, text, { index: idx, total });
    await this._applyStage(stage, text, 15000);
    if (stale()) return 'done'; if (this.paused) return 'paused';
    const stepCtx = { ...this.c, stepMs: 9000 }; // provisional until estMs resolves below; only a beat firing later (at>0) ever reads the corrected value
    const beats = (st.beats && st.beats.length ? st.beats : (st.run ? [{ at: 0, run: st.run }] : [])).slice().sort((a, b) => a.at - b.at);
    const fired = new Set(); let frac = 0;
    const fire = async f => {
      if (f != null) frac = Math.max(frac, f);
      for (const b of beats) { if (fired.has(b) || frac < b.at) continue; fired.add(b);
        try { await b.run(stepCtx); } catch (e) { console.warn('[scene] beat failed', sc.id, idx, e); }
        console.log('[beat]', sc.id, idx, b.at, frac.toFixed(2)); }
    };
    await fire(0); if (stale()) return 'done'; if (this.paused) return 'paused'; // camera/keys already visible at this point regardless of TTS latency
    const estMs = text ? await ui.speech.duration(text).catch(() => 0) : 0;
    if (stale()) return 'done'; if (this.paused) return 'paused';
    const minMs = text ? Math.max(estMs, 1200) : (st.hold || 3000);
    stepCtx.stepMs = minMs;
    const t0 = performance.now();
    const timer = setInterval(() => { if (stale() || this.paused) return; fire(minMs > 0 ? (performance.now() - t0) / minMs : 1); }, 100);
    const narration = text && ui.speak ? ui.speak(text, { onProgress: fire }).catch(() => ({ ms: 0, source: 'error' })) : Promise.resolve({ ms: 0, source: 'none' });
    const res = await narration; const floorMs = Math.max((res && res.ms) || 0, minMs);
    while (!stale() && !this.paused && performance.now() - t0 < floorMs) await wait(120);
    clearInterval(timer);
    if (stale()) return 'done';
    if (this.paused) return 'paused';
    await fire(1); await wait(400);
    return 'done';
  }

  _teardown() {
    if (this._torndown) return; this._torndown = true;
    const { ui, map } = this.c;
    if (map.stage) map.stage.restore();
    if (map.explain) map.explain.exit();
    ui.cine(null);
    this._restoreSnapshotNow().catch(() => {});
  }

  async play(id) { try { const u = (this.c && this.c.ui) || this.ui; if (u && u.select) u.select(null); } catch { /* a lingering selection card would sit on top of the scene */ }
    const sc = typeof id === 'string' ? SCENES.find(s => s.id === id) : (id && Array.isArray(id.steps) ? id : null); if (!sc || !sc.steps.length) return; this.stop(); // Phase 11A: play() also takes a compileScript() result (agent 導演)
    id = sc.id; this.scene = sc;
    const token = ++this._token; // this run's identity — see _runStep's `stale()`
    this.playing = id; this.stopFlag = false; this.paused = false; this.stepIndex = 0; this._torndown = false;
    const { ui } = this.c; this._snapshot = this._snapshotState();
    const steps = sc.steps.map(st => this._resolveStep(st));
    ui.warmSpeech && ui.warmSpeech(steps.map(s => s.text));
    let i = 0;
    while (i < steps.length && !this.stopFlag && this._token === token) {
      if (this.paused) { await new Promise(res => { this._resumeFn = res; }); if (this.stopFlag || this._token !== token) break; continue; } // pause landed in the gap between steps
      this.stepIndex = i; let outcome;
      try { outcome = await this._runStep(sc, steps[i], i, steps.length, token); } catch (e) { console.warn('scene step failed', e); outcome = 'done'; }
      if (this.stopFlag || this._token !== token) break;
      if (outcome === 'paused') { await new Promise(res => { this._resumeFn = res; }); if (this.stopFlag || this._token !== token) break; continue; }
      i++;
    }
    if (this._token === token) { this._teardown(); this.playing = null; } // a newer play()/stop() already owns teardown otherwise
  }
  /** §18.2 統一語音列: a user question mid-scene pauses it (stop speech, freeze beats/lapse) — resume() continues
   * from the current step (re-runs it from its start, not from the exact paused instant: simpler and robust even
   * when the underlying narration/audio has no true pause/resume of its own). Voicebar wires these to ▶/⏸ and to a
   * MutationObserver on #transcript (a new user turn while playing calls pause()). */
  pause() { if (!this.playing || this.paused) return false; this.paused = true; this.c.timeline.stopLapse(); this.c.ui.speech && this.c.ui.speech.stop(); return true; }
  resume() { if (!this.playing || !this.paused) return false; this.paused = false; if (this._resumeFn) { const f = this._resumeFn; this._resumeFn = null; f(); } return true; }
  stop() {
    const wasPlaying = !!this.playing; this.stopFlag = true; this._token++; // invalidates any _runStep still in flight (see `stale()`)
    if (this.paused && this._resumeFn) { const f = this._resumeFn; this._resumeFn = null; f(); }
    this.paused = false; this.c.timeline.stopLapse(); this.c.ui.speech && this.c.ui.speech.stop();
    if (wasPlaying) this._teardown(); this.playing = null;
  }
}
