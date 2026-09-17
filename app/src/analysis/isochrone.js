// 捷運等時圈（MRT isochrone）— 全自製、不打外部 API，完全用 taipei_basemap.json 內建的捷運路網幾何計算。
//
/**
 * @module analysis/isochrone
 *
 * 這個模組回答「從某個點出發，N 分鐘內搭捷運可以到哪裡」，資料與運算全部在前端完成：
 * 沒有 Google/OTP/路徑規劃 API，只用 `taipei_basemap.json` 的 `mrt_lines`（每條線的路權幾何，
 * 可能拆成很多段 `coords` — 實測台北捷運 6 條線合計拆成 39～100 段不等的小折線，是 OSM way
 * 匯出常見的現象）與 `mrt_stations`（100 站，`lines: string[]` 標出轉乘站屬於哪幾條線）。
 *
 * ── MrtNetwork：怎麼把「一堆折線片段＋一串車站點」變成一張可以跑 Dijkstra 的圖 ──
 * 1. 每條線的所有 `coords` 線段（不論幾段、順序如何）先攤平成一個「細顆粒」點雲＋鄰接邊
 *    （同一段內相鄰頂點連邊，權重＝球面距離）。
 * 2. 用一個約 15m 的空間網格把「同一個實體轉折點」但來自不同線段的頂點合併成同一個節點——
 *    實測這些線段幾乎都在共用端點處精準銜接（中位數距離 0m），合併後每條線都收斂成單一
 *    連通元件，不需要假設段落順序或方向。
 * 3. 這條線的每個車站，snap 到細圖裡最近的節點（誤差量測約 0～20m，相對於百公尺級的站距可忽略）。
 * 4. 從「每個車站的 snap 節點」同時做一次多源 Dijkstra（每個車站當一個種子，距離 0），
 *    幫細圖上每個節點標出「離它最近的車站」（owner）與到該站的距離。這其實就是在細圖上做
 *    車站的 Voronoi 切割。
 * 5. 任何一條細圖邊，如果它兩端的 owner 不同，代表這裡剛好是兩個車站勢力範圍的交界——
 *    這兩個車站在真實路網上就是「相鄰站」（中間沒有其他站），邊權重＝
 *    dist(u→owner(u)) + edge(u,v) + dist(v→owner(v))（沿軌道的真實距離，非直線距離）。
 *    這個做法對分岔線（例如中和新蘆線在大橋頭分成蘆洲／迴龍兩支）是自然正確的：Voronoi
 *    交界本來就會分別落在兩個分岔各自最近的相鄰站之間，不需要另外偵測「這是分岔」。
 * 6. 同名車站（`lines` 長度 > 1，例如台北車站＝板南線＋淡水信義線）在第 1 步就已經是同一個
 *    `stations` 節點，天然就是轉乘站；轉乘用一條「同站不同線」的虛擬邊處理（見下）。
 *
 * ── 交通時間模型（唯一真實來源，其他地方不要重算）──
 * - 每一段（相鄰兩站）搭乘時間（分鐘）＝ max(1.5, 該段沿線距離(km) / 35 * 60 + 0.7)
 *   → 最短 1.5 分（起步／進站減速的下限），否則用「35km/h 平均營運速度＋0.7 分停靠時間」估。
 * - 轉乘（同一站、換一條線）固定加 4 分鐘。
 * - 從任意一點走到最近車站：distM / 80 (m/min)，即 4.8km/h 的步行速度。
 *   （IsochroneLayer 用這個時間當 Dijkstra 的起始 offset，即 `reach()` 的 `opts.startMinutes`。）
 * - 可選：呼叫 `MrtNetwork#setTravelTimes(hops)` 灌入真實站間秒數（例如 TDX S2STravelTime）後，
 *   個別邊的搭乘時間會改用真實秒數，其餘邏輯（轉乘 4 分、步行時速）不變；沒呼叫這個方法時，
 *   一切照舊用上面這條距離估算式，見該方法的 JSDoc。
 *
 * `MrtNetwork` 本身是純 JS（無 Cesium 依賴，可以直接在 Node 下 `import` 測試）；只有
 * `IsochroneLayer` 需要 Cesium 來畫圖。
 *
 * ── IsochroneLayer（Cesium 1.124 entities）──
 * `new IsochroneLayer(viewer, network)` 建立一個獨立的 `CustomDataSource('isochrone')`。
 * `show({ lon, lat, name, maxMin, bands })`：
 *   - 走路可及圈：原點一個半透明 PickPeak 藍（#16A4C0）的地面橢圓，固定半徑＝8 分鐘步行
 *     ≈ 640m（純視覺參考圈，非依實際最近站距離縮放）。
 *   - 可達車站：依時間分帶著色＋大小（≤10 分 #16A4C0、≤20 分 #0C83A2、≤30 分 #0F6A85，
 *     等於 style.css 的 --blue-500/600/700），小字標籤「站名 · 12 分」。
 *   - 實際走過的路徑：用 `PolylineGlowMaterialProperty`，顏色照各線官方配色（與 buildMrt()
 *     使用的同一套色碼），只畫 Dijkstra 樹上真的用到的邊（不會每個可達站都畫一條到原點的
 *     直線）。
 *   - 動畫「波前」：一個從 0 長到最外圈半徑的地面橢圓，~1.6 秒 ease-out，用 `CallbackProperty`
 *     驅動，長到底後留一圈淡淡的邊界線「定住」。
 *   - `setTheme('light'|'dark')`：文字／背景在兩個主題下都要能讀（跟 FunraiseLayers.setTheme
 *     同一套「深色主題用亮色字＋深色底；淺色主題用深色字＋白底」邏輯）。
 *   - entity 數量上限抓 ~250：站數上限本來就是 100，樹狀邊數 ≤ 站數，加上 3 個固定的圈／
 *     原點 entity，正常情況下遠低於上限；仍加了防呆裁切。
 *   - 回傳一個敘述用的摘要物件（見 `show()` 的 JSDoc），另外把可達站清單存在
 *     `this.lastStations`、樹狀邊存在 `this.lastEdges`，給呼叫端要更細資料時用。
 */

