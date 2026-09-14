// Build: inline CSS/JS/data into a single HTML file.
//   node build.mjs            → dist/index.html (full document) + dist/artifact.html (fragment for claude.ai Artifacts)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const exists = p => fs.existsSync(path.join(root, p));
let html = read('src/index.template.html');
const inlineCode = (name) => name.endsWith('.css') ? `<style>\n${read('src/' + name)}\n</style>` : `<script>\n${read('src/' + name)}\n</script>`;
for (const f of ['style.css', 'engine.js', 'agent.js', 'ui.js']) html = html.replace(`<!--INLINE:${f}-->`, inlineCode(f));
const dataTag = (file, id) => { const raw = exists('data/' + file) ? read('data/' + file) : '{}'; const safe = JSON.stringify(JSON.parse(raw)).replace(/<\//g, '<\\/'); return `<script type="application/json" id="${id}">${safe}</script>`; };
html = html.replace('<!--DATA:basemap-->', dataTag('taipei_basemap.json', 'data-basemap')).replace('<!--DATA:demo-->', dataTag('taipei_demo.json', 'data-demo'));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/artifact.html'), html);
const full = `<!doctype html>\n<html lang="zh-Hant-TW">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${html.split('\n').slice(0, 1).join('\n')}\n</head>\n<body>\n${html.split('\n').slice(1).join('\n')}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(root, 'dist/index.html'), full);
const kb = f => (fs.statSync(path.join(root, f)).size / 1024).toFixed(0) + ' KB';
console.log(`built dist/index.html (${kb('dist/index.html')}) and dist/artifact.html (${kb('dist/artifact.html')})`);
