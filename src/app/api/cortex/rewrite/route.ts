import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody } from '@/lib/cortex/api'
import { rewritePrompt } from '@/lib/cortex/rewrite'
import { getSettings } from '@/lib/cortex/settings'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const rewriteSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().trim().min(3).max(8000),
  engine: z.enum(['fast', 'deep', 'cloud']).optional(),
})

/**
 * POST /api/cortex/rewrite — the Tier-1 Prompt Rewriter.
 * Engines: fast (deterministic, <50ms), deep (local Ollama), cloud (GLM).
 */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, rewriteSchema)
    const settings = await getSettings()
    const engine = input.engine ?? settings.defaultEngine

    const result = await rewritePrompt({
      projectId: input.projectId,
      prompt: input.prompt,
      engine,
      ollamaBaseUrl: settings.ollamaBaseUrl,
      ollamaModel: settings.ollamaModel,
    })

    return ok(result)
  } catch (error) {
    return handleRouteError(error)
  }
}

/** GET /api/cortex/rewrite?projectId= — prompt session history. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    if (!projectId) return ok({ error: 'projectId query parameter is required' }, { status: 422 })

    const sessions = await db.promptSession.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        rawPrompt: true,
        rewrittenPrompt: true,
        engine: true,
        intent: true,
        complexity: true,
        tokensRaw: true,
        tokensStructured: true,
        tokensContextAvoided: true,
        durationMs: true,
        createdAt: true,
      },
    })

    return ok({ sessions })
  } catch (error) {
    return handleRouteError(error)
  }
}
