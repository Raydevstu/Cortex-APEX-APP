/**
 * Phase 4 — Visual Command Center state assembly
 * (blueprint PHASE_4 §3 `CortexDashboardStateResponse` + §5.1 state route).
 *
 * One deterministic pass over the live daemon data:
 *
 *   graph        — the SQLite property graph mapped to blueprint node labels
 *                  (Module / SourceFile / ASTSymbol / ArchitecturalDecision /
 *                  Task / Bug / SessionTurn + live kinds), enriched with the
 *                  real workspace audit (symbols, complexity, line spans) and
 *                  scope-lock statuses (IN_SCOPE / LOCKED / NEUTRAL)
 *   telemetry    — Token Savings Engine live aggregates (PromptSession +
 *                  PreExecRun), with a 14-day history
 *   timeline     — cross-platform continuity stream: session turns, Tier-1
 *                  rewrites, pre-exec agent runs, handoffs and git commits
 *   cto          — AI CTO audit recommendations (live drift detection)
 *   syncPacketXml — the real CrossPlatformSyncPacket rendered as the
 *                  blueprint <cortex_sync_packet> XML contract
 */
import { db } from '@/lib/db'
import { ApiError } from './api'
import { parseDna } from './rewrite'
import { buildSyncPacket } from './packet'
import { getScopeLock } from './scope-lock'
import { auditWorkspace, type WorkspaceAuditResult } from './workspace-audit'
import { AICtoEngine, buildTokenTelemetry } from '@/orchestrator/ai-cto-engine'
import type {
  ContinuityTimelineEvent,
  CortexDashboardStateResponse,
  GraphEdgeDTO,
  GraphNodeDTO,
} from './types'

const MAX_GRAPH_NODES = 80
const MAX_GRAPH_EDGES = 120
const MAX_AUDIT_SYMBOLS = 18

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function buildDashboardState(
  projectIdOrSlug: string,
  options: { targetPlatform?: string } = {},
): Promise<CortexDashboardStateResponse> {
  const project =
    (await db.project.findUnique({ where: { id: projectIdOrSlug }, include: { dna: true } })) ??
    (await db.project.findUnique({ where: { slug: projectIdOrSlug }, include: { dna: true } }))
  if (!project) throw new ApiError('Project not found', 404)

  const [scopeLock, telemetry, audit, packet, workspace] = await Promise.all([
    getScopeLock(project.id),
    buildTokenTelemetry(project.id),
    new AICtoEngine().auditProject(project.id),
    buildSyncPacket(project.id, { targetPlatform: options.targetPlatform ?? 'any' }),
    project.rootPath ? auditWorkspace(project.rootPath) : Promise.resolve(null),
  ])

  const [graphNodes, graphEdges, memories, interactions, sessions, runs, handoffs, commits] = await Promise.all([
    db.graphNode.findMany({ where: { projectId: project.id }, orderBy: [{ kind: 'asc' }, { label: 'asc' }], take: 300 }),
    db.graphEdge.findMany({ where: { projectId: project.id }, take: 400 }),
    db.memory.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 300 }),
    db.interaction.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
    db.promptSession.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.preExecRun.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 8 }),
    db.syncHandoff.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 6 }),
    db.gitCommit.findMany({ where: { projectId: project.id }, orderBy: { committedAt: 'desc' }, take: 6 }),
  ])

  const dna = project.dna ? parseDna(project.dna) : null
  const graph = buildGraphDto({
    projectName: project.name,
    graphNodes,
    graphEdges,
    memories,
    interactions,
    workspace: workspace?.result ?? null,
    scopeLock,
  })
  const timeline = buildTimeline({ interactions, sessions, runs, handoffs, commits, memories })

  const activeTodo = memories
    .filter((m) => m.type === 'todo' && m.status === 'active')
    .sort((a, b) => b.importance - a.importance || b.createdAt.getTime() - a.createdAt.getTime())[0]

  return {
    projectName: project.name,
    projectSlug: project.slug,
    projectDnaVersion: project.dna
      ? `1.0.0 · generated ${project.dna.generatedAt.toISOString().slice(0, 10)}`
      : '1.0.0 · DNA not generated',
    activeTask: {
      taskId: activeTodo?.id ?? 'TASK-NONE',
      title: activeTodo?.key ?? 'No active task — capture a todo memory to scope the next turn',
      status: activeTodo ? 'IN_PROGRESS' : 'IDLE',
      allowedSymbolFqns: scopeLock.allowedSymbolFqns,
      forbiddenPaths: scopeLock.forbiddenPaths,
    },
    scopeLock,
    graph,
    telemetry,
    timeline,
    ctoRecommendations: audit.recommendations,
    syncPacketXml: renderSyncPacketXml(packet, scopeLock, activeTodo?.id ?? 'TASK-NONE', activeTodo?.key ?? 'No active task'),
    audit: {
      scannedAt: audit.scannedAt,
      workspaceRoot: audit.stats.workspaceRoot,
      symbolsScanned: audit.stats.symbolsScanned,
      filesScanned: audit.stats.filesScanned,
      cache: audit.stats.cache,
    },
    serverTime: new Date().toISOString(),
  }
}