import * as Cesium from 'cesium';

/* >>> PURE HELPERS (no Cesium) — everything down to the MrtNetwork class close is plain JS with no
   Cesium dependency (see module JSDoc above). isochrone.test.mjs extracts this exact block by these
   markers and evals it in an isolated Function scope, the same trick src/tools/measure.test.mjs uses,
   because plain Node cannot `import` this file (it statically imports 'cesium', which pulls in a
   @zip.js/zip.js subpath Node's resolver rejects — confirmed empirically in this project). */
/* ---------------- 共用幾何 / 時間模型 ---------------- */
const R_EARTH = 6371000;
const toRad = d => d * Math.PI / 180;
/** 兩個經緯度點之間的球面距離（公尺）。 */
const haversine = (lon1, lat1, lon2, lat2) => {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
};
/**
 * 最短距離：點 (lon,lat) 到一條折線 `path`（[[lon,lat],…]）的最近距離（公尺），用局部等距投影
 * 逐段算點到線段的垂距。只在建圖時用來偵測「捷徑」邊（見下方 SHORTCUT_TOL_M 的用法）。
 */
const pointToPolylineDist = (lon, lat, path) => {
  const lat0 = path[0][1], mPerLon = 111320 * Math.cos(toRad(lat0)), mPerLat = 110540;
  const toXY = ([lo, la]) => [(lo - path[0][0]) * mPerLon, (la - path[0][1]) * mPerLat];
  const p = toXY([lon, lat]); let best = Infinity, prev = toXY(path[0]);
  for (let i = 1; i < path.length; i++) {
    const cur = toXY(path[i]); const dx = cur[0] - prev[0], dy = cur[1] - prev[1]; const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p[0] - prev[0]) * dx + (p[1] - prev[1]) * dy) / len2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p[0] - (prev[0] + t * dx), p[1] - (prev[1] + t * dy)); if (d < best) best = d; prev = cur;
  }
  return best;
};

const WALK_MPM = 80;      // 步行速度 80 m/min ≈ 4.8 km/h
const RIDE_KMH = 35;      // 列車平均營運速度（含加減速、非峰值時速）
const DWELL_MIN = 0.7;    // 每站停靠時間
const MIN_HOP_MIN = 1.5;  // 每一段最短時間（起步／煞車下限，即使兩站相鄰很近也不會低於此值）
const TRANSFER_MIN = 4;   // 同站換線的固定轉乘時間
const NODE_MERGE_M = 15;  // 細圖節點合併容差；實測線段幾乎都在共用端點精準銜接（中位數 0m）
const SHORTCUT_TOL_M = 70; // 「捷徑」偵測容差：候選邊的實際路徑若貼著第三個同線車站（誤差內），代表中間漏了一站，整條邊作廢

/** 相鄰兩站的搭乘時間（分鐘）——本模組對「每一段」時間的唯一計算式。 */
const hopMinutes = distM => Math.max(MIN_HOP_MIN, (distM / 1000 / RIDE_KMH) * 60 + DWELL_MIN);

/** 精簡 Union-Find（路徑減半＋按秩合併），只在建圖時用一次。 */
class UF {
  constructor(n) { this.p = new Int32Array(n).map((_, i) => i); this.r = new Uint8Array(n); }
  find(x) { while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; } return x; }
  union(a, b) { a = this.find(a); b = this.find(b); if (a === b) return; if (this.r[a] < this.r[b]) [a, b] = [b, a]; this.p[b] = a; if (this.r[a] === this.r[b]) this.r[a]++; }
}

