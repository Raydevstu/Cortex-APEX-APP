# CortexOS Phase 7 — v1.0 Production Hardening: Doctor, OS Background Service, Browser/Hotkey Bridge & Live Ollama Benchmark Blueprint

> **Document ID:** `PHASE_7_DOCTOR_SERVICE_BRIDGE_AND_BENCHMARK_BLUEPRINT.md`
> **Target Release:** `CortexOS v1.0.0` (Phase 7 — Production Release & Zero-Friction Developer Ergonomics)
> **Baseline Required:** `CortexOS v0.6.0` (Phases 1–6 complete: `276/276` checks green across P1 `33`, P2 `33`, P3 `35`, P4 `35`, P5 `35`, P5C `28`, P6 `51`, Python `26`)
> **Strict Mandate:** **100% Additive & Backward-Compatible.** All existing 276 automated checks, 13 MCP tools (`8` under `--mcp-tools=core`), 16 CLI subcommands, HTTP routes, SQLite/graph schemas, and `watcher_daemon.py` MUST remain intact with zero breaking changes.

---

## 1. Executive Architecture: Why Phase 7 Completes CortexOS `v1.0.0`

With Phase 6 (`v0.6.0`) complete, CortexOS has a full **Repository Brain** (10-Stage Memory Distillation + `<=1500` token `ContextPack`), **Ripwire Structural Reflexes** (`impact`, `test-gate`, `edit-check`, `quality-panel`, `plan-lanes`, 5-lens HTML map), **Headroom Reversible Context Compression** (`SmartCrusher`, `@ccr_<hash8>`, `CacheAligner`, `learn`), and **Universal Short Handles** (`@f`, `@sym`, `@inv`, `@fact`, `@ccr`).

Phase 7 turns CortexOS into a **self-healing, always-on `v1.0.0` developer operating system** across four production pillars:

| Pillar | Component | What It Delivers | Surface Area Added |
| :--- | :--- | :--- | :--- |
| **Pillar 1** | **Self-Healing Diagnostics (`cortexos doctor`)** | 12-point deep health audit across Daemon, SQLite/Graph integrity, Project DNA, Git `post-commit` shim, Offline Spools (`pending-git-commits.jsonl` + `pending-watcher-batches.jsonl`), Watcher Cursors, Handle Registry consistency, CCR Store integrity, Ollama reachability, and MCP stdio handshake — plus `--fix` auto-remediation. | `src/diagnostics/doctor-engine.mjs`<br>`GET /doctor` · `POST /doctor/fix`<br>`cortexos doctor [--fix] [--json]` |
| **Pillar 2** | **OS Background Service Supervisor (`cortexos service`)** | Cross-platform background service manager generating & managing macOS `launchd` (`~/Library/LaunchAgents/ai.cortexos.daemon.plist`), Linux `systemd --user` (`~/.config/systemd/user/cortexos.service`), and portable PID-file daemonization (`start`/`stop`/`restart`/`status`/`logs`) supervising both the Node daemon and `watcher_daemon.py`. | `src/service/service-manager.mjs`<br>`GET /service/status`<br>`cortexos service (install\|uninstall\|start\|stop\|restart\|status\|logs)` |
| **Pillar 3** | **Browser & Hotkey Bridge (`cortexos bridge` + Userscript/Extension Bundle)** | Zero-dependency WebSocket & HTTP Bridge (`/bridge/*`) + downloadable Tampermonkey/Violentmonkey Userscript & Manifest V3 Chrome Extension (`dist/browser-bridge/`) so web-based ChatGPT, Claude.ai, Gemini, and DeepSeek chats can press **`Cmd+Shift+K` / `Ctrl+Shift+K`** to inject `<cortex_sync_packet>` + `ContextPack`, rewrite raw textarea prompts via Tier-1 Engine 2, and capture web chat turns straight into the 10-Stage Repository Brain. | `src/bridge/browser-bridge.mjs`<br>`GET /bridge/status` · `POST /bridge/SyncPrompt` · `POST /bridge/capture` · `GET /bridge/userscript.user.js`<br>`cortexos bridge (status\|emit-extension\|emit-userscript)` |
| **Pillar 4** | **Live Ollama + Heuristic Benchmark Harness (`cortexos benchmark`)** | Reproducible benchmark suite evaluating Engine 1 (Router accuracy & latency), Engine 2 (Tier-1 Prompt Rewriter token delta & `CacheAligner` stability), Engine 3 (10-Stage Distillation throughput), Ripwire `impact`/`edit-check` P95 latency, and `SmartCrusher` compression ratio — seamlessly comparing live Ollama models (when reachable) against the deterministic heuristic engine and saving reports to `.cortex/benchmarks/latest.json`. | `src/benchmark/benchmark-engine.mjs`<br>`POST /benchmark/run` · `GET /benchmark/latest`<br>`cortexos benchmark [--suite all\|engines\|reflexes\|crusher] [--ollama-url <url>] [--json]` |

