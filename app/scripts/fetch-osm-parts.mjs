#!/usr/bin/env node
// 抓 OSM building:part（地標分段量體：台北101裙樓+塔樓分開建模、南山廣場…）→ public/data/osm_parts_taipei.json
// 用法：node scripts/fetch-osm-parts.mjs                                     — 整個 bbox 全新抓一輪，覆蓋整份輸出檔。
//      node scripts/fetch-osm-parts.mjs --bbox W,S,E,N --merge              — 只抓這個小 bbox（同一套重試/象限切分邏
//                                                                              輯），MERGE 進既有的輸出檔，不覆蓋其他
//                                                                              資料。用在「city-wide 那輪有幾個 tile
//                                                                              一直失敗、事後單獨補抓」的情境。
//                                                                              --bbox 一定要搭 --merge（反過來單獨
//                                                                              --bbox 會被拒絕，避免不小心把整份檔案
//                                                                              覆蓋成只剩這一小塊）。
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
//
// --merge 模式的三個關鍵設計（跟上面全新抓取那輪共用同一套高度/幾何/母建物比對規則，差別只在輸出
// 是「併進去」而不是「蓋掉」）：
//   1. 去重用「環的量化座標簽章」（把 flat 整數座標點集合排序後 join 成字串），不是 OSM way id——
//      輸出檔本來就沒存 way id，而且簽章天生不怕起點/繞向不同，同一個 tile 補抓兩次、或補抓範圍跟
//      前一輪有重疊，都不會長出重複的 part。
//   2. 母建物比對只對「這次新抓到的 part」做 point-in-ring；既有 parts 已經存好的 parentIndex 完全
//      不重算。suppress 名單只針對「這次有新 part 掛進去的母建物」重新算比例（面積只會增加，已經在
//      suppress 名單裡的不會被拿掉，只可能新增）。
//   3. meta.tiles_missing：跟這次 --bbox 有重疊/被涵蓋的舊項目先移除，這次抓完如果還有失敗的子區塊
//      再放回去（可能是更小的象限）。OSM_README.md 的分段量體那節改成用註解錨點框住，每次執行都是
//      整段原地替換，不會越疊越多份。
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
const FETCH_TIMEOUT_MS = 45000; // 留給伺服器內部 timeout:35 一點餘裕；實測今天這個公用實例常態性壅塞（部分區塊連 75s 都換不到一次成功），
                                 // 寧可犧牲一點「這個 tile 本來給更多時間就會成功」的機會，換一個有界、可預期的總執行時間。
const MAX_RETRIES = 1; // 加上第一次共 2 次嘗試（原本 3 次；同一個理由：有界時間優先於窮盡重試）
const TILE_PAUSE_MS = 700; // 禮貌性間隔：這是公用的 Overpass 實例，不要把它打爆
const MAX_SPLIT_DEPTH = 1; // 一個 tile 重試完還是失敗 → 切成 4 個象限再各自試一輪；只切一層（0.02°→0.01°），不再往下切——
                            // 實測今天的壅塞是「整個伺服器忽快忽慢」而不是「這個查詢太貴」，切更細不會讓它變快，只會讓單一問題
                            // tile 的總等待時間指數增加，所以深度砍半，多切出來的小格子若還是失敗就直接記進 missingTiles。
// --merge 補抓的目標範圍本來就小很多（單一 tile 甚至更小），值得用比 city-wide 那輪更耐心的重試/切分策略。
const MERGE_FETCH_TIMEOUT_MS = 60000;
const MERGE_MAX_RETRIES = 3; // 加上第一次共 4 次嘗試，backoff 3s/6s/9s
const MERGE_MAX_SPLIT_DEPTH = 2;
const SUPPRESS_RATIO = 0.6;
const GRID_CELL_DEG = 0.001; // ≈100m at this latitude — 跟 osmBuildings.js 的 nearest() 網格同尺度

