import { handleRouteError, ok } from '@/lib/cortex/api'
import { assetsInventory } from '@/lib/cortex/assets'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cortex/assets — inventory of the Phase 3 blueprint assets (master
 * system prompts, strict JSON grammars, docs cache). Served so the behaviour
 * of every engine is auditable from the Command Center — no hidden prompts.
 */
export async function GET() {
  try {
    const inventory = await assetsInventory()
    return ok({ assets: inventory })
  } catch (error) {
    return handleRouteError(error)
  }
}
