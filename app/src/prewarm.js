// Phase 11 「load 網頁的時候把地政場景先 pre-render 好」— 場景鏡頭預熱（docs/11-v2-cesium-app.md §20.2）。
// Cesium 沒有「預載某個視角的 tiles」的 API（preloadFlightDestinations 只在飛行途中對目的地生效），但 tileset 的
// 記憶體快取（Google 相片級預設 1.5 GiB）會留住最近幾個畫面用過的 tile。所以預熱就是：趁 #loading 遮罩還蓋著（或
// 開播前蓋一層「場景準備中」），把相機依序「瞬移」到場景每一段的機位，各停到 tileset.tilesLoaded／globe.tilesLoaded
// 回報「這一幀需要的 tile 都到了」為止（每個機位最多 perViewMs，總共最多 totalMs），最後把相機放回原位。
// 之後場景真的飛到那些機位時，tile 已經在快取裡，鏡頭一到就是清楚的，不會「鏡頭帶過去了、畫面還糊」。
import * as Cesium from 'cesium';
const D2R = Math.PI / 180;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function settled(viewer, tileset) {
  const g = viewer.scene.globe; const gOk = !g || g.tilesLoaded !== false; const tOk = !tileset || !tileset.show || tileset.tilesLoaded !== false;
  return gOk && tOk;
}
/** views: [{lon, lat, range, pitch, heading, alt}] — same numbers a scene step hands CameraRig.flyTo(); returns {views, ms, settledViews}. */
export async function prewarmViews({ viewer, tileset, views, perViewMs = 3500, totalMs = 26000, onProgress, minDwellMs = 350 }) {
  const list = (views || []).filter(v => v && Number.isFinite(+v.lon) && Number.isFinite(+v.lat));
  if (!viewer || !list.length) return { views: 0, settledViews: 0, ms: 0 };
  const cam = viewer.camera; const saved = { position: cam.position.clone(), heading: cam.heading, pitch: cam.pitch, roll: cam.roll };
  const t0 = now(); let done = 0, settledViews = 0;
  for (const v of list) {
    if (now() - t0 > totalMs) break;
    onProgress && onProgress(done, list.length, v);
    try {
      const target = Cesium.Cartesian3.fromDegrees(+v.lon, +v.lat, +v.alt || 0);
      cam.lookAt(target, new Cesium.HeadingPitchRange((+v.heading || 0) * D2R, (Number.isFinite(+v.pitch) ? +v.pitch : -45) * D2R, Math.max(50, +v.range || 1500)));
      cam.lookAtTransform(Cesium.Matrix4.IDENTITY); // keep the pose, drop the look-at constraint (same as CameraRig after a flight)
    } catch (e) { console.warn('[prewarm] view failed', v, e); done++; continue; }
    const tStep = now();
    const ok = await new Promise(res => { const tick = () => { const dt = now() - tStep; if (dt >= minDwellMs && settled(viewer, tileset)) return res(true); if (dt > perViewMs) return res(false); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    if (ok) settledViews++; done++;
  }
  try { cam.setView({ destination: saved.position, orientation: { heading: saved.heading, pitch: saved.pitch, roll: saved.roll } }); } catch { /* ignore */ }
  onProgress && onProgress(done, list.length, null);
  return { views: done, settledViews, ms: Math.round(now() - t0) };
}
/** Resolve a scene's declared camera views: `scene.views` may be an array or a function of the director ctx. */
export function sceneViews(scene, ctx) {
  if (!scene) return []; let v = scene.views; if (typeof v === 'function') { try { v = v(ctx); } catch (e) { console.warn('[prewarm] scene.views failed', e); v = []; } }
  return Array.isArray(v) ? v : [];
}
