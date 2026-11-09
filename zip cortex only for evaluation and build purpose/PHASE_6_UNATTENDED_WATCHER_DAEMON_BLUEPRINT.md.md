# PHASE 6 SPECIFICATION: Unattended Live Session & Workspace Watcher (`cortexos watch` + Blueprint Part C)

**Target Version:** CortexOS Daemon `v0.6.0`
**Prerequisite Baseline:** Phase 5 (`b9b366c` — Unified `cortexos` CLI, `/hooks/git` + `/memory/extract` loop, fail-open spooling, 170 JS checks + 9 Python TDD checks passing)

---

## 1. Objective & Architectural Scope

Phase 5 wired synchronous Git commit memory capture (`post-commit` -> `/hooks/git` + `/memory/extract` with offline spooling).
**Phase 6 (Blueprint Part C)** closes the remaining unattended loop: capturing live AI coding sessions (**Codex CLI**, **Claude Code**, **Hermes Agent**, **OpenCode**, **Cursor**) and **uncommitted workspace AST symbol mutations** in real time—even before a developer runs `git commit`.

### Core Deliverables for Phase 6
1. **Unattended Watcher Engine (`src/watcher/unattended-watcher.mjs` + Python parity in `src/watcher/watcher_daemon.py`):**
   - **Incremental JSONL Byte-Offset Cursors:** Tails multi-platform session transcripts (`~/.codex/sessions/**/*.jsonl`, `~/.claude/projects/**/*.jsonl`, `~/.hermes/logs/**/*.jsonl`, `~/.opencode/sessions/**/*.jsonl`, or custom directories) using persistent byte offsets (`inode` + `byteOffset` stored in `.cortex/watcher-cursors.json`) so large logs are never re-read from byte 0 and partial writes are buffered safely.
   - **Multi-Platform Transcript Normalizer:** Normalizes heterogeneous event schemas (`codex`, `claude`, `hermes`, `opencode`, `generic`) into canonical `{ role, content, toolName, filePaths, timestamp, platform, sessionId }` turns.
   - **Workspace AST Symbol Diff Detector:** Computes live AST symbol signature & body-hash diffs (`ADDED`, `MODIFIED`, `REMOVED`) across dirty/modified workspace files and correlates them with active transcript turns.
   - **SHA-256 Content Deduplication & Idle/Turn-Threshold Flush:** Deduplicates identical turns/batches (`sha256(platform + sessionId + normalizedTurns + astDiffs)`) and flushes to `/memory/extract` (Engine 3) + timeline (`watcher.batch_ingested`) when either:
     - `batchTurnThreshold` (default: `4` turns) is reached, OR
     - `idleFlushMs` (default: `15000` ms) elapses after activity, OR
     - `--once` / `FLUSH_NOW` is invoked.
   - **Fail-Open Offline Spooling:** If the CortexOS daemon is unreachable during a watcher flush, batches are appended atomically to `.cortex/spool/pending-watcher-batches.jsonl` and automatically replayed on the next reachable tick or via `cortexos watch --flush-spool`.

2. **Daemon HTTP Endpoints & MCP Tool (`cortex_watcher`):**
   - `GET /watcher/status?project=<slug|id>` (and `/api/cortex/watcher`): Returns watcher cursor states, ingested batch counts, deduplicated skip counts, active watched roots, recent AST symbol diffs, and pending watcher spool count.
   - `POST /watcher/ingest`: Accepts normalized watcher batches (`turns`, `astDiffs`, `platform`, `sessionId`, `batchHash`), deduplicates by `batchHash`, runs Engine 3 (`/memory/extract` pipeline), records a `watcher.batch_ingested` timeline event, updates AST symbol nodes in the graph, and returns `{ status: "INGESTED" | "DEDUP_SKIPPED", memoryDeltaId, timelineEventId }`.
   - `POST /watcher/scan`: Triggers an on-demand incremental scan of configured transcript/workspace directories (`scanDirs`, `workspaceDir`, `project`).
   - **MCP Tool #11 (`cortex_watcher`):** Exposes `STATUS`, `SCAN_ONCE`, `INGEST_BATCH`, `FLUSH_SPOOL`, and `RESET_CURSORS` over stdio for Claude Desktop, Codex, and Hermes.

