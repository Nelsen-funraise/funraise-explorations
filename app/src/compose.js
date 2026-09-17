// 睿鏡 PeakLens v2 — 視圖合成器（Phase 9A，docs/11-v2-cesium-app.md §16）。
// 取代五個各自為政的開關（主題／底圖／日照／夜間／畫質）：一個 Look 預設 + 一個由相機高度決定的尺度（S0..S4），
// 圖層／標籤／後製全部經過這裡再落地。所有既有的 ui.setTheme/setSun/setNight/setQuality/setBasemap/setOverlay
// 呼叫都被包一層：真正的實作照舊執行，這裡只加「記成覆寫、直到下一次 setLook」與「尺度約束優先於預設」兩件事。
const SCALE_BOUNDS = [500, 2000, 8000, 60000]; // S4|S3, S3|S2, S2|S1, S1|S0（公尺）
const SCALE_NAMES = ['S4', 'S3', 'S2', 'S1', 'S0'];
const HYSTERESIS = 0.15;
const LABEL_BUDGET = { S0: 0, S1: 12, S2: 12, S3: 24, S4: 0 }; // §16.1；S4 的「選取＋釘選＋標註」＝非豁免項目一律 0
const LOOK_LABEL = { white: '白模', sun: '日照', golden: '黃金時刻', night: '夜景', photoreal: '實景' }; // Phase 10P §18.1：「相片級」改叫「實景」，預設 Look（見 createCompose() 尾端與 main.js 開機邏輯）
// §16.2 每個 Look 的完整組合：主題、後製請求（尺度約束在 effectiveQuality() 裡贏過這裡的請求）。底圖／日照時刻另外算。
export const LOOKS = {
  white: { theme: 'light', quality: { ao: false, bloom: false, hdr: false, facade: false } },
  sun: { theme: 'light', quality: { ao: false, bloom: false, hdr: false, facade: false } },
  golden: { theme: 'light', quality: { ao: false, bloom: true, hdr: true, facade: false } },
  night: { theme: 'dark', quality: { ao: false, bloom: true, hdr: true, facade: true } },
  photoreal: { theme: 'light', quality: { ao: false, bloom: false, hdr: false, facade: false } },
};

/** 相機高度（公尺）→ S0..S4，帶 15% 遲滯避免邊界抖動。跨兩階以上的大跳躍（flyTo 直接落到另一端）直接吸附，
 * 遲滯只保護「連續小幅移動」剛好在邊界附近來回的情況。純函式，方便單獨測試。 */
export function scaleFor(height, prevScale) {
  let idx = 0; while (idx < SCALE_BOUNDS.length && height >= SCALE_BOUNDS[idx]) idx++;
  if (!prevScale) return SCALE_NAMES[idx];
  const prevIdx = SCALE_NAMES.indexOf(prevScale); if (prevIdx < 0) return SCALE_NAMES[idx];
  if (idx === prevIdx) return prevScale;
  if (Math.abs(idx - prevIdx) >= 2) return SCALE_NAMES[idx];
  if (idx > prevIdx) return height >= SCALE_BOUNDS[prevIdx] * (1 + HYSTERESIS) ? SCALE_NAMES[idx] : prevScale;
  return height <= SCALE_BOUNDS[idx] * (1 - HYSTERESIS) ? SCALE_NAMES[idx] : prevScale;
}

/** 白模／日照的底圖依尺度：S3–S4 正射影像、S1–S2（含 S0）淺色底圖；黃金＝一律正射；夜景＝一律深色底圖（不是正射——
 * 使用者硬選正射時，viewer.js 既有的 setBasemap()→applyTint() 只要 base.night 是 true 就會自動套 60% 暗化去飽和，
 * 不需要另外處理）；實景的底圖只是備援（3D Tiles 載入前／載入失敗時的視覺，或 S0–S1 全島尺度退回底圖省流量），
 * 跟白模／日照同一套依尺度規則（Phase 10P §18.1，不再跟黃金分一組）。 */
