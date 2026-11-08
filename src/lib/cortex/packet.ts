/**
 * Cross-Platform Delta Sync Packet (blueprint Part 1 §4 + §5).
 *
 * Phase 2 upgrades the Phase 1 Compact State Header into the full
 * CrossPlatformSyncPacket contract:
 *
 *   header              — project identity, state hash, platform pair
 *   dnaSnapshot         — stack summary + non-negotiable constraints
 *   scopedGraphContext  — the 1-hop scoped query result for the ACTIVE
 *                         module only (decisions, symbols, open bugs) —
 *                         the blueprint's zero-token context scoping
 *   continuityState     — what was just completed + the active task and
 *                         what remains for the target platform to finish
 *
 * The Phase 1 markdown state header is preserved inside the same payload
 * (backward compatible) and still bounded to ~150–300 tokens.
 */
import { db } from '@/lib/db'
import { estimateTokens } from './tokens'
import { parseDna } from './rewrite'
import type { CrossPlatformSyncPacket, RelevantMemory } from './types'

export interface BuildPacketOptions {
  targetPlatform?: string
  module?: string
}

export async function buildSyncPacket(
  projectIdOrSlug: string,
  options: BuildPacketOptions = {},
): Promise<CrossPlatformSyncPacket> {
  const include = {
    dna: true,
    memories: { orderBy: [{ createdAt: 'desc' as const }] },
    graphNodes: true,
    graphEdges: true,
    events: { orderBy: { createdAt: 'desc' as const }, take: 20 },
    interactions: { orderBy: { createdAt: 'desc' as const }, take: 5 },
  }
  const project =
    (await db.project.findUnique({ where: { id: projectIdOrSlug }, include })) ??
    (await db.project.findUnique({ where: { slug: projectIdOrSlug }, include }))
  if (!project) throw new Error('Project not found')

  const dna = project.dna ? parseDna(project.dna) : null
  const stack = dna ? dna.techStack.map((t) => t.technology) : []
  const nodeById = new Map(project.graphNodes.map((n) => [n.id, n]))

  // ---- Scoped graph context: active module resolution ----------------------
  const activeModule =
    options.module?.trim() ||
    (await inferActiveModule(project.id, {
      events: project.events,
      interactions: project.interactions,
      graphNodes: project.graphNodes,
      graphEdges: project.graphEdges,
    }))

  const moduleKeywords = collectModuleKeywords(activeModule, project.graphNodes, project.graphEdges)
  const scoped = buildScopedContext(project.id, activeModule, moduleKeywords, {
    nodes: project.graphNodes,
    edges: project.graphEdges,
    nodeById,
    memories: project.memories,
  })

  // ---- Continuity state -----------------------------------------------------
  const lastEvent = project.events[0]
  const todos = project.memories
    .filter((m) => m.type === 'todo' && m.status === 'active')
    .sort((a, b) => b.importance - a.importance || b.createdAt.getTime() - a.createdAt.getTime())
  const activeTaskMemory = todos[0]

  const continuityState: CrossPlatformSyncPacket['continuityState'] = {
    lastCompletedAction: lastEvent ? `${lastEvent.kind}: ${lastEvent.message}` : 'Project initialised — no engine actions recorded yet.',
    activeTask: activeTaskMemory
      ? {
          id: activeTaskMemory.id,
          title: activeTaskMemory.key,
          // Phase 3 (Pre-Execution Local Agent) will fill this list with work
          // the local Ollama agent already completed before injection.
          preExecutedByLocalAgent: [],
          remainingCoreWork: shorten(activeTaskMemory.value, 140),
        }
      : null,
    nextPendingTasks: todos.slice(1, 4).map((t) => shorten(t.value, 90)),
  }

  // ---- DNA snapshot ----------------------------------------------------------
  const constraints: string[] = []
  if (dna) {
    for (const standard of dna.codingStandards.slice(0, 3)) constraints.push(standard.rule)
    for (const rule of dna.businessRules.slice(0, 2)) constraints.push(rule)
  }
  const dnaSnapshot: CrossPlatformSyncPacket['dnaSnapshot'] = {
    stackSummary: stack.length > 0 ? stack.join(', ') : 'not yet profiled (generate Project DNA)',
    activeConstraints: constraints.slice(0, 5),
  }

  // ---- Header + state hash ----------------------------------------------------
  const stateHash = hashState({
    updatedAt: project.updatedAt.toISOString(),
    memories: project.memories.length,
    nodes: project.graphNodes.length,
    edges: project.graphEdges.length,
    module: activeModule,
  })

  const targetPlatform = options.targetPlatform?.trim() || 'unknown'
  const header: CrossPlatformSyncPacket['header'] = {
    projectId: project.id,
    projectName: project.name,
    stateHash,
    previousPlatform: project.platform ?? 'unknown',
    targetPlatform,
    syncedAtIso: new Date().toISOString(),
  }

  // ---- Phase 1 markdown state header (preserved contract) --------------------
  const decisions = project.memories
    .filter((m) => m.type === 'decision' || m.type === 'architecture')
    .slice(0, 3)
    .map((m) => `${m.key}: ${shorten(m.value, 56)}`)

  const openItems = project.memories
    .filter((m) => (m.type === 'todo' || m.type === 'bug') && m.status === 'active')
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 4)
    .map((m) => `[${m.type === 'bug' ? 'BUG' : 'TODO'}] ${shorten(m.value, 64)}`)

  const graphRoots = project.graphNodes
    .filter((n) => n.kind === 'module')
    .slice(0, 6)
    .map((n) => n.label)

  const lines: string[] = []
  lines.push(
    `[CORTEX-OS SYNC | Project: ${project.name}${project.platform ? ` | Platform: ${project.platform}` : ''} | State: #${stateHash} | Updated: ${project.updatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC]`,
  )
  if (project.description) lines.push(`Mission: ${shorten(project.description, 110).replace(/\.+$/, '')}.`)
  lines.push(`Stack: ${dnaSnapshot.stackSummary}.`)
  if (decisions.length > 0) lines.push(`Decisions: ${decisions.join(' · ')}.`)
  if (openItems.length > 0) {
    const bugCount = project.memories.filter((m) => m.type === 'bug' && m.status === 'active').length
    const todoCount = project.memories.filter((m) => m.type === 'todo' && m.status === 'active').length
    lines.push(`Open (${todoCount} TODOs, ${bugCount} bugs): ${openItems.join(' · ')}.`)
  }
  if (graphRoots.length > 0) lines.push(`Modules: ${graphRoots.join(', ')}.`)
  if (dna && dna.codingStandards.length > 0) {
    lines.push(`Standards: ${shorten(dna.codingStandards[0].rule, 70)}.`)
  }
  lines.push(
    'Deeper context on demand: query the Cortex daemon (GET /api/cortex/sync/{slug}, POST /api/cortex/search) instead of re-reading the codebase.',
  )

  const markdown = lines.join('\n')

  return {
    // Phase 1 contract (backward compatible)
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      platform: project.platform,
    },
    stateHash,
    updatedAt: project.updatedAt.toISOString(),
    stack,
    latestDecisions: decisions,
    openItems,
    graphRoots,
    markdown,
    tokens: estimateTokens(markdown),

    // Phase 2 blueprint contract
    header,
    dnaSnapshot,
    scopedGraphContext: scoped,
    continuityState,
  }
}