3. **Unified CLI Extension (`cortexos watch` in `scripts/cortexos-cli.mjs`):**
   - `cortexos watch status [--project <slug>] [--json]`
   - `cortexos watch once [--project <slug>] [--sessions-dir <dir>] [--workspace <dir>] [--json]`
   - `cortexos watch start [--project <slug>] [--sessions-dir <dir>] [--workspace <dir>] [--interval-ms <ms>] [--json]`
   - `cortexos watch flush-spool [--project <slug>] [--json]`
   - `cortexos watch reset-cursors [--project <slug>] [--json]`

---

## 2. Data Contracts & Persistent State Files

### 2.1 Cursor State File (`.cortex/watcher-cursors.json`)

```json
{
  "version": 1,
  "updatedAt": "2026-11-08T06:50:00.000Z",
  "files": {
    "/abs/path/to/session-01.jsonl": {
      "inode": 1234567,
      "byteOffset": 4096,
      "updatedAt": "2026-11-08T06:50:00.000Z",
      "platform": "codex",
      "sessionId": "session-01"
    }
  },
  "workspaceSnapshots": {
    "src/auth/jwt.ts": {
      "sha256": "a94f...",
      "symbols": {
        "src/auth/jwt.ts#verifyJwt": {
          "kind": "function",
          "signature": "export async function verifyJwt(token: string)",
          "bodyHash": "d3b07384d113edec49eaa6238ad5ff00"
        }
      }
    }
  },
  "ingestedBatchHashes": [
    "8f4e2b09c1..."
  ]
}
```

### 2.2 Offline Watcher Spool (`.cortex/spool/pending-watcher-batches.jsonl`)
Each line is a self-contained JSON record:

```json
{
  "spooledAt": "2026-11-08T06:51:00.000Z",
  "project": "cortexos-daemon-self-audit",
  "batchHash": "8f4e2b09c1a2...",
  "platform": "codex",
  "sessionId": "codex-session-20261108",
  "sourceFile": "/tmp/sessions/codex-session-20261108.jsonl",
  "byteRange": [0, 1842],
  "turns": [
    {
      "role": "user",
      "content": "Refactor parseInlineFormatting to reduce cyclomatic complexity",
      "timestamp": "2026-11-08T06:50:10.000Z"
    },
    {
      "role": "assistant",
      "content": "Extracted tokenizeInlineRuns helper and locked public signature",
      "toolName": "write_file",
      "filePaths": ["skills/pptx/html2pptx1.js"],
      "timestamp": "2026-11-08T06:50:22.000Z"
    }
  ],
  "astDiffs": [
    {
      "filePath": "skills/pptx/html2pptx1.js",
      "fqn": "skills/pptx/html2pptx1.js#tokenizeInlineRuns",
      "changeType": "ADDED",
      "kind": "function",
      "signature": "function tokenizeInlineRuns(node)",
      "bodyHash": "4e1243bd22c66e76c2ba9eddc1f91394"
    }
  ]
}
```

---

## 3. Core Component Specifications

### 3.1 Incremental JSONL Reader & Multi-Platform Normalizer

Must handle:
1. **Byte-offset slicing:** Open file descriptor, inspect `fs.fstatSync(fd)` (`size`, `ino`).
   - If `size < savedCursor.byteOffset` or (`savedCursor.inode && savedCursor.inode !== stat.ino`), reset `byteOffset = 0` (file truncated/rotated).
   - Read bytes `[byteOffset, size)`.
   - Split on `\n`. **Crucial safety rule:** If the buffer does not end with `\n`, hold back the trailing incomplete line by advancing `byteOffset` only up to the byte immediately following the last complete `\n`.
2. **Platform Auto-Detection & Event Normalization:**
   - **Codex CLI format:** `{ type: "message" | "function_call" | "tool_result", role, content, name, arguments, timestamp }`
   - **Claude Code format:** `{ type: "user" | "assistant", message: { role, content: [...] }, sessionId, timestamp }`
   - **Hermes / OpenCode format:** `{ event: "turn" | "tool_exec", sender, text, tool, files_modified, ts }`
   - **Generic fallback:** `{ role, content, text, prompt, response }`
   - Extract referenced file paths from tool arguments (`path`, `file_path`, `filePath`, `files_modified`) or inline backtick paths matching repo files.