/** Default project for the Command Center landing view: the most recently
 *  active project (real activity, deterministic tie-break by update time). */
export async function resolveDefaultProjectId(): Promise<string> {
  const project = await db.project.findFirst({ orderBy: { updatedAt: 'desc' } })
  if (!project) throw new ApiError('No projects exist — create one first', 404)
  return project.id
}

/** Resolve a project reference — canonical id OR slug — to its canonical id.
 *  Keeps the `?project=` contract uniform across /state and /cto (and their
 *  MCP mirrors cortex_state / cortex_cto, which address projects by slug). */
export async function resolveProjectIdRef(ref: string): Promise<string> {
  const hit =
    (await db.project.findUnique({ where: { id: ref }, select: { id: true } })) ??
    (await db.project.findUnique({ where: { slug: ref }, select: { id: true } }))
  if (!hit) throw new ApiError('Project not found', 404)
  return hit.id
}

// ---------------------------------------------------------------------------
// Graph DTO assembly
// ---------------------------------------------------------------------------

interface GraphAssemblyInput {
  projectName: string
  graphNodes: Array<{ id: string; kind: string; label: string; props: string }>
  graphEdges: Array<{ id: string; sourceId: string; targetId: string; relation: string }>
  memories: Array<{ id: string; type: string; key: string; value: string; status: string; importance: number; createdAt: Date }>
  interactions: Array<{ id: string; platform: string | null; createdAt: Date }>
  workspace: WorkspaceAuditResult | null
  scopeLock: CortexDashboardStateResponse['scopeLock']
}

