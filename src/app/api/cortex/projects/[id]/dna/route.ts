import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody } from '@/lib/cortex/api'
import { scanWorkspace } from '@/lib/cortex/scan'
import { composeDna, syncGraphFromDna } from '@/lib/cortex/dna'
import { parseDna } from '@/lib/cortex/rewrite'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const regenerateSchema = z.object({
  mode: z.literal('scan'),
  rootPath: z.string().trim().min(1).max(500).optional(),
  includeBusinessRulesFromMemories: z.boolean().optional().default(true),
})

const patchSchema = z.object({
  architecturePhilosophy: z.string().trim().max(4000).optional(),
  businessRules: z.array(z.string().trim().min(2).max(400)).max(30).optional(),
  designPatterns: z.array(z.string().trim().min(2).max(400)).max(20).optional(),
  codingStandards: z.array(z.object({ rule: z.string().trim().min(2).max(400), source: z.string().trim().min(2).max(200) })).max(20).optional(),
  deploymentStrategy: z.string().trim().max(2000).optional(),
})

/**
 * GET /api/cortex/projects/[id]/dna — the PROJECT DNA document.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const project = await db.project.findUnique({ where: { id }, include: { dna: true } })
    if (!project) return ok({ error: 'Project not found' }, { status: 404 })
    if (!project.dna) return ok({ dna: null })

    return ok({
      dna: {
        ...parseDna(project.dna),
        generationSource: project.dna.generationSource,
        generatedAt: project.dna.generatedAt.toISOString(),
      },
    })
  } catch (error) {
    return handleRouteError(error)
  }
}

/**
 * POST /api/cortex/projects/[id]/dna — regenerate the PROJECT DNA from a
 * deterministic workspace scan (Deterministic Code Map → DNA → Graph sync).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const input = await parseBody(request, regenerateSchema)

    const project = await db.project.findUnique({ where: { id } })
    if (!project) return ok({ error: 'Project not found' }, { status: 404 })

    const rootPath = input.rootPath ?? project.rootPath
    if (!rootPath) {
      return ok(
        {
          error:
            'No workspace path known for this project. Provide rootPath in the request body (absolute path) or set it on the project first.',
        },
        { status: 422 },
      )
    }

    const scan = await scanWorkspace(rootPath)

    // Hybrid DNA: business rules can be inherited from captured requirement
    // memories so human-logged rules survive regeneration.
    const businessRules =
      input.includeBusinessRulesFromMemories
        ? await db.memory
            .findMany({
              where: { projectId: project.id, type: 'requirement', status: 'active' },
              orderBy: { importance: 'desc' },
              take: 10,
            })
            .then((rows) => rows.map((r) => r.value.slice(0, 300)))
        : []

    const dna = composeDna(scan, project.name, businessRules)
    const techEdges = await syncGraphFromDna(project.id, project.name, dna)

    const serialized = {
      architecturePhilosophy: dna.architecturePhilosophy,
      techStack: JSON.stringify(dna.techStack),
      codingStandards: JSON.stringify(dna.codingStandards),
      businessRules: JSON.stringify(dna.businessRules),
      preferredLibraries: JSON.stringify(dna.preferredLibraries),
      designPatterns: JSON.stringify(dna.designPatterns),
      deploymentStrategy: dna.deploymentStrategy,
      fileStats: JSON.stringify(dna.fileStats),
      generationSource: 'scan',
      generatedAt: new Date(),
    }

    await db.projectDna.upsert({
      where: { projectId: project.id },
      update: serialized,
      create: { projectId: project.id, ...serialized },
    })

    if (!project.rootPath) {
      await db.project.update({ where: { id: project.id }, data: { rootPath } })
    }

    await db.timelineEvent.create({
      data: {
        projectId: project.id,
        kind: 'dna.generated',
        message: `Project DNA regenerated from workspace scan (${scan.fileStats.scannedFiles} files, ${scan.fileStats.scannedFiles > 0 ? Object.keys(scan.fileStats.languages).length : 0} languages) — ${dna.techStack.length} stack entries, ${techEdges} graph edges synced.`,
        meta: JSON.stringify({ rootPath, files: scan.fileStats.scannedFiles }),
      },
    })

    return ok({
      dna: { ...dna, generationSource: 'scan', generatedAt: new Date().toISOString() },
      scan: {
        rootPath: scan.rootPath,
        scannedFiles: scan.fileStats.scannedFiles,
        scannedDirs: scan.fileStats.scannedDirs,
        totalLines: scan.fileStats.totalLines,
        languages: scan.fileStats.languages,
        prismaModels: scan.prismaModels,
        envKeys: scan.envExampleKeys,
        graphEdgesSynced: techEdges,
      },
    })
  } catch (error) {
    return handleRouteError(error)
  }
}

/**
 * PATCH /api/cortex/projects/[id]/dna — manual curation of DNA sections.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const input = await parseBody(request, patchSchema)

    const project = await db.project.findUnique({ where: { id }, include: { dna: true } })
    if (!project) return ok({ error: 'Project not found' }, { status: 404 })
    if (!project.dna) {
      return ok({ error: 'No DNA exists yet — generate it from a scan first (POST with mode:"scan").' }, { status: 422 })
    }

    const current = parseDna(project.dna)
    const updated = {
      architecturePhilosophy: input.architecturePhilosophy ?? current.architecturePhilosophy,
      businessRules: JSON.stringify(input.businessRules ?? current.businessRules),
      designPatterns: JSON.stringify(input.designPatterns ?? current.designPatterns),
      codingStandards: JSON.stringify(input.codingStandards ?? current.codingStandards),
      deploymentStrategy: input.deploymentStrategy ?? current.deploymentStrategy,
      generationSource: 'hybrid' as const,
      generatedAt: new Date(),
    }

    await db.projectDna.update({ where: { projectId: project.id }, data: updated })
    await db.timelineEvent.create({
      data: {
        projectId: project.id,
        kind: 'dna.updated',
        message: 'Project DNA manually curated.',
        meta: JSON.stringify({ sections: Object.keys(input) }),
      },
    })

    return ok({ updated: true })
  } catch (error) {
    return handleRouteError(error)
  }
}
