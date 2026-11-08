# CORTEXOS — PHASE 4 SPECIFICATION & FULL IMPLEMENTATION BLUEPRINT
## Visual Command Center (`http://localhost:4300`) & AI CTO Mode
**Blueprint Mapping:** Original 4-Phase Roadmap **Phase 4** $\leftrightarrow$ Full-Stack Engineering Blueprint **Step 6 (Visual Command Center UI)** + **Step 4 (AI CTO / Multi-Agent DAG Orchestrator)**

> **How to use this document with your AI Coding Agent (Cursor, Claude Code, Codex, OpenCode, Hermes):**
> Drop this file into your workspace or chat prompt alongside:
> `"begin Phase 4 — Implement the Visual Command Center & AI CTO Mode strictly following PHASE_4_VISUAL_COMMAND_CENTER_BLUEPRINT.md and the existing CortexOS contracts."`

---

## 1. Phase 4 Executive Scope & Architecture Objectives

Phase 4 completes the local-first **CortexOS Control Plane** by exposing an interactive **Visual Command Center (`http://localhost:4300`)** and an **AI CTO Recommendation & Multi-Agent Orchestration Engine**.

### Core Deliverables of Phase 4
1. **Interactive Knowledge Graph Explorer (`KuzuGraphCanvas.tsx`):**
   - Renders live nodes (`Module`, `SourceFile`, `ASTSymbol`, `ArchitecturalDecision`, `Task`, `Bug`, `SessionTurn`) and directed edges (`CONTAINS_FILE`, `DECLARES_SYMBOL`, `IMPORTS_SYMBOL`, `CALLS_SYMBOL`, `GOVERNED_BY`, `MODIFIED_SYMBOL`) from `.cortex/graph.kuzu`.
   - Visualizes **AST Semantic Scope Locks** (`IN-SCOPE` emerald badges vs. `LOCKED` crimson badges enforced by `hooks/sentinel_pretooluse.py`).
   - Supports one-click node inspection, hop-radius filtering (1-hop / 2-hop ego-network), and live Scope Lock toggling from the UI.
2. **Session Continuity & Cross-Platform Timeline UI (`ContinuityTimeline.tsx`):**
   - Chronological stream of `ExtractedMemoryDelta` commits captured across **Claude Code**, **Codex CLI**, **Cursor**, **Hermes**, and **ChatGPT/Claude Web** via the Step 5 Unattended Watcher (`live-session-daemon.ts`) and Step 3 MCP Server (`cortex-mcp-server.ts`).
   - Displays AST symbol diffs (`added`, `modified`, `deleted`), architectural decisions ratified, and resolved bugs per turn.
3. **Token Savings & Local Routing Telemetry Dashboard (`TokenSavingsDashboard.tsx`):**
   - Tracks real-time token compression ratios achieved by replacing raw chat history dumps with scoped `<cortex_sync_packet>` injections and local Ollama (`qwen2.5-coder:14b` / `llama3.2:3b`) pre-execution routing.
   -Note on Token Accounting: Any context injected into a target cloud model still consumes tokens proportional to the compact `<cortex_sync_packet>` size (~250–450 tokens), but eliminates ~8,000–25,000 tokens of redundant repo/chat re-explanation per session.
4. **AI CTO Mode — Architectural Drift Detector, Recommendation Engine & DAG Orchestrator (`ai-cto-engine.ts` & `AICtoPanel.tsx`):**
   - Continuously audits the KuzuDB property graph against `.cortex/project-dna.json` (`architectureRules.forbiddenPatterns`, `layerBoundaries`, `maxCyclomaticComplexity`, and `agentRoutingPolicy`).
   - Generates actionable **AI CTO Recommendations** (e.g., layer boundary violations, high-churn unlocked AST symbols, unlinked tasks, opportunities to offload subtasks to local Ollama).
   - Decomposes complex features into a topological **Multi-Agent Execution DAG**, dispatching boilerplate/tests to local `ollama` agents and complex cross-module refactors to cloud `claude-3-7-sonnet` / `gpt-4o` agents with strict `allowedSymbolFqns` scope locks.
5. **Cross-Platform Handoff Packet Modal (`HandoffModal.tsx`):**
   - Generates a deterministic, copy-ready `<cortex_sync_packet>` XML/JSON payload to seamlessly move an active task from one AI tool to another in <2 seconds.

---

## 2. Directory & File Structure for Phase 4

```text
cortexos/
├── .cortex/
│   ├── project-dna.json                        # Project DNA & Architecture Rules (Phase 1)
│   ├── schema.cypher                           # KuzuDB Property Graph DDL (Phase 1)
│   └── telemetry.jsonl                         # Append-only token & routing ledger (Phase 4)
├── src/
│   ├── types/
│   │   └── cortex-contracts.ts                 # Shared TypeScript interfaces (Updated for Phase 4)
│   ├── orchestrator/
│   │   ├── multi-agent-orchestrator.ts         # DAG Task Decomposer & Dispatcher
│   │   └── ai-cto-engine.ts                    # AI CTO Drift Auditor & Recommendation Engine
│   └── dashboard/
│       ├── app/
│       │   ├── api/
│       │   │   └── cortex/
│       │   │       ├── state/route.ts          # GET/POST Graph, Timeline, Telemetry & Scope Locks
│       │   │       └── cto/route.ts            # GET/POST AI CTO Audits, Recommendations & DAG Dispatch
│       │   └── page.tsx                        # Main Visual Command Center View (Port 4300)
│       ├── components/
│       │   ├── KuzuGraphCanvas.tsx             # React Flow Knowledge Graph Explorer + Scope Locks
│       │   ├── TokenSavingsDashboard.tsx       # Token Optimization & Local Offload Telemetry UI
│       │   ├── ContinuityTimeline.tsx          # Cross-Platform Session Turn & AST Delta Stream
│       │   ├── AICtoPanel.tsx                  # AI CTO Recommendations & One-Click DAG Dispatch
│       │   └── HandoffModal.tsx                # Cross-Platform <cortex_sync_packet> Generator
│       └── cortexos_command_center_preview.html # Zero-dependency standalone interactive HTML preview
└── tests/
    └── test_phase4_command_center.py           # End-to-End TDD Verification Suite for Phase 4
```

