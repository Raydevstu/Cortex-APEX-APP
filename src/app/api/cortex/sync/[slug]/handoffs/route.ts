import { db } from '@/lib/db'
import { handleRouteError, ok, ApiError } from '@/lib/cortex/api'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cortex/sync/[slug]/handoffs — audit trail of every cross-platform
 * handoff executed for the project (Pillar 3 + Pillar 11 evidence).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params
    const decoded = decodeURIComponent(slug)
    const project =
      (await db.project.findUnique({ where: { id: decoded } })) ??
      (await db.project.findUnique({ where: { slug: decoded } }))
    if (!project) throw new ApiError('Project not found', 404)

    const handoffs = await db.syncHandoff.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    })

    return ok({
      handoffs: handoffs.map((h) => ({
        id: h.id,
        fromPlatform: h.fromPlatform,
        toPlatform: h.toPlatform,
        stateHash: h.stateHash,
        activeModule: h.activeModule,
        packetTokens: h.packetTokens,
        createdAt: h.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
