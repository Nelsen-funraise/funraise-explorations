// src/layers/photoreal.js — Phase 10P 實景底座（docs/11-v2-cesium-app.md §18.1）。
//
// 「為什麼建物上面不是真的 3D 紋理，而是自己畫假貼皮／假窗？」——因為金鑰齊全時本來就該直接用 Cesium 官方
// API 載入 Google Photorealistic 3D Tiles（真正的空拍網格＋紋理），OSM 白模＋程序化窗燈只是沒有金鑰時的
// 備援視覺。這個模組是「什麼時候用真的、失敗時怎麼收」的協調層：
//   - tileset 本身仍由 viewer.js 的 ensureGoogle() 建立（同一份物件，Google 金鑰走 GoogleMaps.defaultApiKey，
//     沒有 Google 金鑰但有 Cesium ion token 就走 createGooglePhotorealistic3DTileset() 不帶 key 的 ion 資產
//     2275207 路徑）——這裡只負責「什麼時候呼叫它」「依尺度調畫質」「失敗時退回白模並說明原因」。
//   - 進入實景時把 OSM 白模隱藏（frames.js 的玻璃殼＋屋頂光環取代它們給「這棟有資料」的視覺提示）、把既有
//     地面圖層（都更／重劃／公園／商圈熱區的多邊形、建照／捷運站的 icon）post-process 成貼地／貼 3D Tiles
//     （applyGroundMode()），退出時完整還原——funraise.js／isochrone.js／walkshed.js 的建圖邏輯完全不用改。
//
// Phase 11P（owner 反饋：「內容太豐富...很多時候來不及 render...好像一直在重新 loading」）加的效能協調，
// 全部收在這個檔案／compose.js／viewer.js 三處：
//   1) tileset 串流調整（cacheBytes／cullRequestsWhileMoving／skip* 系列）——見 enter() 的 ensureGoogle() 呼叫。
//      Google tile host 的 RequestScheduler 全域調整放在 viewer.js（一次性、跟 Cesium 環境設定放一起）。
//   2) 尺度 SSE 放寬＋飛行/環繞中額外放寬（setMotion，由 compose.js 的 camera.moveStart/moveEnd 呼叫）。
//   3) 實景顯示中降 MSAA、放寬 globe 的 SSE／擴大 tileCacheSize（底圖大多被 3D Tiles 蓋住，不需要精細）。
//   4) #photoreal-status 晶片防閃爍（pending 數要夠高、夠久才顯示；場景播放中一律不顯示）。
import * as Cesium from 'cesium';

const SSE_FOR_SCALE = { S4: 16, S3: 20, S2: 28, S1: 32, S0: 32 }; // §18.1／效能：S4 12→16、S3 16→20、S2 24→28——owner 的機器是筆電，「準時但稍糊」比「準時性不穩、時常卡在半糊」對觀感更好；S1/S0 是全島尺度，3D Tiles 幾乎已經貼齊底圖解析度，鬆緊差異看不出來，維持 32
const MOTION_SSE_MULT = 1.5; // 飛行／環繞中額外放寬的倍率：目的地的 tile 用比較寬鬆的目標流進來，落地後（呼叫端 debounce）再收緊，避免「畫面糊成一坨才開始下載」
const CINEMA_SCALE_CAP = 'S3'; // 場景播放中（body.cinema）即使鏡頭真的到了 S4（例：occupier 場景的街景步驟 c.map.street()，range 420m），也只用 S3 的 SSE——街景是單位畫面 tile 請求量最大的尺度，敘事時「跟上節奏」比「這一格最銳利」重要
// cacheBytes／maximumCacheOverflowBytes 明寫成跟 Cesium 1.124 的 createGooglePhotorealistic3DTileset() 內建
// 預設完全一樣（1.5 GiB／1 GiB，見該函式原始碼：tilesetOptions.cacheBytes ??= 1536*1024*1024，
// maximumCacheOverflowBytes ??= 1024*1024*1024——不是老版本 Cesium3DTileset 泛用的 512 MiB／16 MiB）。這裡
// 「明寫」而不是留給預設值，純粹是釘住這個保證，防未來 Cesium 版本悄悄改掉；owner 要的「回到之前去過的地方
// 不要重新下載」在這個數字下已經足夠——這個 app 的場景只在信義／南港／內湖幾個固定地點來回飛，不是連續平移
// 掃過整個城市，沒有必要為了這個再往上加、犧牲筆電的記憶體。
const GOOGLE_CACHE_BYTES = 1.5 * 1024 * 1024 * 1024;
const GOOGLE_CACHE_OVERFLOW_BYTES = 1 * 1024 * 1024 * 1024;
const NIGHT_TINT = "color('#7FA6C8', 1.0)"; // 建構灰藍：Google tiles 是白天空拍，沒有夜景素材，只能整體調色模擬藍調夜景
const GM_POLY_LAYERS = ['renewal', 'zones', 'parks', 'heat', 'tm']; // §18.1 地面圖層貼附：多邊形／橢圓 → classificationType
const GM_ICON_LAYERS = ['licenses', 'mrt']; // 地面 icon → CLAMP_TO_3D_TILE（建物 icon 沿用 _h，不在這裡碰）

