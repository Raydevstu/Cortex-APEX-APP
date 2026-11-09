# CortexOS — Phase 5: Unified CLI Wrapper, Git Hook Memory Loop & Unattended Watcher Blueprint

## 1. Overview & Architectural Scope
With Phases 1–4 complete (10 MCP tools live over stdio including `cortex_state` and `cortex_cto`, 135/135 checks passing across Phases 1–4), **Phase 5** closes the developer ergonomics and zero-touch automation loop by implementing:

1. **Part A — Unified `cortexos` CLI Wrapper (`bin/cortexos.mjs` / `src/cli/cortexos-cli.ts`):**
   - Exposes every command hinted at in the Visual Command Center and CTO advisories:
     - `cortexos init [--dir <path>] [--project <slug>]` — Repository bootstrap, AST scan, `.cortex/project-dna.json` + graph seed, and optional git-hook installation.
     - `cortexos status [--project <slug>] [--xml]` — CLI view of `cortex_state` (graph counts, token telemetry, active scope locks, recent timeline, CTO summary).
     - `cortexos scope [--project <slug>] (--lock <fqn...> | --unlock <fqn...> | --toggle <fqn> | --reset | --list)` — Direct CLI mutations backed by `/api/cortex/state` (`SET_SCOPE_LOCK`, `TOGGLE_SYMBOL_SCOPE`, `RESET_SCOPE_LOCK`).
     - `cortexos cto [--project <slug>] (audit [--force] | plan --goal "<text>" | dispatch --plan-id <id> | archive --plan-id <id>)` — Terminal interface to `/api/cortex/cto`.
     - `cortexos sync [--project <slug>] [--format xml|json]` — Prints the `<cortex_sync_packet>` to stdout (or copies to clipboard) for instant paste/pipe.
     - `cortexos hooks install` / `cortexos hooks run-post-commit` — Installs and runs the Git hook memory extraction loop.
     - `cortexos watch [--project <slug>]` — Starts the Unattended Session & Workspace Watcher daemon (`watcher_daemon.py` / Node bridge).

2. **Part B — Git Hook -> `cortex_extract_memory` Loop (`src/hooks/git-memory-hook.mjs`):**
   - Automatically triggers on `post-commit` (and optionally `post-merge`).
   - Extracts commit metadata (`git log -1`), structured unified diff summary (`git show --stat --patch`), touched file paths, and modified AST symbols.
   - Feeds a synthetic session transcript + diff payload into the **Memory Extraction pipeline (`cortex_extract_memory` / `/api/cortex/memory/extract`)** so architectural decisions, resolved bugs, completed tasks, and symbol changes made outside an AI chat (or finalized in a commit) are automatically persisted to the Knowledge Graph and Continuity Timeline.
   - Non-blocking & fail-open: never breaks `git commit` if the daemon is offline; queues to `.cortex/spool/pending-git-commits.jsonl` for replay on next daemon/CLI invocation.

3. **Part C — Unattended Transcript & Workspace Watcher Integration (`src/watcher/watcher_daemon.py`):**
   - Tails `~/.codex/sessions/*.jsonl`, `~/.claude/projects/**/*.jsonl`, and `~/.hermes/history.jsonl` via byte-offset cursors, plus watches workspace files for live AST symbol drift.

---

## 2. Existing Reference Files in the CortexOS Bundle
If you unpacked `cortexos-full-stack-v1.zip` (via `unpack_cortexos.py`), these reference implementations map directly to Phase 5:
- `src/cli/init.ts` — Initial `cortexos init` repository bootstrapper & AST scanner
- `src/watcher/watcher_daemon.py` — Unattended JSONL transcript tailer & workspace AST diff engine
- `tests/test_watcher.py` — 4 TDD tests covering byte-offset tailing, cross-platform transcript normalization, AST symbol diffing, and SHA-256 deduplication
- `hooks/sentinel_pretooluse.py` & `tests/test_sentinel.py` — PreToolUse AST scope lock enforcement

---

## 3. CLI Command Contract (`cortexos`)

### 3.1 Daemon Resolution & Environment Variables
- Uses `CORTEX_DAEMON_URL` (fallback `CORTEX_BASE_URL`, default `http://127.0.0.1:4300`).
- Uses `CORTEX_PROJECT` (fallback `.cortex/project-dna.json -> projectId/slug`, default `cortexos-daemon-self-audit`).
- Supports `--json` on all subcommands for deterministic machine-readable assertions in tests.

### 3.2 Exact Subcommand Matrix

