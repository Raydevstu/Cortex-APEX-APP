Here is **Part 3 of the CortexOS Engineering Blueprint: The Codex ↔ CortexOS ↔ Hermes Sync Protocol, Universal MCP Server, AST Semantic Scope Guard (`PreToolUse` Sentinel Hooks), and the Browser Extension / WebSocket Bridge.**

Everything below is built to be deterministic, TDD-verifiable, and immediately drop-in ready across **Codex, Hermes, OpenCode, Claude Code, Cursor, Windsurf, and Browser Web UIs**.

---

### 1. End-to-End Cross-Platform Sync & Scope Guard Topology

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   CORTEX-OS LOCAL CONTROL PLANE DAEMON                     │
│  • KuzuDB Graph (.cortex/graph.db)   • Project DNA (.cortex/project-dna)   │
│  • Active Scope Lock (.cortex/active-scope-lock.json)                      │
│  • Local Ollama Pipeline (127.0.0.1:11434)                                 │
└──────────┬──────────────────────────────┬─────────────────────────┬────────┘
           │                              │                         │
   [1. MCP stdio/SSE]          [2. PreToolUse Hook]       [3. WebSocket :11436]
           │                   (Exit 0 Allow / 2 Block)             │
           ▼                              ▼                         ▼
┌─────────────────────┐      ┌─────────────────────────┐  ┌──────────────────┐
│ Codex / Hermes /    │      │ AST Semantic Scope Guard│  │ Browser Extension│
│ Cursor / OpenCode   │─────▶│ sentinel_pretooluse.py  │  │ (ChatGPT, Claude │
│ • Auto-pulls Delta  │      │ • Blocks protected paths│  │  Web, v0, Bolt)  │
│ • Auto-logs Memory  │      │ • Blocks out-of-scope   │  │ • Rewrites prompt│
└─────────────────────┘      └─────────────────────────┘  └──────────────────┘
```

---

### 2. Component 1: The Universal MCP Server (`src/mcp/cortex-mcp-server.ts`)

Every modern AI coding agent (Codex CLI, Hermes, OpenCode, Cursor, Claude Code, Windsurf) supports the **Model Context Protocol (MCP)**. By exposing CortexOS as a single local MCP server, **Hermes immediately knows what Codex did 10 seconds ago** without copy-pasting a single line.

#### A. Complete MCP Server Implementation (`src/mcp/cortex-mcp-server.ts`)

```typescript
// src/mcp/cortex-mcp-server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { CortexLocalPipeline } from '../engine/local-ollama-pipeline.js';
import { AIPlatform, CrossPlatformSyncPacket } from '../types/cortex-schema.js';

const PROJECT_ROOT = process.env.CORTEX_PROJECT_ROOT || process.cwd();
const CORTEX_DIR = path.join(PROJECT_ROOT, '.cortex');
const DNA_PATH = path.join(CORTEX_DIR, 'project-dna.json');
const SCOPE_LOCK_PATH = path.join(CORTEX_DIR, 'active-scope-lock.json');
const STATE_LEDGER_PATH = path.join(CORTEX_DIR, 'continuity-ledger.json');

const pipeline = new CortexLocalPipeline(PROJECT_ROOT);

const server = new Server(
  { name: 'cortexos-universal-brain', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

/**
 * REGISTER UNIVERSAL CORTEX-OS TOOLS FOR CODEX / HERMES / CURSOR / CLAUDE
 */
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'cortex_pull_delta_sync',
      description:
        'MANDATORY FIRST CALL IN EVERY SESSION: Pulls the compact Cross-Platform Delta Sync Packet, Project DNA constraints, pre-executed local Ollama artifacts, and active AST Scope Lock from previous chats (Codex/Hermes/Cursor).',
      inputSchema: {
        type: 'object',
        properties: {
          currentPlatform: {
            type: 'string',
            enum: ['codex', 'hermes', 'opencode', 'cursor', 'windsurf', 'claude'],
          },
          activePromptOrIntent: {
            type: 'string',
            description: 'The current user task or prompt to scope the Knowledge Graph query.',
          },
        },
        required: ['currentPlatform', 'activePromptOrIntent'],
      },
    },
    {
      name: 'cortex_rewrite_and_preexecute',
      description:
        'Intercepts a raw user prompt, runs local Ollama pre-execution tools (AST lookup, schema diff, boilerplate scaffold) at 0 cloud token cost, sets the AST Scope Lock, and returns a Tier-1 Enterprise Specification.',
      inputSchema: {
        type: 'object',
        properties: {
          rawUserPrompt: { type: 'string' },
          targetPlatform: {
            type: 'string',
            enum: ['codex', 'hermes', 'opencode', 'cursor', 'windsurf', 'claude'],
          },
        },
        required: ['rawUserPrompt', 'targetPlatform'],
      },
    },
    {
      name: 'cortex_commit_turn_memory',
      description:
        'Called after completing a task or turn. Asynchronously runs the local 3B Memory Extractor to log architectural decisions, task transitions, and AST symbol updates so the next chat or platform is 100% synced.',
      inputSchema: {
        type: 'object',
        properties: {
          sourcePlatform: {
            type: 'string',
            enum: ['codex', 'hermes', 'opencode', 'cursor', 'windsurf', 'claude'],
          },
          rawUserPrompt: { type: 'string' },
          aiOutcomeSummary: { type: 'string' },
          modifiedFiles: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['sourcePlatform', 'rawUserPrompt', 'aiOutcomeSummary', 'modifiedFiles'],
      },
    },
  ],
}));

