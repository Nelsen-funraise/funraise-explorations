// LLM provider adapter for the PeakLens agent server.
// Two providers behind one interface, both returning Anthropic-style content blocks so the browser loop (src/agent/claudeClient.js) stays unchanged:
//   anthropic — official SDK, Messages API with the MCP connector (mcp_servers beta)
//   openai    — Responses API over fetch, function tools + the hosted `mcp` tool pointing at the FUNRAISE connector
// Selection: LLM_PROVIDER=openai|anthropic, else whichever key exists (OpenAI first).
import Anthropic from '@anthropic-ai/sdk';

export function pickProvider(env) {
  const want = (env.LLM_PROVIDER || '').toLowerCase();
  if (want === 'openai' && env.OPENAI_API_KEY) return 'openai';
  if (want === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

export function createLLM(env) {
  const provider = pickProvider(env); if (!provider) return null;
  return provider === 'openai' ? openaiLLM(env) : anthropicLLM(env);
}

/* ---------------- argument sanitizing (shared by both providers) ----------------
   Drops keys the tool's input_schema doesn't declare (kills garbled keys like `}！！=` that ride along real ones),
   coerces number/integer/boolean out of stringified values, and turns unparseable JSON into a `{ _error }` marker
   so the client returns an explicit error result to the model instead of crashing on `undefined` fields. */
export function sanitizeArgs(raw, schema) {
  let obj;
  if (raw == null || raw === '') obj = {};
  else if (typeof raw === 'object') obj = raw;
  else { try { obj = JSON.parse(raw); } catch { return { _error: 'bad json' }; } }
  if (!obj || typeof obj !== 'object') return { _error: 'bad json' };
  if (!schema || !schema.properties) return obj;
  const props = schema.properties; const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in props)) continue; // unknown/garbled key → dropped
    const type = props[k].type; let val = v;
    if (type === 'number' && typeof v === 'string' && v.trim() !== '' && !isNaN(+v)) val = +v;
    else if (type === 'integer' && typeof v === 'string' && v.trim() !== '' && !isNaN(+v)) val = Math.trunc(+v);
    else if (type === 'boolean' && typeof v === 'string') { if (/^true$/i.test(v.trim())) val = true; else if (/^false$/i.test(v.trim())) val = false; }
    out[k] = val;
  }
  return out;
}
const schemaFor = (tools, name) => { const t = (tools || []).find(x => x.name === name); return t && t.input_schema; };

/* ---------------- Anthropic ---------------- */
function anthropicLLM(env) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }); const model = env.ANTHROPIC_MODEL || 'claude-opus-5';
  return {
    provider: 'anthropic', model,
    async run({ system, messages, tools, mcp, final }) {
      const t = [...tools]; const extra = {};
      // Phase 9G note: the mcp_servers beta below makes Anthropic itself call the remote FUNRAISE MCP server and fold
      // the result back into THIS SAME response — this adapter never sees the individual MCP request/response pair,
      // so server/cache.mjs's LRU (wired up for query_snapshot in index.mjs) can't key an entry on it. Caching only
      // becomes possible here if this server starts proxying MCP calls itself instead of delegating them via mcp_servers.
      if (mcp && !final) { t.push({ type: 'mcp_toolset', mcp_server_name: mcp.name || 'funraise' }); extra.mcp_servers = [{ type: 'url', url: mcp.url, name: mcp.name || 'funraise', authorization_token: mcp.token, ...(mcp.allowedTools && mcp.allowedTools.length ? { tool_configuration: { enabled: true, allowed_tools: mcp.allowedTools } } : {}) }]; extra.betas = ['mcp-client-2025-11-20']; }
      if (final) extra.tool_choice = { type: 'none' };
      const res = await client.beta.messages.create({ model, max_tokens: 6000, thinking: { type: 'adaptive' }, system, messages, tools: t, ...extra });
      for (const b of res.content) if (b.type === 'tool_use') b.input = sanitizeArgs(b.input, schemaFor(tools, b.name));
      return { content: res.content, stop_reason: res.stop_reason, usage: res.usage, model: res.model };
    },
    async test() { try { const r = await client.models.list({ limit: 1 }); return { ok: true, detail: `models ok (${(r.data && r.data[0] && r.data[0].id) || ''})` }; } catch (e) { return { ok: false, detail: e.message }; } },
  };
}

