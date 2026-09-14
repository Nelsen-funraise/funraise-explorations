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
import { SceneDirector } from './scenes.js';
import { createUI } from './ui.js';

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

  let osm = null;
  if (!api.google) { try { osm = await loadOsmBuildings(viewer, './data/osm_buildings_taipei.json', p => setMsg(`載入 OpenStreetMap 3D 建物 ${Math.round(p * 100)}%`)); } catch (e) { console.warn('OSM buildings unavailable — FUNRAISE buildings fall back to boxes', e); } }

  setMsg('建立 FUNRAISE 圖層…');
  const layers = new FunraiseLayers(viewer, data, basemap, osm); layers.build();
  const rig = new CameraRig(viewer); rig.bindUserInterrupt(viewer.canvas);
  const sensors = createSensors(scene); const timeline = new Timeline(layers);
  const state = { selected: null };
  const groundAt = (x, y) => { const win = new Cesium.Cartesian2(x, y); const ray = viewer.camera.getPickRay(win); let p = ray && scene.globe.pick(ray, scene); if (!p) p = viewer.camera.pickEllipsoid(win, scene.globe.ellipsoid); return p ? Cesium.Cartographic.fromCartesian(p) : null; };

  /* ---- map facade shared by the rule-based agent, Claude tool executor and the scene director ---- */
  const map = {
    data, basemap, osm, layerKeys: Object.keys(LAYERS), layerName: k => (LAYERS[k] || { name: k }).name,
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
    pulse: (key, ms) => layers.pulse(key, ms),
    flyTo(lon, lat, o = {}) { if (rig.mode === 'orbit' || rig.mode === 'globe') rig.mode = 'city'; rig.flyTo(lon, lat, { range: o.range ?? 1500, pitch: o.pitch ?? -45, heading: o.heading ?? null, duration: o.duration ?? 2.2, done: o.done }); },
    city(lon, lat) { const c = map.center(); rig.city(lon ?? c.lon, lat ?? c.lat); },
    street: (lon, lat) => rig.street(lon, lat),
    orbit: (lon, lat, range = 1400, pitch = -35, speed = 0.09) => rig.startOrbit(lon, lat, { range, pitch, speed }),
    globe: () => rig.globe(),
  };

  const ui = createUI({ map, data, basemap, layers, timeline, sensors, viewerApi: api, cameraMode: m => {
    const c = map.center();
    if (m === 'orbit') map.orbit(c.lon, c.lat, Math.min(Math.max(c.height * 0.9, 500), 7000), -35);
    else if (m === 'street') map.street(c.lon, c.lat);
    else if (m === 'globe') map.globe();
    else if (m === 'city') map.city(c.lon, c.lat);
    else if (m === 'timelapse' && (rig.mode !== 'city' || c.height < 3000)) map.flyTo(HOME.lon, HOME.lat, { range: 10000, pitch: -55, heading: 20 });
  } });
  const agent = new Agent(map, data, ui);
  const claude = new ClaudeClient(map, ui, agent);
  const director = new SceneDirector({ map, ui, agent, data, timeline });
  ui.attach({ agent, claude, director });

  /* ---- picking ---- */
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  const pickPL = pos => { try { const p = scene.pick(pos); const id = p && p.id; const prop = id && id.properties && id.properties.pl; return prop ? prop.getValue(viewer.clock.currentTime) : null; } catch { return null; } };
  handler.setInputAction(m => { const pl = pickPL(m.position); if (pl) { map.pulse(pl.key, 6000); ui.select(pl.item, pl.layer); } else ui.select(null); }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction(m => { const pl = pickPL(m.position); const it = pl && pl.item; if (it && it.lat) map.flyTo(it.lon, it.lat, { range: pl.layer === 'stock' ? 650 : 1500, pitch: -35 }); else if (it && it._c) map.flyTo(it._c[0], it._c[1], { range: 1200, pitch: -40 }); }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  let hoverT = 0; handler.setInputAction(m => { const now = performance.now(); if (now - hoverT < 90) return; hoverT = now; viewer.canvas.style.cursor = pickPL(m.endPosition) ? 'pointer' : ''; }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  /* ---- readout ---- */
  viewer.camera.percentageChanged = 0.02;
  viewer.camera.changed.addEventListener(() => ui.updateReadout());
  viewer.camera.moveEnd.addEventListener(() => ui.updateReadout(true));
  setInterval(() => { if (rig.orbit) ui.updateReadout(); }, 1000);

  /* ---- go ---- */
  agent.setLens('occupier'); ui.setSensor('normal'); ui.setNight(true);
  $('#loading').classList.add('done');
  rig.flyTo(HOME.lon, HOME.lat, { range: 9500, pitch: -55, heading: 20, duration: 4.5, done: () => ui.updateReadout(true) });
  const osmNote = osm ? `${osm.count.toLocaleString('zh-TW')} 棟 OpenStreetMap 3D 建物` : (api.google ? 'Google 相片級 3D Tiles' : '（OSM 建物未載入）');
  setTimeout(() => { const a = ui.agentTurn(); ui.type(a, `你好，這是「睿鏡 PeakLens」v2：真實 3D 台北（${osmNote} × 國土測繪中心正射影像）疊上 FUNRAISE MCP 的 ${(data.buildings || []).length} 棟商辦、${(data.urban_renewal || []).length} 個都更單元、${(data.mops || []).length} 筆上市櫃資產交易、${(data.registry_moves || []).length} 家企業遷徙。按「▶ 場景」看五段電影式巡航，或直接對城市說話：「帶我去信義計畫區」「2028 年南港會長出什麼」。`); }, 1500);
  claude.probe().then(h => { if (h.ok) ui.setMcpStatus(`FUNRAISE MCP · server ready · ${h.model}`); });
  window.PL = { Cesium, viewer, map, layers, agent, ui, timeline, director, claude, data, osm, rig };
}
boot().catch(e => { console.error(e); setMsg('啟動失敗：' + (e && e.message || e) + '。需要支援 WebGL 2 的瀏覽器。'); const sp = document.querySelector('#loading .spinner'); if (sp) sp.style.display = 'none'; });
