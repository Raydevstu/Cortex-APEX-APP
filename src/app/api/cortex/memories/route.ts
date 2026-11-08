import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody } from '@/lib/cortex/api'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(['decision', 'architecture', 'requirement', 'todo', 'bug', 'preference']),
  key: z.string().trim().min(1).max(120),
  value: z.string().trim().min(3).max(1000),
  importance: z.number().int().min(1).max(5).optional().default(3),
})

/** GET /api/cortex/memories?projectId=&type=&status= — filtered memory list. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    const type = url.searchParams.get('type')
    const status = url.searchParams.get('status')
    const q = url.searchParams.get('q')
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 300)

    if (!projectId) return ok({ error: 'projectId query parameter is required' }, { status: 422 })

    const memories = await db.memory.findMany({
      where: {
        projectId,
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { key: { contains: q } },
                { value: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: [{ status: 'asc' }, { importance: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    })

    return ok({ memories })
  } catch (error) {
    return handleRouteError(error)
  }
}

/** POST /api/cortex/memories — manual memory write (also used by MCP in Phase 2). */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, createSchema)
    const project = await db.project.findUnique({ where: { id: input.projectId } })
    if (!project) return ok({ error: 'Project not found' }, { status: 404 })

    const memory = await db.memory.create({
      data: {
        projectId: input.projectId,
        type: input.type,
        key: input.key,
        value: input.value,
        importance: input.importance,
        source: 'api',
      },
    })

    await db.timelineEvent.create({
      data: {
        projectId: input.projectId,
        kind: 'memory.captured',
        message: `Manual memory logged: [${input.type}] ${input.key}.`,
        meta: JSON.stringify({ memoryId: memory.id }),
      },
    })

    return ok({ memory }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
