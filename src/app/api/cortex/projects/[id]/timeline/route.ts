import { db } from '@/lib/db'
import { handleRouteError, ok } from '@/lib/cortex/api'

export const dynamic = 'force-dynamic'

/** GET /api/cortex/projects/[id]/timeline — the Development Timeline (Pillar 11). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const project = await db.project.findUnique({ where: { id }, select: { id: true } })
    if (!project) return ok({ error: 'Project not found' }, { status: 404 })

    const events = await db.timelineEvent.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return ok({
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        message: e.message,
        meta: e.meta,
        createdAt: e.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