---

## 3. Shared Data Contracts (`src/types/cortex-contracts.ts` — Phase 4 Extensions)

Add or verify the following interfaces in `src/types/cortex-contracts.ts`:

```typescript
// src/types/cortex-contracts.ts

export type AgentPlatform =
  | "claude-code"
  | "codex-cli"
  | "cursor"
  | "opencode"
  | "hermes"
  | "web-chat";

export interface GraphNodeDTO {
  id: string;
  label:
    | "Module"
    | "SourceFile"
    | "ASTSymbol"
    | "ArchitecturalDecision"
    | "Task"
    | "Bug"
    | "SessionTurn";
  title: string;
  subtitle?: string;
  filePath?: string;
  fqn?: string;
  signature?: string;
  scopeStatus: "IN_SCOPE" | "LOCKED" | "NEUTRAL";
  complexity?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphEdgeDTO {
  id: string;
  source: string;
  target: string;
  relationship:
    | "CONTAINS_FILE"
    | "DECLARES_SYMBOL"
    | "IMPORTS_SYMBOL"
    | "CALLS_SYMBOL"
    | "GOVERNED_BY"
    | "MODIFIED_SYMBOL"
    | "DEPENDS_ON";
}

export interface TokenTelemetrySummary {
  totalPromptsIntercepted: number;
  rawContextTokensEstimated: number;
  injectedSyncPacketTokens: number;
  netTokensSaved: number;
  compressionRatioPct: number;
  estimatedCostSavingsUsd: number;
  localOllamaOffloadCount: number;
  cloudEscalationCount: number;
  localOffloadPct: number;
  historyByDay: Array<{
    date: string;
    rawTokens: number;
    optimizedTokens: number;
    localExecutions: number;
  }>;
}

export interface ContinuityTimelineEvent {
  turnId: string;
  timestamp: string;
  platform: AgentPlatform;
  summary: string;
  tokensSaved: number;
  symbolsTouched: Array<{
    fqn: string;
    changeType: "added" | "modified" | "deleted";
  }>;
  decisionsRatified: string[];
}

export type CTOSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "OPTIMIZATION";

export interface AICtoRecommendation {
  id: string;
  category:
    | "ARCHITECTURE_DRIFT"
    | "SCOPE_LOCK_HAZARD"
    | "TOKEN_OPTIMIZATION"
    | "COMPLEXITY_HOTSPOT"
    | "UNLINKED_REQUIREMENT";
  severity: CTOSeverity;
  title: string;
  rationale: string;
  impactedSymbols: string[];
  suggestedAction: {
    actionType: "LOCK_SYMBOLS" | "DECOMPOSE_DAG" | "REFACTOR_LOCAL" | "RATIFY_ADR";
    commandPreview: string;
    estimatedTokenSavings?: number;
  };
}

export interface CortexDashboardStateResponse {
  projectName: string;
  projectDnaVersion: string;
  activeTask: {
    taskId: string;
    title: string;
    status: string;
    allowedSymbolFqns: string[];
    forbiddenPaths: string[];
  };
  graph: {
    nodes: GraphNodeDTO[];
    edges: GraphEdgeDTO[];
  };
  telemetry: TokenTelemetrySummary;
  timeline: ContinuityTimelineEvent[];
  ctoRecommendations: AICtoRecommendation[];
  syncPacketXml: string;
}
```

---

## 4. AI CTO Recommendation & Architectural Drift Engine (`src/orchestrator/ai-cto-engine.ts`)

Create `src/orchestrator/ai-cto-engine.ts` to audit the KuzuDB graph and Project DNA, detect architectural drift, and produce actionable recommendations plus DAG decompositions:

```typescript
// src/orchestrator/ai-cto-engine.ts
import * as fs from "fs";
import * as path from "path";
import {
  AICtoRecommendation,
  GraphEdgeDTO,
  GraphNodeDTO,
  TokenTelemetrySummary,
} from "../types/cortex-contracts";
import {
  DAGSubTask,
  MultiAgentOrchestrator,
} from "./multi-agent-orchestrator";

export interface ProjectDnaConfig {
  projectId: string;
  name: string;
  version: string;
  architectureRules: {
    pattern: string;
    layerBoundaries: Array<{
      fromLayer: string;
      allowedTargetLayers: string[];
    }>;
    forbiddenPatterns: string[];
  };
  codingStandards: {
    maxCyclomaticComplexity: number;
    maxFileLines: number;
  };
  agentRoutingPolicy: {
    localModel: string;
    cloudEscalationModel: string;
    localPreExecutionTasks: string[];
  };
}

export class AICtoEngine {
  private workspaceRoot: string;
  private orchestrator: MultiAgentOrchestrator;

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
    this.orchestrator = new MultiAgentOrchestrator();
  }

  public loadProjectDna(): ProjectDnaConfig {
    const dnaPath = path.join(this.workspaceRoot, ".cortex", "project-dna.json");
    if (fs.existsSync(dnaPath)) {
      return JSON.parse(fs.readFileSync(dnaPath, "utf-8"));
    }
    return {
      projectId: "cortexos-core",
      name: "CortexOS Local-First AI OS",
      version: "1.0.0",
      architectureRules: {
        pattern: "Hexagonal / Local-First Daemon + MCP Control Plane",
        layerBoundaries: [
          { fromLayer: "dashboard", allowedTargetLayers: ["mcp", "types", "orchestrator"] },
          { fromLayer: "mcp", allowedTargetLayers: ["engine", "indexer", "types"] },
        ],
        forbiddenPatterns: [
          "Direct cloud LLM calls without PreExecutionRouter check",
          "Unbounded full-repository context dumps",
          "Mutating AST symbols outside active task scope",
        ],
      },
      codingStandards: {
        maxCyclomaticComplexity: 12,
        maxFileLines: 400,
      },
      agentRoutingPolicy: {
        localModel: "qwen2.5-coder:14b",
        cloudEscalationModel: "claude-3-7-sonnet",
        localPreExecutionTasks: ["unit-test-scaffolding", "docstring-generation", "ast-diff-summary"],
      },
    };
  }

  /**
   * Audits the active Knowledge Graph and Session Telemetry against Project DNA
   * to generate deterministic, high-signal AI CTO Recommendations.
   */
  public evaluateArchitectureAndScope(
    nodes: GraphNodeDTO[],
    edges: GraphEdgeDTO[],
    allowedSymbolFqns: string[],
    telemetry: TokenTelemetrySummary
  ): AICtoRecommendation[] {
    const dna = this.loadProjectDna();
    const recommendations: AICtoRecommendation[] = [];

    // 1. Detect High-Complexity Symbols that are not Scope-Locked
    for (const node of nodes) {
      if (
        node.label === "ASTSymbol" &&
        node.fqn &&
        (node.complexity ?? 0) > dna.codingStandards.maxCyclomaticComplexity &&
        !allowedSymbolFqns.includes(node.fqn) &&
        node.scopeStatus !== "LOCKED"
      ) {
        recommendations.push({
          id: `cto-rec-lock-${node.id}`,
          category: "SCOPE_LOCK_HAZARD",
          severity: "HIGH",
          title: `Lock High-Complexity Symbol: ${node.title}`,
          rationale: `Symbol '${node.fqn}' has cyclomatic complexity ${node.complexity} (threshold: ${dna.codingStandards.maxCyclomaticComplexity}) and is outside the active task scope.`,
          impactedSymbols: [node.fqn],
          suggestedAction: {
            actionType: "LOCK_SYMBOLS",
            commandPreview: `cortexos scope --lock "${node.fqn}"`,
            estimatedTokenSavings: 1400,
          },
        });
      }
    }

    // 2. Detect Cross-Layer Boundary Drift in Graph Edges
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    for (const edge of edges) {
      if (edge.relationship === "CALLS_SYMBOL" || edge.relationship === "IMPORTS_SYMBOL") {
        const src = nodeMap.get(edge.source);
        const dst = nodeMap.get(edge.target);
        if (
          src?.filePath?.includes("src/dashboard") &&
          dst?.filePath?.includes("src/watcher")
        ) {
          recommendations.push({
            id: `cto-rec-drift-${edge.id}`,
            category: "ARCHITECTURE_DRIFT",
            severity: "CRITICAL",
            title: "Hexagonal Layer Boundary Violation Detected",
            rationale: `Dashboard UI module ('${src.filePath}') directly imports Watcher daemon symbol ('${dst.fqn}'). Route through '/api/cortex/state' or MCP contract instead.`,
            impactedSymbols: [src.fqn || src.title, dst.fqn || dst.title],
            suggestedAction: {
              actionType: "RATIFY_ADR",
              commandPreview: `cortexos adr --enforce-boundary dashboard->mcp`,
            },
          });
        }
      }
    }

    // 3. Token Optimization & Local Ollama Offload Opportunity
    if (telemetry.localOffloadPct < 65) {
      recommendations.push({
        id: "cto-rec-local-offload",
        category: "TOKEN_OPTIMIZATION",
        severity: "OPTIMIZATION",
        title: `Increase Local Ollama Pre-Execution Offload (${telemetry.localOffloadPct.toFixed(1)}% -> 75%)`,
        rationale: `Cloud escalations accounted for ${telemetry.cloudEscalationCount} recent turns. Routing AST diffing and unit-test scaffolding to '${dna.agentRoutingPolicy.localModel}' will reduce paid API spend.`,
        impactedSymbols: ["src/engine/local-ollama-pipeline.ts#PreExecutionRouter"],
        suggestedAction: {
          actionType: "REFACTOR_LOCAL",
          commandPreview: `cortexos router --set-threshold 0.72 --model ${dna.agentRoutingPolicy.localModel}`,
          estimatedTokenSavings: 6800,
        },
      });
    }

    // 4. Default High-Impact CTO Recommendation if all checks pass
    if (recommendations.length < 3) {
      recommendations.push({
        id: "cto-rec-dag-precompile",
        category: "COMPLEXITY_HOTSPOT",
        severity: "MEDIUM",
        title: "Decompose Active Scope into Local + Cloud DAG Subtasks",
        rationale: `Active task touches ${allowedSymbolFqns.length} symbols. Splitting type-contract validation & unit tests to local Ollama (${dna.agentRoutingPolicy.localModel}) before cloud execution prevents context bloat.`,
        impactedSymbols: allowedSymbolFqns,
        suggestedAction: {
          actionType: "DECOMPOSE_DAG",
          commandPreview: `cortexos orchestrate --task active --split-local-tests`,
          estimatedTokenSavings: 4200,
        },
      });
    }

    return recommendations;
  }

  /**
   * Generates a topological Multi-Agent Execution Plan for the AI CTO Panel.
   */
  public buildExecutionPlan(
    goal: string,
    allowedSymbolFqns: string[]
  ): { planId: string; subtasks: DAGSubTask[];waves: string[][] } {
    const subtasks: DAGSubTask[] = [
      {
        id: "subtask-1-contracts",
        title: "Validate TypeScript Contracts & Schema Invariants",
        assignedAgent: "local-ollama-qwen2.5-coder",
        dependencies: [],
        allowedSymbolFqns: allowedSymbolFqns.filter((s) => s.includes("contracts") || s.includes("schema")),
        prompt: `Verify strict JSON schema & TypeScript contract alignment for: ${goal}`,
      },
      {
        id: "subtask-2-core-impl",
        title: "Execute Scoped Core Implementation within AST Guardrails",
        assignedAgent: "cloud-claude-3-7-sonnet",
        dependencies: ["subtask-1-contracts"],
        allowedSymbolFqns,
        prompt: `Implement core logic for '${goal}' strictly within allowed AST symbols: ${allowedSymbolFqns.join(", ")}`,
      },
      {
        id: "subtask-3-tdd-verification",
        title: "Synthesize & Run Deterministic Unit Tests",
        assignedAgent: "local-ollama-qwen2.5-coder",
        dependencies: ["subtask-2-core-impl"],
        allowedSymbolFqns,
        prompt: `Generate and execute unit test coverage for modified symbols in '${goal}'.`,
      },
    ];

    const waves = this.orchestrator.computeExecutionWaves(subtasks);
    return {
      planId: `dag-${Date.now()}`,
      subtasks,
      waves: waves.map((w) => w.map((t) => t.id)),
    };
  }
}
```

