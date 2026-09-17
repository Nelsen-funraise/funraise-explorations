// PeakLens v2 — HUD wiring on PickPeak Design System: lenses, density modes (Direction C), edge tabs, layers, camera, sensors, basemaps,
// timeline, inspector, pins & numbered callouts, transcript with provenance, caption, voice, scenes, FUNRAISE MCP status/authorize.
import { LAYERS, fmtInt, fmtMoney } from './layers/funraise.js';
import { LENSES } from './agent/agent.js';
import { BASEMAPS, OVERLAYS } from './viewer.js';
import { SCENES } from './scenes.js';
import { createSpeech } from './speech.js';
import { simulateRenewal, ASSUMPTIONS } from './renewal.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const escapeHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtDist = m => m >= 1000 ? (m / 1000).toFixed(m >= 100000 ? 0 : 1) + ' km' : Math.round(m) + ' m';
const KEY_OF = { stock: it => 'stock:' + it.id, future: it => 'future:' + it.id, renewal: it => 'renewal:' + it.id, mops: it => 'mops:' + it.id, infra: it => 'infra:' + it.id, parks: it => 'ipark:' + it.id, zones: it => 'zone:' + it.id, heat: it => 'heat:' + it.id, mrt: it => 'mrt:' + it.name, licenses: it => 'license:' + it.license_number, moves: it => 'move:' + it.uniform_number };
const USAGE = { office: '辦公', hotel: '旅館', house: '住宅', store: '零售', parking: '停車', others: '其他' };
const DENSITY = { immersive: '沉浸', balanced: '平衡', annotated: '標註' };
import { API, apiUrl } from './api.js';
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

