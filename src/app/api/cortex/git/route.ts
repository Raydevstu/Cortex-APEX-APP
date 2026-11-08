import { db } from '@/lib/db'
import { handleRouteError, ok, ApiError } from '@/lib/cortex/api'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cortex/git?projectId= — the project's ingested commit log
 * (deduped GitCommit records with platform hints and file lists).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    if (!projectId) return ok({ error: 'projectId query parameter is required' }, { status: 422 })

    const project = await db.project.findUnique({ where: { id: projectId } })
    if (!project) throw new ApiError('Project not found', 404)

    const commits = await db.gitCommit.findMany({
      where: { projectId },
      orderBy: { committedAt: 'desc' },
      take: 50,
    })

    return ok({
      commits: commits.map((c) => ({
        id: c.id,
        hash: c.hash,
        message: c.message,
        author: c.author,
        platform: c.platform,
        filesCount: c.filesCount,
        files: safeParse(c.files),
        committedAt: c.committedAt.toISOString(),
      })),
    })
  } catch (error) {
    return handleRouteError(error)
  }
}

function safeParse(raw: string): Array<{ path: string; status: string }> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as Array<{ path: string; status: string }>) : []
  } catch {
    return []
  }
}
