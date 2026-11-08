import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody, ApiError } from '@/lib/cortex/api'
import { ingestCommits, type GitCommitInput } from '@/lib/cortex/git'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const fileSchema = z.object({
  path: z.string().trim().min(1).max(500),
  status: z.enum(['A', 'M', 'D', 'R', 'C', 'T', 'U']).catch('M'),
})

const webhookSchema = z.object({
  slug: z.string().trim().min(1).max(120),
  platform: z.enum(['codex', 'hermes', 'opencode', 'claude', 'cursor', 'windsurf', 'web', 'other']).optional(),
  commits: z
    .array(
      z.object({
        hash: z.string().trim().regex(/^[0-9a-f]{7,40}$/i, 'hash must be a git SHA (7–40 hex chars)'),
        message: z.string().trim().min(1).max(2_000),
        author: z.string().trim().max(200).optional(),
        timestamp: z.string().trim().max(40).optional(),
        files: z.array(fileSchema).max(200).default([]),
      }),
    )
    .min(1)
    .max(50),
})

/**
 * POST /api/cortex/hooks/git — the post-commit webhook the installed git
 * hook calls (scripts/cortex-git-hook.mjs). Real-time "work done in Codex
 * updates the Knowledge Graph": commits land as timeline events, file nodes
 * refresh, and fix-commits auto-resolve open bugs.
 */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, webhookSchema)

    const project = await db.project.findUnique({ where: { slug: input.slug } })
    if (!project) throw new ApiError(`No project with slug "${input.slug}" — create it in the Command Center first`, 404)

    const commits: GitCommitInput[] = input.commits.map((c) => ({
      hash: c.hash,
      message: c.message,
      author: c.author,
      timestamp: c.timestamp,
      files: c.files,
      platform: input.platform,
    }))

    const result = await ingestCommits(project.id, commits, 'webhook')
    return ok({ project: project.slug, ...result }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