### 3.2 Workspace AST Symbol Diff Engine

When the watcher runs a scan tick over `workspaceDir`:
1. Enumerate tracked source files (`.js`, `.mjs`, `.ts`, `.tsx`, `.py`), ignoring `node_modules`, `.git`, `.cortex`, `dist`, `build`, `.next`.
2. For any file whose SHA-256 changed compared to `workspaceSnapshots[relPath].sha256` (or new/deleted file):
   - Parse top-level and class/module symbols into `{ fqn, kind, signature, bodyHash }`.
   - Compare against previous snapshot symbols for `relPath`:
     - Symbol key in new but not old $\rightarrow$ `changeType: "ADDED"`
     - Symbol key in both but `bodyHash` or `signature` differs $\rightarrow$ `changeType: "MODIFIED"`
     - Symbol key in old but not new $\rightarrow$ `changeType: "REMOVED"`
3. If `changeType === "MODIFIED"` or `"REMOVED"` touches a symbol currently in the project's `lockedSymbolFqns`, emit a high-priority `watcher.scope_violation_detected` warning in the batch metadata and continuity timeline so the Command Center and AI CTO surface out-of-band edits to locked symbols immediately.

### 3.3 Batch Deduplication & Engine 3 (`/memory/extract`) Integration

1. Compute deterministic `batchHash`:
   ```js
   const canonicalPayload = JSON.stringify({
     project: projectSlug,
     platform,
     sessionId,
     turns: normalizedTurns.map(t => ({ role: t.role, content: t.content, toolName: t.toolName || null })),
     astDiffs: astDiffs.map(d => ({ fqn: d.fqn, changeType: d.changeType, bodyHash: d.bodyHash || null }))
   });
   const batchHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
   ```
2. If `batchHash` is already present in `.cortex/watcher-cursors.json#ingestedBatchHashes` or daemon-side watcher history:
   - Advance the byte cursor, increment `dedupSkippedCount`, and skip re-running `/memory/extract`.
3. Otherwise, dispatch `POST /watcher/ingest` to the daemon:
   - Daemon invokes the Engine 3 memory extraction pipeline (same core extractor used by `/memory/extract` in Phase 5, tagged with `source: "unattended-watcher"` and `sessionId: "watcher-<platform>-<sessionId>"`).
   - Daemon updates graph AST nodes/edges from `astDiffs`.
   - Daemon appends `watcher.batch_ingested` (and `watcher.scope_violation_detected` if any locked FQN was modified) to the project continuity timeline.
   - If the daemon is offline/unreachable, append the batch to `.cortex/spool/pending-watcher-batches.jsonl` and return `{ ok: true, spooled: true, batchHash }` (fail-open).

---

## 4. CLI Subcommand Specification (`cortexos watch`)

Extend `scripts/cortexos-cli.mjs` with the `watch` command group:

| Command | Behavior |
| :--- | :--- |
| `cortexos watch status [--project <slug>] [--json]` | Queries `GET /watcher/status` + local `.cortex/watcher-cursors.json` and `.cortex/spool/pending-watcher-batches.jsonl`. Prints tracked files, byte cursors, total ingested batches, dedup skips, scope drift alerts, and pending spool count. |
| `cortexos watch once [--project <slug>] [--sessions-dir <path>] [--workspace <path>] [--json]` | Runs one deterministic incremental scan over `--sessions-dir` (or default `.cortex/sessions` + configured roots) and `--workspace`, ingests any new turns/AST diffs via `/watcher/ingest` (or spools offline), updates `.cortex/watcher-cursors.json`, and exits `0`. |
| `cortexos watch start [--project <slug>] [--sessions-dir <path>] [--workspace <path>] [--interval-ms <ms>] [--max-ticks <n>] [--json]` | Starts the continuous polling/fs.watch loop (default `interval-ms: 2000`). Supports `--max-ticks <n>` for deterministic test termination and clean `SIGINT`/`SIGTERM` shutdown. Automatically replays pending watcher spool when daemon is online. |
| `cortexos watch flush-spool [--project <slug>] [--json]` | Replays `.cortex/spool/pending-watcher-batches.jsonl` in FIFO order to `POST /watcher/ingest` with in-file + cross-run `batchHash` deduplication and atomic spool rewrite. |
| `cortexos watch reset-cursors [--project <slug>] [--json]` | Clears `.cortex/watcher-cursors.json` (and resets daemon watcher cursor state if online) so transcripts can be re-ingested from byte 0 when requested. |