/**
 * 台北捷運路網圖：由 `taipei_basemap.json` 的 mrt_lines + mrt_stations 建出來，
 * 純資料結構＋圖論運算，不依賴 Cesium，可在 Node 下單獨測試。
 */
export class MrtNetwork {
  /** @param {{mrt_lines?: any[], mrt_stations?: any[]}} basemap taipei_basemap.json 的內容 */
  constructor(basemap) {
    /** @type {Map<string,{name:string,lon:number,lat:number,lines:Set<string>}>} 站名 → 節點（同名站＝同一節點＝轉乘站） */
    this.stations = new Map();
    /** @type {Map<string, Array<{to:string,distM:number,minutes:number,line:string,path:[number,number][]}>>} 站名 → 相鄰站邊（無向，雙向各存一筆） */
    this.adj = new Map();
    for (const s of (basemap && basemap.mrt_stations) || []) {
      if (this.stations.has(s.name)) { const st = this.stations.get(s.name); for (const l of s.lines || []) st.lines.add(l); continue; }
      this.stations.set(s.name, { name: s.name, lon: s.lon, lat: s.lat, lines: new Set(s.lines || []) });
    }
    for (const name of this.stations.keys()) this.adj.set(name, []);
    for (const line of (basemap && basemap.mrt_lines) || []) this._absorbLine(line);
  }

