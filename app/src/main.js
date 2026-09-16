// PeakLens 睿鏡 v2 — boot: Cesium viewer → data → OSM 3D city → FUNRAISE layers → camera/sensors/timeline → agent → HUD
import * as Cesium from 'cesium';
import { createViewer } from './viewer.js';
import { loadOsmBuildings } from './layers/osmBuildings.js';
import { FunraiseLayers, LAYERS } from './layers/funraise.js';
import { CameraRig } from './camera.js';
import { createSensors } from './sensors.js';
import { Timeline } from './time.js';
import { Agent } from './agent/agent.js';
import { ClaudeClient } from './agent/claudeClient.js';
import { SceneDirector, SCENES } from './scenes.js';
import { MrtNetwork, IsochroneLayer } from './analysis/isochrone.js';
import { playIntro } from './intro.js';
import { createPresenter } from './presenter.js';
import { createFloorWalk } from './tools/floorwalk.js';
import { createMeasure } from './tools/measure.js';
import { createUI } from './ui.js';
import { createHover } from './hover.js';
import { createGround } from './layers/ground.js';
import { TripsLayer } from './layers/trips.js';
import { createLighting } from './fx/lighting.js';
import { createFocus } from './fx/focus.js';
import { createSunControl } from './ui/sun.js';
import { readState, writeState, applyView, copyLink } from './share.js';
import { RenewalEnvelope } from './renewal.js';

const D2R = Math.PI / 180;
const $ = s => document.querySelector(s);
const setMsg = t => { const n = $('#loadmsg'); if (n) n.textContent = t; };
const fetchJSON = async (url, optional) => { try { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return await r.json(); } catch (e) { if (optional) { console.warn(e); return null; } throw e; } };
const HOME = { lon: 121.5650, lat: 25.0350 }; // 信義計畫區

