# CortexOS MCP Server

The Model Context Protocol bridge that connects every MCP-capable AI platform — **Codex, OpenCode, Cursor, Windsurf, Claude Desktop, Claude Code, Hermes** — to the CortexOS brain (blueprint §1, universal hook #1).

When your IDE agent boots a session it pulls live project state via `cortex_sync`; every decision it makes flows back through `cortex_log_decision`. No context is ever re-explained.

## Tools

| Tool | What it does |
| --- | --- |
| `cortex_sync` | Returns the **CrossPlatformSyncPacket** — header (state hash, platform pair), DNA snapshot (stack + active constraints), scoped graph context (active module: decisions, symbols, open bugs), continuity state (last action, active task, pending tasks). Records the platform handoff. |
| `cortex_get_dna` | Full PROJECT DNA — philosophy, stack with evidence, coding standards, business rules, preferred libraries, design patterns. |
| `cortex_log_decision` | Persist a decision / requirement / bug / todo / preference into the memory engine (deduped, timeline-recorded). |
| `cortex_rewrite` | Tier-1 prompt rewrite via the daemon (fast / deep / cloud engines) with token-savings metrics. |
| `cortex_search_history` | Semantic episodic search over past interactions (vector store + memory blend). |
| `cortex_capture_interaction` | Feed a raw chat transcript to the memory engine: extraction, dedupe, graph linking, episodic indexing. |
| `cortex_preexecute` | **Phase 3** — run the Pre-Execution Local Agent: Engine 1 triage (LOCAL_ONLY / HYBRID_PRE_EXECUTE / CLOUD_DIRECT_WITH_DNA), deterministic local tools against the real workspace (git state, Prisma schema, AST signatures, cached SDK docs), staged scaffolds, and the blueprint-format Tier-1 payload to inject into the main model. |
| `cortex_extract_memory` | **Phase 3 — Engine 3**: feed a finished turn (prompt + response + modified files) back into the brain. Decisions with supersede detection, task transitions, bug discovery/resolution, preferences — applied to the memory engine, Knowledge Graph (`GOVERNED_BY` / `SUPERSEDES` / `HAS_BUG` edges) and episodic store. |

## Requirements

- Node.js 18+ (global `fetch`)
- The Cortex daemon running (default `http://localhost:3000`)

## Configuration

The daemon URL is resolved in this order:

1. `--daemon <url>` CLI argument
2. `CORTEX_DAEMON_URL` environment variable
3. `http://localhost:3000` (default)

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "cortexos": {
      "command": "node",
      "args": ["/absolute/path/to/CortexOS/mcp-server/index.mjs"],
      "env": {
        "CORTEX_DAEMON_URL": "http://localhost:3000"
      }
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.cortexos]
command = "node"
args = ["/absolute/path/to/CortexOS/mcp-server/index.mjs"]
env = { CORTEX_DAEMON_URL = "http://localhost:3000" }
```

### Cursor

`.cursor/mcp.json` in the workspace (or `~/.cursor/mcp.json` global):

```json
{
  "mcpServers": {
    "cortexos": {
      "command": "node",
      "args": ["/absolute/path/to/CortexOS/mcp-server/index.mjs"],
      "env": { "CORTEX_DAEMON_URL": "http://localhost:3000" }
    }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "cortexos": {
      "command": "node",
      "args": ["/absolute/path/to/CortexOS/mcp-server/index.mjs"],
      "env": { "CORTEX_DAEMON_URL": "http://localhost:3000" }
    }
  }
}
```

### OpenCode

`opencode.json`:

```json
{
  "mcp": {
    "cortexos": {
      "type": "local",
      "command": ["node", "/absolute/path/to/CortexOS/mcp-server/index.mjs"],
      "environment": {
        "CORTEX_DAEMON_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Verify it works

```bash
# 1. Daemon must be up
curl http://localhost:3000/api/cortex/health

# 2. Speak MCP over stdio directly
node mcp-server/index.mjs
# then paste:
# {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}
# {"jsonrpc":"2.0","method":"notifications/initialized"}
# {"jsonrpc":"2.0","id":2,"method":"tools/list"}
# {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cortex_sync","arguments":{"slug":"saas-crm","targetPlatform":"hermes"}}}
```

The automated suite `node scripts/test-phase2.mjs` drives this handshake end-to-end (section 8).