// Backward-compatible alias (Phase 1 callers/tests).
export const buildStatePacket = buildSyncPacket

// ---------------------------------------------------------------------------
// Active module inference (the "scoped query" prelude)
// ---------------------------------------------------------------------------

interface InferenceContext {
  events: Array<{ kind: string; message: string; meta: string | null }>
  interactions: Array<{ rawText: string }>
  graphNodes: Array<{ id: string; kind: string; label: string; props: string }>
  graphEdges: Array<{ sourceId: string; targetId: string; relation: string }>
}

async function inferActiveModule(
  _projectId: string,
  ctx: InferenceContext,
): Promise<string> {
  const moduleLabels = ctx.graphNodes.filter((n) => n.kind === 'module').map((n) => n.label)
  if (moduleLabels.length === 0) return 'General'

  // 1. Latest file/git activity carries the module in its meta.
  for (const event of ctx.events) {
    if (event.kind !== 'file.changed' && event.kind !== 'file.added' && event.kind !== 'git.commit') continue
    const meta = safeParse(event.meta)
    if (typeof meta.module === 'string' && moduleLabels.includes(meta.module)) return meta.module
    // Fall back to path-based inference against module dirs.
    if (typeof meta.path === 'string') {
      const match = matchModuleByPath(meta.path, ctx.graphNodes)
      if (match) return match
    }
  }

  // 2. Latest interaction text mentions a module (or its tech).
  for (const interaction of ctx.interactions) {
    const lower = interaction.rawText.toLowerCase()
    for (const label of moduleLabels) {
      if (lower.includes(label.toLowerCase())) return label
    }
  }

  // 3. Busiest module (most edges) as a stable default.
  const degree = new Map<string, number>()
  for (const edge of ctx.graphEdges) {
    const source = ctx.graphNodes.find((n) => n.id === edge.sourceId)
    const target = ctx.graphNodes.find((n) => n.id === edge.targetId)
    if (source?.kind === 'module') degree.set(source.label, (degree.get(source.label) ?? 0) + 1)
    if (target?.kind === 'module') degree.set(target.label, (degree.get(target.label) ?? 0) + 1)
  }
  const busiest = [...degree.entries()].sort((a, b) => b[1] - a[1])[0]
  return busiest?.[0] ?? moduleLabels[0]
}