---

## 5. Backend API Routes (`src/dashboard/app/api/cortex/state/route.ts` & `cto/route.ts`)

### 5.1 `src/dashboard/app/api/cortex/state/route.ts`
Serves the complete Knowledge Graph, Continuity Timeline, Token Telemetry, AI CTO Recommendations, and Cross-Platform Sync Packet, and accepts `POST` requests to toggle AST Scope Locks live from the UI:

```typescript
// src/dashboard/app/api/cortex/state/route.ts
import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import {
  CortexDashboardStateResponse,
  GraphEdgeDTO,
  GraphNodeDTO,
  TokenTelemetrySummary,
  ContinuityTimelineEvent,
} from "../../../../../types/cortex-contracts";
import { AICtoEngine } from "../../../../../orchestrator/ai-cto-engine";

const DEFAULT_ALLOWED_SYMBOLS = [
  "src/engine/local-ollama-pipeline.ts#LocalOllamaPipeline.rewritePromptTier1",
  "src/mcp/cortex-mcp-server.ts#CortexMcpServer.handlePullSyncPacket",
  "src/watcher/live-session-daemon.ts#LiveSessionDaemon.ingestJsonlDelta",
];

let runtimeAllowedSymbols = [...DEFAULT_ALLOWED_SYMBOLS];

function buildGraph(allowedSymbols: string[]): {
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
} {
  const nodes: GraphNodeDTO[] = [
    {
      id: "mod-engine",
      label: "Module",
      title: "Engine Module",
      subtitle: "src/engine",
      scopeStatus: "IN_SCOPE",
    },
    {
      id: "mod-mcp",
      label: "Module",
      title: "MCP Control Plane",
      subtitle: "src/mcp",
      scopeStatus: "IN_SCOPE",
    },
    {
      id: "mod-hooks",
      label: "Module",
      title: "AST Sentinel Hooks",
      subtitle: "hooks/",
      scopeStatus: "LOCKED",
    },
    {
      id: "sym-rewrite",
      label: "ASTSymbol",
      title: "LocalOllamaPipeline.rewritePromptTier1",
      filePath: "src/engine/local-ollama-pipeline.ts",
      fqn: "src/engine/local-ollama-pipeline.ts#LocalOllamaPipeline.rewritePromptTier1",
      signature: "async rewritePromptTier1(rawPrompt: string): Promise<Tier1RewrittenPrompt>",
      complexity: 6,
      scopeStatus: allowedSymbols.includes(
        "src/engine/local-ollama-pipeline.ts#LocalOllamaPipeline.rewritePromptTier1"
      )
        ? "IN_SCOPE"
        : "LOCKED",
    },
    {
      id: "sym-mcp-sync",
      label: "ASTSymbol",
      title: "CortexMcpServer.handlePullSyncPacket",
      filePath: "src/mcp/cortex-mcp-server.ts",
      fqn: "src/mcp/cortex-mcp-server.ts#CortexMcpServer.handlePullSyncPacket",
      signature: "public handlePullSyncPacket(taskId: string): SyncPacketPayload",
      complexity: 5,
      scopeStatus: allowedSymbols.includes(
        "src/mcp/cortex-mcp-server.ts#CortexMcpServer.handlePullSyncPacket"
      )
        ? "IN_SCOPE"
        : "LOCKED",
    },
    {
      id: "sym-watcher",
      label: "ASTSymbol",
      title: "LiveSessionDaemon.ingestJsonlDelta",
      filePath: "src/watcher/live-session-daemon.ts",
      fqn: "src/watcher/live-session-daemon.ts#LiveSessionDaemon.ingestJsonlDelta",
      signature: "public ingestJsonlDelta(filePath: string): ExtractedMemoryDelta[]",
      complexity: 8,
      scopeStatus: allowedSymbols.includes(
        "src/watcher/live-session-daemon.ts#LiveSessionDaemon.ingestJsonlDelta"
      )
        ? "IN_SCOPE"
        : "LOCKED",
    },
    {
      id: "sym-sentinel",
      label: "ASTSymbol",
      title: "verify_ast_scope_lock",
      filePath: "hooks/sentinel_pretooluse.py",
      fqn: "hooks/sentinel_pretooluse.py#verify_ast_scope_lock",
      signature: "def verify_ast_scope_lock(file_path: str, new_source: str, active_scope: dict) -> tuple[bool, str]",
      complexity: 14,
      scopeStatus: allowedSymbols.includes("hooks/sentinel_pretooluse.py#verify_ast_scope_lock")
        ? "IN_SCOPE"
        : "LOCKED",
    },
    {
      id: "adr-001",
      label: "ArchitecturalDecision",
      title: "ADR-001: Zero-Cloud-Dependency Memory Indexing",
      subtitle: "Enforced via Ollama + KuzuDB",
      scopeStatus: "NEUTRAL",
    },
    {
      id: "task-active",
      label: "Task",
      title: "TASK-042: Unattended Live Session Sync & UI Command Center",
      subtitle: "IN_PROGRESS",
      scopeStatus: "IN_SCOPE",
    },
  ];

  const edges: GraphEdgeDTO[] = [
    { id: "e1", source: "mod-engine", target: "sym-rewrite", relationship: "DECLARES_SYMBOL" },
    { id: "e2", source: "mod-mcp", target: "sym-mcp-sync", relationship: "DECLARES_SYMBOL" },
    { id: "e3", source: "mod-hooks", target: "sym-sentinel", relationship: "DECLARES_SYMBOL" },
    { id: "e4", source: "sym-mcp-sync", target: "sym-rewrite", relationship: "CALLS_SYMBOL" },
    { id: "e5", source: "sym-watcher", target: "sym-mcp-sync", relationship: "CALLS_SYMBOL" },
    { id: "e6", source: "sym-rewrite", target: "adr-001", relationship: "GOVERNED_BY" },
    { id: "e7", source: "task-active", target: "sym-rewrite", relationship: "MODIFIED_SYMBOL" },
    { id: "e8", source: "task-active", target: "sym-mcp-sync", relationship: "MODIFIED_SYMBOL" },
    { id: "e9", source: "task-active", target: "sym-watcher", relationship: "MODIFIED_SYMBOL" },
  ];

  return { nodes, edges };
}

export async function GET() {
  const ctoEngine = new AICtoEngine(process.cwd());
  const { nodes, edges } = buildGraph(runtimeAllowedSymbols);

  const telemetry: TokenTelemetrySummary = {
    totalPromptsIntercepted: 148,
    rawContextTokensEstimated: 1_842_000,
    injectedSyncPacketTokens: 54_760,
    netTokensSaved: 1_787_240,
    compressionRatioPct: 97.0,
    estimatedCostSavingsUsd: 26.81,
    localOllamaOffloadCount: 94,
    cloudEscalationCount: 54,
    localOffloadPct: 63.5,
    historyByDay: [
      { date: "Day 1", rawTokens: 310000, optimizedTokens: 9200, localExecutions: 14 },
      { date: "Day 2", rawTokens: 420000, optimizedTokens: 11400, localExecutions: 19 },
      { date: "Day 3", rawTokens: 512000, optimizedTokens: 15160, localExecutions: 28 },
      { date: "Day 4", rawTokens: 600000, optimizedTokens: 19000, localExecutions: 33 },
    ],
  };

  const timeline: ContinuityTimelineEvent[] = [
    {
      turnId: "turn-094",
      timestamp: "2 mins ago",
      platform: "codex-cli",
      summary: "Captured incremental JSONL transcript delta; verified AST symbol diff on LiveSessionDaemon.",
      tokensSaved: 14200,
      symbolsTouched: [
        { fqn: "src/watcher/live-session-daemon.ts#LiveSessionDaemon.ingestJsonlDelta", changeType: "modified" },
      ],
      decisionsRatified: ["ADR-004: Byte-offset cursor checkpointing for JSONL watchers"],
    },
    {
      turnId: "turn-093",
      timestamp: "19 mins ago",
      platform: "claude-code",
      summary: "PreToolUse AST Sentinel blocked out-of-scope mutation to verify_ast_scope_lock.",
      tokensSaved: 18500,
      symbolsTouched: [
        { fqn: "src/mcp/cortex-mcp-server.ts#CortexMcpServer.handlePullSyncPacket", changeType: "modified" },
      ],
      decisionsRatified: ["ADR-003: Fail-closed AST semantic scope guard on PreToolUse"],
    },
    {
      turnId: "turn-092",
      timestamp: "47 mins ago",
      platform: "cursor",
      summary: "Tier-1 Prompt Engineer rewrote raw 12-word prompt into scoped specification with 1-hop KuzuDB context.",
      tokensSaved: 11900,
      symbolsTouched: [
        { fqn: "src/engine/local-ollama-pipeline.ts#LocalOllamaPipeline.rewritePromptTier1", changeType: "added" },
      ],
      decisionsRatified: ["ADR-001: Zero-Cloud-Dependency Memory Indexing"],
    },
  ];

  const ctoRecommendations = ctoEngine.evaluateArchitectureAndScope(
    nodes,
    edges,
    runtimeAllowedSymbols,
    telemetry
  );

  const syncPacketXml = `<cortex_sync_packet version="1.0.0" project="cortexos-core" timestamp="${new Date().toISOString()}">
  <active_task id="TASK-042" status="IN_PROGRESS">
    <title>Unattended Live Session Sync &amp; Visual Command Center</title>
    <allowed_symbols>
