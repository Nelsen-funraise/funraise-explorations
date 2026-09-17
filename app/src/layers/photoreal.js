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
import * as Cesium from 'cesium';

const SSE_FOR_SCALE = { S4: 12, S3: 16, S2: 24, S1: 32, S0: 32 }; // §18.1／§18.1「效能」：尺度越遠，容許的畫面誤差越大
const NIGHT_TINT = "color('#7FA6C8', 1.0)"; // 建構灰藍：Google tiles 是白天空拍，沒有夜景素材，只能整體調色模擬藍調夜景
const GM_POLY_LAYERS = ['renewal', 'zones', 'parks', 'heat', 'tm']; // §18.1 地面圖層貼附：多邊形／橢圓 → classificationType
const GM_ICON_LAYERS = ['licenses', 'mrt']; // 地面 icon → CLAMP_TO_3D_TILE（建物 icon 沿用 _h，不在這裡碰）

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

const isDynamic = prop => !!(prop && typeof prop.isConstant === 'boolean' && prop.isConstant === false); // CallbackProperty(fn,false) 之類的動態屬性：地面模式要跳過，不要打斷像時光機那樣「本來就該長高」的擠出動畫
const plGet = e => { const p = e.properties && e.properties.pl; try { return p ? p.getValue() : null; } catch { return null; } };

/**
 * @param {{viewer:import('cesium').Viewer, viewerApi:object, osm:object, layers:object, compose:object, ui:object}} ctx
 * @returns {{available:boolean, status:string, reason:string|null, active:boolean, enter():Promise<boolean>, exit():void, retry():Promise<boolean>, setQualityForScale(scale:string):void, setNight(on:boolean):void, applyGroundMode(on:boolean):void, diagnostics():object}}
 */
export function createPhotoreal({ viewer, viewerApi, osm, layers, compose, ui }) {
  const available = !!(viewerApi && viewerApi.hasGoogleKey); // viewer.js 已把 hasGoogleKey 擴大成「ion token 或 Google 金鑰任一存在」＝相片級到底能不能用
  const state = { status: 'idle', reason: null, active: false, night: false, groundOn: false, tileFailedCount: 0, pendingTiles: 0 };
  let tileset = null, progressCb = null, failedCb = null;
  const gmSaved = new Map(); // polygon/ellipse entity → 原本的 {height,extrudedHeight,classificationType}（地面模式關閉時還原）
  const clampSaved = new Map(); // billboard/point entity → 原本的 heightReference

  const currentScale = () => (compose && compose.scale) || (layers && layers.scale) || 'S3';

  function setQualityForScale(scale) {
    if (!tileset) return;
    tileset.maximumScreenSpaceError = SSE_FOR_SCALE[scale] || 16;
    tileset.dynamicScreenSpaceError = true;
    tileset.skipLevelOfDetail = true;
  }
  function setNight(on) {
    state.night = !!on;
    if (!tileset) return;
    tileset.style = state.night ? new Cesium.Cesium3DTileStyle({ color: NIGHT_TINT }) : undefined;
  }

  function detachListeners() {
    if (tileset) { try { if (progressCb) tileset.loadProgress.removeEventListener(progressCb); } catch { /* tileset gone */ } try { if (failedCb) tileset.tileFailed.removeEventListener(failedCb); } catch { /* tileset gone */ } }
    progressCb = failedCb = null;
  }

  async function enter() {
    if (!available) { state.status = 'failed'; state.reason = '沒有 Cesium ion 或 Google Maps 金鑰'; return false; }
    if (tileset) { tileset.show = true; state.active = true; afterShow(); return true; }
    if (state.status === 'failed') return false; // §18.1／deliverable 5：一個 session 只試一次，要重試呼叫 retry()
    state.status = 'loading'; state.reason = null; showChip('實景載入中…');
    try {
      const t = await viewerApi.ensureGoogle({ maximumScreenSpaceError: SSE_FOR_SCALE[currentScale()] || 16, dynamicScreenSpaceError: true, skipLevelOfDetail: true });
      if (!t) throw (viewerApi.googleError || new Error('建立 3D Tiles 失敗'));
      tileset = t; tileset.show = true;
      progressCb = (pending, processing) => { state.pendingTiles = pending + processing; if (state.pendingTiles > 0) showChip(`實景載入中 · ${state.pendingTiles}`); else hideChip(); };
      failedCb = err => { state.tileFailedCount++; console.warn('[photoreal] tileFailed', err && err.message); };
      tileset.loadProgress.addEventListener(progressCb);
      tileset.tileFailed.addEventListener(failedCb);
      state.status = 'ready'; state.active = true;
      afterShow();
      return true;
    } catch (e) {
      state.status = 'failed'; state.reason = (e && e.message) || String(e) || '未知錯誤';
      hideChip();
      ui && ui.toast && ui.toast(`實景載入失敗：${state.reason}，改用白模`);
      exit();
      return false;
    }
  }
  function afterShow() {
    if (osm && osm.setVisible) osm.setVisible(false);
    applyGroundMode(true);
    setQualityForScale(currentScale());
    setNight(state.night);
    compose && compose.apply && compose.apply(true);
  }
  function exit() {
    if (tileset) tileset.show = false;
    state.active = false; hideChip();
    if (osm && osm.setVisible) osm.setVisible(true);
    applyGroundMode(false);
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
    return { available, status: state.status, reason: state.reason, active: state.active, night: state.night, groundMode: state.groundOn, tileFailedCount: state.tileFailedCount, pendingTiles: state.pendingTiles, hasTileset: !!tileset, scale: currentScale() };
  }

  return {
    available, get status() { return state.status; }, get reason() { return state.reason; }, get active() { return state.active; },
    enter, exit, retry, setQualityForScale, setNight, applyGroundMode, diagnostics,
  };
}
