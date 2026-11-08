/**
 * Phase 4 — GET/POST /api/cortex/state
 * (blueprint PHASE_4 §5.1 `src/dashboard/app/api/cortex/state/route.ts`).
 *
 * GET  ?project=<id|slug>   → full CortexDashboardStateResponse (graph,
 *                             telemetry, timeline, CTO recommendations,
 *                             scope lock, <cortex_sync_packet> XML)
 * POST { action }           → TOGGLE_SYMBOL_SCOPE | SET_SCOPE_LOCK |
 *                             RESET_SCOPE_LOCK — live AST scope mutations
 *                             that recalculate the CTO recommendations.
 */
import { z } from 'zod'
import { handleRouteError, ok, parseBody } from '@/lib/cortex/api'
import { buildDashboardState, resolveDefaultProjectId, resolveProjectIdRef } from '@/lib/cortex/dashboard-state'
import { getScopeLock, resetScopeLock, setScopeLock, toggleSymbolScope } from '@/lib/cortex/scope-lock'
import { invalidateWorkspaceAudit } from '@/lib/cortex/workspace-audit'

export const dynamic = 'force-dynamic'

async function resolveProject(request: Request): Promise<string> {
  const slug = new URL(request.url).searchParams.get('project')
  if (slug && slug.trim()) return slug.trim()
  return resolveDefaultProjectId()
}

/** GET /api/cortex/state — the Visual Command Center data plane. */
export async function GET(request: Request) {
  try {
    const project = await resolveProject(request)
    const state = await buildDashboardState(project)
    return ok(state)
  } catch (error) {
    return handleRouteError(error)
  }
}

const postSchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  action: z.enum(['TOGGLE_SYMBOL_SCOPE', 'SET_SCOPE_LOCK', 'RESET_SCOPE_LOCK']),
  fqn: z.string().trim().min(1).max(400).optional(),
  allowedSymbolFqns: z.array(z.string().trim().min(1).max(400)).max(200).optional(),
  lockedSymbolFqns: z.array(z.string().trim().min(1).max(400)).max(200).optional(),
  forbiddenPaths: z.array(z.string().trim().min(1).max(400)).max(100).optional(),
})

/** POST /api/cortex/state — live AST Semantic Scope Lock mutations. */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, postSchema)
    const projectId = input.projectId
      ? await resolveProjectIdRef(input.projectId)
      : await resolveDefaultProjectId()

    if (input.action === 'TOGGLE_SYMBOL_SCOPE') {
      if (!input.fqn) {
        return ok({ error: 'TOGGLE_SYMBOL_SCOPE requires "fqn"' }, { status: 422 })
      }
      await toggleSymbolScope(projectId, input.fqn)
    } else if (input.action === 'SET_SCOPE_LOCK') {
      await setScopeLock(projectId, {
        allowedSymbolFqns: input.allowedSymbolFqns,
        lockedSymbolFqns: input.lockedSymbolFqns,
        forbiddenPaths: input.forbiddenPaths,
      })
    } else {
      await resetScopeLock(projectId)
    }

    // Scope changes can invalidate the workspace-derived audit state — the
    // recommendations must recalculate against the new lock (blueprint §8.2).
    invalidateWorkspaceAudit()
    const scopeLock = await getScopeLock(projectId)
    const state = await buildDashboardState(projectId)
    return ok({ ...state, scopeLock })
  } catch (error) {
    return handleRouteError(error)
  }
}
