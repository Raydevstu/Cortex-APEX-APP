import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody } from '@/lib/cortex/api'
import { captureInteraction } from '@/lib/cortex/capture'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const captureSchema = z.object({
  projectId: z.string().min(1),
  text: z.string().trim().min(5).max(20_000),
  title: z.string().trim().max(200).optional(),
  platform: z.enum(['codex', 'hermes', 'opencode', 'claude', 'cursor', 'windsurf', 'web', 'other']).optional(),
})

/** GET /api/cortex/interactions?projectId= — episodic interaction log. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    if (!projectId) return ok({ error: 'projectId query parameter is required' }, { status: 422 })

    const interactions = await db.interaction.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return ok({ interactions })
  } catch (error) {
    return handleRouteError(error)
  }
}

/**
 * POST /api/cortex/interactions — capture a raw chat transcript and run the
 * memory engine over it (extraction → dedupe → graph linking → timeline).
 */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, captureSchema)
    const result = await captureInteraction(input)
    return ok(result, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