---

## 2. Pillar 1: Self-Healing Diagnostics (`src/diagnostics/doctor-engine.mjs`)

### 2.1 The 12 Diagnostic Probes
`runDoctorAudit({ projectRoot, projectSlug, daemonUrl, autoFix = false })` executes 12 deterministic checks and returns a structured report:

```ts
export interface DoctorProbeResult {
  id:
    | 'daemon_reachable'
    | 'sqlite_graph_integrity'
    | 'project_dna_valid'
    | 'repo_brain_synced'
    | 'git_post_commit_hook'
    | 'git_spool_backlog'
    | 'watcher_cursor_health'
    | 'handle_registry_consistency'
    | 'ccr_store_integrity'
    | 'learned_guardrails_present'
    | 'ollama_connectivity'
    | 'mcp_stdio_handshake';
  title: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  fixable: boolean;
  fixed: boolean;
  latencyMs: number;
  message: string;
  remediationCommand?: string;
  details?: Record<string, unknown>;
}

export interface DoctorAuditReport {
  version: '1.0.0';
  timestamp: string;
  projectSlug: string;
  overallStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  summary: {
    total: 12;
    passed: number;
    warned: number;
    failed: number;
    fixedCount: number;
  };
  probes: DoctorProbeResult[];
}
```

### 2.2 Probe Specifications & `--fix` Auto-Remediation Logic
1. **`daemon_reachable`**: Verifies HTTP daemon responds on `/health` or `/state`.
2. **`sqlite_graph_integrity`**: Checks graph node/edge foreign keys (no orphan edges pointing to non-existent `sourceId`/`targetId`).
   - *If `autoFix: true`*: Prunes orphan edges and rebuilds graph indices.
3. **`project_dna_valid`**: Verifies `.cortex/project-dna.json` exists and contains valid JSON with `projectName`, `techStack`, and `architectureRules`.
   - *If `autoFix: true`*: Regenerates missing `.cortex/project-dna.json` via repository scanner.
4. **`repo_brain_synced`**: Verifies `.cortex/repo-brain.json` exists and matches the in-database count of active `Investigations` and `KnowledgeFacts`.
   - *If `autoFix: true`*: Flushes and writes `.cortex/repo-brain.json` atomically.
5. **`git_post_commit_hook`**: Checks if `.git/hooks/post-commit` exists, is executable (`0o755`), and contains the CortexOS marker (`# CORTEXOS_POST_COMMIT_SHIM`).
   - *If `autoFix: true`*: Runs `installGitHooks()` idempotently.
6. **`git_spool_backlog`**: Checks `.cortex/spool/pending-git-commits.jsonl` and `.cortex/spool/pending-watcher-batches.jsonl`. Returns `PASS` if empty, `WARN` if pending lines exist.
   - *If `autoFix: true`*: Automatically replays both spools in FIFO order (`flushSpool()`).
7. **`watcher_cursor_health`**: Inspects `.cortex/watcher-cursors.json` for corrupt JSON or negative offsets.
   - *If `autoFix: true`*: Quarantines/repairs malformed cursor entries.
