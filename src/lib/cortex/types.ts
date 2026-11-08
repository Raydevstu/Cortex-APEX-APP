/**
 * CortexOS — Phase 1 shared type contracts.
 * These types define the data contracts between the Cortex engines,
 * the daemon API and the Command Center UI.
 */

export type MemoryType =
  | 'decision'
  | 'architecture'
  | 'requirement'
  | 'todo'
  | 'bug'
  | 'preference'

export const MEMORY_TYPES: readonly MemoryType[] = [
  'decision',
  'architecture',
  'requirement',
  'todo',
  'bug',
  'preference',
] as const

export type IntentType =
  | 'feature_build'
  | 'bugfix'
  | 'refactor'
  | 'research'
  | 'config'
  | 'boilerplate'
  | 'question'
  | 'docs'
  | 'deploy'
  | 'test'

export type EngineKind = 'fast' | 'deep' | 'cloud'

export type AIPlatform =
  | 'codex'
  | 'hermes'
  | 'opencode'
  | 'cursor'
  | 'windsurf'
  | 'claude'
  | 'chatgpt'
  | 'local_ollama'

export const AI_PLATFORMS: readonly AIPlatform[] = [
  'codex', 'hermes', 'opencode', 'cursor', 'windsurf', 'claude', 'chatgpt', 'local_ollama',
] as const

export type GraphNodeKind =
  | 'root'
  | 'module'
  | 'tech'
  | 'feature'
  | 'bug'
  | 'external'

export const GRAPH_NODE_KINDS: readonly GraphNodeKind[] = [
  'root',
  'module',
  'tech',
  'feature',
  'bug',
  'external',
] as const

export const GRAPH_RELATIONS: readonly string[] = [
  'CONTAINS',
  'USES',
  'DEPENDS_ON',
  'IMPLEMENTS',
  'BLOCKED_BY',
  'HAS_BUG',
  'PREFERS',
  'SYNCED_WITH',
] as const

// ---------------------------------------------------------------------------
// PROJECT DNA
// ---------------------------------------------------------------------------

export interface TechStackEntry {
  layer: string
  technology: string
  evidence: string
}

export interface CodingStandard {
  rule: string
  source: string
}

export interface PreferredLibrary {
  purpose: string
  library: string
  source: string
}

export interface CodeMapEntry {
  path: string
  language: string
  imports: number
  exports: number
  functions: number
  lines: number
  tokens: number
}

export interface DirEntry {
  path: string
  files: number
}

export interface FileStats {
  scannedFiles: number
  scannedDirs: number
  totalLines: number
  languages: Record<string, number>
  topDirs: DirEntry[]
  codeMap: CodeMapEntry[]
  prismaModels: string[]
  envKeys: string[]
  packageDeps: string[]
  scannedAt: string
}

export interface DnaDocument {
  architecturePhilosophy: string
  techStack: TechStackEntry[]
  codingStandards: CodingStandard[]
  businessRules: string[]
  preferredLibraries: PreferredLibrary[]
  designPatterns: string[]
  deploymentStrategy: string
  fileStats: FileStats
}

// ---------------------------------------------------------------------------
// Workspace scan (Deterministic Code Map — blueprint §3, Tier 1 memory)
// ---------------------------------------------------------------------------

export interface PackageJsonInfo {
  name?: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  scripts: Record<string, string>
}

export interface WorkspaceScan {
  rootPath: string
  packageJson: PackageJsonInfo | null
  tsConfig: Record<string, unknown> | null
  eslintConfigFile: string | null
  prettierConfigFile: string | null
  nextConfigFile: string | null
  componentsJson: boolean
  prismaSchemaFile: string | null
  prismaModels: string[]
  prismaDatasourceProvider: string | null
  envExampleKeys: string[]
  readmeTitle: string | null
  fileStats: FileStats
}

// ---------------------------------------------------------------------------
// Intent, routing & decomposition
// ---------------------------------------------------------------------------

export interface RoutingDecision {
  tier: 'fast-path' | 'local-agent' | 'main-model'
  target: string
  reason: string
}

export interface IntentResult {
  intent: IntentType
  confidence: number // 0..1
  complexity: number // 1..10
  domains: string[]
  routing: RoutingDecision
  signals: string[]
}

export interface Subtask {
  id: string
  domain: string
  title: string
  description: string
  dependsOn: string[]
}

export interface Decomposition {
  needed: boolean
  rationale: string
  subtasks: Subtask[]
}

// ---------------------------------------------------------------------------
// Memory extraction
// ---------------------------------------------------------------------------

export interface ExtractedMemory {
  type: MemoryType
  key: string
  value: string
  importance: number
}

// ---------------------------------------------------------------------------
// Rewrite context & result
// ---------------------------------------------------------------------------

export interface GraphContextPointer {
  source: string
  relation: string
  target: string
  targetKind: string
}

export interface RelevantMemory {
  id: string
  type: MemoryType
  key: string
  value: string
  status: string
  importance: number
  matched: 'keyword' | 'open-item'
}

export interface ContextUsed {
  dnaSections: string[]
  stackLines: string[]
  memories: RelevantMemory[]
  graphPointers: GraphContextPointer[]
  codeMapSummary: {
    files: number
    totalLines: number
    languages: Record<string, number>
    prismaModels: string[]
  }
  tokensNaiveContext: number
  tokensCompactContext: number
}

