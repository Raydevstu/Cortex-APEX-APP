import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody } from '@/lib/cortex/api'
import { parseDna } from '@/lib/cortex/rewrite'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  rootPath: z.string().trim().max(500).nullable().optional(),
  platform: z.enum(['codex', 'hermes', 'opencode', 'claude', 'cursor', 'windsurf', 'web', 'other']).nullable().optional(),
})

/** GET /api/cortex/projects/[id] — full project detail. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const project = await db.project.findUnique({
      where: { id },
      include: {
        dna: true,
        _count: { select: { memories: true, graphNodes: true, graphEdges: true, promptSessions: true, interactions: true } },
      },
    })
    if (!project) return ok({ error: 'Project not found' }, { status: 404 })

    return ok({
      project: {
        id: project.id,
        slug: project.slug,
        name: project.name,
        description: project.description,
        rootPath: project.rootPath,
        platform: project.platform,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        counts: {
          memories: project._count.memories,
          nodes: project._count.graphNodes,
          edges: project._count.graphEdges,
          promptSessions: project._count.promptSessions,
          interactions: project._count.interactions,
        },
        dna: project.dna
          ? {
              ...parseDna(project.dna),
              generationSource: project.dna.generationSource,
              generatedAt: project.dna.generatedAt.toISOString(),
            }
          : null,
      },
    })
  } catch (error) {
    return handleRouteError(error)
  }
}

/** PATCH /api/cortex/projects/[id] — update metadata. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const input = await parseBody(request, patchSchema)
    const existing = await db.project.findUnique({ where: { id } })
    if (!existing) return ok({ error: 'Project not found' }, { status: 404 })

    const project = await db.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.rootPath !== undefined ? { rootPath: input.rootPath } : {}),
        ...(input.platform !== undefined ? { platform: input.platform } : {}),
      },
    })
    return ok({ id: project.id, slug: project.slug, name: project.name })
  } catch (error) {
    return handleRouteError(error)
  }
}

/** DELETE /api/cortex/projects/[id] — cascade removes all project state. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const existing = await db.project.findUnique({ where: { id } })
    if (!existing) return ok({ error: 'Project not found' }, { status: 404 })

    await db.project.delete({ where: { id } })
    return ok({ deleted: true, id })
  } catch (error) {
    return handleRouteError(error)
  }
}
