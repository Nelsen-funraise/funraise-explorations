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
export const FALLBACK_VOICES = [
  { id: 'nelsen', name: 'Nelsen', desc: '陳致瑋 · 沉穩敘事', gender: 'male' },
  { id: 'eunice', name: 'Eunice', desc: '溫暖親切的台灣女聲', gender: 'female' },
  { id: 'twf', name: '台灣腔女生', desc: '清晰專業的台灣女聲', gender: 'female' },
];
export const fnv1a = str => { let h = 0x811c9dc5; for (const c of new TextEncoder().encode(str)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const CHARS_PER_SEC = 4.5;
const estimateMs = text => Math.max(600, Math.round(String(text || '').length / CHARS_PER_SEC * 1000));
const clamp01 = f => Math.max(0, Math.min(1, f));

export function createSpeech({ api = '' } = {}) {
  const st = { voice: 'nelsen', voices: FALLBACK_VOICES, fishLive: false, manifest: null, audio: null, utter: null, warm: new Map(), ready: false, testHook: null, onStop: null };
  try { st.voice = localStorage.getItem('pl.voice') || st.voice; } catch { /* private mode */ }
  const sp = {
    get voice() { return st.voice; }, get fishLive() { return st.fishLive; },
    setVoice(id) { st.voice = id; try { localStorage.setItem('pl.voice', id); } catch { /* private mode */ } },
    voices() { return [{ id: 'system', name: '系統語音', desc: '瀏覽器內建（zh-TW）', gender: 'n/a', available: 'speechSynthesis' in window }, ...st.voices.map(v => ({ ...v, available: st.fishLive || !!(st.manifest && st.manifest.voices && st.manifest.voices[v.id] && st.manifest.voices[v.id].length), prerendered: !!(st.manifest && st.manifest.voices && st.manifest.voices[v.id] && st.manifest.voices[v.id].length) }))]; },
    async init() {
      try { const r = await fetch('./audio/manifest.json', { cache: 'no-cache' }); if (r.ok) st.manifest = await r.json(); } catch { /* no prerendered audio */ }
      try { const r = await apiFetch('/api/voices'); if (r.ok) { const j = await r.json(); st.fishLive = !!j.fish; if (j.voices && j.voices.length) st.voices = j.voices; } } catch { /* no server */ }
      st.ready = true; return sp.voices();
    },
    // URL for a text in the current voice: pre-rendered file, else server TTS (cached as blob), else null
    async source(text) {
      const v = st.voice; if (v === 'system') return null; const key = fnv1a(text);
      if (st.manifest && st.manifest.voices && st.manifest.voices[v] && st.manifest.voices[v].includes(key)) return `./audio/${v}/${key}.mp3`;
      if (!st.fishLive) return null; const ck = v + '|' + key; if (st.warm.has(ck)) return st.warm.get(ck);
      const p = apiFetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: v }) }).then(async r => { if (!r.ok) throw new Error('tts ' + r.status); return URL.createObjectURL(await r.blob()); });
      st.warm.set(ck, p); p.catch(() => st.warm.delete(ck)); return p;
    },
    warm(texts) { for (const t of texts || []) sp.source(t).catch(() => {}); },
    // Verification hook (never called by the app itself): fn(text) => ms|null|Promise<ms|null>. When TTS is entirely
    // unavailable (headless/CI, no speechSynthesis voices), this lets a test make duration()/speak() deterministic
    // without needing a real voice — e.g. window.PL.speech.setTestHook(t => t.length * 90).
    setTestHook(fn) { st.testHook = fn || null; },
    stop() {
      if (st.audio) { try { st.audio.pause(); } catch { /* ignore */ } st.audio.onended = null; st.audio = null; }
      if ('speechSynthesis' in window) try { speechSynthesis.cancel(); } catch { /* ignore */ }
      if (st.onStop) { const f = st.onStop; st.onStop = null; f(); } // unblocks any pending speak() — it would otherwise hang forever (onended never fires after a manual pause/cancel)
    },
    // Preloads the audio for `text` (if any) and resolves its length in ms WITHOUT playing it (no autoplay-policy
    // risk); falls back to a char-count estimate when there's no audio source, or its metadata never loads. Never rejects.
    async duration(text) {
      text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400); if (!text) return 0;
      if (st.testHook) { try { const ms = await st.testHook(text); if (ms != null) return ms; } catch { /* fall through */ } }
      let url = null; try { url = await sp.source(text); } catch { url = null; }
      if (url) {
        try {
          const ms = await new Promise((resolve, reject) => {
            const a = new Audio(); const to = setTimeout(() => reject(new Error('timeout')), 4000);
            a.addEventListener('loadedmetadata', () => { clearTimeout(to); resolve(a.duration * 1000); }, { once: true });
            a.onerror = () => { clearTimeout(to); reject(new Error('audio error')); }; a.src = url;
          });
          if (isFinite(ms) && ms > 0) return ms;
        } catch { /* fall through to estimate */ }
      }
      return estimateMs(text);
    },
    // resolves when the utterance finished playing (or immediately when nothing could be played); onProgress(frac)
    // fires ~every 100ms while it plays (frac∈[0,1], always ends with a final 1) so callers can drive subtitles/beats
    // without polling audio themselves.
    async speak(text, { onProgress } = {}) {
      sp.stop(); text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400); if (!text) { onProgress && onProgress(1); return { ms: 0, source: 'none' }; }
      if (st.testHook) { const ms = await Promise.resolve(st.testHook(text)).catch(() => null); if (ms != null) return sp._fakePlay(ms, onProgress); }
      let url = null; try { url = await sp.source(text); } catch { url = null; }
      if (url) return sp.playAudio(url, onProgress);
      return sp.speakSystem(text, onProgress);
    },
    _fakePlay(ms, onProgress) {
      return new Promise(resolve => {
        const t0 = performance.now();
        const finish = () => { clearInterval(timer); st.onStop = null; onProgress && onProgress(1); resolve({ ms: performance.now() - t0, source: 'test' }); };
        st.onStop = finish;
        const timer = setInterval(() => { const f = clamp01((performance.now() - t0) / Math.max(1, ms)); onProgress && onProgress(f); if (f >= 1) finish(); }, 100);
      });
    },
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