/** [w,s,e,n] → 一串 0.02°×0.02° 的子 bbox（最後一排/一列裁到原始邊界，不會超出；bbox 本身比 step 小時剛好只產生 1 個）。 */
function tiles([w, s, e, n], step) {
  const out = [];
  for (let y = s; y < n - 1e-9; y = +(y + step).toFixed(6)) {
    for (let x = w; x < e - 1e-9; x = +(x + step).toFixed(6)) {
      out.push([x, y, Math.min(+(x + step).toFixed(6), e), Math.min(+(y + step).toFixed(6), n)]);
    }
  }
  return out;
}

const overpassQuery = ([w, s, e, n]) => `[out:json][timeout:35];way["building:part"](${s},${w},${n},${e});out body geom;`;

/** 打一個 tile；重試 opts.maxRetries 次都失敗回傳 null（呼叫端自己決定要不要切更小再試，或整塊記進 missingTiles）。 */
async function fetchTile(bbox, label, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const body = 'data=' + encodeURIComponent(overpassQuery(bbox));
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await fetch(OVERPASS_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body, signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`); }
      const j = await r.json();
      return Array.isArray(j.elements) ? j.elements : [];
    } catch (e) {
      console.warn(`[fetch-osm-parts] tile ${label} attempt ${attempt + 1}/${maxRetries + 1} failed: ${e.message}`);
      if (attempt < maxRetries) await new Promise(res => setTimeout(res, 3000 * (attempt + 1))); // 1st retry 3s, 2nd 6s, 3rd 9s…
    }
  }
  return null;
}

/**
 * fetchTile() 的外層：一個 tile 重試完仍失敗時，切成 4 個象限各自重試（公用 Overpass 實例常態性
 * 壅塞，實測縮小查詢範圍比對同一個查詢死磕更有效）；最多切 opts.maxSplitDepth 層，再失敗就真的放棄
 * 那一小塊（記進 missingTiles，讓輸出的 meta 誠實反映涵蓋範圍有缺口，不假裝完整）。
 * @returns {{elements:object[], missing:number[][]}}
 */
async function fetchTileAdaptive(bbox, label, depth = 0, opts = {}) {
  const maxSplitDepth = opts.maxSplitDepth ?? MAX_SPLIT_DEPTH;
  const els = await fetchTile(bbox, label, opts);
  if (els != null) return { elements: els, missing: [] };
  const [w, s, e, n] = bbox;
  if (depth >= maxSplitDepth) { console.warn(`[fetch-osm-parts] tile ${label} giving up at split depth ${depth} (still failing)`); return { elements: [], missing: [bbox] }; }
  const midX = +((w + e) / 2).toFixed(6), midY = +((s + n) / 2).toFixed(6);
  const quads = [[w, s, midX, midY], [midX, s, e, midY], [w, midY, midX, n], [midX, midY, e, n]];
  console.warn(`[fetch-osm-parts] tile ${label} still failing after ${(opts.maxRetries ?? MAX_RETRIES) + 1} attempts — splitting into 4 quadrants and retrying each`);
  const elements = [], missing = [];
  for (let qi = 0; qi < quads.length; qi++) {
    await new Promise(res => setTimeout(res, TILE_PAUSE_MS));
    const sub = await fetchTileAdaptive(quads[qi], `${label}.${qi + 1}/4`, depth + 1, opts);
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
/** 環的「量化座標簽章」：flat 是已經量化過的整數座標（沿用 osm_buildings_taipei.json 的 origin/scale），
 * 把點集合排序後 join——不管起點在哪、繞向順逆，同一個實體環一定產生同一個字串。用來在 --merge 時判斷
 * 「這個 part 是不是已經在既有檔案裡了」，比對 OSM way id 穩：輸出檔本來就沒存 way id，而且同一個地物
 * 偶爾會被不同的 relation/切法重複收錄到。 */
function ringSignature(flat) {
  const pairs = [];
  for (let k = 0; k < flat.length; k += 2) pairs.push(flat[k] + ',' + flat[k + 1]);
  pairs.sort();
  return pairs.join('|');
}

/* ---------------- CLI 參數 ---------------- */
function parseArgs(argv) {
  const out = { merge: false, bbox: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--merge') out.merge = true;
    else if (a === '--bbox') out.bbox = argv[++i];
    else if (a.startsWith('--bbox=')) out.bbox = a.slice('--bbox='.length);
  }
  if (out.bbox) {
    const nums = out.bbox.split(',').map(Number);
    if (nums.length !== 4 || nums.some(x => Number.isNaN(x))) throw new Error(`--bbox must be "west,south,east,north" (got "${out.bbox}")`);
    out.bbox = nums;
  }
  return out;
}

/* ---------------- OSM_README.md：分段量體那節，用註解錨點框住，每次執行整段原地替換 ---------------- */
const README_BEGIN = '<!-- osm-parts-section:begin -->';
const README_END = '<!-- osm-parts-section:end -->';
function buildReadmeBody({ raw, unique, keptCount, skippedNoHeight, skippedDegenerate, matched, unmatched, suppressCount, tilesMissing, landmarks, mergeNote }) {
  return `## building:part 分段量體（scripts/fetch-osm-parts.mjs；最後更新 ${new Date().toISOString().slice(0, 10)}）\n\n` +
    `Fetched from ${OVERPASS_URL} — same bbox/tiling as the building footprints above (§16.7 地標形狀).${mergeNote ? ' ' + mergeNote : ''}\n\n` +
    `- Ways fetched (raw, before de-dup, cumulative across all runs): ${raw}\n` +
    `- Unique building:part ways (cumulative): ${unique}\n` +
    `- Parts kept: ${keptCount}\n` +
    `- Skipped — no usable height (no height／building:levels tag), cumulative: ${skippedNoHeight}\n` +
    `- Skipped — degenerate ring, cumulative: ${skippedDegenerate}\n` +
    `- Matched to a parent building footprint: ${matched} · standalone (no parent match): ${unmatched}\n` +
    `- Suppressed parents (parts cover >=${Math.round(SUPPRESS_RATIO * 100)}% of footprint area, parent box no longer drawn — only the parts render): ${suppressCount}\n` +
    `- Sub-tiles missing (still failing after retries + adaptive splitting): ${tilesMissing.length}${tilesMissing.length ? ' — ' + JSON.stringify(tilesMissing) : ''}\n\n` +
    `### Top landmarks by tallest part\n\n` +
    (landmarks.length ? landmarks.map(x => `- ${x.name} — ${x.h.toFixed(1)} m${x.suppressed ? ' (suppressed parent — parent box replaced by parts)' : ' (parent box kept alongside parts)'}`).join('\n') : '(none found)') + '\n';
}
function upsertReadmeSection(body) {
  const wrapped = `${README_BEGIN}\n${body}${README_END}\n`;
  let text = '';
  try { text = fs.readFileSync(README_FILE, 'utf8'); } catch { text = ''; }
  const bi = text.indexOf(README_BEGIN), ei = text.indexOf(README_END);
  if (bi >= 0 && ei >= 0) {
    text = text.slice(0, bi) + wrapped + text.slice(ei + README_END.length);
  } else if (/\n## building:part 分段量體/.test(text)) {
    // 第一次跑這個新版腳本，之前那輪留下的是沒有錨點的舊版本節——原地換成有錨點的版本，不留兩份。
    text = text.replace(/\n## building:part 分段量體[\s\S]*$/, '\n' + wrapped);
  } else {
    text = text.replace(/\n?$/, '\n') + wrapped;
  }
  fs.writeFileSync(README_FILE, text);
  console.log('[fetch-osm-parts] refreshed section in', README_FILE);
}

/* ---------------- 主流程：全新抓一輪（預設，無參數） ---------------- */
async function runFresh(ctx, origin) {
  const { ox, oy, scale, B, grid, cellOf, buildingRings, buildingAreas, typeIdxFor } = ctx;
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

  const parts = []; let skippedNoHeight = 0, skippedDegenerate = 0;
  const parentPartAreas = new Map(); // parentIndex → Σ part 面積(m²)

  for (const el of ways) {
    const ring = ringOf(el); if (!ring) { skippedDegenerate++; continue; }
    const hh = heightsOf(el.tags || {}); if (!hh) { skippedNoHeight++; continue; }
    const [cx, cy] = centroidOf(ring);
    const cellCandidates = grid.get(cellOf(cx, cy)) || [];
    let parentIndex = -1, parentArea = Infinity;
    for (const bi of cellCandidates) { const br = buildingRings[bi]; if (br && pointInRing(cx, cy, br) && buildingAreas[bi] < parentArea) { parentArea = buildingAreas[bi]; parentIndex = bi; } }
    if (parentIndex >= 0) {
      const area = ringAreaSqm(ring);
      parentPartAreas.set(parentIndex, (parentPartAreas.get(parentIndex) || 0) + area);
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

  const matched = parts.filter(p => p[4] >= 0).length, unmatched = parts.length - matched;
  console.log(`[fetch-osm-parts] parts kept: ${parts.length} (skipped: no-height ${skippedNoHeight}, degenerate ${skippedDegenerate})`);
  console.log(`[fetch-osm-parts] matched to a parent: ${matched} · standalone (no parent match): ${unmatched}`);
  console.log(`[fetch-osm-parts] suppressed parents (parts cover >=${Math.round(SUPPRESS_RATIO * 100)}% of footprint): ${suppress.length}`);

  const parentMaxH = new Map();
  for (const p of parts) { if (p[4] >= 0) parentMaxH.set(p[4], Math.max(parentMaxH.get(p[4]) || 0, p[1] / 10)); }
  const landmarks = [...parentMaxH.entries()].map(([pi, h]) => ({ name: B[pi][3] || null, h, suppressed: suppress.includes(pi) })).filter(x => x.name).sort((a, b) => b.h - a.h).slice(0, 20);

  const out = {
    meta: {
      origin, scale, bbox: BBOX, count: parts.length, source: '© OpenStreetMap contributors (ODbL)', generated_at: new Date().toISOString(),
      tiles_missing: missingTiles, ways_fetched_raw: rawWays.length, ways_unique: ways.length, skipped_no_height: skippedNoHeight, skipped_degenerate: skippedDegenerate,
    },
    parts, suppress,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  console.log(`[fetch-osm-parts] wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB)`);

  upsertReadmeSection(buildReadmeBody({
    raw: rawWays.length, unique: ways.length, keptCount: parts.length, skippedNoHeight, skippedDegenerate,
    matched, unmatched, suppressCount: suppress.length, tilesMissing: missingTiles, landmarks,
  }));
}

/* ---------------- 主流程：--bbox W,S,E,N --merge（補抓一小塊，併進既有檔案） ---------------- */
async function runMerge(ctx, bboxArg, origin) {
  const { ox, oy, scale, B, grid, cellOf, buildingRings, buildingAreas, typeIdxFor } = ctx;

  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  } catch {
    console.warn(`[fetch-osm-parts] merge: ${OUT_FILE} 不存在或無法解析，當作空檔案開始`);
    existing = { meta: { origin, scale, bbox: BBOX, count: 0, source: '© OpenStreetMap contributors (ODbL)', generated_at: new Date().toISOString(), tiles_missing: [] }, parts: [], suppress: [] };
  }
  if (existing.meta && existing.meta.origin && (existing.meta.origin[0] !== ox || existing.meta.origin[1] !== oy || existing.meta.scale !== scale)) {
    throw new Error('既有 osm_parts_taipei.json 的 origin/scale 跟 osm_buildings_taipei.json 現在的不一致，拒絕合併（座標系統對不起來）。');
  }

  console.log(`[fetch-osm-parts] MERGE mode — target bbox [${bboxArg.join(',')}], existing file has ${existing.parts.length} parts, ${existing.suppress.length} suppressed`);

  // 既有每一筆 part 的「環簽章」——之後新抓到的 part 只要簽章撞到，就代表已經在檔案裡了，跳過（讓同一個
  // bbox 補抓兩次是 idempotent 的，不會長出重複的 part）。
  const existingSigs = new Set(existing.parts.map(p => ringSignature(p[3])));

  const opts = { timeoutMs: MERGE_FETCH_TIMEOUT_MS, maxRetries: MERGE_MAX_RETRIES, maxSplitDepth: MERGE_MAX_SPLIT_DEPTH };
  const tileList = tiles(bboxArg, TILE_DEG);
  console.log(`[fetch-osm-parts] merge: ${tileList.length} tile(s) over [${bboxArg.join(', ')}]`);
  const rawWays = []; const missingTiles = [];
  for (let t = 0; t < tileList.length; t++) {
    const bbox = tileList[t]; const label = `merge ${t + 1}/${tileList.length} [${bbox.map(x => x.toFixed(3)).join(',')}]`;
    process.stdout.write(`[fetch-osm-parts] tile ${label} … `);
    const { elements: els, missing } = await fetchTileAdaptive(bbox, label, 0, opts);
    const partWays = els.filter(el => el.type === 'way' && el.tags && el.tags['building:part']);
    console.log(`${els.length} elements, ${partWays.length} building:part ways${missing.length ? ` (${missing.length} sub-tile(s) still missing after adaptive split)` : ''}`);
    rawWays.push(...partWays); missingTiles.push(...missing);
    await new Promise(r => setTimeout(r, TILE_PAUSE_MS));
  }
  console.log(`[fetch-osm-parts] merge: fetched ${rawWays.length} raw building:part ways (missing sub-tiles this run: ${missingTiles.length})`);

  const seen = new Set(); const ways = [];
  for (const el of rawWays) { if (seen.has(el.id)) continue; seen.add(el.id); ways.push(el); }

  const newParts = []; let skippedNoHeight = 0, skippedDegenerate = 0, dupSkipped = 0;
  const newAreaByParent = new Map(); // parentIndex → Σ 這次新 part 的面積(m²)
  const affectedParents = new Set();
  for (const el of ways) {
    const ring = ringOf(el); if (!ring) { skippedDegenerate++; continue; }
    const hh = heightsOf(el.tags || {}); if (!hh) { skippedNoHeight++; continue; }
    const flat = []; for (const [lon, lat] of ring) flat.push(Math.round((lon - ox) * scale), Math.round((lat - oy) * scale));
    const sig = ringSignature(flat);
    if (existingSigs.has(sig)) { dupSkipped++; continue; } // 已經在檔案裡（或這次自己重複抓到）
    existingSigs.add(sig);

    const [cx, cy] = centroidOf(ring);
    const cellCandidates = grid.get(cellOf(cx, cy)) || [];
    let parentIndex = -1, parentArea = Infinity;
    for (const bi of cellCandidates) { const br = buildingRings[bi]; if (br && pointInRing(cx, cy, br) && buildingAreas[bi] < parentArea) { parentArea = buildingAreas[bi]; parentIndex = bi; } }
    if (parentIndex >= 0) {
      const area = ringAreaSqm(ring);
      newAreaByParent.set(parentIndex, (newAreaByParent.get(parentIndex) || 0) + area);
      affectedParents.add(parentIndex);
    }
    const name = el.tags.name || null;
    const row = [Math.round(hh.minH * 10), Math.round(hh.h * 10), typeIdxFor(el.tags), flat, parentIndex];
    if (name) row.push(name);
    newParts.push(row);
  }
  console.log(`[fetch-osm-parts] merge: ${newParts.length} genuinely new part(s) (skipped: no-height ${skippedNoHeight}, degenerate ${skippedDegenerate}, already-present/duplicate ${dupSkipped})`);

  // 「受影響母建物」既有面積：只掃一次既有 parts、只挑 affectedParents 裡的母建物——不是重新比對所有既有
  // part 的母建物（那些 parentIndex 完全沿用既有值），純粹是為了把 suppress 比例算對需要的既有面積合計。
  const existingAreaByParent = new Map();
  if (affectedParents.size) {
    for (const p of existing.parts) {
      const pi = p[4]; if (pi == null || pi < 0 || !affectedParents.has(pi)) continue;
      const ring = []; const flat = p[3]; for (let k = 0; k < flat.length; k += 2) ring.push([ox + flat[k] / scale, oy + flat[k + 1] / scale]);
      existingAreaByParent.set(pi, (existingAreaByParent.get(pi) || 0) + ringAreaSqm(ring));
    }
  }

  const suppressSet = new Set(existing.suppress);
  let newlySuppressed = 0;
  for (const pi of affectedParents) {
    if (suppressSet.has(pi)) continue; // 已經在 suppress 名單——面積只會增加，不會被拿掉，不用重算
    const total = (existingAreaByParent.get(pi) || 0) + (newAreaByParent.get(pi) || 0);
    const pa = buildingAreas[pi];
    if (pa > 0 && total / pa >= SUPPRESS_RATIO) { suppressSet.add(pi); newlySuppressed++; }
  }
  console.log(`[fetch-osm-parts] merge: ${affectedParents.size} parent(s) touched by new parts, ${newlySuppressed} newly crossed the suppress threshold`);

  const mergedParts = existing.parts.concat(newParts);
  const suppress = [...suppressSet].sort((a, b) => a - b);

  // meta.tiles_missing：這次 --bbox 涵蓋（或包住）的舊項目先丟掉，再把這次抓完還失敗的子區塊放回去。
  const EPS = 1e-6;
  const within = (t, b) => t[0] >= b[0] - EPS && t[1] >= b[1] - EPS && t[2] <= b[2] + EPS && t[3] <= b[3] + EPS;
  const oldMissing = (existing.meta.tiles_missing || []).filter(t => !within(t, bboxArg));
  const tilesMissing = oldMissing.concat(missingTiles);

  const cumulative = {
    ways_fetched_raw: (existing.meta.ways_fetched_raw || 0) + rawWays.length,
    ways_unique: (existing.meta.ways_unique || 0) + ways.length,
    skipped_no_height: (existing.meta.skipped_no_height || 0) + skippedNoHeight,
    skipped_degenerate: (existing.meta.skipped_degenerate || 0) + skippedDegenerate,
  };

  const out = {
    meta: { ...existing.meta, ...cumulative, count: mergedParts.length, tiles_missing: tilesMissing, merged_at: new Date().toISOString() },
    parts: mergedParts, suppress,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  console.log(`[fetch-osm-parts] merge: wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB) — ${mergedParts.length} parts total, ${suppress.length} suppressed, ${tilesMissing.length} tile(s) still missing`);

  // top-20 地標榜、matched/unmatched 一律從「完整合併後的 parts」重算（純聚合既有欄位，不是重新比對母建物）——
  // 合併可能讓某個地標第一次擠進榜、或名次往前，這兩個數字沒辦法只看「這次新增的」就推得出來。
  const parentMaxH = new Map();
  for (const p of mergedParts) { if (p[4] >= 0) parentMaxH.set(p[4], Math.max(parentMaxH.get(p[4]) || 0, p[1] / 10)); }
  const landmarks = [...parentMaxH.entries()].map(([pi, h]) => ({ name: B[pi][3] || null, h, suppressed: suppress.includes(pi) })).filter(x => x.name).sort((a, b) => b.h - a.h).slice(0, 20);
  const matched = mergedParts.filter(p => p[4] >= 0).length, unmatched = mergedParts.length - matched;

  upsertReadmeSection(buildReadmeBody({
    raw: cumulative.ways_fetched_raw, unique: cumulative.ways_unique, keptCount: mergedParts.length,
    skippedNoHeight: cumulative.skipped_no_height, skippedDegenerate: cumulative.skipped_degenerate,
    matched, unmatched, suppressCount: suppress.length, tilesMissing, landmarks,
    mergeNote: `Latest supplementary merge: bbox [${bboxArg.join(',')}] → ${newParts.length} new part(s) added (${dupSkipped} already present), ${affectedParents.size} parent(s) re-checked for suppression.`,
  }));
}

/* ---------------- 進入點 ---------------- */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.bbox && !args.merge) throw new Error('--bbox 一定要搭 --merge（單獨 --bbox 會把整份輸出檔覆蓋成只剩這一小塊——加上 --merge 才是併進既有檔案）。');
  if (args.merge && !args.bbox) throw new Error('--merge 一定要搭 --bbox W,S,E,N。');

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

  const ctx = { ox, oy, scale, B, grid, cellOf, buildingRings, buildingAreas, typeIdxFor };
  if (args.merge) await runMerge(ctx, args.bbox, origin);
  else await runFresh(ctx, origin);
}

main().catch(e => { console.error('[fetch-osm-parts] FATAL', e); process.exit(1); });