const CHIP_PENDING_THRESHOLD = 30; // §18.1 效能：pending tile 數要超過這個門檻才「有資格」顯示，一般補流／小幅載入不跳出來
const CHIP_PENDING_DELAY_MS = 800; // ...而且要持續超過門檻這麼久才真的顯示——短暫尖峰（例如剛開始飛的那一瞬間）不畫
const CHIP_FADE_DELAY_MS = 600; // 掉回門檻以下後晚一點才真的隱藏（視覺上的淡出動畫本身在 chipEl() 的 CSS transition 裡）——避免 pending 數在門檻附近抖動時忽隱忽現

function chipEl() {
  let el = document.getElementById('photoreal-status'); if (el) return el;
  el = document.createElement('div'); el.id = 'photoreal-status';
  el.style.cssText = 'position:fixed;left:50%;top:136px;z-index:6;padding:4px 12px;border-radius:999px;' // #readout(60px)/#toast(100px) 下面留一行，避免疊在一起
    + 'font:11px var(--mono,ui-monospace,monospace);letter-spacing:.02em;color:var(--blue-300,#93DCE6);'
    + 'background:var(--panel-deep,rgba(3,7,18,.72));border:1px solid var(--line,rgba(74,85,101,.55));'
    + 'backdrop-filter:var(--blur,blur(12px));pointer-events:none;white-space:nowrap;opacity:0;'
    + 'transform:translate(-50%,-6px);transition:opacity .25s,transform .25s';
  document.body.appendChild(el); return el;
}
function showChip(text) { const el = chipEl(); el.textContent = text; el.style.opacity = '1'; el.style.transform = 'translate(-50%,0)'; }
function hideChip() { const el = document.getElementById('photoreal-status'); if (!el) return; el.style.opacity = '0'; el.style.transform = 'translate(-50%,-6px)'; }
const inScene = () => { const b = document.body.classList; return b.contains('cinema') || b.contains('presenting'); }; // 場景播放／簡報模式中：晶片一律不顯示（見 updateChip()），voicebar 才是敘事焦點，不需要這顆晶片跟它搶注意力

const isDynamic = prop => !!(prop && typeof prop.isConstant === 'boolean' && prop.isConstant === false); // CallbackProperty(fn,false) 之類的動態屬性：地面模式要跳過，不要打斷像時光機那樣「本來就該長高」的擠出動畫
const plGet = e => { const p = e.properties && e.properties.pl; try { return p ? p.getValue() : null; } catch { return null; } };

/**
 * @param {{viewer:import('cesium').Viewer, viewerApi:object, osm:object, layers:object, compose:object, ui:object}} ctx
 * @returns {{available:boolean, status:string, reason:string|null, active:boolean, enter():Promise<boolean>, exit():void, retry():Promise<boolean>, setQualityForScale(scale:string):void, setMotion(on:boolean):void, setNight(on:boolean):void, applyGroundMode(on:boolean):void, diagnostics():object}}
 */
