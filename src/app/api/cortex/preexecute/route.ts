import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody, ApiError } from '@/lib/cortex/api'
import { runPreExecution } from '@/lib/cortex/preexec'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const preexecSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().trim().min(3).max(8000),
  targetPlatform: z
    .enum(['codex', 'hermes', 'opencode', 'cursor', 'windsurf', 'claude', 'chatgpt', 'local_ollama'])
    .optional(),
  module: z.string().max(60).optional(),
  useLlm: z.boolean().optional(),
})

/**
 * POST /api/cortex/preexecute — the Phase 3 Pre-Execution Local Agent.
 * Engine 1 triage → local tool execution (0 cloud tokens) → Engine 2 Tier-1
 * specification. LOCAL_ONLY tasks return early with staged artifacts and no
 * cloud prompt at all.
 */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, preexecSchema)

    const project =
      (await db.project.findUnique({ where: { id: input.projectId } })) ??
      (await db.project.findUnique({ where: { slug: input.projectId } }))
    if (!project) throw new ApiError('Project not found', 404)

    const result = await runPreExecution({
      projectId: project.id,
      prompt: input.prompt,
      ...(input.targetPlatform ? { targetPlatform: input.targetPlatform } : {}),
      ...(input.module ? { module: input.module } : {}),
      ...(input.useLlm !== undefined ? { useLlm: input.useLlm } : {}),
    })

    return ok(result, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}

/** GET /api/cortex/preexecute?projectId= — pre-execution run history. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    if (!projectId) return ok({ error: 'projectId query parameter is required' }, { status: 422 })

    const runs = await db.preExecRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        rawPrompt: true,
        targetPlatform: true,
        intentCategory: true,
        complexityScore: true,
        executionMode: true,
        routerEngine: true,
        handledLocally: true,
        tokensSavedCloud: true,
        stagedCount: true,
        durationMs: true,
        createdAt: true,
      },
    })

    return ok({ runs })
  } catch (error) {
    return handleRouteError(error)
  }
}
