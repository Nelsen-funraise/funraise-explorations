// Generates the design-canvas artboards (*.dc.html) for "睿鏡 HUD × PickPeak Design System".
// Tokens below are lifted from the PickPeak VI Guideline (Figma q5gwnLV12KiRu2iTQnpboG · A/04 品牌色彩, A/05 標準字體)
// and the live pickpeak.ai Tailwind theme (--color-brand-*, --color-accent-*, --radius-*) / solutions.pickpeak.ai (--lp-glow-*).
import fs from 'node:fs';
const T = {
  blue: { 50: '#F2FCFC', 100: '#E3F8FA', 200: '#BBEAF0', 300: '#93DCE6', 400: '#50C0D4', 500: '#16A4C0', 600: '#0C83A2', 700: '#0F6A85', 800: '#14586E', 900: '#164B5F', 950: '#063344' },
  orange: { 50: '#FFFDF7', 100: '#FFF9ED', 200: '#FFDAA0', 300: '#FCBE83', 400: '#F29628', 500: '#DE7020', 600: '#BA5C2D', 700: '#96411D', 800: '#7A2E10', 900: '#4F1706' },
  gray: { 50: '#F9FAFB', 100: '#F3F4F6', 200: '#E5E7EB', 300: '#D1D5DB', 400: '#99A1AF', 500: '#6A7282', 600: '#4A5565', 700: '#364153', 800: '#1E2939', 900: '#101828', 950: '#030712' },
  success: '#009767', error: '#FB2C36', glowA: '#8CDCE7', glowB: '#F2C583',
};
const FONT = `'Inter','Noto Sans TC',system-ui,sans-serif`;
const MONO = `'SF Mono',ui-monospace,Menlo,monospace`;
const panel = `background:rgba(30,41,57,.80);border:1px solid rgba(74,85,101,.65);border-radius:8px;backdrop-filter:blur(12px);box-shadow:0 0 10px -1px rgba(3,7,18,.6)`;
const head = (title) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Noto+Sans+TC:wght@400;500;700&amp;display=swap">
  <style>
    body { margin: 0; font-family: ${FONT}; color: ${T.gray[100]}; background: ${T.gray[950]}; }
    a { color: ${T.blue[400]}; } a:hover { color: ${T.blue[300]}; }
    * { box-sizing: border-box; }
  </style>