| Command | Daemon Endpoint / Action | Behavior |
| :--- | :--- | :--- |
| `cortexos status [--project <slug>] [--xml] [--json]` | `GET /api/cortex/state?project=<slug>&includeXml=<bool>` | Displays node counts by label, token savings %, locked symbol FQNs, and top CTO recommendations. |
| `cortexos scope --list [--project <slug>]` | `GET /api/cortex/state?project=<slug>` | Lists all currently locked AST symbol FQNs (`scopeLock.lockedSymbolFqns`) and protected modules. |
| `cortexos scope --lock <fqn1> [fqn2...]` | `POST /api/cortex/state` (`action: "SET_SCOPE_LOCK"`) | Merges new FQNs into the active scope lock set (or sets exact lock list with `--exact`) and prints updated advisories. |
| `cortexos scope --toggle <fqn>` | `POST /api/cortex/state` (`action: "TOGGLE_SYMBOL_SCOPE"`) | Toggles a single AST symbol between `LOCKED` and `IN_SCOPE`. |
| `cortexos scope --reset` | `POST /api/cortex/state` (`action: "RESET_SCOPE_LOCK"`) | Resets symbol locks to defaults. |
| `cortexos cto audit [--force] [--project <slug>]` | `POST /api/cortex/cto` (`action: "AUDIT"`) | Runs AI CTO complexity/drift/hazard audit and prints recommendations with suggested CLI remediation commands. |
| `cortexos cto plan --goal "<goal>" [--execute]` | `POST /api/cortex/cto` (`action: "BUILD_DAG_PLAN"`) | Builds a topological multi-agent DAG plan; if `--execute` is passed, chains `DISPATCH_PLAN` immediately. |
| `cortexos cto dispatch --plan-id <id>` | `POST /api/cortex/cto` (`action: "DISPATCH_PLAN"`) | Executes Wave-1 local tools (`ast_symbol_lookup`, `schema_inspect`, etc.) and generates Tier-1 cloud payloads with scope guardrails. |
| `cortexos hooks install [--dir <repo>]` | Local filesystem `.git/hooks/post-commit` | Writes an executable `.git/hooks/post-commit` shim that calls `cortexos hooks run-post-commit` cleanly. |
| `cortexos hooks run-post-commit [--sha <rev>]` | `POST /api/cortex/memory/extract` (or MCP `cortex_extract_memory`) | Captures git commit diff + AST symbols touched, posts memory delta to daemon, or spools to `.cortex/spool/pending-git-commits.jsonl` if offline. |

---

## 4. Reference Implementation: Unified CLI (`scripts/cortexos-cli.mjs`)

