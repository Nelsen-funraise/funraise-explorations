// Tiny in-memory LRU+TTL cache (Phase 9G). Used today to memoize server-side query_snapshot(input) results so an
// identical snapshot lookup repeated within a turn (or across turns, within the TTL) skips recomputation.
//
// LIMITATION — this does NOT cache real FUNRAISE MCP calls. In the current architecture the MCP round-trip happens
// INSIDE the provider's own hosted tool loop: OpenAI's `mcp` function tool and Anthropic's `mcp_servers` beta both
// make the remote MCP request and fold the result back into the SAME provider API response — this server's own
// runAgent never sees the individual MCP request/response pair, so there is nothing here to key a cache entry on.
// If a server-side MCP proxy is ever added (this server issuing the MCP JSON-RPC call itself instead of handing the
// tool to the provider), reuse createCache()/key()/get()/set() exactly as query_snapshot does below, with a
// `mcp:<tool>:<args>` key instead of `query_snapshot:<args>`.
export function createCache({ max = 200, ttlMs = 600000 } = {}) {
  const map = new Map(); // insertion-ordered → Map iteration order doubles as LRU recency once we re-set on touch
  const key = (tool, args) => `${tool}:${JSON.stringify(args || {})}`;
  function get(k) {
    const hit = map.get(k); if (!hit) return undefined;
    if (Date.now() > hit.expires) { map.delete(k); return undefined; }
    map.delete(k); map.set(k, hit); // move to MRU position
    return hit.value;
  }
  function set(k, value) {
    map.delete(k); map.set(k, { value, expires: Date.now() + ttlMs });
    while (map.size > max) map.delete(map.keys().next().value); // evict LRU (oldest) entries
  }
  return { get, set, key, size: () => map.size, clear: () => map.clear() };
}
