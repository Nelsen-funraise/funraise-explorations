// presenter.js — 展示模式 Presenter Mode: a clean, projector-friendly view for live demos.
// Hides authoring/HUD chrome, enlarges the caption/cinebar into a lower-third, shows a small
// "場景 n／N" progress readout, auto-hides the cursor when idle, and drives scenes with
// ArrowRight/Left, PageUp/Down, Space and Escape. Self-contained: pulls in its own stylesheet.
import './presenter.css';

const IDLE_MS = 2500;
const escapeHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shortTitle = sc => (sc && sc.title ? sc.title.split(' · ').pop() : '');

export function createPresenter({ ui, director, scenes, viewer }) { // `viewer` kept for interface parity (not needed by the current feature set)
  const body = document.body;
  let active = false, prevDensity = null, currentIndex = 0, idleTimer = null, origPlay = null, progressEl = null;

  const indexOf = id => { const i = scenes.findIndex(s => s.id === id); return i < 0 ? 0 : i; };

  function ensureProgress() {
    if (!progressEl) { progressEl = document.createElement('div'); progressEl.id = 'presenter-progress'; (document.getElementById('stage') || document.body).appendChild(progressEl); }
    return progressEl;
  }
  function updateProgress() {
    if (!active) return; const n = ensureProgress(); const sc = scenes[currentIndex];
    n.innerHTML = sc ? `<span class="n">場景 ${currentIndex + 1}／${scenes.length}</span> · ${escapeHtml(shortTitle(sc))}` : '';
  }
  function removeProgress() { if (progressEl) { progressEl.remove(); progressEl = null; } }

  // SceneDirector doesn't emit a "scene started" event, so wrap .play() to catch every caller
  // (presenter's own next/prev, the existing scene menu, the "play all" loop, …) — restored on exit().
  function wrapDirector() { if (origPlay) return; origPlay = director.play.bind(director); director.play = id => { currentIndex = indexOf(id); updateProgress(); return origPlay(id); }; }
  function unwrapDirector() { if (!origPlay) return; director.play = origPlay; origPlay = null; }

  function armIdle() { body.classList.remove('cursor-idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => body.classList.add('cursor-idle'), IDLE_MS); }
  function onPointerMove() { armIdle(); }

  function play(i) { currentIndex = (i + scenes.length) % scenes.length; updateProgress(); director.play(scenes[currentIndex].id); }
  function next() { play(director.playing ? indexOf(director.playing) + 1 : 0); }
  function prev() { play(director.playing ? indexOf(director.playing) - 1 : 0); }

  function onKeydown(e) {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); e.stopPropagation(); next(); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); e.stopPropagation(); prev(); }
    else if (k === ' ' || k === 'Spacebar') { e.preventDefault(); e.stopPropagation(); if (director.playing) director.stop(); else next(); }
    else if (k === 'Escape' || k === 'Esc') { e.preventDefault(); e.stopPropagation(); exit(); }
  }

  function enter() {
    if (active) return; active = true;
    prevDensity = ui.density;
    body.classList.add('presenting');
    ui.setDensity('immersive', true);
    wrapDirector();
    currentIndex = director.playing ? indexOf(director.playing) : 0;
    updateProgress();
    armIdle();
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('keydown', onKeydown, true); // capture phase: intercept before ui.js's own bubble-phase handler
    ui.toast('展示模式：←→ 切換場景，空白鍵 播放/停止，Esc 離開');
  }
  function exit() {
    if (!active) return; active = false;
    if (director.playing) director.stop();
    body.classList.remove('presenting', 'cursor-idle');
    clearTimeout(idleTimer);
    document.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('keydown', onKeydown, true);
    if (prevDensity) ui.setDensity(prevDensity, true);
    unwrapDirector(); removeProgress();
  }
  function toggle() { active ? exit() : enter(); }

  return { enter, exit, toggle, next, prev, get active() { return active; } };
}