async function boot() {
  setMsg('啟動 Cesium 3D 地球…');
  const api = await createViewer($('#cesiumContainer'), { basemap: 'nlsc_photo' });
  const { viewer, scene } = api;
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(121.2, 23.9, 1.7e6), orientation: { heading: 0, pitch: -89 * D2R, roll: 0 } });

  setMsg('載入 FUNRAISE 資料快照…');
  const [data, basemap] = await Promise.all([fetchJSON('./data/peaklens.json'), fetchJSON('./data/taipei_basemap.json')]);

  let osm = null; let savedTheme = 'light'; try { savedTheme = localStorage.getItem('pl.theme') || 'light'; } catch { /* private mode */ }
  if (!api.google) { try { osm = await loadOsmBuildings(viewer, './data/osm_buildings_taipei.json', p => setMsg(`載入 OpenStreetMap 3D 建物 ${Math.round(p * 100)}%`), { palette: savedTheme === 'light' ? 'light' : 'dark', facade: savedTheme !== 'light' }); } catch (e) { console.warn('OSM buildings unavailable — FUNRAISE buildings fall back to boxes', e); } }

  setMsg('建立 FUNRAISE 圖層…');
  const layers = new FunraiseLayers(viewer, data, basemap, osm); layers.build();
  let ground = null; try { ground = createGround(viewer, basemap); } catch (e) { console.warn('ground layer unavailable', e); }
  let trips = null; try { trips = new TripsLayer(viewer, data, layers); } catch (e) { console.warn('trips layer unavailable', e); }
  let isochrone = null; try { isochrone = new IsochroneLayer(viewer, new MrtNetwork(basemap), { theme: savedTheme === 'light' ? 'light' : 'dark' }); } catch (e) { console.warn('isochrone unavailable', e); }
  const rig = new CameraRig(viewer); rig.bindUserInterrupt(viewer.canvas);
  let floorWalk = null; try { floorWalk = createFloorWalk({ viewer, rig, osm, layers }); } catch (e) { console.warn('floor walk unavailable', e); }
  const sensors = createSensors(scene); const timeline = new Timeline(layers);
  const overlay = createOverlay(scene, $('#overlay')); const envelope = new RenewalEnvelope(viewer);
  const lighting = createLighting(viewer, osm); const hover = createHover($('#stage')); const focus = createFocus({ viewer, osm, layers });
  const st = readState(); // deep link (#v=…)? read it now, before any UI init can rewrite the hash
  const state = { selected: null };
  const groundAt = (x, y) => { const win = new Cesium.Cartesian2(x, y); const ray = viewer.camera.getPickRay(win); let p = ray && scene.globe.pick(ray, scene); if (!p) p = viewer.camera.pickEllipsoid(win, scene.globe.ellipsoid); return p ? Cesium.Cartographic.fromCartesian(p) : null; };

  /* ---- map facade shared by the rule-based agent, Claude tool executor and the scene director ---- */
  const map = {
    data, basemap, osm, rig, envelope, lighting, ground, focus, trips, isochrone, floorWalk,
    showIsochrone: (o) => isochrone ? isochrone.show(o) : null, clearIsochrone: () => isochrone && isochrone.clear(), get isochroneActive() { return !!(isochrone && isochrone.active); },
    layerKeys: Object.keys(LAYERS), layerName: k => (LAYERS[k] || { name: k }).name,
    get year() { return timeline.year; }, setYear: y => timeline.set(y),
    get mode() { return timeline.lapse ? 'timelapse' : rig.mode; },
    get selected() { return state.selected; }, set selected(v) { state.selected = v; },
    get heading() { return rig.heading; }, get pitch() { return rig.pitch; },
    center() { const c = viewer.canvas; const g = groundAt(c.clientWidth / 2, c.clientHeight / 2); const [lon, lat, h] = rig.lonlat; return g ? { lon: g.longitude / D2R, lat: g.latitude / D2R, height: h } : { lon, lat, height: h }; },
    bounds: () => rig.bounds(),
    countInView() { return layers.countInView(rig.bounds()); },
    districtAtCamera() { const c = map.center(); return layers.districtAt(c.lon, c.lat); },
    districtCentroid: name => layers.districtCentroids.get(name) || null,
    visibleLayers: () => ui.visibleLayers(),
    entityByKey(key) { if (layers.byKey.has(key)) return layers.byKey.get(key); for (const [k, e] of layers.byKey) if (k.startsWith(key + ':')) return e; return null; },
    pulse: (key, ms) => { layers.pulse(key, ms); if (typeof ui !== 'undefined') ui.registerPulse(key); },
    flyTo(lon, lat, o = {}) { if (rig.mode === 'orbit' || rig.mode === 'globe') rig.mode = 'city'; rig.flyTo(lon, lat, { range: o.range ?? 1500, pitch: o.pitch ?? -45, heading: o.heading ?? null, duration: o.duration ?? 2.2, done: o.done }); },
    city(lon, lat) { const c = map.center(); rig.city(lon ?? c.lon, lat ?? c.lat); },
    street: (lon, lat) => rig.street(lon, lat),
    orbit: (lon, lat, range = 1400, pitch = -35, speed = 0.09) => rig.startOrbit(lon, lat, { range, pitch, speed }),
    globe: () => rig.globe(),
  };

  const ui = createUI({ map, data, basemap, layers, timeline, sensors, viewerApi: api, overlay, cameraMode: m => {
    const c = map.center();
    if (m === 'orbit') map.orbit(c.lon, c.lat, Math.min(Math.max(c.height * 0.9, 500), 7000), -35);
    else if (m === 'street') map.street(c.lon, c.lat);
    else if (m === 'globe') map.globe();
    else if (m === 'city') map.city(c.lon, c.lat);
    else if (m === 'timelapse' && (rig.mode !== 'city' || c.height < 3000)) map.flyTo(HOME.lon, HOME.lat, { range: 10000, pitch: -55, heading: 20 });
  } });
  let booted = false; ui.syncUrl = () => { if (!booted) return; try { writeState({ map, ui, agent }); } catch { /* ignore */ } };
  ui.shareView = async () => { const url = writeState({ map, ui, agent }); const ok = await copyLink(url); ui.toast(ok ? '已複製這個視角的連結（含鏡、年份、主題、圖層）' : '瀏覽器不允許存取剪貼簿，連結已放在網址列'); return url; };
  $('#share').onclick = () => ui.shareView();
  createSunControl({ ui, lighting, stage: $('#stage'), onChange: () => ui.syncUrl() });
  for (const fn of ['setTheme', 'setDensity', 'setLayer']) { const orig = ui[fn]; ui[fn] = (...a) => { const r = orig(...a); ui.syncUrl(); return r; }; }
  timeline.onChange(y => { if (api.setYear(y)) ui.updateCredits && ui.updateCredits(); if (trips) trips.setYear(y); });
  if (trips) { trips.setTheme(ui.theme); const origTheme = ui.setTheme; ui.setTheme = (...a) => { const r = origTheme(...a); trips.setTheme(ui.theme); return r; }; } // 歷年正射影像跟著時間軸換底圖（2014–2025）
  const agent = new Agent(map, data, ui);
  const claude = new ClaudeClient(map, ui, agent);
  const director = new SceneDirector({ map, ui, agent, data, timeline });
  ui.attach({ agent, claude, director });
  const measure = createMeasure({ viewer, onSite: site => { const unit = { id: 'draw:' + Date.now(), name: '手繪基地', area_sqm: site.areaSqm, rings: [site.ring], _c: site.centroid }; ui.simulateRenewal(unit); ui.toast(`手繪基地 ${Math.round(site.areaPing).toLocaleString('zh-TW')} 坪 → 容積量體試算`); }, onStatus: () => {} });
  map.measure = measure; measure.setTheme(ui.theme); { const orig = ui.setTheme; ui.setTheme = (...a) => { const r = orig(...a); measure.setTheme(ui.theme); return r; }; } ui.bindMeasure && ui.bindMeasure(measure);
  const presenter = createPresenter({ ui, director, scenes: SCENES, viewer }); ui.presenter = presenter; const presenterBtn = $('#presenter'); if (presenterBtn) presenterBtn.onclick = () => { presenter.toggle(); presenterBtn.setAttribute('aria-pressed', presenter.active); };
  { const orig = agent.setLens.bind(agent); agent.setLens = id => { orig(id); ui.syncUrl(); }; }

  /* ---- picking ---- */
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  const pickPL = pos => { try { const p = scene.pick(pos); const id = p && p.id; const prop = id && id.properties && id.properties.pl; return prop ? prop.getValue(viewer.clock.currentTime) : null; } catch { return null; } };
  handler.setInputAction(m => { if (viewer.canvas.dataset.tool) return; const picked = scene.pick(m.position); if (picked && picked.id && picked.id.cluster) { const ents = picked.id.cluster; let x = 0, y = 0, n = 0; for (const e of ents) { const pl = e.properties && e.properties.pl ? e.properties.pl.getValue() : null; if (pl && pl.item.lat) { x += pl.item.lon; y += pl.item.lat; n++; } } if (n) map.flyTo(x / n, y / n, { range: Math.max(900, 260 * Math.sqrt(n) * 2), pitch: -48 }); return; } const pl = pickPL(m.position); if (pl) { map.pulse(pl.key, 6000); ui.select(pl.item, pl.layer); } else ui.select(null); }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction(m => { if (viewer.canvas.dataset.tool) return; const pl = pickPL(m.position); const it = pl && pl.item; if (it && it.lat) map.flyTo(it.lon, it.lat, { range: pl.layer === 'stock' ? 650 : 1500, pitch: -35 }); else if (it && it._c) map.flyTo(it._c[0], it._c[1], { range: 1200, pitch: -40 }); }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  let hoverT = 0; handler.setInputAction(m => { const now = performance.now(); if (now - hoverT < 90) return; hoverT = now; const picked = scene.pick(m.endPosition); const hit = picked && picked.id && (picked.id.cluster || (picked.id.properties && picked.id.properties.pl)); viewer.canvas.style.cursor = hit ? 'pointer' : ''; hover.update(hit ? picked : null, m.endPosition); }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  /* ---- readout ---- */
  viewer.camera.percentageChanged = 0.02;
  viewer.camera.changed.addEventListener(() => ui.updateReadout());
  viewer.camera.moveEnd.addEventListener(() => { ui.updateReadout(true); ui.syncUrl(); });
  // auto-hide only for the user's own camera gestures (drag / wheel / pinch), not for agent or scene flights
  viewer.canvas.addEventListener('pointerdown', () => { ui.onCameraMove(); hover.hide(); }, { passive: true }); viewer.canvas.addEventListener('pointerleave', () => hover.hide());
  viewer.canvas.addEventListener('pointermove', e => { if (e.buttons) ui.onCameraMove(); }, { passive: true });
  viewer.canvas.addEventListener('wheel', () => ui.onCameraMove(), { passive: true });
  setInterval(() => { if (rig.orbit) ui.updateReadout(); }, 1000);

  /* ---- go ---- */
  agent.setLens('occupier'); ui.setSensor('normal');
  $('#loading').classList.add('done');
  if (st) { if (st.lens) agent.setLens(st.lens); if (st.year) timeline.set(st.year); if (st.t) ui.setTheme(st.t, true); if (st.d) ui.setDensity(st.d, true); if (st.layers) for (const k of map.layerKeys) ui.setLayer(k, st.layers.includes(k)); if (st.sun != null) ui.setSun(st.sun, true); }
  const reduce = matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (st && st.view) { applyView(viewer, st.view); ui.updateReadout(true); }
  else if (reduce) rig.flyTo(HOME.lon, HOME.lat, { range: 9500, pitch: -55, heading: 20, duration: 1.2, done: () => ui.updateReadout(true) });
  else playIntro({ viewer, rig, home: HOME, onDone: () => ui.updateReadout(true) }); // 開場定軌鏡頭（任意鍵略過）
  if (st && st.scene) setTimeout(() => director.play(st.scene), 1200);
  booted = true;
  const osmNote = osm ? `${osm.count.toLocaleString('zh-TW')} 棟 OpenStreetMap 3D 建物` : (api.google ? 'Google 相片級 3D Tiles' : '（OSM 建物未載入）');
  setTimeout(() => { const a = ui.agentTurn(); ui.type(a, `你好，這是「睿鏡 PeakLens」v2：真實 3D 台北（${osmNote} × 國土測繪中心正射影像）疊上 FUNRAISE MCP 的 ${(data.buildings || []).length} 棟商辦、${(data.urban_renewal || []).length} 個都更單元、${(data.mops || []).length} 筆上市櫃資產交易、${(data.registry_moves || []).length} 家企業遷徙。按「▶ 場景」看五段電影式巡航，或直接對城市說話：「帶我去信義計畫區」「2028 年南港會長出什麼」。右上角可切換 HUD 密度（沉浸／平衡／標註，快捷鍵 D）。`); }, 1500);
  claude.probe().then(h => { ui.setMcp(h); if (h && h.mcp && h.mcp.status === 'unauthorized') setTimeout(() => ui.toast('FUNRAISE MCP 尚未授權：先用快照資料。點右上角「點此授權」即可即時查詢'), 2600); });
  window.PL = { Cesium, viewer, map, layers, agent, ui, timeline, director, claude, data, osm, rig, lighting, hover, ground, focus, trips, isochrone, presenter, floorWalk, measure, viewerApi: api };
}
/* HTML overlay anchored to world positions (pins, numbered callouts): repositioned every frame, hidden behind the globe. */
function createOverlay(scene, container) {
  const items = new Set(); const toWin = Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
  const occ = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, scene.camera.position); const scratch = new Cesium.Cartesian2();
  scene.postRender.addEventListener(() => {
    if (!items.size) return; occ.cameraPosition = scene.camera.position;
    for (const it of items) { const win = toWin(scene, it.pos, scratch); const vis = win && occ.isPointVisible(it.pos) && win.x > -200 && win.y > -200 && win.x < scene.canvas.clientWidth + 200 && win.y < scene.canvas.clientHeight + 200; if (!vis) { it.el.classList.add('behind'); continue; } it.el.classList.remove('behind'); it.el.style.transform = `translate(${win.x.toFixed(1)}px, ${win.y.toFixed(1)}px)`; if (it.onPlace) it.onPlace(win); }
  });
  return { add(lon, lat, height, el, onPlace) { const it = { pos: Cesium.Cartesian3.fromDegrees(lon, lat, height || 0), el, onPlace }; container.appendChild(el); items.add(it); return { remove() { items.delete(it); el.remove(); } }; }, get size() { return items.size; } };
}
boot().catch(e => { console.error(e); setMsg('啟動失敗：' + (e && e.message || e) + '。需要支援 WebGL 2 的瀏覽器。'); const sp = document.querySelector('#loading .spinner'); if (sp) sp.style.display = 'none'; });