function buildGraphDto(input: GraphAssemblyInput): CortexDashboardStateResponse['graph'] {
  const nodes: GraphNodeDTO[] = []
  const edges: GraphEdgeDTO[] = []
  const idByDbId = new Map<string, string>()

  /**
   * Write-scope semantics (mirrors the staging guard exactly):
   *   1. the symbol itself is explicitly locked → LOCKED
   *   2. its file is protected, or contains any explicitly locked symbol
   *      (whole-file modifies are blocked by the guard) → LOCKED
   *   3. the symbol (or whole file) is unlocked into the active scope → IN_SCOPE
   *   4. otherwise → NEUTRAL (read-only context)
   */
  const scopeOf = (fqn?: string, filePath?: string): GraphNodeDTO['scopeStatus'] => {
    if (fqn && input.scopeLock.lockedSymbolFqns.includes(fqn)) return 'LOCKED'
    const file = filePath ?? (fqn && !fqn.includes('#') ? fqn : undefined)
    if (file) {
      if (
        input.scopeLock.forbiddenPaths.some((p) => file === p || file.startsWith(p.replace(/\/$/, '') + '/'))
      ) return 'LOCKED'
      if (input.scopeLock.lockedSymbolFqns.some((l) => l === file || l.startsWith(`${file}#`))) return 'LOCKED'
    }
    if (fqn && input.scopeLock.allowedSymbolFqns.includes(fqn)) return 'IN_SCOPE'
    if (file && input.scopeLock.allowedSymbolFqns.includes(file)) return 'IN_SCOPE'
    return 'NEUTRAL'
  }

  // ---- Live property-graph nodes -------------------------------------------
  for (const node of input.graphNodes) {
    const props = safeParse(node.props)
    const dto: GraphNodeDTO = {
      id: `db:${node.id}`,
      label: kindToLabel(node.kind),
      title: node.label,
      scopeStatus: node.kind === 'bug' ? 'NEUTRAL' : 'NEUTRAL',
      metadata: { dbKind: node.kind },
    }
    if (node.kind === 'root') {
      dto.subtitle = 'project root'
    } else if (node.kind === 'module') {
      dto.subtitle = typeof props.dir === 'string' ? `${props.dir}/` : 'module'
    } else if (node.kind === 'tech') {
      dto.subtitle = typeof props.layer === 'string' ? props.layer : 'technology'
    } else if (node.kind === 'bug') {
      dto.subtitle = props.status === 'resolved' ? 'resolved' : 'open bug'
    } else if (node.kind === 'file') {
      dto.filePath = node.label
      dto.fqn = node.label
      dto.scopeStatus = scopeOf(node.label, node.label)
      dto.subtitle = 'source file'
    }
    idByDbId.set(node.id, dto.id)
    nodes.push(dto)
  }

  // ---- ArchitecturalDecision nodes (decision/architecture memories) --------
  const adrMemories = input.memories
    .filter((m) => (m.type === 'decision' || m.type === 'architecture') && m.status === 'active')
    .sort((a, b) => b.importance - a.importance || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 4)
  for (const memory of adrMemories) {
    nodes.push({
      id: `adr:${memory.id}`,
      label: 'ArchitecturalDecision',
      title: memory.key,
      subtitle: shorten(memory.value, 110),
      scopeStatus: 'NEUTRAL',
      metadata: { memoryId: memory.id, importance: memory.importance },
    })
  }

  // ---- Task nodes (top active todos) ---------------------------------------
  const taskMemories = input.memories
    .filter((m) => m.type === 'todo' && m.status === 'active')
    .sort((a, b) => b.importance - a.importance || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 2)
  for (const memory of taskMemories) {
    nodes.push({
      id: `task:${memory.id}`,
      label: 'Task',
      title: memory.key,
      subtitle: `IN_PROGRESS · ${shorten(memory.value, 90)}`,
      scopeStatus: 'IN_SCOPE',
      metadata: { memoryId: memory.id },
    })
  }

  // ---- SessionTurn nodes (latest interactions) ------------------------------
  for (const interaction of input.interactions.slice(0, 2)) {
    nodes.push({
      id: `turn:${interaction.id}`,
      label: 'SessionTurn',
      title: `Turn · ${interaction.platform ?? 'unknown platform'}`,
      subtitle: interaction.createdAt.toISOString().replace('T', ' ').slice(0, 16),
      scopeStatus: 'NEUTRAL',
      metadata: { interactionId: interaction.id },
    })
  }

  // ---- Workspace audit: SourceFile + ASTSymbol nodes ------------------------
  const symbolNodes: GraphNodeDTO[] = []
  const symbolEdges: GraphEdgeDTO[] = []
  const fileNodeIds = new Map<string, string>()
  if (input.workspace) {
    const allowedFiles = new Set(input.scopeLock.allowedSymbolFqns.map((f) => f.split('#')[0]))
    const ranked = [...input.workspace.symbols].sort((a, b) => {
      const aAllowed = allowedFiles.has(a.filePath) ? 1 : 0
      const bAllowed = allowedFiles.has(b.filePath) ? 1 : 0
      if (aAllowed !== bAllowed) return bAllowed - aAllowed
      return b.complexity - a.complexity
    })

    for (const sym of ranked.slice(0, MAX_AUDIT_SYMBOLS)) {
      const fileId = `file:${sym.filePath}`
      if (!fileNodeIds.has(sym.filePath)) {
        fileNodeIds.set(sym.filePath, fileId)
        symbolNodes.push({
          id: fileId,
          label: 'SourceFile',
          title: sym.filePath.split('/').pop() ?? sym.filePath,
          subtitle: sym.filePath,
          filePath: sym.filePath,
          fqn: sym.filePath,
          scopeStatus: scopeOf(sym.filePath, sym.filePath),
          metadata: {},
        })
      }
      const symbolId = `sym:${sym.fqn}`
      symbolNodes.push({
        id: symbolId,
        label: 'ASTSymbol',
        title: sym.name,
        subtitle: `${sym.kind} · ${sym.filePath}`,
        filePath: sym.filePath,
        fqn: sym.fqn,
        signature: sym.signature,
        lineSpan: `L${sym.line}–${sym.endLine}`,
        scopeStatus: scopeOf(sym.fqn, sym.filePath),
        complexity: sym.complexity,
        metadata: { exported: sym.exported },
      })
      symbolEdges.push({
        id: `e-declares-${symbolId}`,
        source: fileId,
        target: symbolId,
        relationship: 'DECLARES_SYMBOL',
      })

      // GOVERNED_BY: link high-visibility symbols to the most relevant ADR.
      const adr = adrMemories.find((m) =>
        tokenOverlap(sym.filePath, `${m.key} ${m.value}`),
      )
      if (adr) {
        symbolEdges.push({
          id: `e-governed-${symbolId}`,
          source: symbolId,
          target: `adr:${adr.id}`,
          relationship: 'GOVERNED_BY',
        })
      }
    }

    // MODIFIED_SYMBOL: the top task touches symbols whose file matches the
    // task text (real keyword join).
    const topTask = taskMemories[0]
    if (topTask) {
      let linked = 0
      for (const sym of ranked.slice(0, MAX_AUDIT_SYMBOLS)) {
        if (linked >= 3) break
        if (tokenOverlap(sym.filePath, `${topTask.key} ${topTask.value}`)) {
          symbolEdges.push({
            id: `e-modified-${sym.fqn}`,
            source: `task:${topTask.id}`,
            target: `sym:${sym.fqn}`,
            relationship: 'MODIFIED_SYMBOL',
          })
          linked += 1
        }
      }
    }
  }

  // ---- Live graph edges ------------------------------------------------------
  for (const edge of input.graphEdges) {
    const source = idByDbId.get(edge.sourceId)
    const target = idByDbId.get(edge.targetId)
    if (!source || !target) continue
    const targetNode = nodes.find((n) => n.id === target)
    const relationship =
      edge.relation === 'CONTAINS' && (targetNode?.label === 'SourceFile' || targetNode?.filePath)
        ? 'CONTAINS_FILE'
        : (edge.relation as GraphEdgeDTO['relationship'])
    edges.push({ id: `dbe:${edge.id}`, source, target, relationship })
  }

  // Root → ADR / Task / SessionTurn containment edges
  const rootNode = nodes.find((n) => n.metadata?.dbKind === 'root')
  if (rootNode) {
    for (const adr of adrMemories) {
      edges.push({ id: `e-root-adr-${adr.id}`, source: rootNode.id, target: `adr:${adr.id}`, relationship: 'GOVERNED_BY' })
    }
    for (const task of taskMemories) {
      edges.push({ id: `e-root-task-${task.id}`, source: rootNode.id, target: `task:${task.id}`, relationship: 'CONTAINS' })
    }
    for (const turn of input.interactions.slice(0, 2)) {
      edges.push({ id: `e-root-turn-${turn.id}`, source: rootNode.id, target: `turn:${turn.id}`, relationship: 'CONTAINS' })
    }
  }

  // ---- Merge with priority, then bound --------------------------------------
  const merged = mergeGraph(nodes, symbolNodes, edges, symbolEdges)
  return merged
}