</helmet>`;
const tail = (script = '') => `</x-dc>${script}
</body>
</html>`;

/* ---------- shared HUD pieces (inline-styled so the editor's panel can restyle them) ---------- */
const eyebrow = (t, color = T.gray[400]) => `<div style="font-family:${MONO};font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:${color}">${t}</div>`;
const lensPills = (active = 2, compact = false) => {
  const names = ['投資人', '開發商', '企業選址', '城市治理', '學研'];
  return `<div style="display:flex;gap:4px;align-items:center;padding:3px;border-radius:999px;background:rgba(30,41,57,.8);border:1px solid rgba(74,85,101,.65)">${names.map((n, i) => `<div style="padding:${compact ? '5px 10px' : '6px 12px'};border-radius:999px;font-size:12px;font-weight:500;line-height:16px;color:${i === active ? T.gray[950] : T.gray[300]};background:${i === active ? T.blue[400] : 'transparent'}">${n}鏡</div>`).join('')}</div>`;
};
const brand = () => `<div style="display:flex;align-items:baseline;gap:8px"><div style="font-size:16px;font-weight:700;letter-spacing:.02em;color:${T.gray[50]}">睿鏡 <span style="color:${T.blue[400]};font-weight:600">PeakLens</span></div><div style="font-family:${MONO};font-size:10px;letter-spacing:.12em;color:${T.gray[400]}">by PickPeak · FUNRAISE MCP</div></div>`;
const densityControl = (active) => {
  const items = [['沉浸', 0], ['平衡', 1], ['標註', 2]];
  return `<div style="display:flex;align-items:center;gap:2px;padding:2px;border-radius:6px;background:rgba(30,41,57,.8);border:1px solid rgba(74,85,101,.65)">${items.map(([n, i]) => `<div style="padding:5px 10px;border-radius:4px;font-size:12px;font-weight:500;line-height:16px;color:${i === active ? T.gray[950] : T.gray[300]};background:${i === active ? T.gray[100] : 'transparent'}">${n}</div>`).join('')}<div style="width:1px;height:16px;background:${T.gray[600]};margin:0 4px"></div><div style="padding:5px 8px;font-size:11px;color:${T.gray[400]}">密度 <span style="font-family:${MONO};color:${T.gray[200]}">D</span></div></div>`;
};
const status = () => `<div style="display:flex;align-items:center;gap:10px;font-family:${MONO};font-size:11px;color:${T.gray[400]}"><div style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:${T.success};box-shadow:0 0 6px ${T.success}"></span>FUNRAISE MCP · LIVE</div><div>2026-09-14</div><div style="color:${T.gray[200]}">11:52:07 TPE</div></div>`;
const topbar = (density, opts = {}) => `<div style="position:absolute;left:16px;right:16px;top:12px;display:flex;align-items:center;justify-content:space-between;gap:16px">${brand()}${opts.hideLens ? '' : lensPills(2, density === 0)}<div style="display:flex;align-items:center;gap:10px">${densityControl(density)}${density === 0 ? '' : status()}</div></div>`;
const readout = (text, coords, x = '50%') => `<div style="position:absolute;left:${x};top:60px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:5px 12px;border-radius:999px;background:rgba(3,7,18,.55);border:1px solid rgba(74,85,101,.45);font-family:${MONO};font-size:11px;color:${T.gray[300]}"><span style="color:${T.blue[300]}">◎</span>${text}<span style="color:${T.gray[500]}">${coords}</span></div>`;
const micBtn = () => `<div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${T.blue[500]};color:${T.gray[950]};flex:none"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path></svg></div>`;
const orb = () => `<div style="width:28px;height:28px;border-radius:50%;flex:none;background:radial-gradient(circle at 35% 35%, ${T.glowA}, ${T.blue[600]} 70%);box-shadow:0 0 0 2px rgba(140,220,231,.28), 0 6px 18px -4px ${T.glowA}, 0 6px 18px -4px ${T.glowB}"></div>`;
const capsule = (placeholder, width = 640, bottom = 24) => `<div style="position:absolute;left:50%;bottom:${bottom}px;transform:translateX(-50%);width:${width}px;height:52px;display:flex;align-items:center;gap:12px;padding:8px 10px 8px 8px;border-radius:26px;background:rgba(30,41,57,.86);border:1px solid rgba(147,220,230,.35);backdrop-filter:blur(14px);box-shadow:0 0 0 1px rgba(22,164,192,.25), 0 10px 30px -10px ${T.glowA}, 0 10px 30px -14px ${T.glowB}">${micBtn()}<div style="flex:1;font-size:14px;color:${T.gray[400]}">${placeholder}</div>${orb()}<div style="padding:8px 14px;border-radius:999px;background:${T.gray[100]};color:${T.gray[950]};font-size:13px;font-weight:600">送出</div></div>`;
const chip = (t, kind = 'ghost') => `<div style="padding:4px 10px;border-radius:999px;font-size:12px;line-height:16px;font-weight:500;${kind === 'brand' ? `background:${T.blue[500]};color:${T.gray[950]}` : kind === 'warm' ? `background:rgba(252,190,131,.18);color:${T.orange[300]};border:1px solid rgba(252,190,131,.35)` : `background:rgba(74,85,101,.35);color:${T.gray[200]};border:1px solid rgba(74,85,101,.6)`}">${t}</div>`;
const provenance = (calls, ms) => `<div style="display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:4px;background:rgba(3,7,18,.5);border:1px solid rgba(74,85,101,.5);font-family:${MONO};font-size:10.5px;color:${T.gray[300]}"><span style="width:6px;height:6px;border-radius:50%;background:${T.success}"></span>${calls} MCP 呼叫 · ${ms} ms · 來源可回查</div>`;
const row = (k, v, warm = false) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid rgba(74,85,101,.35);font-size:12px"><span style="color:${T.gray[400]}">${k}</span><span style="color:${warm ? T.orange[300] : T.gray[100]};font-weight:500;text-align:right">${v}</span></div>`;
const contextCard = (x, y, w = 300) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;padding:12px 14px 12px;${panel}">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
    <div>${eyebrow('商辦存量 · buildings.get_building', T.blue[300])}<div style="margin-top:4px;font-size:16px;font-weight:600;color:${T.gray[50]}">台北101大樓</div></div>
    ${chip('P 級', 'warm')}
  </div>
  <div style="margin-top:8px">${row('樓層', '101F / B5')}${row('使照', '2003 · 屋齡 23 年')}${row('實價租金', '均 4,526 元/坪/月 · 41 筆', true)}${row('捷運', '象山站 466 m')}${row('認證', 'LEED 白金 · WELL 白金 · EEWH 鑽石')}</div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">${chip('租戶是誰')}${chip('容積率')}${chip('歷史成交')}${chip('DD memo')}${chip('環繞', 'brand')}</div>
