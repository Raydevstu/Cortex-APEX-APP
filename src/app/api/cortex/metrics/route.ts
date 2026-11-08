import { db } from '@/lib/db'
import { handleRouteError, ok } from '@/lib/cortex/api'
import type { DashboardMetrics } from '@/lib/cortex/types'

export const dynamic = 'force-dynamic'

/** GET /api/cortex/metrics — dashboard aggregates + token savings series. */
export async function GET() {
  try {
    const [projects, memories, nodes, edges, interactions, promptSessions, handoffs, commits, episodes, lastHandoff, watcherStates, preExecRuns] = await Promise.all([
      db.project.count(),
      db.memory.findMany({ select: { type: true } }),
      db.graphNode.count(),
      db.graphEdge.count(),
      db.interaction.count(),
      db.promptSession.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          tokensRaw: true,
          tokensStructured: true,
          tokensContextAvoided: true,
          durationMs: true,
          createdAt: true,
        },
      }),
      db.syncHandoff.count(),
      db.gitCommit.count(),
      db.interaction.count({ where: { embedding: { not: null } } }),
      db.syncHandoff.findFirst({ orderBy: { createdAt: 'desc' } }),
      import('@/lib/cortex/watcher').then((m) => m.watcherStatus()),
      db.preExecRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          handledLocally: true,
          tokensSavedCloud: true,
          tokensContextAvoided: true,
          stagedCount: true,
          durationMs: true,
          executionMode: true,
          createdAt: true,
        },
      }),
    ])

    const memoriesByType: Record<string, number> = {}
    for (const memory of memories) {
      memoriesByType[memory.type] = (memoriesByType[memory.type] ?? 0) + 1
    }

    const tokensRaw = promptSessions.reduce((s, p) => s + p.tokensRaw, 0)
    const tokensStructured = promptSessions.reduce((s, p) => s + p.tokensStructured, 0)
    const tokensContextAvoided = promptSessions.reduce((s, p) => s + p.tokensContextAvoided, 0)
    const avgLatencyMs =
      promptSessions.length > 0
        ? Math.round(promptSessions.reduce((s, p) => s + p.durationMs, 0) / promptSessions.length)
        : 0

    // 14-day daily series (tokens avoided + session count).
    const daily: DashboardMetrics['daily'] = []
    const today = new Date()
    for (let i = 13; i >= 0; i--) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const key = day.toISOString().slice(0, 10)
      const daySessions = promptSessions.filter(
        (p) => p.createdAt.toISOString().slice(0, 10) === key,
      )
      daily.push({
        date: key,
        tokensAvoided: daySessions.reduce((s, p) => s + p.tokensContextAvoided, 0),
        sessions: daySessions.length,
      })
    }

    const recentEvents = await db.timelineEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 12,
      include: { project: { select: { name: true, slug: true } } },
    })

    const openItems = await db.memory.findMany({
      where: { status: 'active', type: { in: ['todo', 'bug'] } },
      orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
      take: 8,
      include: { project: { select: { name: true } } },
    })

    const metrics: DashboardMetrics = {
      totals: {
        projects,
        memories: memories.length,
        memoriesByType,
        nodes,
        edges,
        interactions,
        promptSessions: promptSessions.length,
      },
      sync: {
        handoffs,
        commits,
        episodes,
        watchersRunning: watcherStates.filter((w) => w.running).length,
        lastHandoffAt: lastHandoff ? lastHandoff.createdAt.toISOString() : null,
      },
      preExec: {
        runs: preExecRuns.length,
        localOnlyRuns: preExecRuns.filter((r) => r.handledLocally).length,
        cloudTokensSaved: preExecRuns.reduce((s, r) => s + r.tokensSavedCloud, 0),
        contextTokensAvoided: preExecRuns.reduce((s, r) => s + r.tokensContextAvoided, 0),
        filesStaged: preExecRuns.reduce((s, r) => s + r.stagedCount, 0),
        avgDurationMs:
          preExecRuns.length > 0
            ? Math.round(preExecRuns.reduce((s, r) => s + r.durationMs, 0) / preExecRuns.length)
            : 0,
        lastRunAt: preExecRuns[0] ? preExecRuns[0].createdAt.toISOString() : null,
      },
      tokenSavings: {
        tokensRaw,
        tokensStructured,
        tokensContextAvoided,
        savingsPct:
          tokensContextAvoided + tokensStructured > 0
            ? Math.round(
                (tokensContextAvoided / (tokensContextAvoided + tokensStructured)) * 100,
              )
            : 0,
        avgLatencyMs,
      },
      daily,
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        kind: e.kind,
        message: e.message,
        createdAt: e.createdAt.toISOString(),
        projectName: e.project.name,
        projectSlug: e.project.slug,
      })),
      openItems: openItems.map((m) => ({
        id: m.id,
        projectId: m.projectId,
        projectName: m.project.name,
        type: m.type,
        key: m.key,
        value: m.value,
        importance: m.importance,
        createdAt: m.createdAt.toISOString(),
      })),
    }

    return ok(metrics)
  } catch (error) {
    return handleRouteError(error)
  }
}