export function createUI({ map, data, basemap, layers, timeline, sensors, viewerApi, cameraMode, overlay }) {
  const ui = { tts: true, claudeMode: false, sceneId: null, density: 'balanced', mcp: { status: 'noserver' }, source: '快照' };
  let agent = null, claude = null, director = null;
  const meta = data.meta || {};

  /* ---- dispatch ---- */
  const cmd = $('#cmd');
  const say = text => { text = (text || '').trim(); if (!text) return; cmd.value = ''; if (ui.claudeMode && claude) claude.handle(text); else if (agent) agent.handle(text); };
  ui.say = say;
  ui.attach = r => { agent = r.agent; claude = r.claude; director = r.director; renderSuggest(agent.lens); };

  /* ---- clock & status ---- */
  const tick = () => { $('#clock').textContent = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()) + ' TPE'; }; tick(); setInterval(tick, 1000);
  $('#datastamp').textContent = meta.generated_at ? '快照 ' + String(meta.generated_at).slice(0, 10) : '示範資料';

  /* ---- FUNRAISE MCP status pill: live / unauthorized → authorize / unreachable / no server ---- */
  const pill = $('#mcpstat');
  ui.setMcp = (h) => {
    const m = (h && h.mcp) || { status: 'noserver' }; ui.mcp = { ...m, serverOk: !!(h && h.ok), model: h && h.model, provider: h && h.provider };
    pill.className = m.status === 'live' ? 'live' : m.status === 'unauthorized' ? 'auth' : 'down';
    const label = { live: 'FUNRAISE MCP · LIVE', unauthorized: 'FUNRAISE MCP · 點此授權', unreachable: 'FUNRAISE MCP 連不上 · 快照', error: 'FUNRAISE MCP 錯誤 · 快照', noserver: 'FUNRAISE MCP · 快照（本地）' }[m.status] || 'FUNRAISE MCP · 快照';
    pill.querySelector('span').textContent = label;
    pill.title = m.status === 'live' ? `即時連線 ${m.server && m.server.name ? m.server.name : ''}${m.expires_at ? ' · token 到期 ' + new Date(m.expires_at).toLocaleTimeString('zh-TW') : ''}` : m.status === 'unauthorized' ? '尚未授權：點一下開啟 FUNRAISE MCP 的 OAuth 授權；授權前先用 2026-09-14 快照資料' : m.status === 'noserver' ? 'agent server 未啟動（npm run server）：使用本地快照與內建 agent' : `${m.reason || ''}；先用快照資料`;
    ui.source = m.status === 'live' && ui.claudeMode ? 'LIVE' : '快照';
  };
  ui.setMcp(null);
  let authWin = null;
  pill.onclick = async () => {
    const m = ui.mcp;
    if (m.status === 'unauthorized') { authWin = window.open(apiUrl('/api/mcp/authorize'), 'peaklens-mcp-auth', 'width=560,height=760,noopener=no'); toast('請在彈出視窗完成 FUNRAISE MCP 授權…'); if (!authWin) toast('瀏覽器擋了彈出視窗，請允許後再點一次'); return; }
    if (m.status === 'live') { toast('FUNRAISE MCP 即時連線中。切到 AI 模式即可即時查詢'); return; }
    if (m.status === 'noserver') { toast('先在 app/ 執行 npm run server（需 ANTHROPIC_API_KEY），再按一次即可授權 FUNRAISE MCP'); return; }
    toast('重新探測 FUNRAISE MCP…'); const h = claude ? await claude.probe(true) : null; ui.setMcp(h);
  };
  addEventListener('message', async e => { if (!e.data || e.data.type !== 'peaklens-mcp-authorized') return; const h = claude ? await claude.probe(true) : null; ui.setMcp(h); toast(h && h.mcp && h.mcp.status === 'live' ? 'FUNRAISE MCP 已授權，即時資料上線 ✓' : '授權完成但尚未連上，請稍後再試'); if (h && h.ok && h.mcp && h.mcp.status === 'live' && !ui.claudeMode) { ui.setAgentMode(true); toast('已切到 Claude 模式：接下來的問題會即時查 FUNRAISE MCP'); } });

  /* ---- lenses ---- */
  const lensBox = $('#lenses');
  for (const [id, L] of Object.entries(LENSES)) { const b = el('button', 'lens-btn', `<span class="dot" style="--c:${L.color}"></span>${L.name}`); b.dataset.lens = id; b.setAttribute('aria-pressed', 'false'); b.title = L.who; b.onclick = () => { agent && agent.setLens(id); toast(`${L.name} · ${L.who}`); }; lensBox.appendChild(b); }
  ui.applyLens = id => {
    const L = LENSES[id]; if (!L) return;
    lensBox.querySelectorAll('.lens-btn').forEach(b => { const on = b.dataset.lens === id; b.setAttribute('aria-pressed', on); b.querySelector('.dot').style.background = on ? '' : L.color && b.dataset.lens === id ? L.color : ''; });
    for (const k of Object.keys(LAYERS)) ui.setLayer(k, L.layers.includes(k) || k === 'mrt');
    renderSuggest(id); renderLensKPIs(id); $('#readout .eyebrow').textContent = L.short; $('#edge-l .cnt').textContent = L.short;
  };

  /* ---- density (Direction C) ---- */
  const dbox = $('#density');
  for (const [k, n] of Object.entries(DENSITY)) { const b = el('button', null, n); b.dataset.density = k; b.setAttribute('aria-pressed', 'false'); b.title = { immersive: '沉浸：只留地圖、鏡與指令；面板收成邊緣把手，回答變字幕', balanced: '平衡：資料面板 + 收合的圖層欄，相機移動時自動淡出', annotated: '標註：資料欄全開，地圖上為亮起的物件加編號標註並對應卡片' }[k]; b.onclick = () => ui.setDensity(k); dbox.appendChild(b); }
  dbox.appendChild(el('button', 'key', 'D'));
  const state = { railPinned: false, inspPinned: false, moveT: null };
  ui.setDensity = (mode, quiet) => {
    if (!DENSITY[mode]) return; ui.density = mode;
    document.body.classList.remove('d-immersive', 'd-balanced', 'd-annotated'); document.body.classList.add('d-' + mode);
    dbox.querySelectorAll('[data-density]').forEach(b => b.setAttribute('aria-pressed', b.dataset.density === mode));
    layers.setDensity(mode); renderCallouts();
    document.querySelectorAll('#transcript details').forEach(d => { d.open = mode === 'annotated'; });
    try { localStorage.setItem('pl.density', mode); } catch { /* private mode */ }
    if (!quiet) toast({ immersive: '沉浸模式：滑到左右邊緣把手可暫時展開面板', balanced: '平衡模式：相機移動時面板自動淡出', annotated: '標註模式：亮起的物件會加上編號，對應左側「地圖標註」' }[mode]);
  };
  ui.cycleDensity = () => { const ks = Object.keys(DENSITY); ui.setDensity(ks[(ks.indexOf(ui.density) + 1) % ks.length]); };
  ui.onCameraMove = () => { if (ui.density === 'annotated') return; document.body.classList.add('moving'); clearTimeout(state.moveT); state.moveT = setTimeout(() => document.body.classList.remove('moving'), 3500); };
  // edge tabs: hover peeks, click pins
  const edge = (tabId, cls, key) => { const tab = $(tabId); const panel = key === 'rail' ? $('#rail') : $('#inspector'); let leaveT = null;
    tab.onclick = () => { state[key + 'Pinned'] = !state[key + 'Pinned']; document.body.classList.toggle(cls, state[key + 'Pinned']); };
    tab.onmouseenter = () => { clearTimeout(leaveT); document.body.classList.add(cls); };
    const leave = () => { clearTimeout(leaveT); leaveT = setTimeout(() => { if (!state[key + 'Pinned']) document.body.classList.remove(cls); }, 450); };
    tab.onmouseleave = leave; panel.onmouseleave = leave; panel.onmouseenter = () => clearTimeout(leaveT); };
  edge('#edge-r', 'rail-open', 'rail'); edge('#edge-l', 'insp-open', 'insp');

  /* ---- layers ---- */
  const list = $('#layers'); const visible = new Set(Object.keys(LAYERS));
  const counts = { stock: (data.buildings || []).length, future: (data.future_dev || []).length, licenses: (data.building_licenses || []).length, renewal: (data.urban_renewal || []).length, zones: (data.development_zones || []).length, mops: (data.mops || []).length, moves: (data.registry_moves || []).length, infra: (data.public_infras || []).length, parks: (data.industrial_parks || []).length, heat: (data.business_areas || []).length, mrt: (basemap.mrt_stations || []).length, tm: (data.districts_analytics || []).length };
  for (const [k, L] of Object.entries(LAYERS)) { const b = el('button', 'layer', `<span class="sw ${L.glyph}" style="background:${L.color};color:${L.color}"></span><span class="lbl">${L.name}</span><span class="cnt">${counts[k] || ''}</span>`); b.dataset.layer = k; b.title = L.desc; b.setAttribute('aria-pressed', 'true'); b.onclick = () => ui.setLayer(k, !visible.has(k)); list.appendChild(b); }
  { // YouBike：使用者的「想要」與實際可見（尺度 S3–S4 才顯示，compose.js 拉高自動隱藏／拉回自動出現）分開存；
    // aria-pressed 反映「想要」，不會因為拉遠而自己跳成未按下。
    let wanted = false;
    const b = el('button', 'layer', `<span class="sw ring" style="background:#16A4C0;color:#16A4C0"></span><span class="lbl">YouBike 即時</span><span class="cnt"></span>`); b.dataset.live = 'youbike'; b.title = 'YouBike 2.0 即時站點：只在街廓尺度以下（約 2 km 內）顯示，可借／可還車柱數每分鐘更新，需 server'; b.setAttribute('aria-pressed', 'false'); b.onclick = () => ui.setYouBike(!wanted); list.appendChild(b);
    ui.setYouBike = (on) => {
      on = !!on; wanted = on; b.setAttribute('aria-pressed', on);
      if (map.compose) map.compose.setYouBikeWanted(on); else if (map.setYouBike) map.setYouBike(on);
      if (on) toast('YouBike 即時站點：只在街廓尺度以下（約 2 km 內）顯示，拉遠會自動隱藏，不用重按');
      return on;
    };
  }
  ui.setLayer = (k, on) => { if (!LAYERS[k]) return; if (on) visible.add(k); else visible.delete(k); layers.setVisible(k, !!on); const b = list.querySelector(`[data-layer="${k}"]`); if (b) b.setAttribute('aria-pressed', !!on); $('#edge-r .cnt').textContent = `${visible.size}/${Object.keys(LAYERS).length}`; };
  ui.visibleLayers = () => [...visible];

  /* ---- camera modes ---- */
  const MODES = { city: '俯視', orbit: '環繞', street: '街景', globe: '全台', timelapse: '時光' }; const mbox = $('#modes');
  ui.setMode = m => { mbox.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m)); if (m === 'timelapse') { ui.showTrend(); timeline.startLapse({ from: 2012, to: 2030, stepMs: reduce ? 1400 : 1100, onDone: () => ui.setMode('city') }); } else timeline.stopLapse(); };
  ui.userMode = m => { cameraMode(m); ui.setMode(m); };
  for (const [m, n] of Object.entries(MODES)) { const b = el('button', null, n); b.dataset.mode = m; b.setAttribute('aria-pressed', m === 'city'); b.onclick = () => ui.userMode(m); mbox.appendChild(b); }

  /* ---- sensors ---- */
  const SENSORS = { normal: '一般', night: '夜視', thermal: '熱感', blueprint: '藍圖' }; const sbox = $('#sensors');
  ui.setSensor = s => { s = sensors.set(s); $('#stage').className = 'sensor-' + s; sbox.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.sensor === s)); };
  for (const [s, n] of Object.entries(SENSORS)) { const b = el('button', null, n); b.dataset.sensor = s; b.setAttribute('aria-pressed', s === 'normal'); b.onclick = () => ui.setSensor(s); sbox.appendChild(b); }

  /* ---- theme: 夜間戰情室 (dark) · PickPeak 日間 (light) — 舊的獨立 pill 已拿掉，改由 Look 控制（見下方）決定；
     底圖是否要跟著換交給 compose.js（一換主題就照目前尺度挑一個合理的底圖，除非使用者已手動覆寫過底圖） ---- */
  ui.setTheme = (t, quiet) => { t = t === 'light' ? 'light' : 'dark'; ui.theme = t; if (ui.explain) ui.explain.setTheme(t); document.body.classList.toggle('theme-light', t === 'light'); viewerApi.setTheme(t); layers.setTheme(t); if (map.focus) map.focus.setTheme(t); else if (map.osm && map.osm.setPalette) map.osm.setPalette(t); if (map.isochrone) map.isochrone.setTheme(t); if (map.walkshed) map.walkshed.setTheme(t); if (map.youbike) map.youbike.setTheme(t); if (map.ground) map.ground.setTheme(t); ui.syncQuality && ui.syncQuality(); ui.updateCredits && ui.updateCredits(); try { localStorage.setItem('pl.theme', t); } catch { /* private mode */ } if (!quiet) toast(t === 'light' ? 'PickPeak 日間主題' : '夜間戰情室主題'); };

  /* ---- Look 控制（header）：一顆緊湊 pill（顯示目前外觀，例如「☀ 日照」）＋ 彈出選單，取代先前的 5 段式分段控制——
     那個控制在 1440 寬時會把 lens nav 擠到逐字換行。真正的邏輯在 compose.js（ui.setLook 由它接管，見 createCompose()）；
     這裡只管 pill 文字／彈出選單，以及「日照／黃金的時刻子面板沿用 #sunmenu，兩者互斥、共用同一個錨點」。
     相片沒有 Google 金鑰時整顆停用。API 對外不變：ui.setLook(name,opts) / ui.paintLook(name)。 ---- */
  const lookBtn = $('#look');
  const LOOK_DEFS = [
    ['white', '◻', '白模', '白模：白色量體、平光 — 分析、閱讀資料（預設）'],
    ['sun', '☀', '日照', '日照：可選時刻或播放一天 — 日照權、量體研究'],
    ['golden', '🌇', '黃金', '黃金時刻：17:00 暖色，弱泛光＋HDR — 展示、簡報'],
    ['night', '🌙', '夜景', '夜景：深色底圖、窗燈與泛光 — 戰情室、夜間展示'],
    ['photoreal', '📷', '相片', viewerApi.hasGoogleKey ? '相片級：Google Photorealistic 3D Tiles' : '需要 Google Maps 金鑰（/setup）'],
  ];
  const LOOK_TEXT = Object.fromEntries(LOOK_DEFS.map(([id, ic, nm]) => [id, `${ic} ${nm}`]));
  const lookMenu = el('div', 'panel hidden'); lookMenu.id = 'lookmenu'; document.getElementById('stage').appendChild(lookMenu);
  for (const [id, ic, nm, title] of LOOK_DEFS) {
    const b = el('button', null, `${ic} ${nm}`); b.dataset.look = id; b.title = title; b.setAttribute('aria-pressed', 'false');
    if (id === 'photoreal' && !viewerApi.hasGoogleKey) b.disabled = true;
    b.onclick = () => { ui.closeLookMenu(); ui.setLook(id); };
    lookMenu.appendChild(b);
  }
  ui.paintLook = (name) => {
    if (lookBtn) lookBtn.textContent = LOOK_TEXT[name] || LOOK_TEXT.white;
    lookMenu.querySelectorAll('button[data-look]').forEach(b => b.setAttribute('aria-pressed', b.dataset.look === name));
  };
  ui.openLookMenu = () => { ui.closeSunMenu && ui.closeSunMenu(); lookMenu.classList.remove('hidden'); lookBtn.setAttribute('aria-expanded', 'true'); };
  ui.closeLookMenu = () => { lookMenu.classList.add('hidden'); lookBtn.setAttribute('aria-expanded', 'false'); };
  ui.toggleLookMenu = () => { if (lookMenu.classList.contains('hidden')) ui.openLookMenu(); else ui.closeLookMenu(); };
  lookBtn.onclick = () => ui.toggleLookMenu();
  document.addEventListener('pointerdown', e => { if (!lookMenu.classList.contains('hidden') && !lookMenu.contains(e.target) && e.target !== lookBtn) ui.closeLookMenu(); });
  // 合成器就緒前的暫時實作（開機那極短的同步視窗）；main.js 建立 compose 後，這個名字會被 compose.js 換成真正的實作，
  // 但它在切換時仍會呼叫回 ui.paintLook／ui.openSunMenu／ui.closeSunMenu，所以上面幾個定義順序不能反過來。
  ui.setLook = async (name, opts) => { if (!map.compose) return { ok: false, reason: 'not-ready' }; return map.compose.setLook(name, opts); };
  ui.cycleLook = () => { const ids = LOOK_DEFS.map(d => d[0]).filter(id => id !== 'photoreal' || viewerApi.hasGoogleKey); const cur = (map.compose && map.compose.look) || 'white'; const i = ids.indexOf(cur); ui.setLook(ids[(i + 1 + ids.length) % ids.length]); };
  // Shift+L 循環切換 Look（一般的 L 已經是換 lens——見下方共用鍵盤區——用 stopImmediatePropagation 搶先攔截，不動那段共用程式碼）。
  document.addEventListener('keydown', e => { if (e.target === cmd || e.metaKey || e.ctrlKey || e.altKey) return; if (e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); e.stopImmediatePropagation(); ui.cycleLook(); } });

  /* ---- camera gimbal ---- */
  const rose = $('#compass-rose'), tiltIn = $('#g-tilt'), g2d = $('#g-2d');
  ui.updateGimbal = () => { try { rose.style.transform = `rotate(${-map.heading}deg)`; const pitch = Math.round(-map.pitch); if (document.activeElement !== tiltIn) tiltIn.value = Math.max(2, Math.min(90, pitch)); g2d.setAttribute('aria-pressed', pitch >= 85); } catch { /* not ready */ } };
  $('#g-rot-l').onclick = () => map.rig.rotateBy(-30); $('#g-rot-r').onclick = () => map.rig.rotateBy(30); $('#g-north').onclick = () => map.rig.north();
  $('#g-tilt-up').onclick = () => map.rig.tiltBy(10); $('#g-tilt-down').onclick = () => map.rig.tiltBy(-10);
  $('#g-zoom-in').onclick = () => map.rig.zoomBy(0.6); $('#g-zoom-out').onclick = () => map.rig.zoomBy(1.6);
  g2d.onclick = () => map.rig.topDown(g2d.getAttribute('aria-pressed') !== 'true');
  tiltIn.oninput = () => map.rig.aim({ pitch: -(+tiltIn.value) * Math.PI / 180 });
  (() => { const dial = $('#compass'); let dragging = false, start = 0, h0 = 0; const ang = e => { const r = dial.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
    dial.onpointerdown = e => { dragging = true; start = ang(e); h0 = map.heading; dial.setPointerCapture(e.pointerId); e.preventDefault(); };
    dial.onpointermove = e => { if (!dragging) return; const d = ang(e) - start; map.rig.aim({ heading: (h0 + d) * Math.PI / 180 }); ui.updateGimbal(); };
    dial.onpointerup = dial.onpointercancel = e => { if (!dragging) return; dragging = false; if (Math.abs(ang(e) - start) < 3) map.rig.north(); }; })();

  /* ---- basemaps (rail)：Look 控制決定預設（白模／日照按尺度、黃金／相片固定正射、夜景固定深色），這裡留給微調用；
     手動選了就算覆寫，compose.js 不會再逼著跟尺度換（見 ui.setBasemap 的包裝） ---- */
  const bbox = $('#basemaps');
  for (const [k, B] of Object.entries(BASEMAPS)) { const b = el('button', null, B.name.split('（')[0]); b.dataset.base = k; b.title = B.name; b.setAttribute('aria-pressed', k === viewerApi.basemapKey); b.onclick = () => ui.setBasemap(k); bbox.appendChild(b); }
  ui.setBasemap = k => { viewerApi.setBasemap(k); bbox.querySelectorAll('[data-base]').forEach(b => b.setAttribute('aria-pressed', b.dataset.base === k)); ui.updateCredits(); };
  /* ---- NLSC overlays (段籍界／建物框／公有地／液化／道路)：地面疊圖，最多同時 2 層 — 第 3 層開啟時自動關閉最舊的一層並提示 ---- */
  const obox = $('#overlays'); let overlayOrder = [];
  for (const [k, O] of Object.entries(OVERLAYS)) { const b = el('button', null, O.name); b.dataset.overlay = k; b.title = `${O.name} · 國土測繪中心 WMTS ${O.layer}`; b.setAttribute('aria-pressed', 'false'); b.onclick = () => ui.setOverlay(k, b.getAttribute('aria-pressed') !== 'true'); obox.appendChild(b); }
  ui.setOverlay = (k, on) => {
    if (!OVERLAYS[k]) return false;
    if (on) { overlayOrder = overlayOrder.filter(x => x !== k); overlayOrder.push(k); if (overlayOrder.length > 2) { const oldest = overlayOrder.shift(); viewerApi.setOverlay(oldest, false); const ob = obox.querySelector(`[data-overlay="${oldest}"]`); if (ob) ob.setAttribute('aria-pressed', 'false'); toast(`${OVERLAYS[oldest].name} 已自動關閉（地面疊圖最多同時 2 層）`); } }
    else overlayOrder = overlayOrder.filter(x => x !== k);
    viewerApi.setOverlay(k, on); const b = obox.querySelector(`[data-overlay="${k}"]`); if (b) b.setAttribute('aria-pressed', !!on); ui.updateCredits();
    if (on && OVERLAYS[k].min >= 13) { const c = map.center(); if (c.height > 9000) toast(`${OVERLAYS[k].name}：拉近到街廓尺度才會顯示`); }
    return true;
  };
  ui.overlays = () => viewerApi.overlays;
  /* ---- render quality ---- */
  const qbox = $('#quality'); const QUALITY = { facade: '夜景窗燈', ao: '環境光遮蔽', bloom: '泛光', hdr: 'HDR', ...(viewerApi.terrainAvailable ? { terrain: '地形' } : {}) };
  for (const [k, n] of Object.entries(QUALITY)) { const b = el('button', null, n); b.dataset.q = k; b.title = { facade: '夜景窗燈：5.7 萬棟量體長出窗格與暖色燈光（程序化著色器）', ao: '環境光遮蔽（AO）：量體交界處加深，白色城市更有立體感', bloom: '泛光：夜間主題的燈光與標記帶柔光', hdr: 'HDR + ACES 色調映射', terrain: 'Cesium World Terrain（ion）：山區地形；盆地平坦，量體仍貼 0 m' }[k]; b.onclick = () => ui.setQuality({ [k]: b.getAttribute('aria-pressed') !== 'true' }); qbox.appendChild(b); }
  ui.setQuality = (q) => { const cur = viewerApi.setQuality(q); if (map.osm && map.osm.setFacade) map.osm.setFacade(cur.facade); qbox.querySelectorAll('[data-q]').forEach(b => b.setAttribute('aria-pressed', !!cur[b.dataset.q])); return cur; };
  ui.syncQuality = () => { const cur = viewerApi.quality; if (map.osm && map.osm.setFacade) map.osm.setFacade(cur.facade); qbox.querySelectorAll('[data-q]').forEach(b => b.setAttribute('aria-pressed', !!cur[b.dataset.q])); };
  /* ---- measure / draw-site tools ---- */
  ui.bindMeasure = (measure) => { const mtBox = $('#measuretools'); if (!mtBox) return; const BTNS = [['distance', '📏 量距離', '點擊加點、雙擊完成；右鍵退一步，Esc 取消'], ['area', '⬠ 量面積', '畫多邊形量 m²／坪／周長'], ['site', '🏗 畫基地→模擬', '手繪一塊基地，完成後直接跑容積量體試算']];
    const paint = () => mtBox.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.tool === measure.active));
    for (const [id, label, title] of BTNS) { const b = el('button', null, label); b.dataset.tool = id; b.title = title; b.setAttribute('aria-pressed', 'false'); b.onclick = () => { if (measure.active === id) measure.cancel(); else measure.start(id); paint(); }; mtBox.appendChild(b); }
    const clr = el('button', null, '✕ 清除'); clr.title = '清除所有量測與手繪基地'; clr.onclick = () => { measure.clear(); paint(); }; mtBox.appendChild(clr);
    ui.startTool = (mode) => { measure.start(mode); paint(); }; ui.stopTool = () => { measure.cancel(); paint(); }; document.addEventListener('keydown', e => { if (e.key === 'Escape') setTimeout(paint, 0); }); };
  ui.updateCredits = () => { const c = $('#credits'); if (c) c.textContent = '圖資：' + viewerApi.credits().join(' · '); };
  // 舊的「🌙 夜」pill 已拿掉（併進 Look 控制），ui.setNight 保留給 agent 與工具呼叫用（見 compose.js 的包裝）。
  ui.setNight = on => viewerApi.setNight(!!on);
  ui.cycleBasemap = () => { const ks = Object.keys(BASEMAPS); ui.setBasemap(ks[(ks.indexOf(viewerApi.basemapKey) + 1) % ks.length]); };

  /* ---- timeline ---- */
  const yr = $('#year'), yl = $('#yearlbl');
  yr.oninput = () => { timeline.stopLapse(); map.setYear(+yr.value); };
  const yearHud = el('div', 'panel hidden'); yearHud.id = 'yearhud'; document.getElementById('stage').appendChild(yearHud); let hudT = null;
  const stats = y => layers.yearStats ? layers.yearStats(y) : {};
  // Phase 9F：有 map.timemachine（timeseries.json 或其快照 fallback）就用台北市年度總量＋年增率當主要讀數；
  // 2026 是 YTD（cs.ytd），標「至今」而不是算年增率箭頭。模組不在（極端情況：init 失敗）才退回舊的逐年計數文案。
  const arrowHtml = cs => cs.ytd ? `<b class="ytd">${cs.year} 至今</b>` : cs.yoyPct == null ? '' : cs.yoyPct > 0.02 ? `<b class="up">▲${Math.round(cs.yoyPct * 100)}%</b>` : cs.yoyPct < -0.02 ? `<b class="down">▼${Math.abs(Math.round(cs.yoyPct * 100))}%</b>` : '<b>持平</b>';
  timeline.onChange((y, prev) => { yr.value = y; yl.textContent = y; updateReadout(); renderTrend(y);
    if (timeline.lapse || Math.abs((prev || y) - y) >= 1) {
      const tm = map.timemachine;
      if (tm && tm.cityStats) { const cs = tm.cityStats(y);
        yearHud.innerHTML = `<div class="y">${y}</div><div class="d">台北市成交 <span class="cv mono">${fmtInt(cs.salesAll)}</span> 件 ${arrowHtml(cs)} · 商辦 <span class="cv mono">${fmtInt(cs.salesOffice)}</span> · 建照核發 <span class="cv mono">${fmtInt(cs.licenses)}</span></div>`;
      } else { const st = stats(y); const parts = []; if (st.stock) parts.push(`<b>+${st.stock}</b> 棟商辦取得使照`); if (st.licenses) parts.push(`<b>${st.licenses}</b> 張建照`); if (st.mops) parts.push(`<b>${st.mops}</b> 筆上市櫃交易`); if (st.future) parts.push(`<b>${st.future}</b> 案完工`);
        yearHud.innerHTML = `<div class="y">${y}</div><div class="d">${parts.length ? parts.join(' · ') : (y > new Date().getFullYear() ? '供給 pipeline 中' : '—')}<span class="tot">累計商辦 ${st.total ?? ''} 棟</span></div>`; }
      yearHud.classList.remove('hidden'); yearHud.classList.remove('pop'); void yearHud.offsetWidth; yearHud.classList.add('pop');
      if (!reduce) yearHud.querySelectorAll('.cv').forEach(v => countUp(v));
      clearTimeout(hudT); hudT = setTimeout(() => yearHud.classList.add('hidden'), timeline.lapse ? 1400 : 2600); } });
  yr.value = timeline.year; yl.textContent = timeline.year;

  /* ---- readout ---- */
  const rLine = $('#readout .line'), rCoords = $('#readout .coords'); let lastReadout = 0;
  function updateReadout(force) {
    const now = performance.now(); if (!force && now - lastReadout < 250) return; lastReadout = now;
    try { const c = map.center(); const d = map.districtAtCamera(); const n = map.countInView(); const parts = [d ? d.name : (c.height > 200000 ? '台灣' : '雙北')];
      if (n.stock) parts.push(`商辦 ${n.stock}`); if (n.future) parts.push(`規劃中 ${n.future}`); if (n.renewal) parts.push(`都更 ${n.renewal}`); if (n.mops) parts.push(`法人交易 ${n.mops}`); if (n.infra) parts.push(`公建 ${n.infra}`); if (map.year !== new Date().getFullYear()) parts.push(`${map.year} 年`);
      rLine.textContent = parts.join(' · '); rCoords.textContent = `${c.lat.toFixed(4)}N ${c.lon.toFixed(4)}E · ${fmtDist(c.height)} · ${Math.round(map.pitch)}° · ${Math.round(((map.heading % 360) + 360) % 360)}°`; } catch { /* camera not ready */ }
  }
  ui.updateReadout = (force) => { updateReadout(force); ui.updateGimbal && ui.updateGimbal(); };

  /* ---- inspector: lens KPIs ---- */
  const lensKPIs = $('#lens-kpis'); const kpiHtml = (v, l, cls) => `<div class="kpi ${cls || ''}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  function renderLensKPIs(id) {
    const k = []; const ds = (data.district_sales && data.district_sales['台北市']) || []; const mops = data.mops || []; const vol12 = mops.reduce((s, m) => s + (m.total_price || 0), 0); const areas = data.business_areas || [];
    const rents = areas.filter(a => a.market_price).map(a => a.market_price.actual_rent_avg); const avgRent = rents.length ? rents.reduce((a, b) => a + b, 0) / rents.length : 0;
    const yields = areas.filter(a => a.market_price && a.market_price.actual_sale_avg).map(a => a.market_price.actual_rent_avg * 12 / a.market_price.actual_sale_avg); const yld = yields.length ? yields.reduce((a, b) => a + b, 0) / yields.length : 0;
    const ren = (data.urban_renewal_stats && data.urban_renewal_stats.by_district) || []; const renTotal = ren.reduce((s, r) => s + (r.count || 0), 0); const infra = data.public_infras || []; const moves = data.registry_moves || [];
    if (id === 'investor') k.push(kpiHtml(fmtMoney(vol12), '上市櫃不動產交易額 · 近 12 月 · 台北市', 'warm'), kpiHtml(mops.length, '公告筆數（快照）'), kpiHtml((yld * 100).toFixed(2) + '<small>%</small>', '商辦毛租金收益率（商圈均值）'), kpiHtml(fmtInt(avgRent) + '<small>元/坪/月</small>', '商圈平均租金'));
    if (id === 'developer') k.push(kpiHtml(fmtInt(renTotal), '台北市都更地區／單元'), kpiHtml((data.building_licenses || []).length, '114–115 年建照（快照）'), kpiHtml((data.future_dev || []).length, '規劃／興建中案（快照）', 'warm'), kpiHtml((data.development_zones || []).length, '重劃／區段徵收（北市）'));
    if (id === 'occupier') k.push(kpiHtml((data.buildings || []).length, '商辦（快照）'), kpiHtml(fmtInt(avgRent) + '<small>元/坪/月</small>', '商圈平均租金', 'warm'), kpiHtml((basemap.mrt_stations || []).length, '捷運站'), kpiHtml((data.providers_summary && data.providers_summary.total) || 39, '生態系服務商'));
    if (id === 'city') k.push(kpiHtml(infra.filter(i => i.status === 'constructing').length, '興建中公共建設'), kpiHtml(moves.length, '跨區遷入企業 · 2026-07（快照）', 'warm'), kpiHtml(fmtInt(renTotal), '都更地區／單元'), kpiHtml((data.industrial_parks || []).length, '產業園區（雙北）'));
    if (id === 'research') { const tot = ds.reduce((s, d) => s + d.transaction_count, 0); k.push(kpiHtml(fmtInt(tot), '台北市實價登錄成交（2012–）'), kpiHtml('477<small>萬</small>', '全國實價登錄筆數'), kpiHtml(ds.length, '行政區'), kpiHtml('2012→2030', '時間軸')); }
    lensKPIs.innerHTML = k.join(''); $('#lens-who').textContent = LENSES[id].who; $('#lens-title').textContent = LENSES[id].name;
    if (!reduce) lensKPIs.querySelectorAll('.kpi .v').forEach(v => countUp(v));
  }
  function countUp(node) { const raw = node.childNodes[0]; if (!raw || raw.nodeType !== 3) return; const txt = raw.textContent; const m = txt.match(/^([^\d]*)([\d,]+(?:\.\d+)?)(.*)$/); if (!m) return; const target = parseFloat(m[2].replace(/,/g, '')); if (!isFinite(target)) return; const dec = (m[2].split('.')[1] || '').length; const t0 = performance.now(); const dur = 700; const step = () => { const u = Math.min(1, (performance.now() - t0) / dur); const e = 1 - Math.pow(1 - u, 3); const val = target * e; raw.textContent = m[1] + (dec ? val.toFixed(dec) : Math.round(val).toLocaleString('zh-TW')) + m[3]; if (u < 1) requestAnimationFrame(step); }; step(); }

  /* ---- inspector: selection ---- */
  const sel = $('#selection');
  const row = (k, v, warm) => v == null || v === '' || v === 'null' ? '' : `<div class="row${warm ? ' warm' : ''}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const precision = p => p === 'area_centroid' ? '約略（區域中心）' : p === 'address' ? '地址定位' : p === 'exact' ? '精確' : p;
  const keyOf = (item, layer) => (KEY_OF[layer] || (it => layer + ':' + it.id))(item);
  ui.select = (item, layer) => { map.selected = item ? { key: keyOf(item, layer), item, layer } : null; renderSelection(item, layer); if (item && innerWidth < 820) document.body.classList.add('show-inspector'); if (!item && map.focus && map.focus.active) map.focus.exit(); };
  ui.isochrone = (item, layer, maxMin = 20) => { if (!map.showIsochrone) return null; const p = itemPos(item); if (!p) return null; ui.setLayer('mrt', true); const info = map.showIsochrone({ lon: p[0], lat: p[1], name: item.name || item.company_name || '這裡', maxMin }); if (info && info.bounds) { const [w, s, e, n] = info.bounds; const span = Math.hypot((e - w) * 111320 * Math.cos(((s + n) / 2) * Math.PI / 180), (n - s) * 110540); map.flyTo((w + e) / 2, (s + n) / 2, { range: Math.max(1600, span * 0.9), pitch: -55 }); } if (info) toast(`${info.origin.name} · ${maxMin} 分鐘捷運圈：可達 ${info.stations} 站${info.farthest ? `，最遠 ${info.farthest.name} ${info.farthest.minutes} 分` : ''}`); return info; };
  ui.walkshed = async (item, profile = 'foot-walking', minutes = [5, 10, 15]) => { if (!map.showWalkshed) return null; const p = itemPos(item); if (!p) return null; const info = await map.showWalkshed({ lon: p[0], lat: p[1], name: item.name || item.company_name || '這裡', profile, minutes }); if (info && info.bounds) { const [w, s, e, n] = info.bounds; const span = Math.hypot((e - w) * 111320 * Math.cos(((s + n) / 2) * Math.PI / 180), (n - s) * 110540); map.flyTo((w + e) / 2, (s + n) / 2, { range: Math.max(1200, span * 0.9), pitch: -55 }); } const label = profile === 'foot-walking' ? '步行' : profile === 'cycling-regular' ? '騎車' : '開車'; if (info) toast(`${info.origin.name} · ${label} ${minutes[minutes.length - 1]} 分生活圈${info.source === 'estimate' ? '（估算，server 未接 ORS）' : ''}：面積約 ${info.areasKm2.map(a => a.toFixed(2)).join(' / ')} km²`); return info; };
  ui.focus = (item, layer, on = true) => { if (!map.focus) return false; if (!on) { map.focus.exit(); if (map.selected) renderSelection(map.selected.item, map.selected.layer); return true; } const p = itemPos(item); if (!p) return false; map.focus.enter({ lon: p[0], lat: p[1], key: keyOf(item, layer) }); if (map.selected) renderSelection(map.selected.item, map.selected.layer); return true; };
  const summaryRows = (it, layer) => {
    if (layer === 'stock') return row('等級', it.grade ? it.grade + ' 級' : null) + row('樓層', `${it.floor_above || '?'}F / B${it.floor_below || '?'}`) + row('實價租金', it.actual_rent_avg_ntd_per_ping ? `均 ${fmtInt(it.actual_rent_avg_ntd_per_ping)} 元/坪/月` : null, true) + row('捷運', it.mrt && it.mrt[0] ? `${it.mrt[0].station_name || it.mrt[0].station} ${it.mrt[0].distance} m` : null);
    if (layer === 'future') return row('開發商', it.developer) + row('完工', it.completion_date) + row('樓層', `${it.floors_above || '?'}F / B${it.floors_below || '?'}`);
    if (layer === 'renewal') return row('類別', it.category) + row('面積', it.area_sqm ? fmtInt(it.area_sqm) + ' m²' : null) + row('行政區', it.district);
    if (layer === 'mops') return row('公告', it.announcement_date) + row('金額', fmtMoney(it.total_price) + ' 元', true) + row('買方', it.buyer_name);
    if (layer === 'moves') return row('日期', it.date) + row('原址', it.before) + row('新址', it.after);
    if (layer === 'licenses') return row('發照', it.issue_date) + row('類型', it.construction_type) + row('地址', it.address || it.first_address);
    if (layer === 'infra') return row('狀態', it.status === 'constructing' ? '興建中' : '規劃中') + row('完工年', it.completion_year);
    if (layer === 'parks') return row('類型', it.park_type) + row('面積', it.area_ha + ' 公頃');
    if (layer === 'heat') { const mp = it.market_price || {}; return row('平均租金', fmtInt(mp.actual_rent_avg) + ' 元/坪/月', true) + row('平均售價', fmtInt((mp.actual_sale_avg || 0) / 1e4) + ' 萬/坪'); }
    return row('類別', it.category) + row('狀態', it.status);
  };
  function renderSelection(it, layer) {
    if (!it) { sel.innerHTML = ''; sel.classList.add('hidden'); return; } sel.classList.remove('hidden'); let h = '';
    const title = it.name || it.company_name || it.license_number || '—'; const L = LAYERS[layer] || { name: layer, color: 'var(--ink-3)' };
    h += `<div class="eyebrow" style="color:${L.color}">${L.name}</div><h3>${escapeHtml(title)}</h3>`;
    if (layer === 'stock') { h += it.photo_thumb ? `<img class="thumb" alt="${escapeHtml(title)} 外觀" src="${it.photo_thumb}" loading="lazy" onerror="this.remove()">` : '';
      h += `<div class="rows">${row('地址', it.rep_address || it.address)}${row('等級', it.grade ? it.grade + ' 級' : null)}${row('樓層', `${it.floor_above || '?'}F / B${it.floor_below || '?'}`)}${row('總樓地板', it.total_floor_area ? fmtInt(it.total_floor_area) + ' m²' : null)}${row('使照', it.license_date)}${row('用途', (it.usage_types || []).join('、'))}${row('認證', (it.certifications || []).map(c => c.type + (c.grade ? '·' + c.grade : '')).join('、'))}${(it.mrt || []).slice(0, 2).map(m => row('捷運', `${m.station_name || m.station} ${m.exit || ''} ${m.distance} m`)).join('')}${row('商圈', it.business_area && (it.business_area.name || it.business_area))}${row('實價租金', it.actual_rent_avg_ntd_per_ping ? `均 ${fmtInt(it.actual_rent_avg_ntd_per_ping)} 元/坪/月 · ${it.actual_rent_count || 0} 筆` : null, true)}${row('實價買賣', it.actual_sale_avg_ntd_per_ping ? `均 ${fmtInt(it.actual_sale_avg_ntd_per_ping / 1e4)} 萬/坪 · ${it.actual_sale_count || 0} 筆` : null, true)}</div>`;
      h += `<div class="chips"><button class="chip" data-say="${escapeHtml(title)}的租戶是誰">租戶</button><button class="chip" data-say="這裡容積率多少">容積率</button><button class="chip" data-say="${escapeHtml(title)}的歷史成交">歷史成交</button><button class="chip" data-say="幫我做這棟的 DD memo">DD memo</button><button class="chip" data-say="環繞模式 ${escapeHtml(title)}">環繞</button><button class="chip" data-say="街景模式 ${escapeHtml(title)}">街景</button></div>`; }
    if (layer === 'future') { const mix = Object.entries(it.usage_mix || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${USAGE[k] || k} ${Math.round(v * 100)}%`).join('、'); h += `<div class="rows">${row('開發商', it.developer)}${row('完工', it.completion_date)}${row('樓層', `${it.floors_above || '?'}F / B${it.floors_below || '?'}`)}${row('標準層', it.max_floor_area ? fmtInt(it.max_floor_area) + ' m²' : null)}${row('用途', mix)}${row('商圈', it.business_area)}${row('定位', precision(it.geo_precision))}</div><div class="chips"><button class="chip" data-say="回到 ${it._year || 2028} 年">看 ${it._year || 2028} 年</button></div>`; }
    if (layer === 'renewal') { const hasP = data.parcels && data.parcels.units && data.parcels.units[it.id]; h += `<div class="rows">${row('編號', it.code)}${row('類別', it.category)}${row('圖層', it.layer)}${row('劃定', it.designation_method)}${row('面積', it.area_sqm ? fmtInt(it.area_sqm) + ' m²（' + fmtInt(it.area_sqm / 3.3058) + ' 坪）' : null)}${row('公告', it.announce_date)}${row('行政區', it.district)}${row('地號資料', hasP ? `${hasP.parcels.length} 筆（已抓）` : '尚未抓取')}</div><div class="chips"><button class="chip ${hasP ? 'brand' : ''}" data-sim="1">🏗 模擬都更量體</button></div>`; }
    if (layer === 'mops') h += `<div class="rows">${row('公告日', it.announcement_date)}${row('公司', `${it.company_name} (${it.company_id})`)}${row('產業', it.industry)}${row('類型', it.product_type)}${row('標的', it.property_name)}${row('地址', it.building_address)}${row('土地', it.land_area_ping ? fmtInt(it.land_area_ping) + ' 坪' : null)}${row('建物', it.building_area_ping ? fmtInt(it.building_area_ping) + ' 坪' : null)}${row('金額', fmtMoney(it.total_price) + ' 元', true)}${row('買方', `${it.buyer_name || ''}（${it.buyer_type || ''}）`)}${row('賣方', `${it.seller_name || ''}（${it.seller_type || ''}）`)}${row('定位', precision(it.geo_precision))}</div>`;
    if (layer === 'infra') h += `<div class="rows">${row('類別', it.subcategory)}${row('狀態', it.status === 'constructing' ? '興建中' : '規劃中')}${row('完工年', it.completion_year)}</div>`;
    if (layer === 'parks') h += `<div class="rows">${row('類型', it.park_type)}${row('法令', it.legal_basis)}${row('狀態', it.status)}${row('面積', it.area_ha + ' 公頃')}${row('主管', it.manager)}</div><div class="chips"><button class="chip" data-say="帶我去${escapeHtml(title)}">飛過去</button></div>`;
    if (layer === 'zones') h += `<div class="rows">${row('類別', it.category)}${row('狀態', it.status)}${row('城市', it.city)}</div>`;
    if (layer === 'licenses') h += `<div class="rows">${row('證號', it.license_number)}${row('發照', it.issue_date)}${row('類型', it.construction_type)}${row('地址', it.address || it.first_address)}${row('設計人', it.designer)}${row('起造人', it.developer_masked ? it.developer_masked + '（來源遮罩）' : null)}</div>`;
    if (layer === 'moves') h += `<div class="rows">${row('統編', it.uniform_number)}${row('日期', it.date)}${row('原址', it.before)}${row('新址', it.after)}${row('範圍', it.move_scope === 'cross_district' ? '跨區' : it.move_scope)}</div>`;
    if (layer === 'heat') { const mp = it.market_price || {}; h += `<div class="meta">${escapeHtml(it.pp_insight || it.description || '')}</div><div class="kpis">${kpiHtml(fmtInt(mp.actual_rent_avg) + '<small>元/坪/月</small>', '平均租金 · YoY ' + ((mp.actual_rent_yoy || 0) * 100).toFixed(1) + '%', mp.actual_rent_yoy >= 0 ? 'up' : 'down')}${kpiHtml(fmtInt((mp.actual_sale_avg || 0) / 1e4) + '<small>萬/坪</small>', '平均售價 · YoY ' + ((mp.actual_sale_yoy || 0) * 100).toFixed(1) + '%', mp.actual_sale_yoy >= 0 ? 'up' : 'down')}${kpiHtml(fmtInt((it.company_stats || {}).total || it.company_total || 0), '企業數 · 成長 ' + (((it.company_stats || {}).growth_rate ?? it.company_growth_rate ?? 0) * 100).toFixed(0) + '%')}${kpiHtml((it.building_stats || []).filter(b => b.grade === 'A').map(b => b.count)[0] ?? '—', 'A 辦棟數')}</div>`; const ser = it.rent_series || []; if (ser.length >= 3) h += sparkSVG('租金季線（元/坪/月）', ser.map(s => ({ t: `${s.year}Q${s.quarter}`, v: s.value }))); }
    if (layer === 'parcels') h += `<div class="rows">${row('地段', `${it.town} ${it.section1} 段（${it.sectcode}）`)}${row('地號', it.landcode)}${row('面積', it.area_sqm ? `${fmtInt(it.area_sqm)} m²（${fmtInt(it.area_sqm / 3.3058)} 坪）` : null)}${row('所屬單元', it.unit_name)}</div><div class="chips"><button class="chip brand" data-say="模擬 ${escapeHtml(it.unit_name || '')} 都更">🏗 模擬這個單元</button></div>`;
    if (layer === 'mrt') h += `<div class="rows">${row('路線', (it.lines || []).join('、'))}</div><div class="chips"><button class="chip" data-say="帶我去${escapeHtml(it.name)}">500m 內商辦</button></div>`;
    const focused = map.focus && map.focus.active && map.focus.active.key === keyOf(it, layer);
    if (itemPos(it)) h += `<div class="chips" style="margin-top:4px"><button class="chip brand" data-pin="1">📌 釘在地圖上</button><button class="chip${focused ? ' brand' : ''}" data-focus="1" title="對焦：其餘量體與標註淡出，只留這棟與周邊 320 m">🔦 ${focused ? '取消對焦' : '對焦'}</button><button class="chip" data-iso="1" title="用內建捷運路網算 20 分鐘可達的站（不需外部 API）">🚇 捷運 20 分圈</button><button class="chip" data-walkshed="1" title="OpenRouteService 真實路網步行生活圈（server 未接 ORS 金鑰時退回估算圈）">🚶 步行 15 分圈</button>${layer === 'stock' && map.floorWalk ? `<button class="chip" data-floorwalk="1" title="第一人稱：走進這棟的樓層向外看（拖曳看四周、滾輪換樓層、W/S 前進）">👁 站上 ${Math.min(12, it.floor_above || 1)} 樓看出去</button>` : ''}</div>`;
    sel.innerHTML = h; sel.querySelectorAll('[data-say]').forEach(b => b.onclick = () => say(b.dataset.say)); const fwb = sel.querySelector('[data-floorwalk]'); if (fwb) fwb.onclick = () => map.floorWalk.enter({ lon: it.lon, lat: it.lat, name: it.name, floors: it.floor_above }); const wsb = sel.querySelector('[data-walkshed]'); if (wsb) wsb.onclick = () => ui.walkshed(it); const ib = sel.querySelector('[data-iso]'); if (ib) ib.onclick = () => ui.isochrone(it, layer, 20); const fb = sel.querySelector('[data-focus]'); if (fb) fb.onclick = () => ui.focus(it, layer, !(map.focus && map.focus.active && map.focus.active.key === keyOf(it, layer))); const pb = sel.querySelector('[data-pin]'); if (pb) pb.onclick = () => ui.pin(it, layer); const sb2 = sel.querySelector('[data-sim]'); if (sb2) sb2.onclick = () => ui.simulateRenewal(it);
  }

  /* ---- overlay: pins (Direction C「釘在地圖上」) & numbered callouts (annotated) ---- */
  const itemPos = it => it && it.lat != null ? [it.lon, it.lat] : it && it._c ? it._c : null;
  const pins = new Map();
  ui.pin = (item, layer) => {
    if (!overlay) return; const key = keyOf(item, layer); if (pins.has(key)) { pins.get(key).remove(); pins.delete(key); return; }
    const p = itemPos(item); if (!p) return; const L = LAYERS[layer] || { name: layer, color: '#93DCE6' }; const title = item.name || item.company_name || item.license_number || '—'; const warm = ['stock', 'mops', 'moves', 'heat'].includes(layer);
    const a = el('div', 'anchor pin' + (warm ? ' warm' : '')); a.innerHTML = `<div class="dot"></div><svg class="leader"><line x1="0" y1="0" x2="0" y2="0" stroke="${warm ? '#F29628' : '#93DCE6'}" stroke-width="1.2" stroke-opacity=".9"></line></svg><div class="pin-card panel"><div class="head"><div><div class="eyebrow" style="color:${L.color}">${L.name}</div><h4>${escapeHtml(title)}</h4></div><button class="x" title="取消釘選">×</button></div><div class="rows">${summaryRows(item, layer)}</div></div>`;
    a.querySelector('.x').onclick = e => { e.stopPropagation(); ui.pin(item, layer); };
    a.querySelector('.pin-card').onclick = () => { ui.select(item, layer); map.pulse(key, 4000); };
    const h = overlay.add(p[0], p[1], (item._h || 0) + 6, a, win => placeAttached(a, win, 140, -96));
    pins.set(key, h); toast(`已釘選「${title}」，卡片會跟著物件移動`);
  };
  function placeAttached(a, win, dx, dy) { const card = a.querySelector('.pin-card, .callout'); const w = card.offsetWidth || 260, h = card.offsetHeight || 40; const flip = win.x + dx + w > innerWidth - 16; const x = flip ? -dx - w : dx; let y = dy; if (win.y + y < 64) y = Math.abs(dy) * 0.6 + 12; if (win.y + y + h > innerHeight - 110) y = -h - Math.abs(dy) * 0.6; card.style.left = x + 'px'; card.style.top = y + 'px'; const line = a.querySelector('svg.leader'); const ex = flip ? x + w : x, ey = y + 18; line.style.left = Math.min(0, ex) + 'px'; line.style.top = Math.min(0, ey) + 'px'; line.setAttribute('width', Math.abs(ex) + 2); line.setAttribute('height', Math.abs(ey) + 2); const l = line.firstElementChild; l.setAttribute('x1', ex < 0 ? -ex : 0); l.setAttribute('y1', ey < 0 ? -ey : 0); l.setAttribute('x2', ex < 0 ? 0 : ex); l.setAttribute('y2', ey < 0 ? 0 : ey); }
  const callouts = []; let calloutHandles = [];
  ui.registerPulse = (key) => { if (callouts.includes(key) || callouts.length >= 8) return; const e = map.entityByKey(key); if (!e || !e.properties || !e.properties.pl) return; const pl = e.properties.pl.getValue(); if (!itemPos(pl.item)) return; callouts.push(key); renderCallouts(); };
  ui.clearCallouts = () => { callouts.length = 0; renderCallouts(); };
  function renderCallouts() {
    calloutHandles.forEach(h => h.remove()); calloutHandles = []; const box = $('#callouts');
    if (!callouts.length || ui.density !== 'annotated' || !overlay) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    const rows = [];
    callouts.forEach((key, i) => { const e = map.entityByKey(key); const pl = e.properties.pl.getValue(); const it = pl.item; const p = itemPos(it); const title = it.name || it.company_name || it.license_number || key; const warm = ['stock', 'mops', 'moves', 'heat'].includes(pl.layer);
      const stat = pl.layer === 'mops' ? fmtMoney(it.total_price) : pl.layer === 'stock' ? (it.grade ? it.grade + ' 級' : '') : pl.layer === 'future' ? `${it.floors_above || '?'}F · ${it._year || ''}` : pl.layer === 'renewal' ? (it.area_sqm ? fmtInt(it.area_sqm) + ' m²' : it.category || '') : pl.layer === 'licenses' ? (it.construction_type || '') : pl.layer === 'moves' ? (it.date || '') : '';
      const a = el('div', 'anchor callout-anchor' + (warm ? ' warm' : '')); a.innerHTML = `<div class="dot"></div><svg class="leader"><line x1="0" y1="0" x2="0" y2="0" stroke="${warm ? '#F29628' : '#93DCE6'}" stroke-width="1.2" stroke-opacity=".9"></line></svg><div class="callout"><span class="n">${i + 1}</span><span class="t">${escapeHtml(title)}</span><span class="s">${escapeHtml(stat)}</span></div>`;
      a.querySelector('.callout').onclick = () => { ui.select(it, pl.layer); map.pulse(key, 4000); };
      calloutHandles.push(overlay.add(p[0], p[1], (it._h || 0) + 6, a, win => placeAttached(a, win, 60 + (i % 3) * 12, -46 - (i % 4) * 14)));
      rows.push(`<div class="row" data-i="${i}"><span class="k"><span class="n">${i + 1}</span>${escapeHtml(title)}</span><span class="v">${escapeHtml(stat)}</span></div>`); });
    box.innerHTML = `<div class="eyebrow">地圖標註 ${CIRCLED[0]}–${CIRCLED[Math.min(callouts.length, 8) - 1]} · 對應卡片</div>${rows.join('')}`; box.classList.remove('hidden');
    box.querySelectorAll('.row').forEach(r => r.onclick = () => { const e = map.entityByKey(callouts[+r.dataset.i]); const pl = e.properties.pl.getValue(); const p = itemPos(pl.item); map.flyTo(p[0], p[1], { range: 900, pitch: -38 }); ui.select(pl.item, pl.layer); });
  }

  /* ---- 智慧都更模擬 card ---- */
  const simBox = el('div', 'sect hidden'); simBox.id = 'simcard'; $('#inspector').insertBefore(simBox, $('#selection'));
  let sim = { unit: null, bonus: 0.3 };
  ui.simulateRenewal = (unit, opts = {}) => {
    const pdata = data.parcels && data.parcels.units ? data.parcels.units[unit.id] : null; sim.unit = unit; if (opts.bonus != null) sim.bonus = opts.bonus;
    if (!pdata) { toast(`「${unit.name}」尚未抓地號（目前 ${Object.keys((data.parcels || {}).units || {}).length} 個單元有資料）`); }
    const r = simulateRenewal(unit, pdata, { bonus: sim.bonus }); ui.setLayer('parcels', true); ui.setLayer('renewal', true);
    if (map.envelope) map.envelope.show(unit, r.height); if (pdata) for (const pc of pdata.parcels || []) map.pulse(`parcel:${pc.sectcode}/${pc.landcode}`, 6000);
    const c = unit._c; if (c) map.flyTo(c[0], c[1], { range: Math.max(700, Math.sqrt(unit.area_sqm || 4000) * 9), pitch: -42 });
    const f = n => fmtInt(n); const ping = n => fmtInt(n / 3.3058);
    simBox.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="eyebrow">智慧都更模擬 · ${escapeHtml(unit.name)}</div><button class="x" data-close title="關閉" style="border:0;padding:0 4px;color:var(--ink-3)">×</button></div>
      <div class="kpis" style="margin-top:4px">${kpiHtml(`${ping(r.siteArea)}<small>坪</small>`, `基地 ${f(r.siteArea)} m² · ${r.parcelCount} 筆地號`)}${kpiHtml(`${r.floors}<small>層</small>`, `量體 ${f(r.height)} m（${Math.round(r.bonus * 100)}% 獎勵）`, 'warm')}${kpiHtml(`${ping(r.totalFloorArea)}<small>坪</small>`, `總樓地板（含免計 ${Math.round(r.exempt * 100)}%）`)}${kpiHtml(r.age != null ? `${r.age}<small>年</small>` : '—', r.oldestYear ? `現況最舊建照 ${r.oldestYear} · ${r.permits} 張` : '現況建照：無套繪資料')}</div>
      <div class="rows" style="margin-top:6px">${row('使用分區', r.zoning ? `${r.zoning.zone_short || r.zoning.zone_code}${r.zoning.is_special_zone ? '（特定區，容積需查細部計畫）' : ''}` : '—')}${row('容積率 / 建蔽率', `${Math.round(r.far * 100)}% / ${Math.round(r.bcr * 100)}%${r.farKnown ? '' : '（假設）'}`)}${row('基準容積', `${ping(r.baseFloorArea)} 坪`)}${row('獎勵容積', `+${ping(r.bonusFloorArea)} 坪`, true)}${row('標準層', `${ping(r.footprint)} 坪`)}${row('整合難度', r.difficulty)}</div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:var(--ink-3)">容積獎勵 <input id="sim-bonus" type="range" min="0" max="50" step="5" value="${Math.round(r.bonus * 100)}" style="flex:1;accent-color:var(--blue-500)"><span class="mono" id="sim-bonus-v" style="color:var(--ink);min-width:34px;text-align:right">${Math.round(r.bonus * 100)}%</span></label>
      <div class="hint" style="margin-top:6px">${r.notes.map(n => '· ' + escapeHtml(n)).join('<br>')}</div>`;
    simBox.classList.remove('hidden'); simBox.querySelector('[data-close]').onclick = () => ui.clearSim();
    const sl = simBox.querySelector('#sim-bonus'); sl.oninput = () => { sim.bonus = +sl.value / 100; simBox.querySelector('#sim-bonus-v').textContent = sl.value + '%'; const r2 = simulateRenewal(unit, pdata, { bonus: sim.bonus }); if (map.envelope) map.envelope.show(unit, r2.height); const k = simBox.querySelectorAll('.kpi .v'); if (k[1]) k[1].innerHTML = `${r2.floors}<small>層</small>`; if (k[2]) k[2].innerHTML = `${ping(r2.totalFloorArea)}<small>坪</small>`; const rows = simBox.querySelectorAll('.row .v'); if (rows[3]) rows[3].textContent = `+${ping(r2.bonusFloorArea)} 坪`; simBox.querySelectorAll('.kpi .l')[1].textContent = `量體 ${f(r2.height)} m（${sl.value}% 獎勵）`; };
    if (innerWidth < 820) document.body.classList.add('show-inspector'); return r;
  };
  ui.clearSim = () => { sim.unit = null; simBox.classList.add('hidden'); simBox.innerHTML = ''; if (map.envelope) map.envelope.clear(); };
  ui.simUnits = () => Object.entries((data.parcels && data.parcels.units) || {}).map(([id, u]) => ({ id, ...u }));

  /* ---- charts ---- */
  function sparkSVG(title, pts) { const w = 280, h = 56, p = 6; const vs = pts.map(x => x.v); const min = Math.min(...vs), max = Math.max(...vs); const X = i => p + i * (w - 2 * p) / Math.max(1, pts.length - 1), Y = v => h - p - (v - min) / ((max - min) || 1) * (h - 2 * p); const d = pts.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x.v).toFixed(1)}`).join(' '); const last = pts[pts.length - 1]; return `<div class="eyebrow">${title} · ${pts[0].t}–${last.t}</div><svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}"><path d="${d} L${X(pts.length - 1).toFixed(1)},${h - p} L${p},${h - p} Z" fill="rgba(242,150,40,.15)"/><path d="${d}" fill="none" stroke="#F29628" stroke-width="2"/><circle cx="${X(pts.length - 1).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="3.5" fill="#FCBE83" stroke="#030712" stroke-width="2"/><text x="${w - p}" y="${Math.max(10, Y(last.v) - 8)}" text-anchor="end" font-size="10" font-family="SF Mono, ui-monospace, monospace" fill="#F3F4F6">${fmtInt(last.v)}</text><text x="${p}" y="${h - 1}" font-size="9" font-family="SF Mono, ui-monospace, monospace" fill="#6A7282">${fmtInt(min)}–${fmtInt(max)}</text></svg>`; }
  ui.showSpark = (title, pts) => { const box = $('#analysis'); box.innerHTML = sparkSVG(title, pts); box.classList.remove('hidden'); };
  let trendOn = false; ui.showTrend = () => { trendOn = true; renderTrend(map.year); };
  function renderTrend(y) { if (!trendOn && !timeline.lapse) return; trendOn = true; const box = $('#analysis'); const years = []; for (let k = 2012; k <= 2030; k++) years.push(k); const cum = years.map(k => ({ t: String(k), v: (data.buildings || []).filter(b => b._built == null || b._built <= k).length + (data.future_dev || []).filter(f => f._year <= k).length })); const idx = years.indexOf(y); const w = 280, h = 64, p = 6; const vs = cum.map(c => c.v); const min = Math.min(...vs), max = Math.max(...vs); const X = i => p + i * (w - 2 * p) / (cum.length - 1), Y = v => h - p - (v - min) / ((max - min) || 1) * (h - 2 * p); const d = cum.map((c, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(c.v).toFixed(1)}`).join(' '); const xi = X(Math.max(0, idx)), yi = Y(cum[Math.max(0, idx)].v);
    box.innerHTML = `<div class="eyebrow">商辦 + 已完工新案 累計 · 2012→2030</div><svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="累計供給趨勢"><path d="${d} L${X(cum.length - 1).toFixed(1)},${h - p} L${p},${h - p} Z" fill="rgba(22,164,192,.12)"/><path d="${d}" fill="none" stroke="#16A4C0" stroke-width="2"/><line x1="${xi.toFixed(1)}" y1="${p}" x2="${xi.toFixed(1)}" y2="${h - p}" stroke="#F29628" stroke-width="1" stroke-dasharray="2 2"/><circle cx="${xi.toFixed(1)}" cy="${yi.toFixed(1)}" r="4" fill="#F29628" stroke="#fff" stroke-width="2"/><text x="${Math.min(w - 30, Math.max(14, xi)).toFixed(1)}" y="${Math.max(10, yi - 9).toFixed(1)}" text-anchor="middle" font-size="10" font-family="SF Mono, ui-monospace, monospace" fill="var(--ink)">${y} · ${cum[Math.max(0, idx)].v}</text></svg><div class="hint" style="margin-top:4px">${y > new Date().getFullYear() ? '未來年份 = 規劃案依完工年計入' : '依使照年份計入（快照 156 棟）'}</div>`; box.classList.remove('hidden'); }
  ui.showBars = (title, rows, color) => { const box = $('#analysis'); rows = (rows || []).filter(r => r && r.v != null); const max = Math.max(...rows.map(r => +r.v || 0)) || 1; box.innerHTML = `<div class="eyebrow">${escapeHtml(title)}</div><div class="bars">${rows.map(r => `<div class="bar"><span class="k" title="${escapeHtml(r.k)}">${escapeHtml(r.k)}</span><span class="t"><i style="width:${((+r.v || 0) / max * 100).toFixed(1)}%;background:${color || 'var(--ch-1)'}"></i></span><span class="v">${r.label != null ? escapeHtml(r.label) : fmtInt(r.v)}</span></div>`).join('')}</div>`; box.classList.remove('hidden'); if (innerWidth < 820) document.body.classList.add('show-inspector'); };

  /* ---- transcript, tool cards, provenance, caption ---- */
  const tr = $('#transcript'); const orb = $('#orb');
  let activeToken = 0; // bumped by every agentTurn(); guards speech/orb/caption so an older, still-finishing turn can never clobber a newer one
  // zh-TW label for the live "查詢 FUNRAISE 產業園區… 第 3 步 · 21 s" progress line — cosmetic best-effort, falls back to a generic phrase.
  const TOOL_LABELS = [[/industrial.?park/i, '產業園區'], [/urban.?renewal|renewal/i, '都更'], [/actual.?price|rental|presale/i, '實價登錄'], [/mops/i, '上市櫃交易'], [/license/i, '建照'], [/registry/i, '公司登記'], [/land.?info|zoning|land/i, '地籍與分區'], [/public.?infra/i, '公共建設'], [/(^|[^a-z])areas?([^a-z]|$)|business/i, '商圈'], [/enterprise|tenant/i, '租戶'], [/dd.?memo/i, 'DD'], [/transcripts?|moi/i, '謄本'], [/mrt/i, '捷運'], [/search_local_snapshot/i, '本地快照']];
  const toolLabel = name => { const hit = TOOL_LABELS.find(([re]) => re.test(name)); if (hit) return `查詢 ${hit[1]}`; if (/^(fly_to|set_camera_mode|present_place)/.test(name)) return '調整鏡頭'; if (/^(set_look|set_theme|set_sun|set_quality)/.test(name)) return '調整外觀'; if (/^(set_layers|set_live_layer|set_overlay|set_basemap)/.test(name)) return '調整圖層'; if (/turn$/.test(name)) return '思考中'; return '執行動作'; };
  const setSummary = (turn, html) => { const s = turn.querySelector('.tools summary'); if (s) s.innerHTML = html; };
  const updateProgress = turn => { if (!turn || !turn._busy) return; const sec = Math.max(0, Math.round((performance.now() - turn._t0) / 1000)); setSummary(turn, `${escapeHtml(turn._label || '思考中')}… 第 ${turn._step || 1} 步 · ${sec} s`); const s = turn.querySelector('.tools summary'); if (s) s.classList.add('live'); };
  // ≤110-char spoken line: first two sentences, markdown bullets/·/來源：… stripped (voice requirement, §16.6).
  function spokenSummary(text) {
    let s = String(text || '').replace(/來源[:：][\s\S]*$/, '');
    s = s.split('\n').filter(l => !/^\s*[·•\-*]/.test(l.trim())).join(' ').replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = s.split(/(?<=[。!?!?])/).map(x => x.trim()).filter(Boolean);
    s = parts.slice(0, 2).join(''); if (!s) s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.slice(0, 110);
  }
  ui.userTurn = text => { ui.clearCallouts(); if (ui.explain) ui.explain.exit(); const t = el('div', 'turn user', `<div class="who">你</div><div class="body">${escapeHtml(text)}</div>`); tr.appendChild(t); tr.scrollTop = tr.scrollHeight; return t; };
  ui.agentTurn = () => {
    orb.classList.add('busy'); const token = ++activeToken;
    const t = el('div', 'turn agent', `<div class="who">睿鏡${ui.claudeMode ? ' · ' + (ui.mcp.provider === 'openai' ? 'OpenAI' : ui.mcp.provider === 'anthropic' ? 'Claude' : 'AI') : ''}</div><div class="body"><div class="tools"><details${ui.density === 'annotated' ? ' open' : ''}><summary></summary><div class="list"></div></details></div><div class="answer caret"></div></div>`);
    t._token = token; t._t0 = performance.now(); t._step = 0; t._busy = true; t._tick = setInterval(() => updateProgress(t), 1000);
    tr.appendChild(t); tr.scrollTop = tr.scrollHeight; return t;
  };
  ui.toolStart = (turn, name, params) => { const p = Object.entries(params || {}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${typeof v === 'string' ? '"' + v + '"' : JSON.stringify(v)}`).join(', '); const c = el('div', 'tool run', `<span class="st"></span><span class="name"><b>${escapeHtml(name)}</b> (${escapeHtml(p.length > 160 ? p.slice(0, 160) + '…' : p)})</span><span class="res">…</span>`); turn.querySelector('.tools .list').appendChild(c); tr.scrollTop = tr.scrollHeight; c._t0 = performance.now(); c._name = name; c._turn = turn; turn._step = (turn._step || 0) + 1; turn._label = toolLabel(name); updateProgress(turn); return c; };
  ui.toolDone = (card, summary) => { card.classList.remove('run'); card.classList.add('ok'); card._ms = Math.round(performance.now() - card._t0); card._summary = summary; card.querySelector('.res').textContent = `${summary} · ${card._ms} ms`; updateProgress(card._turn); };
  const provChip = (turn) => { const cards = [...turn.querySelectorAll('.tool')]; if (!cards.length) return ''; const ms = cards.reduce((s, c) => s + (c._ms || 0), 0); return `<span class="provchip${ui.source === 'LIVE' ? '' : ' snap'}"><i></i>${cards.length} 次 MCP 呼叫 · ${ms} ms · ${ui.source === 'LIVE' ? 'FUNRAISE MCP 即時' : '快照 ' + String(meta.generated_at || '').slice(0, 10)}</span>`; };
  // Finalizes a turn: stops its progress ticker, replaces the live line with the provenance chip, and (only if this is
  // still the newest turn — see activeToken) updates the shared orb/caption/provenance singletons.
  function settle(turn, text) {
    clearInterval(turn._tick); turn._busy = false;
    const chipHtml = provChip(turn); setSummary(turn, chipHtml); const sum = turn.querySelector('.tools summary'); if (sum) { sum.classList.remove('live'); if (chipHtml) sum.title = '展開／收合工具呼叫'; }
    if (turn._token !== activeToken) return;
    orb.classList.remove('busy');
    // Phase 10Q: the AI answer's first sentence now goes through the unified #voicebar instead of the old #caption
    // strip; while a scene is paused waiting on this very question, also surface the way back in.
    if (ui.voicebar) { ui.voicebar.say(text, { mode: 'agent' }); if (director && director.paused) ui.voicebar.showResume(); }
    const prov = $('#provenance'); const cards = [...turn.querySelectorAll('.tool')]; if (cards.length) { prov.innerHTML = `<div class="eyebrow">來源與工具呼叫 · Provenance</div>${cards.map(c => `<div class="prov"><i></i><span class="n"><b>${escapeHtml(c._name || '')}</b></span><span class="r">${escapeHtml(c._summary || '')} · ${c._ms || 0} ms</span></div>`).join('')}`; prov.classList.remove('hidden'); }
    try { if (ui.explain && !ui.sceneId) ui.explain.onAnswer(turn, text); } catch (e) { console.warn('explain', e); }
  }
  ui.type = async (turn, text) => {
    const token = turn._token; const ans = turn.querySelector('.answer'); const spd = reduce ? 0 : 8;
    if (ui.tts && !ui.sceneId && token === activeToken) speech.speak(spokenSummary(text)).catch(() => {});
    if (!spd || token !== activeToken) ans.textContent = text; else { for (let i = 0; i <= text.length; i += 3) { if (token !== activeToken) break; ans.textContent = text.slice(0, i); tr.scrollTop = tr.scrollHeight; await new Promise(r => setTimeout(r, spd)); } ans.textContent = text; }
    ans.title = text; ans.classList.remove('caret');
    settle(turn, text); tr.scrollTop = tr.scrollHeight;
  };
  // Streaming counterpart of ui.type: push(delta) types text as it arrives and speaks the first complete sentence the
  // moment it closes (。！？); done(fullText) reconciles the final text and runs the same wrap-up ui.type does.
  ui.typeStream = (turn) => {
    const token = turn._token; const ans = turn.querySelector('.answer'); let acc = ''; let spoken = false;
    return {
      push(delta) {
        acc += delta || ''; if (token !== activeToken) return;
        ans.textContent = acc; tr.scrollTop = tr.scrollHeight;
        if (!spoken && ui.tts && !ui.sceneId) { const m = acc.match(/^[\s\S]*?[。!?!?]/); if (m) { spoken = true; speech.speak(spokenSummary(m[0])).catch(() => {}); } }
      },
      async done(fullText) {
        const text = fullText || acc; if (token === activeToken) { ans.textContent = text; ans.title = text; ans.classList.remove('caret'); }
        if (!spoken && ui.tts && !ui.sceneId && token === activeToken) speech.speak(spokenSummary(text)).catch(() => {});
        settle(turn, text); tr.scrollTop = tr.scrollHeight;
      },
    };
  };

  /* ---- command bar, suggestions ---- */
  $('#send').onclick = () => say(cmd.value); cmd.addEventListener('keydown', e => { if (e.key === 'Enter') say(cmd.value); });
  function renderSuggest(id) { const box = $('#suggest'); box.innerHTML = ''; for (const s of (LENSES[id] || LENSES.occupier).suggest) { const b = el('button', 'chip', s); b.onclick = () => say(s); box.appendChild(b); } }
  orb.onclick = () => toast(ui.claudeMode ? `AI 模式 · ${ui.mcp.provider || ''} ${ui.mcp.model || ''} · 資料 ${ui.source} · 語音 ${speech.voice}` : `內建 agent · 本地快照 · 語音 ${speech.voice}。按「內建」切到 AI 模式（需 server）`);

  /* ---- speech in / out ---- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const mic = $('#mic'); let rec = null;
  if (!SR) mic.title = '此瀏覽器不支援語音辨識，請改用輸入框';
  mic.onclick = () => { if (!SR) { toast('此瀏覽器不支援語音辨識（Chrome／Edge 可用），請直接輸入'); cmd.focus(); return; } if (rec) { rec.stop(); return; } try { rec = new SR(); rec.lang = 'zh-TW'; rec.interimResults = true; rec.onresult = e => { const t = Array.from(e.results).map(r => r[0].transcript).join(''); cmd.value = t; if (e.results[e.results.length - 1].isFinal) say(t); }; rec.onend = () => { rec = null; mic.classList.remove('listening'); }; rec.onerror = ev => { toast('語音辨識無法使用：' + (ev.error === 'not-allowed' ? '未取得麥克風權限，請改用輸入框' : ev.error)); rec = null; mic.classList.remove('listening'); }; rec.start(); mic.classList.add('listening'); toast('聆聽中…請說出指令'); } catch { toast('語音辨識啟動失敗，請直接輸入'); } };
  const speech = createSpeech({ api: API }); ui.speech = speech;
  const ttsBtn = $('#tts'); const vmenu = el('div', 'panel hidden'); vmenu.id = 'voicemenu'; document.getElementById('stage').appendChild(vmenu);
  function renderVoiceMenu() {
    const vs = speech.voices(); vmenu.innerHTML = `<div class="eyebrow">語音 · Voice</div>` + [`<button data-v="off" aria-pressed="${!ui.tts}"><b>關閉語音</b><span>只顯示文字與字幕</span></button>`, ...vs.map(v => `<button data-v="${v.id}" aria-pressed="${ui.tts && speech.voice === v.id}" ${v.available ? '' : 'disabled'}><b>${escapeHtml(v.name)}${v.id !== 'system' ? ' <i class="tag">Fish Audio</i>' : ''}</b><span>${escapeHtml(v.desc || '')}${v.id !== 'system' ? (v.available ? (speech.fishLive ? ' · 即時合成 + 場景預錄' : ' · 場景預錄（即時回答用系統語音）') : ' · 需 agent server 或預錄檔') : ''}</span></button>`)].join('');
    vmenu.querySelectorAll('button').forEach(b => b.onclick = () => { const v = b.dataset.v; if (v === 'off') { ui.tts = false; speech.stop(); } else { ui.tts = true; speech.setVoice(v); const vv = vs.find(x => x.id === v); toast(`語音：${vv ? vv.name : v}`); if (v !== 'system') speech.speak('你好，我是睿鏡。').catch(() => {}); } ttsBtn.setAttribute('aria-pressed', ui.tts); renderVoiceMenu(); });
  }
  ttsBtn.onclick = () => { vmenu.classList.toggle('hidden'); menu.classList.add('hidden'); renderVoiceMenu(); };
  speech.init().then(vs => { const cur = vs.find(v => v.id === speech.voice); if (!cur || !cur.available) { const first = vs.find(v => v.id !== 'system' && v.available) || vs.find(v => v.id === 'system'); if (first) speech.setVoice(first.id); } ttsBtn.title = `語音：${(vs.find(v => v.id === speech.voice) || {}).name || ''}`; });
  // Phase 10Q (§18.2 旁白節拍): forwards onProgress to #voicebar's sentence-advance too, so scene narration and any
  // other caller of ui.speak(text,{onProgress}) drive the same subtitle without each having to know about voicebar.
  ui.speak = (text, opts = {}) => { const cb = opts.onProgress; const relay = f => { ui.voicebar && ui.voicebar.advance(f); cb && cb(f); };
    if (!ui.tts) { relay(1); return Promise.resolve({ ms: 0, source: 'off' }); } return speech.speak(text, { ...opts, onProgress: relay }); };
  ui.warmSpeech = texts => { if (ui.tts) speech.warm(texts); };

  /* ---- agent mode (built-in ⇄ Claude) ---- */
  const am = $('#agentmode');
  ui.setAgentMode = on => { ui.claudeMode = !!on; am.setAttribute('aria-pressed', ui.claudeMode); am.textContent = ui.claudeMode ? (ui.mcp.provider === 'openai' ? 'OpenAI' : ui.mcp.provider === 'anthropic' ? 'Claude' : 'AI') : '內建'; ui.source = ui.claudeMode && ui.mcp.status === 'live' ? 'LIVE' : '快照'; };
  am.onclick = async () => { if (ui.claudeMode) { ui.setAgentMode(false); toast('切回內建 agent（本地快照，模擬 MCP 呼叫）'); return; } if (!claude) return; toast('偵測 agent server…'); const h = await claude.probe(true); ui.setMcp(h); if (h.ok) { ui.setAgentMode(true); toast(`Claude 模式：${h.model}${h.mcp && h.mcp.status === 'live' ? ' + FUNRAISE MCP 即時查詢' : h.mcp && h.mcp.status === 'unauthorized' ? '（FUNRAISE MCP 未授權：先用快照，點右上角授權）' : '（FUNRAISE MCP 連不上：先用快照）'}`); } else toast('找不到 agent server。請在 app/ 執行 npm run server，並在 .env 設定 ANTHROPIC_API_KEY。'); };

  /* ---- scenes ---- */
  const menu = $('#scenemenu'), sb = $('#scenes');
  for (const sc of SCENES) { const b = el('button', null, `<b>▶ ${sc.title}</b><span>${sc.sub}</span>`); b.onclick = () => { menu.classList.add('hidden'); director && director.play(sc.id); }; menu.appendChild(b); }
  const all = el('button', null, '<b>▶▶ 全部連播（約 4 分鐘）</b><span>投資人 → 開發商 → 選址 → 城市治理 → 時光</span>');
  all.onclick = async () => { menu.classList.add('hidden'); if (!director) return; for (const sc of SCENES) { await director.play(sc.id); if (director.stopFlag) break; } };
  menu.appendChild(all);
  sb.onclick = () => { if (director && director.playing) { director.stop(); toast('場景停止'); return; } menu.classList.toggle('hidden'); vmenu.classList.add('hidden'); };
  // Phase 10Q: look/density/layers/camera snapshot+restore around a scene now lives in SceneDirector itself
  // (docs/11-v2-cesium-app.md §18.2 舞台接管), so this only drives the unified #voicebar (src/ui/voicebar.js) and the
  // cosmetic "▶ 場景／■ 停止" button label + body.cinema dimming — it no longer stops speech or touches density itself.
  ui.cine = (title, text, meta) => { document.body.classList.toggle('cinema', !!title); sb.textContent = title ? '■ 停止' : '▶ 場景'; if (!title) { ui.sceneId = null; ui.voicebar && ui.voicebar.sceneEnd(); return; } ui.sceneId = title; ui.voicebar && ui.voicebar.sceneStep(title, text || '', meta || {}); };

  /* ---- toast, keyboard, mobile ---- */
  let toastT; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3000); } ui.toast = toast;
  addEventListener('keydown', e => {
    if (e.target === cmd || e.metaKey || e.ctrlKey || e.altKey) { if (e.key === 'Escape') cmd.blur(); return; }
    const k = e.key.toLowerCase();
    if (k === '/') { e.preventDefault(); cmd.focus(); } else if (k === 'escape') { if (director && director.playing) director.stop(); menu.classList.add('hidden'); vmenu.classList.add('hidden'); ui.select(null); if (map.clearIsochrone) map.clearIsochrone(); if (map.clearWalkshed) map.clearWalkshed(); }
    else if (k === 'd') ui.cycleDensity(); else if (k === '1') ui.setSensor('normal'); else if (k === '2') ui.setSensor('night'); else if (k === '3') ui.setSensor('thermal'); else if (k === '4') ui.setSensor('blueprint');
    else if (k === 'o') ui.userMode('orbit'); else if (k === 's') ui.userMode('street'); else if (k === 'c') ui.userMode('city'); else if (k === 'g') ui.userMode('globe'); else if (k === 't') ui.userMode('timelapse');
    else if (k === 'l') { const ids = Object.keys(LENSES); agent && agent.setLens(ids[(ids.indexOf(agent.lens) + 1) % ids.length]); } else if (k === 'n') ui.setTheme(ui.theme === 'light' ? 'dark' : 'light'); else if (k === 'b') ui.cycleBasemap(); else if (k === 'p') { if (ui.presenter) { ui.presenter.toggle(); const pb = $('#presenter'); if (pb) pb.setAttribute('aria-pressed', ui.presenter.active); } else sb.click(); }
    else if (k === 'arrowleft') { e.preventDefault(); map.rig.rotateBy(e.shiftKey ? -45 : -15); } else if (k === 'arrowright') { e.preventDefault(); map.rig.rotateBy(e.shiftKey ? 45 : 15); }
    else if (k === 'arrowup') { e.preventDefault(); map.rig.tiltBy(e.shiftKey ? 20 : 8); } else if (k === 'arrowdown') { e.preventDefault(); map.rig.tiltBy(e.shiftKey ? -20 : -8); }
    else if (k === '+' || k === '=') map.rig.zoomBy(0.6); else if (k === '-' || k === '_') map.rig.zoomBy(1.6); else if (k === 'home') map.rig.north();
  });
  $('#m-layers').onclick = () => { document.body.classList.toggle('show-rail'); document.body.classList.remove('show-inspector'); };
  $('#m-insp').onclick = () => { document.body.classList.toggle('show-inspector'); document.body.classList.remove('show-rail'); };
  $('#m-tour').onclick = () => sb.click();
  let saved = null; try { saved = localStorage.getItem('pl.density'); } catch { /* private mode */ }
  ui.setDensity(DENSITY[saved] ? saved : 'balanced', true);
  let savedTheme = null; try { savedTheme = localStorage.getItem('pl.theme'); } catch { /* private mode */ }
  ui.setTheme(savedTheme || 'light', true);
  return ui;
}
