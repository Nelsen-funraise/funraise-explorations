// PeakLens v2 — Cesium viewer setup (keyless by default: NLSC orthophoto + OSM extrusions)
import * as Cesium from 'cesium';

export const BASEMAPS = {
  nlsc_photo: { name: '正射影像（國土測繪中心）', url: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}', credit: '國土測繪中心 通用版電子地圖／正射影像 (NLSC)', max: 19 },
  nlsc_emap: { name: '電子地圖（國土測繪中心）', url: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', credit: '國土測繪中心 通用版電子地圖 (NLSC)', max: 19 },
  esri: { name: '衛星影像（Esri World Imagery）', url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', credit: 'Esri, Maxar, Earthstar Geographics', max: 19 },
  osm: { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', credit: '© OpenStreetMap contributors', max: 19 },
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
  scene.screenSpaceCameraController.tiltEventTypes = [Cesium.CameraEventType.MIDDLE_DRAG, Cesium.CameraEventType.PINCH, { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL }, { eventType: Cesium.CameraEventType.RIGHT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL }];
  scene.screenSpaceCameraController.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH, Cesium.CameraEventType.RIGHT_DRAG];
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
    const l = base.layer; if (!l) return;
    if (base.night) { l.brightness = base.key === 'nlsc_emap' ? 0.62 : 0.6; l.contrast = 1.22; l.saturation = base.key === 'nlsc_emap' ? 0.3 : 0.55; l.hue = 0.08; l.gamma = 1.05; }
    else { l.brightness = 1; l.contrast = 1; l.saturation = 1; l.hue = 0; l.gamma = 1; }
  };
  setBasemap(opts.basemap || 'nlsc_photo');

  // optional Google Photorealistic 3D Tiles
  let google = null; const gkey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (gkey) { try { Cesium.GoogleMaps.defaultApiKey = gkey; google = await Cesium.createGooglePhotorealistic3DTileset(); scene.primitives.add(google); } catch (e) { console.warn('Google 3D Tiles unavailable', e); } }
  if (ionToken) { try { viewer.terrainProvider = await Cesium.createWorldTerrainAsync(); } catch (e) { console.warn('World terrain unavailable', e); } }

  return { viewer, scene, setBasemap, setNight: (on) => { base.night = on; applyTint(); }, get basemapKey() { return base.key; }, google };
}
