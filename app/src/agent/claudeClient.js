// Claude mode: send the conversation + view state to server/index.mjs (/api/agent) and execute the camera/layer tool calls it returns.
// Phase 9C (docs/11-v2-cesium-app.md §16.6): fast local intents skip the LLM entirely (agent.tryLocal); every handle() ends
// with visible text + speech even when the model only ever moves the camera; SSE streaming types/speaks as text arrives.
import { apiFetch } from '../api.js';
import { applyLook } from './agent.js';

// zh-TW one-line summary of an executed tool, used when even the forced "final" text-only round comes back empty/fails —
// e.g. [fly_to 台北101, set_look golden] → "已飛到台北101並切到黃金時刻。" Keep in sync with the tool list in server/index.mjs.
function describe(name, input) {
  input = input || {};
  const LOOK = { white: '切到白模', sun: '切到日照', golden: '切到黃金時刻', night: '切到夜景', photoreal: '切到相片級' };
  const MODE = { orbit: '切到環繞視角', street: '切到街景', city: '拉回俯視', globe: '拉到全台' };
  const DENSITY = { immersive: '切到沉浸模式', balanced: '切到平衡模式', annotated: '切到標註模式' };
  switch (name) {
    case 'fly_to': return `飛到${input.place || '目標地點'}`;
    case 'present_place': return `${input.place ? '飛到' + input.place : '調整了呈現'}${input.look ? '並' + (LOOK[input.look] || '調整了外觀') : ''}`;
    case 'set_camera_mode': return MODE[input.mode] || '調整了鏡頭';
    case 'set_look': return LOOK[input.look] || '調整了外觀';
    case 'set_theme': return input.theme === 'dark' ? '切到夜間主題' : '切到日間主題';
    case 'set_sun': return input.sweep ? '播放了一天的日照變化' : '調整了日照';
    case 'set_layers': return '調整了圖層';
    case 'set_live_layer': return `${input.on === false ? '隱藏' : '顯示'}了${input.layer === 'youbike' ? 'YouBike' : (input.layer || '圖層')}`;
    case 'set_year': return `把時間軸移到 ${input.year} 年`;
    case 'set_density': return DENSITY[input.density] || '調整了顯示密度';
    case 'set_lens': return '切換了視角鏡';
    case 'show_isochrone': return '畫出了等時圈';
    case 'show_walkshed': return '畫出了生活圈';
    case 'clear_walkshed': case 'clear_isochrone': return '收起了分析圈';
    case 'play_trips': return '播放了企業遷徙動線';
    case 'presenter': return '切換了展示模式';
    case 'share_view': return '複製了分享連結';
    case 'focus': return input.off ? '取消了對焦' : '對焦到指定物件';
    case 'highlight': case 'select_entity': case 'pin': return '標記了地圖上的物件';
    case 'set_sensor': return '切換了感測濾鏡';
    case 'set_overlay': return '調整了疊圖';
    case 'set_basemap': return '換了底圖';
    case 'set_quality': return '調整了畫質';
    case 'floor_view': return input.exit ? '離開了樓層視角' : '切到樓層視角';
    case 'start_tool': return input.mode === 'off' ? '關閉了量測工具' : '啟動了量測工具';
    case 'get_environment': return '查了即時天氣／空氣品質';
    case 'get_view_state': case 'search_local_snapshot': return '查了畫面狀態';
    case 'show_chart': return '畫了圖表';
    case 'simulate_renewal': return '跑了都更模擬';
    default: return '執行了畫面操作';
  }
}
function summarize(executed) {
  const uniq = [...new Set(executed.map(e => describe(e.name, e.input)))]; if (!uniq.length) return '已完成操作。';
  if (uniq.length === 1) return `已${uniq[0]}。`;
  return `已${uniq.slice(0, -1).join('、')}，並${uniq[uniq.length - 1]}。`;
}
// Parses one SSE record ("event: x\ndata: y\n...") into { event, json }; tolerant of a missing `event:` line (defaults to 'message').
function parseSSE(chunk) {
  let event = 'message', data = '';
  for (const line of chunk.split('\n')) { if (line.startsWith('event:')) event = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
  if (!data) return null;
  try { return { event, json: JSON.parse(data) }; } catch { return null; }
}

export class ClaudeClient {
  constructor(map, ui, agent) { this.map = map; this.ui = ui; this.agent = agent; this.history = []; this.available = null; this._queue = Promise.resolve(); }
  async probe(force) { try { const r = await apiFetch('/api/health' + (force ? '?force=1' : '')); const j = await r.json(); this.available = !!j.ok; return j; } catch { this.available = false; return { ok: false, mcp: { status: 'noserver' } }; } }
  viewState() { const c = this.map.center(); const d = this.map.districtAtCamera(); return { lon: +c.lon.toFixed(5), lat: +c.lat.toFixed(5), height_m: Math.round(c.height), district: d ? d.name : null, year: this.map.year, lens: this.agent.lens, visible_layers: this.map.visibleLayers(), density: this.ui.density, selected: this.map.selected ? { layer: this.map.selected.layer, name: this.map.selected.item.name || this.map.selected.item.company_name, id: this.map.selected.item.id } : null, in_view: this.map.countInView() };
  }
  // Public entry point: serializes overlapping calls (a new question asked while a previous one is still mid-flight)
  // through a promise queue so history/turn state never interleaves between two concurrent handle() runs.
  handle(text) { return this._queue = this._queue.then(() => this._handle(text), () => this._handle(text)); }
  // Attempts a streaming round (SSE): types deltas into the turn immediately via ui.typeStream and speaks the first
  // complete sentence as soon as it appears. Returns the same {content,stop_reason,usage,model,provider,source} shape
  // the non-stream endpoint returns, or null when streaming isn't usable here (caller falls back to a plain POST).
  async _streamRound(turn, body) {
    let r; try { r = await apiFetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, stream: true }) }); } catch { return null; }
    if (!r.ok || !r.body || !r.body.getReader) return null;
    const reader = r.body.getReader(); const decoder = new TextDecoder(); let buf = ''; let done = null; let errored = null;
    const typer = this.ui.typeStream ? this.ui.typeStream(turn) : null; let acc = '';
    try {
      for (;;) {
        const { done: fin, value } = await reader.read(); if (fin) break;
        buf += decoder.decode(value, { stream: true }); let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const rec = parseSSE(buf.slice(0, idx)); buf = buf.slice(idx + 2); if (!rec) continue;
          if (rec.event === 'text' && rec.json.delta) { acc += rec.json.delta; if (typer) typer.push(rec.json.delta); }
          else if (rec.event === 'done') done = rec.json;
          else if (rec.event === 'error') errored = rec.json.error || 'stream error';
        }
      }
    } finally { try { reader.releaseLock(); } catch { /* already released */ } }
    if (errored && !done) throw new Error(errored);
    if (!done) return null;
    this.ui.source = done.source === 'live' ? 'LIVE' : '快照';
    const text = done.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || acc.trim();
    if (typer) await typer.done(text); else if (text) await this.ui.type(turn, text);
    return done;
  }
  // One /api/agent round (or the forced final:true round): streams when possible, else a plain POST. Always leaves the
  // round's progress card resolved (ok or error) and, when text comes back, already displayed in the turn.
  async _callAgent(turn, messages, final) {
    const card = this.ui.toolStart(turn, final ? 'llm.final' : ((this.ui.mcp && this.ui.mcp.provider) || 'llm') + '.turn', final ? {} : { model: (this.ui.mcp && this.ui.mcp.model) || 'server' });
    const body = { messages, view: this.viewState(), final };
    let data;
    try { data = await this._streamRound(turn, body); } catch (e) { this.ui.toolDone(card, e.message); throw e; }
    if (!data) {
      const res = await apiFetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { this.ui.toolDone(card, 'HTTP ' + res.status); throw new Error('agent server ' + res.status); }
      data = await res.json(); this.ui.source = data.source === 'live' ? 'LIVE' : '快照';
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(); if (text) await this.ui.type(turn, text);
    }
    this.ui.toolDone(card, `${data.stop_reason} · ${data.source || ''} · ${data.usage ? data.usage.output_tokens + ' tok' : ''}`);
    for (const b of data.content) if (b.type === 'mcp_tool_use') this.ui.toolDone(this.ui.toolStart(turn, 'funraise.' + b.name, b.input), 'via MCP');
    return data;
  }
  async _handle(text) {
    this.ui.speech && this.ui.speech.stop();
    if (this.agent.tryLocal(text)) return; // deterministic camera/UI/look/layer/scene intents never touch the LLM (§16.6)
    this.ui.userTurn(text); const turn = this.ui.agentTurn(); this.history.push({ role: 'user', content: text });
    let messages = this.history.slice(-12); let toolOnlyStreak = 0; const executed = []; let settled = false;
    try {
      let rounds = 0;
      while (rounds++ < 6) {
        const data = await this._callAgent(turn, messages, false);
        messages = [...messages, { role: 'assistant', content: data.content }];
        const toolUses = data.content.filter(b => b.type === 'tool_use');
        const roundText = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        if (roundText) { this.history.push({ role: 'assistant', content: roundText }); settled = true; break; }
        if (!toolUses.length || data.stop_reason !== 'tool_use') break; // neither text nor tools → drop to the forced finish below
        toolOnlyStreak++;
        const results = [];
        for (const tu of toolUses) { const card2 = this.ui.toolStart(turn, tu.name, tu.input); const out = await this.execute(tu.name, tu.input); this.ui.toolDone(card2, out.summary || (out.ok === false ? '錯誤：' + (out.error || '') : 'ok')); executed.push({ name: tu.name, input: tu.input }); results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) }); }
        messages = [...messages, { role: 'user', content: results }];
        if (toolOnlyStreak >= 2) break; // 2 consecutive camera/UI-only, textless rounds → stop burning rounds, force a wrap-up
      }
      if (settled) return;
      // Round budget exhausted, or forced early by the tool-only streak: one more call with tool_choice:'none' so the
      // model MUST write something; if that also comes back empty (or the call itself fails), synthesize locally.
      let finalText = '';
      try { const data = await this._callAgent(turn, messages, true); finalText = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(); } catch { /* fall through to the synthesized summary below */ }
      const text2 = finalText || summarize(executed);
      if (!finalText) await this.ui.type(turn, text2); // _callAgent already displayed finalText when the forced round itself produced it
      this.history.push({ role: 'assistant', content: text2 });
    } catch (e) {
      const fallback = executed.length ? summarize(executed) : null;
      const msg = fallback ? `${fallback}（AI 模式回應中斷：${e.message}）` : `AI 模式這一句沒有回應（${e.message}），先用內建 agent 從快照回答；下一句會再試 AI。若一直失敗：確認 server 有跑（npm start）、http://localhost:8790/setup 有 OpenAI 金鑰、右上角 MCP 已授權。`;
      await this.ui.type(turn, msg); if (!fallback && this.agent && this.agent.handle) { try { await this.agent.handle(text); } catch { /* built-in fallback is best effort */ } }
    }
  }
  async execute(name, input) {
    if (input && input._error) return { ok: false, error: input._error }; // unparseable/garbled function_call args (§16.6) → let the model retry
    const m = this.map, ui = this.ui;
    switch (name) {
      case 'fly_to': { const p = input.place ? this.agent.resolvePlace(input.place) : null; const lon = input.lon ?? (p && p.lon), lat = input.lat ?? (p && p.lat); if (lon == null) return { ok: false, error: 'unknown place' }; m.flyTo(lon, lat, { range: input.range_m || (p && p.range) || 1500, pitch: input.pitch ?? -45, heading: input.heading ?? null }); return { ok: true, resolved: p ? p.name : `${lon},${lat}` }; }
      case 'present_place': { const p = input.place ? this.agent.resolvePlace(input.place) : null; const c = p || m.center(); const range = input.range_m || (p && p.range) || 1200; if (input.style === 'street') { m.street(c.lon, c.lat); ui.setMode('street'); } else if (input.style === 'overview') { m.flyTo(c.lon, c.lat, { range: Math.max(range, 4000), pitch: -55 }); ui.setMode('city'); } else { m.orbit(c.lon, c.lat, range); ui.setMode('orbit'); } const lookRes = input.look ? await applyLook(ui, input.look, input.hour) : null; return { ok: true, resolved: p ? p.name : null, style: input.style || 'orbit', look: input.look || null, ...(lookRes && lookRes.ok === false ? { look_note: lookRes.note || lookRes.reason } : {}) }; }
      case 'set_look': { const r = await applyLook(ui, input.look, input.hour); return { ok: r.ok !== false, look: input.look, ...(r.note ? { note: r.note } : {}), ...(r.ok === false ? { reason: r.reason } : {}) }; }
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
      case 'set_live_layer': { if (input.layer === 'youbike' && ui.setYouBike) ui.setYouBike(!!input.on); return { ok: true, layer: input.layer, on: !!input.on }; }
      case 'get_environment': { const d = m.envBadge ? await m.envBadge.refresh() : null; return d ? { ok: true, ...d } : { ok: false, error: 'env unavailable (server or keys missing)' }; }
      case 'show_walkshed': { const p = input.place ? this.agent.resolvePlace(input.place) : null; const lon = input.lon ?? (p && p.lon), lat = input.lat ?? (p && p.lat); if (lon == null) return { ok: false, error: 'unknown place' }; const info = await m.showWalkshed({ lon, lat, name: input.name || (p && p.name), profile: input.profile || 'foot-walking', minutes: input.minutes && input.minutes.length ? input.minutes : [5, 10, 15] }); if (info && info.bounds) { const [w, s, e, n] = info.bounds; m.flyTo((w + e) / 2, (s + n) / 2, { range: 3000, pitch: -55 }); } return { ok: true, ...info }; }
      case 'clear_walkshed': { m.clearWalkshed(); return { ok: true }; }
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
      case 'query_snapshot': return { ok: false, error: 'server-side tool' }; // Phase 9G: index.mjs's snapshotSubLoop already ran this and fed the result back to the model server-side — the browser should never actually need to execute it; this is a defensive no-op for the rare round where it rides along with a camera tool (see snapshotSubLoop's comment in server/index.mjs)
      case 'search_local_snapshot': { const q = (input.query || '').toLowerCase(); const hits = []; for (const [layer, arr] of Object.entries({ stock: m.data.buildings, future: m.data.future_dev, renewal: m.data.urban_renewal, mops: m.data.mops, infra: m.data.public_infras, parks: m.data.industrial_parks, zones: m.data.development_zones })) for (const it of arr || []) { const n = (it.name || it.company_name || '').toLowerCase(); if (n.includes(q)) hits.push({ layer, key: `${layer === 'parks' ? 'ipark' : layer === 'zones' ? 'zone' : layer}:${it.id}`, name: it.name || it.company_name, lon: it.lon, lat: it.lat }); if (hits.length >= 20) break; } return { hits }; }
      case 'show_chart': { ui.showBars(input.title || '', (input.rows || []).map(r => ({ k: r.label, v: r.value, label: r.display })), '#C98E2C'); return { ok: true }; }
      case 'select_entity': { const e = m.entityByKey(input.key); if (!e) return { ok: false }; ui.select(e.properties.pl.getValue().item, e.properties.pl.getValue().layer); return { ok: true }; }
      default: return { ok: false, error: 'unknown tool ' + name };
    }
  }
}
