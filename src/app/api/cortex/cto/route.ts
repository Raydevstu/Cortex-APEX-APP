/**
 * Phase 4 — GET/POST /api/cortex/cto
 * (blueprint PHASE_4 §2 `cto/route.ts` — AI CTO Audits, Recommendations &
 * DAG Dispatch).
 *
 * GET  ?project=<id|slug>   → live audit (recommendations + stats) and the
 *                             project's DAG plans
 * POST { action }:
 *   RUN_AUDIT       — force a fresh workspace audit (cache bypass)
 *   BUILD_DAG_PLAN  — decompose a goal into a persisted Multi-Agent DAG
 *   DISPATCH_PLAN   — execute unblocked local subtasks with the real Phase 3
 *                     tool runner + emit Tier-1 payloads for cloud subtasks
 *   UPDATE_SUBTASK  — operator confirms a cloud subtask outcome
 *   ARCHIVE_PLAN    — retire a plan
 */
import { z } from 'zod'
import { handleRouteError, ok, parseBody } from '@/lib/cortex/api'
import { resolveDefaultProjectId, resolveProjectIdRef } from '@/lib/cortex/dashboard-state'
import { AICtoEngine } from '@/orchestrator/ai-cto-engine'
import { invalidateWorkspaceAudit } from '@/lib/cortex/workspace-audit'
import type { CtoAuditResponse } from '@/lib/cortex/types'

export const dynamic = 'force-dynamic'

const engine = new AICtoEngine()

async function resolveProject(request: Request): Promise<string> {
  const slug = new URL(request.url).searchParams.get('project')
  if (slug && slug.trim()) return resolveProjectIdRef(slug.trim())
  return resolveDefaultProjectId()
}

async function resolveBodyProject(projectId?: string): Promise<string> {
  return projectId ? resolveProjectIdRef(projectId) : resolveDefaultProjectId()
}

async function buildAuditResponse(projectId: string, force = false): Promise<CtoAuditResponse> {
  const audit = await engine.auditProject(projectId, { force })
  const plans = await engine.listPlans(projectId)
  return { audit, plans }
}

/** GET /api/cortex/cto — live drift audit + DAG plan history. */
export async function GET(request: Request) {
  try {
    const projectId = await resolveProject(request)
    const force = new URL(request.url).searchParams.get('force') === 'true'
    const payload = await buildAuditResponse(projectId, force)
    return ok(payload)
  } catch (error) {
    return handleRouteError(error)
  }
}

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('RUN_AUDIT'),
    projectId: z.string().trim().min(1).optional(),
  }),
  z.object({
    action: z.literal('BUILD_DAG_PLAN'),
    projectId: z.string().trim().min(1).optional(),
    goal: z.string().trim().min(4).max(2000),
    allowedSymbolFqns: z.array(z.string().trim().min(1).max(400)).max(50).optional(),
    triggeredBy: z.enum(['manual', 'cto-recommendation']).default('manual'),
    recommendationId: z.string().trim().max(120).optional(),
  }),
  z.object({
    action: z.literal('DISPATCH_PLAN'),
    planId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal('UPDATE_SUBTASK'),
    planId: z.string().trim().min(1),
    subtaskId: z.string().trim().min(1),
    status: z.enum(['completed', 'failed', 'skipped', 'pending']),
  }),
  z.object({
    action: z.literal('ARCHIVE_PLAN'),
    planId: z.string().trim().min(1),
  }),
])

/** POST /api/cortex/cto — audit, plan build, dispatch and lifecycle. */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, postSchema)

    if (input.action === 'RUN_AUDIT') {
      const projectId = await resolveBodyProject(input.projectId)
      invalidateWorkspaceAudit()
      const payload = await buildAuditResponse(projectId, true)
      return ok({ ...payload, forced: true })
    }

    if (input.action === 'BUILD_DAG_PLAN') {
      const projectId = await resolveBodyProject(input.projectId)
      const plan = await engine.buildExecutionPlan({
        projectId,
        goal: input.goal,
        allowedSymbolFqns: input.allowedSymbolFqns,
        triggeredBy: input.triggeredBy,
        recommendationId: input.recommendationId,
      })
      return ok({ plan })
    }

    if (input.action === 'DISPATCH_PLAN') {
      const plan = await engine.dispatchPlan(input.planId)
      return ok({ plan })
    }

    if (input.action === 'UPDATE_SUBTASK') {
      const plan = await engine.updateSubtask(input.planId, input.subtaskId, input.status)
      return ok({ plan })
    }

    // ARCHIVE_PLAN
    const plan = await engine.archivePlan(input.planId)
    return ok({ plan })
  } catch (error) {
    return handleRouteError(error)
  }
}