8. **`handle_registry_consistency`**: Verifies every `@f`, `@sym`, `@inv`, `@fact`, `@ccr` handle in `handle_registry` resolves to a valid backing entity.
   - *If `autoFix: true`*: Re-indexes missing file/symbol handles from the live graph.
9. **`ccr_store_integrity`**: Verifies all `@ccr_<hash8>` entries have matching SHA-256 payload digests and non-empty original text.
10. **`learned_guardrails_present`**: Checks `.cortex/LEARNED_GUARDRAILS.md` sync against recorded 422 sentinel & test-gate failures.
    - *If `autoFix: true`*: Runs `learnGuardrails()` to refresh `.cortex/LEARNED_GUARDRAILS.md`.
11. **`ollama_connectivity`**: Probes `OLLAMA_HOST` (`http://127.0.0.1:11434/api/tags`) with a fast `800ms` timeout. If offline, returns `WARN` (never `FAIL`) noting that deterministic local fallback engines are active.
12. **`mcp_stdio_handshake`**: Performs a fast in-process or child-process `tools/list` verification confirming all 13 MCP tools (`8` in `core` mode) register cleanly.

---

## 3. Pillar 2: OS Background Service Supervisor (`src/service/service-manager.mjs`)

### 3.1 Cross-Platform Service Manifest Generation & PID Supervisor
`cortexos service` provides both native OS user-service templates and a universal background PID supervisor (`.cortex/run/daemon.pid` + `.cortex/run/watcher.pid` + `.cortex/logs/daemon.log`):

1. **`cortexos service install [--dir <path>] [--project <slug>] [--port <port>] [--dry-run]`**:
   - Always writes canonical manifests to `.cortex/service/`:
     - `.cortex/service/ai.cortexos.daemon.plist` (macOS `launchd` plist with `KeepAlive: true`, `RunAtLoad: true`, `StandardOutPath`, `StandardErrorPath`, supervising daemon + watcher).
     - `.cortex/service/cortexos.service` (Linux `systemd --user` unit with `Restart=on-failure`, `ExecStart`, `WorkingDirectory`, `Environment=CORTEX_PORT=...`).
     - `.cortex/service/service-config.json` (persisted port, projectSlug, nodePath, pythonPath, installedAt).
   - When `--OS-install` is passed (and not `--dry-run`), copies to `~/Library/LaunchAgents/` (macOS) or `~/.config/systemd/user/` (Linux) when writable.
2. **`cortexos service start` / `stop` / `restart` / `status` / `logs [--lines <n>]`**:
   - Manages background processes cleanly via `.cortex/run/service-state.json` and PID liveness checks (`process.kill(pid, 0)`), appending stdout/stderr to `.cortex/logs/daemon.log` and `.cortex/logs/watcher.log`.
   - `status` reports `{ installed, running, daemonPid, watcherPid, port, daemonUrl, uptimeSeconds, logFile, manifestPaths }`.

---

## 4. Pillar 3: Browser & Hotkey Bridge (`src/bridge/browser-bridge.mjs`)

### 4.1 What the Browser Bridge Solves
Developers frequently switch between terminal agents (Claude Code, Codex, OpenCode) and web-based frontier models (ChatGPT, Claude.ai, Gemini, DeepSeek) in their browser. Pillar 3 bridges web chats directly into the local CortexOS daemon with zero copy-paste toil:

1. **`GET /bridge/status` & `/api/cortex/bridge/status`**:
   - Returns `{ online: true, version: '1.0.0', defaultProjectSlug, hotkey: 'CommandOrControl+Shift+K', supportedOrigins: ['https://chatgpt.com', 'https://claude.ai', 'https://gemini.google.com', 'https://chat.deepseek.com', 'http://localhost:*'], connectedClients, stats: { promptsEnhanced, turnsCaptured, tokensSaved } }`.