  /** 把一條線的所有 coords 段落合併成細圖、切出各站的相鄰邊（見檔頭 ①～⑤）。 */
  _absorbLine(line) {
    const stations = [...this.stations.values()].filter(s => s.lines.has(line.name));
    if (stations.length < 2) return;
    // 1) 攤平所有線段的頂點 + 段內鄰接邊
    const pts = []; const rawEdges = [];
    for (const seg of line.coords || []) {
      if (!seg || seg.length < 2) continue;
      const base = pts.length;
      for (const p of seg) pts.push(p);
      for (let i = 1; i < seg.length; i++) rawEdges.push([base + i - 1, base + i]);
    }
    if (!pts.length) return;
    // 2) 空間網格合併近重合頂點（不同線段但實體上同一個轉折點）
    const CELL = 0.00015; // ≈15m at this latitude
    const cx = p => Math.round(p[0] / CELL), cy = p => Math.round(p[1] / CELL);
    const grid = new Map();
    for (let i = 0; i < pts.length; i++) { const k = cx(pts[i]) + ',' + cy(pts[i]); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i); }
    const uf = new UF(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const gx = cx(pts[i]), gy = cy(pts[i]);
      for (let ddx = -1; ddx <= 1; ddx++) for (let ddy = -1; ddy <= 1; ddy++) {
        const bucket = grid.get((gx + ddx) + ',' + (gy + ddy)); if (!bucket) continue;
        for (const j of bucket) { if (j <= i) continue; if (haversine(pts[i][0], pts[i][1], pts[j][0], pts[j][1]) <= NODE_MERGE_M) uf.union(i, j); }
      }
    }
    // 3) 建去重後的細圖節點與鄰接表
    const nodeIdOf = new Map(); const nodeLon = [], nodeLat = [], nAdj = [];
    const idFor = i => { const r = uf.find(i); let id = nodeIdOf.get(r); if (id == null) { id = nodeLon.length; nodeIdOf.set(r, id); nodeLon.push(pts[i][0]); nodeLat.push(pts[i][1]); nAdj.push([]); } return id; };
    for (const [i, j] of rawEdges) { const a = idFor(i), b = idFor(j); if (a === b) continue; const d = haversine(nodeLon[a], nodeLat[a], nodeLon[b], nodeLat[b]); if (d <= 0) continue; nAdj[a].push([b, d]); nAdj[b].push([a, d]); }
    const N = nodeLon.length;
    // 4) 每個車站 snap 到細圖裡最近的節點
    const anchor = new Map();
    for (const s of stations) { let best = Infinity, bi = -1; for (let k = 0; k < N; k++) { const d = haversine(s.lon, s.lat, nodeLon[k], nodeLat[k]); if (d < best) { best = d; bi = k; } } anchor.set(s.name, bi); }
    // 5) 多源 Dijkstra：每站的 anchor 節點當種子，幫細圖每個節點標出最近車站（owner）與距離
    const dist = new Float64Array(N).fill(Infinity), owner = new Int32Array(N).fill(-1), parent = new Int32Array(N).fill(-1), visited = new Uint8Array(N);
    const ownerName = stations.map(s => s.name);
    stations.forEach((s, oi) => { const a = anchor.get(s.name); if (a >= 0 && dist[a] > 0) { dist[a] = 0; owner[a] = oi; } });
    for (let iter = 0; iter < N; iter++) {
      let u = -1, best = Infinity; for (let k = 0; k < N; k++) if (!visited[k] && dist[k] < best) { best = dist[k]; u = k; }
      if (u < 0) break; visited[u] = 1;
      for (const [v, w] of nAdj[u]) { const nd = dist[u] + w; if (nd < dist[v] - 1e-9) { dist[v] = nd; owner[v] = owner[u]; parent[v] = u; } }
    }
    // 6) owner 不同的細圖邊＝兩個車站勢力範圍的交界＝真實的「相鄰站」邊
    const bestPair = new Map();
    for (let u = 0; u < N; u++) for (const [v, w] of nAdj[u]) {
      if (u >= v) continue; // 每條無向邊只處理一次
      if (owner[u] < 0 || owner[v] < 0 || owner[u] === owner[v]) continue;
      const total = dist[u] + w + dist[v];
      const a = ownerName[owner[u]], b = ownerName[owner[v]]; const key = a < b ? a + '|' + b : b + '|' + a;
      const cur = bestPair.get(key); if (!cur || total < cur.distM) bestPair.set(key, { distM: total, uNode: u, vNode: v });
    }
    // 7) 重建每個相鄰邊的實際幾何路徑；若路徑貼著第三個同線車站（誤差內＝中間漏了一站），視為
    //    捷徑作廢（這種情況偶爾發生在細圖有局部複線／道岔的路段，此時真正的兩段邊本來就都存在，
    //    捨棄捷徑不會讓圖斷開）。通過檢查的才登記進 this.adj（雙向各一筆，path 依方向排列）。
    const pathFromAnchor = node => { const seq = []; let c = node; while (c !== -1) { seq.push([nodeLon[c], nodeLat[c]]); c = parent[c]; } return seq.reverse(); };
    for (const { distM, uNode, vNode } of bestPair.values()) {
      const aName = ownerName[owner[uNode]], bName = ownerName[owner[vNode]];
      const pathToU = pathFromAnchor(uNode), pathToV = pathFromAnchor(vNode);
      const full = pathToU.concat(pathToV.slice().reverse()); // [A,…,u, v,…,B]
      const shortcut = stations.some(o => o.name !== aName && o.name !== bName && pointToPolylineDist(o.lon, o.lat, full) <= SHORTCUT_TOL_M);
      if (shortcut) continue;
      const minutes = hopMinutes(distM);
      this.adj.get(aName).push({ to: bName, distM, minutes, _heurMinutes: minutes, line: line.name, path: full });
      this.adj.get(bName).push({ to: aName, distM, minutes, _heurMinutes: minutes, line: line.name, path: full.slice().reverse() });
    }
    // 8) 連通性修復：極少數路段（實測僅淡水信義線的大安↔大安森林公園一帶）因為原始資料在該
    //    小段有近乎平行的複線幾何，兩條並行鏈各自形成 Voronoi 邊界，導致這兩站之間反而沒切出
    //    任何一條邊。保險起見，若這條線的車站被切成好幾個連通塊，直接把「跨塊最近的車站對」
    //    用直線距離連起來（相鄰站的直線距離本來就很接近沿線距離，不會扭曲時間模型），
    //    確保同一條線的車站永遠連通、reach() 不會漏站。
    if (stations.length > 1) {
      const idx = new Map(stations.map((s, i) => [s.name, i]));
      const cuf = new UF(stations.length);
      for (const s of stations) for (const e of this.adj.get(s.name)) if (e.line === line.name && idx.has(e.to)) cuf.union(idx.get(s.name), idx.get(e.to));
      for (;;) {
        if (new Set(stations.map((_, i) => cuf.find(i))).size <= 1) break;
        let best = null;
        for (let i = 0; i < stations.length; i++) for (let j = i + 1; j < stations.length; j++) {
          if (cuf.find(i) === cuf.find(j)) continue;
          const d = haversine(stations[i].lon, stations[i].lat, stations[j].lon, stations[j].lat);
          if (!best || d < best.d) best = { i, j, d };
        }
        if (!best) break;
        const a = stations[best.i], bS = stations[best.j], d = best.d, minutes = hopMinutes(d);
        this.adj.get(a.name).push({ to: bS.name, distM: d, minutes, _heurMinutes: minutes, line: line.name, path: [[a.lon, a.lat], [bS.lon, bS.lat]] });
        this.adj.get(bS.name).push({ to: a.name, distM: d, minutes, _heurMinutes: minutes, line: line.name, path: [[bS.lon, bS.lat], [a.lon, a.lat]] });
        cuf.union(best.i, best.j);
      }
    }
  }

  _key(name, line) { return name + '' + (line || ''); }

  /**
   * 離 (lon,lat) 最近的捷運站（球面直線距離，不是路網距離）。
   * @returns {{station:{name:string,lon:number,lat:number,lines:string[]}, distM:number}|null}
   */
  nearestStation(lon, lat) {
    let best = null, bd = Infinity;
    for (const s of this.stations.values()) { const d = haversine(lon, lat, s.lon, s.lat); if (d < bd) { bd = d; best = s; } }
    return best ? { station: { name: best.name, lon: best.lon, lat: best.lat, lines: [...best.lines] }, distM: bd } : null;
  }

  /**
   * 從一個車站出發，maxMin 分鐘內可達的所有站，同時回傳 Dijkstra 樹上真正走過的邊
   * （給 IsochroneLayer 畫路徑用；`reach()` 只回傳站清單那部分）。
   * 內部用「(站, 抵達時搭的線)」當節點展開圖，這樣才能正確算轉乘：同一站换線要加 4 分鐘，
   * 沿同一條線繼續搭則不用。
   * @param {string} fromStationName
   * @param {number} maxMin
   * @param {{startMinutes?:number, transferMin?:number}} [opts] startMinutes：進入路網前已經花掉的時間（例如走路到站的時間），會整個 Dijkstra 平移這個 offset。
   */
  reachDetailed(fromStationName, maxMin, opts = {}) {
    const from = this.stations.get(fromStationName);
    if (!from) return { stations: [], edges: [] };
    const startMin = Math.max(0, opts.startMinutes || 0);
    const transferMin = opts.transferMin != null ? opts.transferMin : TRANSFER_MIN;
    if (startMin > maxMin + 1e-9) return { stations: [], edges: [] };
    const dist = new Map(), prevKey = new Map(), prevType = new Map(), prevRide = new Map();
    const startLines = from.lines.size ? [...from.lines] : [null];
    for (const line of startLines) { const k = this._key(from.name, line); dist.set(k, startMin); prevKey.set(k, null); prevType.set(k, 'start'); }
    const visited = new Set();
    for (;;) {
      let uk = null, ud = Infinity;
      for (const [k, d] of dist) if (!visited.has(k) && d < ud) { ud = d; uk = k; }
      if (uk == null || ud > maxMin + 1e-9) break;
      visited.add(uk);
      const sep = uk.indexOf(''); const uName = uk.slice(0, sep); const uLine = uk.slice(sep + 1) || null;
      for (const e of this.adj.get(uName) || []) {
        if (uLine != null && e.line !== uLine) continue; // 只沿同一條線走到下一站
        const vk = this._key(e.to, e.line); const nd = ud + e.minutes;
        if (nd <= maxMin + 1e-9 && (!dist.has(vk) || nd < dist.get(vk) - 1e-9)) { dist.set(vk, nd); prevKey.set(vk, uk); prevType.set(vk, 'ride'); prevRide.set(vk, { from: uName, to: e.to, line: e.line }); }
      }
      if (uLine != null) { // 同站換線
        const node = this.stations.get(uName);
        for (const otherLine of node.lines) {
          if (otherLine === uLine) continue;
          const vk = this._key(uName, otherLine); const nd = ud + transferMin;
          if (nd <= maxMin + 1e-9 && (!dist.has(vk) || nd < dist.get(vk) - 1e-9)) { dist.set(vk, nd); prevKey.set(vk, uk); prevType.set(vk, 'transfer'); }
        }
      }
    }
    // 化簡：每站取所有 (站,線) 狀態裡時間最短的那個
    const bestByStation = new Map();
    for (const [k, d] of dist) { if (d > maxMin + 1e-9) continue; const sep = k.indexOf(''); const name = k.slice(0, sep); const cur = bestByStation.get(name); if (!cur || d < cur.d) bestByStation.set(name, { d, k }); }
    const stationsOut = []; const edgeKeys = new Set(); const edgesOut = [];
    for (const [name, { d, k }] of bestByStation) {
      const s = this.stations.get(name); let transfers = 0; let ck = k;
      while (prevKey.get(ck)) {
        const ty = prevType.get(ck);
        if (ty === 'transfer') transfers++;
        else if (ty === 'ride') { const r = prevRide.get(ck); const ek = r.from + '>' + r.to + '@' + r.line; if (!edgeKeys.has(ek)) { edgeKeys.add(ek); const edge = (this.adj.get(r.from) || []).find(x => x.to === r.to && x.line === r.line); if (edge) edgesOut.push(edge); } }
        ck = prevKey.get(ck);
      }
      const sep = k.indexOf(''); const line = k.slice(sep + 1) || null;
      stationsOut.push({ name, lon: s.lon, lat: s.lat, minutes: Math.round(d * 10) / 10, transfers, line });
    }
    stationsOut.sort((a, b) => a.minutes - b.minutes);
    return { stations: stationsOut, edges: edgesOut };
  }

  /**
   * @param {string} fromStationName
   * @param {number} maxMin
   * @param {{startMinutes?:number}} [opts]
   * @returns {Array<{name:string,lon:number,lat:number,minutes:number,transfers:number,line:string|null}>}
   */
  reach(fromStationName, maxMin, opts) { return this.reachDetailed(fromStationName, maxMin, opts).stations; }

  /**
   * 灌入「真實」站間搭乘秒數（例如 TDX Rail/Metro/S2STravelTime），取代／覆蓋 hopMinutes() 距離估算出的
   * `e.minutes`。每條邊各自判斷：對到真實時間就用真實時間，對不到就維持 hopMinutes() 的估算——完全沒呼叫
   * 這個方法時，行為與呼叫前一模一樣（`e.minutes` 從未被動過）。
   *
   * 站名比對前先正規化：臺→台、去掉結尾的「站」字（我們的底圖站名可能沒有「站」字尾，TDX 名稱可能用
   * 「臺」而不是「台」，兩邊未必一致）。只提供單一方向的秒數時，另一個方向沿用同一組秒數（同一段軌道
   * 對開的實際耗時差異，相對於分鐘級的時間模型可以忽略）；若兩個方向都有資料，各自的方向各自生效。
   *
   * @param {Array<{from:string, to:string, runSec:number, stopSec?:number, line?:string}>} hops
   *   例如 server /api/tdx/s2s 回傳的 `{ hops }`；缺 from/to/runSec 或非數字的 runSec 會被整筆忽略。
   * @returns {{matched:number, total:number, tableSize:number}} 與 matchReport() 相同的摘要，方便呼叫端立即知道灌表結果。
   */
  setTravelTimes(hops) {
    const norm = s => String(s || '').trim().replace(/臺/g, '台').replace(/站$/, '');
    const table = new Map(); // `${normFrom}>${normTo}` → 分鐘（已經是 (runSec+stopSec)/60）
    for (const h of Array.isArray(hops) ? hops : []) {
      if (!h) continue;
      const from = norm(h.from), to = norm(h.to);
      if (!from || !to || from === to) continue;
      const runSec = Number(h.runSec); if (!Number.isFinite(runSec) || runSec <= 0) continue;
      const stopSec = Number(h.stopSec); const minutes = Math.max(0.1, (runSec + (Number.isFinite(stopSec) ? stopSec : 0)) / 60);
      table.set(`${from}>${to}`, minutes); // 明確方向：後面若重複出現同一方向，以最後一筆為準
    }
    for (const [k, v] of [...table]) { const [a, b] = k.split('>'); const rk = `${b}>${a}`; if (!table.has(rk)) table.set(rk, v); } // 缺的那個方向沿用同一組秒數
    this._travelTimeTable = table;

    const normOf = new Map(); for (const name of this.stations.keys()) normOf.set(name, norm(name));
    for (const [name, edges] of this.adj) {
      const nf = normOf.get(name) ?? norm(name);
      for (const e of edges) {
        const real = table.get(`${nf}>${normOf.get(e.to) ?? norm(e.to)}`);
        if (real != null) { e.minutes = real; e._realTime = true; }
        else { e.minutes = e._heurMinutes != null ? e._heurMinutes : e.minutes; e._realTime = false; }
      }
    }
    return this.matchReport();
  }

  /** 上次 setTravelTimes() 灌到多少條邊、路網總邊數是多少，給 console 顯示用。從未呼叫過 setTravelTimes() 時 tableSize 為 0。 */
  matchReport() {
    let total = 0, matched = 0;
    for (const edges of this.adj.values()) for (const e of edges) { total++; if (e._realTime) matched++; }
    return { matched, total, tableSize: this._travelTimeTable ? this._travelTimeTable.size : 0 };
  }
}
/* <<< END PURE HELPERS (no Cesium) */