function mergeGraph(
  baseNodes: GraphNodeDTO[],
  symbolNodes: GraphNodeDTO[],
  baseEdges: GraphEdgeDTO[],
  symbolEdges: GraphEdgeDTO[],
): CortexDashboardStateResponse['graph'] {
  // Priority order: structural + governance nodes first, then workspace
  // symbols (already ranked), then remaining edges by relation priority.
  const nodes = [...baseNodes, ...symbolNodes]
  const nodeIds = new Set(nodes.map((n) => n.id))

  const relationPriority: Record<string, number> = {
    GOVERNED_BY: 0,
    MODIFIED_SYMBOL: 0,
    HAS_BUG: 1,
    BLOCKED_BY: 1,
    DECLARES_SYMBOL: 2,
    CONTAINS_FILE: 3,
    CONTAINS: 4,
    DEPENDS_ON: 5,
    USES: 6,
    IMPLEMENTS: 7,
    SUPERSEDES: 8,
    PREFERS: 9,
    SYNCED_WITH: 10,
    IMPORTS_SYMBOL: 11,
    CALLS_SYMBOL: 11,
  }
  const edges = [...symbolEdges, ...baseEdges]
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .sort((a, b) => (relationPriority[a.relationship] ?? 12) - (relationPriority[b.relationship] ?? 12))

  if (nodes.length <= MAX_GRAPH_NODES && edges.length <= MAX_GRAPH_EDGES) {
    return { nodes, edges }
  }

  // Bound: keep governance/structural + top symbols; drop from the tail.
  const keep = new Set<string>()
  for (const node of nodes) {
    if (keep.size >= MAX_GRAPH_NODES) break
    keep.add(node.id)
  }
  const boundedEdges: GraphEdgeDTO[] = []
  for (const edge of edges) {
    if (boundedEdges.length >= MAX_GRAPH_EDGES) break
    if (keep.has(edge.source) && keep.has(edge.target)) boundedEdges.push(edge)
  }
  // Re-include endpoints of kept edges that were cut.
  for (const edge of boundedEdges) {
    keep.add(edge.source)
    keep.add(edge.target)
  }
  return { nodes: nodes.filter((n) => keep.has(n.id)), edges: boundedEdges }
}

