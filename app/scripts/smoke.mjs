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
page.setDefaultTimeout(120000); // SwiftShader frames can take many seconds when animations are running
const errors = []; page.on('response', r => { if (r.status() >= 400) if (!/favicon/.test(r.url())) errors.push('http ' + r.status() + ' ' + r.url()); }); page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (!/fonts.googleapis|ERR_CONNECTION|net::|favicon|images.pickpeak/.test(t)) errors.push(m.type() + ': ' + t.slice(0, 300)); } });
const t0 = Date.now();
try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loading.done', { timeout: 240000 });
  console.log('booted in', Date.now() - t0, 'ms');
  await wait(9500); // cinematic intro (≈6.2 s) + settle
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
  // themes, clusters, time-lapse motion, voices
  await page.evaluate(() => { window.PL.ui.setTheme('light'); window.PL.map.flyTo(121.548, 25.05, { range: 12000, pitch: -58, heading: 10, duration: 0.2 }); }); await wait(4500); await page.screenshot({ path: path.join(out, 'shot-13-light-clusters.jpg'), type: 'jpeg', quality: 84 });
  const clusters = await page.evaluate(() => { const ds = window.PL.layers.ds.markers; return { markers: ds.entities.values.length, clustering: ds.clustering.enabled, theme: window.PL.ui.theme, osmPalette: window.PL.osm && window.PL.osm.palette }; }); console.log('clusters', JSON.stringify(clusters));
  await page.evaluate(() => { window.PL.ui.setDensity('balanced'); window.PL.map.flyTo(121.5655, 25.0375, { range: 2600, pitch: -42, heading: 25, duration: 0.2 }); }); await wait(3000); await page.screenshot({ path: path.join(out, 'shot-14-light-xinyi.jpg'), type: 'jpeg', quality: 84 });
  await page.evaluate(() => { window.PL.map.setYear(2012); window.PL.ui.userMode('timelapse'); }); await wait(3600); await page.screenshot({ path: path.join(out, 'shot-15-timelapse.jpg'), type: 'jpeg', quality: 84 });
  const lapse = await page.evaluate(() => ({ year: window.PL.map.year, hud: document.querySelector('#yearhud') && document.querySelector('#yearhud').textContent.slice(0, 60), fx: window.PL.layers.ds.fx.entities.values.length })); console.log('lapse', JSON.stringify(lapse)); await page.evaluate(() => window.PL.ui.userMode('city')); await wait(3500); // let the city flight settle before testing the rig
  await page.evaluate(() => window.PL.map.rig.rotateBy(60)); await wait(1500); const hp = await page.evaluate(() => [Math.round(window.PL.map.heading), Math.round(window.PL.map.pitch)]); console.log('after rotateBy(60): heading/pitch', hp);
  console.log('voices', JSON.stringify(await page.evaluate(() => window.PL.ui.speech.voices().map(v => `${v.id}:${v.available ? 'ok' : 'n/a'}${v.prerendered ? ':pre' : ''}`))));
  // renewal simulator
  await page.evaluate(() => window.PL.ui.setDensity('balanced')); console.log('G', JSON.stringify(await say('模擬兒福B1-2及B3-2都更', 6000))); await page.screenshot({ path: path.join(out, 'shot-16-renewal-sim.jpg'), type: 'jpeg', quality: 84 });
  const simState = await page.evaluate(() => ({ card: !!document.querySelector('#simcard:not(.hidden)'), kpis: [...document.querySelectorAll('#simcard .kpi .v')].map(v => v.textContent).slice(0, 4), envelopeH: Math.round(window.PL.map.envelope.h), parcels: window.PL.layers.ds.parcels.entities.values.length })); console.log('sim', JSON.stringify(simState));
  await page.evaluate(() => { const sl = document.querySelector('#sim-bonus'); if (sl) { sl.value = 50; sl.dispatchEvent(new Event('input')); } }); await wait(1500); console.log('sim@50%', JSON.stringify(await page.evaluate(() => ({ envelopeH: Math.round(window.PL.map.envelope.h), floors: document.querySelectorAll('#simcard .kpi .v')[1].textContent }))));
  // sun & shadows (golden hour), hover mini-card, share deep link
  await page.evaluate(() => { window.PL.ui.clearSim(); window.PL.ui.setSun(17); window.PL.map.flyTo(121.5655, 25.0375, { range: 1900, pitch: -36, heading: 300, duration: 0.2 }); }); await wait(5000); await page.screenshot({ path: path.join(out, 'shot-17-golden-shadows.jpg'), type: 'jpeg', quality: 84 });
  console.log('sun', JSON.stringify(await page.evaluate(() => ({ shadows: window.PL.viewer.shadows, hour: window.PL.ui.sunHour, alt: window.PL.lighting.sunAltitude(), casters: window.PL.osm.primitives.filter(p => p.shadows === 1).length, pill: document.querySelector('#sun').textContent, lighting: window.PL.viewer.scene.globe.enableLighting }))));
  await page.evaluate(() => { const b = window.PL.data.buildings.find(x => /101/.test(x.name)); window.PL.map.flyTo(b.lon, b.lat, { range: 700, pitch: -35, heading: 20, duration: 0.2 }); }); await wait(2500);
  let hov = null; for (const [dx, dy] of [[0, 0], [0, -60], [0, -140], [30, -100], [-30, -100], [0, 40]]) { await page.mouse.move(720 + dx, 450 + dy); await wait(350); hov = await page.evaluate(() => { const c = document.querySelector('#hovercard'); return { visible: !c.classList.contains('hidden'), text: c.textContent.slice(0, 90) }; }); if (hov.visible) break; }
  console.log('hover', JSON.stringify(hov)); await page.screenshot({ path: path.join(out, 'shot-18-hover.jpg'), type: 'jpeg', quality: 84 });
  const shareUrl = await page.evaluate(() => window.PL.ui.shareView()); console.log('share', shareUrl.slice(shareUrl.indexOf('#'), shareUrl.indexOf('#') + 120));
  // MRT isochrone (network computed in-app) + presenter mode
  console.log('I', JSON.stringify(await say('從南港軟體園區搭捷運20分鐘能到哪', 5000))); await page.screenshot({ path: path.join(out, 'shot-24-isochrone.jpg'), type: 'jpeg', quality: 84 });
  console.log('iso', JSON.stringify(await page.evaluate(() => ({ active: window.PL.map.isochroneActive, n: window.PL.isochrone ? window.PL.isochrone.ds.entities.values.length : null }))));
  await page.evaluate(() => { window.PL.map.clearIsochrone(); window.PL.ui.presenter.enter(); }); await wait(1500); await page.screenshot({ path: path.join(out, 'shot-25-presenter.jpg'), type: 'jpeg', quality: 84 });
  console.log('presenter', JSON.stringify(await page.evaluate(() => ({ active: window.PL.presenter.active, body: document.body.className, progress: (document.querySelector('#presenter-progress') || {}).textContent || null })))); await page.keyboard.press('Escape'); await wait(800); console.log('presenter after Esc', JSON.stringify(await page.evaluate(() => ({ active: window.PL.presenter.active, density: window.PL.ui.density }))));
  // focus / x-ray + company-move trips
  await page.evaluate(() => { const b = window.PL.data.buildings.find(x => /101/.test(x.name)); window.PL.ui.select(b, 'stock'); window.PL.ui.focus(b, 'stock', true); window.PL.map.flyTo(b.lon, b.lat, { range: 700, pitch: -40, heading: 300, duration: 0.2 }); }); await wait(5000); await page.screenshot({ path: path.join(out, 'shot-22-focus.jpg'), type: 'jpeg', quality: 84 });
  console.log('focus', JSON.stringify(await page.evaluate(() => ({ active: !!window.PL.focus.active, osm: !!window.PL.osm.focused, body: document.body.className.includes('focusing') }))));
  await page.evaluate(() => window.PL.ui.focus(null, null, false)); await wait(1500);
  console.log('H', JSON.stringify(await say('播放企業遷徙動線', 1500))); await page.evaluate(() => { window.PL.trips.clear(); window.PL.trips.play({ year: 2026, max: 6, durationMs: 9000, staggerMs: 300 }); }); await wait(2500); await page.screenshot({ path: path.join(out, 'shot-23-trips.jpg'), type: 'jpeg', quality: 84 });
  console.log('trips', JSON.stringify(await page.evaluate(() => ({ playing: window.PL.trips && window.PL.trips.playing, entities: window.PL.viewer.dataSources.getByName('trips').length ? window.PL.viewer.dataSources.getByName('trips')[0].entities.values.length : null }))));
  await page.evaluate(() => window.PL.trips.clear()); await wait(800);
  await page.mouse.move(5, 5); await page.evaluate(() => { window.PL.ui.setSun(null); window.PL.ui.setOverlay('landsect', true); window.PL.ui.setOverlay('publicland', true); }); await wait(2500); await page.screenshot({ path: path.join(out, 'shot-20-overlays.jpg'), type: 'jpeg', quality: 84 });
  console.log('overlays', JSON.stringify(await page.evaluate(() => ({ on: window.PL.ui.overlays(), imagery: window.PL.viewer.imageryLayers.length, credits: document.querySelector('#credits').textContent.slice(0, 120), ground: window.PL.ground && window.PL.ground.counts, rivers: !!(window.PL.ground && window.PL.ground.rivers), quality: window.PL.viewerApi.quality }))));
  await page.evaluate(() => { window.PL.ui.setOverlay('landsect', false); window.PL.ui.setOverlay('publicland', false); window.PL.ui.setTheme('dark'); window.PL.map.flyTo(121.51, 25.07, { range: 5200, pitch: -48, heading: 135, duration: 0.2 }); }); await wait(4000); await page.screenshot({ path: path.join(out, 'shot-21-night-rivers.jpg'), type: 'jpeg', quality: 84 });
  console.log('night', JSON.stringify(await page.evaluate(() => ({ quality: window.PL.viewerApi.quality, bloom: window.PL.viewer.scene.postProcessStages.bloom.enabled, roadsShown: window.PL.ground ? window.PL.ground.roads.filter(p => p.show).length : 0, basemapYear: window.PL.viewerApi.basemapYear }))));
  await page.evaluate(() => { window.PL.map.setYear(2016); }); await wait(600); console.log('vintage', JSON.stringify(await page.evaluate(() => ({ year: window.PL.map.year, basemapYear: window.PL.viewerApi.basemapYear })))); await page.evaluate(() => window.PL.map.setYear(2026));
  await page.evaluate(() => window.PL.director.play('investor')); await wait(9000); await page.screenshot({ path: path.join(out, 'shot-8-scene.jpg'), type: 'jpeg', quality: 84 });
  const cine = await page.evaluate(() => document.querySelector('#cine-text').textContent); console.log('scene text:', cine);
  await page.evaluate(() => window.PL.director.stop());
  await page.evaluate(() => window.PL.map.globe()); await wait(4000); await page.screenshot({ path: path.join(out, 'shot-9-globe.jpg'), type: 'jpeg', quality: 84 });
  const health = await page.evaluate(() => fetch('/api/health').then(r => r.json())); console.log('health', JSON.stringify(health));
  { const t2 = Date.now(); await page.goto('about:blank'); await page.goto(shareUrl, { waitUntil: 'domcontentloaded', timeout: 120000 }); // via about:blank: a hash-only change would not reload await page.waitForSelector('#loading.done', { timeout: 240000 }); await wait(3500);
    console.log('deeplink', JSON.stringify(await page.evaluate(() => ({ theme: window.PL.ui.theme, density: window.PL.ui.density, sun: window.PL.ui.sunHour, lens: window.PL.agent.lens, year: window.PL.map.year, heading: Math.round(window.PL.map.heading), pitch: Math.round(window.PL.map.pitch), h: Math.round(window.PL.rig.lonlat[2]), hash: location.hash.slice(0, 40) }))), 'in', Date.now() - t2, 'ms'); await page.screenshot({ path: path.join(out, 'shot-19-deeplink.jpg'), type: 'jpeg', quality: 80 }); }
} catch (e) { console.error('SMOKE FAILED', e); errors.push('fatal: ' + e.message); await page.screenshot({ path: path.join(out, 'shot-fail.jpg'), type: 'jpeg', quality: 84 }).catch(() => {}); }
console.log('errors:', errors.length); for (const e of [...new Set(errors)].slice(0, 25)) console.log('  -', e);
await browser.close(); server.kill();
process.exit(errors.some(e => e.startsWith('pageerror') || e.startsWith('fatal')) ? 1 : 0);
