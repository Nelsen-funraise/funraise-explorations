// Pre-render the cinematic scene narration with Fish Audio for every offered voice → public/audio/<voice>/<fnv1a>.mp3
// (lets the static GitHub Pages build narrate with real voices; dynamic answers still go through /api/tts). Usage: node scripts/prerender-tts.mjs [voiceId ...]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { SCENES } from '../src/scenes.js';
import { synthesize, fnv1a, DEFAULT_VOICES } from '../server/index.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)); const out = path.join(here, '..', 'public', 'audio');
const voices = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_VOICES.map(v => v.id);
const texts = SCENES.flatMap(s => s.steps.map(st => st.text));
let done = 0, made = 0, failed = 0; const t0 = Date.now();
for (const voice of voices) {
  const dir = path.join(out, voice); fs.mkdirSync(dir, { recursive: true });
  const jobs = texts.map(async text => { const key = fnv1a(text); const file = path.join(dir, key + '.mp3'); if (fs.existsSync(file)) { done++; return; }
    try { const r = await synthesize(text, voice); fs.copyFileSync(r.file, file); made++; } catch (e) { failed++; console.error('fail', voice, text.slice(0, 20), e.message); } });
  // 3 at a time to respect fair-use limits
  for (let i = 0; i < jobs.length; i += 3) await Promise.all(jobs.slice(i, i + 3));
  console.log(voice, 'ok');
}
const manifest = {}; for (const voice of voices) manifest[voice] = texts.map(t => fnv1a(t)).filter(k => fs.existsSync(path.join(out, voice, k + '.mp3')));
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ generated_at: new Date().toISOString(), model: 's2.1-pro-free', voices: manifest }, null, 0));
console.log(`prerendered: ${made} new, ${done} cached, ${failed} failed · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