/* ---------------- OpenAI (Responses API) ---------------- */
const safeJSON = (s) => { if (s == null) return {}; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch { return { _raw: String(s) }; } };
const isReasoningModel = (m) => /^(gpt-5|o\d)/i.test(m);

// Anthropic-style conversation (text / tool_use / tool_result / mcp_* blocks) → Responses API input items.
export function toOpenAIInput(messages) {
  const items = [];
  const text = (role, t) => items.push({ role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: t }] });
  for (const m of messages) {
    if (m.content == null) continue;
    if (typeof m.content === 'string') { text(m.role, m.content); continue; }
    for (const b of m.content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && b.text) text(m.role, b.text);
      else if (b.type === 'tool_use') items.push({ type: 'function_call', call_id: b.id, name: b.name, arguments: JSON.stringify(b.input || {}) });
      else if (b.type === 'tool_result') items.push({ type: 'function_call_output', call_id: b.tool_use_id, output: typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '') });
      else if (b.type === 'mcp_tool_use') text('assistant', `（已查詢 FUNRAISE MCP 工具 ${b.name}：${JSON.stringify(b.input || {}).slice(0, 400)}）`);
      else if (b.type === 'mcp_tool_result') text('assistant', `（MCP 回傳${b.is_error ? '錯誤' : ''}：${(typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '')).slice(0, 1500)}）`);
    }
  }
  return items;
}

// Responses API output items → Anthropic-style blocks + stop reason. `tools` (the Anthropic-style CAMERA_TOOLS list with
// input_schema) is used to sanitize each function_call's parsed args; omit it to skip schema-based key filtering.
export function fromOpenAIOutput(res, tools) {
  const content = []; let hasTool = false;
  for (const it of res.output || []) {
    if (it.type === 'message') { for (const c of it.content || []) if (c.type === 'output_text' && c.text) content.push({ type: 'text', text: c.text }); }
    else if (it.type === 'function_call') { hasTool = true; content.push({ type: 'tool_use', id: it.call_id, name: it.name, input: tools ? sanitizeArgs(it.arguments, schemaFor(tools, it.name)) : safeJSON(it.arguments) }); }
    else if (it.type === 'mcp_call') {
      content.push({ type: 'mcp_tool_use', id: it.id, name: it.name, input: safeJSON(it.arguments), server_name: it.server_label });
      content.push({ type: 'mcp_tool_result', tool_use_id: it.id, is_error: !!it.error, content: it.error ? (typeof it.error === 'string' ? it.error : JSON.stringify(it.error)) : (it.output ?? '') });
    }
    // reasoning / mcp_list_tools / mcp_approval_request items carry nothing the browser needs
  }
  const u = res.usage || {};
  return { content, stop_reason: hasTool ? 'tool_use' : 'end_turn', usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens }, model: res.model };
}

