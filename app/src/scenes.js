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

export class SceneDirector {
  constructor(ctx) { this.c = ctx; this.playing = null; this.paused = false; this.stopFlag = false; this.stepIndex = 0; this._snapshot = null; this._resumeFn = null; this._torndown = true; }

  /* ---- state the scene borrows from the user (§18.2 舞台接管): look/density/visible layers/year/lens/camera ---- */
  _snapshotState() {
    const { map, ui, agent } = this.c;
    let camera = null; try { const p = map.center(); camera = { lon: p.lon, lat: p.lat, height: p.height, heading: map.heading, pitch: map.pitch }; } catch { /* not ready */ }
    return { look: map.compose ? map.compose.look : null, density: ui.density, layers: ui.visibleLayers ? ui.visibleLayers() : [], year: map.year, lens: agent && agent.lens, camera };
  }
  async _restoreSnapshotNow() {
    const s = this._snapshot; if (!s) return; this._snapshot = null; const { map, ui, agent } = this.c;
    if (s.lens && agent) agent.setLens(s.lens);
    if (s.look && map.compose) await map.compose.setLook(s.look, { quiet: true }).catch(() => {});
    if (s.density) ui.setDensity(s.density, true);
    if (s.layers && map.layerKeys) for (const k of map.layerKeys) ui.setLayer(k, s.layers.includes(k));
    if (s.year != null) map.setYear(s.year);
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
  async _runStep(sc, st, idx, total) {
    const { ui } = this.c; const text = st.text, stage = st.stage || {};
    const estMs = text ? await ui.speech.duration(text).catch(() => 0) : 0;
    const minMs = text ? Math.max(estMs, 1200) : (st.hold || 3000);
    ui.cine(sc.title, text, { index: idx, total });
    await this._applyStage(stage, text, minMs + 800);
    if (this.stopFlag) return 'done'; if (this.paused) return 'paused';
    const stepCtx = { ...this.c, stepMs: minMs };
    const beats = (st.beats && st.beats.length ? st.beats : (st.run ? [{ at: 0, run: st.run }] : [])).slice().sort((a, b) => a.at - b.at);
    const fired = new Set(); let frac = 0;
    const fire = async f => {
      if (f != null) frac = Math.max(frac, f);
      for (const b of beats) { if (fired.has(b) || frac < b.at) continue; fired.add(b);
        try { await b.run(stepCtx); } catch (e) { console.warn('[scene] beat failed', sc.id, idx, e); }
        console.log('[beat]', sc.id, idx, b.at, frac.toFixed(2)); }
    };
    await fire(0); if (this.stopFlag) return 'done';
    const t0 = performance.now();
    const timer = setInterval(() => { if (this.stopFlag || this.paused) return; fire(minMs > 0 ? (performance.now() - t0) / minMs : 1); }, 100);
    const narration = text && ui.speak ? ui.speak(text, { onProgress: fire }).catch(() => ({ ms: 0, source: 'error' })) : Promise.resolve({ ms: 0, source: 'none' });
    const res = await narration; const floorMs = Math.max((res && res.ms) || 0, minMs);
    while (!this.stopFlag && !this.paused && performance.now() - t0 < floorMs) await wait(120);
    clearInterval(timer);
    if (this.stopFlag) return 'done';
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

  async play(id) {
    const sc = SCENES.find(s => s.id === id); if (!sc) return; this.stop();
    this.playing = id; this.stopFlag = false; this.paused = false; this.stepIndex = 0; this._torndown = false;
    const { ui } = this.c; this._snapshot = this._snapshotState();
    const steps = sc.steps.map(st => this._resolveStep(st));
    ui.warmSpeech && ui.warmSpeech(steps.map(s => s.text));
    let i = 0;
    while (i < steps.length && !this.stopFlag) {
      if (this.paused) { await new Promise(res => { this._resumeFn = res; }); if (this.stopFlag) break; continue; } // pause landed in the gap between steps
      this.stepIndex = i; let outcome;
      try { outcome = await this._runStep(sc, steps[i], i, steps.length); } catch (e) { console.warn('scene step failed', e); outcome = 'done'; }
      if (this.stopFlag) break;
      if (outcome === 'paused') { await new Promise(res => { this._resumeFn = res; }); if (this.stopFlag) break; continue; }
      i++;
    }
    this._teardown(); this.playing = null;
  }
  /** §18.2 統一語音列: a user question mid-scene pauses it (stop speech, freeze beats/lapse) — resume() continues
   * from the current step (re-runs it from its start, not from the exact paused instant: simpler and robust even
   * when the underlying narration/audio has no true pause/resume of its own). Voicebar wires these to ▶/⏸ and to a
   * MutationObserver on #transcript (a new user turn while playing calls pause()). */
  pause() { if (!this.playing || this.paused) return false; this.paused = true; this.c.timeline.stopLapse(); this.c.ui.speech && this.c.ui.speech.stop(); return true; }
  resume() { if (!this.playing || !this.paused) return false; this.paused = false; if (this._resumeFn) { const f = this._resumeFn; this._resumeFn = null; f(); } return true; }
  stop() {
    const wasPlaying = !!this.playing; this.stopFlag = true;
    if (this.paused && this._resumeFn) { const f = this._resumeFn; this._resumeFn = null; f(); }
    this.paused = false; this.c.timeline.stopLapse(); this.c.ui.speech && this.c.ui.speech.stop();
    if (wasPlaying) this._teardown(); this.playing = null;
  }
}