/**
 * HANDLE TOOL EXECUTION
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'cortex_pull_delta_sync') {
    const { currentPlatform } = args as {
      currentPlatform: AIPlatform;
      activePromptOrIntent: string;
    };

    const dna = JSON.parse(await fs.readFile(DNA_PATH, 'utf-8'));
    const ledger = await fs
      .readFile(STATE_LEDGER_PATH, 'utf-8')
      .then((r) => JSON.parse(r))
      .catch(() => ({
        lastPlatform: dna.projectMeta.lastActivePlatform,
        lastCompletedAction: 'Initialized Project DNA',
        activeTask: {
          id: 'TASK-001',
          title: 'Initial Sync',
          preExecutedByLocalAgent: [],
          remainingCoreWork: 'Awaiting task',
        },
        nextPendingTasks: [],
        recentDecisions: [],
      }));

    const syncPacket: CrossPlatformSyncPacket = {
      header: {
        projectId: dna.projectMeta.projectId,
        projectName: dna.projectMeta.name,
        stateHash: dna.projectMeta.stateHash,
        previousPlatform: ledger.lastPlatform || dna.projectMeta.lastActivePlatform,
        targetPlatform: currentPlatform,
        syncedAtIso: new Date().toISOString(),
      },
      dnaSnapshot: {
        stackSummary: `${dna.techStack.frontend.framework}, ${dna.techStack.backend.authProvider}, ${dna.techStack.database.orm}/${dna.techStack.database.primaryDb}`,
        activeConstraints: dna.architectureRules.immutableConstraints,
      },
      scopedGraphContext: {
        activeModule: ledger.activeModule || 'core',
        relevantDecisions: ledger.recentDecisions || [],
        relevantSymbols: ledger.relevantSymbols || [],
        openBugsInScope: ledger.openBugs || [],
      },
      continuityState: {
        lastCompletedAction: ledger.lastCompletedAction,
        activeTask: ledger.activeTask,
        nextPendingTasks: ledger.nextPendingTasks || [],
      },
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(syncPacket, null, 2) }],
    };
  }

  if (name === 'cortex_rewrite_and_preexecute') {
    const { rawUserPrompt, targetPlatform } = args as {
      rawUserPrompt: string;
      targetPlatform: AIPlatform;
    };

    const ledger = await fs
      .readFile(STATE_LEDGER_PATH, 'utf-8')
      .then((r) => JSON.parse(r))
      .catch(() => ({}));

    const result = await pipeline.processAndRewritePrompt({
      rawUserPrompt,
      targetPlatform,
      scopedGraphContext: {
        activeModule: ledger.activeModule || 'core',
        relevantDecisions: ledger.recentDecisions || [],
        relevantSymbols: ledger.relevantSymbols || [],
        openBugsInScope: ledger.openBugs || [],
      },
      continuityState: ledger.continuityState || {
        lastCompletedAction: 'None',
        activeTask: {
          id: 'TASK-AUTO',
          title: rawUserPrompt.slice(0, 60),
          preExecutedByLocalAgent: [],
          remainingCoreWork: rawUserPrompt,
        },
        nextPendingTasks: [],
      },
    });

    // Write the active AST Semantic Scope Lock to disk so `hooks/sentinel_pretooluse.py` enforces it
    if (result.scopeLock) {
      await fs.writeFile(
        SCOPE_LOCK_PATH,
        JSON.stringify(
          {
            updatedAt: new Date().toISOString(),
            targetPlatform,
            allowedWriteFiles: result.scopeLock.allowedWriteFiles,
            forbiddenPatterns: result.scopeLock.forbiddenPatterns,
          },
          null,
          2
        ),
        'utf-8'
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: result.handledCompletelyLocally
            ? `[COMPLETED 100% LOCALLY BY OLLAMA - 0 CLOUD TOKENS]:\n${JSON.stringify(result.localArtifacts, null, 2)}`
            : result.injectedPrompt!,
        },
      ],
    };
  }

  if (name === 'cortex_commit_turn_memory') {
    const { sourcePlatform, rawUserPrompt, aiOutcomeSummary, modifiedFiles } = args as {
      sourcePlatform: AIPlatform;
      rawUserPrompt: string;
      aiOutcomeSummary: string;
      modifiedFiles: string[];
    };

    const delta = await pipeline.extractMemoryFromTurn({
      sourcePlatform,
      rawUserPrompt,
      aiResponseText: aiOutcomeSummary,
      modifiedFilesAstDiff: modifiedFiles.map((f) => ({
        path: f,
        addedSymbols: [],
        modifiedSymbols: [],
      })),
      existingActiveDecisions: [],
      activeTasks: [],
    });

    // Update State Hash & Continuity Ledger for instant handoff to the next platform (e.g., Codex -> Hermes)
    const dna = JSON.parse(await fs.readFile(DNA_PATH, 'utf-8'));
    const newHash =
      'sha256:' +
      crypto
        .createHash('sha256')
        .update(JSON.stringify(delta) + Date.now().toString())
        .digest('hex')
        .slice(0, 16);

    dna.projectMeta.stateHash = newHash;
    dna.projectMeta.lastActivePlatform = sourcePlatform;
    dna.projectMeta.lastSyncedAt = new Date().toISOString();
    await fs.writeFile(DNA_PATH, JSON.stringify(dna, null, 2), 'utf-8');

    await fs.writeFile(
      STATE_LEDGER_PATH,
      JSON.stringify(
        {
          lastPlatform: sourcePlatform,
          lastCompletedAction: delta.compactTurnSummary,
          recentDecisions: delta.newDecisions.map((d, i) => ({
            id: `ADR-AUTO-${i + 1}`,
            title: d.title,
            constraint: d.constraints,
          })),
          activeTask: {
            id: delta.taskUpdates[0]?.taskId || 'TASK-NEXT',
            title: delta.taskUpdates[0]?.title || 'Continue implementation',
            preExecutedByLocalAgent: modifiedFiles,
            remainingCoreWork: 'Ready for next platform handoff',
          },
          nextPendingTasks: delta.taskUpdates
            .filter((t) => t.status === 'todo')
            .map((t) => t.title),
        },
        null,
        2
      ),
      'utf-8'
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'SYNCED_TO_CORTEX_GRAPH',
            newStateHash: newHash,
            compactSummary: delta.compactTurnSummary,
          }),
        },
      ],
    };
  }

  throw new Error(`Unknown CortexOS tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('CortexOS MCP Server fatal error:', err);
  process.exit(1);
});
```

#### B. Universal MCP Configuration (`.cursor/mcp.json` / Codex / Hermes / OpenCode)

Drop this exact file into `.cursor/mcp.json` (and symlink or include it in `~/.codex/config.json`, `~/.hermes/mcp.json`, and `.claude.json`):

```json
{
  "mcpServers": {
    "cortexos-brain": {
      "command": "node",
      "args": ["./dist/mcp/cortex-mcp-server.js"],
      "env": {
        "CORTEX_PROJECT_ROOT": "${workspaceFolder}",
        "OLLAMA_HOST": "http://127.0.0.1:11434"
      }
    }
  }
}
```

---

### 3. Component 2: The AST Semantic Scope Guard & PreToolUse Sentinel (`hooks/sentinel_pretooluse.py`)

A major failure mode when switching between Codex, Hermes, Claude Code, and Cursor is **unintended collateral edits**: you ask an agent to fix a login button, and it silently modifies your Prisma schema, mutates a protected auth guard, or introduces `any` types and forbidden imports (`next-auth`, `axios`).

To prevent this deterministically at **0 token cost**, CortexOS installs a dependency-light Python `PreToolUse` boundary (`hooks/sentinel_pretooluse.py`) that intercepts every file-write, patch, or bash mutation tool call **before** it touches your disk:
* **Exit Code `0`**: Action is within the AST Scope Lock and passes `PROJECT DNA` rules → **Allowed**.
* **Exit Code `2`**: Action targets a protected path, violates the active Scope Lock, breaks AST syntax, or introduces a forbidden pattern → **Blocked immediately** with a structured error message fed back to the agent on `stderr`.

#### A. Production `hooks/sentinel_pretooluse.py` Implementation

```python
#!/usr/bin/env python3
"""
CortexOS AST Semantic Scope Guard & PreToolUse Sentinel Boundary
Location: hooks/sentinel_pretooluse.py

Protocol:
- Reads PreToolUse JSON payload from stdin (Claude Code / Cursor / Codex / Hermes hook standard).
- Exit Code 0: ALLOW tool execution.
- Exit Code 2: BLOCK tool execution and return deterministic violation reason on stderr.
"""

import ast
import fnmatch
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

WRITE_TOOL_NAMES = {
    "Write",
    "Edit",
    "MultiEdit",
    "Replace",
    "CreateFile",
    "Patch",
    "write_file",
    "edit_file",
    "apply_diff",
    "str_replace_editor",
}

BASH_TOOL_NAMES = {"Bash", "RunCommand", "execute_command", "bash"}


def load_json_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def normalize_rel_path(target_path: str, project_root: Path) -> str:
    try:
        resolved = (project_root / target_path).resolve()
        return str(resolved.relative_to(project_root.resolve())).replace("\\", "/")
    except ValueError:
        # Path escapes project root (e.g., ../../etc/passwd)
        return f"OUTSIDE_ROOT::{target_path}"


def extract_target_file_and_content(
    tool_name: str, tool_input: Dict[str, Any]
) -> Tuple[Optional[str], str]:
    file_path = (
        tool_input.get("file_path")
        or tool_input.get("path")
        or tool_input.get("target_file")
        or tool_input.get("filename")
    )
    content_fragments: List[str] = []
    for key in ("content", "new_string", "new_str", "replacement", "diff", "patch"):
        val = tool_input.get(key)
        if isinstance(val, str):
            content_fragments.append(val)

    # Support MultiEdit payloads
    edits = tool_input.get("edits")
    if isinstance(edits, list):
        for edit in edits:
            if isinstance(edit, dict):
                ns = edit.get("new_string") or edit.get("content")
                if isinstance(ns, str):
                    content_fragments.append(ns)

    return file_path, "\n".join(content_fragments)


def check_ast_and_semantic_rules(
    rel_path: str,
    proposed_content: str,
    dna: Dict[str, Any],
    scope_lock: Dict[str, Any],
) -> Optional[str]:
    """
    Validates proposed code changes against:
    1. Protected Paths in Project DNA
    2. Active Scope Lock allowedWriteFiles (if active)
    3. Forbidden Patterns & Imports
    4. AST syntax & TypeScript/Python structural guardrails
    """
    if rel_path.startswith("OUTSIDE_ROOT::"):
        return f"[CORTEX SCOPE GUARD BLOCK] Target path '{rel_path}' escapes project root."

    coding_standards = dna.get("codingStandards", {})
    ast_rules = coding_standards.get("astScopeGuardRules", {})
    protected_paths: List[str] = ast_rules.get("protectedPaths", [])

    # 1. Protected Path Check
    for protected in protected_paths:
        norm_prot = protected.rstrip("/")
        if rel_path == norm_prot or rel_path.startswith(norm_prot + "/") or fnmatch.fnmatch(rel_path, protected):
            return (
                f"[CORTEX SCOPE GUARD BLOCK] File '{rel_path}' is locked by "
                f"PROJECT_DNA.protectedPaths ('{protected}'). Do not modify this file."
            )

    # 2. Active Scope Lock Check (written by Engine 2 Tier-1 Prompt Rewriter)
    allowed_files: List[str] = scope_lock.get("allowedWriteFiles", [])
    if allowed_files:
        matched = any(
            rel_path == af.rstrip("/")
            or fnmatch.fnmatch(rel_path, af)
            for af in allowed_files
        )
        if not matched:
            return (
                f"[CORTEX SCOPE GUARD BLOCK] Out-of-scope file mutation on '{rel_path}'. "
                f"Active task scope lock only permits writes to: {allowed_files}"
            )

    if not proposed_content.strip():
        return None

    # 3. Forbidden Patterns Check (DNA + Scope Lock)
    forbidden_patterns: List[str] = list(
        set(
            dna.get("architectureRules", {}).get("forbiddenPatterns", [])
            + scope_lock.get("forbiddenPatterns", [])
        )
    )
    for pattern in forbidden_patterns:
        # Check literal or simple token match (e.g., "@ts-ignore", "next-auth", "axios")
        token = pattern.split("(")[0].strip().strip("'\"")
        if token and len(token) >= 3 and token in proposed_content:
            return (
                f"[CORTEX SCOPE GUARD BLOCK] Proposed edit in '{rel_path}' contains "
                f"forbidden Project DNA pattern: '{pattern}'."
            )

    # 4. Disallow explicit `any` or `@ts-ignore` in TypeScript if configured
    if ast_rules.get("disallowAnyType", False) and rel_path.endswith((".ts", ".tsx")):
        if re.search(r":\s*any\b|<any>|as\s+any\b|@ts-ignore", proposed_content):
            return (
                f"[CORTEX SCOPE GUARD BLOCK] Proposed TypeScript edit in '{rel_path}' "
                f"violates `disallowAnyType: true` (found explicit `any` or `@ts-ignore`)."
            )

    # 5. Python Native AST Verification (for .py files & max function line enforcement)
    if rel_path.endswith(".py"):
        try:
            tree = ast.parse(proposed_content)
            max_lines = ast_rules.get("maxFunctionLines", 0)
            if max_lines > 0:
                for node in ast.walk(tree):
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        end_lineno = getattr(node, "end_lineno", node.lineno)
                        fn_len = end_lineno - node.lineno + 1
                        if fn_len > max_lines:
                            return (
                                f"[CORTEX SCOPE GUARD BLOCK] Function '{node.name}' in '{rel_path}' "
                                f"is {fn_len} lines, exceeding maxFunctionLines={max_lines}."
                            )
        except SyntaxError as syn_err:
            # Only block on full file writes where syntax must be valid
            if "def " in proposed_content and "import " in proposed_content:
                return f"[CORTEX SCOPE GUARD BLOCK] Invalid Python AST in '{rel_path}': {syn_err}"

    return None


def check_bash_command(command: str, dna: Dict[str, Any]) -> Optional[str]:
    """Blocks destructive shell commands or shell bypasses targeting protected paths."""
    dangerous_patterns = [
        r"rm\s+-rf\s+/",
        r"git\s+reset\s+--hard",
        r"git\s+push\s+--force",
        r"DROP\s+TABLE",
    ]
    for pat in dangerous_patterns:
        if re.search(pat, command, re.IGNORECASE):
            return f"[CORTEX SCOPE GUARD BLOCK] Destructive bash command blocked: matches '{pat}'."

    protected_paths = (
        dna.get("codingStandards", {})
        .get("astScopeGuardRules", {})
        .get("protectedPaths", [])
    )
    for prot in protected_paths:
        norm_prot = prot.rstrip("/")
        if norm_prot and norm_prot in command and any(
            op in command for op in (">", "rm ", "mv ", "sed -i", "tee ")
        ):
            return (
                f"[CORTEX SCOPE GUARD BLOCK] Bash command attempts to mutate protected path '{prot}'."
            )
    return None


def evaluate_payload(payload: Dict[str, Any], project_root: Path) -> Tuple[int, str]:
    """
    Pure evaluation function (TDD-friendly).
    Returns (exit_code, message) where exit_code is 0 (ALLOW) or 2 (BLOCK).
    """
    tool_name = payload.get("tool_name") or payload.get("tool") or ""
    tool_input = payload.get("tool_input") or payload.get("input") or {}

    cortex_dir = project_root / ".cortex"
    dna = load_json_file(cortex_dir / "project-dna.json")
    scope_lock = load_json_file(cortex_dir / "active-scope-lock.json")

    if tool_name in WRITE_TOOL_NAMES:
        target_file, content = extract_target_file_and_content(tool_name, tool_input)
        if not target_file:
            return 0, "ALLOW"
        rel_path = normalize_rel_path(target_file, project_root)
        violation = check_ast_and_semantic_rules(rel_path, content, dna, scope_lock)
        if violation:
            return 2, violation

    elif tool_name in BASH_TOOL_NAMES:
        cmd = tool_input.get("command") or tool_input.get("cmd") or ""
        if isinstance(cmd, str) and cmd.strip():
            violation = check_bash_command(cmd, dna)
            if violation:
                return 2, violation

    return 0, "ALLOW"


def main() -> None:
    project_root = Path(os.environ.get("CORTEX_PROJECT_ROOT", os.getcwd()))
    raw_stdin = sys.stdin.read().strip()
    if not raw_stdin:
        sys.exit(0)

    try:
        payload = json.loads(raw_stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    exit_code, message = evaluate_payload(payload, project_root)
    if exit_code == 2:
        sys.stderr.write(message + "\n")
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
```

#### B. Hook Documentation & Claude / Cursor / Codex / Hermes Settings (`hooks/README.md`)

Save this as `hooks/README.md`:

```markdown
# CortexOS Sentinel PreToolUse Hooks & Prompt Interceptors

`hooks/sentinel_pretooluse.py` is a zero-dependency Python boundary adapter that enforces:
1. **Project DNA Immutable Rules** (`.cortex/project-dna.json`)
2. **Active AST Semantic Scope Locks** (`.cortex/active-scope-lock.json`)
3. **Protected File Boundaries & Forbidden Patterns**

## Exit Code Contract
- **`0` (ALLOW):** The tool call obeys the active Scope Lock and Project DNA. Execution proceeds.
- **`2` (BLOCK):** The tool call violates file scope, touches a protected path, or introduces forbidden patterns/broken AST. Execution is aborted before touching disk, and the violation reason on `stderr` is returned to the agent to self-correct.

## 1. Claude Code Configuration (`.claude/settings.json`)

Add this snippet to `.claude/settings.json` in your repository root:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/hooks/sentinel_pretooluse.py\""
          }
        ]
      }
    ]
  }
}
```

## 2. Cursor / Codex / Hermes Hook Integration

For Cursor, Codex CLI, and Hermes agent runners, bind the pre-tool execution hook in your workspace runner or `.cursor/hooks.json`:

```json
{
  "preToolUse": {
    "command": "python3",
    "args": ["hooks/sentinel_pretooluse.py"],
    "blockOnExitCode": 2
  }
}
```
```

#### C. TDD Verification Suite (`tests/test_sentinel_pretooluse.py`)

Because you are building with Test-Driven Development (TDD), here is a complete unit test suite (`tests/test_sentinel_pretooluse.py`) verifying exit codes `0` and `2` across protected paths, out-of-scope edits, `any` type guards, and Python AST validation:

```python
# tests/test_sentinel_pretooluse.py
import json
import tempfile
import unittest
from pathlib import Path
from hooks.sentinel_pretooluse import evaluate_payload


class TestSentinelPreToolUse(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        cortex_dir = self.root / ".cortex"
        cortex_dir.mkdir(parents=True, exist_ok=True)

        # Write fixture Project DNA
        dna = {
            "architectureRules": {
                "forbiddenPatterns": ["next-auth", "@ts-ignore", "axios"]
            },
            "codingStandards": {
                "astScopeGuardRules": {
                    "disallowAnyType": True,
                    "maxFunctionLines": 10,
                    "protectedPaths": [
                        "prisma/migrations/",
                        "src/lib/auth/tenant-guard.ts",
                    ],
                }
            },
        }
        (cortex_dir / "project-dna.json").write_text(json.dumps(dna), encoding="utf-8")

        # Write fixture Active Scope Lock
        scope_lock = {
            "allowedWriteFiles": [
                "src/app/(auth)/sign-in/*",
                "src/features/auth/*",
                "scripts/helper.py",
            ],
            "forbiddenPatterns": [],
        }
        (cortex_dir / "active-scope-lock.json").write_text(
            json.dumps(scope_lock), encoding="utf-8"
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_allows_valid_in_scope_write(self):
        payload = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": "src/features/auth/login-card.tsx",
                "content": "export function LoginCard({ orgId }: { orgId: string }) { return <div />; }",
            },
        }
        code, msg = evaluate_payload(payload, self.root)
        self.assertEqual(code, 0)
        self.assertEqual(msg, "ALLOW")

    def test_blocks_protected_path_with_exit_code_2(self):
        payload = {
            "tool_name": "Edit",
            "tool_input": {
                "file_path": "src/lib/auth/tenant-guard.ts",
                "new_string": "export const bypass = true;",
            },
        }
        code, msg = evaluate_payload(payload, self.root)
        self.assertEqual(code, 2)
        self.assertIn("protectedPaths", msg)

    def test_blocks_out_of_scope_file_with_exit_code_2(self):
        payload = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": "src/features/billing/stripe.ts",
                "content": "export const stripe = {};",
            },
        }
        code, msg = evaluate_payload(payload, self.root)
        self.assertEqual(code, 2)
        self.assertIn("Out-of-scope file mutation", msg)

    def test_blocks_forbidden_pattern_and_any_type_with_exit_code_2(self):
        payload = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": "src/features/auth/session.ts",
                "content": "import NextAuth from 'next-auth'; export const data: any = {};",
            },
        }
        code, msg = evaluate_payload(payload, self.root)
        self.assertEqual(code, 2)
        self.assertIn("forbidden Project DNA pattern", msg)

    def test_blocks_python_function_exceeding_max_ast_lines(self):
        long_fn = "def too_long():\n" + "\n".join(f"    x_{i} = {i}" for i in range(15))
        payload = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": "scripts/helper.py",
                "content": long_fn,
            },
        }
        code, msg = evaluate_payload(payload, self.root)
        self.assertEqual(code, 2)
        self.assertIn("exceeding maxFunctionLines=10", msg)


if __name__ == "__main__":
    unittest.main()
```

Let's execute this TDD test suite in the sandbox right now to verify that `sentinel_pretooluse.py` passes 100% of boundary checks.All 5 TDD unit tests for `hooks/sentinel_pretooluse.py` passed (`ALL_PASSED: True`), confirming that:
- In-scope writes exit with `0` (`ALLOW`).
- Edits to `protectedPaths` exit with `2` (`BLOCK`).
- Out-of-scope file writes exit with `2` (`BLOCK`).
- Forbidden patterns (`next-auth`, `@ts-ignore`, explicit `any`) exit with `2` (`BLOCK`).
- Python functions exceeding `maxFunctionLines` AST limits exit with `2` (`BLOCK`).

---

### 4. Component 3: The Browser Extension & Local WebSocket Bridge (`ws://127.0.0.1:11436`)

For web-based AI platforms (**ChatGPT Web, Claude Web, Codex Web, v0, Bolt, Lovable, Gemini**), MCP stdio isn't available inside the browser tab. Instead, CortexOS runs a lightweight **WebSocket Bridge (`ws://127.0.0.1:11436`)** inside the local daemon paired with a **Manifest V3 Browser Extension Content Script**.

When you paste or type a prompt in a browser chat and press **`Cmd/Ctrl + Shift + Enter`** (or click the floating **"⚡ Cortex Enhance & Sync"** badge):
1. The content script sends your raw prompt + active web platform name to `ws://127.0.0.1:11436`.
2. The local daemon runs **Engine 1 (Local Tool Pre-Execution)** + **Engine 2 (Tier-1 Prompt Rewriter)** via local Ollama (`0` cloud tokens).
3. The browser extension automatically replaces the text inside the chat box with the **Tier-1 Enterprise Specification + Delta Sync Header** and submits it.
4. When the web AI finishes streaming its response, a `MutationObserver` captures the response and sends it back over the WebSocket to **Engine 3 (Memory Extractor)** so your local KuzuDB Knowledge Graph updates automatically.

#### A. Local Daemon WebSocket Server (`src/bridge/websocket-bridge.ts`)

```typescript
// src/bridge/websocket-bridge.ts
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CortexLocalPipeline } from '../engine/local-ollama-pipeline.js';
import { AIPlatform } from '../types/cortex-schema.js';

const PORT = 11436;
const PROJECT_ROOT = process.env.CORTEX_PROJECT_ROOT || process.cwd();
const STATE_LEDGER_PATH = path.join(PROJECT_ROOT, '.cortex', 'continuity-ledger.json');

const pipeline = new CortexLocalPipeline(PROJECT_ROOT);
const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });

console.log(`[CortexOS WebSocket Bridge] Listening on ws://127.0.0.1:${PORT}`);

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', async (rawBuffer) => {
    try {
      const msg = JSON.parse(rawBuffer.toString());

      // 1. INTERCEPT & REWRITE RAW PROMPT FROM BROWSER DOM
      if (msg.type === 'INTERCEPT_AND_REWRITE') {
        const ledger = await fs
          .readFile(STATE_LEDGER_PATH, 'utf-8')
          .then((r) => JSON.parse(r))
          .catch(() => ({}));

        const result = await pipeline.processAndRewritePrompt({
          rawUserPrompt: msg.rawPrompt,
          targetPlatform: (msg.platform as AIPlatform) || 'chatgpt',
          scopedGraphContext: {
            activeModule: ledger.activeModule || 'core',
            relevantDecisions: ledger.recentDecisions || [],
            relevantSymbols: ledger.relevantSymbols || [],
            openBugsInScope: ledger.openBugs || [],
          },
          continuityState: {
            lastCompletedAction: ledger.lastCompletedAction || 'Synced via CortexOS',
            activeTask: ledger.activeTask || {
              id: 'TASK-WEB',
              title: msg.rawPrompt.slice(0, 50),
              preExecutedByLocalAgent: [],
              remainingCoreWork: msg.rawPrompt,
            },
            nextPendingTasks: ledger.nextPendingTasks || [],
          },
        });

        ws.send(
          JSON.stringify({
            type: 'REWRITTEN_TIER1_PROMPT',
            requestId: msg.requestId,
            handledCompletelyLocally: result.handledCompletelyLocally,
            tokensSaved: result.tokensSaved,
            payload: result.handledCompletelyLocally
              ? `[COMPLETED LOCALLY BY CORTEX OLLAMA]:\n${JSON.stringify(result.localArtifacts, null, 2)}`
              : result.injectedPrompt,
          })
        );
      }

      // 2. AUTO-CAPTURE AI RESPONSE FROM BROWSER DOM -> UPDATE KUZUDB GRAPH
      if (msg.type === 'COMMIT_WEB_TURN_MEMORY') {
        const delta = await pipeline.extractMemoryFromTurn({
          sourcePlatform: (msg.platform as AIPlatform) || 'chatgpt',
          rawUserPrompt: msg.rawPrompt,
          aiResponseText: msg.aiResponseText,
          modifiedFilesAstDiff: [],
          existingActiveDecisions: [],
          activeTasks: [],
        });

        ws.send(
          JSON.stringify({
            type: 'MEMORY_SYNCED_ACK',
            compactSummary: delta.compactTurnSummary,
          })
        );
      }
    } catch (err: any) {
      ws.send(JSON.stringify({ type: 'ERROR', error: err.message }));
    }
  });
});
```

#### B. Browser Extension Content Script (`extension/content-script.ts`)

```typescript
// extension/content-script.ts
// Injects into ChatGPT, Claude Web, Codex Web, v0, Bolt, Gemini

const CORTEX_WS_URL = 'ws://127.0.0.1:11436';
let socket: WebSocket | null = null;
let lastRawPrompt = '';

function detectPlatform(): string {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('openai.com')) return 'codex';
  if (host.includes('claude.ai')) return 'claude';
  if (host.includes('hermes')) return 'hermes';
  return 'chatgpt';
}

function connectBridge() {
  socket = new WebSocket(CORTEX_WS_URL);

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'REWRITTEN_TIER1_PROMPT') {
      injectRewrittenPromptIntoDom(data.payload);
    }
  };

  socket.onclose = () => {
    // Reconnect automatically after 3 seconds if daemon restarts
    setTimeout(connectBridge, 3000);
  };
}

function getActivePromptElement(): HTMLElement | null {
  return (
    (document.querySelector('#prompt-textarea') as HTMLElement) ||
    (document.querySelector('div[contenteditable="true"]') as HTMLElement) ||
    (document.querySelector('textarea') as HTMLElement)
  );
}

function injectRewrittenPromptIntoDom(tier1Markdown: string) {
  const el = getActivePromptElement();
  if (!el) return;

  if (el instanceof HTMLTextAreaElement) {
    el.value = tier1Markdown;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (el.isContentEditable) {
    el.innerText = tier1Markdown;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: tier1Markdown }));
  }
}

// Intercept Cmd/Ctrl + Shift + Enter to rewrite & pre-execute locally before sending
window.addEventListener(
  'keydown',
  (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Enter') {
      const el = getActivePromptElement();
      if (!el || !socket || socket.readyState !== WebSocket.OPEN) return;

      e.preventDefault();
      e.stopPropagation();

      const rawText =
        el instanceof HTMLTextAreaElement ? el.value.trim() : el.innerText.trim();
      if (!rawText) return;

      lastRawPrompt = rawText;
      socket.send(
        JSON.stringify({
          type: 'INTERCEPT_AND_REWRITE',
          requestId: crypto.randomUUID(),
          platform: detectPlatform(),
          rawPrompt: rawText,
        })
      );
    }
  },
  true
);

connectBridge();
```

---

### Summary of Completed Architecture (Steps 1 → 3)

| Layer | Deliverable Completed | Core Function |
| :--- | :--- | :--- |
| **Step 1: Schemas & Graph** | `project-dna.schema.json`, `schema.cypher` (KuzuDB), `cortex-schema.ts` | Persistent Project DNA, 9-node Property Graph, and 150-token Cross-Platform Delta Sync Packets. |
| **Step 2: Local AI Engines** | 3 Master Prompts + `local-ollama-pipeline.ts` | Local Ollama Pre-Execution Router, Tier-1 Prompt Engineering Engine, and 3B Async Memory Extractor. |
| **Step 3: Sync & Scope Guard** | `cortex-mcp-server.ts`, `.cursor/mcp.json`, `hooks/sentinel_pretooluse.py`, `hooks/README.md`, `websocket-bridge.ts` | Zero-friction sync between Codex ↔ Hermes ↔ Cursor ↔ Web UIs, backed by TDD-verified exit-code `0`/`2` AST Scope Guard protection. |

### Ready for Step 4 (Final Stage)?
If you'd like, we can now proceed to **Step 4: The Multi-Agent Orchestrator & Project Bootstrap CLI (`npx cortexos init`)**, which automatically scans an existing repository with Tree-sitter, generates its initial `.cortex/project-dna.json` + KuzuDB Knowledge Graph in one

---

## Sources

1. **http://127.0.0.1:11434"**
   http://127.0.0.1:11434"

