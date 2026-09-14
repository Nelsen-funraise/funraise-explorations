// Claude mode: send the conversation + view state to server/index.mjs (/api/agent) and execute the camera/layer tool calls it returns.
const API = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
export class ClaudeClient {
  constructor(map, ui, agent) { this.map = map; this.ui = ui; this.agent = agent; this.history = []; this.available = null; }
  async probe() { try { const r = await fetch(API + '/api/health'); const j = await r.json(); this.available = !!j.ok; return j; } catch { this.available = false; return { ok: false }; } }
  viewState() { const c = this.map.center(); const d = this.map.districtAtCamera(); return { lon: +c.lon.toFixed(5), lat: +c.lat.toFixed(5), height_m: Math.round(c.height), district: d ? d.name : null, year: this.map.year, lens: this.agent.lens, visible_layers: this.map.visibleLayers(), selected: this.map.selected ? { layer: this.map.selected.layer, name: this.map.selected.item.name || this.map.selected.item.company_name, id: this.map.selected.item.id } : null, in_view: this.map.countInView() };
  }
  async handle(text) {
    this.ui.userTurn(text); const turn = this.ui.agentTurn(); this.history.push({ role: 'user', content: text });
    let rounds = 0; let messages = this.history.slice(-12);
    try {
      while (rounds++ < 6) {
        const card = this.ui.toolStart(turn, 'claude.messages', { model: 'server', turn: rounds });
        const res = await fetch(API + '/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, view: this.viewState() }) });
        if (!res.ok) { this.ui.toolDone(card, 'HTTP ' + res.status); throw new Error('agent server ' + res.status); }
        const data = await res.json(); this.ui.toolDone(card, `${data.stop_reason} · ${data.usage ? data.usage.output_tokens + ' tok' : ''}`);
        for (const b of data.content) { if (b.type === 'mcp_tool_use') this.ui.toolDone(this.ui.toolStart(turn, 'funraise.' + b.name, b.input), 'via MCP'); }
        messages = [...messages, { role: 'assistant', content: data.content }];
        const toolUses = data.content.filter(b => b.type === 'tool_use');
        const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        if (text) await this.ui.type(turn, text);
        if (!toolUses.length || data.stop_reason !== 'tool_use') { this.history.push({ role: 'assistant', content: text || '（已執行）' }); break; }
        const results = []; for (const tu of toolUses) { const card2 = this.ui.toolStart(turn, tu.name, tu.input); const out = await this.execute(tu.name, tu.input); this.ui.toolDone(card2, out.summary || 'ok'); results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) }); }
        messages = [...messages, { role: 'user', content: results }];
      }
    } catch (e) { await this.ui.type(turn, `Claude 模式無法使用（${e.message}）。請啟動 server：\`npm run server\`，並在 .env 設定 ANTHROPIC_API_KEY 與 FUNRAISE_MCP_TOKEN。已切回內建 agent。`); this.ui.setAgentMode(false); }
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
      case 'highlight': { for (const k of input.keys || []) m.pulse(k, input.ms || 8000); return { ok: true, count: (input.keys || []).length }; }
      case 'get_view_state': return this.viewState();
      case 'search_local_snapshot': { const q = (input.query || '').toLowerCase(); const hits = []; for (const [layer, arr] of Object.entries({ stock: m.data.buildings, future: m.data.future_dev, renewal: m.data.urban_renewal, mops: m.data.mops, infra: m.data.public_infras, parks: m.data.industrial_parks, zones: m.data.development_zones })) for (const it of arr || []) { const n = (it.name || it.company_name || '').toLowerCase(); if (n.includes(q)) hits.push({ layer, key: `${layer === 'parks' ? 'ipark' : layer === 'zones' ? 'zone' : layer}:${it.id}`, name: it.name || it.company_name, lon: it.lon, lat: it.lat }); if (hits.length >= 20) break; } return { hits }; }
      case 'show_chart': { ui.showBars(input.title || '', (input.rows || []).map(r => ({ k: r.label, v: r.value, label: r.display })), '#C98E2C'); return { ok: true }; }
      case 'select_entity': { const e = m.entityByKey(input.key); if (!e) return { ok: false }; ui.select(e.properties.pl.getValue().item, e.properties.pl.getValue().layer); return { ok: true }; }
      default: return { ok: false, error: 'unknown tool ' + name };
    }
  }
}
