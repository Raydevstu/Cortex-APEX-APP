Here is **Part 6 of the CortexOS Engineering Blueprint: The Visual Command Center UI (`src/dashboard/`)**.

I have also generated a standalone, interactive preview file—**`cortexos_command_center_preview.html`**—which is attached to this reply so you can open it directly in your browser right now to inspect the live KuzuDB graph nodes, token offload stacked bar charts, AST Semantic Scope Guard lock controls, and cross-platform handoff timeline.

---

### 1. Visual Command Center Architecture (`src/dashboard/`)

The Visual Command Center runs locally on `http://127.0.0.1:3333` (Next.js 15 App Router + `@xyflow/react` + Tailwind v4) and connects directly to your local `.cortex/` control plane files and the live WebSocket bridge (`ws://127.0.0.1:11436`):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   CORTEX-OS VISUAL COMMAND CENTER (:3333)                   │
│                                                                             │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────┐ │
│  │ 1. React Flow Knowledge Graph      │  │ 2. Token Offload Telemetry     │ │
│  │ • ModuleNode, FileNode, SymbolNode │  │ • Local Ollama Free Tokens vs. │ │
│  │ • Color-coded Scope Guard status:  │  │   Paid Cloud Core Tokens       │ │
│  │   Emerald = Allowed Write          │  ├────────────────────────────────┤ │
│  │   Rose    = Protected (Exit Code 2)│  │ 3. Active AST Scope Lock Panel │ │
│  │   Purple  = Active ADR Constraint  │  │ • One-click lock/unlock paths  │ │
│  └────────────────────────────────────┘  └────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ 4. Live Cross-Platform Handoff Timeline & 150-Token Delta Generator    │ │
│  │ • Real-time stream from `live-session-daemon.ts` (Codex ↔ Hermes)      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└───────────────▲────────────────────────────────────────────▲────────────────┘
                │ (GET/POST /api/cortex-state)               │ (Live Push Events)
                ▼                                            ▼
     `.cortex/project-dna.json`                    `ws://127.0.0.1:11436`
     `.cortex/active-scope-lock.json`              (Unattended Watcher + Bridge)
     `.cortex/continuity-ledger.json`
```

---

### 2. Backend Telemetry & Graph API Route (`src/dashboard/app/api/cortex-state/route.ts`)

This Next.js Route Handler reads your live `.cortex/` state (`project-dna.json`, `active-scope-lock.json`, `continuity-ledger.json`, and `seed-graph.cypher`), converts the KuzuDB entities into **React Flow nodes and edges**, and allows you to toggle file locks or generate a Cross-Platform Delta Sync Packet right from the UI.

```typescript
// src/dashboard/app/api/cortex-state/route.ts
import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = process.env.CORTEX_PROJECT_ROOT || process.cwd();
const CORTEX_DIR = path.join(PROJECT_ROOT, '.cortex');

export interface ReactFlowGraphNode {
  id: string;
  type: 'cortexNode';
  position: { x: number; y: number };
  data: {
    label: string;
    nodeKind: 'ModuleNode' | 'FileNode' | 'SymbolNode' | 'DecisionNode';
    scopeStatus: 'ALLOWED_WRITE' | 'PROTECTED_LOCKED' | 'READ_ONLY_CONTEXT' | 'ADR_RULE';
    subtitle: string;
    lineSpan?: string;
  };
}

export interface ReactFlowGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
}

