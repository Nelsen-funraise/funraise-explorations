import { chromium } from 'playwright'; // npm i -D playwright
const file = process.argv[2]; const out = process.argv[3] || 'shot.png'; const w = +(process.argv[4] || 1440), h = +(process.argv[5] || 900);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors = []; page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); }); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto('file://' + file, { waitUntil: 'load' });
await page.waitForTimeout(3800);
if (process.argv[6]) { await page.fill('#cmd', process.argv[6]); await page.press('#cmd', 'Enter'); await page.waitForTimeout(5200); }
await page.screenshot({ path: out });
const readout = await page.$eval('#readout .line', n => n.textContent).catch(() => 'n/a');
console.log('readout:', readout); console.log('errors:', errors.length ? errors.slice(0, 12).join('\n') : 'none');
await browser.close();
