#!/usr/bin/env node
// 抓 OSM building:part（地標分段量體：台北101裙樓+塔樓分開建模、南山廣場…）→ public/data/osm_parts_taipei.json
// 用法：node scripts/fetch-osm-parts.mjs
// 資料 (c) OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)。
//
// 對照 public/data/OSM_README.md 既有建物抓取的慣例：同一個 Overpass 實例、同樣切成 0.02°×0.02°
// 的 tile（一次查全部 bbox 會 timeout，這裡直接比照原本的作法切 tile，不是等失敗才切）、同樣的
// bbox、同樣的座標量化（沿用 osm_buildings_taipei.json 的 origin/scale，兩份檔案的座標系統完全
//相容，前端可以直接疊在一起用）。
//
// 高度解析（跟主建物腳本的規則刻意不同：這裡沒有真高度就整筆丟掉，不落回 building type 的猜測值
// —— 分段量體本來就是「已知道確切樓層/高度才值得畫」，瞎猜的高度反而會讓分段比母建物本身的箱子還
// 難看）：
//   height   → 字串開頭數字（公尺），單位字尾（m／公尺…）直接忽略。
//              否則 building:levels × 3.2（roof:height 明確不採用，不疊加）。
//              兩者都沒有 → 這個 part 直接跳過。
//   min_height → 字串開頭數字（公尺）；否則 building:min_level × 3.2；否則 0（落地）。
//
// 母建物比對：每個 part 取自己環的算術平均中心點，用粗網格（0.001°≈100m 一格，跟
// src/layers/osmBuildings.js 的 nearest() 網格同一個尺度）先篩出候選母建物（母建物依自己的 bbox
// 登記進所有覆蓋到的格子，避免大型地標建物落在網格邊界漏篩），再用 ray-casting 點在多邊形內測試；
// 命中多筆時取面積最小（最貼合）的那筆當母建物。
//
// suppress：同一個母建物底下所有命中 part 的面積合計 ÷ 母建物本身面積 ≥ 60% 時，視為「parts 已經
// 完整表達這棟樓的外形」（裙樓 part + 塔樓 part 疊起來就是整棟樓），母建物自己那根「一體成形柱體」
// 不用再畫；反之（例如只標了屋突/水塔這種小 part）母建物跟 parts 都畫，parts 疊加在母建物上面補
// 細節。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // app/scripts
const DATA_DIR = path.join(here, '..', 'public', 'data');
const BUILDINGS_FILE = path.join(DATA_DIR, 'osm_buildings_taipei.json');
const OUT_FILE = path.join(DATA_DIR, 'osm_parts_taipei.json');
const README_FILE = path.join(DATA_DIR, 'OSM_README.md');

const OVERPASS_URL = 'https://overpass.kumi.systems/api/interpreter';
// Overpass 對沒有 User-Agent 的請求一律回 429「請帶有意義的 UA」，這不是真的流量限制。
const UA = 'PeakLens-fetch-osm-parts/1.0 (+https://github.com/; contact: nelsen.chen@funraise.com.tw)';
const BBOX = [121.495, 25.015, 121.625, 25.095]; // [west, south, east, north] — 跟 osm_buildings_taipei.json 同一個核心區
const TILE_DEG = 0.02;
const FETCH_TIMEOUT_MS = 75000; // 留給伺服器內部 timeout:60 一點餘裕
const MAX_RETRIES = 2; // 加上第一次共 3 次嘗試
const TILE_PAUSE_MS = 700; // 禮貌性間隔：這是公用的 Overpass 實例，不要把它打爆
const MAX_SPLIT_DEPTH = 2; // 一個 tile 重試 3 次還是失敗 → 切成 4 個象限再各自試（實測公用實例常態性壅塞，縮小查詢範圍比死磕同一個查詢有用）；最多切兩層（0.02°→0.01°→0.005°)
const SUPPRESS_RATIO = 0.6;
const GRID_CELL_DEG = 0.001; // ≈100m at this latitude — 跟 osmBuildings.js 的 nearest() 網格同尺度

/** [w,s,e,n] → 一串 0.02°×0.02° 的子 bbox（最後一排/一列裁到原始邊界，不會超出）。 */
function tiles([w, s, e, n], step) {
  const out = [];
  for (let y = s; y < n - 1e-9; y = +(y + step).toFixed(6)) {
    for (let x = w; x < e - 1e-9; x = +(x + step).toFixed(6)) {
      out.push([x, y, Math.min(+(x + step).toFixed(6), e), Math.min(+(y + step).toFixed(6), n)]);
    }
  }
  return out;
}

