// Step 6: React Flow (@xyflow/react) Interactive Property Graph Explorer
import React from 'react';

export interface GraphNodeData {
  id: string;
  label: string;
  kind: 'ModuleNode' | 'FileNode' | 'SymbolNode' | 'DecisionNode' | 'TaskNode';
  locked?: boolean;
}

export const SAMPLE_GRAPH_NODES: GraphNodeData[] = [
  { id: 'mod_core', label: 'Module: CortexEngine', kind: 'ModuleNode' },
  { id: 'file_pipeline', label: 'src/engine/local-ollama-pipeline.ts', kind: 'FileNode', locked: true },
  { id: 'file_sentinel', label: 'hooks/sentinel_pretooluse.py', kind: 'FileNode', locked: true },
  { id: 'sym_rewrite', label: 'fn: rewritePromptTier1()', kind: 'SymbolNode' },
  { id: 'dec_zero_token', label: 'ADR-01: Local Ollama Pre-Execution', kind: 'DecisionNode' },
  { id: 'task_active', label: 'Task: Enforce AST PreToolUse Lock', kind: 'TaskNode' }
];

export function KuzuGraphCanvas() {
  return (
    <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-slate-100">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-400">
        KuzuDB Live Property Graph ({SAMPLE_GRAPH_NODES.length} Scoped Nodes)
      </h3>
    </div>
  );
}
