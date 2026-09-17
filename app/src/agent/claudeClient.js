// Claude mode: send the conversation + view state to server/index.mjs (/api/agent) and execute the camera/layer tool calls it returns.
const API = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
export class ClaudeClient {
  constructor(map, ui, agent) { this.map = map; this.ui = ui; this.agent = agent; this.history = []; this.available = null; }
  async probe(force) { try { const r = await fetch(API + '/api/health' + (force ? '?force=1' : '')); const j = await r.json(); this.available = !!j.ok; return j; } catch { this.available = false; return { ok: false, mcp: { status: 'noserver' } }; } }
  viewState() { const c = this.map.center(); const d = this.map.districtAtCamera(); return { lon: +c.lon.toFixed(5), lat: +c.lat.toFixed(5), height_m: Math.round(c.height), district: d ? d.name : null, year: this.map.year, lens: this.agent.lens, visible_layers: this.map.visibleLayers(), density: this.ui.density, selected: this.map.selected ? { layer: this.map.selected.layer, name: this.map.selected.item.name || this.map.selected.item.company_name, id: this.map.selected.item.id } : null, in_view: this.map.countInView() };
  }
  async handle(text) {
    this.ui.userTurn(text); const turn = this.ui.agentTurn(); this.history.push({ role: 'user', content: text });
    let rounds = 0; let messages = this.history.slice(-12);
    try {
      while (rounds++ < 6) {
        const card = this.ui.toolStart(turn, 'claude.messages', { model: 'server', turn: rounds });
        const res = await fetch(API + '/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, view: this.viewState() }) });
        if (!res.ok) { this.ui.toolDone(card, 'HTTP ' + res.status); throw new Error('agent server ' + res.status); }
        const data = await res.json(); this.ui.source = data.source === 'live' ? 'LIVE' : '快照'; this.ui.toolDone(card, `${data.stop_reason} · ${data.source || ''} · ${data.usage ? data.usage.output_tokens + ' tok' : ''}`);
        for (const b of data.content) { if (b.type === 'mcp_tool_use') this.ui.toolDone(this.ui.toolStart(turn, 'funraise.' + b.name, b.input), 'via MCP'); }
        messages = [...messages, { role: 'assistant', content: data.content }];
        const toolUses = data.content.filter(b => b.type === 'tool_use');
        const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        if (text) await this.ui.type(turn, text);
        if (!toolUses.length || data.stop_reason !== 'tool_use') { this.history.push({ role: 'assistant', content: text || '（已執行）' }); break; }
        const results = []; for (const tu of toolUses) { const card2 = this.ui.toolStart(turn, tu.name, tu.input); const out = await this.execute(tu.name, tu.input); this.ui.toolDone(card2, out.summary || 'ok'); results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) }); }
        messages = [...messages, { role: 'user', content: results }];
      }
    } catch (e) { await this.ui.type(turn, `AI 模式無法使用（${e.message}）。請啟動 server：\`npm run server\`，再開 http://localhost:8790/setup 貼上 OpenAI（或 Anthropic）金鑰；FUNRAISE MCP 用右上角按鈕授權。已切回內建 agent，繼續用快照資料。`); this.ui.setAgentMode(false); }
  }
  async execute(name, input) {
    const m = this.map, ui = this.ui;
    switch (name) {
      case 'fly_to': { const p = input.place ? this.agent.resolvePlace(input.place) : null; const lon = input.lon ?? (p && p.lon), lat = input.lat ?? (p && p.lat); if (lon == null) return { ok: false, error: 'unknown place' }; m.flyTo(lon, lat, { range: input.range_m || (p && p.range) || 1500, pitch: input.pitch ?? -45, heading: input.heading ?? null }); return { ok: true, resolved: p ? p.name : `${lon},${lat}` }; }
      case 'set_camera_mode': { const mode = input.mode; const p = input.place ? this.agent.resolvePlace(input.place) : null; const c = p || m.center(); if (mode === 'orbit') m.orbit(c.lon, c.lat, input.range_m || 1200); else if (mode === 'street') m.street(c.lon, c.lat); else if (mode === 'globe') m.globe(); else m.city(c.lon, c.lat); ui.setMode(mode); return { ok: true }; }
      case 'set_lens': { if (this.agent.lens !== input.lens && ['investor', 'developer', 'occupier', 'city', 'research'].includes(input.lens)) this.agent.setLens(input.lens); return { ok: true, lens: this.agent.lens }; }
      case 'set_layers': { for (const k of input.show || []) ui.setLayer(k, true); for (const k of input.hide || []) ui.setLayer(k, false); return { ok: true, visible: m.visibleLayers() }; }
      case 'set_year': { m.setYear(input.year); return { ok: true, year: m.year }; }
      case 'set_sensor': { ui.setSensor(input.sensor || 'normal'); return { ok: true }; }
      case 'set_density': { ui.setDensity(input.density || 'balanced'); return { ok: true, density: ui.density }; }
      case 'simulate_renewal': { const u = (m.data.urban_renewal || []).find(x => x.id === input.unit_id || (input.name && (x.name || '').includes(input.name))); if (!u) return { ok: false, error: 'unknown unit', available: (ui.simUnits ? ui.simUnits() : []).map(x => ({ id: x.id, name: x.name })) }; const r = ui.simulateRenewal(u, { bonus: input.bonus }); return { ok: true, unit: u.name, site_sqm: Math.round(r.siteArea), parcels: r.parcelCount, zone: r.zoning ? r.zoning.zone_short : null, far: r.far, far_known: r.farKnown, bonus: r.bonus, total_floor_area_sqm: Math.round(r.totalFloorArea), floors: r.floors, height_m: Math.round(r.height), oldest_permit_year: r.oldestYear, difficulty: r.difficulty, assumptions: r.notes }; }
      case 'set_theme': { ui.setTheme(input.theme || 'light'); return { ok: true, theme: ui.theme }; }
      case 'set_sun': { if (input.sweep) { ui.sweepSun(); return { ok: true, sweep: true }; } const P = { dawn: 6.5, morning: 9, noon: 12, golden: 17, dusk: 18.25 }; const h = input.preset === 'off' ? null : (input.preset && P[input.preset] != null ? P[input.preset] : input.hour); const set = ui.setSun(h); return { ok: true, hour: set, sun_altitude_deg: m.lighting ? m.lighting.sunAltitude() : null }; }
      case 'share_view': { const url = await ui.shareView(); return { ok: true, url }; }
      case 'start_tool': { if (!ui.startTool) return { ok: false, error: 'measure tool not wired' }; if (input.mode === 'off') { ui.stopTool(); return { ok: true, mode: null }; } ui.startTool(input.mode); return { ok: true, mode: input.mode }; }
      case 'floor_view': { if (!m.floorWalk) return { ok: false, error: 'unavailable' }; if (input.exit) { m.floorWalk.exit(); return { ok: true, active: false }; } let { lon, lat, name, floors } = input; if (input.key) { const e = m.entityByKey(input.key); if (!e) return { ok: false, error: 'unknown key' }; const pl = e.properties.pl.getValue(); lon = pl.item.lon; lat = pl.item.lat; name = name || pl.item.name; floors = floors || pl.item.floor_above; } if (lon == null || lat == null) return { ok: false, error: 'need key or lon/lat' }; m.floorWalk.enter({ lon, lat, name, floors: floors || 20, floor: input.floor ?? null, heading: input.heading ?? null }); return { ok: true, ...m.floorWalk.state }; }
      case 'show_isochrone': { const p = input.place ? this.agent.resolvePlace(input.place) : null; const lon = input.lon ?? (p && p.lon), lat = input.lat ?? (p && p.lat); if (lon == null) return { ok: false, error: 'unknown place' }; ui.setLayer('mrt', true); const info = m.showIsochrone({ lon, lat, name: input.name || (p && p.name), maxMin: input.maxMin || 20 }); if (info && info.bounds) { const [w, s, e, n] = info.bounds; m.flyTo((w + e) / 2, (s + n) / 2, { range: 4000, pitch: -55 }); } return { ok: true, ...info }; }
      case 'clear_isochrone': { m.clearIsochrone(); return { ok: true }; }
      case 'presenter': { const p = ui.presenter; if (!p) return { ok: false }; if (input.on === false) p.exit(); else if (input.on === true) p.enter(); else p.toggle(); return { ok: true, active: p.active }; }
      case 'play_trips': { if (!m.trips) return { ok: false, error: 'trips layer unavailable' }; ui.setLayer('moves', true); const summary = await m.trips.play({ year: input.year ?? m.year }); return { ok: true, ...summary }; }
      case 'focus': { if (input.off) { m.focus.exit(); return { ok: true, active: null }; } let lon = input.lon, lat = input.lat; if (lon == null && input.key) { const e = m.entityByKey(input.key); const pl = e && e.properties && e.properties.pl ? e.properties.pl.getValue() : null; const it = pl && pl.item; if (it) { lon = it.lat != null ? it.lon : (it._c && it._c[0]); lat = it.lat != null ? it.lat : (it._c && it._c[1]); } } if (lon == null) return { ok: false, error: 'unresolved location' }; m.focus.enter({ lon, lat, radiusM: input.radius_m || 320, key: input.key }); return { ok: true, active: m.focus.active }; }
      case 'set_overlay': { const ok = ui.setOverlay(input.overlay, input.on !== false); return { ok, overlays: ui.overlays() }; }
      case 'set_basemap': { ui.setBasemap(input.key); return { ok: true, basemap: input.key }; }
      case 'set_quality': { const cur = ui.setQuality({ ...(input.ao != null && { ao: input.ao }), ...(input.bloom != null && { bloom: input.bloom }), ...(input.hdr != null && { hdr: input.hdr }) }); return { ok: true, quality: cur }; }
      case 'pin': { const e = m.entityByKey(input.key); if (!e) return { ok: false, error: 'unknown key' }; const pl = e.properties.pl.getValue(); ui.pin(pl.item, pl.layer); return { ok: true }; }
      case 'highlight': { for (const k of input.keys || []) m.pulse(k, input.ms || 8000); return { ok: true, count: (input.keys || []).length }; }
      case 'get_view_state': return this.viewState();
      case 'search_local_snapshot': { const q = (input.query || '').toLowerCase(); const hits = []; for (const [layer, arr] of Object.entries({ stock: m.data.buildings, future: m.data.future_dev, renewal: m.data.urban_renewal, mops: m.data.mops, infra: m.data.public_infras, parks: m.data.industrial_parks, zones: m.data.development_zones })) for (const it of arr || []) { const n = (it.name || it.company_name || '').toLowerCase(); if (n.includes(q)) hits.push({ layer, key: `${layer === 'parks' ? 'ipark' : layer === 'zones' ? 'zone' : layer}:${it.id}`, name: it.name || it.company_name, lon: it.lon, lat: it.lat }); if (hits.length >= 20) break; } return { hits }; }
      case 'show_chart': { ui.showBars(input.title || '', (input.rows || []).map(r => ({ k: r.label, v: r.value, label: r.display })), '#C98E2C'); return { ok: true }; }
      case 'select_entity': { const e = m.entityByKey(input.key); if (!e) return { ok: false }; ui.select(e.properties.pl.getValue().item, e.properties.pl.getValue().layer); return { ok: true }; }
      default: return { ok: false, error: 'unknown tool ' + name };
    }
  }
}