function kindToLabel(kind: string): GraphNodeDTO['label'] {
  switch (kind) {
    case 'root': return 'Root'
    case 'module': return 'Module'
    case 'tech': return 'Tech'
    case 'feature': return 'Feature'
    case 'bug': return 'Bug'
    case 'external': return 'External'
    case 'file': return 'SourceFile'
    default: return 'Module'
  }
}

// ---------------------------------------------------------------------------
// Timeline assembly
// ---------------------------------------------------------------------------

interface TimelineInput {
  interactions: Array<{
    id: string
    title: string | null
    platform: string | null
    summary: string | null
    rawText: string
    memoriesExtracted: number
    createdAt: Date
  }>
  sessions: Array<{
    id: string
    engine: string
    intent: string
    tokensContextAvoided: number
    createdAt: Date
  }>
  runs: Array<{
    id: string
    targetPlatform: string
    intentCategory: string
    executionMode: string
    tokensSavedCloud: number
    stagedCount: number
    cloudCoreTaskSpec: string
    createdAt: Date
  }>
  handoffs: Array<{
    id: string
    fromPlatform: string
    toPlatform: string
    packetTokens: number
    createdAt: Date
  }>
  commits: Array<{
    id: string
    hash: string
    message: string
    platform: string | null
    files: string
    committedAt: Date
  }>
  memories: Array<{ id: string; type: string; key: string; value: string; createdAt: Date }>
}