</div>`;
const leader = (x1, y1, x2, y2, color = T.blue[300]) => `<svg style="position:absolute;left:0;top:0;pointer-events:none" width="1440" height="900" viewBox="0 0 1440 900"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.2" stroke-opacity=".9"></line><circle cx="${x1}" cy="${y1}" r="3.5" fill="${color}"></circle><circle cx="${x1}" cy="${y1}" r="8" fill="none" stroke="${color}" stroke-opacity=".45"></circle></svg>`;
const mapLabel = (x, y, title, sub, color = T.orange[300], num = '') => `<div style="position:absolute;left:${x}px;top:${y}px;display:flex;align-items:center;gap:8px;padding:5px 10px 5px ${num ? '6px' : '10px'};border-radius:6px;background:rgba(3,7,18,.72);border:1px solid rgba(74,85,101,.55);backdrop-filter:blur(6px)">${num ? `<span style="width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:${color};color:${T.gray[950]};font-family:${MONO};font-size:11px;font-weight:600">${num}</span>` : ''}<span style="font-size:12px;font-weight:600;color:${T.gray[50]}">${title}</span><span style="font-family:${MONO};font-size:11px;color:${color}">${sub}</span></div>`;
const edgeTab = (side, y, label, count) => `<div style="position:absolute;${side}:0;top:${y}px;width:28px;padding:10px 0;display:flex;flex-direction:column;align-items:center;gap:8px;background:rgba(30,41,57,.86);border:1px solid rgba(74,85,101,.65);border-${side}:none;border-radius:${side === 'left' ? '0 8px 8px 0' : '8px 0 0 8px'}"><div style="writing-mode:vertical-rl;font-size:11px;letter-spacing:.2em;color:${T.gray[300]}">${label}</div><div style="font-family:${MONO};font-size:10px;color:${T.blue[300]}">${count}</div></div>`;
const kpi = (v, l, warm = false) => `<div style="padding:10px 12px;border-radius:6px;background:rgba(3,7,18,.45);border:1px solid rgba(74,85,101,.45)"><div style="font-family:${MONO};font-size:20px;font-weight:600;line-height:24px;color:${warm ? T.orange[300] : T.gray[50]}">${v}</div><div style="margin-top:2px;font-size:11px;color:${T.gray[400]}">${l}</div></div>`;
const bar = (k, pct, v, color) => `<div style="display:grid;grid-template-columns:64px 1fr 56px;align-items:center;gap:8px;font-size:11px"><span style="color:${T.gray[300]};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${k}</span><span style="height:8px;border-radius:2px;background:rgba(74,85,101,.35);overflow:hidden;display:block"><i style="display:block;height:100%;width:${pct}%;background:${color};border-radius:2px"></i></span><span style="font-family:${MONO};color:${T.gray[100]};text-align:right">${v}</span></div>`;
const bars = () => `<div style="display:flex;flex-direction:column;gap:6px">${bar('大安區', 100, '360', T.blue[400])}${bar('中山區', 82, '294', T.blue[400])}${bar('中正區', 66, '236', T.blue[400])}${bar('士林區', 65, '233', T.blue[400])}${bar('信義區', 48, '174', T.orange[400])}</div>`;
const timeline = (x, y, w, compact = false) => `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;display:flex;align-items:center;gap:10px;padding:${compact ? '6px 12px' : '10px 14px'};${panel}"><span style="font-family:${MONO};font-size:10px;color:${T.gray[400]}">2012</span><div style="flex:1;height:4px;border-radius:2px;background:rgba(74,85,101,.5);position:relative"><div style="position:absolute;left:0;top:0;height:100%;width:78%;border-radius:2px;background:linear-gradient(90deg, ${T.blue[700]}, ${T.blue[400]})"></div><div style="position:absolute;left:78%;top:50%;width:14px;height:14px;border-radius:50%;transform:translate(-50%,-50%);background:${T.gray[50]};border:3px solid ${T.blue[500]}"></div></div><span style="font-family:${MONO};font-size:10px;color:${T.gray[400]}">2030</span><span style="font-family:${MONO};font-size:14px;font-weight:600;color:${T.blue[300]}">2026</span></div>`;
const toolRow = (name, args, res) => `<div style="display:grid;grid-template-columns:8px 1fr auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(74,85,101,.3);font-family:${MONO};font-size:10.5px"><span style="width:6px;height:6px;border-radius:50%;background:${T.success}"></span><span style="color:${T.gray[200]};white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><b style="color:${T.gray[50]};font-weight:600">${name}</b> <span style="color:${T.gray[500]}">${args}</span></span><span style="color:${T.gray[400]}">${res}</span></div>`;
const answer = (text, w = 640, bottom = 90, center = true) => `<div style="position:absolute;${center ? 'left:50%;transform:translateX(-50%);' : ''}bottom:${bottom}px;width:${w}px;padding:12px 16px;${panel};border-left:2px solid ${T.blue[500]}"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center">${eyebrow('睿鏡 · 回答', T.blue[300])}${provenance(2, 384)}</div><div style="margin-top:6px;font-size:14px;line-height:1.55;color:${T.gray[100]}">${text}</div></div>`;
const bg = (img) => `background:${T.gray[950]} url(./${img}) center/cover no-repeat`;
const frame = (img, inner) => `<div style="position:relative;width:1440px;height:900px;overflow:hidden;${bg(img)};font-family:${FONT}">
  <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(3,7,18,.55) 0%, rgba(3,7,18,0) 22%, rgba(3,7,18,0) 70%, rgba(3,7,18,.5) 100%)"></div>
  ${inner}
</div>`;

