// Built-in (rule-based) agent: intents → simulated MCP tool calls against the embedded FUNRAISE snapshot → camera/layer actions.
// Tool names and parameter shapes mirror the real "Funraise Data Team" MCP so the same plans can be executed live in Claude mode.
import { fmtInt, fmtMoney } from '../layers/funraise.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const norm = s => (s || '').replace(/[\s,，。！？!?、「」『』()（）]/g, '').replace(/臺/g, '台').toLowerCase();
const has = (s, re) => re.test(s);
const distM = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), (a[1] - b[1]) * 110540);

export const LENSES = {
  investor: { name: '投資人鏡', short: '投資', color: '#FF7A59', layers: ['mops', 'stock', 'heat', 'mrt', 'infra'], who: '壽險／REITs／家族辦公室／私募',
    suggest: ['最近一年信義區上市公司買了什麼', '比較信義基隆商圈和民生敦北商圈的租金', '環繞模式 台北101', '南港最近的資本流向', '切換開發商視角'] },
  developer: { name: '開發商鏡', short: '開發', color: '#B48CFF', layers: ['renewal', 'zones', 'licenses', 'future', 'mrt', 'infra', 'parcels'], who: '建商／都更實施者／地主整合／建經',
    suggest: ['模擬兒福B1-2及B3-2都更', '信義區有哪些都更單元', '這裡容積率多少', '2028 年南港會長出什麼', '帶我去臺北機廠'] },
  occupier: { name: '企業選址鏡', short: '選址', color: '#F2B84B', layers: ['stock', 'heat', 'mrt', 'future', 'parks'], who: '企業 CFO／總務／人資（PickPeak 核心客群）',
    suggest: ['帶我去內湖科技園區', '信義區有哪些 A 辦', '台北101的租戶是誰', '街景模式看南港軟體園區', '幫我做這棟的 DD memo'] },
  city: { name: '城市治理鏡', short: '城市', color: '#4C8DFF', layers: ['infra', 'moves', 'renewal', 'zones', 'parks', 'mrt'], who: '都發局／地政局／產發局／捷運局／首長戰情室',
    suggest: ['哪些公司最近遷入中山區', '興建中的公共建設有哪些', '都更案最多的是哪個區', '顯示重劃區', '時光模式'] },
  research: { name: '學研鏡', short: '學研', color: '#58C97B', layers: ['heat', 'stock', 'renewal', 'mrt', 'zones'], who: '政大地政／台大城鄉／北大不動產 · AI Raiser',
    suggest: ['台北市各區成交量排名', '比較大安區和中山區的房價', '回到 2015 年', '簡報現在看到的', '全台'] },
};
const LAYER_WORDS = [
  ['stock', /商辦|大樓|存量|辦公樓|a辦|b辦|廠辦/], ['future', /未來|規劃中|興建中|新供給|供給/], ['licenses', /建照/], ['renewal', /都更|更新單元/], ['zones', /重劃|區段徵收/],
  ['mops', /上市|上櫃|法人|資產交易|mops|公開資訊/], ['moves', /遷徙|遷入|搬遷|搬進|企業流動|流動/], ['infra', /公共建設|基礎設施|捷運工程|場館|轉運|環狀線/], ['parks', /產業園區|工業區|園區/], ['heat', /商圈|行情|熱度|熱區/], ['mrt', /捷運|路網/],
];
// alias → [lon, lat, range m]
const ALIASES = { '信義計畫區': [121.5670, 25.0360, 2600], '內科': [121.5750, 25.0790, 3200], '內湖科技園區': [121.5750, 25.0790, 3200], '南軟': [121.6126, 25.0576, 1800], '南港軟體園區': [121.6126, 25.0576, 1800], '北車': [121.5170, 25.0478, 1500], '台北車站': [121.5170, 25.0478, 1500], '東區': [121.5490, 25.0415, 1800], '忠孝敦化': [121.5490, 25.0415, 1800], '大直': [121.5470, 25.0800, 2400], '中山北路': [121.5230, 25.0600, 2200], '台北101': [121.5645, 25.0339, 700], '101': [121.5645, 25.0339, 700], '大安森林公園': [121.5360, 25.0300, 2000], '西門町': [121.5070, 25.0430, 1600], '板橋': [121.4630, 25.0130, 5000], '新板特區': [121.4640, 25.0140, 1600], '南港': [121.6070, 25.0550, 5000], '內湖': [121.5880, 25.0690, 6500], '松山機場': [121.5520, 25.0690, 2600], '臺北機廠': [121.5610, 25.0470, 1400], '台北機廠': [121.5610, 25.0470, 1400], '雙北': [121.5300, 25.0400, 40000], '台北': [121.5450, 25.0500, 20000], '台北市': [121.5450, 25.0500, 20000] };