function matchModuleByPath(
  path: string,
  nodes: Array<{ kind: string; label: string; props: string }>,
): string | null {
  let best: { label: string; dir: string } | null = null
  for (const node of nodes) {
    if (node.kind !== 'module') continue
    const dir = safeParse(node.props).dir
    if (typeof dir === 'string' && dir.length > 0 && path.startsWith(dir)) {
      if (!best || dir.length > best.dir.length) best = { label: node.label, dir }
    }
  }
  return best?.label ?? null
}

/** Keywords that scope a module: its label, its dir, and the tech it USES. */
function collectModuleKeywords(
  moduleLabel: string,
  nodes: Array<{ id: string; kind: string; label: string; props: string }>,
  edges: Array<{ sourceId: string; targetId: string; relation: string }>,
): Set<string> {
  const keywords = new Set<string>()
  const labelLower = moduleLabel.toLowerCase()
  keywords.add(labelLower)
  const moduleNode = nodes.find((n) => n.kind === 'module' && n.label.toLowerCase() === labelLower)
  if (moduleNode) {
    const dir = safeParse(moduleNode.props).dir
    if (typeof dir === 'string') keywords.add(dir.toLowerCase())
    for (const edge of edges) {
      if (edge.sourceId !== moduleNode.id || edge.relation !== 'USES') continue
      const tech = nodes.find((n) => n.id === edge.targetId)
      if (tech) keywords.add(tech.label.toLowerCase())
    }
  }
  return keywords
}

// ---------------------------------------------------------------------------
// Scoped graph context (the blueprint §5 scoped query, graph-native)
// ---------------------------------------------------------------------------

interface ScopedInput {
  nodes: Array<{ id: string; kind: string; label: string; props: string }>
  edges: Array<{ sourceId: string; targetId: string; relation: string }>
  nodeById: Map<string, { id: string; kind: string; label: string; props: string }>
  memories: Array<{
    id: string
    type: string
    key: string
    value: string
    status: string
    importance: number
  }>
}

