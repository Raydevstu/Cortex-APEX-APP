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
    const [projects, memories, nodes, edges, interactions, promptSessions, handoffs, commits, episodes, preExecRuns, stagedArtifacts, dagPlans] = await Promise.all([
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
      db.dagPlan.count(),
    ])
    const ollama = await getOllamaStatus(settings.ollamaBaseUrl)

    const health: DaemonHealth = {
      status: 'online',
      version: '0.5.0',
      phase: 'Phase 5 — Unified CLI & Git Memory Loop',
      capabilities: [
        'phase1-brain-prompt-interceptor',
        'phase2-cross-platform-sync',
        'phase3-pre-execution-agent',
        'phase4-visual-command-center',
        'phase4-ai-cto-mode',
        'phase4-dag-orchestrator',
        'phase4-ast-scope-locks',
        'phase5-unified-cli',
        'phase5-git-memory-loop',
      ],
      database: 'ok',
      ollama,
      counts: {
        projects, memories, nodes, edges, interactions, promptSessions, handoffs, commits, episodes,
        preExecRuns, stagedArtifacts, dagPlans,
      },
    }
    return ok(health)
  } catch (error) {
    return handleRouteError(error)
  }
}
