import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody, ApiError } from '@/lib/cortex/api'
import { assertGitRepo, ingestCommits, parseGitLog } from '@/lib/cortex/git'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const ingestSchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).optional(),
  full: z.boolean().optional(), // ignore the watermark and re-read recent history
})

/**
 * POST /api/cortex/git/ingest — backfill the Knowledge Graph from the real
 * git history of the project workspace (subprocess `git log`, watermarked by
 * Project.gitLastIngestAt so repeat calls are incremental). This is the
 * no-hook fallback: even without the post-commit hook installed, any work
 * committed on any platform can be pulled into the brain on demand.
 */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, ingestSchema)
    if (!input.projectId && !input.slug) {
      throw new ApiError('Either projectId or slug is required', 422)
    }

    const project = input.projectId
      ? await db.project.findUnique({ where: { id: input.projectId } })
      : await db.project.findUnique({ where: { slug: input.slug } })
    if (!project) throw new ApiError('Project not found', 404)
    if (!project.rootPath) {
      throw new ApiError('Project has no rootPath — set the workspace path first', 422)
    }

    await assertGitRepo(project.rootPath)

    const since = input.full ? undefined : project.gitLastIngestAt ?? undefined
    const commits = await parseGitLog(project.rootPath, since)
    if (commits.length === 0) {
      return ok({ ingested: 0, duplicates: 0, bugsResolved: [], filesTouched: 0, note: 'No new commits since the last ingest.' })
    }

    const result = await ingestCommits(project.id, commits, 'git')
    return ok(result, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
