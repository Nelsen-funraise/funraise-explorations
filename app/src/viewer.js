// PeakLens v2 — Cesium viewer setup (keyless by default: NLSC orthophoto + OSM extrusions)
import * as Cesium from 'cesium';

export const BASEMAPS = {
  nlsc_photo: { name: '正射影像（國土測繪中心）', url: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}', credit: '國土測繪中心 通用版電子地圖／正射影像 (NLSC)', max: 19 },
  nlsc_emap: { name: '電子地圖（國土測繪中心）', url: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', credit: '國土測繪中心 通用版電子地圖 (NLSC)', max: 19 },
  esri: { name: '衛星影像（Esri World Imagery）', url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', credit: 'Esri, Maxar, Earthstar Geographics', max: 19 },
  osm: { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', credit: '© OpenStreetMap contributors', max: 19 },
  esri_light: { name: '淺灰底圖（Esri Light Gray）', url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', credit: 'Esri, HERE, Garmin, © OpenStreetMap contributors', max: 16, light: true },
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
  const base = { layer: null, key: null, night: true };
  const setBasemap = (key) => {
    const def = BASEMAPS[key] || BASEMAPS.nlsc_photo;
    if (base.layer) viewer.imageryLayers.remove(base.layer, true);
    const provider = new Cesium.UrlTemplateImageryProvider({ url: def.url, credit: new Cesium.Credit(def.credit), maximumLevel: def.max, enablePickFeatures: false });
    base.layer = viewer.imageryLayers.addImageryProvider(provider); base.key = key; applyTint();
  };
  const applyTint = () => {
    const l = base.layer; if (!l) return; const def = BASEMAPS[base.key] || {};
    if (base.night && !def.light) { l.brightness = base.key === 'nlsc_emap' ? 0.62 : 0.6; l.contrast = 1.22; l.saturation = base.key === 'nlsc_emap' ? 0.3 : 0.55; l.hue = 0.08; l.gamma = 1.05; }
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
  };
  setBasemap(opts.basemap || 'nlsc_photo');

  // optional Google Photorealistic 3D Tiles
  let google = null; const gkey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (gkey) { try { Cesium.GoogleMaps.defaultApiKey = gkey; google = await Cesium.createGooglePhotorealistic3DTileset(); scene.primitives.add(google); } catch (e) { console.warn('Google 3D Tiles unavailable', e); } }
  if (ionToken) { try { viewer.terrainProvider = await Cesium.createWorldTerrainAsync(); } catch (e) { console.warn('World terrain unavailable', e); } }

  return { viewer, scene, setBasemap, setNight: (on) => { base.night = on; applyTint(); }, setTheme, get basemapKey() { return base.key; }, get theme() { return base.theme || 'dark'; }, google };
}
