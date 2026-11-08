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
  // Phase 3 (blueprint Part 1 §2 — governance edges):
  'GOVERNED_BY',
  'SUPERSEDES',
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
  /** Phase 3 — Engine 1 router model (blueprint agentRoutingPolicy.fastRouter). */
  ollamaRouterModel: string
  /** Phase 3 — Engine 3 memory extractor model (agentRoutingPolicy.memoryExtractor). */
  ollamaExtractorModel: string
  /** Phase 4 — cloud escalation model label used by the DAG orchestrator
   *  when routing cross-module implementation subtasks (agentRoutingPolicy.cloudEscalationModel). */
  cloudEscalationModel: string
  /** Phase 3 — optional SearXNG endpoint for the local_docs_search web layer. */
  searxngUrl: string
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
  /** Cumulative capability flags — one per shipped blueprint phase. */
  capabilities: string[]
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
    preExecRuns: number
    stagedArtifacts: number
    dagPlans: number
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
  preExec: {
    runs: number
    localOnlyRuns: number
    cloudTokensSaved: number
    contextTokensAvoided: number
    filesStaged: number
    avgDurationMs: number
    lastRunAt: string | null
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

// ---------------------------------------------------------------------------
// Phase 3 — Pre-Execution Local Agent & Token Optimizer (blueprint v2 §6 +
// Part 2: RouterDecisionSchema / Tier1RewrittenPromptSchema contracts)
// ---------------------------------------------------------------------------

export type PreExecIntentCategory =
  | 'feature_build'
  | 'bug_fix'
  | 'refactor'
  | 'schema_change'
  | 'architecture'
  | 'test_gen'
  | 'docs'

export type PreExecExecutionMode = 'LOCAL_ONLY' | 'HYBRID_PRE_EXECUTE' | 'CLOUD_DIRECT_WITH_DNA'

export type PreExecLocalToolName =
  | 'ast_symbol_lookup'
  | 'schema_inspect'
  | 'local_docs_search'
  | 'scaffold_boilerplate'
  | 'git_diff_summary'

export interface PreExecPlanStep {
  stepId: string
  toolName: PreExecLocalToolName
  toolArgs: Record<string, string>
  expectedArtifact: string
}

export interface CloudCoreTaskSpec {
  coreObjective: string
  targetFiles: string[]
  readOnlyReferenceFiles: string[]
  scopeGuardConstraints: string[]
}

export interface RouterDecision {
  intentCategory: PreExecIntentCategory
  complexityScore: number // 1..10
  executionMode: PreExecExecutionMode
  relevantModuleIds: string[]
  localPreExecutionPlan: PreExecPlanStep[]
  cloudCoreTaskSpec: CloudCoreTaskSpec
  estimatedCloudTokensSaved: number
}

export interface ExecutedArtifact {
  stepId: string
  toolName: PreExecLocalToolName
  ok: boolean
  durationMs: number
  summary: string
  data: Record<string, unknown>
  stagedFileCount: number
  error?: string
}

export interface DecomposedSubtask {
  stepNumber: number
  layer: 'database' | 'backend' | 'frontend' | 'auth' | 'testing'
  action: string
  handledBy: 'COMPLETED_BY_LOCAL_OLLAMA' | 'ASSIGNED_TO_MAIN_AI'
}

export interface Tier1RewrittenPrompt {
  taskTitle: string
  targetPlatformOptimized: string
  decomposedSubtasks: DecomposedSubtask[]
  scopeLock: {
    allowedWriteFiles: string[]
    readOnlyContextFiles: string[]
    forbiddenPatterns: string[]
  }
  finalInjectedMarkdownPrompt: string
}

export interface StagedArtifactSummary {
  id: string
  runId: string
  kind: string
  action: string
  targetPath: string
  rationale: string
  language: string
  status: 'staged' | 'applied' | 'discarded'
  contentLength: number
  appliedAt: string | null
  createdAt: string
}

/** Full staged artifact as served to clients (content included). */
export interface StagedArtifactDetailClient extends StagedArtifactSummary {
  content: string
  runRawPrompt: string
}

export interface PreExecRunSummary {
  id: string
  rawPrompt: string
  targetPlatform: string
  intentCategory: string
  complexityScore: number
  executionMode: string
  routerEngine: string
  handledLocally: boolean
  tokensSavedCloud: number
  stagedCount: number
  durationMs: number
  createdAt: string
}

export interface PreExecResult {
  runId: string
  handledCompletelyLocally: boolean
  router: RouterDecision
  routerEngine: string // ollama:<model> | deterministic
  routerNote?: string
  tier1Engine: string // ollama:<model> | deterministic
  tier1Note?: string
  artifacts: ExecutedArtifact[]
  tier1: Tier1RewrittenPrompt | null
  injectedPrompt: string | null
  staged: StagedArtifactSummary[]
  metrics: {
    tokensRaw: number
    tokensSavedCloud: number
    tokensContextAvoided: number
    localToolMs: number
    durationMs: number
    scaffoldedFiles: number
  }
}

// ---------------------------------------------------------------------------
// Phase 3 — Engine 3: ExtractedMemoryDelta (blueprint Part 1 §4, exact)
// ---------------------------------------------------------------------------

export interface MemoryDeltaDecision {
  category: 'database' | 'auth' | 'state' | 'api' | 'ui' | 'security'
  title: string
  rationale: string
  constraints: string
  targetModuleId: string
  supersedesDecisionId?: string
}

export interface MemoryDeltaRequirement {
  domain: string
  rule: string
  priority: 'critical' | 'high' | 'medium'
}

export interface MemoryDeltaTaskUpdate {
  taskId?: string
  title: string
  status: 'todo' | 'pre_executed_locally' | 'in_progress' | 'completed' | 'blocked'
  targetFiles: string[]
}

export interface MemoryDeltaBug {
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  rootCause: string
  affectedSymbolId?: string
  status: 'open' | 'resolved'
}

export interface MemoryDeltaPreference {
  ruleType: 'immutableConstraint' | 'forbiddenPattern' | 'codingStandard'
  value: string
}

export interface ExtractedMemoryDelta {
  turnId: string
  sourcePlatform: AIPlatform
  timestamp: number
  compactTurnSummary: string
  newDecisions: MemoryDeltaDecision[]
  newRequirements: MemoryDeltaRequirement[]
  taskUpdates: MemoryDeltaTaskUpdate[]
  discoveredBugs: MemoryDeltaBug[]
  userPreferenceUpdates?: MemoryDeltaPreference[]
}

export interface MemoryDeltaApplyReport {
  interactionId: string | null
  decisionsCreated: number
  decisionsSuperseded: number
  requirementsCreated: number
  tasksUpdated: number
  tasksCreated: number
  bugsCreated: number
  bugsResolved: number
  preferencesCreated: number
  engineUsed: string
  engineNote?: string
  delta: ExtractedMemoryDelta
}

export interface FileAstDiff {
  path: string
  addedSymbols: string[]
  modifiedSymbols: string[]
}

// ---------------------------------------------------------------------------
// Phase 4 — Visual Command Center & AI CTO Mode (blueprint PHASE_4 §3,
// extended with the live property-graph kinds the daemon actually stores)
// ---------------------------------------------------------------------------

/** Blueprint node labels + the daemon's real property-graph kinds (superset). */
export type GraphNodeLabel =
  | 'Module'
  | 'SourceFile'
  | 'ASTSymbol'
  | 'ArchitecturalDecision'
  | 'Task'
  | 'Bug'
  | 'SessionTurn'
  // Live-graph extensions (documented in docs/CORTEXOS-PHASE4.md §2):
  | 'Tech'
  | 'Feature'
  | 'External'
  | 'Root'

export interface GraphNodeDTO {
  id: string
  label: GraphNodeLabel
  title: string
  subtitle?: string
  filePath?: string
  fqn?: string
  signature?: string
  lineSpan?: string
  scopeStatus: 'IN_SCOPE' | 'LOCKED' | 'NEUTRAL'
  complexity?: number
  metadata?: Record<string, unknown>
}

export interface GraphEdgeDTO {
  id: string
  source: string
  target: string
  relationship:
    | 'CONTAINS_FILE'
    | 'DECLARES_SYMBOL'
    | 'IMPORTS_SYMBOL'
    | 'CALLS_SYMBOL'
    | 'GOVERNED_BY'
    | 'MODIFIED_SYMBOL'
    | 'DEPENDS_ON'
    // Live-graph relations surfaced verbatim (superset):
    | 'CONTAINS'
    | 'USES'
    | 'IMPLEMENTS'
    | 'BLOCKED_BY'
    | 'HAS_BUG'
    | 'PREFERS'
    | 'SYNCED_WITH'
    | 'SUPERSEDES'
}

export interface TokenTelemetrySummary {
  totalPromptsIntercepted: number
  rawContextTokensEstimated: number
  injectedSyncPacketTokens: number
  netTokensSaved: number
  compressionRatioPct: number
  estimatedCostSavingsUsd: number
  /** USD per million net tokens saved — documented pricing constant. */
  pricingUsdPerMTokens: number
  localOllamaOffloadCount: number
  cloudEscalationCount: number
  localOffloadPct: number
  historyByDay: Array<{
    date: string
    rawTokens: number
    optimizedTokens: number
    localExecutions: number
  }>
}

export interface ContinuityTimelineEvent {
  turnId: string
  timestamp: string
  platform: string
  kind: string
  summary: string
  tokensSaved: number
  symbolsTouched: Array<{
    fqn: string
    changeType: 'added' | 'modified' | 'deleted'
  }>
  decisionsRatified: string[]
}

export type CTOSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'OPTIMIZATION'

export type CtoActionType = 'LOCK_SYMBOLS' | 'DECOMPOSE_DAG' | 'REFACTOR_LOCAL' | 'RATIFY_ADR'

export interface AICtoRecommendation {
  id: string
  category:
    | 'ARCHITECTURE_DRIFT'
    | 'SCOPE_LOCK_HAZARD'
    | 'TOKEN_OPTIMIZATION'
    | 'COMPLEXITY_HOTSPOT'
    | 'UNLINKED_REQUIREMENT'
  severity: CTOSeverity
  title: string
  rationale: string
  impactedSymbols: string[]
  suggestedAction: {
    actionType: CtoActionType
    commandPreview: string
    estimatedTokenSavings?: number
  }
}

export interface ScopeLockState {
  projectId: string
  allowedSymbolFqns: string[]
  lockedSymbolFqns: string[]
  forbiddenPaths: string[]
  updatedAt: string
  source: string
}

export interface ActiveTaskState {
  taskId: string
  title: string
  status: string
  allowedSymbolFqns: string[]
  forbiddenPaths: string[]
}

export interface CortexDashboardStateResponse {
  projectName: string
  projectSlug: string
  projectDnaVersion: string
  activeTask: ActiveTaskState
  scopeLock: ScopeLockState
  graph: {
    nodes: GraphNodeDTO[]
    edges: GraphEdgeDTO[]
  }
  telemetry: TokenTelemetrySummary
  timeline: ContinuityTimelineEvent[]
  ctoRecommendations: AICtoRecommendation[]
  syncPacketXml: string
  audit: {
    scannedAt: string
    workspaceRoot: string | null
    symbolsScanned: number
    filesScanned: number
    cache: 'hit' | 'miss'
  }
  serverTime: string
}

// ---- Phase 4 — Multi-Agent DAG Orchestrator contracts ----------------------

export interface DAGSubTask {
  id: string
  title: string
  /** `local-ollama:<model>` or `cloud:<escalation-model>`. */
  assignedAgent: string
  agentKind: 'local' | 'cloud'
  dependencies: string[]
  allowedSymbolFqns: string[]
  prompt: string
}

export type DagSubtaskStatus = 'pending' | 'dispatched' | 'completed' | 'failed' | 'skipped'

export interface DAGSubTaskRecord extends DAGSubTask {
  status: DagSubtaskStatus
  wave: number
  resultSummary?: string
  artifacts?: Array<{ toolName: string; ok: boolean; summary: string }>
  /** Tier-1 execution payload for cloud-assigned subtasks (copy into the target agent). */
  payload?: string
  tokensSavedEstimate?: number
  durationMs?: number
}

export interface DagPlanDTO {
  id: string
  projectId: string
  projectName: string
  goal: string
  status: 'draft' | 'dispatched' | 'completed' | 'archived'
  subtasks: DAGSubTaskRecord[]
  waves: string[][]
  auditMeta: {
    triggeredBy?: string
    recommendationId?: string
    estimatedTokenSavings?: number
  }
  createdAt: string
  updatedAt: string
}

export interface CtoAuditResponse {
  audit: {
    projectId: string
    projectName: string
    scannedAt: string
    recommendations: AICtoRecommendation[]
    stats: {
      symbolsScanned: number
      filesScanned: number
      layerViolations: number
      complexityHotspots: number
      workspaceRoot: string | null
      cache: 'hit' | 'miss'
    }
  }
  plans: DagPlanDTO[]
}