---

## 5. MCP Server Tool #11 (`cortex_watcher`)

Register `cortex_watcher` in the MCP tool registry (`scripts/mcp-cli-demo.mjs` and the MCP server handler) so total MCP tools increase from **10 $\rightarrow$ 11**:

```json
{
  "name": "cortex_watcher",
  "description": "Control and inspect the CortexOS Unattended Transcript & Workspace AST Watcher (status, scan_once, ingest_batch, flush_spool, reset_cursors).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["STATUS", "SCAN_ONCE", "INGEST_BATCH", "FLUSH_SPOOL", "RESET_CURSORS"],
        "default": "STATUS"
      },
      "project": { "type": "string", "description": "Project ID or slug" },
      "sessionsDir": { "type": "string", "description": "Optional directory of JSONL session transcripts to scan" },
      "workspaceDir": { "type": "string", "description": "Optional workspace root for live AST diff detection" },
      "batch": { "type": "object", "description": "Normalized watcher batch payload when action=INGEST_BATCH" }
    }
  }
}
```

---

## 6. Required Phase 6 Verification & Test Suite (GATED)

Create a dedicated Phase 6 test suite (35+ assertions) while maintaining 100% pass rate on Phases 1–5 and Python TDD:

1. **Incremental JSONL Cursor & Partial-Line Holdback Tests:**
   - Write 2 complete JSONL lines + 1 incomplete trailing line (no `\n`) to a temp session file.
   - Run `cortexos watch once` $\rightarrow$ verify only the 2 complete turns are ingested and `byteOffset` stops before the partial line.
   - Append the remainder of line 3 + `\n` $\rightarrow$ run `cortexos watch once` $\rightarrow$ verify only turn 3 is ingested (`byteRange` starts at previous offset, zero duplicate re-reads).
   - Truncate/rotate the file $\rightarrow$ verify cursor auto-resets to `0` and ingests the new content cleanly.
2. **Multi-Platform Normalization Tests:**
   - Verify Codex CLI, Claude Code, and Hermes/OpenCode JSONL fixtures normalize into canonical turns with accurate `role`, `content`, `toolName`, and extracted `filePaths`.
3. **Live Workspace AST Diff & Scope Violation Detection Tests:**
   - Lock an AST symbol via `cortexos scope --lock "<fqn>"`.
   - Modify that symbol's implementation in a temporary workspace without committing to git.
   - Run `cortexos watch once --workspace <tmpDir>` $\rightarrow$ verify `astDiffs` detects `MODIFIED` on `<fqn>` and emits a `watcher.scope_violation_detected` event in the timeline and watcher status.
4. **SHA-256 Batch Deduplication Tests:**
   - Replays or duplicate JSONL emissions with the same `batchHash` return `DEDUP_SKIPPED` and do not create duplicate memory deltas or timeline entries.
5. **Fail-Open Offline Spool + FIFO Replay Tests:**
   - Run `cortexos watch once --daemon-url http://127.0.0.1:59999` (unreachable) $\rightarrow$ verify exit code `0` and batch written to `.cortex/spool/pending-watcher-batches.jsonl`.
   - Run `cortexos watch flush-spool` against the live daemon $\rightarrow$ verify FIFO ingestion, cross-run `batchHash` dedupe, and atomic spool cleanup.
6. **MCP `cortex_watcher` Round-Trip & Full Regression Gate:**
   - Verify `cortex_watcher` over stdio (`STATUS`, `SCAN_ONCE`, `INGEST_BATCH`, `FLUSH_SPOOL`, `RESET_CURSORS`).
   - All Phase 1 (32), Phase 2 (33), Phase 3 (35), Phase 4 (35), Phase 5 (35), Phase 6 (35+), Python TDD (`tests/test_watcher.py` + `tests/test_sentinel.py` + contract tests), and ESLint checks must pass cleanly.
