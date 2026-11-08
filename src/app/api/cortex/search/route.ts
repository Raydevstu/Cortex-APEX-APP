import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody, ApiError } from '@/lib/cortex/api'
import { searchEpisodes } from '@/lib/cortex/episodic'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const searchSchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).optional(),
  query: z.string().trim().min(2).max(500),
  k: z.number().int().min(1).max(20).default(5),
})

/**
 * POST /api/cortex/search — semantic episodic search (blueprint §3 Tier-3).
 * Embeds the query through the provider chain (Ollama → deterministic local)
 * and cosine-scans every indexed episode, blended with keyword matching.
 * This is the on-demand deep-history channel the compact state packet
 * points to: "query the daemon instead of re-reading the transcript".
 */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, searchSchema)
    if (!input.projectId && !input.slug) {
      throw new ApiError('Either projectId or slug is required', 422)
    }

    const project = input.projectId
      ? await db.project.findUnique({ where: { id: input.projectId } })
      : await db.project.findUnique({ where: { slug: input.slug } })
    if (!project) throw new ApiError('Project not found', 404)

    const search = await searchEpisodes(project.id, input.query, input.k)
    return ok(search)
  } catch (error) {
    return handleRouteError(error)
  }
}
