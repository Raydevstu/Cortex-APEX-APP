import { handleRouteError, ok } from '@/lib/cortex/api'
import { seedDemoProject } from '@/lib/cortex/seed'

export const dynamic = 'force-dynamic'

/** POST /api/cortex/seed — idempotently seed the SaaS-CRM demo project. */
export async function POST() {
  try {
    const result = await seedDemoProject()
    return ok({
      seeded: result.created,
      projectId: result.projectId,
      message: result.created
        ? 'SaaS-CRM demo project seeded (15 memories, DNA, 20+ graph triples, timeline).'
        : 'Demo project already present — no changes made.',
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