export class Agent {
  constructor(map, data, ui) { this.map = map; this.d = data; this.ui = ui; this.lens = 'occupier'; this.busy = false; }
  get year() { return this.map.year; }
  districtCentroid(name) { if (!name) return null; return this.map.districtCentroid(name); }
  districtOfText(text) { const m = text.match(/(信義|大安|中山|松山|內湖|南港|中正|萬華|大同|士林|北投|文山|板橋|新莊|三重|中和|永和|新店|汐止|土城|蘆洲|淡水|林口)(區)?/); return m ? m[1] + '區' : null; }
  currentDistrict() { const d = this.map.districtAtCamera(); return d ? d.name : null; }
  resolvePlace(text) {
    const t = norm(text);
    const clean = t.replace(/(帶我去|飛到|前往|去|看看|看一下|找到|定位|環繞模式|環繞|街景模式|街景|goto|flyto|orbit|street|的租戶是誰|的歷史成交|的租戶|租戶|歷史成交|是誰)/g, '');
    const tryList = (arr, kind, range, pitch) => { let best = null; for (const it of arr || []) { const n = norm(it.name || it.main); if (!n || !it.lat) continue; if (t.includes(n) || (clean.length >= 2 && n.includes(clean))) { if (!best || n.length > norm(best.name).length) best = it; } } return best ? { name: best.name, lon: best.lon, lat: best.lat, range, pitch, kind, item: best } : null; };
    const bld = tryList(this.d.buildings, 'stock', 520, -32); if (bld && (clean.length >= 4 || t.includes(norm(bld.name)))) return bld;
    for (const [k, v] of Object.entries(ALIASES)) { if (t.includes(norm(k))) return { name: k, lon: v[0], lat: v[1], range: v[2], kind: 'alias' }; }
    return bld || tryList(this.d.future_dev, 'future', 600, -32) || tryList(this.d.industrial_parks, 'parks', 2400) || tryList(this.d.public_infras, 'infra', 1800) || tryList(this.d.development_zones, 'zones', 1800) || tryList(this.d.business_areas, 'heat', 2600)
      || tryList(this.map.basemap.mrt_stations, 'mrt', 1100) || (() => { const dn = this.districtOfText(text); const c = this.districtCentroid(dn); return c ? { name: dn, lon: c[0], lat: c[1], range: 6500, kind: 'district' } : null; })();
  }
  yearsFromText(text) { const m = text.match(/(20\d{2})/); if (m) return +m[1]; const r = text.match(/(1[0-2]\d)年/); return r ? +r[1] + 1911 : null; }
  monthsFromText(text) { if (/半年/.test(text)) return 6; if (/一年|12個月|十二個月|過去一年|最近一年/.test(text)) return 12; if (/兩年|2年/.test(text)) return 24; const m = text.match(/(\d+)\s*個月/); return m ? +m[1] : null; }
  async call(turn, tool, params, fn) { const card = this.ui.toolStart(turn, tool, params); await sleep(rnd(160, 520)); const res = fn(); this.ui.toolDone(card, res.summary); return res.value; }
  async handle(text) {
    if (!text || this.busy) return; this.busy = true; const t = norm(text); this.ui.userTurn(text); const a = this.ui.agentTurn();
    try {
      if (has(t, /^(幫助|help|你會什麼|可以問什麼)/)) return this.finish(a, '我聽得懂：「模擬○○都更」、「沉浸／平衡／標註模式」、「釘在地圖上」、「帶我去 ○○」、「切換 投資人／開發商／選址／城市／學研 視角」、「顯示／隱藏 都更／建照／上市公司交易」、「這裡容積率多少」、「2028 年南港會長出什麼」、「最近半年信義區上市公司買了什麼」、「比較 A 商圈和 B 商圈的租金」、「哪些公司遷入中山區」、「環繞／街景／俯視／全台／時光模式」、「夜視／熱感／藍圖」。或按「▶ 場景」看電影式導覽。');
      if (has(t, /沉浸|immersive|乾淨一點|清爽|只留地圖/)) { this.ui.setDensity('immersive'); return this.finish(a, '切到沉浸模式：只留地圖、鏡與指令；面板收成左右邊緣的把手，回答改用字幕。'); }
      if (has(t, /標註模式|annotated|多一點資料|資料模式|全部展開|分析模式/)) { this.ui.setDensity('annotated'); return this.finish(a, '切到標註模式：資料欄全開，接下來亮起的物件會在地圖上加編號，並對應左側「地圖標註」卡片。'); }
      if (has(t, /平衡模式|balanced|一般模式|預設密度/)) { this.ui.setDensity('balanced'); return this.finish(a, '切回平衡模式。'); }
      if (has(t, /模擬.*都更|都更.*(模擬|試算|量體|可以蓋|能蓋)|renewal.*sim/)) return this.renewalSim(text, a);
      if (has(t, /^釘|釘在地圖|釘選|pin/)) { const s = this.map.selected; if (!s) return this.finish(a, '先點選一個物件，再說「釘在地圖上」。'); this.ui.pin(s.item, s.layer); return this.finish(a, `已把「${s.item.name || s.item.company_name || s.key}」釘在地圖上，卡片會跟著它移動。`); }
      if (has(t, /夜視|night/)) { this.ui.setSensor('night'); return this.finish(a, '切到夜視感測。'); }
      if (has(t, /熱感|熱像|thermal/)) { this.ui.setSensor('thermal'); return this.finish(a, '切到熱感測：暖色代表高單價／高熱度。'); }
      if (has(t, /藍圖|blueprint/)) { this.ui.setSensor('blueprint'); return this.finish(a, '切到藍圖感測。'); }
      if (has(t, /一般感測|正常畫面|normal|關掉感測|關閉感測/)) { this.ui.setSensor('normal'); return this.finish(a, '回到一般畫面。'); }
      if (has(t, /分享|複製.*連結|這個視角的連結|share/i)) { this.ui.shareView && this.ui.shareView(); return this.finish(a, '已把這個視角（相機、鏡、年份、主題、圖層）做成連結並複製；貼給同事打開就是同一個畫面。'); }
      if (has(t, /日照|陰影|影子|黃金時刻|golden|夕陽|正午|清晨|暮色|太陽/)) {
        if (has(t, /關|平光|取消|off/i)) { this.ui.setSun(null); return this.finish(a, '日照關閉，回到平光。'); }
        if (has(t, /一天|播放|掃過|整天|sweep/i)) { this.ui.sweepSun(); return this.finish(a, '播放一天：太陽從 06:30 走到 18:15，看陰影掃過街廓——哪些基地下午還有光、哪些被高樓遮住。'); }
        const hm = t.match(/(\d{1,2})\s*[:：點時]\s*(\d{2})?/); const preset = /清晨|日出|dawn/i.test(t) ? 6.5 : /上午|早上|morning/i.test(t) ? 9 : /正午|中午|noon/i.test(t) ? 12 : /暮色|傍晚|dusk|日落/i.test(t) ? 18.25 : /黃金|golden|夕陽/i.test(t) ? 17 : null;
        const h = hm ? Math.min(19.5, Math.max(5.5, +hm[1] + (hm[2] ? +hm[2] / 60 : 0))) : (preset ?? 17); const set = this.ui.setSun(h); const alt = this.map.lighting && this.map.lighting.sunAltitude();
        return this.finish(a, `切到 ${String(Math.floor(set)).padStart(2, '0')}:${String(Math.round((set % 1) * 60)).padStart(2, '0')} 的日照${alt != null ? `（太陽高度約 ${alt}°）` : ''}：每棟量體都投影到鄰地，拉開「都更模擬」可直接看新量體的陰影落在哪。想看整天變化就說「播放一天的陰影」。`);
      }
      if (has(t, /日間|白天|關掉夜間|日景/)) { this.ui.setNight(false); return this.finish(a, '切到日間影像。'); }
      if (has(t, /夜間|夜景|夜色/)) { this.ui.setNight(true); return this.finish(a, '切到夜間色調。'); }
      if (has(t, /環繞|orbit|繞一圈|轉一圈/)) { const p = this.resolvePlace(text); const c = p || this.map.center(); this.map.orbit(c.lon, c.lat, p && p.kind === 'stock' ? 700 : (p ? Math.min(p.range || 1400, 2200) : 1400)); this.ui.setMode('orbit'); return this.finish(a, `進入環繞模式${p ? '，鎖定 ' + p.name : ''}。拖曳可隨時接手。`); }
      if (has(t, /街景|street|走進|地面|路面|走到/)) { const p = this.resolvePlace(text); const c = p || this.map.center(); this.map.street(c.lon, c.lat); this.ui.setMode('street'); return this.finish(a, `切到街景視角${p ? '：' + p.name : ''}。3D 建物來自 OpenStreetMap 樓高／樓層；正式版可一鍵換成 Google 相片級 3D Tiles。`); }
      if (has(t, /俯視|全景|拉遠|城市視角|city|回到上空|上空/)) { this.map.city(); this.ui.setMode('city'); return this.finish(a, '拉回城市俯視。'); }
      if (has(t, /全台|台灣全圖|globe|地球/)) { this.map.globe(); this.ui.setMode('globe'); return this.finish(a, '拉到全台。示範資料以雙北為主；底層資料庫（實價登錄、公司登記、都更、產業園區）為全國性。'); }
      if (has(t, /時光|time.?lapse|快轉|時間軸|回到(19|20)\d{2}|回到\d{2,3}年/)) { const y = this.yearsFromText(text); if (y) { this.map.setYear(y); return this.finish(a, `時間軸移到 ${y} 年：${y < new Date().getFullYear() ? '只顯示當年已存在的大樓與當年前後的事件' : '規劃中建案隨完工年長高並變為實體'}。`); } this.ui.setMode('timelapse'); return this.finish(a, '啟動時光模式：從 2012 年實價登錄起點快轉到 2030 年的供給 pipeline。God\'s Eye View 只有「現在」，FUNRAISE 的護城河在「過去與未來」。'); }
      const lensHit = has(t, /投資|資本|investor|壽險|reits/) ? 'investor' : has(t, /開發商|建商|developer|都更整合|開發視角|開發鏡/) ? 'developer' : has(t, /選址|總務|occupier|租戶視角|企業視角|選址鏡/) ? 'occupier' : has(t, /政府|城市|市府|治理|city|首長/) ? 'city' : has(t, /學研|研究|學術|老師|research|校園/) ? 'research' : null;
      if (lensHit && has(t, /視角|鏡|切換|模式|lens|角度|給我看/)) { this.setLens(lensHit); return this.finish(a, `切換到${LENSES[lensHit].name}（${LENSES[lensHit].who}）。圖層、KPI 與建議指令已重新配置。`); }
      const toggle = has(t, /隱藏|關閉|關掉|拿掉|hide/) ? false : has(t, /顯示|打開|開啟|只看|show|疊上|加上/) ? true : null;
      if (toggle !== null) { const hits = LAYER_WORDS.filter(([k, re]) => re.test(t)).map(([k]) => k); if (hits.length) { if (has(t, /只看/)) { for (const k of this.map.layerKeys) this.ui.setLayer(k, hits.includes(k) || k === 'mrt'); } else hits.forEach(k => this.ui.setLayer(k, toggle)); return this.finish(a, `${toggle ? '顯示' : '隱藏'}圖層：${hits.map(k => this.map.layerName(k)).join('、')}。`); } }
      if (has(t, /容積|建蔽|使用分區|分區|zoning|能蓋多高|可建/)) return this.zoning(text, a);
      if (has(t, /供給|會長出|蓋什麼|新建案|pipeline|規劃中|興建中|建照/)) return this.supply(text, a);
      if (has(t, /上市|上櫃|法人|買了|賣了|資產交易|mops|取得|處分|資本流/)) return this.deals(text, a);
      if (has(t, /都更|更新單元|危老/)) return this.renewal(text, a);
      if (has(t, /比較|比一比|vs|對比|排名|排行/)) return this.compare(text, a);
      if (has(t, /遷入|遷徙|搬進|搬到|企業流動|增資|新設/)) return this.moves(text, a);
      if (has(t, /租戶|誰在|哪些公司在|進駐/)) return this.tenants(text, a);
      if (has(t, /歷史|成交紀錄|實價|成交價|租金紀錄/)) return this.history(text, a);
      if (has(t, /dd|盡職|生命週期|memo|備忘/)) return this.dd(text, a);
      if (has(t, /簡報|總結|摘要|現在看到|這裡有什麼|brief|summary|狀況/)) return this.brief(a);
      const p = this.resolvePlace(text); if (p) return this.goto(p, a);
      await this.finish(a, `這個原型還聽不懂「${text}」。試試：${LENSES[this.lens].suggest.slice(0, 3).map(s => '「' + s + '」').join('、')}，或說「幫助」。`);
    } catch (err) { console.error(err); await this.finish(a, '處理時出了點問題。' + (err && err.message ? ' ' + err.message : '')); }
    finally { this.busy = false; }
  }
  async finish(turn, text, refs) { await this.ui.type(turn, text, refs); this.busy = false; }
  setLens(id) { this.lens = id; this.ui.applyLens(id); }
  async goto(p, a) {
    const pitch = p.pitch ?? (this.map.mode === 'street' ? -14 : this.map.mode === 'orbit' ? -35 : ((p.range || 2000) < 1000 ? -35 : -50));
    this.map.flyTo(p.lon, p.lat, { range: p.range || 2000, pitch });
    const lines = [`飛往 ${p.name}。`];
    if (p.kind === 'stock') { const b = p.item; await this.call(a, 'buildings.get_building', { id: b.id }, () => ({ summary: '1 棟', value: b })); this.map.pulse('stock:' + b.id); this.ui.select(b, 'stock'); lines.push(`${b.name}：${b.grade || '?'} 級商辦，${b.floor_above || '?'}F／地下 ${b.floor_below || '?'}F，${b._built || '—'} 年取得使照${b.mrt && b.mrt[0] ? `，距 ${b.mrt[0].station_name} ${b.mrt[0].distance} m` : ''}${b.certifications && b.certifications.length ? `，認證：${b.certifications.map(c => c.type + (c.grade ? '·' + c.grade : '')).join('、')}` : ''}。`); }
    else if (p.kind === 'future') { const f = p.item; this.map.pulse('future:' + f.id); this.ui.select(f, 'future'); lines.push(`${f.name}（${f.developer || '—'}）預計 ${f._year} 完工，${f.floors_above || '?'}F。把時間軸拉到 ${f._year} 會看到它長成實體。`); }
    else if (p.kind === 'heat') { const ar = p.item; await this.call(a, 'areas.get_area', { id: ar.id }, () => ({ summary: '商圈分析', value: ar })); this.ui.select(ar, 'heat'); if (ar.market_price) lines.push(`${ar.name}：平均租金 ${fmtInt(ar.market_price.actual_rent_avg)} 元/坪/月（YoY ${(ar.market_price.actual_rent_yoy * 100).toFixed(1)}%），平均售價 ${fmtInt(ar.market_price.actual_sale_avg / 1e4)} 萬/坪。${ar.pp_insight || ''}`); }
    else if (p.kind === 'district' || p.kind === 'alias') { const dn = this.districtOfText(p.name) || this.currentDistrict(); const st = (this.d.district_sales && this.d.district_sales['台北市'] || []).find(x => x.district === dn); if (st) { await this.call(a, 'actual-price-sale.aggregate_sales_by_district', { city: '台北市' }, () => ({ summary: `${(this.d.district_sales['台北市'] || []).length} 區`, value: st })); lines.push(`${dn} 實價登錄累計 ${fmtInt(st.transaction_count)} 筆成交，中位數總價 ${fmtMoney(st.median_price)}。`); } const c = this.map.countInView(); lines.push(`視野內：商辦 ${c.stock} 棟、規劃中 ${c.future}、都更 ${c.renewal}、上市櫃交易 ${c.mops}、公共建設 ${c.infra}。`); }
    else if (p.kind === 'mrt') { const near = (this.d.buildings || []).filter(b => b.lat && distM([b.lon, b.lat], [p.lon, p.lat]) < 500); await this.call(a, 'buildings.search_buildings', { mrt_station: p.name, limit: 50 }, () => ({ summary: `${near.length} 棟（500m）`, value: near })); near.forEach(b => this.map.pulse('stock:' + b.id, 5000)); lines.push(`${p.name} 500 公尺內有 ${near.length} 棟商辦在資料集中${near.length ? '：' + near.slice(0, 5).map(b => b.name).join('、') : ''}。`); }
    else if (p.kind === 'parks') { const pk = p.item; await this.call(a, 'industrial-parks.get_industrial_park', { id: pk.id }, () => ({ summary: `${pk.area_ha} ha`, value: pk })); this.ui.select(pk, 'parks'); lines.push(`${pk.name}：${pk.park_type || ''}，${pk.area_ha} 公頃，${pk.status || ''}，主管機關 ${pk.manager || '—'}。`); }
    else if (p.kind === 'infra') { const pi = p.item; this.ui.select(pi, 'infra'); lines.push(`${pi.name}：${pi.status === 'constructing' ? '興建中' : '規劃中'}，預計 ${pi.completion_year || '—'} 完工。`); }
    else if (p.kind === 'zones') { const zz = p.item; this.ui.select(zz, 'zones'); lines.push(`${zz.name}：${zz.category}，${zz.status}。`); }
    return this.finish(a, lines.join('\n'));
  }
  async zoning(text, a) {
    const sel = this.map.selected && this.map.selected.item && this.map.selected.item.lat ? this.map.selected.item : null; const p = this.resolvePlace(text); const c0 = this.map.center(); const pt = p ? [p.lon, p.lat] : sel ? [sel.lon, sel.lat] : [c0.lon, c0.lat];
    let best = null, bd = 1e12; for (const z of this.d.zoning_samples || []) { const dd = distM([z.lon, z.lat], pt); if (dd < bd) { bd = dd; best = z; } }
    const res = await this.call(a, 'land-info.taipei_zoning_at_point', { lon: +pt[0].toFixed(5), lat: +pt[1].toFixed(5) }, () => ({ summary: best && best.zone_code ? best.zone_code : '0 筆', value: best }));
    if (!res || !res.zone_code) return this.finish(a, '這個點在示範快照裡沒有分區樣本；正式版會即時呼叫台北市 15,500 筆使用分區圖（land-info.taipei_zoning_at_point），回傳分區、容積率、建蔽率與法條。');
    const far = res.far_decimal != null ? `${Math.round(res.far_decimal * 100)}%` : null, bcr = res.bcr_decimal != null ? `${Math.round(res.bcr_decimal * 100)}%` : null; const where = p ? p.name : sel ? sel.name : '目前視野中心'; const approx = bd > 400 ? `（最近樣本點距 ${fmtInt(bd)} m）` : '';
    let msg = `${where}${approx}：${res.zone_name}（${res.zone_code}）`; msg += far ? `，容積率 ${far}、建蔽率 ${bcr || '—'}${res.max_height_m ? `、高度上限 ${res.max_height_m} m` : ''}。` : `。${res.is_special_zone ? '屬特定專用區，容積率／建蔽率依個別都市計畫書核定，不得直接套用估算。' : '法規值待補。'}`;
    if (res.land) msg += `\n地段地號：${res.land}`; msg += '\n來源：臺北市都市計畫使用分區圖 · 臺北市土地使用分區管制自治條例'; return this.finish(a, msg);
  }
  async supply(text, a) {
    const dn = this.districtOfText(text) || this.currentDistrict(); const y = this.yearsFromText(text) || 2030; const fd = (this.d.future_dev || []).filter(f => (!dn || (f.district || '').includes(dn.replace('區', ''))) && f._year <= y); const lic = (this.d.building_licenses || []).filter(l => l.lat && (!dn || (l.address || '').includes(dn.replace('區', ''))));
    await this.call(a, 'future-dev.search_future_dev', { district: dn || undefined, limit: 20 }, () => ({ summary: `${fd.length} 案`, value: fd }));
    await this.call(a, 'taipei-licenses.search_taipei_building_licenses', { license_year: 114, address: dn ? dn.replace('區', '') : undefined, limit: 50 }, () => ({ summary: `${lic.length} 張建照`, value: lic }));
    const c = this.districtCentroid(dn); if (c) this.map.flyTo(c[0], c[1], { range: 5200, pitch: -48 }); this.ui.setLayer('future', true); this.ui.setLayer('licenses', true); fd.forEach(f => this.map.pulse('future:' + f.id, 8000)); lic.slice(0, 40).forEach(l => this.map.pulse('license:' + l.license_number, 8000));
    if (y > new Date().getFullYear()) this.map.setYear(y);
    const floors = fd.reduce((s, f) => s + (f.floors_above || 0), 0); const mix = {}; fd.forEach(f => { for (const [k, v] of Object.entries(f.usage_mix || {})) mix[k] = (mix[k] || 0) + v; }); const top = Object.entries(mix).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k]) => ({ office: '辦公', hotel: '旅館', house: '住宅', store: '零售', parking: '停車', others: '其他' }[k] || k)).join('／');
    const lines = [`${dn || '視野範圍'}到 ${y} 年：規劃／興建中 ${fd.length} 案、合計約 ${fmtInt(floors)} 個樓層${top ? `，用途以${top}為主` : ''}；另有 ${lic.length} 張 114–115 年建照（新供給最早訊號，24–48 個月後完工）。`];
    fd.slice(0, 5).forEach(f => lines.push(`· ${f.name}｜${f.developer || '—'}｜${f.floors_above || '?'}F｜${f._year} 完工`)); lines.push('來源：FUNRAISE 未來開發資料庫 · 臺北市建照存根（起造人已遮罩）');
    return this.finish(a, lines.join('\n'));
  }
  async deals(text, a) {
    const dn = this.districtOfText(text); const months = this.monthsFromText(text) || 12; const since = new Date(); since.setMonth(since.getMonth() - months); const list = (this.d.mops || []).filter(m => (!dn || m.district === dn) && new Date(m.announcement_date) >= since && m.total_price > 0).sort((p, q) => (q.total_price || 0) - (p.total_price || 0));
    await this.call(a, 'mops-property.search_mops_property', { city: '台北市', district: dn || undefined, since: months + 'm', limit: 50 }, () => ({ summary: `${list.length} 筆`, value: list }));
    const vol = list.reduce((s, m) => s + (m.total_price || 0), 0); const byType = {}; list.forEach(m => { byType[m.buyer_type || '其他'] = (byType[m.buyer_type || '其他'] || 0) + (m.total_price || 0); }); const top = Object.entries(byType).sort((p, q) => q[1] - p[1]).slice(0, 3);
    this.ui.setLayer('mops', true); list.forEach(m => this.map.pulse('mops:' + m.id, 9000)); const c = dn ? this.districtCentroid(dn) : null; if (c) this.map.flyTo(c[0], c[1], { range: 5200, pitch: -50 }); else this.map.flyTo(121.548, 25.047, { range: 14000, pitch: -60 });
    if (!list.length) return this.finish(a, `${dn || '台北市'}最近 ${months} 個月沒有符合的上市櫃資產交易公告（快照）。`);
    const lines = [`${dn || '台北市'}最近 ${months} 個月：${list.length} 筆上市櫃不動產交易公告，總額約 ${fmtMoney(vol)} 元。買方以${top.map(([k, v]) => `${k}（${fmtMoney(v)}）`).join('、')}為主。`];
    list.slice(0, 5).forEach(m => lines.push(`· ${m.announcement_date}｜${m.company_name}｜${m.product_type || ''}｜${m.property_name || m.building_address || ''}｜${fmtMoney(m.total_price)}`)); lines.push('來源：公開資訊觀測站 取得或處分資產公告（FUNRAISE 結構化解析）');
    this.ui.showBars('交易金額（前 6 筆）', list.slice(0, 6).map(m => ({ k: m.company_name, v: m.total_price || 0, label: fmtMoney(m.total_price) })), '#DE7020'); return this.finish(a, lines.join('\n'));
  }
  async renewal(text, a) {
    const dn = this.districtOfText(text); const st = (this.d.urban_renewal_stats && this.d.urban_renewal_stats.by_district) || []; const cat = (this.d.urban_renewal_stats && this.d.urban_renewal_stats.by_category) || [];
    const stat = await this.call(a, 'urban-renewal.aggregate_urban_renewal', { group_by: 'district', region: '臺北市' }, () => ({ summary: `${st.length} 區`, value: st }));
    const units = (this.d.urban_renewal || []).filter(u => u.rings && (!dn || u.district === dn)); await this.call(a, 'urban-renewal.search_urban_renewal', { region: '臺北市', district: dn || undefined, limit: 50 }, () => ({ summary: `${units.length} 筆（含圖形）`, value: units }));
    this.ui.setLayer('renewal', true); units.forEach(u => this.map.pulse('renewal:' + u.id, 9000)); const target = dn || (stat[0] && stat[0].district); const c = this.districtCentroid(target); if (c) this.map.flyTo(c[0], c[1], { range: 5600, pitch: -55 });
    const row = stat.find(s => s.district === target); const lines = [];
    if (dn && row) lines.push(`${dn}：${fmtInt(row.count)} 個都更地區／單元，合計 ${fmtInt(row.total_area_sqm / 1e4)} 萬 m²（平均 ${fmtInt(row.avg_area_sqm || 0)} m²）；地圖上亮起的是快照中有圖形的 ${units.length} 筆。`); else if (stat.length) lines.push(`台北市都更件數最多的是 ${stat.slice(0, 3).map(s => `${s.district}（${fmtInt(s.count)}）`).join('、')}。`);
    if (cat.length) lines.push(`類別：${cat.slice(0, 4).map(c2 => `${c2.category} ${fmtInt(c2.count)}`).join('、')}。`); units.slice(0, 4).forEach(u => lines.push(`· ${u.code || ''} ${u.name}｜${u.category}｜${fmtInt(u.area_sqm || 0)} m²`)); lines.push('來源：臺北市都市更新處／內政部都更資料 · FUNRAISE 都更圖層');
    if (stat.length) this.ui.showBars('各區都更件數', stat.slice(0, 8).map(s => ({ k: s.district, v: s.count, label: fmtInt(s.count) })), '#A78BFA'); return this.finish(a, lines.join('\n'));
  }
  async compare(text, a) {
    const t = norm(text); const areas = (this.d.business_areas || []).filter(x => t.includes(norm((x.name || '').replace(/^台北市/, '')))); const dists = []; const re = /(信義|大安|中山|松山|內湖|南港|中正|萬華|大同|士林|北投|文山)區?/g; let m; while ((m = re.exec(text))) dists.push(m[1] + '區');
    if (areas.length >= 2) { await this.call(a, 'areas.list_areas', { city_code: 'A', type: 'business_area' }, () => ({ summary: `${areas.length} 商圈`, value: areas })); const rent = /租/.test(t) || !/售|房價|價/.test(t); const rows = areas.map(x => ({ k: (x.name || '').replace(/^台北市/, ''), v: rent ? x.market_price.actual_rent_avg : x.market_price.actual_sale_avg / 1e4, label: rent ? fmtInt(x.market_price.actual_rent_avg) + ' 元/坪/月' : fmtInt(x.market_price.actual_sale_avg / 1e4) + ' 萬/坪', yoy: rent ? x.market_price.actual_rent_yoy : x.market_price.actual_sale_yoy })); this.ui.showBars(rent ? '平均租金' : '平均售價', rows, '#F29628'); if (areas[0].lat) this.map.flyTo(areas[0].lon, areas[0].lat, { range: 7000, pitch: -58 }); this.ui.setLayer('heat', true);
      return this.finish(a, rows.map(r => `${r.k}：${r.label}（YoY ${(r.yoy * 100).toFixed(1)}%）`).join('\n') + `\n差距 ${((rows[0].v / rows[1].v - 1) * 100).toFixed(1)}%。來源：實價登錄租賃／買賣 · FUNRAISE 商圈分析`); }
    const ds = (this.d.district_sales && this.d.district_sales['台北市']) || [];
    if (dists.length >= 2 && ds.length) { const rows = dists.map(dn => ds.find(x => x.district === dn)).filter(Boolean); await this.call(a, 'actual-price-sale.aggregate_sales_by_district', { city: '台北市' }, () => ({ summary: `${ds.length} 區`, value: ds })); this.ui.showBars('中位數成交總價', rows.map(r => ({ k: r.district, v: r.median_price, label: fmtMoney(r.median_price) })), '#F29628'); return this.finish(a, rows.map(r => `${r.district}：累計 ${fmtInt(r.transaction_count)} 筆，中位數總價 ${fmtMoney(r.median_price)}，平均 ${fmtMoney(r.avg_price)}`).join('\n') + '\n來源：內政部實價登錄 2012 迄今（FUNRAISE 清洗庫）'); }
    if (/排名|排行/.test(t) && ds.length) { await this.call(a, 'actual-price-sale.aggregate_sales_by_district', { city: '台北市' }, () => ({ summary: `${ds.length} 區`, value: ds })); const rows = [...ds].sort((p, q) => q.transaction_count - p.transaction_count); this.ui.showBars('實價登錄累計成交件數', rows.map(r => ({ k: r.district, v: r.transaction_count, label: fmtInt(r.transaction_count) })), '#F29628'); this.map.city(); return this.finish(a, `台北市成交量前三：${rows.slice(0, 3).map(r => `${r.district} ${fmtInt(r.transaction_count)} 筆`).join('、')}；最少：${rows[rows.length - 1].district}。中位數總價最高：${[...ds].sort((p, q) => q.median_price - p.median_price)[0].district}。\n來源：內政部實價登錄（2012–）`); }
    return this.finish(a, '請指定要比較的兩個商圈或行政區，例如「比較信義基隆商圈和民生敦北商圈的租金」或「比較大安區和中山區的房價」。');
  }
  async moves(text, a) {
    const dn = this.districtOfText(text) || '信義區'; const list = (this.d.registry_moves || []).filter(m => m.lat && (m.district === dn || (m.after || '').includes(dn.replace('區', '')))); const caps = this.d.capital_increases || [];
    await this.call(a, 'company-registry.search_registry_changes', { city: '臺北市', district: dn, change_types: ['address'], limit: 50 }, () => ({ summary: `${list.length} 筆跨區`, value: list }));
    if (caps.length) await this.call(a, 'company-registry.search_registry_changes', { city: '臺北市', change_types: ['capital'], direction: 'increase', min_delta: 1e8 }, () => ({ summary: `${caps.length} 筆增資`, value: caps }));
    this.ui.setLayer('moves', true); const c = this.districtCentroid(dn); if (c) this.map.flyTo(c[0], c[1], { range: 7500, pitch: -42 }); list.forEach(m => this.map.pulse('move:' + m.uniform_number, 9000));
    const cross = list.filter(m => m.move_scope === 'cross_city').length; const lines = [`2026 年 7 月有 ${list.length} 家公司把登記地址遷入${dn}（其中 ${cross} 家來自其他縣市），弧線由原址飛向新址。`];
    list.slice(0, 5).forEach(m => lines.push(`· ${m.company_name}｜${m.date}｜${(m.before || '').replace(/^臺北市|^台北市/, '').slice(0, 10)} → ${(m.after || '').replace(/^臺北市|^台北市/, '').slice(0, 14)}`));
    if (caps.length) lines.push(`另有 ${caps.length} 家額定資本額增加 ≥ 1 億的公司（增資＋搬遷 = 擴租訊號，可推給商仲與生態系夥伴）。`); lines.push('來源：經濟部公司登記（FUNRAISE 異動比對）· 額定資本額非實收');
    return this.finish(a, lines.join('\n'));
  }
  async tenants(text, a) {
    const sel = this.map.selected && this.map.selected.layer === 'stock' ? this.map.selected.item : null; const p = this.resolvePlace(text); const b = (p && p.kind === 'stock' && p.item) || sel; if (!b) return this.finish(a, '先點選一棟大樓，或說「○○大樓的租戶是誰」。');
    const ten = (this.d.tenants || {})[b.id] || []; await this.call(a, 'key-enterprise.search_key_enterprises', { building_id: b.id, limit: 20 }, () => ({ summary: `${ten.length} 家`, value: ten })); this.map.flyTo(b.lon, b.lat, { range: 560, pitch: -30 }); this.map.pulse('stock:' + b.id); this.ui.select(b, 'stock');
    if (!ten.length) return this.finish(a, `${b.name} 在快照中沒有帶入重點租戶；正式版會即時查 key-enterprise 索引（承租企業，非屋主）。`);
    const byInd = {}; ten.forEach(x => { byInd[x.industry || '其他'] = (byInd[x.industry || '其他'] || 0) + 1; });
    return this.finish(a, `${b.name} 重點租戶 ${ten.length} 家：${ten.slice(0, 8).map(x => x.company || x.name).join('、')}。產業：${Object.entries(byInd).sort((p2, q) => q[1] - p2[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join('、')}。\n來源：FUNRAISE 重點企業承租戶索引`);
  }
  async history(text, a) {
    const items = (this.d.sample_transactions && this.d.sample_transactions.items) || []; if (!items.length) return this.finish(a, '快照未帶成交樣本。');
    const t = norm(text); let s = items.find(it => t.includes(norm(it.name))) || items.find(it => (it.sales || []).length) || items[0]; const sales = s.sales || [], rents = s.rentals || [];
    await this.call(a, 'actual-price-sale.search_actual_sales', { address: s.address.replace(/^臺北市|^台北市/, ''), limit: 10 }, () => ({ summary: `${sales.length} 筆`, value: sales })); await this.call(a, 'actual-price-rental.search_actual_rentals', { address: s.address.replace(/^臺北市|^台北市/, ''), limit: 8 }, () => ({ summary: `${s.rentals_total || rents.length} 筆`, value: rents }));
    if (s.lat) this.map.flyTo(s.lon, s.lat, { range: 560, pitch: -30 });
    const lines = [`${s.name}（${s.address}）：買賣 ${sales.length} 筆、租賃 ${s.rentals_total || rents.length} 筆。${!sales.length && s.sales_note ? '買賣：' + s.sales_note + '。' : ''}`];
    sales.slice(0, 4).forEach(x => lines.push(`· 買賣 ${x.date}｜${x.floor || ''}｜${fmtMoney(x.total_price)} 元｜${x.unit_price ? fmtInt(x.unit_price / 1e4) + ' 萬/坪' : ''}`)); rents.slice(0, 4).forEach(x => lines.push(`· 租賃 ${x.date || ''}｜${x.floor || ''}｜月租 ${fmtMoney(x.monthly_rent)} 元｜${x.unit_rent ? fmtInt(x.unit_rent) + ' 元/坪/月' : ''}`));
    lines.push('來源：內政部實價登錄（買賣／租賃）· FUNRAISE 清洗庫'); if (rents.length >= 3) this.ui.showSpark('租金單價（元/坪/月）', rents.filter(x => x.unit_rent).map(x => ({ t: x.date || '', v: x.unit_rent })).reverse());
    return this.finish(a, lines.join('\n'));
  }
  async dd(text, a) {
    const sel = this.map.selected && this.map.selected.item; const b = (sel && sel.name && sel.lat) ? sel : (this.d.buildings || []).find(x => /101/.test(x.name)); if (!b) return this.finish(a, '先點選一棟大樓。');
    await this.call(a, 'dd-memo.find_property_lifecycle', { building_id: b.id }, () => ({ summary: '時序 3 來源', value: 1 })); await this.call(a, 'land-info.taipei_zoning_at_point', { lon: b.lon, lat: b.lat }, () => ({ summary: '1 筆', value: 1 })); await this.call(a, 'key-enterprise.search_key_enterprises', { building_id: b.id }, () => ({ summary: `${((this.d.tenants || {})[b.id] || []).length} 家`, value: 1 })); await this.call(a, 'transcripts.moi_address_lookup', { address: b.rep_address || '' }, () => ({ summary: '建號／地號', value: 1 }));
    this.map.flyTo(b.lon, b.lat, { range: 620, pitch: -32 }); this.map.pulse('stock:' + b.id);
    return this.finish(a, `已為「${b.name}」起草 DD memo 骨架：① 標的與產權（地號／建號／使照 ${b._built || '—'}）② 分區與可建（容積／建蔽）③ 市場（同棟成交、商圈租金）④ 租戶結構 ⑤ 周邊供給與都更 ⑥ 風險。Claude 模式下會由 Claude 依 FUNRAISE MCP 工具結果生成全文，並附每一段的資料來源與期間。`);
  }
  async renewalSim(text, a) {
    const units = this.ui.simUnits ? this.ui.simUnits() : []; const sel = this.map.selected && this.map.selected.layer === 'renewal' ? this.map.selected.item : null;
    const byName = (this.d.urban_renewal || []).find(u => u.rings && norm(text).includes(norm(u.name).slice(0, 4)) && norm(u.name).length >= 2 && norm(text).includes(norm(u.name)));
    let unit = byName || sel; if (!unit) { const withData = (this.d.urban_renewal || []).filter(u => units.find(x => x.id === u.id)); const dn = this.districtOfText(text); unit = withData.find(u => !dn || u.district === dn) || withData[0]; }
    if (!unit) return this.finish(a, '請先點選一個都更單元（紫色多邊形），或說「模擬兒福B1-2都更」。');
    const pdata = units.find(x => x.id === unit.id);
    await this.call(a, 'urban-renewal.get_urban_renewal', { id: unit.id }, () => ({ summary: `${fmtInt(unit.area_sqm)} m²`, value: unit }));
    if (pdata) { await this.call(a, 'land-info.find_taipei_land_at_point ×' + (pdata.sample_points || pdata.parcels.length), { unit: unit.name }, () => ({ summary: `${pdata.parcels.length} 筆地號`, value: pdata.parcels })); await this.call(a, 'land-info.taipei_zoning_at_point', { lon: +pdata.centroid[0].toFixed(5), lat: +pdata.centroid[1].toFixed(5) }, () => ({ summary: pdata.zoning && pdata.zoning[0] ? (pdata.zoning[0].zone_short || pdata.zoning[0].zone_code) : '—', value: pdata.zoning })); await this.call(a, 'land-info.taipei_bldg_overlay_at_point', { unit: unit.name }, () => ({ summary: `${(pdata.permits || []).length} 張建照套繪`, value: pdata.permits })); }
    const r = this.ui.simulateRenewal(unit); this.ui.setLayer('parcels', true);
    const ping = n => fmtInt(n / 3.3058);
    return this.finish(a, `${unit.name}（${unit.district}，${unit.category}）：基地 ${ping(r.siteArea)} 坪、${r.parcelCount} 筆地號${r.zoning ? `，${r.zoning.zone_short || r.zoning.zone_code}` : ''}，容積率 ${Math.round(r.far * 100)}%${r.farKnown ? '' : '（特定區／假設值）'}。以 ${Math.round(r.bonus * 100)}% 都更獎勵估算：總樓地板約 ${ping(r.totalFloorArea)} 坪、${r.floors} 層、${fmtInt(r.height)} m；現況最舊建照 ${r.oldestYear || '—'}（屋齡約 ${r.age ?? '—'} 年）。整合難度：${r.difficulty}。拉動面板上的獎勵滑桿可即時改量體。\n來源：FUNRAISE MCP land-info（地籤圖 / 使用分區管制 / 建照套繪）· 都更圖層 · 假設值已列於面板`);
  }
  async brief(a) {
    const c = this.map.countInView(); const dn = this.currentDistrict(); const cam = this.map.center(); await this.call(a, 'get_current_view_state', { lon: +cam.lon.toFixed(4), lat: +cam.lat.toFixed(4), range_m: Math.round(cam.height) }, () => ({ summary: dn || '—', value: c }));
    const b = this.map.bounds(); const fut = (this.d.future_dev || []).filter(f => f.lat && f.lon >= b[0] && f.lon <= b[2] && f.lat >= b[1] && f.lat <= b[3]); const mops = (this.d.mops || []).filter(m => m.lat && m.lon >= b[0] && m.lon <= b[2] && m.lat >= b[1] && m.lat <= b[3]); const vol = mops.reduce((s, m) => s + (m.total_price || 0), 0);
    return this.finish(a, `${dn ? dn + '一帶' : '目前視野'}（${this.year} 年）：商辦 ${c.stock} 棟、規劃中 ${c.future} 案${fut.length ? `（最快 ${Math.min(...fut.map(f => f._year))} 完工）` : ''}、建照 ${c.licenses}、都更單元 ${c.renewal}、上市櫃交易 ${c.mops} 筆${vol ? `（${fmtMoney(vol)}）` : ''}、公共建設 ${c.infra}、產業園區 ${c.parks}。\n${LENSES[this.lens].name}建議下一步：${LENSES[this.lens].suggest.slice(0, 2).join('；')}。`);
  }
}
