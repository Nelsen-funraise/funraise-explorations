// Timeline store: 2012 → 2030. Layers read `year` through CallbackProperties.
export class Timeline {
  constructor(layers, { min = 2012, max = 2030 } = {}) { this.layers = layers; this.min = min; this.max = max; this.year = new Date().getFullYear(); this.listeners = new Set(); this.lapse = null; }
  set(y) { y = Math.max(this.min, Math.min(this.max, Math.round(y))); this.year = y; this.layers.year = y; for (const f of this.listeners) f(y); }
  onChange(f) { this.listeners.add(f); }
  startLapse({ from = 2012, to = 2030, stepMs = 650, onDone } = {}) { this.stopLapse(); this.set(from); this.lapse = setInterval(() => { if (this.year >= to) { this.stopLapse(); onDone && onDone(); return; } this.set(this.year + 1); }, stepMs); }
  stopLapse() { if (this.lapse) { clearInterval(this.lapse); this.lapse = null; } }
}
