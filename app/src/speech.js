// Speech output: Fish Audio voices (pre-rendered narration files → /api/tts → Web Speech fallback). speak() resolves when playback ENDS,
// so scene steps can wait for the narration instead of cutting it off.
export const FALLBACK_VOICES = [
  { id: 'nelsen', name: 'Nelsen', desc: '陳致瑋 · 沉穩敘事', gender: 'male' },
  { id: 'eunice', name: 'Eunice', desc: '溫暖親切的台灣女聲', gender: 'female' },
  { id: 'twf', name: '台灣腔女生', desc: '清晰專業的台灣女聲', gender: 'female' },
];
export const fnv1a = str => { let h = 0x811c9dc5; for (const c of new TextEncoder().encode(str)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

export function createSpeech({ api = '' } = {}) {
  const st = { voice: 'nelsen', voices: FALLBACK_VOICES, fishLive: false, manifest: null, audio: null, utter: null, warm: new Map(), ready: false };
  try { st.voice = localStorage.getItem('pl.voice') || st.voice; } catch { /* private mode */ }
  const sp = {
    get voice() { return st.voice; }, get fishLive() { return st.fishLive; },
    setVoice(id) { st.voice = id; try { localStorage.setItem('pl.voice', id); } catch { /* private mode */ } },
    voices() { return [{ id: 'system', name: '系統語音', desc: '瀏覽器內建（zh-TW）', gender: 'n/a', available: 'speechSynthesis' in window }, ...st.voices.map(v => ({ ...v, available: st.fishLive || !!(st.manifest && st.manifest.voices && st.manifest.voices[v.id] && st.manifest.voices[v.id].length), prerendered: !!(st.manifest && st.manifest.voices && st.manifest.voices[v.id] && st.manifest.voices[v.id].length) }))]; },
    async init() {
      try { const r = await fetch('./audio/manifest.json', { cache: 'no-cache' }); if (r.ok) st.manifest = await r.json(); } catch { /* no prerendered audio */ }
      try { const r = await fetch(api + '/api/voices'); if (r.ok) { const j = await r.json(); st.fishLive = !!j.fish; if (j.voices && j.voices.length) st.voices = j.voices; } } catch { /* no server */ }
      st.ready = true; return sp.voices();
    },
    // URL for a text in the current voice: pre-rendered file, else server TTS (cached as blob), else null
    async source(text) {
      const v = st.voice; if (v === 'system') return null; const key = fnv1a(text);
      if (st.manifest && st.manifest.voices && st.manifest.voices[v] && st.manifest.voices[v].includes(key)) return `./audio/${v}/${key}.mp3`;
      if (!st.fishLive) return null; const ck = v + '|' + key; if (st.warm.has(ck)) return st.warm.get(ck);
      const p = fetch(api + '/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: v }) }).then(async r => { if (!r.ok) throw new Error('tts ' + r.status); return URL.createObjectURL(await r.blob()); });
      st.warm.set(ck, p); p.catch(() => st.warm.delete(ck)); return p;
    },
    warm(texts) { for (const t of texts || []) sp.source(t).catch(() => {}); },
    stop() { if (st.audio) { try { st.audio.pause(); } catch { /* ignore */ } st.audio.onended = null; st.audio = null; } if ('speechSynthesis' in window) speechSynthesis.cancel(); },
    // resolves when the utterance finished playing (or immediately when nothing could be played)
    async speak(text) {
      sp.stop(); text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400); if (!text) return { ms: 0, source: 'none' };
      let url = null; try { url = await sp.source(text); } catch { url = null; }
      if (url) {
        return new Promise(resolve => { const a = new Audio(url); st.audio = a; const t0 = performance.now(); const done = src => { if (st.audio === a) st.audio = null; resolve({ ms: performance.now() - t0, source: src }); }; a.onended = () => done('fish'); a.onerror = () => done('error'); a.play().catch(() => done('blocked')); });
      }
      return sp.speakSystem(text);
    },
    speakSystem(text) {
      return new Promise(resolve => { try { if (!('speechSynthesis' in window)) return resolve({ ms: 0, source: 'none' }); const u = new SpeechSynthesisUtterance(text.slice(0, 220)); u.lang = 'zh-TW'; u.rate = 1.02; const v = speechSynthesis.getVoices().find(v => /zh[-_]TW/i.test(v.lang)) || speechSynthesis.getVoices().find(v => /^zh/i.test(v.lang)); if (v) u.voice = v; const t0 = performance.now(); u.onend = () => resolve({ ms: performance.now() - t0, source: 'system' }); u.onerror = () => resolve({ ms: 0, source: 'error' }); st.utter = u; speechSynthesis.speak(u); } catch { resolve({ ms: 0, source: 'error' }); } });
    },
  };
  return sp;
}
