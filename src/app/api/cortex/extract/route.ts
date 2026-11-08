import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody, ApiError } from '@/lib/cortex/api'
import { extractAndApplyMemoryDelta } from '@/lib/cortex/memory-delta'
import { EXTRACT_SOURCE_PLATFORMS } from '@/lib/cortex/types'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const extractSchema = z.object({
  projectId: z.string().min(1),
  sourcePlatform: z.enum(EXTRACT_SOURCE_PLATFORMS),
  rawUserPrompt: z.string().trim().min(3).max(20_000),
  aiResponseText: z.string().trim().min(3).max(20_000),
  modifiedFilesAstDiff: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        addedSymbols: z.array(z.string().max(200)).max(50).default([]),
        modifiedSymbols: z.array(z.string().max(200)).max(50).default([]),
      }),
    )
    .max(50)
    .optional(),
  useLlm: z.boolean().optional(),
  /** Phase 5 git-hook loop: stable session id — persisted on the Interaction
   *  so spool replay can deduplicate by commit SHA. */
  sessionId: z.string().trim().min(3).max(120).optional(),
})

/**
 * POST /api/cortex/extract — ENGINE 3, the Automatic Memory Extractor.
 *
 * Background hook after every AI coding turn: produces the
 * ExtractedMemoryDelta (decisions with supersede detection, requirements,
 * task transitions, bugs, preferences) and applies it to the memory engine,
 * Knowledge Graph (GOVERNED_BY / SUPERSEDES / HAS_BUG edges) and the
 * episodic vector store.
 */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, extractSchema)

    const project =
      (await db.project.findUnique({ where: { id: input.projectId } })) ??
      (await db.project.findUnique({ where: { slug: input.projectId } }))
    if (!project) throw new ApiError('Project not found', 404)

    const report = await extractAndApplyMemoryDelta({
      projectId: project.id,
      sourcePlatform: input.sourcePlatform,
      rawUserPrompt: input.rawUserPrompt,
      aiResponseText: input.aiResponseText,
      ...(input.modifiedFilesAstDiff ? { modifiedFilesAstDiff: input.modifiedFilesAstDiff } : {}),
      ...(input.useLlm !== undefined ? { useLlm: input.useLlm } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    })

    return ok(report, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
