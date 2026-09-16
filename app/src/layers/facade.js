// Procedural night facades for the batched OSM extrusions: a window grid in metres (3.3 m floors × 3.6 m bays) with ~40% of the windows
// lit warm, a fake vertical AO near the street, roofs left plain. Height above ground comes from true geometry (|position| − ellipsoid
// radius at the footprint centroid, both carried as per-instance batch-table attributes) so it is independent of the colour palette.
import * as Cesium from 'cesium';
export const FACADE_VERTEX_FORMAT = new Cesium.VertexFormat({ position: true, normal: true, st: true });

export const FACADE_VS = /* glsl */`
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec2 st;
in vec4 color;
in float batchId;
out vec3 v_positionEC;
out vec3 v_normalEC;
out vec4 v_color;
out float v_hm;
out float v_up;
out float v_along;
out float v_seed;
void main() {
  vec4 p = czm_computePosition();
  v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
  v_normalEC = czm_normal * normal;
  v_color = color;
  vec3 pos = position3DHigh + position3DLow;
  v_hm = length(pos) - czm_batchTable_ground(batchId);
  v_up = dot(normalize(normal), normalize(pos));
  v_along = st.x * czm_batchTable_bw(batchId) + st.y * czm_batchTable_bh(batchId);
  v_seed = czm_batchTable_height(batchId) * 0.37 + czm_batchTable_bw(batchId) * 0.11;
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}`;

export const FACADE_FS = /* glsl */`
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec4 v_color;
in float v_hm;
in float v_up;
in float v_along;
in float v_seed;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + v_seed) * 43758.5453); }
void main() {
  vec3 positionToEyeEC = -v_positionEC;
  vec3 normalEC = normalize(v_normalEC);
#ifdef FACE_FORWARD
  normalEC = faceforward(normalEC, vec3(0.0, 0.0, 1.0), -normalEC);
#endif
  vec4 base = czm_gammaCorrect(v_color);
  float wall = 1.0 - smoothstep(0.35, 0.6, abs(v_up));
  float floorH = 3.3, bayW = 3.6;
  float fy = fract(v_hm / floorH), fx = fract(v_along / bayW);
  float win = step(0.2, fx) * step(fx, 0.78) * step(0.22, fy) * step(fy, 0.8) * wall * step(2.0, v_hm);
  vec2 cell = vec2(floor(v_along / bayW), floor(v_hm / floorH));
  float lit = step(0.58, hash21(cell));
  float tone = 0.75 + 0.25 * hash21(cell + 17.0);
  float ao = mix(0.72, 1.0, smoothstep(0.0, 14.0, v_hm));
  vec3 warm = vec3(1.0, 0.83, 0.56) * tone;
  vec3 diffuse = mix(base.rgb * ao, base.rgb * 0.55, win);
  czm_materialInput materialInput;
  materialInput.normalEC = normalEC;
  materialInput.positionToEyeEC = positionToEyeEC;
  czm_material material = czm_getDefaultMaterial(materialInput);
  material.diffuse = diffuse;
  material.emission = warm * win * lit * 0.9;
  material.alpha = base.a;
  out_FragColor = czm_phong(normalize(positionToEyeEC), material, czm_lightDirectionEC);
}`;

let cached = null;
export function facadeAppearance() { if (!cached) cached = new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true, flat: false, vertexShaderSource: FACADE_VS, fragmentShaderSource: FACADE_FS }); return cached; }
export function plainAppearance() { return new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true, flat: false }); }
export const facadeAttributes = ({ hm, cx, cy, bw, bh }) => ({
  height: new Cesium.GeometryInstanceAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 1, normalize: false, value: [hm] }),
  ground: new Cesium.GeometryInstanceAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 1, normalize: false, value: [Cesium.Cartesian3.magnitude(Cesium.Cartesian3.fromDegrees(cx, cy, 0))] }),
  bw: new Cesium.GeometryInstanceAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 1, normalize: false, value: [bw] }),
  bh: new Cesium.GeometryInstanceAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 1, normalize: false, value: [bh] }),
});
