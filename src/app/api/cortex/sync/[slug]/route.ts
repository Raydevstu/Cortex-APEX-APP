import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody, ApiError } from '@/lib/cortex/api'
import { buildSyncPacket } from '@/lib/cortex/packet'
import { AI_PLATFORMS } from '@/lib/cortex/types'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

async function resolveProject(idOrSlug: string) {
  const decoded = decodeURIComponent(idOrSlug)
  const project =
    (await db.project.findUnique({ where: { id: decoded } })) ??
    (await db.project.findUnique({ where: { slug: decoded } }))
  if (!project) throw new ApiError('Project not found', 404)
  return project
}

const handoffSchema = z.object({
  targetPlatform: z.enum(AI_PLATFORMS),
  module: z.string().trim().max(60).optional(),
})

/**
 * GET /api/cortex/sync/[slug] — the Cross-Platform Sync Packet (preview).
 * Builds the full blueprint contract (header, dnaSnapshot, scopedGraphContext,
 * continuityState + the Phase 1 markdown header) WITHOUT recording a handoff.
 * Optional: ?target=hermes&module=Payments to scope the packet.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params
    const url = new URL(request.url)
    const packet = await buildSyncPacket(decodeURIComponent(slug), {
      targetPlatform: url.searchParams.get('target') ?? undefined,
      module: url.searchParams.get('module') ?? undefined,
    })
    return ok(packet)
  } catch (error) {
    return handleRouteError(error)
  }
}

/**
 * POST /api/cortex/sync/[slug] — execute a cross-platform handoff.
 * Builds the packet for {targetPlatform}, records the SyncHandoff (audit),
 * flips the project's last-active platform, stamps lastSyncedAt and appends
 * an immutable timeline event. This is the write path of Pillar 3: work done
 * on one platform is carried to the next with zero manual effort.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params
    const input = await parseBody(request, handoffSchema)

    const project = await resolveProject(slug)

    const packet = await buildSyncPacket(project.id, {
      targetPlatform: input.targetPlatform,
      module: input.module,
    })

    const handoff = await db.syncHandoff.create({
      data: {
        projectId: project.id,
        fromPlatform: packet.header.previousPlatform,
        toPlatform: input.targetPlatform,
        stateHash: packet.stateHash,
        activeModule: packet.scopedGraphContext.activeModule,
        packetTokens: packet.tokens,
      },
    })

    await db.project.update({
      where: { id: project.id },
      data: { platform: input.targetPlatform, lastSyncedAt: new Date() },
    })

    await db.timelineEvent.create({
      data: {
        projectId: project.id,
        kind: 'sync.handoff',
        message: `Cross-platform handoff executed: ${packet.header.previousPlatform} → ${input.targetPlatform} (state #${packet.stateHash}, module "${packet.scopedGraphContext.activeModule}", ${packet.tokens} tokens).`,
        meta: JSON.stringify({ handoffId: handoff.id, targetPlatform: input.targetPlatform }),
      },
    })

    return ok({ handoffId: handoff.id, packet }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