2. **`POST /bridge/enhance` & `/api/cortex/bridge/enhance`**:
   - Input: `{ project?: string, rawPrompt: string, platform?: 'chatgpt'|'claude-web'|'gemini-web'|'deepseek-web'|'browser', maxPackTokens?: number, includeXml?: boolean }`
   - Action:
     1. Builds the `<= 1500` token `ContextPack` (`buildContextPack`).
     2. Aligns the prompt via `CacheAligner` (`frozenPrefix` + `liveZoneTail`).
     3. Runs Engine 2 Tier-1 Prompt Rewriter (`rewritePrompt`) enriched with active scope locks, top `KnowledgeFacts`, and `LEARNED_GUARDRAILS.md` rules.
     4. Returns `{ originalPrompt, enhancedPrompt, frozenPrefixHash,liveZoneTail, contextPackTokens, estimatedTokensSaved, lockedSymbolsCount, handlesUsed }`.
3. **`POST /bridge/capture` & `/api/cortex/bridge/capture`**:
   - Input: `{ project?: string, platform: string, url?: string, userText: string, assistantText: string, sessionId?: string }`
   - Action:
     1. Feeds the `[userText, assistantText]` turn directly into Engine 3 (`/memory/extract` + 10-Stage Distillation Pipeline).
     2. Records a `bridge.turn_captured` Continuity Timeline event.
     3. Returns `{ captured: true, sessionId, investigationHandle, factsCreated, factsMerged, repoBrainUpdated: true }`.
4. **`GET /bridge/userscript.user.js`**:
   - Serves a ready-to-install, self-contained **Tampermonkey / Violentmonkey / Greasemonkey Userscript** (`// ==UserScript== ...`) with:
     - Global keyboard shortcut **`Cmd+Shift+K` / `Ctrl+Shift+K`** to intercept the active textarea/`contenteditable` in ChatGPT, Claude.ai, Gemini, or DeepSeek, call `POST http://127.0.0.1:3000/bridge/enhance`, and replace the textarea with the cache-aligned Tier-1 prompt + `<cortex_sync_packet>`.
     - **`Cmd+Shift+M` / `Ctrl+Shift+M`** (or floating "⚡ CortexOS Sync" pill button) to capture the latest web chat turn into `POST http://127.0.0.1:3000/bridge/capture`.
5. **`cortexos bridge emit-extension [--out-dir <dir>]`**:
   - Writes a complete, load-unpacked **Chrome / Edge / Brave Manifest V3 Extension** into `.cortex/browser-extension/` (or `--out-dir`):
     - `manifest.json` (`manifest_version: 3`, commands `enhance-prompt` `Ctrl+Shift+K` / `Command+Shift+K`, `capture-turn` `Ctrl+Shift+M`).
     - `background.js` (service worker proxying requests to local CortexOS daemon so page CSP never blocks localhost calls).
     - `content.js` (DOM adapter for `textarea` and `div[contenteditable="true"]` + floating status toast).
     - `popup.html` + `popup.js` (live project switcher, token-savings badge, one-click Sync & Capture buttons).

---

## 5. Pillar 4: Live Ollama & Deterministic Benchmark Harness (`src/benchmark/benchmark-engine.mjs`)

### 5.1 What `cortexos benchmark` Measures
`runBenchmarkSuite({ projectSlug, suite = 'all', ollamaUrl })` runs a deterministic, reproducible benchmark workload and persists the result to `.cortex/benchmarks/latest.json`:

1. **`engines` Suite**:
   - **Engine 1 (Pre-Execution Router):** Runs 5 canonical prompts (symbol lookup, schema inspect, blast-radius check, multi-file refactor, bug investigation) and records routing accuracy (`100%` expected tool selection), latency (`p50`, `p95`), and local offload ratio.
   - **Engine 2 (Tier-1 Rewriter + `CacheAligner`):** Measures prompt structuring latency and verifies `frozenPrefixHash` is 100% identical across 3 consecutive turns on the same project DNA.
   - **Engine 3 (10-Stage Memory Distillation):** Benchmarks distilling a 6-turn bug-fix transcript into `@inv` + `@fact` handles, verifying deduplication (`occurrences++`), noise rejection (`FILE_VIEWED` dropped), and throughput (`turns/sec`).
   - **Live Ollama Probe:** Checks `ollamaUrl` (`http://127.0.0.1:11434`). If online, records live model name & inference latency alongside heuristic baseline; if offline, marks `ollamaMode: 'heuristic-fallback-verified'` and completes with zero errors.
