// 日照 control: header pill + popover (presets, time slider, "play a day"). Exposes ui.setSun / ui.sweepSun / ui.sunHour.
import { SUN_PRESETS, fmtHour } from '../fx/lighting.js';
export function createSunControl({ ui, lighting, stage, onChange }) {
  const btn = document.getElementById('sun'); if (!btn) return;
  const menu = document.createElement('div'); menu.id = 'sunmenu'; menu.className = 'panel hidden'; stage.appendChild(menu);
  menu.innerHTML = `<div class="eyebrow">日照 · Sun &amp; Shadow</div>
    <div class="chips" id="sun-presets">${Object.entries(SUN_PRESETS).map(([k, p]) => `<button class="chip" data-p="${k}">${p.name} ${p.time}</button>`).join('')}<button class="chip" data-p="off">關閉</button></div>
    <label class="sunrow"><input id="sun-hour" type="range" min="5.5" max="19.5" step="0.25" value="17"><span id="sun-lbl" class="mono">—</span></label>
    <div class="sunrow"><button id="sun-play" class="chip brand">▶ 播放一天的陰影</button><span class="hint">量體陰影會投在鄰地上，可搭配都更模擬看日照影響</span></div>`;
  const lbl = menu.querySelector('#sun-lbl'), range = menu.querySelector('#sun-hour'), play = menu.querySelector('#sun-play');
  const paint = () => { const h = lighting.hour; const alt = h != null ? lighting.sunAltitude() : null; lbl.textContent = h == null ? '關閉（平光）' : `${fmtHour(h)} · 太陽高度 ${alt == null ? '—' : alt + '°'}`; btn.textContent = h == null ? '☀ 日照' : `☀ ${fmtHour(h)}`; btn.setAttribute('aria-pressed', h != null); if (h != null) range.value = h; menu.querySelectorAll('[data-p]').forEach(b => { const p = SUN_PRESETS[b.dataset.p]; b.setAttribute('aria-pressed', b.dataset.p === 'off' ? h == null : !!(p && h != null && Math.abs(p.hour - h) < 0.13)); }); };
  ui.setSun = (h, quiet) => { lighting.set(h); paint(); onChange && onChange(); if (!quiet) ui.toast(h == null ? '日照關閉：回到平光' : `日照 ${fmtHour(lighting.hour)}：陰影開啟`); return lighting.hour; };
  ui.sweepSun = () => { if (lighting.sweeping) { lighting.set(lighting.hour); paint(); return; } ui.toast('播放一天：06:30 → 18:15'); lighting.sweep({ onTick: paint, onDone: () => { paint(); onChange && onChange(); } }); };
  Object.defineProperty(ui, 'sunHour', { get: () => lighting.hour });
  menu.querySelectorAll('[data-p]').forEach(b => { b.onclick = () => ui.setSun(b.dataset.p === 'off' ? null : SUN_PRESETS[b.dataset.p].hour); });
  range.oninput = () => { lighting.set(+range.value); paint(); }; range.onchange = () => { onChange && onChange(); };
  play.onclick = () => ui.sweepSun();
  btn.onclick = () => { menu.classList.toggle('hidden'); paint(); };
  document.addEventListener('pointerdown', e => { if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== btn) menu.classList.add('hidden'); });
  paint();
}