/* ---------------- 繪圖（Cesium） ---------------- */
// 與 src/layers/funraise.js 的 MRT_COLOR 同一套官方配色（避免修改該檔案，這裡自己留一份小對照表）
const MRT_LINE_COLOR = { '文湖線': '#C48C31', '淡水信義線': '#E3002C', '松山新店線': '#008659', '中和新蘆線': '#F8B61C', '板南線': '#0070BD', '環狀線': '#FFDB00' };
// PickPeak 藍本藍三階（= style.css --blue-500/600/700），對應 ≤10 / ≤20 / ≤30 分
const BAND_BASE_COLORS = ['#16A4C0', '#0C83A2', '#0F6A85'];
const hexDarken = (hex, t) => { const n = parseInt(hex.slice(1), 16); const r = Math.round(((n >> 16) & 255) * (1 - t)), g = Math.round(((n >> 8) & 255) * (1 - t)), b = Math.round((n & 255) * (1 - t)); return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''); };
const bandPalette = n => { if (n <= BAND_BASE_COLORS.length) return BAND_BASE_COLORS.slice(0, n); const out = [...BAND_BASE_COLORS]; for (let i = BAND_BASE_COLORS.length; i < n; i++) out.push(hexDarken(BAND_BASE_COLORS[BAND_BASE_COLORS.length - 1], 0.16 * (i - BAND_BASE_COLORS.length + 1))); return out; };
const bandIndexFor = (minutes, bands) => { for (let i = 0; i < bands.length; i++) if (minutes <= bands[i] + 1e-9) return i; return bands.length - 1; };
const easeOutCubic = p => 1 - Math.pow(1 - p, 3);
const WALK_RADIUS_M = 8 * WALK_MPM; // 8 分鐘步行 ≈ 640m（固定視覺參考圈，非依實際站距縮放）
const WAVE_MS = 1600;

