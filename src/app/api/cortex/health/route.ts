import { db } from '@/lib/db'
import { getOllamaStatus } from '@/lib/cortex/ollama'
import { getSettings } from '@/lib/cortex/settings'
import { handleRouteError, ok } from '@/lib/cortex/api'
import type { DaemonHealth } from '@/lib/cortex/types'

export const dynamic = 'force-dynamic'

/** GET /api/cortex/health — daemon heartbeat: database, Ollama, counts. */
export async function GET() {
  try {
    const settings = await getSettings()
    const [projects, memories, nodes, edges, interactions, promptSessions] = await Promise.all([
      db.project.count(),
      db.memory.count(),
      db.graphNode.count(),
      db.graphEdge.count(),
      db.interaction.count(),
      db.promptSession.count(),
    ])
    const ollama = await getOllamaStatus(settings.ollamaBaseUrl)

    const health: DaemonHealth = {
      status: 'online',
      version: '0.1.0',
      phase: 'Phase 1 — The Brain & Prompt Interceptor',
      database: 'ok',
      ollama,
      counts: { projects, memories, nodes, edges, interactions, promptSessions },
    }
    return ok(health)
  } catch (error) {
    return handleRouteError(error)
  }
}
