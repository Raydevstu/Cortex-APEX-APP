import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody, ApiError } from '@/lib/cortex/api'
import { applyStagedArtifact, discardStagedArtifact, revertStagedArtifact } from '@/lib/cortex/staging'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const actionSchema = z.object({
  action: z.enum(['apply', 'discard', 'revert']),
})

/**
 * POST /api/cortex/preexecute/staged/[id] — the staged-artifact lifecycle.
 *
 *   apply   — write the file into the workspace through the AST Scope Guard
 *             (inside root, never protected paths, create never clobbers,
 *             modify captures previousContent for revert)
 *   discard — drop a staged artifact without ever touching the workspace
 *   revert  — undo an applied artifact (delete created file / restore content)
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const input = await parseBody(request, actionSchema)

    switch (input.action) {
      case 'apply': {
        const result = await applyStagedArtifact(id)
        return ok({
          action: 'apply',
          artifact: result.artifact,
          writtenPath: result.writtenPath,
          merged: result.merged,
        })
      }
      case 'discard': {
        const artifact = await discardStagedArtifact(id)
        return ok({ action: 'discard', artifact })
      }
      case 'revert': {
        const result = await revertStagedArtifact(id)
        return ok({ action: 'revert', artifact: result.artifact, restored: result.restored })
      }
    }
  } catch (error) {
    return handleRouteError(error)
  }
}

/** GET /api/cortex/preexecute/staged/[id] — one staged artifact with content. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const row = await db.stagedArtifact.findUnique({
      where: { id },
      include: { run: { select: { rawPrompt: true, executionMode: true, createdAt: true } } },
    })
    if (!row) throw new ApiError('Staged artifact not found', 404)
    return ok({ artifact: row })
  } catch (error) {
    return handleRouteError(error)
  }
}