const overpassQuery = ([w, s, e, n]) => `[out:json][timeout:60];way["building:part"](${s},${w},${n},${e});out body geom;`;

/** 打一個 tile；重試 MAX_RETRIES 次都失敗回傳 null（呼叫端自己決定要不要切更小再試，或整塊記進 missingTiles）。 */
async function fetchTile(bbox, label) {
  const body = 'data=' + encodeURIComponent(overpassQuery(bbox));
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const r = await fetch(OVERPASS_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`); }
      const j = await r.json();
      return Array.isArray(j.elements) ? j.elements : [];
    } catch (e) {
      console.warn(`[fetch-osm-parts] tile ${label} attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${e.message}`);
      if (attempt < MAX_RETRIES) await new Promise(res => setTimeout(res, 3000 * (attempt + 1))); // 1st retry 3s, 2nd 6s
    }
  }
  return null;
}

/**
 * fetchTile() 的外層：一個 tile 重試 MAX_RETRIES 次仍失敗時，切成 4 個象限各自重試（公用 Overpass 實例常態性
 * 壅塞，實測縮小查詢範圍比對同一個查詢死磕更有效）；最多切 MAX_SPLIT_DEPTH 層，再失敗就真的放棄那一小塊
 * （記進 missingTiles，讓輸出的 meta 誠實反映涵蓋範圍有缺口，不假裝完整）。
 * @returns {{elements:object[], missing:number[][]}}
 */
async function fetchTileAdaptive(bbox, label, depth = 0) {
  const els = await fetchTile(bbox, label);
  if (els != null) return { elements: els, missing: [] };
  const [w, s, e, n] = bbox;
  if (depth >= MAX_SPLIT_DEPTH) { console.warn(`[fetch-osm-parts] tile ${label} giving up at split depth ${depth} (still failing)`); return { elements: [], missing: [bbox] }; }
  const midX = +((w + e) / 2).toFixed(6), midY = +((s + n) / 2).toFixed(6);
  const quads = [[w, s, midX, midY], [midX, s, e, midY], [w, midY, midX, n], [midX, midY, e, n]];
  console.warn(`[fetch-osm-parts] tile ${label} still failing after ${MAX_RETRIES + 1} attempts — splitting into 4 quadrants and retrying each`);
  const elements = [], missing = [];
  for (let qi = 0; qi < quads.length; qi++) {
    await new Promise(res => setTimeout(res, TILE_PAUSE_MS));
    const sub = await fetchTileAdaptive(quads[qi], `${label}.${qi + 1}/4`, depth + 1);
    elements.push(...sub.elements); missing.push(...sub.missing);
  }
  return { elements, missing };
}

/* ---------------- 高度解析（純函式） ---------------- */
const numFrom = s => { if (s == null) return null; const m = String(s).trim().match(/^-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
/** @returns {{minH:number,h:number}|null} h/minH 都是公尺；沒有可用高度回傳 null（呼叫端直接跳過這個 part）。 */
function heightsOf(tags) {
  const levels = numFrom(tags['building:levels']);
  const h = numFrom(tags.height) ?? (levels != null ? levels * 3.2 : null);
  if (h == null || !(h > 0)) return null;
  const minLevels = numFrom(tags['building:min_level']);
  const minH = numFrom(tags.min_height) ?? (minLevels != null ? minLevels * 3.2 : 0);
  return { minH: Math.max(0, minH), h };
}

/* ---------------- 幾何（純函式） ---------------- */
/** Overpass `out body geom` 的 way element → [[lon,lat],…] 開環（去掉收尾重複點）；退化/缺 node 回傳 null。 */
function ringOf(el) {
  if (!Array.isArray(el.geometry) || el.geometry.length < 4) return null;
  if (el.geometry.some(g => !g || typeof g.lon !== 'number' || typeof g.lat !== 'number')) return null; // 部分下載／節點缺失
  const pts = el.geometry.map(g => [g.lon, g.lat]);
  const first = pts[0], last = pts[pts.length - 1];
  if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) pts.pop();
  return pts.length >= 4 ? pts : null; // 三角形以下太退化，不畫（開環至少 4 點才算一個像樣的多邊形）
}
/** shoelace，局部東-北向投影（以 ring 自己重心為原點）——跟 src/analysis/walkshed.js 的 ringAreaSqm 同一套公式。 */
function ringAreaSqm(ring) {
  let clon = 0, clat = 0; for (const p of ring) { clon += p[0]; clat += p[1]; } const n = ring.length; clon /= n; clat /= n;
  const mLon = 111320 * Math.cos(clat * Math.PI / 180), mLat = 110540;
  const pts = ring.map(p => [(p[0] - clon) * mLon, (p[1] - clat) * mLat]);
  let sum = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; sum += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(sum) / 2;
}
const centroidOf = ring => { let cx = 0, cy = 0; for (const p of ring) { cx += p[0]; cy += p[1]; } return [cx / ring.length, cy / ring.length]; };
/** Ray-casting 點在多邊形內測試（ring 是開環 [[lon,lat],…]）。 */
function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* ---------------- 主流程 ---------------- */
async function main() {
  console.log('[fetch-osm-parts] loading', BUILDINGS_FILE);
  const buildingsData = JSON.parse(fs.readFileSync(BUILDINGS_FILE, 'utf8'));
  const { origin, scale } = buildingsData.meta; const [ox, oy] = origin;
  const B = buildingsData.b;
  // typeIdx 沿用 osm_buildings_taipei.json 既有的 types 陣列（不新增字串、不用另外輸出一份 types）：
  // 前端載入 parts 時本來就已經有這份 types 在記憶體裡（同一個 loadOsmBuildings() 呼叫），直接共用索引最省事。
  const typeIndex = new Map((buildingsData.types || []).map((t, i) => [t, i]));
  const fallbackType = typeIndex.has('yes') ? typeIndex.get('yes') : 0;
  const typeIdxFor = tags => { const t = tags.building || tags['building:part']; return (t && typeIndex.has(t)) ? typeIndex.get(t) : fallbackType; };

  // 母建物粗網格：每棟依自己的 bbox 登記進所有覆蓋到的格子（大型地標可能跨好幾格，只登記中心點會漏篩）。
  const grid = new Map(); const cellOf = (lon, lat) => `${Math.floor(lon / GRID_CELL_DEG)}:${Math.floor(lat / GRID_CELL_DEG)}`;
  const buildingRings = new Array(B.length); const buildingAreas = new Float64Array(B.length);
  for (let i = 0; i < B.length; i++) {
    const flat = B[i][2]; if (!flat || flat.length < 8) continue;
    const ring = []; let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (let k = 0; k < flat.length; k += 2) { const lon = ox + flat[k] / scale, lat = oy + flat[k + 1] / scale; ring.push([lon, lat]); if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon; if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat; }
    buildingRings[i] = ring; buildingAreas[i] = ringAreaSqm(ring);
    const cx0 = Math.floor(minLon / GRID_CELL_DEG), cx1 = Math.floor(maxLon / GRID_CELL_DEG), cy0 = Math.floor(minLat / GRID_CELL_DEG), cy1 = Math.floor(maxLat / GRID_CELL_DEG);
    for (let gx = cx0; gx <= cx1; gx++) for (let gy = cy0; gy <= cy1; gy++) { const k = `${gx}:${gy}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  }
  console.log(`[fetch-osm-parts] parent grid ready: ${B.length} buildings, ${grid.size} cells`);

  const tileList = tiles(BBOX, TILE_DEG);
  console.log(`[fetch-osm-parts] ${tileList.length} tiles (${TILE_DEG}°×${TILE_DEG}°) over bbox [${BBOX.join(', ')}]`);
  const rawWays = []; const missingTiles = [];
  for (let t = 0; t < tileList.length; t++) {
    const bbox = tileList[t]; const label = `${t + 1}/${tileList.length} [${bbox.map(x => x.toFixed(3)).join(',')}]`;
    process.stdout.write(`[fetch-osm-parts] tile ${label} … `);
    const { elements: els, missing } = await fetchTileAdaptive(bbox, label);
    const partWays = els.filter(el => el.type === 'way' && el.tags && el.tags['building:part']);
    console.log(`${els.length} elements, ${partWays.length} building:part ways${missing.length ? ` (${missing.length} sub-tile(s) still missing after adaptive split)` : ''}`);
    rawWays.push(...partWays); missingTiles.push(...missing);
    await new Promise(r => setTimeout(r, TILE_PAUSE_MS));
  }
  console.log(`[fetch-osm-parts] fetched ${rawWays.length} raw building:part ways (missing sub-tiles: ${missingTiles.length})`);

  // de-dupe：同一個 way 可能落在兩個相鄰 tile 的重疊處（Overpass bbox filter 抓「至少一個 node 在框內」的 way）。
  const seen = new Set(); const ways = [];
  for (const el of rawWays) { if (seen.has(el.id)) continue; seen.add(el.id); ways.push(el); }
  console.log(`[fetch-osm-parts] ${ways.length} unique building:part ways after de-dup`);

  const parts = []; let skippedNoHeight = 0, skippedDegenerate = 0, matched = 0, unmatched = 0;
  const parentPartAreas = new Map(); // parentIndex → Σ part 面積(m²)
  const parentMaxH = new Map(); // parentIndex → 最高 part 的高度(m)

  for (const el of ways) {
    const ring = ringOf(el); if (!ring) { skippedDegenerate++; continue; }
    const hh = heightsOf(el.tags || {}); if (!hh) { skippedNoHeight++; continue; }
    const [cx, cy] = centroidOf(ring);
    const cellCandidates = grid.get(cellOf(cx, cy)) || [];
    let parentIndex = -1, parentArea = Infinity;
    for (const bi of cellCandidates) { const br = buildingRings[bi]; if (br && pointInRing(cx, cy, br) && buildingAreas[bi] < parentArea) { parentArea = buildingAreas[bi]; parentIndex = bi; } }
    if (parentIndex >= 0) matched++; else unmatched++;
    if (parentIndex >= 0) {
      const area = ringAreaSqm(ring);
      parentPartAreas.set(parentIndex, (parentPartAreas.get(parentIndex) || 0) + area);
      parentMaxH.set(parentIndex, Math.max(parentMaxH.get(parentIndex) || 0, hh.h));
    }
    const flat = []; for (const [lon, lat] of ring) flat.push(Math.round((lon - ox) * scale), Math.round((lat - oy) * scale));
    const name = el.tags.name || null;
    const row = [Math.round(hh.minH * 10), Math.round(hh.h * 10), typeIdxFor(el.tags), flat, parentIndex];
    if (name) row.push(name);
    parts.push(row);
  }

  const suppress = [];
  for (const [pi, areaSum] of parentPartAreas) { const pa = buildingAreas[pi]; if (pa > 0 && areaSum / pa >= SUPPRESS_RATIO) suppress.push(pi); }
  suppress.sort((a, b) => a - b);

  console.log(`[fetch-osm-parts] parts kept: ${parts.length} (skipped: no-height ${skippedNoHeight}, degenerate ${skippedDegenerate})`);
  console.log(`[fetch-osm-parts] matched to a parent: ${matched} · standalone (no parent match): ${unmatched}`);
  console.log(`[fetch-osm-parts] suppressed parents (parts cover >=${Math.round(SUPPRESS_RATIO * 100)}% of footprint): ${suppress.length}`);

  const landmarks = [...parentMaxH.entries()]
    .map(([pi, h]) => ({ name: B[pi][3] || null, h, suppressed: suppress.includes(pi) }))
    .filter(x => x.name).sort((a, b) => b.h - a.h).slice(0, 20);

  const out = {
    meta: { origin, scale, bbox: BBOX, count: parts.length, source: '© OpenStreetMap contributors (ODbL)', generated_at: new Date().toISOString(), tiles_missing: missingTiles },
    parts, suppress,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  console.log(`[fetch-osm-parts] wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB)`);

  const section = `\n## building:part 分段量體（${new Date().toISOString().slice(0, 10)}，scripts/fetch-osm-parts.mjs）\n\n` +
    `Fetched from ${OVERPASS_URL} — same bbox/tiling as the building footprints above (§16.7 地標形狀).\n\n` +
    `- Ways fetched (raw, before de-dup): ${rawWays.length}\n` +
    `- Unique building:part ways: ${ways.length}\n` +
    `- Parts kept: ${parts.length}\n` +
    `- Skipped — no usable height (no height／building:levels tag): ${skippedNoHeight}\n` +
    `- Skipped — degenerate ring: ${skippedDegenerate}\n` +
    `- Matched to a parent building footprint: ${matched} · standalone (no parent match): ${unmatched}\n` +
    `- Suppressed parents (parts cover >=${Math.round(SUPPRESS_RATIO * 100)}% of footprint area, parent box no longer drawn — only the parts render): ${suppress.length}\n` +
    `- Sub-tiles missing (still failing after retries + adaptive splitting down to depth ${MAX_SPLIT_DEPTH}): ${missingTiles.length}${missingTiles.length ? ' — ' + JSON.stringify(missingTiles) : ''}\n\n` +
    `### Top landmarks by tallest part\n\n` +
    (landmarks.length ? landmarks.map(x => `- ${x.name} — ${x.h.toFixed(1)} m${x.suppressed ? ' (suppressed parent — parent box replaced by parts)' : ' (parent box kept alongside parts)'}`).join('\n') : '(none found)') + '\n';
  fs.appendFileSync(README_FILE, section);
  console.log('[fetch-osm-parts] appended section to', README_FILE);
}

main().catch(e => { console.error('[fetch-osm-parts] FATAL', e); process.exit(1); });
