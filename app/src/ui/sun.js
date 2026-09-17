// 日照 control: sub-panel under the Look control's 日照／黃金 segments (presets, time slider, "play a day") — the old
// standalone "☀ 日照" pill is gone (see ui.js's Look control, compose.js §16.2). Exposes ui.setSun / ui.sweepSun /
// ui.sunHour (unchanged contract: compose.js wraps ui.setSun on top of this) plus ui.openSunMenu / closeSunMenu /
// toggleSunMenu, which the Look control's 日照／黃金 buttons and compose.setLook() call to show/hide this panel.
import { SUN_PRESETS, fmtHour } from '../fx/lighting.js';
export function createSunControl({ ui, lighting, stage, onChange }) {
  const menu = document.createElement('div'); menu.id = 'sunmenu'; menu.className = 'panel hidden'; stage.appendChild(menu);
  menu.innerHTML = `<div class="eyebrow">日照 · Sun &amp; Shadow</div>
    <div class="chips" id="sun-presets">${Object.entries(SUN_PRESETS).map(([k, p]) => `<button class="chip" data-p="${k}">${p.name} ${p.time}</button>`).join('')}<button class="chip" data-p="off">關閉</button></div>
    <label class="sunrow"><input id="sun-hour" type="range" min="5.5" max="19.5" step="0.25" value="17"><span id="sun-lbl" class="mono">—</span></label>
    <div class="sunrow"><button id="sun-play" class="chip brand">▶ 播放一天的陰影</button><span class="hint">量體陰影會投在鄰地上，可搭配都更模擬看日照影響</span></div>`;
  const lbl = menu.querySelector('#sun-lbl'), range = menu.querySelector('#sun-hour'), play = menu.querySelector('#sun-play');
  const paint = () => { const h = lighting.hour; const alt = h != null ? lighting.sunAltitude() : null; lbl.textContent = h == null ? '關閉（平光）' : `${fmtHour(h)} · 太陽高度 ${alt == null ? '—' : alt + '°'}`; if (h != null) range.value = h; menu.querySelectorAll('[data-p]').forEach(b => { const p = SUN_PRESETS[b.dataset.p]; b.setAttribute('aria-pressed', b.dataset.p === 'off' ? h == null : !!(p && h != null && Math.abs(p.hour - h) < 0.13)); }); };
  ui.setSun = (h, quiet) => { lighting.set(h); paint(); onChange && onChange(); if (!quiet) ui.toast(h == null ? '日照關閉：回到平光' : `日照 ${fmtHour(lighting.hour)}：陰影開啟`); return lighting.hour; };
  ui.sweepSun = () => { if (lighting.sweeping) { lighting.set(lighting.hour); paint(); return; } ui.toast('播放一天：06:30 → 18:15'); lighting.sweep({ onTick: paint, onDone: () => { paint(); onChange && onChange(); } }); };
  Object.defineProperty(ui, 'sunHour', { get: () => lighting.hour });
  ui.openSunMenu = () => { ui.closeLookMenu && ui.closeLookMenu(); menu.classList.remove('hidden'); paint(); };
  ui.closeSunMenu = () => menu.classList.add('hidden');
  ui.toggleSunMenu = () => { if (menu.classList.contains('hidden')) ui.openSunMenu(); else ui.closeSunMenu(); };
  menu.querySelectorAll('[data-p]').forEach(b => { b.onclick = () => ui.setSun(b.dataset.p === 'off' ? null : SUN_PRESETS[b.dataset.p].hour); });
  range.oninput = () => { lighting.set(+range.value); paint(); }; range.onchange = () => { onChange && onChange(); };
  play.onclick = () => ui.sweepSun();
  document.addEventListener('pointerdown', e => { if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !e.target.closest('#look')) menu.classList.add('hidden'); });
  paint();
}
