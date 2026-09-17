import { apiFetch } from './api.js';
// Speech output: Fish Audio voices (pre-rendered narration files → /api/tts → Web Speech fallback). speak() resolves when
// playback ENDS, so scene steps can wait for the narration instead of cutting it off.
// Phase 10Q (§18.2 旁白節拍): speak(text,{onProgress}) also reports frac∈[0,1] roughly every 100ms — from
// audio.currentTime/duration for real playback, from SpeechSynthesis `onboundary` (charIndex/text.length) for the Web
// Speech fallback, or from a timer at an estimated 4.5 chars/s when neither is available — and duration(text) preloads
// the audio (via source()) and resolves its length from `loadedmetadata` up front, without playing it, so a scene can
// size a camera flight or a value-time-lapse to the narration BEFORE it starts speaking. Both are pure estimates when
// no real audio exists (system voice, or TTS entirely unavailable) — callers that need a hard floor (e.g. a time-lapse
// step) should not trust `duration()` alone to be long; SceneDirector in scenes.js applies its own minimums.
// Live feedback fix (2026-09-17,「太長的語句或有特殊符號時語音會怪或斷掉」): speak()/duration() now run the text through
// speakable() first (strips markdown/來源 lines/emoji, maps symbols like →×▲▼①m² to spoken zh-TW) and split it into
// ≲90-char chunks at sentence punctuation (hard-wrapped at the nearest「，」if a sentence is still too long), played
// back-to-back through one queue with the next chunk's audio prefetched while the current one plays (no gap);
// onProgress is weighted by each chunk's share of the total (sanitized) character count so beats stay aligned.
export const FALLBACK_VOICES = [
  { id: 'nelsen', name: 'Nelsen', desc: '陳致瑋 · 沉穩敘事', gender: 'male' },
  { id: 'eunice', name: 'Eunice', desc: '溫暖親切的台灣女聲', gender: 'female' },
  { id: 'twf', name: '台灣腔女生', desc: '清晰專業的台灣女聲', gender: 'female' },
];
export const fnv1a = str => { let h = 0x811c9dc5; for (const c of new TextEncoder().encode(str)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const CHARS_PER_SEC = 4.5;
const CHUNK_MAX = 90;
const estimateMs = text => Math.max(600, Math.round(String(text || '').length / CHARS_PER_SEC * 1000));
const clamp01 = f => Math.max(0, Math.min(1, f));
const CIRCLED_CN = { '①': '一、', '②': '二、', '③': '三、', '④': '四、', '⑤': '五、', '⑥': '六、', '⑦': '七、', '⑧': '八、' };
// Broad-but-safe emoji/pictograph ranges: Misc Symbols & Pictographs, Emoticons, Transport, Supplemental Symbols,
// Dingbats, Misc Symbols, regional-indicator flags, variation selector, ZWJ — deliberately NOT the general Arrows or
// Geometric Shapes blocks (→ ▲ ▼ are handled explicitly above/below and must survive to be converted, not stripped).
const PICTOGRAPH_RE = /[\u{1F300}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;

/** Sanitizes narration text for TTS: drops markdown noise and any「來源：…」citation tail, maps symbols to spoken
 * zh-TW (units, arrows, separators, brackets→pauses), strips emoji, collapses whitespace. Exported for reuse/testing;
 * also exposed as `speech.speakable` on the instance below since callers (and the verification harness) run in the
 * browser and can't `import` a module export directly. */
export function speakable(text) {
  let s = String(text || '');
  s = s.replace(/來源[:：][\s\S]*$/, ''); // trailing citation line, same convention as ui.js's spokenSummary()
  s = s.replace(/```[\s\S]*?```/g, ' '); // fenced code blocks
  s = s.replace(/`+/g, ''); // inline code backticks
  s = s.replace(/^\s*#{1,6}\s*/gm, ''); // markdown headings
  s = s.replace(/^[ \t]*[-*•‣◦]\s+/gm, ''); // markdown bullet markers (line-leading only — mid-text · is a separator, handled below)
  s = s.replace(/\*\*?/g, ''); // bold/italic asterisks
  s = s.replace(/元\/坪/g, '元每坪'); // unit-specific, before the generic slash rule below
  s = s.replace(/k[mM][²2]/g, '平方公里'); // before m² (which is a substring of km²)
  s = s.replace(/㎡|[mM][²2]/g, '平方公尺');
  s = s.replace(/[①②③④⑤⑥⑦⑧]/g, c => CIRCLED_CN[c] || c);
  s = s.replace(/→/g, '到').replace(/×/g, '乘').replace(/▲/g, '上升').replace(/▼/g, '下降');
  s = s.replace(/[｜|·‧]/g, '，');
  s = s.replace(/[+＋]/g, '加').replace(/~/g, '到');
  s = s.replace(/\//g, '或'); // any slash left after the 元/坪 special-case above
  s = s.replace(/[（）()[\]【】]/g, '，');
  s = s.replace(PICTOGRAPH_RE, '');
  s = s.replace(/[ \t]+/g, ' ').replace(/\s*\n+\s*/g, ' ').trim();
  s = s.replace(/，{2,}/g, '，').replace(/^，+/, '').replace(/，+$/, '');
  return s.trim();
}
/** Splits already-sanitized text into TTS-friendly chunks: at 。！？； first, then hard-wraps any piece still over
 * ~90 chars at the nearest「，」at-or-before the limit (a plain cut at 90 if there's no comma to break at). */
export function splitChunks(text) {
  const sentences = String(text || '').split(/(?<=[。!?;])/).map(s => s.trim()).filter(Boolean);
  const chunks = [];
  for (const seg of sentences.length ? sentences : [text]) {
    let rest = seg;
    while (rest.length > CHUNK_MAX) {
      let cut = rest.lastIndexOf('，', CHUNK_MAX);
      if (cut <= 0) cut = CHUNK_MAX; else cut += 1; // keep the comma with the piece before it
      chunks.push(rest.slice(0, cut).trim()); rest = rest.slice(cut);
    }
    if (rest.trim()) chunks.push(rest.trim());
  }
  return chunks.filter(Boolean);
}

export function createSpeech({ api = '' } = {}) {
  const st = { voice: 'nelsen', voices: FALLBACK_VOICES, fishLive: false, manifest: null, audio: null, utter: null, warm: new Map(), ready: false, testHook: null, onStop: null, activeQueue: null };
  try { st.voice = localStorage.getItem('pl.voice') || st.voice; } catch { /* private mode */ }
  const sp = {
    get voice() { return st.voice; }, get fishLive() { return st.fishLive; }, speakable, splitChunks,
    setVoice(id) { st.voice = id; try { localStorage.setItem('pl.voice', id); } catch { /* private mode */ } },
    voices() { return [{ id: 'system', name: '系統語音', desc: '瀏覽器內建（zh-TW）', gender: 'n/a', available: 'speechSynthesis' in window }, ...st.voices.map(v => ({ ...v, available: st.fishLive || !!(st.manifest && st.manifest.voices && st.manifest.voices[v.id] && st.manifest.voices[v.id].length), prerendered: !!(st.manifest && st.manifest.voices && st.manifest.voices[v.id] && st.manifest.voices[v.id].length) }))]; },
    async init() {
      try { const r = await fetch('./audio/manifest.json', { cache: 'no-cache' }); if (r.ok) st.manifest = await r.json(); } catch { /* no prerendered audio */ }
      try { const r = await apiFetch('/api/voices'); if (r.ok) { const j = await r.json(); st.fishLive = !!j.fish; if (j.voices && j.voices.length) st.voices = j.voices; } } catch { /* no server */ }
      st.ready = true; return sp.voices();
    },
    // URL for a (chunk of) text in the current voice: pre-rendered file, else server TTS (cached as blob per chunk
    // hash — every chunk is its own /api/tts call and its own cache entry), else null.
    async source(text) {
      const v = st.voice; if (v === 'system') return null; const key = fnv1a(text);
      if (st.manifest && st.manifest.voices && st.manifest.voices[v] && st.manifest.voices[v].includes(key)) return `./audio/${v}/${key}.mp3`;
      if (!st.fishLive) return null; const ck = v + '|' + key; if (st.warm.has(ck)) return st.warm.get(ck);
      const p = apiFetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: v }) }).then(async r => { if (!r.ok) throw new Error('tts ' + r.status); return URL.createObjectURL(await r.blob()); });
      st.warm.set(ck, p); p.catch(() => st.warm.delete(ck)); return p;
    },
    warm(texts) { for (const t of texts || []) for (const c of splitChunks(speakable(t))) sp.source(c).catch(() => {}); },
    // Verification hook (never called by the app itself): fn(text) => ms|null|Promise<ms|null>. When TTS is entirely
    // unavailable (headless/CI, no speechSynthesis voices), this lets a test make duration()/speak() deterministic
    // without needing a real voice — e.g. window.PL.speech.setTestHook(t => t.length * 90).
    setTestHook(fn) { st.testHook = fn || null; },
    stop() {
      st.activeQueue = null; // invalidates any in-flight playQueue loop — it won't start another chunk after this
      if (st.audio) { try { st.audio.pause(); } catch { /* ignore */ } st.audio.onended = null; st.audio = null; }
      if ('speechSynthesis' in window) try { speechSynthesis.cancel(); } catch { /* ignore */ }
      if (st.onStop) { const f = st.onStop; st.onStop = null; f(); } // unblocks whatever chunk is currently awaited — it would otherwise hang forever
    },
    // Preloads the audio for `text` (sanitized + chunked, same as speak()) and resolves the TOTAL length in ms
    // WITHOUT playing it (no autoplay-policy risk): all chunks are probed in parallel, bounded by a timeout; any
    // failure/timeout on ANY chunk falls back to a single char-count estimate over the whole sanitized text.
    async duration(text) {
      const clean = speakable(text).slice(0, 2000); if (!clean) return 0;
      if (st.testHook) { try { const ms = await st.testHook(clean); if (ms != null) return ms; } catch { /* fall through */ } }
      const chunks = splitChunks(clean);
      try {
        const urls = await Promise.all(chunks.map(c => sp.source(c).catch(() => null)));
        if (urls.length && urls.every(u => u)) {
          const per = await Promise.all(urls.map(u => new Promise((resolve, reject) => {
            const a = new Audio(); const to = setTimeout(() => reject(new Error('timeout')), 4000);
            a.addEventListener('loadedmetadata', () => { clearTimeout(to); resolve(a.duration * 1000); }, { once: true });
            a.onerror = () => { clearTimeout(to); reject(new Error('audio error')); }; a.src = u;
          })));
          const total = per.reduce((s, m) => s + (isFinite(m) ? m : 0), 0);
          if (total > 0) return total;
        }
      } catch { /* fall through to estimate */ }
      return estimateMs(clean);
    },
    // resolves when every chunk has finished playing (or immediately when nothing could be played); onProgress(frac)
    // fires ~every 100ms while it plays, weighted by each chunk's share of the total sanitized character count
    // (frac∈[0,1], always ends with a final 1) so callers can drive subtitles/beats without polling audio themselves.
    async speak(text, { onProgress } = {}) {
      sp.stop();
      const clean = speakable(text).slice(0, 2000); if (!clean) { onProgress && onProgress(1); return { ms: 0, source: 'none' }; }
      if (st.testHook) { const ms = await Promise.resolve(st.testHook(clean)).catch(() => null); if (ms != null) return sp._fakePlay(ms, onProgress); }
      return sp.playQueue(splitChunks(clean), onProgress);
    },
    /** Plays chunks strictly in order, one utterance/audio at a time, prefetching chunk i+1's audio (`sp.source`)
     * while chunk i plays so there's no gap between them. A cancel token (compared against st.activeQueue, which
     * stop() nulls out) is checked between chunks so stop() halts the WHOLE queue, not just the current chunk. */
    async playQueue(chunks, onProgress) {
      if (!chunks.length) { onProgress && onProgress(1); return { ms: 0, source: 'none' }; }
      const token = {}; st.activeQueue = token;
      const totalLen = chunks.reduce((s, c) => s + c.length, 0) || 1;
      const urls = new Array(chunks.length).fill(null);
      const prefetch = i => { if (i < chunks.length && !urls[i]) urls[i] = sp.source(chunks[i]).catch(() => null); };
      prefetch(0);
      let consumed = 0, totalMs = 0, source = 'none', stopped = false;
      for (let i = 0; i < chunks.length; i++) {
        if (st.activeQueue !== token) { stopped = true; break; }
        prefetch(i + 1); // start fetching the NEXT chunk's audio while this one is about to play
        const url = await urls[i];
        if (st.activeQueue !== token) { stopped = true; break; }
        const base = consumed / totalLen, span = chunks[i].length / totalLen;
        const relay = f => onProgress && onProgress(clamp01(base + (f || 0) * span));
        const res = url ? await sp.playAudio(url, relay) : await sp.speakSystem(chunks[i], relay);
        totalMs += res.ms || 0; source = res.source; consumed += chunks[i].length;
        if (res.source === 'stopped') { stopped = true; break; }
      }
      if (st.activeQueue === token) st.activeQueue = null;
      onProgress && onProgress(1);
      return { ms: totalMs, source: stopped ? 'stopped' : source };
    },
    _fakePlay(ms, onProgress) {
      return new Promise(resolve => {
        const t0 = performance.now();
        const finish = () => { clearInterval(timer); st.onStop = null; onProgress && onProgress(1); resolve({ ms: performance.now() - t0, source: 'test' }); };
        st.onStop = finish;
        const timer = setInterval(() => { const f = clamp01((performance.now() - t0) / Math.max(1, ms)); onProgress && onProgress(f); if (f >= 1) finish(); }, 100);
      });
    },
    // plays one already-sanitized chunk's audio URL; unchanged single-utterance mechanics, now called per-chunk by playQueue.
    playAudio(url, onProgress) {
      return new Promise(resolve => {
        const a = new Audio(url); st.audio = a; const t0 = performance.now(); let timer = null;
        const finish = src => { clearInterval(timer); if (st.audio === a) st.audio = null; st.onStop = null; onProgress && onProgress(1); resolve({ ms: performance.now() - t0, source: src }); };
        st.onStop = () => finish('stopped');
        a.addEventListener('loadedmetadata', () => { if (!timer && isFinite(a.duration) && a.duration > 0) timer = setInterval(() => onProgress && onProgress(clamp01(a.currentTime / a.duration)), 100); }, { once: true });
        a.onended = () => finish('fish'); a.onerror = () => finish('error');
        a.play().catch(() => finish('blocked')); // autoplay policy (no user gesture) — loadedmetadata/timer above still runs, this only affects actual sound
      });
    },
    speakSystem(text, onProgress) {
      return new Promise(resolve => {
        try {
          if (!('speechSynthesis' in window)) { onProgress && onProgress(1); return resolve({ ms: 0, source: 'none' }); }
          const u = new SpeechSynthesisUtterance(text.slice(0, 220)); u.lang = 'zh-TW'; u.rate = 1.02;
          const v = speechSynthesis.getVoices().find(v => /zh[-_]TW/i.test(v.lang)) || speechSynthesis.getVoices().find(v => /^zh/i.test(v.lang)); if (v) u.voice = v;
          const t0 = performance.now(); const len = Math.max(1, u.text.length); let gotBoundary = false, timer = null;
          const finish = src => { clearInterval(timer); st.onStop = null; onProgress && onProgress(1); resolve({ ms: performance.now() - t0, source: src }); };
          st.onStop = () => { try { speechSynthesis.cancel(); } catch { /* ignore */ } finish('stopped'); };
          u.onboundary = e => { gotBoundary = true; if (e.charIndex != null) onProgress && onProgress(clamp01(e.charIndex / len)); };
          u.onstart = () => { const est = estimateMs(u.text), t1 = performance.now(); timer = setInterval(() => { if (gotBoundary) { clearInterval(timer); return; } onProgress && onProgress(Math.min(0.98, (performance.now() - t1) / est)); }, 100); };
          u.onend = () => finish('system'); u.onerror = () => finish('error');
          st.utter = u; speechSynthesis.speak(u);
        } catch { onProgress && onProgress(1); resolve({ ms: 0, source: 'error' }); }
      });
    },
  };
  return sp;
}