function buildTimeline(input: TimelineInput): ContinuityTimelineEvent[] {
  const events: Array<{ at: Date; event: ContinuityTimelineEvent }> = []
  const decisions = input.memories.filter((m) => m.type === 'decision' || m.type === 'architecture')

  for (const interaction of input.interactions) {
    const near = decisions.filter(
      (m) => Math.abs(m.createdAt.getTime() - interaction.createdAt.getTime()) < 3 * 60 * 1000,
    )
    events.push({
      at: interaction.createdAt,
      event: {
        turnId: interaction.id,
        timestamp: interaction.createdAt.toISOString(),
        platform: interaction.platform ?? 'unknown',
        kind: 'session-turn',
        summary: shorten(interaction.summary ?? interaction.title ?? interaction.rawText, 160),
        tokensSaved: 0,
        symbolsTouched: [],
        decisionsRatified: near.slice(0, 2).map((m) => m.key),
      },
    })
  }

  for (const session of input.sessions) {
    events.push({
      at: session.createdAt,
      event: {
        turnId: session.id,
        timestamp: session.createdAt.toISOString(),
        platform: session.engine === 'cloud' ? 'cloud' : `local:${session.engine}`,
        kind: 'tier1-rewrite',
        summary: `Tier-1 prompt rewrite via ${session.engine} engine — intent "${session.intent}", ${session.tokensContextAvoided.toLocaleString()} context tokens avoided.`,
        tokensSaved: session.tokensContextAvoided,
        symbolsTouched: [],
        decisionsRatified: [],
      },
    })
  }

  for (const run of input.runs) {
    let targets: string[] = []
    try {
      const spec = JSON.parse(run.cloudCoreTaskSpec) as { targetFiles?: string[] }
      targets = spec.targetFiles ?? []
    } catch {
      targets = []
    }
    events.push({
      at: run.createdAt,
      event: {
        turnId: run.id,
        timestamp: run.createdAt.toISOString(),
        platform: run.targetPlatform,
        kind: 'pre-exec-agent',
        summary: `Pre-execution agent (${run.executionMode}) — ${run.intentCategory}, saved ${run.tokensSavedCloud.toLocaleString()} cloud tokens${run.stagedCount > 0 ? `, ${run.stagedCount} file(s) staged` : ''}.`,
        tokensSaved: run.tokensSavedCloud,
        symbolsTouched: targets.slice(0, 4).map((fqn) => ({ fqn, changeType: 'modified' as const })),
        decisionsRatified: [],
      },
    })
  }

  for (const handoff of input.handoffs) {
    events.push({
      at: handoff.createdAt,
      event: {
        turnId: handoff.id,
        timestamp: handoff.createdAt.toISOString(),
        platform: handoff.toPlatform,
        kind: 'handoff',
        summary: `Cross-platform handoff ${handoff.fromPlatform} → ${handoff.toPlatform} — ${handoff.packetTokens}-token sync packet injected.`,
        tokensSaved: 0,
        symbolsTouched: [],
        decisionsRatified: [],
      },
    })
  }

  for (const commit of input.commits) {
    let files: Array<{ path: string; status: string }> = []
    try {
      files = JSON.parse(commit.files) as Array<{ path: string; status: string }>
    } catch {
      files = []
    }
    events.push({
      at: commit.committedAt,
      event: {
        turnId: commit.id,
        timestamp: commit.committedAt.toISOString(),
        platform: commit.platform ?? 'git',
        kind: 'git-commit',
        summary: `${commit.hash.slice(0, 7)} — ${shorten(commit.message, 130)}`,
        tokensSaved: 0,
        symbolsTouched: files.slice(0, 5).map((f) => ({
          fqn: f.path,
          changeType: f.status.startsWith('A') ? 'added' as const : f.status.startsWith('D') ? 'deleted' as const : 'modified' as const,
        })),
        decisionsRatified: [],
      },
    })
  }

  return events
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 12)
    .map((e) => e.event)
}

