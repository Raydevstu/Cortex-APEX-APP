// Step 1: Core TypeScript Contracts for CortexOS
export type PlatformId = 'codex' | 'claude_code' | 'hermes' | 'cursor' | 'opencode' | 'web_chat';

export interface ProjectDNA {
  schemaVersion: string;
  project: {
    id: string;
    name: string;
    summary: string;
    repositoryRoot: string;
  };
  techStack: {
    languages: string[];
    frontend: string[];
    backend: string[];
    databases: string[];
    packageManager: string;
    testRunner: string;
  };
  architecture: {
    pattern: string;
    entryPoints: Record<string, string>;
    immutableRules: string[];
    forbiddenPatterns: string[];
    protectedPaths: string[];
  };
  codingStandards: {
    maxFunctionLines: number;
    maxFileLines: number;
    requireStrictTypes: boolean;
    errorHandling: string;
  };
  agentRouting: {
    ollamaBaseUrl: string;
    models: {
      router: string;
      promptEngineer: string;
      memoryExtractor: string;
    };
    tokenBudget: {
      maxSyncPacketTokens: number;
      maxScopedGraphNodes: number;
    };
  };
}

export interface TaskScopeLock {
  activeTaskId: string;
  taskTitle: string;
  allowedWriteFiles: string[];
  protectedPaths: string[];
  forbiddenPatterns: string[];
  maxFunctionLines: number;
  updatedAt: string;
}

export interface RouterDecision {
  intent: 'LOCAL_ONLY' | 'HYBRID_PRE_EXEC' | 'CLOUD_HEAVY';
  confidence: number;
  targetFiles: string[];
  localToolsToRun: Array<'git_diff' | 'ast_outline' | 'typecheck' | 'grep_symbol'>;
  reasoning: string;
}

export interface Tier1RewrittenPrompt {
  objective: string;
  architecturalConstraints: string[];
  scopedContextSummary: string;
  allowedWriteFiles: string[];
  stepByStepPlan: string[];
  acceptanceCriteria: string[];
  compiledMarkdownPrompt: string;
}

export interface ExtractedMemoryDelta {
  sessionSummary: string;
  decisionsAdded: Array<{ id: string; title: string; rationale: string; moduleId: string }>;
  tasksUpdated: Array<{ id: string; title: string; status: 'todo' | 'in_progress' | 'done'; filesTouched: string[] }>;
  bugsResolved: Array<{ id: string; symptom: string; rootCause: string; resolution: string; symbolName: string }>;
  symbolsModified: Array<{ filePath: string; symbolName: string; changeType: 'added' | 'modified' | 'deleted' }>;
}

export interface CrossPlatformSyncPacket {
  packetId: string;
  generatedAt: number;
  projectId: string;
  activeTask: {
    id: string;
    title: string;
    allowedWriteFiles: string[];
  };
  recentDecisions: string[];
  recentTurnSummaries: Array<{ platform: PlatformId; summary: string }>;
  compactContextHeader: string;
}
