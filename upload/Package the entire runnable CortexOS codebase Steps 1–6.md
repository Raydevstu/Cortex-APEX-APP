I have packaged the complete, runnable CortexOS codebase across all 6 stages into **`cortexos-full-stack-v1.zip`** (36 files, attached to this response) and verified the Python TDD test suite inside the sandbox before archiving.

---

### 1. What Is Inside `cortexos-full-stack-v1.zip`

| Directory / File | Stage | Description |
| :--- | :--- | :--- |
| `.cortex/project-dna.json` | **Step 1** | Sample Project DNA configuration (stack, immutable rules, forbidden patterns, protected paths, and Ollama model routing policy). |
| `.cortex/schema.cypher` | **Step 1** | KuzuDB Property Graph DDL (`ModuleNode`, `FileNode`, `SymbolNode`, `DecisionNode`, `TaskNode`, `BugNode`, `SessionTurnNode`, and relationship tables). |
| `.cortex/schemas/*.schema.json` | **Step 1 & 2** | Strict JSON Schemas for `project-dna`, `router-decision`, `tier1-rewritten-prompt`, and `extracted-memory-delta`. |
| `.cortex/prompts/*.system.md` | **Step 2** | The 3 Master System Prompts (`pre-execution-router.system.md`, `tier1-prompt-engineer.system.md`, `memory-extractor.system.md`). |
| `src/engine/local-ollama-pipeline.ts` | **Step 2** | Local Ollama execution pipeline using structured JSON outputs (`format: jsonSchema`). |
| `src/mcp/cortex-mcp-server.ts` & `.cursor/mcp.json` | **Step 3** | Universal MCP Server exposing `cortex_pull_delta_sync`, `cortex_rewrite_and_preexecute`, and `cortex_commit_turn_memory` to Codex, Hermes, Cursor, and Claude Code. |
| `hooks/sentinel_pretooluse.py` & `.claude/settings.json` | **Step 3** | Zero-dependency Python `PreToolUse` AST Semantic Scope Guard enforcing `allowedWriteFiles`, `protectedPaths`, forbidden imports, and AST function length limits with deterministic exit codes (`0` Allow / `2` Block). |
| `tests/test_sentinel_pretooluse.py` | **Step 3 (TDD)** | Complete `unittest` suite verifying exit codes `0` and `2` across protected files, out-of-scope writes, forbidden patterns, and Python AST validation. |
| `src/bridge/websocket-bridge.ts` & `extension/*` | **Step 3** | Local WebSocket bridge (`ws://127.0.0.1:11436`) and Manifest V3 browser extension content script for web-based AI chats. |
| `src/indexer/ast-scanner.ts` & `src/cli/*` | **Step 4** | Repository AST symbol scanner and `npx cortexos init` bootstrap CLI. |
| `src/orchestrator/multi-agent-orchestrator.ts` | **Step 4** | Local Swarm + Cloud Core DAG Orchestrator. |
| `src/watcher/live-session-daemon.ts` | **Step 5** | Unattended `chokidar` JSONL transcript watcher (`~/.codex/sessions`, `~/.claude/projects`, `~/.hermes/sessions`) + workspace AST symbol differ. |
| `src/dashboard/*` | **Step 6** | Next.js + `@xyflow/react` Visual Command Center UI (`route.ts`, `KuzuGraphCanvas.tsx`, `page.tsx`, plus standalone `cortexos_command_center_preview.html`). |

---

### 2. How to Unpack & Run Locally

```bash
# 1. Extract the archive
unzip cortexos-full-stack-v1.zip
cd cortexos

# 2. Run the TDD AST Semantic Scope Guard test suite immediately (0 dependencies required)
python3 -m unittest discover -s tests -p "test_*.py" -v

# 3. Install Node/TypeScript dependencies
pnpm install

# 4. Run the Repository AST Scanner & Bootstrap CLI
pnpm run init

# 5. Start the Unattended Live Transcript & Git AST Diff Watcher
pnpm run watcher
```

Download **`cortexos-full-stack-v1.zip`** from the attachment card to get started.