```javascript
#!/usr/bin/env node
/**
 * File: scripts/cortexos-cli.mjs
 * Unified CortexOS CLI Wrapper for State, Scope Locks, AI CTO, Sync Packets, and Git Hook Memory Loop
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DEFAULT_DAEMON_URL =
  process.env.CORTEX_DAEMON_URL ||
  process.env.CORTEX_BASE_URL ||
  "http://127.0.0.1:4300";

function resolveDefaultProject(cwd = process.cwd()) {
  if (process.env.CORTEX_PROJECT) return process.env.CORTEX_PROJECT;
  const dnaPath = path.join(cwd, ".cortex", "project-dna.json");
  if (fs.existsSync(dnaPath)) {
    try {
      const dna = JSON.parse(fs.readFileSync(dnaPath, "utf8"));
      return dna.slug || dna.projectId || "cortexos-daemon-self-audit";
    } catch {
      // fall through
    }
  }
  return "cortexos-daemon-self-audit";
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        if (flags[key] !== undefined) {
          flags[key] = Array.isArray(flags[key]) ? [...flags[key], next] : [flags[key], next];
        } else {
          flags[key] = next;
        }
        i++;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

async function requestDaemon(endpoint, { method = "GET", body, baseUrl = DEFAULT_DAEMON_URL } = {}) {
  const url = new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const message = json?.error || json?.message || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

export async function runCli(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const [domain, subcommand] = positional;
  const project = flags.project || resolveDefaultProject();
  const baseUrl = flags["daemon-url"] || DEFAULT_DAEMON_URL;
  const asJson = Boolean(flags.json);

  if (!domain || domain === "help" || flags.help) {
    printHelp();
    return 0;
  }

  // 1. STATUS / STATE
  if (domain === "status" || domain === "state") {
    const includeXml = Boolean(flags.xml);
    const data = await requestDaemon(
      `/api/cortex/state?project=${encodeURIComponent(project)}&includeXml=${includeXml}`,
      { baseUrl }
    );
    if (asJson) {
      console.log(JSON.stringify(data, null, 2));
      return 0;
    }
    const locked = data.scopeLock?.lockedSymbolFqns || [];
    console.log(`CORTEXOS STATUS — project: ${data.project?.slug || project}`);
    console.log(`  Nodes: ${data.graphSummary?.totalNodes ?? data.graph?.nodes?.length ?? 0}`);
    console.log(`  Locked Symbols (${locked.length}): ${locked.join(", ") || "none"}`);
    console.log(`  CTO Recommendations: ${(data.ctoRecommendations || []).length}`);
    if (includeXml && data.syncPacketXml) {
      console.log("\n" + data.syncPacketXml);
    }
    return 0;
  }

  // 2. SCOPE LOCK MUTATIONS
  if (domain === "scope") {
    if (flags.reset) {
      const res = await requestDaemon(`/api/cortex/state`, {
        method: "POST",
        baseUrl,
        body: { project, action: "RESET_SCOPE_LOCK" },
      });
      outputResult(res, asJson, "Scope lock reset.");
      return 0;
    }
    if (flags.toggle) {
      const res = await requestDaemon(`/api/cortex/state`, {
        method: "POST",
        baseUrl,
        body: { project, action: "TOGGLE_SYMBOL_SCOPE", symbolFqn: String(flags.toggle) },
      });
      outputResult(res, asJson, `Toggled scope lock for ${flags.toggle}`);
      return 0;
    }
    if (flags.lock || flags.unlock) {
      const current = await requestDaemon(
        `/api/cortex/state?project=${encodeURIComponent(project)}`,
        { baseUrl }
      );
      const existing = new Set(current.scopeLock?.lockedSymbolFqns || []);
      const toLock = Array.isArray(flags.lock) ? flags.lock : flags.lock ? [flags.lock] : [];
      const toUnlock = Array.isArray(flags.unlock) ? flags.unlock : flags.unlock ? [flags.unlock] : [];
      for (const fqn of toLock) existing.add(fqn);
      for (const fqn of toUnlock) existing.delete(fqn);

      const res = await requestDaemon(`/api/cortex/state`, {
        method: "POST",
        baseUrl,
        body: {
          project,
          action: "SET_SCOPE_LOCK",
          lockedSymbolFqns: Array.from(existing),
        },
      });
      outputResult(res, asJson, `Updated active scope locks (${existing.size} locked).`);
      return 0;
    }

    // Default: list scope locks
    const state = await requestDaemon(
      `/api/cortex/state?project=${encodeURIComponent(project)}`,
      { baseUrl }
    );
    if (asJson) {
      console.log(JSON.stringify(state.scopeLock || {}, null, 2));
    } else {
      const locked = state.scopeLock?.lockedSymbolFqns || [];
      console.log(`LOCKED SYMBOLS (${locked.length}):`);
      locked.forEach((s) => console.log(`  - ${s}`));
    }
    return 0;
  }

  // 3. AI CTO COMMANDS
  if (domain === "cto") {
    const action = (subcommand || "audit").toLowerCase();
    if (action === "audit") {
      const res = await requestDaemon(`/api/cortex/cto`, {
        method: "POST",
        baseUrl,
        body: { project, action: "AUDIT", force: Boolean(flags.force) },
      });
      outputResult(res, asJson, `AI CTO Audit complete: ${(res.recommendations || []).length} findings.`);
      return 0;
    }
    if (action === "plan") {
      if (!flags.goal) throw new Error("Missing required --goal \"<objective>\"");
      const planRes = await requestDaemon(`/api/cortex/cto`, {
        method: "POST",
        baseUrl,
        body: { project, action: "BUILD_DAG_PLAN", goal: String(flags.goal) },
      });
      if (flags.execute && planRes.plan?.planId) {
        const dispatched = await requestDaemon(`/api/cortex/cto`, {
          method: "POST",
          baseUrl,
          body: { project, action: "DISPATCH_PLAN", planId: planRes.plan.planId },
        });
        outputResult(dispatched, asJson, `Built & dispatched DAG plan ${planRes.plan.planId}`);
        return 0;
      }
      outputResult(planRes, asJson, `Built DAG plan ${planRes.plan?.planId || ""}`);
      return 0;
    }
    if (action === "dispatch") {
      const planId = flags["plan-id"];
      if (!planId) throw new Error("Missing required --plan-id <id>");
      const res = await requestDaemon(`/api/cortex/cto`, {
        method: "POST",
        baseUrl,
        body: { project, action: "DISPATCH_PLAN", planId: String(planId) },
      });
      outputResult(res, asJson, `Dispatched DAG plan ${planId}`);
      return 0;
    }
    if (action === "archive") {
      const planId = flags["plan-id"];
      if (!planId) throw new Error("Missing required --plan-id <id>");
      const res = await requestDaemon(`/api/cortex/cto`, {
        method: "POST",
        baseUrl,
        body: { project, action: "ARCHIVE_PLAN", planId: String(planId) },
      });
      outputResult(res, asJson, `Archived DAG plan ${planId}`);
      return 0;
    }
  }

  // 4. GIT HOOKS -> CORTEX_EXTRACT_MEMORY LOOP
  if (domain === "hooks") {
    const action = (subcommand || "status").toLowerCase();
    const repoDir = path.resolve(String(flags.dir || process.cwd()));
    if (action === "install") {
      const hookPath = installGitPostCommitHook(repoDir);
      const payload = { ok: true, hookPath, repoDir };
      outputResult(payload, asJson, `Installed CortexOS git post-commit hook at ${hookPath}`);
      return 0;
    }
    if (action === "run-post-commit") {
      const result = await runGitPostCommitExtraction({
        repoDir,
        project,
        baseUrl,
        sha: flags.sha ? String(flags.sha) : "HEAD",
      });
      outputResult(result, asJson, `Processed post-commit memory extraction (${result.status})`);
      return 0;
    }
    if (action === "flush-spool") {
      const result = await flushPendingGitSpool({ repoDir, project, baseUrl });
      outputResult(result, asJson, `Flushed ${result.flushed} spooled git commit(s)`);
      return 0;
    }
  }

  throw new Error(`Unknown command: ${positional.join(" ")}`);
}
```

