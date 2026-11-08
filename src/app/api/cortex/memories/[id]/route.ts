import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody } from '@/lib/cortex/api'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  status: z.enum(['active', 'resolved']).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  value: z.string().trim().min(3).max(1000).optional(),
})

/** PATCH /api/cortex/memories/[id] — resolve/reopen or re-weight a memory. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const input = await parseBody(request, patchSchema)

    const existing = await db.memory.findUnique({ where: { id } })
    if (!existing) return ok({ error: 'Memory not found' }, { status: 404 })

    const memory = await db.memory.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.importance !== undefined ? { importance: input.importance } : {}),
        ...(input.value !== undefined ? { value: input.value } : {}),
      },
    })

    if (input.status === 'resolved') {
      await db.timelineEvent.create({
        data: {
          projectId: memory.projectId,
          kind: 'memory.resolved',
          message: `Item resolved: [${memory.type}] ${memory.key}.`,
          meta: JSON.stringify({ memoryId: memory.id }),
        },
      })
    }

    return ok({ memory })
  } catch (error) {
    return handleRouteError(error)
  }
}

/** DELETE /api/cortex/memories/[id] */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const existing = await db.memory.findUnique({ where: { id } })
    if (!existing) return ok({ error: 'Memory not found' }, { status: 404 })

    await db.memory.delete({ where: { id } })
    return ok({ deleted: true, id })
  } catch (error) {
    return handleRouteError(error)
  }
}
