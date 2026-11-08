/**
 * Project Knowledge Graph service (blueprint Pillar 2).
 *
 * A property-graph triple store on SQLite: (source) --[RELATION]--> (target).
 * Provides idempotent upserts by (kind, label), one-hop traversal and —
 * critically for zero-token sync — context-matched subgraph retrieval that
 * returns symbolic pointers instead of raw knowledge dumps.
 */
import { db } from '@/lib/db'
import type { GraphContextPointer, GraphNodeKind } from './types'

type NodeRecord = {
  id: string
  projectId: string
  kind: string
  label: string
  props: string
}

export async function upsertNode(
  projectId: string,
  kind: GraphNodeKind | string,
  label: string,
  props: Record<string, unknown> = {},
): Promise<string> {
  const existing = await db.graphNode.findUnique({
    where: { projectId_kind_label: { projectId, kind, label } },
  })
  if (existing) {
    const merged = { ...safeParse(existing.props), ...props }
    await db.graphNode.update({
      where: { id: existing.id },
      data: { props: JSON.stringify(merged) },
    })
    return existing.id
  }
  const created = await db.graphNode.create({
    data: { projectId, kind, label, props: JSON.stringify(props) },
  })
  return created.id
}

export async function upsertEdge(
  projectId: string,
  sourceId: string,
  targetId: string,
  relation: string,
  weight = 1,
): Promise<string> {
  const existing = await db.graphEdge.findUnique({
    where: {
      projectId_sourceId_relation_targetId: { projectId, sourceId, relation, targetId },
    },
  })
  if (existing) return existing.id
  const created = await db.graphEdge.create({
    data: { projectId, sourceId, targetId, relation, weight },
  })
  return created.id
}

export async function upsertEdgeByLabel(
  projectId: string,
  sourceKind: string,
  sourceLabel: string,
  relation: string,
  targetKind: string,
  targetLabel: string,
): Promise<void> {
  const source = await db.graphNode.findUnique({
    where: { projectId_kind_label: { projectId, kind: sourceKind, label: sourceLabel } },
  })
  const target = await db.graphNode.findUnique({
    where: { projectId_kind_label: { projectId, kind: targetKind, label: targetLabel } },
  })
  if (!source || !target) return
  await upsertEdge(projectId, source.id, target.id, relation)
}

export async function getGraph(projectId: string) {
  const [nodes, edges] = await Promise.all([
    db.graphNode.findMany({ where: { projectId }, orderBy: [{ kind: 'asc' }, { label: 'asc' }] }),
    db.graphEdge.findMany({ where: { projectId } }),
  ])
  return {
    nodes: nodes.map((n) => ({ ...n, props: safeParse(n.props) })),
    edges,
  }
}

export async function getNeighbors(projectId: string, nodeId: string) {
  const edges = await db.graphEdge.findMany({
    where: { projectId, OR: [{ sourceId: nodeId }, { targetId: nodeId }] },
  })
  const nodeIds = new Set<string>()
  for (const e of edges) {
    nodeIds.add(e.sourceId)
    nodeIds.add(e.targetId)
  }
  const nodes = await db.graphNode.findMany({
    where: { projectId, id: { in: [...nodeIds] } },
  })
  return { nodes: nodes.map((n) => ({ ...n, props: safeParse(n.props) })), edges }
}

export async function deleteNodeCascade(projectId: string, nodeId: string): Promise<void> {
  await db.graphNode.delete({ where: { id: nodeId, projectId } })
}

/**
 * Context-matched subgraph: match prompt tokens against node labels (and
 * alias props), expand one hop, and emit symbolic pointers of the form
 * "(Checkout) —[BLOCKED_BY]→ (Bug #14)" — the blueprint's zero-token
 * alternative to stuffing raw context into the target AI.
 */
export async function contextSubgraph(
  projectId: string,
  text: string,
  maxPointers = 10,
): Promise<GraphContextPointer[]> {
  const { nodes, edges } = await getGraph(projectId)
  if (nodes.length === 0) return []

  const tokens = tokenize(text)
  if (tokens.length === 0) return []

  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const matched = new Set<string>()

  for (const node of nodes) {
    if (node.kind === 'root') continue
    const haystack = `${node.label}`.toLowerCase()
    const aliases = Array.isArray((node.props as Record<string, unknown>).aliases)
      ? ((node.props as { aliases: string[] }).aliases as string[])
      : []
    const aliasHit = aliases.some((a) => tokens.has(a.toLowerCase()))
    const words = haystack.split(/[^a-z0-9#+.]+/).filter((w) => w.length >= 3)
    const labelHit = words.some((w) => tokens.has(w))
    if (aliasHit || labelHit) {
      matched.add(node.id)
      // One-hop expansion from matched nodes.
      for (const edge of edges) {
        if (edge.sourceId === node.id) matched.add(edge.targetId)
        if (edge.targetId === node.id) matched.add(edge.sourceId)
      }
    }
  }

  const pointers: GraphContextPointer[] = []
  const seen = new Set<string>()
  for (const edge of edges) {
    if (!matched.has(edge.sourceId) || !matched.has(edge.targetId)) continue
    const source = nodeById.get(edge.sourceId)
    const target = nodeById.get(edge.targetId)
    if (!source || !target) continue
    const key = `${source.label}|${edge.relation}|${target.label}`
    if (seen.has(key)) continue
    seen.add(key)
    // Prioritise edges where at least one endpoint directly matched.
    pointers.push({
      source: source.label,
      relation: edge.relation,
      target: target.label,
      targetKind: target.kind,
    })
    if (pointers.length >= maxPointers * 2) break
  }

  // Rank: risk/coupling relations first, then USES/CONTAINS.
  const priority: Record<string, number> = {
    BLOCKED_BY: 0, HAS_BUG: 0, DEPENDS_ON: 1, IMPLEMENTS: 2, USES: 3, CONTAINS: 4, PREFERS: 5, SYNCED_WITH: 6,
  }
  return pointers
    .sort((a, b) => (priority[a.relation] ?? 9) - (priority[b.relation] ?? 9))
    .slice(0, maxPointers)
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9#+._-]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  )
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'will', 'should', 'must',
  'need', 'still', 'then', 'also', 'from', 'into', 'our', 'are', 'was', 'were',
  'you', 'your', 'when', 'what', 'where', 'does', 'not', 'but', 'add', 'make',
  'build', 'create', 'update', 'using', 'please', 'can', 'get', 'set', 'new',
])

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

export type { NodeRecord }
