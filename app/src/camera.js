// Camera verbs (GEV-style): flyTo / orbit / street / city / globe / follow
import * as Cesium from 'cesium';
const D2R = Math.PI / 180;
export class CameraRig {
  constructor(viewer) { this.viewer = viewer; this.camera = viewer.camera; this.orbit = null; this.mode = 'city'; this._tick = this._tick.bind(this); viewer.clock.onTick.addEventListener(this._tick); }
  get lonlat() { const c = this.camera.positionCartographic; return [c.longitude / D2R, c.latitude / D2R, c.height]; }
  get heading() { return this.camera.heading / D2R; }
  get pitch() { return this.camera.pitch / D2R; }
  // look at a target (lon,lat) from a given range/pitch/heading
  flyTo(lon, lat, { range = 1200, pitch = -45, heading = null, duration = 2.2, alt = 0, done } = {}) {
    this.stopOrbit();
    const target = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
    const h = heading == null ? this.camera.heading : heading * D2R;
    this.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), { offset: new Cesium.HeadingPitchRange(h, pitch * D2R, range), duration, complete: done, easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT });
  }
  city(lon, lat, done) { this.mode = 'city'; this.flyTo(lon, lat, { range: 9000, pitch: -62, heading: 0, duration: 2.4, done }); }
  overview(done) { this.mode = 'city'; this.flyTo(121.548, 25.047, { range: 26000, pitch: -68, heading: 15, duration: 2.6, done }); }
  street(lon, lat, done) { this.mode = 'street'; this.flyTo(lon, lat, { range: 420, pitch: -14, duration: 2.6, alt: 20, done }); }
  globe(done) { this.mode = 'globe'; this.stopOrbit(); this.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(120.9, 23.6, 900000), orientation: { heading: 0, pitch: -88 * D2R, roll: 0 }, duration: 3, complete: done }); }
  startOrbit(lon, lat, { range = 1400, pitch = -35, speed = 0.09, alt = 0 } = {}) {
    this.stopOrbit(); this.mode = 'orbit';
    const target = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
    this.flyTo(lon, lat, { range, pitch, duration: 1.8, alt, done: () => { this.orbit = { target, range, pitch: pitch * D2R, heading: this.camera.heading, speed: speed * D2R }; } });
  }
  stopOrbit() { if (this.orbit) { this.orbit = null; this.camera.lookAtTransform(Cesium.Matrix4.IDENTITY); } }
  _tick() { const o = this.orbit; if (!o) return; o.heading += o.speed; this.camera.lookAt(o.target, new Cesium.HeadingPitchRange(o.heading, o.pitch, o.range)); }
  // camera interaction cancels orbit
  bindUserInterrupt(canvas) { const stop = () => this.orbit && this.stopOrbit(); canvas.addEventListener('pointerdown', stop); canvas.addEventListener('wheel', stop, { passive: true }); }
  bounds() { // approximate lon/lat bounds of the current view via corner picks
    const c = this.viewer.canvas; const pts = [[0, 0], [c.clientWidth, 0], [0, c.clientHeight], [c.clientWidth, c.clientHeight], [c.clientWidth / 2, c.clientHeight / 2]]; const ll = [];
    for (const [x, y] of pts) { const win = new Cesium.Cartesian2(x, y); const ray = this.camera.getPickRay(win); let p = ray && this.viewer.scene.globe.pick(ray, this.viewer.scene); if (!p) p = this.camera.pickEllipsoid(win, this.viewer.scene.globe.ellipsoid); if (p) { const g = Cesium.Cartographic.fromCartesian(p); ll.push([g.longitude / D2R, g.latitude / D2R]); } }
    if (ll.length < 2) { const [lon, lat, h] = this.lonlat; const d = Math.max(0.01, h / 111000); return [lon - d, lat - d, lon + d, lat + d]; }
    const lons = ll.map(p => p[0]), lats = ll.map(p => p[1]); return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  }
}