2. **`reflexes` Suite**:
   - Benchmarks Ripwire `IMPACT` (`byDepth` traversal), `TEST_GATE`, `EDIT_CHECK` (in-memory arity breakage catch), `QUALITY_PANEL` (strict 4-of-6 vs all 6), and `PLAN_LANES` collision detection, asserting `p95 < 100ms` on the project graph.
3. **`crusher` Suite**:
   - Benchmarks Headroom `SmartCrusher` + `@ccr_<hash8>` on a 250-item synthetic log/JSON payload containing 2 `FATAL`/`ERROR` entries and 1 `2σ` outlier:
     - Asserts `compressionSavingsPct >= 75%`.
     - Asserts `100%` retention of `FATAL`/`ERROR` and `2σ` outlier items.
     - Asserts byte-exact lossless round-trip via `expandCcr(ccrHandle)`.

---

## 6. MCP Tool #14 (`cortex_ops`) & CLI Subcommand Additions

### 6.1 MCP Server Upgrade (`src/mcp/mcp-server.mjs`)
- Default profile now exposes **14 tools** (adding `cortex_ops` to the existing 13 tools).
- `--mcp-tools=core` continues to expose the lean **8 core tools** (`cortex_sync`, `cortex_rewrite_prompt`, `cortex_extract_memory`, `cortex_state`, `cortex_cto`, `cortex_reflex`, `cortex_brain`, `cortex_ccr`) so existing Phase 6 core-profile assertions remain 100% unchanged!
- **`cortex_ops` Actions**:
  - `DOCTOR_AUDIT`: Runs the 12-point diagnostic check (`autoFix?: boolean`).
  - `SERVICE_STATUS`: Returns background service & manifest health.
  - `BRIDGE_ENHANCE`: Enhances a browser/external prompt with `ContextPack` + `CacheAligner`.
  - `BRIDGE_CAPTURE`: Captures an external web chat turn into the 10-Stage Repository Brain.
  - `BENCHMARK_RUN`: Executes the benchmark harness (`suite?: 'all'|'engines'|'reflexes'|'crusher'`) and returns the telemetry report.

### 6.2 Unified CLI Subcommands (`scripts/cortexos-cli.mjs`)
Add 4 new first-class CLI commands (bringing total CLI commands from 16 to **20**, all supporting `--json`):

```bash
# 1. Self-Healing Diagnostics
cortexos doctor [--project <slug>] [--fix] [--json]

# 2. OS Background Service Supervisor
cortexos service (install|uninstall|start|stop|restart|status|logs) [--dir <path>] [--project <slug>] [--port <port>] [--lines <n>] [--dry-run] [--json]

# 3. Browser & Hotkey Bridge
cortexos bridge (status|enhance --prompt "<text>"|capture --user "<u_text>" --assistant "<a_text>" [--platform <name>]|emit-extension [--out-dir <dir>]|emit-userscript [--out <file>]) [--project <slug>] [--json]

# 4. Live Ollama & Heuristic Benchmark Harness
cortexos benchmark [--project <slug>] [--suite all|engines|reflexes|crusher] [--ollama-url <url>] [--json]
```

### 6.3 Package Version Bump (`v1.0.0`)
- Update `package.json` version to `"1.0.0"` (while keeping backward compatibility with all Phase 1–6 health/state assertions).

---

## 7. Gated Phase 7 Verification Suite (`tests/phase7.test.mjs`)

Create `tests/phase7.test.mjs` and wire `npm run test:p7` + include it in `npm run test:all`. All **40+ Phase 7 checks** MUST pass alongside Phases 1–6 and Python TDD (`316+` total checks):