// Shared request-body builder for the plain and streaming OpenAI calls.
// query_snapshot rides along here as an ordinary `function` tool (fnTools below) — it's just another entry in
// CAMERA_TOOLS, executed server-side by index.mjs's snapshotSubLoop() rather than by the browser (see its comment).
function openaiBody(model, env, { system, messages, tools, mcp, final }, extra) {
  const fnTools = tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema || { type: 'object', properties: {} }, strict: false }));
  // Phase 9G note: the hosted `mcp` tool below makes OpenAI itself call the remote FUNRAISE MCP server and fold the
  // result into THIS SAME Responses API call — this adapter never sees the individual MCP request/response pair, so
  // server/cache.mjs's LRU (wired up for query_snapshot in index.mjs) can't key an entry on it. Caching only becomes
  // possible here if this server starts proxying MCP calls itself instead of handing the tool to OpenAI.
  if (mcp && !final) fnTools.push({ type: 'mcp', server_label: mcp.name || 'funraise', server_url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` }, require_approval: 'never', ...(mcp.allowedTools && mcp.allowedTools.length ? { allowed_tools: mcp.allowedTools } : {}) }); // allowed_tools keeps the ~150-tool FUNRAISE catalogue out of every turn (~22k tokens observed)
  return { model, instructions: system, input: toOpenAIInput(messages), tools: fnTools, tool_choice: final ? 'none' : 'auto', parallel_tool_calls: true, store: false, max_output_tokens: 4000, ...(isReasoningModel(model) ? { reasoning: { effort: env.OPENAI_REASONING || 'low' }, text: { verbosity: 'low' } } : {}), ...extra };
}
// Parses one `\n\n`-delimited SSE record into { type, json }; the OpenAI Responses stream repeats the event name in both
// the `event:` line and the JSON payload's own `type` field — read from the JSON since that's what our own mock/tests control.
function parseSSERecord(chunk) {
  let data = '';
  for (const line of chunk.split('\n')) if (line.startsWith('data:')) data += line.slice(5).trim();
  if (!data || data === '[DONE]') return null;
  try { const json = JSON.parse(data); return { type: json.type, json }; } catch { return null; }
}
function openaiLLM(env) {
  const key = env.OPENAI_API_KEY; const model = env.OPENAI_MODEL || 'gpt-4.1'; const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(env.OPENAI_ORG ? { 'openai-organization': env.OPENAI_ORG } : {}) };
  return {
    provider: 'openai', model,
    // final:true forces a text-only reply: tool_choice 'none' (model literally cannot call anything) and no MCP tool at all.
    async run(args) {
      const body = openaiBody(model, env, args);
      const r = await fetch(`${base}/responses`, { method: 'POST', headers, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(`OpenAI ${r.status}: ${(j.error && j.error.message) || r.statusText}`); e.status = r.status === 401 ? 502 : r.status; throw e; }
      return fromOpenAIOutput(j, args.tools);
    },
    // Streaming variant: POSTs with stream:true, parses the upstream SSE, forwards text deltas to onDelta as they arrive,
    // and resolves with the same normalized shape run() returns once `response.completed` closes the stream.
    async stream(args, onDelta) {
      const body = openaiBody(model, env, args, { stream: true });
      const r = await fetch(`${base}/responses`, { method: 'POST', headers: { ...headers, accept: 'text/event-stream' }, body: JSON.stringify(body) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error(`OpenAI ${r.status}: ${(j.error && j.error.message) || r.statusText}`); e.status = r.status === 401 ? 502 : r.status; throw e; }
      if (!r.body || !r.body.getReader) { const j = await r.json().catch(() => ({})); return fromOpenAIOutput(j, args.tools); } // no streaming body available (e.g. some fetch polyfills) → treat as one complete chunk
      const reader = r.body.getReader(); const decoder = new TextDecoder(); let buf = ''; let final = null;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          buf += decoder.decode(value, { stream: true }); let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const rec = parseSSERecord(buf.slice(0, idx)); buf = buf.slice(idx + 2); if (!rec) continue;
            if (rec.type === 'response.output_text.delta' && rec.json.delta) onDelta(rec.json.delta);
            else if (rec.type === 'response.completed' || rec.type === 'response.incomplete') final = rec.json.response || rec.json;
            else if (rec.type === 'error') throw new Error(rec.json.message || rec.json.error || 'stream error');
          }
        }
      } finally { try { reader.releaseLock(); } catch { /* already released */ } }
      if (!final) { const rec = parseSSERecord(buf); if (rec && (rec.type === 'response.completed' || rec.type === 'response.incomplete')) final = rec.json.response || rec.json; }
      if (!final) throw new Error('OpenAI stream ended without response.completed');
      return fromOpenAIOutput(final, args.tools);
    },
    async test() { try { const r = await fetch(`${base}/models/${encodeURIComponent(model)}`, { headers }); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, detail: `model ${j.id || model} ok` } : { ok: false, detail: `${r.status} ${(j.error && j.error.message) || ''}`.trim() }; } catch (e) { return { ok: false, detail: e.message }; } },
  };
}
