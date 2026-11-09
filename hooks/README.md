# CortexOS Sentinel PreToolUse Hooks & Prompt Interceptors

`hooks/sentinel_pretooluse.py` is a zero-dependency Python boundary adapter that enforces:
1. **Project DNA Immutable Rules** (`.cortex/project-dna.json`)
2. **Active AST Semantic Scope Locks** (`.cortex/active-scope-lock.json`)
3. **Protected File Boundaries & Forbidden Patterns**

## Exit Code Contract
- **`0` (ALLOW):** The tool call obeys the active Scope Lock and Project DNA. Execution proceeds.
- **`2` (BLOCK):** The tool call violates file scope, touches a protected path, or introduces forbidden patterns/broken AST. Execution is aborted before touching disk, and the violation reason on `stderr` is returned to the agent to self-correct.

## 1. Claude Code Configuration (`.claude/settings.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_ROOT/hooks/sentinel_pretooluse.py\""
          }
        ]
      }
    ]
  }
}
```

## 2. Cursor / Codex / Hermes Hook Integration

```json
{
  "preToolUse": {
    "command": "python3",
    "args": ["hooks/sentinel_pretooluse.py"],
    "blockOnExitCode": 2
  }
}
```

## Auto-wire

Run `node scripts/cortex-wire-hooks.mjs` (or `node scripts/cortex-wire-hooks.mjs --root /path/to/repo`) to generate `.claude/settings.json` and `.cursor/mcp.json` pointing at this hook and the CortexOS MCP server. The daemon also keeps `.cortex/active-scope-lock.json` and `.cortex/project-dna.json` in sync with the DB so the sentinel has live rules.
