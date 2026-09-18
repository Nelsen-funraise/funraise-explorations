// Pre-render the scene narration with Fish Audio → public/audio/<voice>/<fnv1a(speakable(text))>.mp3 + manifest.json, so the
// static GitHub Pages build narrates with the real voice (default: Nelsen) without any server. Dynamic AI answers still go
// through /api/tts. Usage: node scripts/prerender-tts.mjs [voiceId ...]   (default: nelsen; e.g. `nelsen eunice twf`)
//
// Phase 11: scene texts are no longer plain strings — many are `(ctx) => string` reading the snapshot (peaklens.json) and
// the time machine (timeseries.json), and some branch on whether 實景 is available. The browser looks a narration up by
// fnv1a(speakable(text)) (src/speech.js manifestUrl), so this script must produce EXACTLY the same strings: it evaluates
// every text function with a Node-side ctx that mirrors SceneDirector's (same data files, a faithful re-implementation of
// TimeMachine.cityStats/topMover/metricLabel, both photoreal variants) and hashes the speakable() form. Parity is checked
// headlessly by scripts/smoke.mjs (every resolved scene text must have a manifest hit for voice nelsen).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { SCENES } from '../src/scenes.js';
import { speakable, fnv1a } from '../src/speech-text.js';
import { synthesize, DEFAULT_VOICES } from '../server/index.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.join(here, '..'); const out = path.join(root, 'public', 'audio');
const readJSON = f => JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', f), 'utf8'));
const data = readJSON('peaklens.json'); const basemap = readJSON('taipei_basemap.json');
let ts = null; try { ts = readJSON('timeseries.json'); } catch { /* optional */ }

