// src/layers/groundmode.js — Phase 10P 地面圖層貼附共用邏輯（docs/11-v2-cesium-app.md §18.1）。
// 白模時地面疊圖（等時圈／生活圈的填色）用固定的小高度（例如 0.4m）擠出一點點，避免跟地面 z-fighting；
// 那個小高度是量給「平的橢球地面」用的。實景（Google Photorealistic 3D Tiles）底下地表不再是平的橢球，
// 而是有真正起伏的空拍網格，固定 0.4m 這種絕對高度只會讓疊圖忽而穿模、忽而浮空——正確做法是完全不給
// height/extrudedHeight，改用 classificationType 讓 Cesium 直接把多邊形「投影貼」在地形／3D Tiles 表面上
// （沒有 3D Tiles 時會退回貼在地形／橢球上，效果等同原本的地面疊圖，見 photoreal.js 的 applyGroundMode()）。
//
// isochrone.js／walkshed.js 動態產生新圖形時（等時圈波前、生活圈填色…）呼叫這裡的 groundPolygon()：
// `on` 讀呼叫端自己判斷的地面模式旗標（例如 window.PL.map.groundMode，由 compose.js／photoreal.js 在進出
// 「實景」時維護），沒有特別旗標就當作 false，照給的 height/extrudedHeight 正常畫，跟現在完全一樣。
import * as Cesium from 'cesium';

/**
 * @param {{on?:boolean, height?:number, extrudedHeight?:number}} [opts]
 * @returns {{classificationType:Cesium.ClassificationType}|{height:number|undefined, extrudedHeight:number|undefined}}
 *   `on` 為真：回傳只有 classificationType 的物件（height/extrudedHeight 留空＝不擠出，貼地）；
 *   `on` 為假（含省略）：原樣回傳 height/extrudedHeight，行為與呼叫前完全一樣。
 */
export function groundPolygon({ on, height, extrudedHeight } = {}) {
  return on ? { classificationType: Cesium.ClassificationType.BOTH } : { height, extrudedHeight };
}
