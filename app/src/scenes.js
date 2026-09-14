// Cinematic scene director (GEV-style): narrated camera scripts over real FUNRAISE layers.
const wait = ms => new Promise(r => setTimeout(r, ms));
export const SCENES = [
  { id: 'investor', title: '資本流向 · 投資人巡航', sub: '上市櫃資產交易 × 商圈行情 × 台北101 環繞', steps: [
    { text: '這是台北。過去十二個月，上市櫃公司在這座城市公告了幾十筆不動產取得與處分。', run: async (c) => { c.agent.setLens('investor'); c.map.flyTo(121.548, 25.047, { range: 15000, pitch: -62, heading: 10 }); }, hold: 5200 },
    { text: '每一個橘色光點就是一筆公告：大小代表金額，來源是公開資訊觀測站，經 FUNRAISE 結構化解析。', run: async (c) => { c.ui.setLayer('mops', true); (c.data.mops || []).forEach(m => c.map.pulse('mops:' + m.id, 9000)); c.map.flyTo(121.560, 25.040, { range: 7000, pitch: -50, heading: 25 }); }, hold: 6000 },
    { text: '信義計畫區：安泰銀以 4.8 億取得台北101 使用權資產；富邦金控家族在遼寧街與基隆路之間調度樓層。', run: async (c) => { c.map.orbit(121.5645, 25.0339, 900, -30); }, hold: 7000 },
    { text: '把鏡頭拉到南港：雲豹能源進駐台灣人壽南港大樓 3.1 億、宜鼎處分忠孝東路商辦 1.68 億。資本正在往東流。', run: async (c) => { c.map.flyTo(121.612, 25.056, { range: 2600, pitch: -38, heading: -30 }); }, hold: 6500 },
    { text: '這就是投資人鏡：每一筆交易都能回溯到一個 MCP 工具呼叫與資料期間。', run: async (c) => { c.map.flyTo(121.560, 25.045, { range: 9000, pitch: -60, heading: 0 }); }, hold: 4000 },
  ] },
  { id: 'developer', title: '供給雷達 · 開發商鏡', sub: '建照脈衝 × 都更多邊形 × 2026→2030 幽靈建物長高', steps: [
    { text: '開發商最想知道的是：接下來三年，誰在哪裡蓋什麼。', run: async (c) => { c.agent.setLens('developer'); c.map.setYear(2026); c.map.flyTo(121.575, 25.045, { range: 11000, pitch: -58, heading: 0 }); }, hold: 4500 },
    { text: '青色脈衝是臺北市 114、115 年建照：起造人雖被遮罩，但地址、設計人與開工時序都在。這是新供給最早的訊號。', run: async (c) => { c.ui.setLayer('licenses', true); c.ui.setLayer('future', true); (c.data.building_licenses || []).forEach(l => c.map.pulse('license:' + l.license_number, 9000)); }, hold: 6000 },
    { text: '紫色多邊形是都更單元：政府主導與已核定事業。臺北機廠 20 公頃、華山行政專區 5.4 公頃、南港高鐵站區生技產業 7.2 公頃。', run: async (c) => { c.ui.setLayer('renewal', true); (c.data.urban_renewal || []).forEach(u => c.map.pulse('renewal:' + u.id, 9000)); c.map.flyTo(121.561, 25.047, { range: 4200, pitch: -48, heading: 20 }); }, hold: 7000 },
    { text: '現在把時間往前推。南港：南港之星、HCBD、調車場公辦都更；信義：南山 A21、A26、四季酒店。看它們長出來。', run: async (c) => { c.map.flyTo(121.598, 25.050, { range: 5200, pitch: -40, heading: -20 }); await wait(1800); c.timeline.startLapse({ from: 2026, to: 2030, stepMs: 900 }); }, hold: 7500 },
    { text: '2030 年的天際線，今天就能看見。這是 God\'s Eye View 沒有、而 FUNRAISE 有的東西：未來。', run: async (c) => { c.map.orbit(121.601, 25.052, 2200, -32); }, hold: 6000 },
  ] },
  { id: 'occupier', title: '企業選址 · 內科到南軟', sub: '商辦等級 × 捷運 × 租戶 × 街景', steps: [
    { text: '企業選址鏡是 PickPeak 的核心：CFO 要的是三個可比較的方案。', run: async (c) => { c.agent.setLens('occupier'); c.map.setYear(new Date().getFullYear()); c.map.flyTo(121.576, 25.077, { range: 4200, pitch: -48, heading: 0 }); }, hold: 4500 },
    { text: '內湖科技園區：綠色是廠辦，輝達、鴻海、BENQ 的總部都在這一區；金色是 A 級商辦。', run: async (c) => { c.ui.setLayer('stock', true); c.ui.setLayer('mrt', true); (c.data.buildings || []).filter(b => (b.district || '').includes('內湖')).forEach(b => c.map.pulse('stock:' + b.id, 8000)); }, hold: 6000 },
    { text: '走到街上看：台北企業總部園區三棟 16 層 LEED 白金級，是 OSM 樓高與 FUNRAISE 屋齡、認證、租金資料疊在一起的結果。', run: async (c) => { c.map.street(121.5878, 25.0592); }, hold: 6500 },
    { text: '沿藍線往東，南港經貿園區：中國信託金融大樓、台灣人壽南港大樓，捷運 200 公尺內。', run: async (c) => { c.map.flyTo(121.614, 25.057, { range: 1800, pitch: -35, heading: 40 }); }, hold: 6000 },
    { text: '選好三棟，就能直接產出選址提案與搬遷計畫，交給 39 家生態系夥伴。', run: async (c) => { c.map.flyTo(121.585, 25.062, { range: 9000, pitch: -60, heading: 0 }); }, hold: 4000 },
  ] },
  { id: 'city', title: '城市治理 · 首長戰情室', sub: '興建中公共建設 × 企業遷徙 × 都更統計', steps: [
    { text: '換到城市治理鏡：局處與首長關心的是建設、產業、更新三件事。', run: async (c) => { c.agent.setLens('city'); c.map.flyTo(121.560, 25.055, { range: 16000, pitch: -62, heading: 0 }); }, hold: 4500 },
    { text: '藍色虛線是興建中的捷運：環狀線東環段、信義線東延段、汐東捷運；劍潭、士林、劍南路站 TOD 開發同步啟動。', run: async (c) => { c.ui.setLayer('infra', true); c.map.flyTo(121.575, 25.060, { range: 12000, pitch: -55, heading: 15 }); }, hold: 6500 },
    { text: '橘色弧線是 2026 年 7 月遷入台北各區的公司：從新北、桃園、台中、金門飛進中山、大安、內湖、南港。', run: async (c) => { c.ui.setLayer('moves', true); (c.data.registry_moves || []).forEach(m => c.map.pulse('move:' + m.uniform_number, 9000)); c.map.flyTo(121.545, 25.052, { range: 9000, pitch: -45, heading: -10 }); }, hold: 7000 },
    { text: '都更統計：台北市 2,300 多個更新地區與單元，中山區最多。政府主導的案子用亮紫色標示。', run: async (c) => { c.ui.setLayer('renewal', true); c.map.flyTo(121.535, 25.055, { range: 6000, pitch: -52, heading: 0 }); }, hold: 6000 },
    { text: '同一張地圖，換一個鏡，就是另一份簡報。', run: async (c) => { c.map.flyTo(121.548, 25.047, { range: 15000, pitch: -62, heading: 0 }); }, hold: 3500 },
  ] },
  { id: 'time', title: '時光 · 2012 → 2030', sub: '過去與未來同框', steps: [
    { text: '最後，把時間軸整個播一遍：從 2012 年實價登錄上路，到 2030 年的供給 pipeline。', run: async (c) => { c.agent.setLens('research'); c.ui.setLayer('stock', true); c.ui.setLayer('future', true); c.ui.setLayer('licenses', true); c.map.flyTo(121.560, 25.045, { range: 10000, pitch: -55, heading: 20 }); }, hold: 4000 },
    { text: '看大樓一棟一棟出現，建照脈衝亮起，幽靈建物長高。', run: async (c) => { c.timeline.startLapse({ from: 2012, to: 2030, stepMs: 700 }); c.map.orbit(121.565, 25.045, 7000, -55, 0.03); }, hold: 15000 },
    { text: 'God\'s Eye View 做出了「現在」。睿鏡把「過去」和「未來」也放進同一個畫面。', run: async (c) => { c.map.flyTo(121.548, 25.047, { range: 15000, pitch: -62, heading: 0 }); }, hold: 4500 },
  ] },
];
export class SceneDirector {
  constructor(ctx) { this.c = ctx; this.playing = null; this.stopFlag = false; }
  // Each step: start narration + camera together, then wait for the narration to FINISH (plus the step's hold budget) before moving on.
  async play(id) { const sc = SCENES.find(s => s.id === id); if (!sc) return; this.stop(); this.playing = id; this.stopFlag = false; const { ui } = this.c; ui.cine(sc.title, ''); ui.warmSpeech && ui.warmSpeech(sc.steps.map(s => s.text));
    for (const st of sc.steps) { if (this.stopFlag) break; ui.cine(sc.title, st.text); const t0 = performance.now(); const narration = ui.speak ? ui.speak(st.text).catch(() => ({ ms: 0 })) : Promise.resolve({ ms: 0 });
      try { await st.run(this.c); } catch (e) { console.warn('scene step failed', e); }
      const res = await narration; if (this.stopFlag) break; const elapsed = performance.now() - t0; const minHold = res && res.ms ? 900 : st.hold; await wait(Math.max(minHold - Math.max(0, elapsed - (res && res.ms || 0)), 400)); }
    if (!this.stopFlag) ui.cine(null); this.playing = null; }
  stop() { this.stopFlag = true; this.playing = null; this.c.timeline.stopLapse(); this.c.ui.cine(null); }
}
