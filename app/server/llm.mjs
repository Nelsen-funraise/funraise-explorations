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

/* ---------------- Anthropic ---------------- */
function anthropicLLM(env) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }); const model = env.ANTHROPIC_MODEL || 'claude-opus-5';
  return {
    provider: 'anthropic', model,
    async run({ system, messages, tools, mcp }) {
      const t = [...tools]; const extra = {};
      if (mcp) { t.push({ type: 'mcp_toolset', mcp_server_name: mcp.name || 'funraise' }); extra.mcp_servers = [{ type: 'url', url: mcp.url, name: mcp.name || 'funraise', authorization_token: mcp.token }]; extra.betas = ['mcp-client-2025-11-20']; }
      const res = await client.beta.messages.create({ model, max_tokens: 6000, thinking: { type: 'adaptive' }, system, messages, tools: t, ...extra });
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

// Responses API output items → Anthropic-style blocks + stop reason.
export function fromOpenAIOutput(res) {
  const content = []; let hasTool = false;
  for (const it of res.output || []) {
    if (it.type === 'message') { for (const c of it.content || []) if (c.type === 'output_text' && c.text) content.push({ type: 'text', text: c.text }); }
    else if (it.type === 'function_call') { hasTool = true; content.push({ type: 'tool_use', id: it.call_id, name: it.name, input: safeJSON(it.arguments) }); }
    else if (it.type === 'mcp_call') {
      content.push({ type: 'mcp_tool_use', id: it.id, name: it.name, input: safeJSON(it.arguments), server_name: it.server_label });
      content.push({ type: 'mcp_tool_result', tool_use_id: it.id, is_error: !!it.error, content: it.error ? (typeof it.error === 'string' ? it.error : JSON.stringify(it.error)) : (it.output ?? '') });
    }
    // reasoning / mcp_list_tools / mcp_approval_request items carry nothing the browser needs
  }
  const u = res.usage || {};
  return { content, stop_reason: hasTool ? 'tool_use' : 'end_turn', usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens }, model: res.model };
}

function openaiLLM(env) {
  const key = env.OPENAI_API_KEY; const model = env.OPENAI_MODEL || 'gpt-4.1'; const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(env.OPENAI_ORG ? { 'openai-organization': env.OPENAI_ORG } : {}) };
  return {
    provider: 'openai', model,
    async run({ system, messages, tools, mcp }) {
      const fnTools = tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema || { type: 'object', properties: {} }, strict: false }));
      if (mcp) fnTools.push({ type: 'mcp', server_label: mcp.name || 'funraise', server_url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` }, require_approval: 'never' });
      const body = { model, instructions: system, input: toOpenAIInput(messages), tools: fnTools, tool_choice: 'auto', store: false, max_output_tokens: 4000, ...(isReasoningModel(model) ? { reasoning: { effort: env.OPENAI_REASONING || 'low' } } : {}) };
      const r = await fetch(`${base}/responses`, { method: 'POST', headers, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(`OpenAI ${r.status}: ${(j.error && j.error.message) || r.statusText}`); e.status = r.status === 401 ? 502 : r.status; throw e; }
      return fromOpenAIOutput(j);
    },
    async test() { try { const r = await fetch(`${base}/models/${encodeURIComponent(model)}`, { headers }); const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, detail: `model ${j.id || model} ok` } : { ok: false, detail: `${r.status} ${(j.error && j.error.message) || ''}`.trim() }; } catch (e) { return { ok: false, detail: e.message }; } },
  };
}