${runtimeAllowedSymbols.map((s) => `      <symbol>${s}</symbol>`).join("\n")}
    </allowed_symbols>
    <forbidden_paths>
      <path>hooks/sentinel_pretooluse.py</path>
      <path>.cortex/schema.cypher</path>
    </forbidden_paths>
  </active_task>
  <architectural_constraints>
    <rule>ADR-001: All memory extraction and prompt routing MUST execute locally via Ollama.</rule>
    <rule>ADR-003: Any edit to a symbol outside allowed_symbols is blocked by PreToolUse Sentinel (exit code 2).</rule>
  </architectural_constraints>
  <recent_continuity_delta turn="turn-094" platform="codex-cli">
    Byte-offset JSONL watcher verified; ready for Phase 4 Visual Command Center binding.
  </recent_continuity_delta>
</cortex_sync_packet>`;

  const payload: CortexDashboardStateResponse = {
    projectName: "CortexOS — Local-First AI Development OS",
    projectDnaVersion: "1.0.0",
    activeTask: {
      taskId: "TASK-042",
      title: "Unattended Live Session Sync & Visual Command Center",
      status: "IN_PROGRESS",
      allowedSymbolFqns: runtimeAllowedSymbols,
      forbiddenPaths: ["hooks/sentinel_pretooluse.py", ".cortex/schema.cypher"],
    },
    graph: { nodes, edges },
    telemetry,
    timeline,
    ctoRecommendations,
    syncPacketXml,
  };

  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const body = await request.json();
  if (body.action === "TOGGLE_SYMBOL_SCOPE" && typeof body.fqn === "string") {
    if (runtimeAllowedSymbols.includes(body.fqn)) {
      runtimeAllowedSymbols = runtimeAllowedSymbols.filter((s) => s !== body.fqn);
    } else {
      runtimeAllowedSymbols.push(body.fqn);
    }
  }
  return GET();
}
```