// ---------------------------------------------------------------------------
// <cortex_sync_packet> XML rendering (blueprint §1.5 contract)
// ---------------------------------------------------------------------------

type SyncPacketLike = Awaited<ReturnType<typeof buildSyncPacket>>

export function renderSyncPacketXml(
  packet: SyncPacketLike,
  scopeLock: CortexDashboardStateResponse['scopeLock'],
  taskId: string,
  taskTitle: string,
): string {
  const esc = (value: string): string =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  const lines: string[] = []
  lines.push(
    `<cortex_sync_packet version="1.0.0" project="${esc(packet.project.name)}" state-hash="#${esc(packet.stateHash)}" timestamp="${esc(packet.header.syncedAtIso)}">`,
  )
  lines.push(`  <active_task id="${esc(taskId)}" status="IN_PROGRESS">`)
  lines.push(`    <title>${esc(taskTitle)}</title>`)
  lines.push('    <allowed_symbols>')
  for (const fqn of scopeLock.allowedSymbolFqns.slice(0, 12)) lines.push(`      <symbol>${esc(fqn)}</symbol>`)
  lines.push('    </allowed_symbols>')
  lines.push('    <forbidden_paths>')
  for (const p of scopeLock.forbiddenPaths.slice(0, 8)) lines.push(`      <path>${esc(p)}</path>`)
  lines.push('    </forbidden_paths>')
  lines.push('  </active_task>')
  lines.push('  <dna_snapshot>')
  lines.push(`    <stack>${esc(packet.dnaSnapshot.stackSummary)}</stack>`)
  for (const constraint of packet.dnaSnapshot.activeConstraints.slice(0, 5)) {
    lines.push(`    <constraint>${esc(constraint)}</constraint>`)
  }
  lines.push('  </dna_snapshot>')
  lines.push(`  <scoped_graph_context active_module="${esc(packet.scopedGraphContext.activeModule)}">`)
  for (const decision of packet.scopedGraphContext.relevantDecisions.slice(0, 3)) {
    lines.push(`    <decision id="${esc(decision.id)}" title="${esc(decision.title)}">${esc(decision.constraint)}</decision>`)
  }
  for (const symbol of packet.scopedGraphContext.relevantSymbols.slice(0, 5)) {
    lines.push(`    <symbol signature="${esc(symbol.signature)}">${esc(symbol.symbolId)}</symbol>`)
  }
  for (const bug of packet.scopedGraphContext.openBugsInScope.slice(0, 3)) {
    lines.push(`    <open_bug id="${esc(bug.id)}">${esc(bug.title)}</open_bug>`)
  }
  lines.push('  </scoped_graph_context>')
  lines.push('  <continuity_state>')
  lines.push(`    <last_completed_action>${esc(packet.continuityState.lastCompletedAction)}</last_completed_action>`)
  lines.push('    <next_pending_tasks>')
  for (const task of packet.continuityState.nextPendingTasks.slice(0, 3)) lines.push(`      <task>${esc(task)}</task>`)
  lines.push('    </next_pending_tasks>')
  lines.push('  </continuity_state>')
  lines.push(
    `  <recent_continuity_delta platform="${esc(packet.header.previousPlatform)}" synced_at="${esc(packet.header.syncedAtIso)}">`,
  )
  lines.push(`    ${esc(packet.markdown.split('\n')[0])}`)
  lines.push('  </recent_continuity_delta>')
  lines.push('</cortex_sync_packet>')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function tokenOverlap(a: string, b: string): boolean {
  const words = (text: string) =>
    new Set(text.toLowerCase().split(/[^a-z0-9#+._-]+/).filter((w) => w.length >= 4))
  const setA = words(a)
  const setB = words(b)
  for (const word of setA) {
    if (setB.has(word)) return true
  }
  return false
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}

function safeParse(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}
