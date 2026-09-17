// PeakLens v2 — Cesium viewer setup (keyless by default: NLSC orthophoto + OSM extrusions)
import * as Cesium from 'cesium';

export const BASEMAPS = { // keyless tile sources verified 2026-09-16 (OSM raw tiles removed: blocked by the OSMF tile usage policy for app traffic)
  nlsc_photo: { name: '正射影像（國土測繪中心）', url: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}', credit: '國土測繪中心 正射影像 (NLSC)', max: 19, years: [2014, 2025] },
  nlsc_emap: { name: '電子地圖（國土測繪中心）', url: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', credit: '國土測繪中心 通用版電子地圖 (NLSC)', max: 19 },
  esri: { name: '衛星影像（Esri World Imagery）', url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', credit: 'Esri, Maxar, Earthstar Geographics', max: 19 },
  esri_light: { name: '淺灰底圖（Esri Light Gray）', url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', credit: 'Esri, HERE, Garmin, © OpenStreetMap contributors', max: 16, light: true },
  carto_light: { name: '淺色底圖（CARTO Positron）', url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', credit: '© CARTO, © OpenStreetMap contributors', max: 20, light: true },
  carto_dark: { name: '深色底圖（CARTO Dark Matter）', url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', credit: '© CARTO, © OpenStreetMap contributors', max: 20, dark: true },
  esri_dark: { name: '深灰底圖（Esri Dark Gray）', url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', credit: 'Esri, HERE, Garmin, © OpenStreetMap contributors', max: 16, dark: true },
};
// Keyless NLSC WMTS overlays (段籍界／建物框／公有土地／土壤液化／道路), drawn above the basemap with alpha.
export const OVERLAYS = {
  landsect: { name: '段籍界（地段）', layer: 'LANDSECT', alpha: 0.85, min: 13, credit: 'NLSC 地段外圍圖' },
  buildx: { name: '分棟建物框', layer: 'BUILDX', alpha: 0.9, min: 15, credit: 'NLSC 分棟建物框' },
  publicland: { name: '公有土地', layer: 'LAND_OPENDATA', alpha: 0.7, min: 12, credit: 'NLSC 公有土地地籍圖' },
  liquefaction: { name: '土壤液化潛勢', layer: 'SoilLiquefaction', alpha: 0.5, min: 8, credit: '中央地質調查所 土壤液化潛勢圖 (via NLSC)' },
  road: { name: '道路路網', layer: 'ROAD', alpha: 0.8, min: 10, credit: 'NLSC 道路路網' },
};

export async function createViewer(container, opts = {}) {
  const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
  if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;
  const viewer = new Cesium.Viewer(container, {
    baseLayer: false,
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    animation: false, timeline: false, geocoder: false, homeButton: false, sceneModePicker: false, baseLayerPicker: false,
    navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, vrButton: false,
    requestRenderMode: false, shouldAnimate: true, msaaSamples: 4,
    contextOptions: { webgl: { preserveDrawingBuffer: false, antialias: true, powerPreference: 'high-performance' } },
  });
  const scene = viewer.scene;
  scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a1020');
  scene.backgroundColor = Cesium.Color.fromCssColorString('#04070f');
  scene.globe.enableLighting = false;
  scene.globe.depthTestAgainstTerrain = false;
  scene.globe.showGroundAtmosphere = true;
  scene.skyAtmosphere.show = true;
  scene.skyAtmosphere.brightnessShift = -0.3;
  scene.fog.enabled = true; scene.fog.density = 0.00025;
  scene.postProcessStages.fxaa.enabled = true;
  scene.screenSpaceCameraController.minimumZoomDistance = 40;
  scene.screenSpaceCameraController.maximumZoomDistance = 4.0e6;
  scene.screenSpaceCameraController.enableCollisionDetection = true;
  // Gestures: left-drag pan · right-drag (or middle / ctrl+left) rotate heading + tilt · wheel / pinch zoom — like Google Earth
  scene.screenSpaceCameraController.tiltEventTypes = [Cesium.CameraEventType.RIGHT_DRAG, Cesium.CameraEventType.MIDDLE_DRAG, Cesium.CameraEventType.PINCH, { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL }];
  scene.screenSpaceCameraController.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];
  scene.screenSpaceCameraController.inertiaSpin = 0.85; scene.screenSpaceCameraController.inertiaTranslate = 0.88; scene.screenSpaceCameraController.inertiaZoom = 0.85;
  viewer.cesiumWidget.creditContainer.style.display = 'none';

  // global low-res fallback beneath the Taiwan-only NLSC tiles (bundled with Cesium, offline): Natural Earth II
  try { const ne = await Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')); const neLayer = viewer.imageryLayers.addImageryProvider(ne, 0); neLayer.brightness = 0.55; neLayer.saturation = 0.6; } catch (e) { console.warn('NaturalEarthII unavailable', e); }
  const base = { layer: null, key: null, night: true, year: null, overlays: new Map() };
  const urlFor = (key, def) => (key === 'nlsc_photo' && base.year && def.years && base.year >= def.years[0] && base.year <= def.years[1]) ? def.url.replace('/PHOTO2/', `/PHOTO${base.year}/`) : def.url;
  const setBasemap = (key) => {
    const def = BASEMAPS[key] || BASEMAPS.nlsc_photo; if (!BASEMAPS[key]) key = 'nlsc_photo';
    if (base.layer) viewer.imageryLayers.remove(base.layer, true);
    const provider = new Cesium.UrlTemplateImageryProvider({ url: urlFor(key, def), credit: new Cesium.Credit(def.credit), maximumLevel: def.max, enablePickFeatures: false });
    base.layer = viewer.imageryLayers.addImageryProvider(provider, 1); base.key = key; applyTint();
    for (const [k, l] of base.overlays) viewer.imageryLayers.raiseToTop(l); // keep overlays above the basemap
  };
  // 歷年正射影像：time-lapse years 2014–2025 swap the NLSC orthophoto vintage (時空對比); other years fall back to the current PHOTO2.
  const setYear = (y) => { const yy = y && y >= 2014 && y <= 2025 ? Math.round(y) : null; if (yy === base.year) return false; base.year = yy; if (base.key === 'nlsc_photo') setBasemap('nlsc_photo'); return true; };
  const setOverlay = (k, on) => {
    const def = OVERLAYS[k]; if (!def) return false; const cur = base.overlays.get(k);
    if (on && !cur) { const l = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url: `https://wmts.nlsc.gov.tw/wmts/${def.layer}/default/GoogleMapsCompatible/{z}/{y}/{x}`, credit: new Cesium.Credit(def.credit), minimumLevel: 0, maximumLevel: 19, enablePickFeatures: false })); l.alpha = def.alpha; base.overlays.set(k, l); }
    else if (!on && cur) { viewer.imageryLayers.remove(cur, true); base.overlays.delete(k); }
    return true;
  };
  const credits = () => [(BASEMAPS[base.key] || {}).credit, ...[...base.overlays.keys()].map(k => OVERLAYS[k].credit), 'OpenStreetMap 建物 © OpenStreetMap contributors', 'Natural Earth II'].filter(Boolean);
  // Post-processing quality: ambient occlusion (depth in the white 日間 city), bloom (glow for the 夜間 city), HDR + ACES tonemapping.
  const quality = { ao: false, bloom: false, hdr: false, facade: false, terrain: false };
  const setQuality = (q = {}) => {
    Object.assign(quality, q); const pp = scene.postProcessStages;
    try { pp.ambientOcclusion.enabled = !!quality.ao && Cesium.PostProcessStageLibrary.isAmbientOcclusionSupported(scene); if (pp.ambientOcclusion.enabled) Object.assign(pp.ambientOcclusion.uniforms, { intensity: 2.4, bias: 0.12, lengthCap: 0.26, stepSize: 1.6, blurStepSize: 0.86 }); } catch { /* unsupported */ }
    try { pp.bloom.enabled = !!quality.bloom; if (pp.bloom.enabled) Object.assign(pp.bloom.uniforms, { contrast: 112, brightness: -0.38, glowOnly: false, delta: 1.0, sigma: 2.8, stepSize: 3 }); } catch { /* unsupported */ }
    if ('terrain' in q) setTerrain(quality.terrain);
    try { scene.highDynamicRange = !!quality.hdr; if (quality.hdr && pp.tonemapper !== undefined) pp.tonemapper = Cesium.Tonemapper.ACES; } catch { /* unsupported */ }
    return { ...quality };
  };
  const applyTint = () => {
    const l = base.layer; if (!l) return; const def = BASEMAPS[base.key] || {};
    if (def.dark) { l.brightness = 1; l.contrast = 1.05; l.saturation = 1; l.hue = 0; l.gamma = 1; }
    else if (base.night && !def.light) { l.brightness = base.key === 'nlsc_emap' ? 0.62 : 0.6; l.contrast = 1.22; l.saturation = base.key === 'nlsc_emap' ? 0.3 : 0.55; l.hue = 0.08; l.gamma = 1.05; }
    else if (def.light) { l.brightness = 1.02; l.contrast = 1.0; l.saturation = 0.9; l.hue = 0; l.gamma = 1; }
    else { l.brightness = 1; l.contrast = 1; l.saturation = 1; l.hue = 0; l.gamma = 1; }
  };
  const setTheme = (theme) => { // 'dark' 夜間戰情室 · 'light' PickPeak 日間
    base.theme = theme; const light = theme === 'light';
    scene.globe.baseColor = Cesium.Color.fromCssColorString(light ? '#E5E7EB' : '#0a1020'); scene.backgroundColor = Cesium.Color.fromCssColorString(light ? '#F3F4F6' : '#04070f');
    scene.skyAtmosphere.brightnessShift = light ? 0.05 : -0.3; scene.fog.density = light ? 0.00018 : 0.00025; scene.globe.showGroundAtmosphere = true;
    // Natural Earth II is the offline/fallback ground under the tile basemap: in light theme wash it to a pale canvas so a slow or failed tile layer still reads as PickPeak-light, not green relief.
    const ne = viewer.imageryLayers.get(0); if (ne && ne !== base.layer) { ne.brightness = light ? 1.6 : 0.55; ne.saturation = light ? 0.22 : 0.6; ne.contrast = light ? 0.85 : 1; ne.alpha = light ? 0.55 : 1; }
    base.night = !light; applyTint();
    if (!quality.pinned) setQuality({ ao: false, bloom: !light, facade: !light });
  };
  setBasemap(opts.basemap || 'nlsc_photo');

  // optional Google Photorealistic 3D Tiles
  let google = null; const gkey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (gkey) { try { Cesium.GoogleMaps.defaultApiKey = gkey; google = await Cesium.createGooglePhotorealistic3DTileset(); scene.primitives.add(google); } catch (e) { console.warn('Google 3D Tiles unavailable', e); } }
  // Cesium World Terrain (needs VITE_CESIUM_ION_TOKEN) is opt-in via quality.terrain: the Taipei basin is flat and extruded footprints sit at height 0, so terrain mostly matters for wide shots of the hills.
  let terrainOn = false; const setTerrain = async (on) => { if (!ionToken) return false; if (!!on === terrainOn) return terrainOn; terrainOn = !!on; try { viewer.terrainProvider = terrainOn ? await Cesium.createWorldTerrainAsync() : new Cesium.EllipsoidTerrainProvider(); scene.globe.depthTestAgainstTerrain = false; } catch (e) { console.warn('World terrain unavailable', e); terrainOn = false; } return terrainOn; };

  return { viewer, scene, setBasemap, setYear, setOverlay, get overlays() { return [...base.overlays.keys()]; }, credits, setQuality: (q) => { quality.pinned = true; return setQuality(q); }, get quality() { return { ...quality }; }, get terrainAvailable() { return !!ionToken; }, setNight: (on) => { base.night = on; applyTint(); }, setTheme, get basemapKey() { return base.key; }, get basemapYear() { return base.year; }, get theme() { return base.theme || 'dark'; }, google };
}
