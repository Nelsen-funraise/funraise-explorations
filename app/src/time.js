// Timeline store: 2012 → 2030. Layers read `year` through CallbackProperties.
export class Timeline {
  constructor(layers, { min = 2012, max = 2030 } = {}) { this.layers = layers; this.min = min; this.max = max; this.year = new Date().getFullYear(); this.listeners = new Set(); this.lapse = null; }
  set(y) { y = Math.max(this.min, Math.min(this.max, Math.round(y))); const prev = this.year; this.year = y; this.layers.year = y; if (prev !== y && this.layers.onYearChange) this.layers.onYearChange(prev, y); for (const f of this.listeners) f(y, prev); }
  onChange(f) { this.listeners.add(f); }
  /** Phase 10Q (§18.2 旁白節拍): `durationMs`, when given, overrides `stepMs` so the whole from→to sweep takes exactly
   * that long — stepMs = durationMs / (to − from) — so a scene can bind a value-time-lapse to its measured narration
   * length and have the year land on `to` right as the sentence ends. Plain `stepMs` still works standalone. */
  startLapse({ from = 2012, to = 2030, stepMs = 650, durationMs, onDone } = {}) {
    this.stopLapse(); const span = Math.max(1, Math.abs(to - from));
    if (durationMs != null) stepMs = Math.max(16, durationMs / span);
    this.set(from); this.lapse = setInterval(() => { if (this.year >= to) { this.stopLapse(); onDone && onDone(); return; } this.set(this.year + 1); }, stepMs);
  }
  stopLapse() { if (this.lapse) { clearInterval(this.lapse); this.lapse = null; } }
}
