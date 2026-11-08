import { db } from '@/lib/db'
import { handleRouteError, ok, ApiError } from '@/lib/cortex/api'
import { listStagedArtifacts } from '@/lib/cortex/staging'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cortex/preexecute/staged?projectId=&status= — the staged-boilerplate
 * queue (content included) for the scope-guard-validated apply/discard flow.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    if (!projectId) return ok({ error: 'projectId query parameter is required' }, { status: 422 })
    const status = url.searchParams.get('status') ?? undefined

    const project =
      (await db.project.findUnique({ where: { id: projectId } })) ??
      (await db.project.findUnique({ where: { slug: projectId } }))
    if (!project) throw new ApiError('Project not found', 404)

    const artifacts = await listStagedArtifacts(project.id, status)
    return ok({ artifacts })
  } catch (error) {
    return handleRouteError(error)
  }
}