function buildScopedContext(
  _projectId: string,
  activeModule: string,
  keywords: Set<string>,
  input: ScopedInput,
): CrossPlatformSyncPacket['scopedGraphContext'] {
  const labelLower = activeModule.toLowerCase()

  // relevantSymbols — file nodes under the active module (CONTAINS edges from
  // the module, or paths under its dir), rendered as compact AST pointers.
  const relevantSymbols: CrossPlatformSyncPacket['scopedGraphContext']['relevantSymbols'] = []
  const moduleNode = input.nodes.find((n) => n.kind === 'module' && n.label.toLowerCase() === labelLower)
  const fileIds = new Set<string>()
  if (moduleNode) {
    for (const edge of input.edges) {
      if (edge.sourceId === moduleNode.id && edge.relation === 'CONTAINS') fileIds.add(edge.targetId)
    }
  }
  const dir = moduleNode ? safeParse(moduleNode.props).dir : null
  for (const node of input.nodes) {
    if (node.kind !== 'file') continue
    if (fileIds.has(node.id)) continue
    if (typeof dir === 'string' && dir.length > 0 && node.label.startsWith(dir)) fileIds.add(node.id)
  }
  for (const id of fileIds) {
    const file = input.nodeById.get(id)
    if (!file) continue
    const props = safeParse(file.props)
    const lines = typeof props.lines === 'number' ? props.lines : '?'
    const exports = typeof props.exportsSummary === 'string' ? props.exportsSummary : ''
    relevantSymbols.push({
      symbolId: `${file.label} [~${lines}L]`,
      signature: exports || (typeof props.language === 'string' ? `${props.language} source` : 'source file'),
    })
    if (relevantSymbols.length >= 5) break
  }

  // relevantDecisions — decision/architecture memories touching the module.
  const relevantDecisions = input.memories
    .filter((m) => {
      if (m.type !== 'decision' && m.type !== 'architecture') return false
      if (m.status !== 'active') return false
      const haystack = `${m.key} ${m.value}`.toLowerCase()
      return [...keywords].some((k) => k.length >= 3 && haystack.includes(k))
    })
    .slice(0, 3)
    .map((m) => ({ id: m.id, title: m.key, constraint: shorten(m.value, 100) }))

  // openBugsInScope — bug graph nodes one hop from the module + bug memories
  // matching module keywords.
  const openBugsInScope: CrossPlatformSyncPacket['scopedGraphContext']['openBugsInScope'] = []
  if (moduleNode) {
    for (const edge of input.edges) {
      const bugSide =
        edge.sourceId === moduleNode.id ? input.nodeById.get(edge.targetId)
        : edge.targetId === moduleNode.id ? input.nodeById.get(edge.sourceId)
        : null
      if (!bugSide || bugSide.kind !== 'bug') continue
      const props = safeParse(bugSide.props)
      if (props.status === 'resolved') continue
      openBugsInScope.push({
        id: typeof props.memoryId === 'string' ? props.memoryId : bugSide.id,
        title: bugSide.label,
        rootCause: shorten(typeof props.detail === 'string' ? props.detail : '', 110),
      })
    }
  }
  for (const memory of input.memories) {
    if (openBugsInScope.length >= 3) break
    if (memory.type !== 'bug' || memory.status !== 'active') continue
    if (openBugsInScope.some((b) => b.id === memory.id)) continue
    const haystack = `${memory.key} ${memory.value}`.toLowerCase()
    if ([...keywords].some((k) => k.length >= 3 && haystack.includes(k))) {
      openBugsInScope.push({ id: memory.id, title: memory.key, rootCause: shorten(memory.value, 110) })
    }
  }

  return { activeModule, relevantDecisions, relevantSymbols, openBugsInScope: openBugsInScope.slice(0, 3) }
}

// ---------------------------------------------------------------------------

function hashState(input: Record<string, unknown>): string {
  const raw = JSON.stringify(input)
  let hash = 0x811c9dc5
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 6)
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max)}…`
}

function safeParse(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

export type { RelevantMemory }
