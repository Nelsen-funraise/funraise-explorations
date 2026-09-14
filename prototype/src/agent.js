/* PeakLens 睿鏡 — simulated agent runtime
   The map is the render target of an agent that calls FUNRAISE MCP tools.
   Here the tool calls are simulated against the embedded dataset, but every
   tool name and parameter shape mirrors the real "Funraise Data Team" MCP. */
'use strict';
(function () {
  const { fmtInt, fmtMoney, yearOf, distM, clamp } = window.PL;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const norm = s => (s || '').replace(/[\s,，。！？!?、「」『』()（）]/g, '').replace(/臺/g, '台').toLowerCase();
  const has = (s, re) => re.test(s);

  const LENSES = {
    investor: { name: '投資人鏡', short: '投資', color: '#FF7A59', layers: ['mops', 'stock', 'heat', 'mrt', 'infra'], who: '壽險／REITs／家族辦公室／私募',
      suggest: ['最近一年信義區上市公司買了什麼', '比較信義基隆商圈和民生敦北商圈的租金', '帶我去南港', '這裡的資本流向', '切換開發商視角'] },
    developer: { name: '開發商鏡', short: '開發', color: '#B48CFF', layers: ['renewal', 'zones', 'licenses', 'future', 'mrt', 'infra'], who: '建商／都更實施者／地主整合／建經',
      suggest: ['信義區有哪些都更單元', '這裡容積率多少', '2028 年南港會長出什麼', '顯示建照', '環繞模式'] },
    occupier: { name: '企業選址鏡', short: '選址', color: '#F2B84B', layers: ['stock', 'heat', 'mrt', 'future', 'parks'], who: '企業 CFO／總務／人資（PickPeak 核心客群）',
      suggest: ['帶我去內湖科技園區', '信義區有哪些 A 辦', '這棟大樓的租戶是誰', '街景模式看信義計畫區', '幫我做這棟的 DD memo'] },
    city: { name: '城市治理鏡', short: '城市', color: '#4C8DFF', layers: ['infra', 'moves', 'renewal', 'zones', 'parks', 'mrt'], who: '都發局／地政局／產發局／捷運局／首長戰情室',
      suggest: ['哪些公司最近遷入信義區', '興建中的公共建設有哪些', '都更案最多的是哪個區', '顯示重劃區', '時光模式'] },
    research: { name: '學研鏡', short: '學研', color: '#58C97B', layers: ['heat', 'stock', 'renewal', 'mrt', 'zones'], who: '政大地政／台大城鄉／北大不動產 · AI Raiser',
      suggest: ['台北市各區成交量排名', '比較大安區和中山區的房價', '回到 2015 年', '簡報現在看到的', '切換學研視角'] },
  };
  const LAYER_WORDS = [
    ['stock', /商辦|大樓|存量|辦公樓|a辦|b辦/], ['future', /未來|規劃中|興建中|新供給|供給/], ['licenses', /建照/], ['renewal', /都更|更新單元/], ['zones', /重劃|區段徵收/],
    ['mops', /上市|上櫃|法人|資產交易|mops|公開資訊/], ['moves', /遷徙|遷入|搬遷|搬進|企業流動|流動/], ['infra', /公共建設|基礎設施|捷運工程|場館|轉運/], ['parks', /產業園區|工業區|園區/], ['heat', /商圈|行情|熱度|熱區/], ['mrt', /捷運|路網/],
  ];
  const ALIASES = { '信義計畫區': [121.5670, 25.0360, 14.6], '信義區': null, '內科': [121.5750, 25.0790, 14.3], '內湖科技園區': [121.5750, 25.0790, 14.3], '南軟': [121.6126, 25.0576, 14.8], '南港軟體園區': [121.6126, 25.0576, 14.8], '北車': [121.5170, 25.0478, 15.2], '台北車站': [121.5170, 25.0478, 15.2], '東區': [121.5490, 25.0415, 15], '忠孝敦化': [121.5490, 25.0415, 15], '大直': [121.5470, 25.0800, 14.6], '中山北路': [121.5230, 25.0600, 14.8], '台北101': [121.5645, 25.0339, 16.2], '101': [121.5645, 25.0339, 16.2], '大安森林公園': [121.5360, 25.0300, 14.8], '西門町': [121.5070, 25.0430, 15], '板橋': [121.4630, 25.0130, 13.8], '新板特區': [121.4640, 25.0140, 15], '南港': [121.6070, 25.0550, 13.8], '內湖': [121.5880, 25.0690, 13.4], '松山機場': [121.5520, 25.0690, 14.6], '雙北': [121.5300, 25.0400, 11.2], '台北': [121.5450, 25.0500, 12.0], '台北市': [121.5450, 25.0500, 12.0] };

  class Agent {
    constructor(engine, data, ui) { this.e = engine; this.d = data; this.ui = ui; this.lens = 'occupier'; this.busy = false; this.year = new Date().getFullYear(); }
    /* ---------- utilities ---------- */
    districtCentroid(name) { if (!name) return null; const n = norm(name); const d = (this.e.base.districts || []).find(x => norm(x.name) === n || norm(x.name).startsWith(n.replace(/區$/, ''))); return d && d.c ? d.c : null; }
    districtOfText(text) { const m = text.match(/(信義|大安|中山|松山|內湖|南港|中正|萬華|大同|士林|北投|文山|板橋|新莊|三重|中和|永和|新店|汐止|土城|蘆洲|淡水|林口|三峽|樹林|泰山|五股|鶯歌|八里|深坑|石碇|瑞芳|平溪|雙溪|貢寮|金山|萬里|坪林|烏來|三芝|石門)(區)?/); return m ? m[1] + '區' : null; }
    currentDistrict() { const d = this.e.districtAt(this.e.cam.lon, this.e.cam.lat); return d ? d.name : null; }
    resolvePlace(text) {
      const t = norm(text);
      for (const [k, v] of Object.entries(ALIASES)) { if (v && t.includes(norm(k))) return { name: k, lon: v[0], lat: v[1], zoom: v[2], kind: 'alias' }; }
      const tryList = (arr, kind, zoom, pitch) => { let best = null; for (const it of arr || []) { const n = norm(it.name || it.main); if (!n || !it.lat) continue; if (t.includes(n) || (n.length >= 3 && n.includes(t.replace(/(帶我去|飛到|前往|去|看看|看一下|找到|定位|goto|flyto)/g, '')) && t.length >= 2)) { if (!best || n.length > norm(best.name).length) best = it; } } return best ? { name: best.name, lon: best.lon, lat: best.lat, zoom, pitch, kind, item: best } : null; };
      return tryList(this.d.buildings, 'stock', 16.4, 56) || tryList(this.d.future_dev, 'future', 16.2, 56) || tryList(this.d.industrial_parks, 'parks', 14.4) || tryList(this.d.public_infras, 'infra', 15) || tryList(this.d.development_zones, 'zones', 14.4) || tryList(this.d.business_areas, 'heat', 14.2)
        || tryList(this.e.base.mrt_stations, 'mrt', 15.4) || (() => { const dn = this.districtOfText(text); const c = this.districtCentroid(dn); return c ? { name: dn, lon: c[0], lat: c[1], zoom: 13.3, kind: 'district' } : null; })();
    }
    yearsFromText(text) { const m = text.match(/(20\d{2})/); if (m) return +m[1]; const r = text.match(/(1[0-2]\d)年/); return r ? +r[1] + 1911 : null; }
    monthsFromText(text) { if (/半年/.test(text)) return 6; if (/一年|12個月|十二個月|過去一年|最近一年/.test(text)) return 12; if (/兩年|2年/.test(text)) return 24; const m = text.match(/(\d+)\s*個月/); return m ? +m[1] : null; }
    /* ---------- simulated MCP call ---------- */
    async call(turn, tool, params, fn) { const card = this.ui.toolStart(turn, tool, params); await sleep(rnd(180, 620)); const res = fn(); this.ui.toolDone(card, res.summary); return res.value; }
    /* ---------- main entry ---------- */
    async handle(text, opts = {}) {
      if (!text || this.busy) return; this.busy = true; const t = norm(text); const turn = this.ui.userTurn(text); const a = this.ui.agentTurn();
      try {
        if (has(t, /導覽|demo|tour|示範/)) { await this.finish(a, '啟動 90 秒導覽：我會依序切換視角、飛行、查詢與時光模式。'); this.busy = false; this.ui.tour(); return; }
        if (has(t, /^(幫助|help|你會什麼|可以問什麼)/)) { await this.finish(a, '我聽得懂：「帶我去 ○○」、「切換 投資人／開發商／選址／城市／學研 視角」、「顯示／隱藏 都更／建照／上市公司交易」、「這裡容積率多少」、「2028 年南港會長出什麼」、「最近半年信義區上市公司買了什麼」、「比較 A 商圈和 B 商圈的租金」、「哪些公司遷入信義區」、「環繞／街景／俯視／時光模式」、「夜視／熱感／藍圖」。'); return; }
        // camera & sensor
        if (has(t, /夜視|night/)) { this.ui.setSensor('night'); return this.finish(a, '切到夜視感測。'); }
        if (has(t, /熱感|熱像|thermal/)) { this.ui.setSensor('thermal'); return this.finish(a, '切到熱感測：暖色代表高單價／高熱度。'); }
        if (has(t, /藍圖|blueprint/)) { this.ui.setSensor('blueprint'); return this.finish(a, '切到藍圖感測。'); }
        if (has(t, /一般感測|正常畫面|normal|關掉感測|關閉感測/)) { this.ui.setSensor('normal'); return this.finish(a, '回到一般畫面。'); }
        if (has(t, /環繞|orbit|繞一圈|轉一圈/)) { const p = this.resolvePlace(text); if (p) this.e.flyTo(p.lon, p.lat, Math.max(14.6, p.zoom || 14.6), 58, this.e.cam.bearing, 1600, () => { this.e.cam.orbit = true; }); else this.e.setMode('orbit'); this.ui.setMode('orbit'); return this.finish(a, `進入環繞模式${p ? '，鎖定 ' + p.name : ''}。拖曳可隨時接手。`); }
        if (has(t, /街景|street|走進|地面|路面|走到/)) { const p = this.resolvePlace(text); this.e.setMode('street', p); this.ui.setMode('street'); return this.finish(a, `切到街景視角${p ? '：' + p.name : ''}。正式版會載入 Google 相片級 3D Tiles 與國土署 3D 建物，並可疊 CCTV 即時影像。`); }
        if (has(t, /俯視|全景|拉遠|城市視角|city|回到上空|上空/)) { this.e.setMode('city'); this.ui.setMode('city'); return this.finish(a, '拉回城市俯視。'); }
        if (has(t, /全台|台灣全圖|globe|地球/)) { this.e.setMode('globe'); this.ui.setMode('globe'); return this.finish(a, '拉到全台。目前示範資料以雙北為主；正式版底層資料為全國性（實價登錄、公司登記、都更、產業園區均為全台）。'); }
        if (has(t, /時光|time.?lapse|快轉|時間軸|回到(19|20)\d{2}|回到\d{2,3}年/)) { const y = this.yearsFromText(text); if (y) { this.ui.setYear(y); return this.finish(a, `時間軸移到 ${y} 年：${y < this.year ? '只顯示當年已存在的大樓與當年前後的事件' : '規劃中建案在完工年變為實體，新供給以 NEW 標示'}。`); } this.ui.setMode('timelapse'); return this.finish(a, '啟動時光模式：從 2012 年實價登錄起點快轉到 2030 年的供給 pipeline。God\'s Eye View 只有「現在」，FUNRAISE 的護城河在「過去與未來」。'); }
        // lens
        const lensHit = has(t, /投資|資本|investor|壽險|reits/) ? 'investor' : has(t, /開發商|建商|developer|都更整合|開發視角|開發鏡/) ? 'developer' : has(t, /選址|總務|occupier|租戶視角|企業視角|選址鏡/) ? 'occupier' : has(t, /政府|城市|市府|治理|city|首長/) ? 'city' : has(t, /學研|研究|學術|老師|research|校園/) ? 'research' : null;
        if (lensHit && has(t, /視角|鏡|切換|模式|lens|角度|給我看/)) { this.setLens(lensHit); return this.finish(a, `切換到${LENSES[lensHit].name}（${LENSES[lensHit].who}）。圖層、KPI 與建議指令已重新配置。`); }
        // layer toggles
        const toggle = has(t, /隱藏|關閉|關掉|拿掉|hide/) ? false : has(t, /顯示|打開|開啟|只看|show|疊上|加上/) ? true : null;
        if (toggle !== null) { const hits = LAYER_WORDS.filter(([k, re]) => re.test(t)).map(([k]) => k); if (hits.length) { if (has(t, /只看/)) { for (const k of Object.keys(window.PL.LAYERS)) this.ui.setLayer(k, hits.includes(k) || k === 'mrt'); } else hits.forEach(k => this.ui.setLayer(k, toggle)); return this.finish(a, `${toggle ? '顯示' : '隱藏'}圖層：${hits.map(k => window.PL.LAYERS[k].name).join('、')}。`); } }
        // zoning
        if (has(t, /容積|建蔽|使用分區|分區|zoning|能蓋多高|可建/)) { return this.zoning(text, a); }
        // supply / future
        if (has(t, /供給|會長出|蓋什麼|新建案|pipeline|規劃中|興建中|建照/)) { return this.supply(text, a); }
        // corporate deals
        if (has(t, /上市|上櫃|法人|買了|賣了|資產交易|mops|取得|處分|資本流/)) { return this.deals(text, a); }
        // urban renewal
        if (has(t, /都更|更新單元|危老/)) { return this.renewal(text, a); }
        // compare
        if (has(t, /比較|比一比|vs|對比|排名|排行/)) { return this.compare(text, a); }
        // moves
        if (has(t, /遷入|遷徙|搬進|搬到|企業流動|增資|新設/)) { return this.moves(text, a); }
        // tenants / history / dd
        if (has(t, /租戶|誰在|哪些公司在|進駐/)) { return this.tenants(text, a); }
        if (has(t, /歷史|成交紀錄|實價|成交價|租金紀錄/)) { return this.history(text, a); }
        if (has(t, /dd|盡職|生命週期|memo|備忘/)) { return this.dd(text, a); }
        if (has(t, /簡報|總結|摘要|現在看到|這裡有什麼|brief|summary|狀況/)) { return this.brief(a); }
        // go to
        const p = this.resolvePlace(text);
        if (p) { return this.goto(p, a); }
        await this.finish(a, `這個原型還聽不懂「${text}」。試試：${LENSES[this.lens].suggest.slice(0, 3).map(s => '「' + s + '」').join('、')}，或說「幫助」。`);
      } catch (err) { console.error(err); await this.finish(a, '處理時出了點問題（原型限制）。' + (err && err.message ? ' ' + err.message : '')); }
      finally { this.busy = false; }
    }
    async finish(turn, text, refs) { await this.ui.type(turn, text, refs); this.busy = false; }
    setLens(id) { this.lens = id; this.ui.applyLens(id); }
    /* ---------- intents ---------- */
    async goto(p, a) {
      const zoom = p.zoom || 14.5, pitch = p.pitch ?? (this.e.mode === 'street' ? 68 : this.e.mode === 'orbit' ? 58 : (zoom > 15 ? 50 : 0));
      this.e.flyTo(p.lon, p.lat, zoom, pitch, this.e.cam.bearing, 1900);
      const lines = [`飛往 ${p.name}。`];
      if (p.kind === 'stock') { const b = p.item; await this.call(a, 'buildings.get_building', { id: b.id }, () => ({ summary: '1 棟', value: b })); this.e.pulse('stock:' + b.id); this.ui.select(b, 'stock'); lines.push(`${b.name}：${b.grade || '?'} 級商辦，${b.floor_above || '?'}F／地下 ${b.floor_below || '?'}F，${b.year || '—'} 年取得使照${b.mrt && b.mrt[0] ? `，距 ${b.mrt[0].station_name || b.mrt[0].station} ${b.mrt[0].distance} m` : ''}${b.certifications && b.certifications.length ? `，認證：${b.certifications.map(c => c.type + (c.grade ? '·' + c.grade : '')).join('、')}` : ''}。`); }
      else if (p.kind === 'future') { const f = p.item; this.e.pulse('future:' + f.id); this.ui.select(f, 'future'); lines.push(`${f.name}（${f.developer || '—'}）預計 ${f.year} 完工，${f.floors_above || '?'}F。`); }
      else if (p.kind === 'heat') { const ar = p.item; await this.call(a, 'areas.get_area', { id: ar.id }, () => ({ summary: '商圈分析', value: ar })); this.ui.select(ar, 'heat'); if (ar.market_price) lines.push(`${ar.name}：平均租金 ${fmtInt(ar.market_price.actual_rent_avg)} 元/坪/月（YoY ${(ar.market_price.actual_rent_yoy * 100).toFixed(1)}%），平均售價 ${fmtInt(ar.market_price.actual_sale_avg / 1e4)} 萬/坪。${ar.pp_insight || ''}`); }
      else if (p.kind === 'district' || p.kind === 'alias') { const dn = this.districtOfText(p.name) || this.currentDistrict(); const st = (this.d.district_sales && this.d.district_sales['台北市'] || []).find(x => x.district === dn); if (st) { await this.call(a, 'actual-price-sale.aggregate_sales_by_district', { city: '台北市' }, () => ({ summary: `${(this.d.district_sales['台北市'] || []).length} 區`, value: st })); lines.push(`${dn} 實價登錄累計 ${fmtInt(st.transaction_count)} 筆成交，中位數總價 ${fmtMoney(st.median_price)}。`); } const c = this.e.countInView(); lines.push(`視野內：商辦 ${c.stock} 棟、規劃中 ${c.future}、都更 ${c.renewal}、上市櫃交易 ${c.mops}、公共建設 ${c.infra}。`); }
      else if (p.kind === 'mrt') { const near = (this.d.buildings || []).filter(b => b.lat && distM([b.lon, b.lat], [p.lon, p.lat]) < 500); await this.call(a, 'buildings.search_buildings', { mrt_station: p.name, limit: 50 }, () => ({ summary: `${near.length} 棟（500m）`, value: near })); near.forEach(b => this.e.pulse('stock:' + b.id, 4000)); lines.push(`${p.name} 500 公尺內有 ${near.length} 棟商辦在示範資料中${near.length ? '：' + near.slice(0, 4).map(b => b.name).join('、') : ''}。`); }
      else if (p.kind === 'parks') { const pk = p.item; await this.call(a, 'industrial-parks.get_industrial_park', { id: pk.id }, () => ({ summary: `${pk.area_ha} ha`, value: pk })); this.ui.select(pk, 'parks'); lines.push(`${pk.name}：${pk.park_type || ''}，${pk.area_ha} 公頃，${pk.status || ''}，主管機關 ${pk.manager || '—'}。可再問「園區內有哪些公司」。`); }
      else if (p.kind === 'infra') { const pi = p.item; this.ui.select(pi, 'infra'); lines.push(`${pi.name}：${pi.status === 'constructing' ? '興建中' : '規劃中'}，預計 ${pi.completion_year || '—'} 完工。`); }
      else if (p.kind === 'zones') { const zz = p.item; this.ui.select(zz, 'zones'); lines.push(`${zz.name}：${zz.category}，${zz.status}。`); }
      return this.finish(a, lines.join('\n'));
    }
    async zoning(text, a) {
      const sel = this.e.selected && this.e.selected.item && this.e.selected.item.lat ? this.e.selected.item : null; const p = this.resolvePlace(text); const pt = p ? [p.lon, p.lat] : sel ? [sel.lon, sel.lat] : [this.e.cam.lon, this.e.cam.lat];
      const zs = this.d.zoning_samples || []; let best = null, bd = 1e12; for (const z of zs) { const dd = distM([z.lon, z.lat], pt); if (dd < bd) { bd = dd; best = z; } }
      const res = await this.call(a, 'land-info.taipei_zoning_at_point', { lon: +pt[0].toFixed(5), lat: +pt[1].toFixed(5) }, () => ({ summary: best ? best.zone_code : '0 筆', value: best }));
      if (!res) return this.finish(a, '這個點沒有分區樣本（示範資料只帶了 5 個點位；正式版會即時呼叫台北市 15,500 筆分區圖）。');
      const far = res.far_decimal != null ? `${Math.round(res.far_decimal * 100)}%` : null, bcr = res.bcr_decimal != null ? `${Math.round(res.bcr_decimal * 100)}%` : null;
      const where = p ? p.name : sel ? sel.name : '目前視野中心'; const approx = bd > 400 ? `（最近樣本點距 ${fmtInt(bd)} m）` : '';
      let msg = `${where}${approx}：${res.zone_name}（${res.zone_code}）`; msg += far ? `，容積率 ${far}、建蔽率 ${bcr || '—'}${res.max_height_m ? `、高度上限 ${res.max_height_m} m` : ''}。` : `。${res.is_special_zone ? '屬特定專用區，容積率／建蔽率依個別都市計畫書核定，不得直接套用估算。' : '法規值待補。'}`;
      if (res.land) msg += `\n地段地號：${res.land}`;
      msg += '\n來源：臺北市都市計畫使用分區圖 · 臺北市土地使用分區管制自治條例';
      return this.finish(a, msg);
    }
    async supply(text, a) {
      const dn = this.districtOfText(text) || this.currentDistrict(); const y = this.yearsFromText(text) || 2030; const fd = (this.d.future_dev || []).filter(f => (!dn || (f.district || '').includes(dn.replace('區', ''))) && f.year <= y); const lic = (this.d.building_licenses || []).filter(l => !dn || (l.address || '').includes(dn.replace('區', '')));
      await this.call(a, 'future-dev.search_future_dev', { district: dn || undefined, limit: 20 }, () => ({ summary: `${fd.length} 案`, value: fd }));
      await this.call(a, 'taipei-licenses.search_taipei_building_licenses', { license_year: 114, address: dn ? dn.replace('區', '') : undefined, limit: 20 }, () => ({ summary: `${lic.length} 張建照`, value: lic }));
      const c = this.districtCentroid(dn); if (c) this.e.flyTo(c[0], c[1], 13.9, 48, this.e.cam.bearing, 1800); this.ui.setLayer('future', true); this.ui.setLayer('licenses', true); fd.forEach(f => this.e.pulse('future:' + f.id, 7000));
      if (y > this.year) this.ui.setYear(y);
      const floors = fd.reduce((s, f) => s + (f.floors_above || 0), 0); const mix = {}; fd.forEach(f => { for (const [k, v] of Object.entries(f.usage_mix || {})) mix[k] = (mix[k] || 0) + v; }); const top = Object.entries(mix).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, v]) => ({ office: '辦公', hotel: '旅館', house: '住宅', store: '零售', parking: '停車', others: '其他' }[k] || k)).join('／');
      const lines = [`${dn || '視野範圍'}到 ${y} 年：規劃／興建中 ${fd.length} 案、合計約 ${fmtInt(floors)} 個樓層${top ? `，用途以${top}為主` : ''}；另有 ${lic.length} 張 114 年建照（新供給最早訊號，24–48 個月後完工）。`];
      fd.slice(0, 5).forEach(f => lines.push(`· ${f.name}｜${f.developer || '—'}｜${f.floors_above || '?'}F｜${f.year} 完工`));
      lines.push('來源：FUNRAISE 未來開發資料庫 · 臺北市建照存根（起造人已遮罩）');
      return this.finish(a, lines.join('\n'), fd.map(f => 'future:' + f.id));
    }
    async deals(text, a) {
      const dn = this.districtOfText(text); const months = this.monthsFromText(text) || 12; const since = new Date(); since.setMonth(since.getMonth() - months); const list = (this.d.mops || []).filter(m => (!dn || m.district === dn) && new Date(m.announcement_date) >= since).sort((p, q) => (q.total_price || 0) - (p.total_price || 0));
      await this.call(a, 'mops-property.search_mops_property', { city: '台北市', district: dn || undefined, since: months + 'm', limit: 50 }, () => ({ summary: `${list.length} 筆`, value: list }));
      const vol = list.reduce((s, m) => s + (m.total_price || 0), 0); const byType = {}; list.forEach(m => { byType[m.buyer_type || '其他'] = (byType[m.buyer_type || '其他'] || 0) + (m.total_price || 0); }); const top = Object.entries(byType).sort((p, q) => q[1] - p[1]).slice(0, 3);
      this.ui.setLayer('mops', true); list.forEach(m => this.e.pulse('mops:' + m.id, 8000)); const c = dn ? this.districtCentroid(dn) : null; if (c) this.e.flyTo(c[0], c[1], 13.8, 40, this.e.cam.bearing, 1800); else if (list.length && list[0].lat) this.e.flyTo(list[0].lon, list[0].lat, 13.2, 30, 0, 1800);
      if (!list.length) return this.finish(a, `${dn || '台北市'}最近 ${months} 個月沒有符合的上市櫃資產交易公告（示範資料集）。`);
      const lines = [`${dn || '台北市'}最近 ${months} 個月：${list.length} 筆上市櫃不動產交易公告，總額約 ${fmtMoney(vol)} 元。買方以${top.map(([k, v]) => `${k}（${fmtMoney(v)}）`).join('、')}為主。`];
      list.slice(0, 5).forEach(m => lines.push(`· ${m.announcement_date}｜${m.company_name}｜${m.product_type || ''}｜${m.property_name || m.building_address || ''}｜${fmtMoney(m.total_price)}`));
      lines.push('來源：公開資訊觀測站 取得或處分資產公告（FUNRAISE 結構化解析）'); this.ui.showBars('交易金額（前 6 筆）', list.slice(0, 6).map(m => ({ k: m.company_name, v: m.total_price || 0, label: fmtMoney(m.total_price) })), '#E05C3E');
      return this.finish(a, lines.join('\n'), list.slice(0, 5).map(m => 'mops:' + m.id));
    }
    async renewal(text, a) {
      const dn = this.districtOfText(text); const st = (this.d.urban_renewal_stats && this.d.urban_renewal_stats.by_district) || []; const cat = (this.d.urban_renewal_stats && this.d.urban_renewal_stats.by_category) || [];
      const stat = await this.call(a, 'urban-renewal.aggregate_urban_renewal', { group_by: 'district', region: '臺北市' }, () => ({ summary: `${st.length} 區`, value: st }));
      const units = (this.d.urban_renewal || []).filter(u => !dn || u.district === dn); await this.call(a, 'urban-renewal.search_urban_renewal', { region: '臺北市', district: dn || undefined, limit: 50 }, () => ({ summary: `${units.length} 筆（含圖形）`, value: units }));
      this.ui.setLayer('renewal', true); units.forEach(u => this.e.pulse('renewal:' + u.id, 8000));
      const target = dn || (stat[0] && stat[0].district); const c = this.districtCentroid(target); if (c) this.e.flyTo(c[0], c[1], 13.6, 35, 0, 1800);
      const row = stat.find(s => s.district === target); const lines = [];
      if (dn && row) lines.push(`${dn}：${fmtInt(row.count)} 個都更地區／單元，合計 ${fmtInt(row.total_area_sqm / 1e4)} 萬 m²（平均 ${fmtInt(row.avg_area_sqm || 0)} m²）。`); else if (stat.length) lines.push(`台北市都更件數最多的是 ${stat.slice(0, 3).map(s => `${s.district}（${fmtInt(s.count)}）`).join('、')}。`);
      if (cat.length) lines.push(`類別：${cat.slice(0, 4).map(c2 => `${c2.category || c2.key} ${fmtInt(c2.count)}`).join('、')}。`);
      units.slice(0, 4).forEach(u => lines.push(`· ${u.code || ''} ${u.name}｜${u.category}｜${fmtInt(u.area_sqm || 0)} m²`));
      lines.push('來源：臺北市都市更新處／內政部都更資料 · FUNRAISE 都更圖層'); if (stat.length) this.ui.showBars('各區都更件數', stat.slice(0, 8).map(s => ({ k: s.district, v: s.count, label: fmtInt(s.count) })), '#9A6FE0');
      return this.finish(a, lines.join('\n'), units.slice(0, 4).map(u => 'renewal:' + u.id));
    }
    async compare(text, a) {
      const t = norm(text); const areas = (this.d.business_areas || []).filter(x => t.includes(norm((x.name || '').replace(/^台北市/, '')))); const dists = []; const re = /(信義|大安|中山|松山|內湖|南港|中正|萬華|大同|士林|北投|文山)區?/g; let m; while ((m = re.exec(text))) dists.push(m[1] + '區');
      if (areas.length >= 2) { await this.call(a, 'areas.list_areas', { city_code: 'A', type: 'business_area' }, () => ({ summary: `${areas.length} 商圈`, value: areas })); const rent = /租/.test(t) || !/售|房價|價/.test(t); const rows = areas.map(x => ({ k: (x.name || '').replace(/^台北市/, ''), v: rent ? x.market_price.actual_rent_avg : x.market_price.actual_sale_avg / 1e4, label: rent ? fmtInt(x.market_price.actual_rent_avg) + ' 元/坪/月' : fmtInt(x.market_price.actual_sale_avg / 1e4) + ' 萬/坪', yoy: rent ? x.market_price.actual_rent_yoy : x.market_price.actual_sale_yoy })); this.ui.showBars(rent ? '平均租金' : '平均售價', rows, '#C98E2C'); const c = areas[0].lat ? [areas[0].lon, areas[0].lat] : null; if (c) this.e.flyTo(c[0], c[1], 13.4, 30, 0, 1600); this.ui.setLayer('heat', true);
        return this.finish(a, rows.map(r => `${r.k}：${r.label}（YoY ${(r.yoy * 100).toFixed(1)}%）`).join('\n') + `\n差距 ${((rows[0].v / rows[1].v - 1) * 100).toFixed(1)}%。來源：實價登錄租賃／買賣 · FUNRAISE 商圈分析`); }
      const ds = (this.d.district_sales && this.d.district_sales['台北市']) || [];
      if (dists.length >= 2 && ds.length) { const rows = dists.map(dn => ds.find(x => x.district === dn)).filter(Boolean); await this.call(a, 'actual-price-sale.aggregate_sales_by_district', { city: '台北市' }, () => ({ summary: `${ds.length} 區`, value: ds })); this.ui.showBars('中位數成交總價', rows.map(r => ({ k: r.district, v: r.median_price, label: fmtMoney(r.median_price) })), '#C98E2C'); return this.finish(a, rows.map(r => `${r.district}：累計 ${fmtInt(r.transaction_count)} 筆，中位數總價 ${fmtMoney(r.median_price)}，平均 ${fmtMoney(r.avg_price)}`).join('\n') + '\n來源：內政部實價登錄 2012 迄今（FUNRAISE 清洗庫）'); }
      if (/排名|排行/.test(t) && ds.length) { await this.call(a, 'actual-price-sale.aggregate_sales_by_district', { city: '台北市' }, () => ({ summary: `${ds.length} 區`, value: ds })); const rows = [...ds].sort((p, q) => q.transaction_count - p.transaction_count); this.ui.showBars('實價登錄累計成交件數', rows.map(r => ({ k: r.district, v: r.transaction_count, label: fmtInt(r.transaction_count) })), '#C98E2C'); this.e.setMode('city'); return this.finish(a, `台北市成交量前三：${rows.slice(0, 3).map(r => `${r.district} ${fmtInt(r.transaction_count)} 筆`).join('、')}；最少：${rows[rows.length - 1].district}。中位數總價最高：${[...ds].sort((p, q) => q.median_price - p.median_price)[0].district}。\n來源：內政部實價登錄（2012–）`); }
      return this.finish(a, '請指定要比較的兩個商圈或行政區，例如「比較信義基隆商圈和民生敦北商圈的租金」或「比較大安區和中山區的房價」。');
    }
    async moves(text, a) {
      const dn = this.districtOfText(text) || '信義區'; const list = (this.d.registry_moves || []).filter(m => (m.after || '').includes(dn.replace('區', '')) || (m.district === dn)); const caps = this.d.capital_increases || [];
      await this.call(a, 'company-registry.search_registry_changes', { city: '臺北市', district: dn, change_types: ['address'], limit: 50 }, () => ({ summary: `${list.length} 筆跨區`, value: list }));
      if (caps.length) await this.call(a, 'company-registry.search_registry_changes', { city: '臺北市', change_types: ['capital'], direction: 'increase', min_delta: 1e8 }, () => ({ summary: `${caps.length} 筆增資`, value: caps }));
      this.ui.setLayer('moves', true); const c = this.districtCentroid(dn); if (c) this.e.flyTo(c[0], c[1], 13.3, 42, 0, 1700);
      list.forEach((m, i) => { if (!m.lat) return; const fromD = this.districtOfText(m.before || ''); const fc = this.districtCentroid(fromD) || [m.lon - 0.03 - i * 0.004, m.lat + 0.02]; setTimeout(() => this.e.addArc(fc, [m.lon, m.lat], '#FF7A59', m.company_name, 6000), i * 350); });
      const lines = [`最近登記期間有 ${list.length} 家公司把登記地址遷入${dn}（跨區／跨市），示範以弧線標示來源區 → 新址。`];
      list.slice(0, 5).forEach(m => lines.push(`· ${m.company_name}｜${m.date}｜${(m.before || '').replace(/^臺北市|^台北市/, '').slice(0, 10)} → ${(m.after || '').replace(/^臺北市|^台北市/, '').slice(0, 14)}`));
      if (caps.length) lines.push(`另有 ${caps.length} 家額定資本額增加 ≥ 1 億的公司（增資＋搬遷 = 擴租訊號，可推給商仲與生態系夥伴）。`);
      lines.push('來源：經濟部公司登記（FUNRAISE 異動比對）· 額定資本額非實收');
      return this.finish(a, lines.join('\n'));
    }
    async tenants(text, a) {
      const sel = this.e.selected && this.e.selected.layer === 'stock' ? this.e.selected.item : null; const p = this.resolvePlace(text); const b = (p && p.kind === 'stock' && p.item) || sel; if (!b) return this.finish(a, '先點選一棟大樓，或說「○○大樓的租戶是誰」。');
      const ten = (this.d.tenants || {})[b.id] || []; await this.call(a, 'key-enterprise.search_key_enterprises', { building_id: b.id, limit: 20 }, () => ({ summary: `${ten.length} 家`, value: ten })); this.e.flyTo(b.lon, b.lat, 16.4, 56, this.e.cam.bearing, 1600); this.e.pulse('stock:' + b.id); this.ui.select(b, 'stock');
      if (!ten.length) return this.finish(a, `${b.name} 在示範資料中沒有帶入重點租戶；正式版會即時查 key-enterprise 索引（承租企業，非屋主）。`);
      const byInd = {}; ten.forEach(x => { byInd[x.industry || '其他'] = (byInd[x.industry || '其他'] || 0) + 1; });
      return this.finish(a, `${b.name} 重點租戶 ${ten.length} 家：${ten.slice(0, 8).map(x => x.company || x.name).join('、')}。產業：${Object.entries(byInd).sort((p2, q) => q[1] - p2[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join('、')}。\n來源：FUNRAISE 重點企業承租戶索引`);
    }
    async history(text, a) {
      const items = (this.d.sample_transactions && this.d.sample_transactions.items) || []; if (!items.length) return this.finish(a, '示範資料未帶成交樣本。');
      const t = norm(text); let s = items.find(it => t.includes(norm(it.name))) || items.find(it => (it.sales || []).length) || items[0];
      const sales = s.sales || [], rents = s.rentals || [];
      await this.call(a, 'actual-price-sale.search_actual_sales', { address: s.address.replace(/^臺北市|^台北市/, ''), limit: 10 }, () => ({ summary: `${sales.length} 筆`, value: sales }));
      await this.call(a, 'actual-price-rental.search_actual_rentals', { address: s.address.replace(/^臺北市|^台北市/, ''), limit: 8 }, () => ({ summary: `${s.rentals_total || rents.length} 筆`, value: rents }));
      if (s.lat) this.e.flyTo(s.lon, s.lat, 16.4, 56, this.e.cam.bearing, 1600);
      const lines = [`${s.name}（${s.address}）：買賣 ${sales.length} 筆、租賃 ${s.rentals_total || rents.length} 筆${rents.length && s.rentals_total > rents.length ? `（顯示 ${rents.length} 筆樣本）` : ''}。${!sales.length && s.sales_note ? '買賣：' + s.sales_note + '。' : ''}`];
      sales.slice(0, 4).forEach(x => lines.push(`· 買賣 ${x.date}｜${x.floor || ''}｜${fmtMoney(x.total_price)} 元｜${x.unit_price ? fmtInt(x.unit_price / 1e4) + ' 萬/坪' : ''}｜${x.area_ping ? x.area_ping + ' 坪' : ''}`));
      rents.slice(0, 4).forEach(x => lines.push(`· 租賃 ${x.date || ''}｜${x.floor || ''}｜月租 ${fmtMoney(x.monthly_rent)} 元｜${x.unit_rent ? fmtInt(x.unit_rent) + ' 元/坪/月' : ''}｜${x.area_ping ? x.area_ping + ' 坪' : ''}`));
      const other = items.filter(it => it !== s).map(it => it.name); if (other.length) lines.push(`另有樣本：${other.join('、')}（說「${other[0]} 的歷史成交」）。`);
      lines.push('來源：內政部實價登錄（買賣／租賃）· FUNRAISE 清洗庫');
      if (rents.length >= 3) this.ui.showSpark('租金單價（元/坪/月）', rents.filter(x => x.unit_rent).map(x => ({ t: x.date || '', v: x.unit_rent })).reverse());
      return this.finish(a, lines.join('\n'));
    }
    async dd(text, a) {
      const sel = this.e.selected && this.e.selected.item; const b = (sel && sel.name) ? sel : (this.d.buildings || [])[0]; if (!b) return this.finish(a, '先點選一棟大樓。');
      await this.call(a, 'dd-memo.find_property_lifecycle', { building_id: b.id }, () => ({ summary: '時序 3 來源', value: 1 })); await this.call(a, 'land-info.taipei_zoning_at_point', { lon: b.lon, lat: b.lat }, () => ({ summary: '1 筆', value: 1 })); await this.call(a, 'key-enterprise.search_key_enterprises', { building_id: b.id }, () => ({ summary: `${((this.d.tenants || {})[b.id] || []).length} 家`, value: 1 })); await this.call(a, 'transcripts.moi_address_lookup', { address: b.rep_address || b.address || '' }, () => ({ summary: '建號／地號', value: 1 }));
      return this.finish(a, `已為「${b.name}」起草 DD memo 骨架：① 標的與產權（地號／建號／使照 ${b.year || '—'}）② 分區與可建（容積／建蔽）③ 市場（同棟成交、商圈租金）④ 租戶結構 ⑤ 周邊供給與都更 ⑥ 風險。正式版由 Claude 依 FUNRAISE MCP 工具結果生成，可一鍵輸出 PDF／Notion，並附每一段的資料來源與期間。`);
    }
    async brief(a) {
      const c = this.e.countInView(); const dn = this.currentDistrict(); await this.call(a, 'get_current_view_state', { lon: +this.e.cam.lon.toFixed(4), lat: +this.e.cam.lat.toFixed(4), zoom: +this.e.cam.zoom.toFixed(1) }, () => ({ summary: dn || '—', value: c }));
      const fut = (this.d.future_dev || []).filter(f => f.lat && this.e.inView(f.lon, f.lat)); const mops = (this.d.mops || []).filter(m => m.lat && this.e.inView(m.lon, m.lat)); const vol = mops.reduce((s, m) => s + (m.total_price || 0), 0);
      return this.finish(a, `${dn ? dn + '一帶' : '目前視野'}（${this.year} 年）：商辦 ${c.stock} 棟、規劃中 ${c.future} 案${fut.length ? `（最快 ${Math.min(...fut.map(f => f.year))} 完工）` : ''}、建照 ${c.licenses}、都更單元 ${c.renewal}、上市櫃交易 ${c.mops} 筆${vol ? `（${fmtMoney(vol)}）` : ''}、公共建設 ${c.infra}、產業園區 ${c.parks}。\n${LENSES[this.lens].name}建議下一步：${LENSES[this.lens].suggest.slice(0, 2).join('；')}。`);
    }
  }
  const TOUR = [
    ['切換企業選址視角', 2200], ['帶我去信義計畫區', 4200], ['信義區有哪些 A 辦', 5200], ['切換投資人視角', 2200], ['最近一年信義區上市公司買了什麼', 6500], ['切換開發商視角', 2200], ['信義區有哪些都更單元', 6000], ['這裡容積率多少', 4200], ['2028 年南港會長出什麼', 6500], ['街景模式看南港軟體園區', 4500], ['切換城市治理視角', 2200], ['哪些公司最近遷入信義區', 6500], ['環繞模式', 4000], ['夜視', 3000], ['一般感測', 1500], ['時光模式', 9000], ['俯視', 2000],
  ];
  window.PL = Object.assign(window.PL || {}, { Agent, LENSES, TOUR });
})();