/* ---- faithful subset of src/layers/timemachine.js (read-only numbers the narrations use) ---- */
const METRICS = { sales_all: { label: '成交件數' }, sales_office: { label: '商辦成交' }, licenses: { label: '建照核發' } };
const RELIABLE_FROM = { sales_office: 2017 };
const pctNorm = v => v == null ? null : (Math.abs(v) > 1.5 ? v / 100 : v);
function fakeTimeMachine() {
  const years = (ts && ts.meta && Array.isArray(ts.meta.years) && ts.meta.years.length) ? ts.meta.years : Array.from({ length: 15 }, (_, i) => 2012 + i);
  const ytdYear = ts && ts.meta && Number.isFinite(ts.meta.ytd_year) ? ts.meta.ytd_year : years[years.length - 1];
  const districts = (basemap.districts || []).filter(d => /臺北市|台北市/.test(d.county || '') && d.rings && d.rings[0] && d.rings[0].length >= 3).map(d => d.name);
  const entry = (table, name) => table ? (table[name] || table['台北市' + name] || table['臺北市' + name] || null) : null;
  const seriesFor = (metric, name) => { const arr = ts && entry(ts[metric], name); return (arr && arr.length) ? arr : years.map(() => 0); };
  const citySeriesFor = metric => (ts && ts.city && ts.city[metric] && ts.city[metric].length) ? ts.city[metric] : years.map(() => 0);
  const idxForYear = y => { const yy = Math.max(years[0], Math.min(years[years.length - 1], Math.round(y))); return years.indexOf(yy); };
  const yoyFor = (metric, name, idx) => { const arr = ts && ts.yoy && entry(ts.yoy[metric], name); if (arr && arr.length > idx && arr[idx] != null) return pctNorm(arr[idx]); const s = seriesFor(metric, name); if (idx <= 0) return null; const prev = s[idx - 1], cur = s[idx]; if (!prev) return null; return (cur - prev) / prev; };
  const valueInfo = (metric, name, year) => { const idx = idxForYear(year); const y = years[idx] ?? year; const insufficient = RELIABLE_FROM[metric] != null && y < RELIABLE_FROM[metric]; const ytd = y === ytdYear; const raw = seriesFor(metric, name)[idx] || 0; const yoy = (insufficient || ytd) ? null : pctNorm(yoyFor(metric, name, idx)); return { idx, year: y, raw, yoy, insufficient, ytd }; };
  const self = { metric: 'sales_all', years, ytdYear };
  return {
    get metric() { return self.metric; }, metrics: Object.keys(METRICS), metricLabel: m => (METRICS[m] || {}).label || m, setMetric(m) { if (METRICS[m]) self.metric = m; return self.metric; },
    get source() { return ts ? 'timeseries' : 'snapshot'; }, get ytdYear() { return ytdYear; },
    cityStats(year) { const idx = idxForYear(year); const y = years[idx] ?? year; const ytd = y === ytdYear; const a = citySeriesFor('sales_all'); const salesAll = Math.round(a[idx] || 0), salesOffice = Math.round(citySeriesFor('sales_office')[idx] || 0), licenses = Math.round(citySeriesFor('licenses')[idx] || 0); const yoyPct = (!ytd && idx > 0 && a[idx - 1]) ? (a[idx] - a[idx - 1]) / a[idx - 1] : null; return { salesAll, salesOffice, licenses, yoyPct, ytd, year: y }; },
    districtStats(name, year) { return valueInfo(self.metric, name, year); },
    topMover(year) { let best = null; for (const name of districts) { const info = valueInfo(self.metric, name, year); if (info.yoy == null) continue; if (!best || Math.abs(info.yoy) > Math.abs(best.yoyPct)) best = { name, yoyPct: info.yoy, value: info.raw, year: info.year }; } return best; },
    isInsufficient(metric, year) { return RELIABLE_FROM[metric] != null && Math.round(year) < RELIABLE_FROM[metric]; },
  };
}
/* ---- resolve every scene step's text under both 實景 variants (the only runtime branch the texts take) ---- */
export function narrationTexts() {
  const seen = new Map(); // speakable text → { scenes: Set, raw }
  for (const photoreal of [false, true]) {
    const ctx = { data, map: { photoreal: { available: photoreal, active: photoreal }, timemachine: fakeTimeMachine(), year: 2026 }, ui: {}, timeline: {} };
    for (const sc of SCENES) for (const st of sc.steps) {
      let text = st.text; if (typeof text === 'function') { try { text = text(ctx) || ''; } catch (e) { console.warn('text failed', sc.id, e.message); text = ''; } }
      const clean = speakable(String(text || '')); if (!clean) continue;
      if (!seen.has(clean)) seen.set(clean, { scenes: new Set(), raw: text }); seen.get(clean).scenes.add(sc.id);
    }
  }
  return seen;
}
const voices = process.argv.slice(2).length ? process.argv.slice(2) : ['nelsen'];
for (const v of voices) if (!DEFAULT_VOICES.find(x => x.id === v)) { console.error('unknown voice', v, '— known:', DEFAULT_VOICES.map(x => x.id).join(', ')); process.exit(2); }
const texts = [...narrationTexts().keys()];
console.log(`${texts.length} distinct narrations across ${SCENES.length} scenes`);
let made = 0, cached = 0, failed = 0; const t0 = Date.now();
for (const voice of voices) {
  const dir = path.join(out, voice); fs.mkdirSync(dir, { recursive: true });
  const jobs = texts.map(text => async () => { const file = path.join(dir, fnv1a(text) + '.mp3'); if (fs.existsSync(file) && fs.statSync(file).size > 1000) { cached++; return; }
    try { const r = await synthesize(text, voice); fs.copyFileSync(r.file, file); made++; process.stdout.write('.'); } catch (e) { failed++; console.error('\nfail', voice, text.slice(0, 24), e.message); } });
  for (let i = 0; i < jobs.length; i += 3) await Promise.all(jobs.slice(i, i + 3).map(j => j())); // 3 at a time (Fish fair-use)
  console.log('\n' + voice, 'done');
}
// manifest lists every file present per voice (old narrations stay playable if a text ever reverts); model from env
const manifest = {}; for (const voice of fs.readdirSync(out)) { const dir = path.join(out, voice); if (!fs.statSync(dir).isDirectory()) continue; manifest[voice] = fs.readdirSync(dir).filter(f => f.endsWith('.mp3')).map(f => f.slice(0, -4)); }
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ generated_at: new Date().toISOString(), model: process.env.FISH_MODEL || 's2.1-pro-free', default_voice: 'nelsen', texts: texts.length, voices: manifest }, null, 0));
console.log(`prerendered: ${made} new, ${cached} cached, ${failed} failed · ${((Date.now() - t0) / 1000).toFixed(0)}s → ${path.relative(root, path.join(out, 'manifest.json'))}`);
process.exit(failed ? 1 : 0);