function basemapForLook(look, scale) {
  if (look === 'night') return 'carto_dark';
  if (look === 'golden') return 'nlsc_photo';
  return (scale === 'S3' || scale === 'S4') ? 'nlsc_photo' : 'esri_light';
}

/** 尺度約束贏過預設／使用者請求：S0–S1 一律關泛光／HDR／AO；AO 只在 S3–S4 且白模／日照；HDR 只在 S3–S4。*/
export function effectiveQuality(requested, scale, look) {
  const s34 = scale === 'S3' || scale === 'S4', s01 = scale === 'S0' || scale === 'S1';
  return { ...requested, bloom: !!requested.bloom && !s01, hdr: !!requested.hdr && s34, ao: !!requested.ao && s34 && (look === 'white' || look === 'sun') };
}
function noteFor(requestedDelta, eff) {
  const notes = [];
  if (requestedDelta.bloom && !eff.bloom) notes.push('城市尺度不開泛光，拉近到行政區尺度以下才會生效');
  if (requestedDelta.hdr && !eff.hdr) notes.push('城市尺度不開 HDR，拉近到街廓以下才會生效');
  if (requestedDelta.ao && !eff.ao) notes.push('環境光遮蔽僅白模／日照且街廓尺度以下才會生效');
  return notes;
}
function ringRadiusFor(info) {
  if (!info || !info.bounds) return 1200; const [w, s, e, n] = info.bounds;
  const dx = (e - w) * 111320 * Math.cos(((s + n) / 2) * Math.PI / 180), dy = (n - s) * 110540;
  return Math.max(600, Math.hypot(dx, dy) / 2);
}