/* ---------- artboards ---------- */
// A · 沉浸：map first, chrome retreats to edges; data lives in the world.
const immersive = head('沉浸') + frame('map-xinyi.jpg', `
  ${topbar(0, { hideLens: false })}
  ${readout('信義區 · 商辦 152 · 都更 71 · 法人交易 29', '25.0375N 121.5655E · 3.2 km · -42°')}
  ${edgeTab('left', 380, '圖層', '7/11')}
  ${edgeTab('right', 380, '面板', '4')}
  ${leader(742, 470, 880, 402)}
  ${contextCard(880, 300)}
  ${mapLabel(420, 560, '南山廣場', 'A · 租 3,980/坪', T.orange[300])}
  ${mapLabel(1010, 640, '安泰銀 · 取得', '4.8 億', T.orange[400])}
  ${answer('台北101大樓：P 級商辦，101F／B5，2003 年取得使照，距象山站 466 m；近 12 月上市櫃交易 3 筆、4.9 億。', 640, 90)}
  ${capsule('對城市說話：「台北101 的租戶是誰」「環繞一圈」…')}
  <div style="position:absolute;right:16px;bottom:24px;display:flex;gap:6px">${chip('▶ 場景')}${chip('2026 ⟶', 'ghost')}</div>
`) + tail();

// B · 標註：map + persistent data rail; numbered callouts tie map to rail so nothing overlaps.
const annotated = head('標註') + `<div style="position:relative;width:1440px;height:900px;overflow:hidden;background:${T.gray[950]};font-family:${FONT};display:grid;grid-template-columns:1fr 372px">
  <div style="position:relative;overflow:hidden;${bg('map-nangang.jpg')}">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(3,7,18,.5) 0%, rgba(3,7,18,0) 20%)"></div>
    <div style="position:absolute;left:16px;right:16px;top:12px;display:flex;align-items:center;justify-content:space-between;gap:16px">${brand()}${lensPills(1)}${densityControl(2)}</div>
    ${readout('南港區 · 2028 年 · 規劃中 3 · 建照 9 · 都更 11', '25.054N 121.606E · 2.4 km · -36°', '50%')}
    ${leader(430, 470, 520, 412, T.blue[300])}${mapLabel(520, 396, '南港調車場公辦都更 東街廓', '27F · 2028', T.blue[300], '1')}
    ${leader(690, 520, 760, 466, T.blue[300])}${mapLabel(760, 450, 'HCBD 虹創科技大樓', '18F · 2026', T.blue[300], '2')}
    ${leader(300, 600, 210, 660, T.orange[400])}${mapLabel(90, 644, '雲豹能源 · 取得', '3.1 億 · 2026-06', T.orange[400], '3')}
    ${leader(560, 640, 600, 700, T.blue[400])}${mapLabel(600, 684, '115建字第0053號', '新建 · 24–48 月後完工', T.blue[400], '4')}
    <div style="position:absolute;left:16px;bottom:88px;display:flex;flex-direction:column;gap:4px;padding:10px 12px;${panel}">${eyebrow('圖例 · 7 / 11 圖層')}${['商辦存量 34', '未來供給 3', '建照 9', '都更單元 11', '上市櫃交易 4', '捷運 6 線'].map((l, i) => `<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:${T.gray[200]}"><span style="width:10px;height:10px;border-radius:${i === 1 ? '2px' : i === 4 ? '1px' : '50%'};background:${[T.orange[300], T.blue[300], T.blue[400], '#C4B5FD', T.orange[400], T.gray[400]][i]};${i === 1 ? 'opacity:.55;border:1px solid ' + T.blue[300] : ''}"></span>${l}</div>`).join('')}</div>
    ${timeline(16, 848, 1036, true)}
    ${capsule('「2028 年南港會長出什麼」', 560, 16)}
  </div>
  <div style="position:relative;display:flex;flex-direction:column;gap:10px;padding:12px;background:${T.gray[900]};border-left:1px solid ${T.gray[700]};overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center">${eyebrow('開發商鏡 · 供給雷達', T.blue[300])}${status()}</div>
    <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:8px">${kpi('2,310', '台北市都更地區／單元')}${kpi('98', '114–115 年建照（快照）')}${kpi('13', '規劃／興建中案', true)}${kpi('73', '重劃／區段徵收')}</div>
    <div style="padding:10px 12px;border-radius:6px;background:rgba(3,7,18,.45);border:1px solid rgba(74,85,101,.45)">${eyebrow('各區都更件數 · urban-renewal.aggregate')}<div style="margin-top:8px">${bars()}</div></div>
    <div style="padding:10px 12px;border-radius:6px;background:rgba(3,7,18,.45);border:1px solid rgba(74,85,101,.45)">${eyebrow('地圖標註 ①–④ · 對應卡片')}
      <div style="margin-top:6px">${row('① 南港調車場公辦都更 東街廓', '27F · 2028')}${row('② HCBD 虹創科技大樓', '18F · 2026')}${row('③ 雲豹能源 取得台壽南港大樓', '3.1 億', true)}${row('④ 115建字第0053號', '新建')}</div>
    </div>
    <div style="padding:10px 12px;border-radius:6px;background:rgba(3,7,18,.45);border:1px solid rgba(74,85,101,.45)">${eyebrow('來源與工具呼叫 · Provenance')}<div style="margin-top:4px">${toolRow('future-dev.search_future_dev', 'district=南港區', '2 案 · 303 ms')}${toolRow('taipei-licenses.search_building_licenses', 'year=114', '9 張 · 518 ms')}${toolRow('urban-renewal.search_urban_renewal', 'district=南港區', '11 筆 · 226 ms')}</div></div>
    <div style="margin-top:auto;padding:10px 12px;border-radius:6px;background:rgba(3,7,18,.45);border:1px solid rgba(74,85,101,.45);border-left:2px solid ${T.blue[500]}">${eyebrow('睿鏡 · 回答', T.blue[300])}<div style="margin-top:4px;font-size:12.5px;line-height:1.5;color:${T.gray[100]}">南港區到 2028 年：規劃／興建中 2 案、合計約 45 個樓層；另有 9 張 114–115 年建照。來源：FUNRAISE 未來開發資料庫 · 臺北市建照存根。</div></div>
  </div>