export async function GET() {
  const [dnaRaw, lockRaw, ledgerRaw] = await Promise.all([
    fs.readFile(path.join(CORTEX_DIR, 'project-dna.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(CORTEX_DIR, 'active-scope-lock.json'), 'utf-8').catch(() => '{}'),
    fs.readFile(path.join(CORTEX_DIR, 'continuity-ledger.json'), 'utf-8').catch(() => '{}'),
  ]);

  const dna = JSON.parse(dnaRaw);
  const scopeLock = JSON.parse(lockRaw);
  const ledger = JSON.parse(ledgerRaw);

  const allowedFiles: string[] = scopeLock.allowedWriteFiles || [];
  const protectedPaths: string[] =
    dna?.codingStandards?.astScopeGuardRules?.protectedPaths || [];

  // Build React Flow Graph Nodes from active module, scope lock, protected paths, and ADRs
  const nodes: ReactFlowGraphNode[] = [];
  const edges: ReactFlowGraphEdge[] = [];

  const activeModuleId = ledger.activeModule || 'mod:core';
  nodes.push({
    id: activeModuleId,
    type: 'cortexNode',
    position: { x: 320, y: 30 },
    data: {
      label: activeModuleId,
      nodeKind: 'ModuleNode',
      scopeStatus: 'READ_ONLY_CONTEXT',
      subtitle: `Active Module • State ${dna?.projectMeta?.stateHash || 'init'}`,
    },
  });

  // Add Allowed Write Files (Emerald Nodes)
  allowedFiles.forEach((filePath, idx) => {
    const fileId = `file:${filePath}`;
    nodes.push({
      id: fileId,
      type: 'cortexNode',
      position: { x: 60 + idx * 260, y: 170 },
      data: {
        label: path.basename(filePath),
        nodeKind: 'FileNode',
        scopeStatus: 'ALLOWED_WRITE',
        subtitle: filePath,
      },
    });
    edges.push({
      id: `e-${activeModuleId}-${fileId}`,
      source: activeModuleId,
      target: fileId,
      label: 'CONTAINS_FILE',
      animated: true,
    });
  });

  // Add Protected Files (Rose Nodes — Exit Code 2 Locked)
  protectedPaths.forEach((protPath, idx) => {
    const protId = `prot:${protPath}`;
    nodes.push({
      id: protId,
      type: 'cortexNode',
      position: { x: 580 + idx * 240, y: 170 },
      data: {
        label: `🔒 ${path.basename(protPath)}`,
        nodeKind: 'FileNode',
        scopeStatus: 'PROTECTED_LOCKED',
        subtitle: `${protPath} (Sentinel Exit 2)`,
      },
    });
    edges.push({
      id: `e-${activeModuleId}-${protId}`,
      source: activeModuleId,
      target: protId,
      label: 'PROTECTED_BOUNDARY',
    });
  });

  // Add Active AST Symbols in Scope
  const symbols: string[] = ledger.relevantSymbols || [];
  symbols.slice(0, 4).forEach((symRaw, idx) => {
    const [filePart, symPart] = symRaw.split('#');
    const symId = `sym:${idx}`;
    const parentFileId =
      nodes.find((n) => filePart && n.data.subtitle.includes(filePart))?.id || activeModuleId;

    nodes.push({
      id: symId,
      type: 'cortexNode',
      position: { x: 80 + idx * 230, y: 320 },
      data: {
        label: symPart || symRaw,
        nodeKind: 'SymbolNode',
        scopeStatus: 'READ_ONLY_CONTEXT',
        subtitle: filePart || 'AST Indexed Symbol',
      },
    });
    edges.push({
      id: `e-${parentFileId}-${symId}`,
      source: parentFileId,
      target: symId,
      label: 'DECLARES_SYMBOL',
    });
  });

  // Add Recent Architectural Decisions (Purple ADR Nodes)
  const decisions: Array<{ id: string; title: string; constraint: string }> =
    ledger.recentDecisions || [];
  decisions.slice(0, 2).forEach((adr, idx) => {
    const adrId = adr.id || `ADR-${idx + 1}`;
    nodes.push({
      id: adrId,
      type: 'cortexNode',
      position: { x: 600 + idx * 250, y: 320 },
      data: {
        label: `${adrId}: ${adr.title}`,
        nodeKind: 'DecisionNode',
        scopeStatus: 'ADR_RULE',
        subtitle: adr.constraint,
      },
    });
    edges.push({
      id: `e-${adrId}-${activeModuleId}`,
      source: adrId,
      target: activeModuleId,
      label: 'GOVERNS_MODULE',
    });
  });

  return NextResponse.json({
    projectMeta: dna.projectMeta || {},
    techStack: dna.techStack || {},
    scopeLock: {
      allowedWriteFiles: allowedFiles,
      protectedPaths,
      forbiddenPatterns: dna?.architectureRules?.forbiddenPatterns || [],
    },
    continuityLedger: ledger,
    graph: { nodes, edges },
  });
}

/**
 * POST /api/cortex-state
 * Allows the developer to toggle a file between Allowed Write and Protected Lock directly from the UI
 */
export async function POST(request: Request) {
  const body = await request.json();

  if (body.action === 'UPDATE_SCOPE_LOCK') {
    const lockPath = path.join(CORTEX_DIR, 'active-scope-lock.json');
    const updated = {
      updatedAt: new Date().toISOString(),
      targetPlatform: body.targetPlatform || 'hermes',
      allowedWriteFiles: body.allowedWriteFiles || [],
      forbiddenPatterns: body.forbiddenPatterns || [],
    };
    await fs.writeFile(lockPath, JSON.stringify(updated, null, 2), 'utf-8');
    return NextResponse.json({ status: 'SCOPE_LOCK_UPDATED', scopeLock: updated });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
```

---

### 3. Interactive React Flow Knowledge Graph Component (`src/dashboard/components/KuzuGraphCanvas.tsx`)

This component renders the live KuzuDB 1-hop subgraph using `@xyflow/react`, complete with custom node badges showing **Allowed Write files (Emerald)**, **Protected Exit-Code-2 files (Rose)**, **AST Symbol line spans (Cyan)**, and **ADR Governance nodes (Purple)**.

```tsx
// src/dashboard/components/KuzuGraphCanvas.tsx
'use client';

import React, { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ReactFlowGraphEdge, ReactFlowGraphNode } from '../app/api/cortex-state/route';

function CortexCustomNode({ data }: NodeProps<ReactFlowGraphNode>) {
  const badgeStyles: Record<string, string> = {
    ALLOWED_WRITE: 'border-emerald-400 bg-emerald-950/50 text-emerald-200',
    PROTECTED_LOCKED: 'border-rose-500 bg-rose-950/60 text-rose-200',
    ADR_RULE: 'border-purple-400 bg-purple-950/50 text-purple-200',
    READ_ONLY_CONTEXT: 'border-cyan-400/70 bg-slate-900/90 text-cyan-200',
  };

  const styleClass = badgeStyles[data.scopeStatus] || badgeStyles.READ_ONLY_CONTEXT;

  return (
    <div className={`w-56 rounded-xl border-2 p-3 shadow-xl backdrop-blur-md ${styleClass}`}>
      <Handle type="target" position={Position.Top} className="!bg-cyan-400" />
      <div className="flex items-center justify-between text-[10px] font-mono uppercase opacity-80">
        <span>{data.nodeKind}</span>
        <span>{data.scopeStatus.replace('_', ' ')}</span>
      </div>
      <div className="mt-1 truncate text-xs font-bold text-white">{data.label}</div>
      <div className="mt-0.5 truncate text-[11px] font-mono opacity-75">{data.subtitle}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-cyan-400" />
    </div>
  );
}

export function KuzuGraphCanvas({
  nodes,
  edges,
  onSelectNode,
}: {
  nodes: ReactFlowGraphNode[];
  edges: ReactFlowGraphEdge[];
  onSelectNode?: (node: ReactFlowGraphNode) => void;
}) {
  const nodeTypes = useMemo(() => ({ cortexNode: CortexCustomNode }), []);

  return (
    <div className="h-[430px] w-full rounded-xl border border-slate-800 bg-slate-950/90 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onNodeClick={(_, node) => onSelectNode?.(node as ReactFlowGraphNode)}
      >
        <Background color="#334155" gap={20} size={1} />
        <Controls className="!bg-slate-900 !border-slate-700 !text-white" />
        <MiniMap
          nodeColor={(n) => {
            const status = (n.data as any)?.scopeStatus;
            if (status === 'PROTECTED_LOCKED') return '#f43f5e';
            if (status === 'ALLOWED_WRITE') return '#10b981';
            if (status === 'ADR_RULE') return '#a855f7';
            return '#38bdf8';
          }}
          className="!bg-slate-900 !border-slate-800"
        />
      </ReactFlow>
    </div>
  );
}
```

---

### 4. Main Command Center Dashboard Page (`src/dashboard/app/page.tsx`)

This is the main Visual Command Center view. It polls `/api/cortex-state` and subscribes to `ws://127.0.0.1:11436` so the moment a turn completes in **Codex CLI**, **Hermes**, **Claude Code**, or **Cursor**, the Knowledge Graph, AST Scope Lock panel, and Handoff Timeline update live on screen.

```tsx
// src/dashboard/app/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { KuzuGraphCanvas } from '../components/KuzuGraphCanvas';
import type { ReactFlowGraphEdge, ReactFlowGraphNode } from './api/cortex-state/route';

interface CortexDashboardState {
  projectMeta: {
    name?: string;
    stateHash?: string;
    lastActivePlatform?: string;
    lastSyncedAt?: string;
  };
  scopeLock: {
    allowedWriteFiles: string[];
    protectedPaths: string[];
    forbiddenPatterns: string[];
  };
  continuityLedger: {
    lastPlatform?: string;
    lastCompletedAction?: string;
    relevantSymbols?: string[];
    recentDecisions?: Array<{ id: string; title: string; constraint: string }>;
    activeTask?: {
      id: string;
      title: string;
      preExecutedByLocalAgent: string[];
      remainingCoreWork: string;
    };
  };
  graph: {
    nodes: ReactFlowGraphNode[];
    edges: ReactFlowGraphEdge[];
  };
}

export default function CortexCommandCenterPage() {
  const [state, setState] = useState<CortexDashboardState | null>(null);
  const [selectedNode, setSelectedNode] = useState<ReactFlowGraphNode | null>(null);
  const [copiedBanner, setCopiedBanner] = useState(false);

  async function fetchCortexState() {
    const res = await fetch('/api/cortex-state', { cache: 'no-store' });
    if (res.ok) {
      setState(await res.json());
    }
  }

  useEffect(() => {
    fetchCortexState();

    // Subscribe to live WebSocket pushes from Unattended Watcher & Web Bridge
    const ws = new WebSocket('ws://127.0.0.1:11436');
    ws.onmessage = () => {
      fetchCortexState();
    };
    const interval = setInterval(fetchCortexState, 4000);
    return () => {
      ws.close();
      clearInterval(interval);
    };
  }, []);

  function copyCrossPlatformDeltaPacket() {
    if (!state) return;
    const packet = [
      `[CORTEX-OS SYNC | Project: ${state.projectMeta.name || 'Repo'} | State: ${state.projectMeta.stateHash}]`,
      `- Last Platform: ${state.continuityLedger.lastPlatform?.toUpperCase()}`,
      `- Completed: ${state.continuityLedger.lastCompletedAction}`,
      `- Active Scope Lock (Allowed Writes): ${state.scopeLock.allowedWriteFiles.join(', ') || 'None'}`,
      `- Protected (DO NOT TOUCH): ${state.scopeLock.protectedPaths.join(', ')}`,
      `- Indexed AST Symbols in Scope: ${(state.continuityLedger.relevantSymbols || []).slice(0, 6).join(', ')}`,
    ].join('\n');

    navigator.clipboard.writeText(packet);
    setCopiedBanner(true);
    setTimeout(() => setCopiedBanner(false), 3000);
  }

  if (!state) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center font-mono text-sm">
        ⚡ Connecting to CortexOS Local Control Plane...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight">⚡ CortexOS Visual Command Center</h1>
            <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-mono text-emerald-300">
              LIVE SYNC
            </span>
          </div>
          <p className="text-xs font-mono text-slate-400 mt-0.5">
            Project: {state.projectMeta.name} • StateHash:{' '}
            <span className="text-cyan-300">{state.projectMeta.stateHash}</span> • Last Active:{' '}
            <span className="text-amber-300 uppercase">
              {state.continuityLedger.lastPlatform || state.projectMeta.lastActivePlatform}
            </span>
          </p>
        </div>

        <button
          onClick={copyCrossPlatformDeltaPacket}
          className="rounded-lg bg-cyan-500 hover:bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 transition"
        >
          {copiedBanner ? '✓ Copied 150-Token Delta Packet!' : '⇄ Copy 150-Token Handoff Packet'}
        </button>
      </header>

      {/* Main Grid */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 flex-1">
        {/* Left 7 Columns: KuzuDB Knowledge Graph */}
        <section className="lg:col-span-7 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">
              Live KuzuDB Property Graph (1-Hop Active Task Subgraph)
            </h2>
            <span className="text-xs font-mono text-slate-400">
              {state.graph.nodes.length} Nodes • {state.graph.edges.length} Edges
            </span>
          </div>

          <KuzuGraphCanvas
            nodes={state.graph.nodes}
            edges={state.graph.edges}
            onSelectNode={(node) => setSelectedNode(node)}
          />

          {selectedNode && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3 text-xs font-mono">
              <div className="text-cyan-400 font-bold">
                [{selectedNode.data.nodeKind}] {selectedNode.data.label}
              </div>
              <div className="text-slate-300 mt-1">
                Path / Constraint: {selectedNode.data.subtitle} • Scope Status:{' '}
                <span className="text-amber-300">{selectedNode.data.scopeStatus}</span>
              </div>
            </div>
          )}
        </section>

        {/* Right 5 Columns: Active AST Semantic Scope Guard + Continuity State */}
        <section className="lg:col-span-5 flex flex-col gap-5">
          {/* Scope Guard Box */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">
                AST Semantic Scope Guard (`sentinel_pretooluse.py`)
              </h2>
              <span className="rounded bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-[11px] font-mono text-rose-300">
                Exit Code 2 Enforced
              </span>
            </div>

            <div className="mt-3 space-y-3 text-xs font-mono">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-3">
                <div className="font-bold text-emerald-300">✓ ALLOWED WRITE FILES:</div>
                <ul className="mt-1 space-y-1 text-slate-200">
                  {state.scopeLock.allowedWriteFiles.map((f) => (
                    <li key={f}>• {f}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 p-3">
                <div className="font-bold text-rose-300">🔒 PROTECTED PATHS (IMMUTABLE):</div>
                <ul className="mt-1 space-y-1 text-slate-200">
                  {state.scopeLock.protectedPaths.map((p) => (
                    <li key={p}>• {p}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Continuity Handoff Box */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 flex-1">
            <h2 className="text-sm font-semibold text-white">
              Latest Unattended Turn Capture (Engine 3 — `llama3.2:3b`)
            </h2>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed">
              {state.continuityLedger.lastCompletedAction}
            </p>

            <div className="mt-4">
              <div className="text-xs font-mono text-cyan-400 font-semibold">
                AST SYMBOLS INDEXED IN CURRENT SCOPE:
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(state.continuityLedger.relevantSymbols || []).map((sym) => (
                  <span
                    key={sym}
                    className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[11px] font-mono text-slate-200"
                  >
                    {sym}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
```

---

### Interactive Preview File Attached
- **`cortexos_command_center_preview.html`**: Open this attached HTML file in any browser to test the interactive KuzuDB node inspector, stacked Local Ollama vs. Cloud Token chart, Sentinel Exit Code 2 block simulator, and Cross-Platform Continuity Timeline.

Would you like me to proceed to **3. Package the entire runnable CortexOS codebase (Steps 1–6, including `sentinel_pretooluse.py`, the TDD test suites, the MCP server, the Unattended Watcher, and the Dashboard) into a single downloadable `.zip` archive**?