/** @param {{viewer,rig,layers,osm,ground,youbike,focus,trips,ui,map,viewerApi,lighting}} ctx */
export function createCompose(ctx) {
  const { viewer, rig, layers, ground, youbike, focus, trips, ui, map, viewerApi, lighting } = ctx; // osm 不再需要（實景進出時的 osm.setVisible 交給 map.photoreal 自己做，見 enterPhotoreal/exitPhotoreal）——main.js 呼叫端仍可傳 osm，多餘的 key 沒有副作用
  // 呼叫合成器之前，這些就是 ui.js 真正的實作（main.js 這時已經把 setTheme 疊了 syncUrl/trips/measure 三層 —
  // 這裡再包最外層：真正的邏輯照舊先跑，只在外面加「記成覆寫」）。
  const realSetTheme = ui.setTheme, realSetSun = ui.setSun, realSetBasemap = ui.setBasemap, realSetQuality = ui.setQuality, realSetNight = ui.setNight, realSetOverlay = ui.setOverlay;

  const state = { scale: 'S3', look: 'white', overrides: { theme: false, basemap: false, sun: false, quality: false, night: false }, requestedQuality: { ao: false, bloom: false, hdr: false, facade: false }, youbikeWanted: false, photoreal: false };

  function reapplyQuality() { const eff = effectiveQuality(state.requestedQuality, state.scale, state.look); return realSetQuality(eff); }
  function youBikeScaleOK(scale) { return scale === 'S3' || scale === 'S4'; }
  function reapplyYouBike() { if (!youbike) return; const eff = state.youbikeWanted && youBikeScaleOK(state.scale); if (!!youbike.visible !== eff) youbike.setVisible(eff); }
  function applyBasemapForScale() { if (state.overrides.basemap) return; if (state.look === 'white' || state.look === 'sun') realSetBasemap(basemapForLook(state.look, state.scale)); }

  /** 相機停止移動（debounce）或外部明確呼叫時：重新判定尺度，套用到圖層遮罩／標籤預算／白模日照底圖／後製約束。
   * 視野範圍（rig.bounds()）每次都重新量，即使尺度沒變也要重跑標籤（相機在同一尺度內平移，標籤預算也該跟著換）；
   * 比較重的東西（遮罩、預算「數字」、畫質、底圖、YouBike）只在尺度真的換了或 force 時才動。*/
  function apply(force) {
    const h = rig.lonlat[2]; const next = scaleFor(h, state.scale); const changed = next !== state.scale;
    state.scale = next;
    layers.setViewBounds(rig.bounds());
    if (changed || force) {
      layers.applyScale(next);
      layers.setLabelBudget(LABEL_BUDGET[next] ?? 24);
      applyBasemapForScale();
      reapplyQuality();
      reapplyYouBike();
      if (state.photoreal && map.photoreal) map.photoreal.setQualityForScale(next); // §18.1「效能」：S4 12 / S3 16 / S2 24 / S1+ 32，尺度變了就重打一次
    } else {
      layers.recomputeLabels();
    }
    return { scale: state.scale, changed };
  }

  // Phase 10P §18.1：tileset 生命週期、白模隱藏、地面圖層貼附全部交給 src/layers/photoreal.js（map.photoreal，
  // main.js 在 compose 之後才建立——這兩個函式只在「真的呼叫」的當下讀 map.photoreal，不在建構時快照，所以晚建立
  // 也接得上，跟 map.showIsochrone 等其它「main.js 之後才補上的圖層」是同一個道理）；這裡只管 photoreal.js 拿不到
  // 的東西：NLSC 疊圖（ui.setOverlay）、ground.js 的河川／道路（記住使用者原本的開關，退出時精準還原，不是無條件
  // 開回 true/true）、frames.js 的玻璃殼可見度。
  let groundSaved = null;
  async function enterPhotoreal() {
    const pr = map.photoreal; if (!pr) return false;
    const ok = await pr.enter(); if (!ok) { state.photoreal = false; return false; }
    state.photoreal = true; map.groundMode = true; // isochrone.js／walkshed.js 動態畫新圖形時讀這個旗標決定要不要走 groundPolygon() 的貼地路徑
    for (const k of [...(viewerApi.overlays || [])]) ui.setOverlay(k, false); // 地面疊圖關閉（走 ui.setOverlay，保持 rail 按鈕與佇列同步）
    if (ground && ground.setVisible) { groundSaved = ground.visible; ground.setVisible({ rivers: false, roads: false }); }
    if (map.frames && map.frames.setVisible) map.frames.setVisible(true); if (layers.setStockVolumes) layers.setStockVolumes(false); // 玻璃殼取代白模的量體感（§18.1「有資料的那些棟框起來」）
    return true;
  }
  function exitPhotoreal() {
    const pr = map.photoreal; if (pr) pr.exit();
    state.photoreal = false; map.groundMode = false;
    if (ground && ground.setVisible) { ground.setVisible(groundSaved || { rivers: true, roads: true }); groundSaved = null; }
    if (map.frames && map.frames.setVisible) map.frames.setVisible(false); if (layers.setStockVolumes) layers.setStockVolumes(true);
  }

  /** §16.2 一換預設就整組重設：主題／底圖／日照／後製一次套好，尺度約束在 reapplyQuality() 裡贏。 */
  async function setLook(name, opts = {}) {
    const cfg = LOOKS[name]; if (!cfg) return { ok: false, error: '未知的 Look：' + name };
    if (name === 'photoreal' && !(map.photoreal && map.photoreal.available)) { const note = '需要 Cesium ion 或 Google Maps 金鑰（/setup）'; if (!opts.quiet) ui.toast && ui.toast(note); return { ok: false, reason: 'no-key', note }; }
    const wasUsingPhotoreal = state.photoreal; // 用 state.photoreal（不是 state.look）判斷「實景底座目前開不開」：night 也可能借用它，見下面 usePhotorealBase
    state.overrides.theme = state.overrides.basemap = state.overrides.sun = state.overrides.quality = state.overrides.night = false;
    state.look = name;
    realSetTheme(cfg.theme, true);
    if (map.frames && map.frames.setTheme) map.frames.setTheme(cfg.theme); // ui.setTheme 既有的 cascade 不知道 frames 存在（Phase 10P 才加的模組），這裡補一手同步
    // opts.hour lets a caller (agent.js's applyLook — the rule-based agent's NL routing for "17:30 的日照／黃金時刻")
    // land on a specific hour in the same call instead of a second set_sun round-trip; omitted, sun/golden fall back
    // to their usual default (golden fixed 17:00, sun keeps whatever hour was already set, else noon).
    const sunHour = name === 'golden' ? (opts.hour ?? 17) : name === 'sun' ? (opts.hour ?? (lighting.hour == null ? 12 : lighting.hour)) : null;
    realSetSun(sunHour, true);
    realSetBasemap(basemapForLook(name, state.scale));
    state.requestedQuality = { ...cfg.quality };
    // §18.1 夜景：Google tiles 本身是白天影像，沒有金鑰時維持原本「OSM 白模＋窗燈」的夜景；金鑰齊全時借用實景
    // 底座＋整體藍調模擬（photoreal.setNight），道路／捷運光帶特地開回來——跟 enterPhotoreal() 平常在實景下把
    // 道路關掉正好相反，這是「夜景」這個 Look 自己的例外，不是地面模式的一般規則。
    const usePhotorealBase = name === 'photoreal' || (name === 'night' && map.photoreal && map.photoreal.available);
    if (usePhotorealBase) {
      const ok = await enterPhotoreal();
      if (!ok) { if (name === 'photoreal') return setLook('white', { quiet: true }); }
      else if (name === 'night' && ground && ground.setVisible) ground.setVisible({ roads: true });
    } else if (wasUsingPhotoreal) exitPhotoreal();
    if (map.photoreal && map.photoreal.available) map.photoreal.setNight(name === 'night');
    const cur = reapplyQuality();
    const notes = noteFor(cfg.quality, cur);
    try { localStorage.setItem('pl.look', name); } catch { /* private mode */ }
    ui.paintLook && ui.paintLook(name);
    if (!opts.quiet && (name === 'sun' || name === 'golden')) ui.openSunMenu && ui.openSunMenu(); else ui.closeSunMenu && ui.closeSunMenu(); // scenes/agent tools pass quiet: no popover mid-narration
    if (!opts.quiet) ui.toast && ui.toast(notes.length ? `外觀：${LOOK_LABEL[name]}（${notes.join('；')}）` : `外觀：${LOOK_LABEL[name]}`);
    return { ok: true, look: name, adjusted: notes.length > 0, note: notes.join('；') || undefined };
  }

  const api = {
    LOOKS, looks: Object.keys(LOOKS),
    get scale() { return state.scale; }, get look() { return state.look; },
    setLook, apply: (force = true) => apply(force),
    setYouBikeWanted(on) { state.youbikeWanted = !!on; reapplyYouBike(); return { wanted: state.youbikeWanted, visible: !!(youbike && youbike.visible) }; },
    state() {
      return {
        scale: state.scale, look: state.look, theme: ui.theme, basemap: viewerApi.basemapKey, sun: lighting.hour,
        quality: viewerApi.quality, requestedQuality: { ...state.requestedQuality }, overrides: { ...state.overrides },
        youbike: { wanted: state.youbikeWanted, visible: !!(youbike && youbike.visible) },
        ring: !!layers._ringActive, tripsDim: !!layers._tripsDim, photoreal: !!state.photoreal,
      };
    },
  };
  map.compose = api; // 先掛上去，setLook() 內若被 ui.setXxx 的包裝間接呼叫回來也讀得到（見下面 wraps 的說明）

  /* ---- 把既有的手動開關「經過合成器」：真正邏輯照舊執行，這裡只加「記成覆寫」／尺度約束／跨圖層反應 ---- */
  ui.setTheme = (t, quiet) => { const r = realSetTheme(t, quiet); state.overrides.theme = true; if (!state.overrides.basemap) realSetBasemap(t === 'dark' ? 'carto_dark' : basemapForLook('white', state.scale)); if (map.frames && map.frames.setTheme) map.frames.setTheme(t); return r; };
  ui.setSun = (h, quiet) => { state.overrides.sun = true; return realSetSun(h, quiet); };
  ui.setBasemap = (k) => { state.overrides.basemap = true; return realSetBasemap(k); };
  ui.setNight = (on) => { state.overrides.night = true; return realSetNight(on); };
  ui.setQuality = (q) => {
    state.requestedQuality = { ...state.requestedQuality, ...q }; state.overrides.quality = true;
    const eff = effectiveQuality(state.requestedQuality, state.scale, state.look);
    const cur = realSetQuality(eff);
    const notes = noteFor(q, eff); const adjusted = notes.length > 0;
    if (adjusted) ui.toast && ui.toast(notes.join('；'));
    return { ...cur, adjusted, note: notes.join('；') || undefined };
  };
  ui.setOverlay = (k, on) => { const r = realSetOverlay(k, on); const n = (ui.overlays ? ui.overlays() : []).length; layers.setFlatAlpha('heat', n > 0 ? 0.25 : 1); return r; };
  if (typeof ui.select === 'function') { const origSelect = ui.select; ui.select = (item, layer) => { const r = origSelect(item, layer); layers.setSelected(map.selected ? map.selected.key : null); return r; }; }

  /* ---- §16.3 相容矩陣：等時圈／生活圈互斥＋淡出圈外圖層；對焦是獨佔狀態，進入時清分析圈 ---- */
  const origShowIso = map.showIsochrone, origClearIso = map.clearIsochrone, origShowWalk = map.showWalkshed, origClearWalk = map.clearWalkshed;
  if (typeof origShowIso === 'function') map.showIsochrone = (o) => { if (map.walkshedActive) map.clearWalkshed(); const info = origShowIso(o); if (info) layers.setRingDim([info.origin.lon, info.origin.lat], ringRadiusFor(info)); return info; };
  if (typeof origClearIso === 'function') map.clearIsochrone = (...a) => { const r = origClearIso(...a); if (!map.walkshedActive) layers.setRingDim(null); return r; };
  if (typeof origShowWalk === 'function') map.showWalkshed = async (o) => { if (map.isochroneActive) map.clearIsochrone(); const info = await origShowWalk(o); if (info) layers.setRingDim([info.origin.lon, info.origin.lat], ringRadiusFor(info)); return info; };
  if (typeof origClearWalk === 'function') map.clearWalkshed = (...a) => { const r = origClearWalk(...a); if (!map.isochroneActive) layers.setRingDim(null); return r; };
  if (focus && typeof focus.enter === 'function') { const origEnter = focus.enter.bind(focus); focus.enter = (o) => { if (map.isochroneActive) map.clearIsochrone(); if (map.walkshedActive) map.clearWalkshed(); return origEnter(o); }; }

  /* ---- 相機停止移動：debounce 250ms 後重新判定尺度並套用 ---- */
  let moveT = null;
  viewer.camera.moveEnd.addEventListener(() => { clearTimeout(moveT); moveT = setTimeout(() => apply(false), 250); });

  /* ---- §16.3 遷徙動線播放中：沒有事件可訂閱，poll trips.playing；完成 3 秒後才還原 ---- */
  if (trips) {
    let wasPlaying = false, restoreT = null;
    setInterval(() => {
      const playing = !!trips.playing;
      if (playing && !wasPlaying) { clearTimeout(restoreT); layers.setTripsDim(true); }
      else if (!playing && wasPlaying) { clearTimeout(restoreT); restoreT = setTimeout(() => layers.setTripsDim(false), 3000); }
      wasPlaying = playing;
    }, 300);
  }

  /* ---- 開機預設：白模（日間主題）／夜景（夜間主題），由已還原的主題決定；套一次目前的尺度與視野 ---- */
  state.scale = scaleFor(rig.lonlat[2], null);
  layers.setViewBounds(rig.bounds());
  layers.applyScale(state.scale); layers.setLabelBudget(LABEL_BUDGET[state.scale] ?? 24);
  setLook(ui.theme === 'light' ? 'white' : 'night', { quiet: true }).catch(() => {});

  return api;
}
