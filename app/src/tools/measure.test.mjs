// Node unit test for the pure geometry helpers in measure.js (ringAreaSqm, ringPerimeterM, pingOf).
// Run with: node app/src/tools/measure.test.mjs — no test runner, no Cesium.
//
// measure.js statically imports 'cesium' + './measure.css' (needed for the real Cesium-backed tool).
// Plain Node cannot load either: cesium's KmlDataSource pulls in a @zip.js/zip.js subpath that Node's
// resolver rejects (confirmed empirically — `node -e "import('cesium')"` throws ERR_PACKAGE_PATH_NOT_EXPORTED
// in this project), and .css has no Node loader at all. So instead of `import`-ing measure.js, this test
// lifts the exact text between the PURE HELPERS markers and evaluates it in an isolated Function scope.
// That text *is* the real shipped source (not a reimplementation), so the test still exercises the real code.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'measure.js'), 'utf8');
const start = src.indexOf('/* >>> PURE HELPERS');
const end = src.indexOf('/* <<< END PURE HELPERS');
if (start < 0 || end < 0) throw new Error('PURE HELPERS markers not found in measure.js — did the file move or get renamed?');
const block = src.slice(start, end).replace(/^export /gm, ''); // `export` is only legal at module top level; strip it for the Function body
const { pingOf, ringAreaSqm, ringPerimeterM } = new Function(`${block}\nreturn { pingOf, ringAreaSqm, ringPerimeterM };`)();

let pass = 0, fail = 0;
function check(label, got, want, tol) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${got}, want ~${want} (±${tol})`);
  if (ok) pass++; else fail++;
}

// known rectangle: 100 m (E-W) x 50 m (N-S) near 121.56E, 25.03N
const lat0 = 25.03, lon0 = 121.56;
const mLat = 110540, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
const hw = 50, hh = 25; // half-width / half-height in metres
const toDeg = (x, y) => [lon0 + x / mLon, lat0 + y / mLat];
const rect = [toDeg(-hw, -hh), toDeg(hw, -hh), toDeg(hw, hh), toDeg(-hw, hh), toDeg(-hw, -hh)]; // closed ring (first === last)

const area = ringAreaSqm(rect);
const per = ringPerimeterM(rect);
const ping = pingOf(area);
console.log('--- 100m x 50m rectangle near 121.56E 25.03N ---');
console.log('area (m²)     =', area.toFixed(3));
console.log('perimeter (m) =', per.toFixed(3));
console.log('area (坪)      =', ping.toFixed(3));
check('area ~ 5,000 m²', area, 5000, 1);
check('perimeter ~ 300 m', per, 300, 0.1);
check('area ~ 1,512.5 坪 (5000 / 3.305785)', ping, 1512.5, 1);

// an open ring (no explicit closing duplicate) must give practically the same result as the closed one.
// (they aren't bit-identical: the closed ring's own centroid counts the repeated first/last vertex twice,
// which nudges the local projection basis by a hair — tolerance here is generous on purpose, ~0.02% of scale.)
const openRect = rect.slice(0, -1);
check('area unaffected by explicit ring closure', ringAreaSqm(openRect), area, 1);
check('perimeter unaffected by explicit ring closure', ringPerimeterM(openRect), per, 0.1);

// degenerate inputs must not throw and must read as zero (finish() uses this to reject too-few-points)
check('area: < 3 points -> 0', ringAreaSqm([[121.56, 25.03], [121.561, 25.03]]), 0, 0);
check('area: empty ring -> 0', ringAreaSqm([]), 0, 0);
check('perimeter: < 2 points -> 0', ringPerimeterM([[121.56, 25.03]]), 0, 0);
check('pingOf(0) -> 0', pingOf(0), 0, 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