export function createPhotoreal({ viewer, viewerApi, osm, layers, compose, ui }) {
  const scene = viewer.scene;
  const available = !!(viewerApi && viewerApi.hasGoogleKey); // viewer.js 已把 hasGoogleKey 擴大成「ion token 或 Google 金鑰任一存在」＝相片級到底能不能用
  const state = { status: 'idle', reason: null, active: false, night: false, groundOn: false, tileFailedCount: 0, pendingTiles: 0 };
  let tileset = null, progressCb = null, failedCb = null;
  const gmSaved = new Map(); // polygon/ellipse entity → 原本的 {height,extrudedHeight,classificationType}（地面模式關閉時還原）
  const clampSaved = new Map(); // billboard/point entity → 原本的 heightReference

  const currentScale = () => (compose && compose.scale) || (layers && layers.scale) || 'S3';

  /* ---- §18.1 效能：SSE = 尺度基準（baseSSE，setQualityForScale 換）× 是否在飛行/環繞中放寬（inMotion，
     setMotion 換）。兩者互相獨立，誰後呼叫都對——都只是重算同一個 tileset.maximumScreenSpaceError。 ---- */
  let baseSSE = SSE_FOR_SCALE.S3, inMotion = false;
  function applySSE() { if (tileset) tileset.maximumScreenSpaceError = inMotion ? baseSSE * MOTION_SSE_MULT : baseSSE; }
  function setQualityForScale(scale) {
    baseSSE = (inScene() && scale === 'S4') ? SSE_FOR_SCALE[CINEMA_SCALE_CAP] : (SSE_FOR_SCALE[scale] || 20); // 場景播放中就算鏡頭到了 S4（街景），也只用 S3 的寬鬆度
    if (!tileset) return;
    tileset.dynamicScreenSpaceError = true;
    tileset.skipLevelOfDetail = true;
    applySSE();
  }
  /** compose.js 在 camera.moveStart/moveEnd 呼叫：飛行／環繞中放寬 SSE，落地後（呼叫端自己 debounce）收緊。
   *  還沒有 tileset（尚未載入或已退出）時只記狀態，applySSE() 之後自然會用上，不會出錯。 */
  function setMotion(on) { on = !!on; if (on === inMotion) return; inMotion = on; applySSE(); }

  function setNight(on) {
    state.night = !!on;
    if (!tileset) return;
    tileset.style = state.night ? new Cesium.Cesium3DTileStyle({ color: NIGHT_TINT }) : undefined;
  }

  /* ---- §18.1 效能：實景顯示中的 GPU 側額外負擔——降 MSAA（FXAA 留著，viewer.js createViewer 的 msaaSamples:4
     只是「平常」的值）、放寬 globe 的 SSE／放大 tileCacheSize（底圖大多被 3D Tiles 蓋住看不到，不需要精細；
     tileCacheSize 加大順便幫到歷年航照時光機來回跳年份不用重抓）。存「進入前的值」而不是硬寫回 4/2/100：
     就算 viewer.js 之後改了預設值，這裡還是對得上。 ---- */
  let savedMsaa = null, savedGlobeSSE = null, savedGlobeCache = null;
  function applyPerfProfile(on) {
    if (on) {
      if (savedMsaa == null) savedMsaa = scene.msaaSamples;
      if (savedGlobeSSE == null) savedGlobeSSE = scene.globe.maximumScreenSpaceError;
      if (savedGlobeCache == null) savedGlobeCache = scene.globe.tileCacheSize;
      scene.msaaSamples = 1;
      scene.globe.maximumScreenSpaceError = 3;
      scene.globe.tileCacheSize = 400;
    } else {
      if (savedMsaa != null) scene.msaaSamples = savedMsaa;
      if (savedGlobeSSE != null) scene.globe.maximumScreenSpaceError = savedGlobeSSE;
      if (savedGlobeCache != null) scene.globe.tileCacheSize = savedGlobeCache;
      savedMsaa = savedGlobeSSE = savedGlobeCache = null;
    }
  }

  /* ---- §18.1 效能：#photoreal-status 防閃爍——見檔案開頭 CHIP_* 常數。第一次建立 tileset（initial load）
     一律立刻顯示；之後只有 pending 數持續超過門檻夠久才顯示，掉回門檻以下會晚一點才真的隱藏；場景播放／簡報
     模式中一律不顯示。用 MutationObserver 盯 body class 的做法跟 ui/insights.js 盯 body.d-annotated 是同一種
     慣例，不需要 ui.js／presenter.js 額外開一個 callback 給這個模組。 ---- */
  let pendingSinceT = null, chipVisible = false, chipCheckT = null, chipFadeT = null;
  function resetChip() { clearTimeout(chipCheckT); chipCheckT = null; clearTimeout(chipFadeT); chipFadeT = null; pendingSinceT = null; chipVisible = false; hideChip(); }
  function updateChip() {
    clearTimeout(chipCheckT); chipCheckT = null;
    if (inScene()) { clearTimeout(chipFadeT); chipFadeT = null; pendingSinceT = null; if (chipVisible) { hideChip(); chipVisible = false; } return; }
    if (state.status === 'loading' && !tileset) { clearTimeout(chipFadeT); chipFadeT = null; showChip('實景載入中…'); chipVisible = true; return; } // 第一次建立 tileset：一律立刻顯示
    const n = state.pendingTiles;
    if (n > CHIP_PENDING_THRESHOLD) {
      if (pendingSinceT == null) pendingSinceT = performance.now();
      const elapsed = performance.now() - pendingSinceT;
      if (elapsed >= CHIP_PENDING_DELAY_MS) { clearTimeout(chipFadeT); chipFadeT = null; showChip(`實景載入中 · ${n}`); chipVisible = true; }
      else chipCheckT = setTimeout(updateChip, CHIP_PENDING_DELAY_MS - elapsed); // 就算沒有下一次 loadProgress 事件，時間到也要重新判定一次
    } else {
      pendingSinceT = null;
      if (chipVisible && !chipFadeT) chipFadeT = setTimeout(() => { chipFadeT = null; chipVisible = false; hideChip(); }, CHIP_FADE_DELAY_MS);
    }
  }
  let bodyClassObserver = null;
  function watchBodyClass() { // 場景開始/結束（body.cinema 切換）要立刻反應，不等下一次 loadProgress 事件
    if (bodyClassObserver || typeof MutationObserver === 'undefined') return;
    bodyClassObserver = new MutationObserver(updateChip);
    bodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function detachListeners() {
    if (tileset) { try { if (progressCb) tileset.loadProgress.removeEventListener(progressCb); } catch { /* tileset gone */ } try { if (failedCb) tileset.tileFailed.removeEventListener(failedCb); } catch { /* tileset gone */ } }
    progressCb = failedCb = null;
  }

  async function enter() {
    if (!available) { state.status = 'failed'; state.reason = '沒有 Cesium ion 或 Google Maps 金鑰'; return false; }
    if (tileset) { tileset.show = true; state.active = true; afterShow(); return true; }
    if (state.status === 'failed') return false; // §18.1／deliverable 5：一個 session 只試一次，要重試呼叫 retry()
    state.status = 'loading'; state.reason = null; watchBodyClass(); updateChip();
    try {
      const t = await viewerApi.ensureGoogle({
        maximumScreenSpaceError: SSE_FOR_SCALE[currentScale()] || 20, dynamicScreenSpaceError: true, skipLevelOfDetail: true,
        // §18.1 效能（Phase 11P；完整理由見交接報告，這裡只留一句話版本）：
        dynamicScreenSpaceErrorFactor: 32, // 預設 24——內容密度越高，允許放寬的畫面誤差跟著調高，密集城市場景更快穩定，換取的是遠處/密集處更早變糊
        skipScreenSpaceErrorFactor: 24, skipLevels: 2, // 預設 16／1——更願意跳過中間 LOD 直接載入接近目標的一層，減少「一路疊 LOD、每疊一層都像重新 load」的觀感，代價是單次落地時的細節落差變大
        cullRequestsWhileMoving: false, // 預設 true：飛行中，目的地的 tile 會被「相機在動」的判定砍掉請求（實測 Cesium3DTilesetTraversal 的 isOnScreenLongEnough()，跟 preloadFlightDestinations 互相牴觸）——關掉讓目的地真的能在飛行途中就開始下載，trade-off 是飛行中請求量變高，靠 viewer.js 調高的 RequestScheduler 上限承接
        cacheBytes: GOOGLE_CACHE_BYTES, maximumCacheOverflowBytes: GOOGLE_CACHE_OVERFLOW_BYTES, // 明寫成跟 createGooglePhotorealistic3DTileset() 自己的預設一樣，見檔案開頭常數註解
        preloadFlightDestinations: true, // Cesium 1.124 預設本來就是 true，這裡明寫只是不想依賴「以後也還是預設」
      });
      if (!t) throw (viewerApi.googleError || new Error('建立 3D Tiles 失敗'));
      tileset = t; tileset.show = true;
      progressCb = (pending, processing) => { state.pendingTiles = pending + processing; updateChip(); };
      failedCb = err => { state.tileFailedCount++; console.warn('[photoreal] tileFailed', err && err.message); };
      tileset.loadProgress.addEventListener(progressCb);
      tileset.tileFailed.addEventListener(failedCb);
      state.status = 'ready'; state.active = true;
      afterShow();
      return true;
    } catch (e) {
      state.status = 'failed'; state.reason = (e && e.message) || String(e) || '未知錯誤';
      resetChip();
      ui && ui.toast && ui.toast(`實景載入失敗：${state.reason}，改用白模`);
      exit();
      return false;
    }
  }
  function afterShow() {
    if (osm && osm.setVisible) osm.setVisible(false);
    applyGroundMode(true);
    applyPerfProfile(true);
    setQualityForScale(currentScale());
    setNight(state.night);
    updateChip();
    compose && compose.apply && compose.apply(true);
  }
  function exit() {
    if (tileset) tileset.show = false;
    state.active = false; inMotion = false; resetChip();
    if (osm && osm.setVisible) osm.setVisible(true);
    applyGroundMode(false);
    applyPerfProfile(false);
    compose && compose.apply && compose.apply(true);
  }
  function retry() { detachListeners(); tileset = null; state.status = 'idle'; state.reason = null; state.tileFailedCount = 0; return enter(); }

  /* ---- §18.1 地面圖層貼附：既有多邊形／橢圓改用 classificationType，地面 icon 改用 CLAMP_TO_3D_TILE ----
     只 post-process 既有實體（不改 funraise.js／ground.js 的建圖邏輯），存檔／還原都keyed 在 entity 物件本身，
     反覆進出實景是冪等的（第二次 on 時 gmSaved 已經有記錄，直接 return，不會用「已經貼地」的值覆蓋原始存檔）。 */
  const polyEntitiesOf = dsKey => { const ds = layers && layers.ds && layers.ds[dsKey]; return ds ? [...ds.entities.values] : []; };
  function applyGroundMode(on) {
    on = !!on; if (on === state.groundOn) return; state.groundOn = on;
    for (const key of GM_POLY_LAYERS) for (const e of polyEntitiesOf(key)) {
      const g = e.polygon || e.ellipse; if (!g) continue;
      if (on) {
        if (isDynamic(g.extrudedHeight)) continue; // 時光機的 3D 長條圖是「本來就該長高」的擠出動畫，保留原樣
        if (gmSaved.has(e)) continue;
        gmSaved.set(e, { height: g.height, extrudedHeight: g.extrudedHeight, classificationType: g.classificationType });
        g.height = undefined; g.extrudedHeight = undefined; g.classificationType = Cesium.ClassificationType.BOTH;
      } else {
        const orig = gmSaved.get(e); if (!orig) continue;
        g.height = orig.height; g.extrudedHeight = orig.extrudedHeight; g.classificationType = orig.classificationType;
        gmSaved.delete(e);
      }
    }
    const renewalIcons = polyEntitiesOf('labels').filter(e => { const pl = plGet(e); return pl && pl.layer === 'renewal'; });
    for (const e of [...GM_ICON_LAYERS.flatMap(polyEntitiesOf), ...renewalIcons]) {
      const g = e.billboard || e.point; if (!g) continue;
      if (on) { if (clampSaved.has(e)) continue; clampSaved.set(e, g.heightReference); g.heightReference = Cesium.HeightReference.CLAMP_TO_3D_TILE; }
      else { if (!clampSaved.has(e)) continue; g.heightReference = clampSaved.get(e); clampSaved.delete(e); }
    }
    // 附註：YouBike 站點（live/youbike.js）也該在地面模式下 CLAMP_TO_3D_TILE，但它目前沒有對外暴露自己的
    // CustomDataSource／entities（回傳的公開 API 只有 setVisible/refresh/setTheme/count），這個 phase 沒有
    // 拿到能改它的授權範圍，先跳過——見交接報告。
  }

  function diagnostics() {
    return { available, status: state.status, reason: state.reason, active: state.active, night: state.night, groundMode: state.groundOn, tileFailedCount: state.tileFailedCount, pendingTiles: state.pendingTiles, hasTileset: !!tileset, scale: currentScale(), inMotion, maximumScreenSpaceError: tileset ? tileset.maximumScreenSpaceError : null };
  }

  return {
    available, get status() { return state.status; }, get reason() { return state.reason; }, get active() { return state.active; },
    enter, exit, retry, setQualityForScale, setMotion, setNight, applyGroundMode, diagnostics,
  };
}