/**
 * 把 MrtNetwork 的等時圈結果畫成 Cesium entities（一個獨立的 CustomDataSource('isochrone')）。
 * 不碰相機、不改 main.js/ui.js 既有的圖層——純粹疊加自己的資料源，`clear()` 會整個清空。
 */
export class IsochroneLayer {
  /** @param {Cesium.Viewer} viewer @param {MrtNetwork} network @param {{theme?:'light'|'dark'}} [opts] */
  constructor(viewer, network, opts = {}) {
    this.viewer = viewer; this.network = network;
    this.ds = new Cesium.CustomDataSource('isochrone');
    viewer.dataSources.add(this.ds);
    this.theme = opts.theme === 'dark' ? 'dark' : 'light';
    this._active = false;
    /** @type {Array} 最近一次 show() 的可達站清單（不在回傳的摘要物件裡，供想要細節的呼叫端自取） */
    this.lastStations = [];
    /** @type {Array} 最近一次 show() 實際畫出的路網邊 */
    this.lastEdges = [];
  }

  get active() { return this._active; }

  /** 清空這個等時圈圖層畫的所有東西。 */
  clear() { this.ds.entities.removeAll(); this._active = false; this.lastStations = []; this.lastEdges = []; }

  /** 從資料源移除（頁面真的不再需要這個圖層時呼叫；一般只需要 clear()）。 */
  destroy() { this.clear(); this.viewer.dataSources.remove(this.ds); }

