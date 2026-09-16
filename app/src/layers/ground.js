// Ground dressing from the bundled basemap vectors: rivers as animated water corridors (metre widths), roads as night glow lines.
// Both are batched Primitives (one draw call each) so they cost nothing at 57k-building scale.
import * as Cesium from 'cesium';
const RIVER_WIDTH = { '淡水河': 380, '大漢溪': 300, '新店溪': 220, '基隆河': 120, '景美溪': 70, '雙溪': 45, '磺溪': 35, '塔寮坑溪': 40, '三峽河': 90, '南崁溪': 60 };
const ROAD_WIDTH = { motorway: 4.2, trunk: 3.4, primary: 2.8, secondary: 2.0, tertiary: 1.4 };
const ROAD_COLOR = { motorway: '#F2C583', trunk: '#F2C583', primary: '#FCBE83', secondary: '#8CDCE7', tertiary: '#8CDCE7' };

export function createGround(viewer, basemap) {
  const scene = viewer.scene; let theme = 'dark';
  const water = Cesium.Material.fromType('Water', { baseWaterColor: Cesium.Color.fromCssColorString('#0B2A4A').withAlpha(0.92), blendColor: Cesium.Color.fromCssColorString('#16A4C0').withAlpha(0.4), normalMap: Cesium.buildModuleUrl('Assets/Textures/waterNormals.jpg'), frequency: 900.0, animationSpeed: 0.012, amplitude: 3.5, specularIntensity: 0.55 });
  // rivers → corridors
  const riverInstances = [];
  for (const r of basemap.rivers || []) { if (!r.coords || r.coords.length < 2) continue; const w = RIVER_WIDTH[r.name] || 50; try { riverInstances.push(new Cesium.GeometryInstance({ geometry: new Cesium.CorridorGeometry({ positions: Cesium.Cartesian3.fromDegreesArray(r.coords.flat()), width: w, height: 0.25, cornerType: Cesium.CornerType.ROUNDED, vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT }), id: 'river:' + r.name })); } catch { /* degenerate */ } }
  const rivers = riverInstances.length ? scene.primitives.add(new Cesium.Primitive({ geometryInstances: riverInstances, appearance: new Cesium.EllipsoidSurfaceAppearance({ material: water, aboveGround: true }), asynchronous: true, allowPicking: false, releaseGeometryInstances: true })) : null;
  // roads → glow polylines grouped by class (one primitive per class so widths/colours differ)
  const roadPrims = [];
  const byCls = new Map(); for (const rd of basemap.roads || []) { if (!rd.coords || rd.coords.length < 2) continue; const cls = ROAD_WIDTH[rd.cls] ? rd.cls : 'tertiary'; if (!byCls.has(cls)) byCls.set(cls, []); byCls.get(cls).push(rd); }
  for (const [cls, list] of byCls) {
    const inst = []; for (const rd of list) { try { inst.push(new Cesium.GeometryInstance({ geometry: new Cesium.PolylineGeometry({ positions: Cesium.Cartesian3.fromDegreesArrayHeights(rd.coords.flatMap(([x, y]) => [x, y, 0.6])), width: ROAD_WIDTH[cls], vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT }) })); } catch { /* degenerate */ } }
    if (!inst.length) continue;
    const mat = Cesium.Material.fromType('PolylineGlow', { color: Cesium.Color.fromCssColorString(ROAD_COLOR[cls]).withAlpha(cls === 'tertiary' ? 0.35 : 0.7), glowPower: 0.28, taperPower: 1.0 });
    roadPrims.push(scene.primitives.add(new Cesium.Primitive({ geometryInstances: inst, appearance: new Cesium.PolylineMaterialAppearance({ material: mat, translucent: true }), asynchronous: true, allowPicking: false, releaseGeometryInstances: true })));
  }
  const vis = { rivers: true, roads: true };
  const apply = () => { const light = theme === 'light'; if (rivers) { rivers.show = vis.rivers; water.uniforms.baseWaterColor = Cesium.Color.fromCssColorString(light ? '#9CCBDC' : '#0B2A4A').withAlpha(light ? 0.85 : 0.92); water.uniforms.blendColor = Cesium.Color.fromCssColorString(light ? '#DFF3F7' : '#16A4C0').withAlpha(light ? 0.55 : 0.4); water.uniforms.specularIntensity = light ? 0.35 : 0.55; } for (const p of roadPrims) p.show = vis.roads && !light; };
  apply();
  return {
    rivers, roads: roadPrims, counts: { rivers: riverInstances.length, roads: (basemap.roads || []).length },
    setTheme(t) { theme = t === 'light' ? 'light' : 'dark'; apply(); },
    setVisible(o = {}) { Object.assign(vis, o); apply(); }, get visible() { return { ...vis }; },
  };
}