---

## 5. Git Hook -> `cortex_extract_memory` Loop Specification

### 5.1 How the Git Hook Loop Works
1. **`cortexos hooks install [--dir <repo>]`**:
   - Creates (or appends idempotently to) `.git/hooks/post-commit` with `chmod 0755`.
   - The hook executes:
     ```sh
     #!/usr/bin/env sh
     # CORTEXOS_MANAGED_HOOK
     node "<repo_or_cli_path>/scripts/cortexos-cli.mjs" hooks run-post-commit --dir "$(git rev-parse --show-toplevel)" >/dev/null 2>&1 || true
     ```
2. **`cortexos hooks run-post-commit [--sha HEAD]`**:
   - Inspects the commit via `git show --no-color --stat --patch -n 1 <sha>` and `git diff-tree --no-commit-id --name-only -r <sha>`.
   - Extracts modified symbols using regex/AST diff (`function`, `class`, `export const`, `def `) across changed files.
   - Builds a structured extraction payload:
     - `sourcePlatform`: `"git-hook"`
     - `sessionId`: `"git-commit-<shortSha>"`
     - `commitSha`, `author`, `subject`, `body`, `touchedFiles`, `detectedSymbols`
     - Synthesizes a 2-turn transcript (`user`: commit intent / subject; `assistant`: summary of files & AST symbols modified) and calls the daemon's memory extraction route (or MCP `cortex_extract_memory` handler).
   - **Offline Spooling Fallback (`.cortex/spool/pending-git-commits.jsonl`)**:
     - If the daemon is unreachable, appends the extraction payload to `.cortex/spool/pending-git-commits.jsonl` and exits `0` so `git commit` never fails.
     - Whenever the daemon is reachable (or on `cortexos hooks flush-spool`), any spooled commit events are replayed in FIFO order and deduplicated by `commitSha`.

---

## 6. Phase 5 Verification & Test Checklist

1. **CLI Status & Sync Packet Round-Trip:**
   - `node scripts/cortexos-cli.mjs status --project cortexos-daemon-self-audit --xml` exits `0`, prints real node counts (`42 nodes`), CTO recommendations (`6`), and `<cortex_sync_packet>`.
2. **CLI Scope Lock Lifecycle (`--lock`, `--toggle`, `--unlock`, `--reset`):**
   - `node scripts/cortexos-cli.mjs scope --lock "<fqn>"` mutates active scope lock via `/api/cortex/state`.
   - Staged modification of that locked symbol via `pre-execute` triggers the `422` AST Sentinel rejection.
   - `node scripts/cortexos-cli.mjs scope --reset` restores default lock state.
3. **CLI AI CTO Lifecycle (`audit`, `plan --execute`, `archive`):**
   - `node scripts/cortexos-cli.mjs cto audit` lists real complexity findings (including `parseInlineFormatting`).
   - `node scripts/cortexos-cli.mjs cto plan --goal "Refactor parser" --execute` builds the DAG and executes Wave-1 local subtasks (`ast_symbol_lookup` / `schema_inspect`).
4. **Git Hook -> `cortex_extract_memory` End-to-End Test:**
   - `node scripts/cortexos-cli.mjs hooks install --dir <temp_git_repo>` writes executable `.git/hooks/post-commit`.
   - Creating a real commit in `<temp_git_repo>` automatically triggers `run-post-commit`, extracts the commit diff + touched AST symbols, records the memory delta + continuity timeline event in CortexOS, and verifies offline spooling + replay (`flush-spool`) when the daemon is temporarily unreachable.