1. **`cortexos doctor` Clean & Corrupt Recovery Checks (10 checks):**
   - Runs `GET /doctor` and `cortexos doctor --json` on a healthy project $\rightarrow$ verifies all 12 probes execute, `sqlite_graph_integrity` is `PASS`, `mcp_stdio_handshake` is `PASS`, and `ollama_connectivity` gracefully reports `PASS` or `WARN` without failing the suite.
   - Simulates 3 real faults: (a) injects an orphan edge in the graph, (b) queues an un-replayed commit in `.cortex/spool/pending-git-commits.jsonl`, and (c) deletes `.cortex/repo-brain.json`.
   - Runs `cortexos doctor --json` $\rightarrow$ confirms `sqlite_graph_integrity`, `git_spool_backlog`, and `repo_brain_synced` report `FAIL`/`WARN`.
   - Runs `cortexos doctor --fix --json` (or `POST /doctor/fix`) $\rightarrow$ confirms all 3 faults are automatically repaired (`fixedCount >= 3`) and a follow-up `cortexos doctor` returns `overallStatus: 'HEALTHY'`.
2. **`cortexos service` Supervisor & Manifest Checks (8 checks):**
   - Runs `cortexos service install --dry-run --json` and `cortexos service install --json` in a temp workspace $\rightarrow$ verifies `.cortex/service/ai.cortexos.daemon.plist` (valid XML plist with `ai.cortexos.daemon`) and `.cortex/service/cortexos.service` (valid systemd unit with `[Unit]`, `[Service]`, `[Install]`) are generated.
   - Verifies `GET /service/status` and `cortexos service status --json` report manifest paths and runtime telemetry.
3. **`cortexos bridge` Web Chat Enhancement, Turn Capture & Extension Bundle Checks (12 checks):**
   - Calls `POST /bridge/enhance` with a raw prompt $\rightarrow$ verifies `enhancedPrompt` includes `<cortex_sync_packet>`, `frozenPrefixHash` is stable across calls, and `contextPackTokens <= 1500`.
   - Calls `POST /bridge/capture` with a web chat turn (`platform: 'claude-web'`) $\rightarrow$ verifies Engine 3 distills it into an `@inv` investigation and `@fact` knowledge facts, updates `.cortex/repo-brain.json`, and appends a `bridge.turn_captured` timeline event.
   - Calls `GET /bridge/userscript.user.js` $\rightarrow$ verifies valid `// ==UserScript==` header, `@match https://chatgpt.com/*`, `@match https://claude.ai/*`, and hotkey handler `Ctrl+Shift+K`.
   - Runs `cortexos bridge emit-extension --out-dir <tmp>` $\rightarrow$ verifies `manifest.json` (`manifest_version: 3`), `background.js`, `content.js`, `popup.html`, and `popup.js` are emitted cleanly.
4. **`cortexos benchmark` Performance & Accuracy Checks (6 checks):**
   - Runs `POST /benchmark/run` and `cortexos benchmark --suite all --json` $\rightarrow$ verifies `engines`, `reflexes`, and `crusher` suites all pass (`overallPassed: true`), `crusher.compressionSavingsPct >= 75`, `crusher.losslessRoundTrip === true`, `engines.cacheAlignerPrefixStable === true`, and `.cortex/benchmarks/latest.json` is written to disk.
5. **MCP `cortex_ops` Stdio Round-Trips & Core Profile Preservation (4+ checks):**
   - Default MCP server lists **14 tools** (including `cortex_ops`); `--mcp-tools=core` still lists **8 tools**.
   - Executes `cortex_ops` stdio round-trips for `DOCTOR_AUDIT`, `BRIDGE_ENHANCE`, `BRIDGE_CAPTURE`, and `BENCHMARK_RUN`.
6. **Zero Regressions Across Phases 1–6 + Python TDD + ESLint:**
   - `P1 (33) + P2 (33) + P3 (35) + P4 (35) + P5 (35) + P5C (28) + P6 (51) + P7 (40+) + Python (26)` all green, ESLint clean.
