// Phase 10Q 統一語音列 (docs/11-v2-cesium-app.md §18.2) — src/ui/voicebar.js. Owner complaint: 「場景demo跳出的對話框和
// AI 對話框互相干擾，要不整合要不想更好的呈現」. Replaces the old separate #cinebar (scene caption) and #caption (AI
// answer strip) with ONE bottom glass bar: left mode tag ("場景 2／5 · 投資人巡航" or "睿鏡 · Claude"), centre big
// subtitle (sentence-split narration, advanced via speech's onProgress), right step dots + ▶/⏸/⏹. AI answers route
// their first sentence through the SAME bar (say(text,{mode:'agent'})) — the full text stays in #transcript. While a
// scene plays, asking a question pauses it (a MutationObserver on #transcript, the only place a new question is
// observable without touching agent.js/claudeClient.js) and this bar offers「▶ 繼續場景」once the answer lands
// (ui.js's settle() calls showResume()); director.resume() continues. In body.presenting this becomes the lower-third
// (bigger type — see voicebar.css, which also carries what used to be presenter.css's caption rules).
import './voicebar.css';

const $s = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const splitSentences = text => { const s = String(text || '').replace(/\s+/g, ' ').trim(); if (!s) return [];
  const parts = s.split(/(?<=[。!?!?])\s*/).map(x => x.trim()).filter(Boolean); return parts.length ? parts : [s]; };

export function createVoicebar({ ui, director, scenes }) {
  const stage = document.getElementById('stage') || document.body;
  const bar = $s('div', 'panel hidden', `
    <div class="vb-tag"></div>
    <div class="vb-main"><div class="vb-sub"></div></div>
    <div class="vb-dots"></div>
    <div class="vb-ctl">
      <button type="button" class="vb-btn" data-a="toggle" aria-label="播放／暫停場景" title="播放／暫停場景">⏸</button>
      <button type="button" class="vb-btn" data-a="stop" aria-label="停止場景" title="停止場景">⏹</button>
    </div>`);
  bar.id = 'voicebar'; bar.setAttribute('role', 'status'); bar.setAttribute('aria-live', 'polite'); stage.appendChild(bar);
  const tagEl = bar.querySelector('.vb-tag'), subEl = bar.querySelector('.vb-sub'), dotsEl = bar.querySelector('.vb-dots'), ctlEl = bar.querySelector('.vb-ctl');
  const btnToggle = bar.querySelector('[data-a="toggle"]'), btnStop = bar.querySelector('[data-a="stop"]');

  let mode = 'idle'; // 'idle' | 'scene' | 'agent'
  let sentences = [], curIdx = -1, hideT = null, resumeShown = false;

  const shortTitle = title => (title && title.includes(' · ')) ? title.split(' · ').pop() : (title || '');
  const agentLabel = () => ui.claudeMode ? (ui.mcp && ui.mcp.provider === 'openai' ? 'OpenAI' : ui.mcp && ui.mcp.provider === 'anthropic' ? 'Claude' : 'AI') : '內建';

  function show() { bar.classList.remove('hidden'); }
  function clearAutoHide() { clearTimeout(hideT); hideT = null; }
  function armAutoHide(ms) { clearAutoHide(); hideT = setTimeout(() => { if (mode === 'agent') { mode = 'idle'; bar.classList.add('hidden'); } }, ms); }

  function setTag(t) { tagEl.textContent = t; }
  function setSubtitle(t) { subEl.textContent = t; subEl.classList.remove('resume'); }

  function renderDots(total, activeIdx) {
    dotsEl.innerHTML = ''; if (!total) { dotsEl.classList.add('hidden'); return; } dotsEl.classList.remove('hidden');
    for (let i = 0; i < total; i++) { const d = $s('span', 'vb-dot' + (i < activeIdx ? ' done' : i === activeIdx ? ' active' : '')); dotsEl.appendChild(d); }
  }

  function paintControls() {
    const playing = !!director.playing;
    ctlEl.classList.toggle('hidden', !playing);
    if (!playing) return;
    btnToggle.textContent = director.paused ? '▶' : '⏸'; btnToggle.title = director.paused ? '繼續場景' : '暫停場景';
  }
  btnToggle.onclick = () => { if (!director.playing) return; if (director.paused) director.resume(); else director.pause(); paintControls(); };
  btnStop.onclick = () => director.stop();

  /* ---- scene narration: full text sentence-split up front, advance() picks the sentence matching narration frac ---- */
  function sceneStep(title, text, meta = {}) {
    mode = 'scene'; clearAutoHide(); resumeShown = false;
    setTag(`場景 ${(meta.index ?? 0) + 1}／${meta.total ?? ((meta.index ?? 0) + 1)} · ${shortTitle(title)}`);
    sentences = splitSentences(text); curIdx = -1; setSubtitle(sentences[0] || '');
    renderDots(meta.total || 0, meta.index ?? 0); paintControls(); show();
  }
  function sceneEnd() { mode = 'idle'; resumeShown = false; clearAutoHide(); bar.classList.add('hidden'); dotsEl.classList.add('hidden'); ctlEl.classList.add('hidden'); }
  function advance(frac) {
    if (mode !== 'scene' || !sentences.length || resumeShown) { paintControls(); return; }
    const idx = Math.max(0, Math.min(sentences.length - 1, Math.floor((frac || 0) * sentences.length)));
    if (idx !== curIdx) { curIdx = idx; setSubtitle(sentences[idx]); }
    paintControls();
  }
  /** ui.js's settle() calls this right after an answer lands while the scene director is paused — offers the way back in. */
  function showResume() { if (!director.playing) return; resumeShown = true; mode = 'scene'; subEl.textContent = '▶ 繼續場景'; subEl.classList.add('resume'); paintControls(); show(); }
  subEl.onclick = () => { if (subEl.classList.contains('resume')) { director.resume(); resumeShown = false; } };

  /* ---- AI answers: first sentence only, full text stays in #transcript ---- */
  function say(text, opts = {}) {
    if (director.playing && !director.paused) return; // a scene owns the bar while actively narrating — don't stomp it mid-sentence
    mode = 'agent'; clearAutoHide(); resumeShown = false;
    setTag(`睿鏡 · ${opts.mode === 'agent' || !opts.mode ? agentLabel() : opts.mode}`);
    const sents = splitSentences(text); setSubtitle(sents[0] || text || '');
    dotsEl.classList.add('hidden'); ctlEl.classList.add('hidden'); show(); armAutoHide(9000);
  }

  setInterval(() => { if (mode === 'scene') paintControls(); }, 250);

  /* ---- a question mid-scene pauses it: watch #transcript for a new .turn.user (the only observable signal available
   * without touching ui.js's say()/userTurn() or agent.js/claudeClient.js's handle(), which this module doesn't own) ---- */
  const tr = document.getElementById('transcript');
  if (tr && 'MutationObserver' in window) {
    new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) { if (n.nodeType === 1 && n.classList && n.classList.contains('user') && director.playing && !director.paused) { director.pause(); paintControls(); } } }).observe(tr, { childList: true });
  }
  void scenes; // kept for interface parity / future step-jump features; not needed by the current one
  return { say, sceneStep, sceneEnd, advance, showResume, get mode() { return mode; }, el: bar };
}