  _col(hex, a = 1) { return Cesium.Color.fromCssColorString(hex).withAlpha(a); }
  _label(text, color, dy = -14) {
    return {
      text, font: '600 11px "Noto Sans TC", "Inter", sans-serif',
      fillColor: this._col(color, 1), outlineColor: this._col('#030712', .9), outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, dy),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6500),
      showBackground: true, backgroundColor: this._col('#030712', .65), backgroundPadding: new Cesium.Cartesian2(6, 3),
    };
  }

  /**
   * 畫一個等時圈。
   * @param {{lon:number, lat:number, name?:string, maxMin?:number, bands?:number[]}} params
   * @returns {{origin:{lon:number,lat:number,name:string}, stations:number, byBand:Object<number,number>, farthest:{name:string,minutes:number}|null, employersCovered:null, bounds:[number,number,number,number]|null}}
   *   byBand 是「落在哪一階」的分桶計數（非累計）：例如 bands=[10,20,30] 時 byBand[30] 是
   *   「>20 且 ≤maxMin（若 maxMin>30 則含 30 分以上者）」的站數，跟畫面上點的顏色分階一致。
   *   bounds 是可達站的經緯度框 [west,south,east,north]，方便呼叫端把相機框過去；沒有可達站時是 null。
   */
  show({ lon, lat, name, maxMin = 20, bands = [10, 20, 30] } = {}) {
    this.clear();
    if (lon == null || lat == null) throw new Error('IsochroneLayer.show: 需要 lon/lat');
    const sortedBands = (Array.isArray(bands) && bands.length ? [...bands] : [10, 20, 30]).sort((a, b) => a - b);
    const palette = bandPalette(sortedBands.length);
    const near = this.network.nearestStation(lon, lat);
    const walkMin = near ? near.distM / WALK_MPM : 0;
    const originName = name || (near ? near.station.name : '出發點');
    const detail = near ? this.network.reachDetailed(near.station.name, maxMin, { startMinutes: walkMin }) : { stations: [], edges: [] };
    let stations = detail.stations.filter(s => s.minutes <= maxMin + 1e-9);
    let edges = detail.edges;
    if (stations.length > 150) stations = stations.slice(0, 150); // 防呆：entity 數上限（正常資料集只有 100 站，不會觸發）
    if (edges.length > 150) edges = edges.slice(0, 150);
    this.lastStations = stations; this.lastEdges = edges;

    const originPos = Cesium.Cartesian3.fromDegrees(lon, lat, 2);
    const t0 = performance.now();

    // 走路可及圈（固定 8 分鐘 ≈ 640m，PickPeak 藍、地面半透明）
    const walkEnt = this.ds.entities.add({ position: originPos, ellipse: { semiMajorAxis: WALK_RADIUS_M, semiMinorAxis: WALK_RADIUS_M, height: .5, material: this._col(palette[0], .16), outline: true, outlineColor: this._col(palette[0], .55), outlineWidth: 1.5 } });
    walkEnt._plKind = 'walk'; walkEnt._baseColor = palette[0];

    // 出發點
    const originEnt = this.ds.entities.add({ position: originPos, point: { pixelSize: 10, color: this._col('#FFFFFF', 1), outlineColor: this._col(palette[0], 1), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: this._label(`${originName} · 出發`, palette[0], -16) });
    originEnt._plKind = 'origin'; originEnt._baseColor = palette[0];

    // 可達車站
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const byBand = Object.fromEntries(sortedBands.map(b => [b, 0]));
    let farthest = null;
    for (const s of stations) {
      const bi = bandIndexFor(s.minutes, sortedBands); const col = palette[bi];
      byBand[sortedBands[bi]]++;
      if (!farthest || s.minutes > farthest.minutes) farthest = { name: s.name, minutes: s.minutes };
      bounds[0] = Math.min(bounds[0], s.lon); bounds[1] = Math.min(bounds[1], s.lat); bounds[2] = Math.max(bounds[2], s.lon); bounds[3] = Math.max(bounds[3], s.lat);
      const size = Math.max(6, 11 - bi * 2);
      const e = this.ds.entities.add({ position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 6), point: { pixelSize: size, color: this._col(col, .95), outlineColor: this._col('#FFFFFF', .9), outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: this._label(`${s.name} · ${Math.round(s.minutes)} 分`, col) });
      e._plKind = 'station'; e._band = bi; e._baseColor = col;
    }

    // 實際走過的路徑（發光線，用各線官方配色）
    for (const edge of edges) {
      if (!edge.path || edge.path.length < 2) continue;
      const flat = []; for (const p of edge.path) flat.push(p[0], p[1], 8);
      const lineColor = MRT_LINE_COLOR[edge.line] || '#8FA3C8';
      const pe = this.ds.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat), width: 5, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: .22, taperPower: .5, color: this._col(lineColor, .95) }), arcType: Cesium.ArcType.GEODESIC } });
      pe._plKind = 'path';
    }

    // 動畫波前：0 → 最外圈半徑，~1.6s ease-out，之後定住成一圈淡邊界
    const outerRadius = Math.max(WALK_RADIUS_M, ...stations.map(s => haversine(lon, lat, s.lon, s.lat)), 1);
    const waveColor = palette[palette.length - 1];
    const prog = () => Math.min(1, (performance.now() - t0) / WAVE_MS);
    const waveEnt = this.ds.entities.add({
      position: originPos,
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => outerRadius * easeOutCubic(prog()), false),
        semiMinorAxis: new Cesium.CallbackProperty(() => outerRadius * easeOutCubic(prog()), false),
        height: 1,
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => { const p = prog(); const light = this.theme === 'light'; return this._col(waveColor, (light ? .12 : .22) * (1 - .7 * p)); }, false)),
        outline: true,
        outlineColor: new Cesium.CallbackProperty(() => { const p = prog(); const light = this.theme === 'light'; return this._col(waveColor, (light ? .5 : .65) - .2 * p); }, false),
        outlineWidth: 2,
      },
    });
    waveEnt._plKind = 'wave'; waveEnt._baseColor = waveColor;

    this._active = true;
    this.setTheme(this.theme); // 依目前主題套一次文字配色
    return {
      origin: { lon, lat, name: originName },
      stations: stations.length,
      byBand,
      farthest,
      employersCovered: null,
      bounds: stations.length ? bounds : null,
    };
  }

  /** 'light'（PickPeak 日間，深色字＋白底）或 'dark'（夜間戰情室，亮色字＋深底）。 */
  setTheme(theme) {
    this.theme = theme === 'dark' ? 'dark' : 'light';
    const light = this.theme === 'light';
    for (const e of this.ds.entities.values) {
      if (e.label) {
        const base = e._baseColor || '#E3F8FA';
        e.label.fillColor = this._col(light ? hexDarken(base, .55) : base, 1);
        e.label.outlineColor = light ? this._col('#FFFFFF', .92) : this._col('#030712', .9);
        e.label.backgroundColor = light ? this._col('#FFFFFF', .85) : this._col('#030712', .65);
      }
      if (e.point) e.point.outlineColor = light ? this._col('#1E2939', .55) : this._col('#FFFFFF', .9);
      if (e._plKind === 'walk' && e.ellipse) e.ellipse.outlineColor = this._col(e._baseColor, light ? .6 : .55);
    }
  }
}
