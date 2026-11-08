import { handleRouteError, ok } from '@/lib/cortex/api'
import { buildStatePacket } from '@/lib/cortex/packet'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cortex/sync/[slug] — the Compact State Packet for cross-platform
 * sync (Codex → CortexOS → Hermes). ~150–300 tokens instead of a full
 * project dump; deeper context stays available on demand via the daemon.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params
    const packet = await buildStatePacket(decodeURIComponent(slug))
    return ok(packet)
  } catch (error) {
    return handleRouteError(error)
  }
}