</div>` + tail();

// C · 自適應（Main）：one system, three densities — a tweak chip switches the state.
const adaptiveBody = `
<div style="position:relative;width:1440px;height:900px;overflow:hidden;${bg('map-city.jpg')};font-family:${FONT}">
  <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(3,7,18,.55) 0%, rgba(3,7,18,0) 22%, rgba(3,7,18,0) 70%, rgba(3,7,18,.5) 100%)"></div>
  <div style="position:absolute;left:16px;right:16px;top:12px;display:flex;align-items:center;justify-content:space-between;gap:16px">${brand()}<sc-if value="{{showLens}}" hint-placeholder-val="{{ true }}">${lensPills(3)}</sc-if><div style="display:flex;align-items:center;gap:10px"><div style="display:flex;align-items:center;gap:2px;padding:2px;border-radius:6px;background:rgba(30,41,57,.8);border:1px solid rgba(74,85,101,.65)"><div style="padding:5px 10px;border-radius:4px;font-size:12px;font-weight:500;line-height:16px;color:{{c0}};background:{{b0}}">沉浸</div><div style="padding:5px 10px;border-radius:4px;font-size:12px;font-weight:500;line-height:16px;color:{{c1}};background:{{b1}}">平衡</div><div style="padding:5px 10px;border-radius:4px;font-size:12px;font-weight:500;line-height:16px;color:{{c2}};background:{{b2}}">標註</div></div><sc-if value="{{showStatus}}" hint-placeholder-val="{{ true }}">${status()}</sc-if></div></div>
  ${readout('台北市 · 商辦 156 · 規劃中 13 · 都更 81 · 法人交易 33 · 公建 25', '25.045N 121.555E · 9.5 km · -56°')}
  <sc-if value="{{imm}}" hint-placeholder-val="{{ false }}">
    ${edgeTab('left', 380, '圖層', '6/11')}${edgeTab('right', 380, '面板', '4')}
    ${leader(700, 455, 820, 380, T.orange[300])}${mapLabel(820, 364, '信義計畫區', 'A 辦 18 棟 · 均租 3,120/坪', T.orange[300])}
  </sc-if>
  <sc-if value="{{bal}}" hint-placeholder-val="{{ true }}">
    <div style="position:absolute;left:16px;top:100px;width:220px;padding:10px 12px;${panel}">${eyebrow('圖層 · 6 / 11')}${['商辦存量 156', '未來供給 13', '都更單元 81', '上市櫃交易 33', '企業遷徙 82', '捷運路網 100'].map((l, i) => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px;color:${T.gray[200]}"><span style="width:10px;height:10px;border-radius:${i === 1 ? '2px' : '50%'};background:${[T.orange[300], T.blue[300], '#C4B5FD', T.orange[400], T.orange[500], T.gray[400]][i]}"></span>${l}</div>`).join('')}<div style="margin-top:6px;font-size:10.5px;color:${T.gray[500]}">相機移動 4 秒後自動收合 → 邊緣把手</div></div>
    <div style="position:absolute;right:16px;top:100px;width:300px;padding:12px 14px;${panel}">${eyebrow('城市治理鏡 · 首長戰情室', T.blue[300])}<div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:8px;margin-top:8px">${kpi('11', '興建中公共建設')}${kpi('82', '跨區遷入企業 · 07 月', true)}${kpi('2,310', '都更地區／單元')}${kpi('7', '產業園區（雙北）')}</div><div style="margin-top:10px">${eyebrow('各區都更件數')}<div style="margin-top:6px">${bars()}</div></div></div>
    ${leader(700, 455, 760, 520, T.orange[300])}${mapLabel(760, 504, '信義計畫區', 'A 辦 18 棟', T.orange[300])}
    ${timeline(16, 836, 560, true)}
  </sc-if>
  <sc-if value="{{ann}}" hint-placeholder-val="{{ false }}">
    <div style="position:absolute;left:16px;top:100px;width:220px;padding:10px 12px;${panel}">${eyebrow('圖層 · 11 / 11')}${['商辦存量 156', '未來供給 13', '建照 98', '都更單元 81', '重劃／區段徵收 73', '上市櫃交易 33', '企業遷徙 82', '公共建設 25', '產業園區 7', '商圈行情 7', '捷運路網 100'].map((l) => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11.5px;color:${T.gray[200]}"><span style="width:8px;height:8px;border-radius:50%;background:${T.blue[400]}"></span>${l}</div>`).join('')}</div>
    <div style="position:absolute;right:16px;top:100px;width:340px;bottom:96px;display:flex;flex-direction:column;gap:8px;padding:12px 14px;${panel}">${eyebrow('資料面板 · 標註模式', T.blue[300])}<div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:8px">${kpi('116 億', '上市櫃不動產交易 · 12 月', true)}${kpi('33', '公告筆數')}${kpi('2.63%', '商辦毛租金收益率')}${kpi('1,913', '商圈均租 元/坪/月')}</div>${eyebrow('各區都更件數')}${bars()}${eyebrow('來源與工具呼叫')}${toolRow('mops-property.search', 'district=信義區', '3 筆 · 412 ms')}${toolRow('actual-price-sale.aggregate', 'city=台北市', '12 區 · 382 ms')}${toolRow('company-registry.aggregate', 'month=2026-07', '82 家 · 290 ms')}</div>
    ${leader(700, 455, 560, 380, T.orange[300])}${mapLabel(330, 364, '信義計畫區', 'A 辦 18 棟 · 均租 3,120/坪', T.orange[300], '1')}
    ${leader(520, 560, 460, 620, T.orange[400])}${mapLabel(300, 604, '富邦金 · 基隆路商辦', '276 萬', T.orange[400], '2')}
    ${leader(880, 600, 900, 690, '#C4B5FD')}${mapLabel(900, 674, '臺北機廠 都更', '20 ha · 政府主導', '#C4B5FD', '3')}
    ${leader(420, 300, 340, 250, T.blue[300])}${mapLabel(210, 234, '中山區', '遷入 21 家 · 7 月', T.blue[300], '4')}
    ${timeline(16, 836, 1060, true)}
  </sc-if>
  <sc-if value="{{imm}}" hint-placeholder-val="{{ false }}">${answer('切到城市治理鏡：藍色虛線是興建中捷運，橘色弧線是 7 月遷入台北各區的 82 家公司。', 640, 90)}</sc-if>
  <sc-if value="{{bal}}" hint-placeholder-val="{{ true }}">${answer('哪些公司最近遷入中山區？——21 家，來自新北 12、桃園 4、台中 3、其他 2；最大：○○科技（資本額 3.2 億）。', 640, 90)}</sc-if>
  ${capsule('對城市說話：「哪些公司最近遷入中山區」「切到標註模式」…')}
</div>`;
const adaptiveScript = `
<script data-dc-script data-props='{"density":{"editor":"enum","options":["沉浸","平衡","標註"],"default":"平衡","section":"HUD"}}'>
class Component extends DCLogic {
  renderVals() {
    const d = this.props.density ?? '平衡';
    const on = '${T.gray[100]}', off = 'transparent', onC = '${T.gray[950]}', offC = '${T.gray[300]}';
    const i = d === '沉浸' ? 0 : d === '標註' ? 2 : 1;
    return { imm: i === 0, bal: i === 1, ann: i === 2, showLens: i !== 0, showStatus: i !== 0,
      b0: i === 0 ? on : off, b1: i === 1 ? on : off, b2: i === 2 ? on : off, c0: i === 0 ? onC : offC, c1: i === 1 ? onC : offC, c2: i === 2 ? onC : offC };
  }
}
</script>`;
const adaptive = head('自適應') + adaptiveBody + tail(adaptiveScript);

// Tokens · mapping sheet PickPeak DS → 睿鏡 HUD
const sw = (hex, name, note = '') => `<div style="display:flex;flex-direction:column;gap:6px;min-width:0"><div style="height:44px;border-radius:6px;background:${hex};border:1px solid rgba(255,255,255,.08)"></div><div style="font-size:11px;color:${T.gray[100]};font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div><div style="font-family:${MONO};font-size:10px;color:${T.gray[400]}">${hex}${note ? ' · ' + note : ''}</div></div>`;
const tokens = head('Tokens') + `<div style="position:relative;width:1440px;min-height:760px;padding:32px 40px 40px;background:${T.gray[950]};font-family:${FONT};display:flex;flex-direction:column;gap:22px">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:24px"><div>${eyebrow('PickPeak Design System → 睿鏡 HUD 對照表', T.blue[300])}<div style="margin-top:6px;font-size:22px;font-weight:700;color:${T.gray[50]}">品牌層不變，資料層讓位</div><div style="margin-top:4px;font-size:13px;color:${T.gray[400]};max-width:760px">介面（面板、按鈕、選取、AI）只用 PickPeak 的藍本藍、人文橘、建構灰與 The Glow；圖層資料色是獨立的類別色盤，刻意避開選址藍，讓「被選到的東西」永遠一眼可辨。來源：VI Guideline A/04 品牌色彩、A/05 標準字體；pickpeak.ai 主題變數。</div></div>${provenance(3, 0).replace('3 MCP 呼叫 · 0 ms · 來源可回查', 'Figma q5gwnLV1… · pickpeak.ai theme · solutions.pickpeak.ai')}</div>
  <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:24px">
    <div style="display:flex;flex-direction:column;gap:10px">${eyebrow('藍本藍 · 介面主色（選取、啟用、AI、連結）')}<div style="display:grid;grid-template-columns:repeat(6, minmax(0, 1fr));gap:8px">${sw(T.blue[100], '透視藍 100', '面板淺字')}${sw(T.blue[300], '300', '標題／提示')}${sw(T.blue[400], '400', '啟用鏡')}${sw(T.blue[500], '選址藍 500', '主按鈕')}${sw(T.blue[700], '都市藍 700', 'hover')}${sw(T.blue[900], '藍礦藍 900', '深底')}</div></div>
    <div style="display:flex;flex-direction:column;gap:10px">${eyebrow('人文橘 · 次核心（金額、熱度、人為活動）')}<div style="display:grid;grid-template-columns:repeat(6, minmax(0, 1fr));gap:8px">${sw(T.orange[100], '光跡橘 100', '暖字')}${sw(T.orange[300], '生活橘 300', '商辦存量')}${sw(T.orange[400], '400', '上市櫃交易')}${sw(T.orange[500], '500', '企業遷徙弧')}${sw(T.orange[600], '暖域橘 600', '高熱')}${sw(T.orange[700], '回鳴橘 700', '極高')}</div></div>
    <div style="display:flex;flex-direction:column;gap:10px">${eyebrow('建構灰 · 夜間 HUD 表面（原構灰 80% + 模糊）')}<div style="display:grid;grid-template-columns:repeat(6, minmax(0, 1fr));gap:8px">${sw(T.gray[950], '950', '地圖底')}${sw(T.gray[900], '900', '資料欄')}${sw(T.gray[800], '原構灰 800', '面板')}${sw(T.gray[600], '幹道灰 600', '邊框')}${sw(T.gray[400], '街廓灰 400', '次要字')}${sw(T.gray[100], '留白灰 100', '主要字')}</div></div>
    <div style="display:flex;flex-direction:column;gap:10px">${eyebrow('The Glow · 只給 AI（決策之心、指令膠囊、進行中的呼叫）')}<div style="display:flex;gap:16px;align-items:center"><div style="flex:1;height:64px;border-radius:32px;background:rgba(30,41,57,.86);border:1px solid rgba(147,220,230,.35);box-shadow:0 0 0 1px rgba(22,164,192,.25), 0 10px 30px -10px ${T.glowA}, 0 10px 30px -14px ${T.glowB};display:flex;align-items:center;gap:12px;padding:0 14px">${orb()}<span style="font-size:13px;color:${T.gray[300]}">glow-a ${T.glowA} · glow-b ${T.glowB} · blur 8 · y 6</span></div><div style="font-size:11px;color:${T.gray[400]};max-width:220px">其他元件不發光——光就是「這裡有 AI 在工作」的訊號。</div></div></div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:24px">
    <div style="padding:14px 16px;border-radius:8px;background:${T.gray[900]};border:1px solid ${T.gray[700]}">${eyebrow('字體 · A/05')}<div style="margin-top:8px;font-size:22px;font-weight:700;color:${T.gray[50]}">中文 思源黑體 <span style="font-weight:400;color:${T.gray[300]}">Regular / Medium / Bold</span></div><div style="margin-top:4px;font-size:18px;color:${T.gray[100]}">Inter for UI · <span style="font-family:${MONO};font-size:15px;color:${T.blue[300]}">ui-monospace 25.0375N 4,526</span></div><div style="margin-top:8px;font-size:11px;color:${T.gray[400]}">Neulis Neue 僅限對外傳播（Typekit）；HUD 數字用等寬字，禁止拉伸、陰影與漸層字。</div></div>
    <div style="padding:14px 16px;border-radius:8px;background:${T.gray[900]};border:1px solid ${T.gray[700]}">${eyebrow('形狀與密度')}<div style="margin-top:8px;display:flex;gap:8px;align-items:flex-end"><div style="width:44px;height:28px;border-radius:4px;background:${T.gray[700]}"></div><div style="width:44px;height:32px;border-radius:6px;background:${T.gray[700]}"></div><div style="width:44px;height:36px;border-radius:8px;background:${T.gray[700]}"></div><div style="width:64px;height:40px;border-radius:999px;background:${T.gray[700]}"></div></div><div style="margin-top:8px;font-family:${MONO};font-size:10.5px;color:${T.gray[400]}">radius sm 4 · md 6 · lg 8 · pill 999 · 控制項 32 / 36 / 40 px</div><div style="margin-top:6px;font-size:11px;color:${T.gray[400]}">三種密度共用同一套元件，只改「顯示幾個、放哪裡、多久收合」。</div></div>
    <div style="padding:14px 16px;border-radius:8px;background:${T.gray[900]};border:1px solid ${T.gray[700]}">${eyebrow('圖層資料色 · 提案（待 DS owner 確認）')}<div style="margin-top:8px;display:flex;flex-direction:column;gap:5px;font-size:11.5px;color:${T.gray[200]}">${[['商辦存量', T.orange[300]], ['未來供給（幽靈）', T.blue[300]], ['建照脈衝', T.blue[400]], ['都更單元', '#C4B5FD'], ['上市櫃交易', T.orange[400]], ['企業遷徙', T.orange[500]], ['公共建設', T.blue[100]], ['產業園區', '#6EE7B7']].map(([n, c]) => `<div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:${c}"></span>${n}<span style="margin-left:auto;font-family:${MONO};font-size:10px;color:${T.gray[500]}">${c}</span></div>`).join('')}</div></div>
  </div>
</div>` + tail();

// 現況：the app as shipped today (screenshot), for side-by-side comparison
const current = head('現況') + `<div style="position:relative;width:1440px;height:900px;overflow:hidden;background:${T.gray[950]} url(./current.jpg) center/cover no-repeat;font-family:${FONT}">
  <div style="position:absolute;left:16px;bottom:16px;padding:8px 12px;border-radius:6px;background:rgba(3,7,18,.7);border:1px solid rgba(74,85,101,.6);font-size:12px;color:${T.gray[200]}">v2 現況（2026-09-14）：金色系自訂 HUD，左右面板＋底部對話區固定佔畫面約 45%。</div>
</div>` + tail();

fs.writeFileSync('Main.dc.html', adaptive); fs.writeFileSync('Immersive.dc.html', immersive); fs.writeFileSync('Annotated.dc.html', annotated); fs.writeFileSync('Tokens.dc.html', tokens); fs.writeFileSync('Current.dc.html', current);
const canvas = {
  artboards: [
    { file: 'Current.dc.html', title: '現況 · v2 (2026-09-14)', x: 0, y: 0, w: 1440, h: 900 },
    { file: 'Main.dc.html', title: '方向 C · 自適應（推薦）— 切換上方「density」看三種密度', x: 1560, y: 0, w: 1440, h: 900 },
    { file: 'Immersive.dc.html', title: '方向 A · 沉浸', x: 0, y: 1060, w: 1440, h: 900 },
    { file: 'Annotated.dc.html', title: '方向 B · 標註／分析', x: 1560, y: 1060, w: 1440, h: 900 },
    { file: 'Tokens.dc.html', title: 'PickPeak DS → 睿鏡 HUD 對照', x: 0, y: 2120, w: 1440, h: 780 },
  ],
  annotations: [
    { id: 'note-current', x: 0, y: -170, w: 520, text: '現況問題：面板與對話區固定佔畫面約 45%，地圖上的標註常被擋住；金色系與 PickPeak 品牌無關聯。' },
    { id: 'note-c', x: 1560, y: -170, w: 640, text: '方向 C · 自適應（推薦）：同一套元件，三種密度（沉浸／平衡／標註）。相機移動時面板自動收成邊緣把手；任何卡片可「釘」到地圖物件上變成帶引線的標註；標籤依重要度與縮放預算顯示。取捨：需要一個「密度」控制與收合動效的實作。' },
    { id: 'note-a', x: 0, y: 890, w: 560, text: '方向 A · 沉浸（天眼牆／語音優先）：只留品牌、鏡、指令膠囊；資料以脈絡卡與世界內標籤呈現，回答像字幕。最適合接待中心與大螢幕。取捨：一眼可見的資料最少，要問才會出現。' },
    { id: 'note-b', x: 1560, y: 890, w: 560, text: '方向 B · 標註／分析（戰情室）：地圖 74% + 固定資料欄 26%；地圖標註編號 ①–④ 與資料欄卡片對應，圖面不再被面板壓住。取捨：地圖變小，適合桌機分析與簡報，不適合沉浸。' },
    { id: 'note-tokens', x: 0, y: 2120 - 170, w: 620, text: 'PickPeak DS 套用原則：介面只用藍本藍／人文橘／建構灰／The Glow（發光只給 AI）；圖層資料色是獨立類別盤、刻意避開選址藍。字體 思源黑體 + Inter，數字等寬。圖層色盤需 DS owner（Violet）確認。' },
  ],
  launch: { view: 'canvas' },
};
fs.writeFileSync('canvas.json', JSON.stringify(canvas, null, 2) + '\n');
console.log('artboards written', fs.readdirSync('.').filter(f => f.endsWith('.dc.html')));
