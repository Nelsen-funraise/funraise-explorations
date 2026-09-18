// Phase 11 — pure text helpers shared by the browser speech layer (src/speech.js) and the Node pre-render script
// (scripts/prerender-tts.mjs): the narration file name is fnv1a(speakable(text)), so BOTH sides must run exactly the same
// sanitizer and hash. No imports, no DOM: safe to import from Node.
export const fnv1a = str => { let h = 0x811c9dc5; for (const c of new TextEncoder().encode(str)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const CHUNK_MAX = 90;
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