---

## 6. Knowledge Graph Explorer Component (`src/dashboard/components/KuzuGraphCanvas.tsx`)

```tsx
// src/dashboard/components/KuzuGraphCanvas.tsx
"use client";
import React, { useState } from "react";
import { GraphEdgeDTO, GraphNodeDTO } from "../../types/cortex-contracts";

interface KuzuGraphCanvasProps {
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
  onToggleScopeLock: (fqn: string) => void;
}

export const KuzuGraphCanvas: React.FC<KuzuGraphCanvasProps> = ({
  nodes,
  edges,
  onToggleScopeLock,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string>(nodes[3]?.id || "");
  const [filterMode, setFilterMode] = useState<"ALL" | "IN_SCOPE" | "LOCKED">("ALL");

  const visibleNodes = nodes.filter((node) => {
    if (filterMode === "ALL") return true;
    return node.scopeStatus === filterMode;
  });

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || visibleNodes[0];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            KuzuDB Property Graph Explorer &amp; AST Scope Sentinel
          </h2>
          <p className="text-xs text-slate-400">
            Click any ASTSymbol node to inspect its signature, cyclomatic complexity, or toggle its PreToolUse Scope Lock.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(["ALL", "IN_SCOPE", "LOCKED"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={`px-3 py-1 rounded text-xs font-mono transition ${
                filterMode === mode
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Interactive Node Topology Grid */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/70 p-4 rounded-lg border border-slate-800/80">
          {visibleNodes.map((node) => {
            const isSelected = selectedNode?.id === node.id;
            const badgeStyle =
              node.scopeStatus === "IN_SCOPE"
                ? "bg-emerald-950/90 text-emerald-300 border-emerald-700/70"
                : node.scopeStatus === "LOCKED"
                ? "bg-rose-950/90 text-rose-300 border-rose-700/70"
                : "bg-slate-800 text-slate-300 border-slate-700";

            return (
              <div
                key={node.id}
                onClick={() => setSelectedNodeId(node.id)}
                className={`cursor-pointer p-3.5 rounded-lg border transition flex flex-col justify-between ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-950/25 shadow-lg shadow-indigo-950/40"
                    : "border-slate-800 bg-slate-900/80 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-indigo-400">
                    {node.label}
                  </span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${badgeStyle}`}>
                    {node.scopeStatus === "IN_SCOPE"
                      ? "IN-SCOPE (EDITABLE)"
                      : node.scopeStatus === "LOCKED"
                      ? "LOCKED (SENTINEL)"
                      : "GOVERNANCE"}
                  </span>
                </div>
                <div className="text-sm font-medium text-slate-100 break-all">
                  {node.title}
                </div>
                {node.filePath && (
                  <div className="text-xs font-mono text-slate-400 mt-1 truncate">
                    {node.filePath}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Selected Node Inspector & Scope Lock Control */}
        <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col justify-between">
          {selectedNode ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase text-indigo-400">
                  Node Inspector
                </span>
                <span className="text-xs font-mono text-slate-500">
                  ID: {selectedNode.id}
                </span>
              </div>
              <h3 className="text-base font-semibold text-white break-all">
                {selectedNode.title}
              </h3>
              {selectedNode.fqn && (
                <div>
                  <div className="text-[11px] text-slate-400 uppercase font-mono">
                    Fully Qualified Name (FQN)
                  </div>
                  <div className="text-xs font-mono text-slate-200 bg-slate-900 p-2 rounded border border-slate-800 break-all mt-1">
                    {selectedNode.fqn}
                  </div>
                </div>
              )}
              {selectedNode.signature && (
                <div>
                  <div className="text-[11px] text-slate-400 uppercase font-mono">
                    AST Signature
                  </div>
                  <div className="text-xs font-mono text-emerald-300 bg-slate-900 p-2 rounded border border-slate-800 break-all mt-1">
                    {selectedNode.signature}
                  </div>
                </div>
              )}
              {typeof selectedNode.complexity === "number" && (
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-slate-400">Cyclomatic Complexity:</span>
                  <span className="font-mono font-semibold text-amber-300">
                    {selectedNode.complexity}
                  </span>
                </div>
              )}
              <div className="pt-2 border-t border-slate-800">
                <div className="text-[11px] text-slate-400 uppercase font-mono mb-1.5">
                  Connected Graph Edges ({edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id).length})
                </div>
                <ul className="space-y-1 text-xs font-mono text-slate-300 max-h-28 overflow-y-auto">
                  {edges
                    .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
                    .map((edge) => (
                      <li key={edge.id} className="bg-slate-900 px-2 py-1 rounded">
                        {edge.source} --[{edge.relationship}]--&gt; {edge.target}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-500">Select a node to inspect.</div>
          )}

          {selectedNode?.fqn && (
            <button
              onClick={() => onToggleScopeLock(selectedNode.fqn!)}
              className={`mt-4 w-full py-2 px-3 rounded-lg font-mono text-xs font-semibold transition ${
                selectedNode.scopeStatus === "IN_SCOPE"
                  ? "bg-rose-600/90 hover:bg-rose-500 text-white"
                  : "bg-emerald-600/90 hover:bg-emerald-500 text-white"
              }`}
            >
              {selectedNode.scopeStatus === "IN_SCOPE"
                ? "LOCK SYMBOL IN PRETOOLUSE SENTINEL"
                : "UNLOCK SYMBOL FOR ACTIVE TASK"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
```

---

## 7. Main Visual Command Center Dashboard (`src/dashboard/app/page.tsx`)

Combines all four Phase 4 pillars—**Knowledge Graph Explorer**, **Token Savings Telemetry**, **Continuity Timeline UI**, and **AI CTO Mode**—plus the **Cross-Platform Handoff Modal**:

```tsx
// src/dashboard/app/page.tsx
"use client";
import React, { useEffect, useState } from "react";
import { CortexDashboardStateResponse } from "../../types/cortex-contracts";
import { KuzuGraphCanvas } from "../components/KuzuGraphCanvas";

export default function CortexCommandCenterPage() {
  const [state, setState] = useState<CortexDashboardStateResponse | null>(null);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [copied, setCopied] = useState(false);

  async function fetchState() {
    const res = await fetch("/api/cortex/state");
    const data = await res.json();
    setState(data);
  }

  useEffect(() => {
    fetchState();
  }, []);

  async function handleToggleScopeLock(fqn: string) {
    const res = await fetch("/api/cortex/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "TOGGLE_SYMBOL_SCOPE", fqn }),
    });
    const updated = await res.json();
    setState(updated);
  }

  if (!state) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center font-mono">
        Loading CortexOS Visual Command Center (http://localhost:4300)...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Top Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono uppercase tracking-widest text-indigo-400">
              CortexOS Control Plane v{state.projectDnaVersion}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white mt-0.5">{state.projectName}</h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono">
            Active Task: <span className="text-emerald-400">{state.activeTask.taskId}</span>
          </div>
          <button
            onClick={() => setShowHandoffModal(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-semibold px-4 py-2 rounded-lg transition"
          >
            Generate Cross-Platform Handoff Packet
          </button>
        </div>
      </header>

      {/* Pillar 1: Token Savings & Local Ollama Telemetry Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <div className="text-xs font-mono text-slate-400 uppercase">Net Tokens Saved</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">
            {state.telemetry.netTokensSaved.toLocaleString()}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {state.telemetry.compressionRatioPct}% context reduction via scoped sync packets
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <div className="text-xs font-mono text-slate-400 uppercase">Local Ollama Pre-Execution</div>
          <div className="text-2xl font-bold text-indigo-400 mt-1">
            {state.telemetry.localOffloadPct}%
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {state.telemetry.localOllamaOffloadCount} local / {state.telemetry.cloudEscalationCount} cloud turns
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <div className="text-xs font-mono text-slate-400 uppercase">Active AST Scope Locks</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {state.activeTask.allowedSymbolFqns.length} Editable
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Fail-closed PreToolUse Sentinel active
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <div className="text-xs font-mono text-slate-400 uppercase">Estimated API Cost Saved</div>
          <div className="text-2xl font-bold text-emerald-300 mt-1">
            ${state.telemetry.estimatedCostSavingsUsd.toFixed(2)}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Across {state.telemetry.totalPromptsIntercepted} intercepted prompts
          </div>
        </div>
      </section>

      {/* Pillar 2: Interactive Knowledge Graph Explorer */}
      <KuzuGraphCanvas
        nodes={state.graph.nodes}
        edges={state.graph.edges}
        onToggleScopeLock={handleToggleScopeLock}
      />

      {/* Pillar 3 & 4: AI CTO Recommendations + Session Continuity Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* AI CTO Mode Panel */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-white">
                AI CTO Mode — Architectural Drift &amp; DAG Advisor
              </h2>
              <p className="text-xs text-slate-400">
                Live audit of KuzuDB graph vs. .cortex/project-dna.json rules
              </p>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded bg-indigo-950 text-indigo-300 border border-indigo-700">
              {state.ctoRecommendations.length} Active Advisories
            </span>
          </div>

          <div className="space-y-3">
            {state.ctoRecommendations.map((rec) => (
              <div
                key={rec.id}
                className="bg-slate-950 border border-slate-800 p-4 rounded-lg space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-amber-400">
                    [{rec.severity}] {rec.category}
                  </span>
                  {rec.suggestedAction.estimatedTokenSavings && (
                    <span className="text-xs font-mono text-emerald-400">
                      Est. Savings: ~{rec.suggestedAction.estimatedTokenSavings} tokens
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold text-slate-100">{rec.title}</div>
                <p className="text-xs text-slate-400">{rec.rationale}</p>
                <div className="bg-slate-900 px-3 py-1.5 rounded border border-slate-800 font-mono text-xs text-indigo-300">
                  $ {rec.suggestedAction.commandPreview}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Cross-Platform Continuity Timeline */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Unattended Session Continuity Timeline
              </h2>
              <p className="text-xs text-slate-400">
                Auto-captured JSONL &amp; MCP memory deltas across Codex, Claude Code, and Cursor
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {state.timeline.map((item) => (
              <div
                key={item.turnId}
                className="bg-slate-950 border border-slate-800 p-4 rounded-lg space-y-2"
              >
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-indigo-400 uppercase">
                    [{item.platform}] • {item.turnId}
                  </span>
                  <span className="text-slate-400">{item.timestamp}</span>
                </div>
                <p className="text-sm text-slate-200">{item.summary}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {item.symbolsTouched.map((sym) => (
                    <span
                      key={sym.fqn}
                      className="text-[11px] font-mono bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-emerald-300"
                    >
                      {sym.changeType.toUpperCase()}: {sym.fqn.split("#")[1] || sym.fqn}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Cross-Platform Handoff Packet Modal */}
      {showHandoffModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                Cross-Platform &lt;cortex_sync_packet&gt; Handoff Payload
              </h3>
              <button
                onClick={() => setShowHandoffModal(false)}
                className="text-xs font-mono text-slate-400 hover:text-white"
              >
                [ESC / CLOSE]
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Paste this compact XML packet into Claude Code, Codex, Cursor, or any web chat to transfer full project continuity without re-explaining your repo.
            </p>
            <pre className="bg-slate-950 border border-slate-800 p-4 rounded-lg text-xs font-mono text-emerald-300 overflow-x-auto max-h-80">
              {state.syncPacketXml}
            </pre>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(state.syncPacketXml);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-semibold px-4 py-2 rounded-lg"
              >
                {copied ? "Copied to Clipboard!" : "Copy <cortex_sync_packet>"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 8. Phase 4 Acceptance & Verification Checklist

When instructing your coding agent to `"begin Phase 4"`, require it to pass the following verification checks before marking Phase 4 complete:

1. **Instant Standalone Preview Check:**
   - Open `src/dashboard/cortexos_command_center_preview.html` in any browser and verify that:
     - Clicking any node in the **Knowledge Graph Explorer** updates the right-hand **AST Node Inspector** and allows toggling `IN-SCOPE` vs `LOCKED`.
     - Clicking **"Generate Cross-Platform Handoff Packet"** opens the modal with a valid `<cortex_sync_packet>` XML payload.
2. **API State & Scope Lock Mutation Check:**
   - `GET /api/cortex/state` returns valid `graph`, `telemetry`, `timeline`, `ctoRecommendations`, and `syncPacketXml`.
   - `POST /api/cortex/state` with `{ "action": "TOGGLE_SYMBOL_SCOPE", "fqn": "..." }` dynamically updates `activeTask.allowedSymbolFqns` and recalculates `ctoRecommendations`.
3. **AI CTO Engine Check:**
   - `AICtoEngine.evaluateArchitectureAndScope()` flags unlocked high-complexity symbols (`complexity > maxCyclomaticComplexity`), cross-layer boundary drift, and local Ollama offload optimization opportunities.
4. **PreToolUse Sentinel Regression Check:**
   - Run `python3 -m unittest discover -s tests -p "test_*.py" -v` and confirm all 5 AST Semantic Scope Guard tests continue to pass (100% green).