export interface RewriteMetrics {
  tokensRaw: number
  tokensStructured: number
  tokensContextAvoided: number
  savingsPct: number
  durationMs: number
}

export interface RewriteResult {
  sessionId: string
  prompt: string
  engineUsed: EngineKind
  engineNote?: string
  intent: IntentResult
  decomposition: Decomposition
  context: ContextUsed
  metrics: RewriteMetrics
}

// ---------------------------------------------------------------------------
// State packet (Compact State Header — blueprint §3 delta-sync foundation)
// ---------------------------------------------------------------------------

export interface StatePacket {
  project: {
    id: string
    slug: string
    name: string
    platform: string | null
  }
  stateHash: string
  updatedAt: string
  stack: string[]
  latestDecisions: string[]
  openItems: string[]
  graphRoots: string[]
  markdown: string
  tokens: number
}

// ---------------------------------------------------------------------------
// Phase 2 — Cross-Platform Delta Sync Packet (blueprint Part 1 §4, exact)
// ---------------------------------------------------------------------------

export interface SyncPacketHeader {
  projectId: string
  projectName: string
  stateHash: string
  previousPlatform: string
  targetPlatform: string
  syncedAtIso: string
}

export interface DnaSnapshot {
  stackSummary: string
  activeConstraints: string[]
}

export interface ScopedGraphContext {
  activeModule: string
  relevantDecisions: Array<{ id: string; title: string; constraint: string }>
  relevantSymbols: Array<{ symbolId: string; signature: string }>
  openBugsInScope: Array<{ id: string; title: string; rootCause: string }>
}

export interface ContinuityState {
  lastCompletedAction: string
  activeTask: {
    id: string
    title: string
    preExecutedByLocalAgent: string[]
    remainingCoreWork: string
  } | null
  nextPendingTasks: string[]
}

export interface CrossPlatformSyncPacket extends StatePacket {
  header: SyncPacketHeader
  dnaSnapshot: DnaSnapshot
  scopedGraphContext: ScopedGraphContext
  continuityState: ContinuityState
}

export interface SyncHandoffRecord {
  id: string
  fromPlatform: string
  toPlatform: string
  stateHash: string
  activeModule: string | null
  packetTokens: number
  createdAt: string
}

// ---------------------------------------------------------------------------
// Phase 2 — Episodic store (blueprint §3 Tier-3 memory)
// ---------------------------------------------------------------------------

export interface EpisodeSearchResult {
  interactionId: string
  title: string | null
  platform: string | null
  summary: string | null
  createdAt: string
  score: number
  snippet: string
}

export interface EpisodicSearchResponse {
  query: string
  provider: string
  results: EpisodeSearchResult[]
  memories: Array<RelevantMemory & { createdAt: string }>
}

// ---------------------------------------------------------------------------
// Phase 2 — File watcher & git intelligence
// ---------------------------------------------------------------------------

export interface WatcherStatus {
  projectId: string
  slug: string
  projectName: string
  running: boolean
  rootPath: string | null
  watchEnabled: boolean
  watchedFiles: number
  events: number
  errors: number
  startedAt: string | null
  lastEventAt: string | null
  lastEventPath: string | null
  lastError: string | null
}

export interface GitCommitRecord {
  id: string
  hash: string
  message: string
  author: string | null
  platform: string | null
  filesCount: number
  files: Array<{ path: string; status: string }>
  committedAt: string
  ingestedFrom: string
}

// ---------------------------------------------------------------------------
// Daemon settings & health
// ---------------------------------------------------------------------------

export interface DaemonSettings {
  ollamaBaseUrl: string
  ollamaModel: string
  ollamaEmbeddingModel: string
  defaultEngine: EngineKind
}

export interface OllamaStatus {
  reachable: boolean
  baseUrl: string
  models: string[]
  error?: string
  latencyMs?: number
}

export interface DaemonHealth {
  status: 'online'
  version: string
  phase: string
  database: 'ok' | 'error'
  ollama: OllamaStatus
  counts: {
    projects: number
    memories: number
    nodes: number
    edges: number
    interactions: number
    promptSessions: number
    handoffs: number
    commits: number
    episodes: number
  }
}

// ---------------------------------------------------------------------------
// API payloads (server → client)
// ---------------------------------------------------------------------------

export interface ProjectSummary {
  id: string
  slug: string
  name: string
  description: string | null
  rootPath: string | null
  platform: string | null
  createdAt: string
  updatedAt: string
  counts: {
    memories: number
    openItems: number
    nodes: number
    edges: number
    promptSessions: number
  }
  dnaGeneratedAt: string | null
  lastActivityAt: string | null
}

export interface DashboardMetrics {
  totals: {
    projects: number
    memories: number
    memoriesByType: Record<string, number>
    nodes: number
    edges: number
    interactions: number
    promptSessions: number
  }
  sync: {
    handoffs: number
    commits: number
    episodes: number
    watchersRunning: number
    lastHandoffAt: string | null
  }
  tokenSavings: {
    tokensRaw: number
    tokensStructured: number
    tokensContextAvoided: number
    savingsPct: number
    avgLatencyMs: number
  }
  daily: Array<{ date: string; tokensAvoided: number; sessions: number }>
  recentEvents: Array<{
    id: string
    kind: string
    message: string
    createdAt: string
    projectName: string
    projectSlug: string
  }>
  openItems: Array<{
    id: string
    projectId: string
    projectName: string
    type: string
    key: string
    value: string
    importance: number
    createdAt: string
  }>
}
