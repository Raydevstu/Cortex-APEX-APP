import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody } from '@/lib/cortex/api'
import { upsertNode } from '@/lib/cortex/graph'
import { z } from 'zod'
import type { ProjectSummary } from '@/lib/cortex/types'

export const dynamic = 'force-dynamic'

const PLATFORMS = ['codex', 'hermes', 'opencode', 'claude', 'cursor', 'windsurf', 'web', 'other'] as const

const createSchema = z.object({
  name: z.string().trim().min(2, 'name must be at least 2 characters').max(80),
  description: z.string().trim().max(500).optional().nullable(),
  rootPath: z.string().trim().max(500).optional().nullable(),
  platform: z.enum(PLATFORMS).optional().nullable(),
})

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project'
}

/** GET /api/cortex/projects — all projects with live counts. */
export async function GET() {
  try {
    const projects = await db.project.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { memories: true, graphNodes: true, graphEdges: true, promptSessions: true } },
        dna: { select: { generatedAt: true } },
        memories: { where: { status: 'active', type: { in: ['todo', 'bug'] } }, select: { id: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
    })

    const summaries: ProjectSummary[] = projects.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      rootPath: p.rootPath,
      platform: p.platform,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      counts: {
        memories: p._count.memories,
        openItems: p.memories.length,
        nodes: p._count.graphNodes,
        edges: p._count.graphEdges,
        promptSessions: p._count.promptSessions,
      },
      dnaGeneratedAt: p.dna?.generatedAt.toISOString() ?? null,
      lastActivityAt: (p.events[0]?.createdAt ?? p.updatedAt).toISOString(),
    }))

    return ok({ projects: summaries })
  } catch (error) {
    return handleRouteError(error)
  }
}

/** POST /api/cortex/projects — create a project (root node seeded). */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, createSchema)

    let slug = slugify(input.name)
    const clash = await db.project.findUnique({ where: { slug } })
    if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`

    const project = await db.project.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        rootPath: input.rootPath ?? null,
        platform: input.platform ?? null,
      },
    })

    await upsertNode(project.id, 'root', project.name, { role: 'project-root' })
    await db.timelineEvent.create({
      data: {
        projectId: project.id,
        kind: 'project.created',
        message: `Project bootstrapped${input.platform ? ` — primary platform: ${input.platform}` : ''}.`,
      },
    })

    return ok({ id: project.id, slug: project.slug, name: project.name }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
