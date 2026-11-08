import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody } from '@/lib/cortex/api'
import { contextSubgraph, getGraph, getNeighbors, upsertEdge, upsertNode } from '@/lib/cortex/graph'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const postSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    projectId: z.string().min(1),
    kind: z.enum(['root', 'module', 'tech', 'feature', 'bug', 'external']),
    label: z.string().trim().min(1).max(120),
    props: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    op: z.literal('add_edge'),
    projectId: z.string().min(1),
    sourceLabel: z.string().trim().min(1).max(120),
    relation: z.enum(['CONTAINS', 'USES', 'DEPENDS_ON', 'IMPLEMENTS', 'BLOCKED_BY', 'HAS_BUG', 'PREFERS', 'SYNCED_WITH']),
    targetLabel: z.string().trim().min(1).max(120),
  }),
])

/** GET /api/cortex/graph?projectId=&nodeId=&context= — full graph, node
 *  neighbourhood, or context-matched subgraph for a prompt. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    if (!projectId) return ok({ error: 'projectId query parameter is required' }, { status: 422 })

    const nodeId = url.searchParams.get('nodeId')
    if (nodeId) {
      const neighborhood = await getNeighbors(projectId, nodeId)
      return ok(neighborhood)
    }

    const contextText = url.searchParams.get('context')
    if (contextText) {
      const pointers = await contextSubgraph(projectId, contextText, 10)
      return ok({ pointers })
    }

    const graph = await getGraph(projectId)
    return ok(graph)
  } catch (error) {
    return handleRouteError(error)
  }
}

/** POST /api/cortex/graph — add a node or an edge (labels resolve to nodes). */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, postSchema)

    if (input.op === 'add_node') {
      const id = await upsertNode(input.projectId, input.kind, input.label, input.props ?? {})
      await db.timelineEvent.create({
        data: {
          projectId: input.projectId,
          kind: 'graph.updated',
          message: `Node added to Knowledge Graph: (${input.label}) [${input.kind}].`,
        },
      })
      return ok({ nodeId: id }, { status: 201 })
    }

    // add_edge: resolve labels to nodes of any kind
    const nodes = await db.graphNode.findMany({ where: { projectId: input.projectId } })
    const source = nodes.find((n) => n.label.toLowerCase() === input.sourceLabel.toLowerCase())
    const target = nodes.find((n) => n.label.toLowerCase() === input.targetLabel.toLowerCase())
    if (!source || !target) {
      return ok(
        {
          error: `Could not resolve ${!source ? `source "${input.sourceLabel}"` : `target "${input.targetLabel}"`} to an existing node. Create the node first.`,
        },
        { status: 422 },
      )
    }

    await upsertEdge(input.projectId, source.id, target.id, input.relation)
    await db.timelineEvent.create({
      data: {
        projectId: input.projectId,
        kind: 'graph.updated',
        message: `Edge added: (${source.label}) —[${input.relation}]→ (${target.label}).`,
      },
    })
    return ok({ edge: `${source.label} -[${input.relation}]-> ${target.label}` }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}

/** DELETE /api/cortex/graph?projectId=&nodeId= — remove a node (edges cascade). */
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    const nodeId = url.searchParams.get('nodeId')
    if (!projectId || !nodeId) {
      return ok({ error: 'projectId and nodeId query parameters are required' }, { status: 422 })
    }

    const node = await db.graphNode.findFirst({ where: { id: nodeId, projectId } })
    if (!node) return ok({ error: 'Node not found' }, { status: 404 })
    if (node.kind === 'root') {
      return ok({ error: 'The root node cannot be deleted.' }, { status: 422 })
    }

    await db.graphNode.delete({ where: { id: nodeId } })
    return ok({ deleted: true, nodeId })
  } catch (error) {
    return handleRouteError(error)
  }
}
