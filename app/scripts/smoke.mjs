// Headless smoke test: serve dist/ via the agent server, boot the Cesium app in Chromium (SwiftShader), run agent verbs, take screenshots.
// Usage: npm run build && node scripts/smoke.mjs [outDir]   (needs Playwright + Chromium; set PW_CHROME to the chrome binary if not auto-found)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const req = createRequire(process.env.PW_REQUIRE_FROM || import.meta.url);
let pw; try { pw = req('playwright'); } catch { pw = createRequire('/opt/node22/lib/node_modules/')('playwright'); }
const out = process.argv[2] || 'dist'; fs.mkdirSync(out, { recursive: true });
const PORT = 8790; const server = spawn('node', ['server/index.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', d => process.stdout.write('[server] ' + d)); server.stderr.on('data', d => process.stdout.write('[server:err] ' + d));
await new Promise(r => setTimeout(r, 800));
const wait = ms => new Promise(r => setTimeout(r, ms));
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY; const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', proxy: proxy ? { server: proxy, bypass: 'localhost,127.0.0.1' } : undefined, args: [...(proxy ? [] : ['--no-proxy-server']), '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const errors = []; page.on('response', r => { if (r.status() >= 400) if (!/favicon/.test(r.url())) errors.push('http ' + r.status() + ' ' + r.url()); }); page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (!/fonts.googleapis|ERR_CONNECTION|net::|favicon|images.pickpeak/.test(t)) errors.push(m.type() + ': ' + t.slice(0, 300)); } });
const t0 = Date.now();
try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loading.done', { timeout: 240000 });
  console.log('booted in', Date.now() - t0, 'ms');
  await wait(7000);
  const st = await page.evaluate(() => ({ osm: window.PL.osm ? window.PL.osm.count : null, entities: window.PL.layers.byKey.size, readout: document.querySelector('#readout .line').textContent, coords: document.querySelector('#readout .coords').textContent, inView: window.PL.map.countInView(), fps: 'n/a', imageryLayers: window.PL.viewer.imageryLayers.length, neReady: window.PL.viewer.imageryLayers.get(0).ready }));
  console.log('state', JSON.stringify(st));
  await page.screenshot({ path: path.join(out, 'shot-1-overview.jpg'), type: 'jpeg', quality: 84 });
  const say = async (t, ms) => { await page.evaluate(t => window.PL.ui.say(t), t); await wait(ms); return page.evaluate(() => { const a = [...document.querySelectorAll('#transcript .turn.agent .answer')].pop(); const tools = [...document.querySelectorAll('#transcript .turn.agent:last-child .tool .name')].map(n => n.textContent); return { answer: a && a.textContent.slice(0, 220), tools }; }); };
  console.log('A', JSON.stringify(await say('帶我去台北101', 5000))); await page.screenshot({ path: path.join(out, 'shot-2-101.jpg'), type: 'jpeg', quality: 84 });
  console.log('B', JSON.stringify(await say('信義區有哪些都更單元', 4500))); await page.screenshot({ path: path.join(out, 'shot-3-renewal.jpg'), type: 'jpeg', quality: 84 });
  console.log('C', JSON.stringify(await say('最近一年信義區上市公司買了什麼', 4500))); await page.screenshot({ path: path.join(out, 'shot-4-mops.jpg'), type: 'jpeg', quality: 84 });
  console.log('D', JSON.stringify(await say('2028 年南港會長出什麼', 5000))); await page.screenshot({ path: path.join(out, 'shot-5-future.jpg'), type: 'jpeg', quality: 84 });
  await page.evaluate(() => { window.PL.ui.setSensor('thermal'); }); await wait(1500); await page.screenshot({ path: path.join(out, 'shot-6-thermal.jpg'), type: 'jpeg', quality: 84 }); await page.evaluate(() => window.PL.ui.setSensor('normal'));
  console.log('E', JSON.stringify(await say('街景模式看南港軟體園區', 5000))); await page.screenshot({ path: path.join(out, 'shot-7-street.jpg'), type: 'jpeg', quality: 84 });
  // Direction C: density modes, numbered callouts, pins
  await page.evaluate(() => window.PL.ui.setDensity('immersive')); await wait(1200); await page.screenshot({ path: path.join(out, 'shot-10-immersive.jpg'), type: 'jpeg', quality: 84 });
  await page.evaluate(() => window.PL.ui.setDensity('annotated')); console.log('F', JSON.stringify(await say('最近一年信義區上市公司買了什麼', 5000))); await page.screenshot({ path: path.join(out, 'shot-11-annotated.jpg'), type: 'jpeg', quality: 84 });
  const callouts = await page.evaluate(() => ({ callouts: document.querySelectorAll('#overlay .callout-anchor').length, list: document.querySelector('#callouts') && document.querySelector('#callouts').textContent.slice(0, 80), pinsSection: !!document.querySelector('[data-pin]') })); console.log('callouts', JSON.stringify(callouts));
  await page.evaluate(() => { const b = window.PL.data.buildings.find(x => /101/.test(x.name)); window.PL.ui.select(b, 'stock'); window.PL.ui.pin(b, 'stock'); window.PL.ui.setDensity('balanced'); window.PL.map.flyTo(b.lon, b.lat, { range: 1400, pitch: -40, duration: 0.2 }); }); await wait(2500); await page.screenshot({ path: path.join(out, 'shot-12-pin.jpg'), type: 'jpeg', quality: 84 });
  const pinState = await page.evaluate(() => ({ pins: document.querySelectorAll('#overlay .anchor.pin').length, behind: document.querySelectorAll('#overlay .anchor.behind').length, mcp: document.querySelector('#mcpstat span').textContent })); console.log('pin', JSON.stringify(pinState));
  await page.evaluate(() => window.PL.director.play('investor')); await wait(9000); await page.screenshot({ path: path.join(out, 'shot-8-scene.jpg'), type: 'jpeg', quality: 84 });
  const cine = await page.evaluate(() => document.querySelector('#cine-text').textContent); console.log('scene text:', cine);
  await page.evaluate(() => window.PL.director.stop());
  await page.evaluate(() => window.PL.map.globe()); await wait(4000); await page.screenshot({ path: path.join(out, 'shot-9-globe.jpg'), type: 'jpeg', quality: 84 });
  const health = await page.evaluate(() => fetch('/api/health').then(r => r.json())); console.log('health', JSON.stringify(health));
} catch (e) { console.error('SMOKE FAILED', e); errors.push('fatal: ' + e.message); await page.screenshot({ path: path.join(out, 'shot-fail.jpg'), type: 'jpeg', quality: 84 }).catch(() => {}); }
console.log('errors:', errors.length); for (const e of [...new Set(errors)].slice(0, 25)) console.log('  -', e);
await browser.close(); server.kill();
process.exit(errors.some(e => e.startsWith('pageerror') || e.startsWith('fatal')) ? 1 : 0);
