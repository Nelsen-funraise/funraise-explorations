// Sensor styles as Cesium post-process stages (GEV-style CRT / night vision / thermal / blueprint)
import * as Cesium from 'cesium';
const NIGHT = `uniform sampler2D colorTexture; in vec2 v_textureCoordinates; uniform float u_time;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){ vec4 c = texture(colorTexture, v_textureCoordinates); float l = dot(c.rgb, vec3(0.299,0.587,0.114));
 l = pow(l * 1.9, 0.85); float scan = 0.92 + 0.08 * sin(v_textureCoordinates.y * 900.0); float n = hash(v_textureCoordinates * u_time) * 0.08;
 vec2 d = v_textureCoordinates - 0.5; float vig = 1.0 - dot(d, d) * 1.4; out_FragColor = vec4(vec3(0.12, 1.0, 0.35) * (l + n) * scan * vig, 1.0); }`;
const THERMAL = `uniform sampler2D colorTexture; in vec2 v_textureCoordinates;
vec3 pal(float t){ return mix(mix(vec3(0.02,0.0,0.25), vec3(0.6,0.0,0.6), smoothstep(0.0,0.35,t)), mix(vec3(1.0,0.35,0.0), vec3(1.0,1.0,0.75), smoothstep(0.5,1.0,t)), smoothstep(0.3,0.7,t)); }
void main(){ vec4 c = texture(colorTexture, v_textureCoordinates); float l = dot(c.rgb, vec3(0.299,0.587,0.114)); float warm = max(c.r - c.b, 0.0) * 1.5; out_FragColor = vec4(pal(clamp(l * 1.3 + warm, 0.0, 1.0)), 1.0); }`;
const BLUEPRINT = `uniform sampler2D colorTexture; in vec2 v_textureCoordinates;
void main(){ vec4 c = texture(colorTexture, v_textureCoordinates); float l = dot(c.rgb, vec3(0.299,0.587,0.114));
 vec2 px = 1.0 / vec2(textureSize(colorTexture, 0)); float lx = dot(texture(colorTexture, v_textureCoordinates + vec2(px.x, 0.0)).rgb, vec3(0.333)); float ly = dot(texture(colorTexture, v_textureCoordinates + vec2(0.0, px.y)).rgb, vec3(0.333)); float edge = clamp((abs(lx - l) + abs(ly - l)) * 6.0, 0.0, 1.0);
 vec3 base = vec3(0.03, 0.10, 0.28) + l * vec3(0.08, 0.18, 0.35); out_FragColor = vec4(base + edge * vec3(0.55, 0.85, 1.0), 1.0); }`;
export function createSensors(scene) {
  const stages = {};
  const make = (name, fs) => { const st = new Cesium.PostProcessStage({ name, fragmentShader: fs, uniforms: { u_time: () => (performance.now() / 1000) % 1000 } }); st.enabled = false; scene.postProcessStages.add(st); stages[name] = st; };
  make('night', NIGHT); make('thermal', THERMAL); make('blueprint', BLUEPRINT);
  return { set(name) { for (const [k, st] of Object.entries(stages)) st.enabled = k === name; return name in stages ? name : 'normal'; }, names: ['normal', ...Object.keys(stages)] };
}
