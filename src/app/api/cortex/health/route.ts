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
    const [projects, memories, nodes, edges, interactions, promptSessions, handoffs, commits, episodes, preExecRuns, stagedArtifacts] = await Promise.all([
      db.project.count(),
      db.memory.count(),
      db.graphNode.count(),
      db.graphEdge.count(),
      db.interaction.count(),
      db.promptSession.count(),
      db.syncHandoff.count(),
      db.gitCommit.count(),
      db.interaction.count({ where: { embedding: { not: null } } }),
      db.preExecRun.count(),
      db.stagedArtifact.count(),
    ])
    const ollama = await getOllamaStatus(settings.ollamaBaseUrl)

    const health: DaemonHealth = {
      status: 'online',
      version: '0.3.0',
      phase: 'Phase 3 — Pre-Execution Local Agent & Token Optimizer',
      capabilities: [
        'phase1-brain-prompt-interceptor',
        'phase2-cross-platform-sync',
        'phase3-pre-execution-agent',
      ],
      database: 'ok',
      ollama,
      counts: {
        projects, memories, nodes, edges, interactions, promptSessions, handoffs, commits, episodes,
        preExecRuns, stagedArtifacts,
      },
    }
    return ok(health)
  } catch (error) {
    return handleRouteError(error)
  }
}
