/**
 * Phase 4 — AI CTO Recommendation & Architectural Drift Engine
 * (blueprint PHASE_4 §4 `ai-cto-engine.ts`, adapted to the live daemon
 * contracts: SQLite property graph + Project DNA + Phase 3 telemetry).
 *
 * Everything here is grounded in real data — no decorative recommendations:
 *
 *   SCOPE_LOCK_HAZARD      live workspace scan → per-symbol cyclomatic
 *                          complexity vs. threshold, cross-checked against
 *                          the persisted AST scope lock
 *   ARCHITECTURE_DRIFT     real import statements vs. the hexagonal layer
 *                          policy (workspace-audit)
 *   COMPLEXITY_HOTSPOT     real file line counts (workspace scan, or the DNA
 *                          code map captured at scan time)
 *   TOKEN_OPTIMIZATION     live PromptSession + PreExecRun aggregates
 *                          (local offload vs. cloud escalation)
 *   UNLINKED_REQUIREMENT   stale todo/requirement memories with no graph
 *                          linkage
 *
 * Plans: `buildExecutionPlan` decomposes a goal through the multi-agent
 * orchestrator and persists a DagPlan; `dispatchPlan` executes the local
 * subtasks with the REAL Phase 3 tool runner (0 cloud tokens) and emits
 * Tier-1 execution payloads for the cloud tier.
 */
import { db } from '@/lib/db'
import { ApiError } from '@/lib/cortex/api'
import { parseDna } from '@/lib/cortex/rewrite'
import { getSettings } from '@/lib/cortex/settings'
import { getScopeLock, lockSymbols } from '@/lib/cortex/scope-lock'
import { estimateTokens } from '@/lib/cortex/tokens'
import { auditWorkspace, type WorkspaceAuditResult } from '@/lib/cortex/workspace-audit'
import { executeLocalToolStep, type LocalToolStep } from '@/lib/cortex/local-tools'
import {
  computeExecutionWaves,
  decomposeGoal,
  estimatePlanTokenSavings,
  waveIndexOf,
} from './multi-agent-orchestrator'
import type {
  AICtoRecommendation,
  DAGSubTaskRecord,
  DagPlanDTO,
  DnaDocument,
  TokenTelemetrySummary,
} from '@/lib/cortex/types'

// ---------------------------------------------------------------------------
// Policy constants (documented in docs/CORTEXOS-PHASE4.md §3)
// ---------------------------------------------------------------------------

/** Blueprint codingStandards.maxCyclomaticComplexity default. */
export const MAX_CYCLOMATIC_COMPLEXITY = 12
/** Blueprint codingStandards.maxFileLines default. */
export const MAX_FILE_LINES = 400
/** USD per 1M net tokens saved (Claude Sonnet-class input pricing baseline). */
export const COST_USD_PER_MTOKENS = 3.0
/** Local pre-execution offload target for the TOKEN_OPTIMIZATION audit. */
export const LOCAL_OFFLOAD_TARGET_PCT = 65
/** Context re-read avoided per locally-executed DAG step (Phase 3 baseline). */
export const TOKENS_AVOIDED_PER_LOCAL_STEP = 1400

// ---------------------------------------------------------------------------
// Telemetry analytics (Token Savings Engine — live aggregates)
// ---------------------------------------------------------------------------

export async function buildTokenTelemetry(projectId: string): Promise<TokenTelemetrySummary> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const [sessions, runs] = await Promise.all([
    db.promptSession.findMany({
      where: { projectId },
      select: { tokensRaw: true, tokensStructured: true, tokensContextAvoided: true, engine: true, createdAt: true },
    }),
    db.preExecRun.findMany({
      where: { projectId },
      select: { tokensSavedCloud: true, tokensContextAvoided: true, handledLocally: true, injectedPrompt: true, createdAt: true },
    }),
  ])

  let rawContextTokensEstimated = 0
  let injectedSyncPacketTokens = 0
  let netTokensSaved = 0
  let localOffload = 0
  let cloudEscalation = 0

  const byDay = new Map<string, { rawTokens: number; optimizedTokens: number; localExecutions: number }>()

  const dayKey = (date: Date): string => date.toISOString().slice(0, 10)
  const bucket = (date: Date) => {
    const key = dayKey(date)
    let entry = byDay.get(key)
    if (!entry) {
      entry = { rawTokens: 0, optimizedTokens: 0, localExecutions: 0 }
      byDay.set(key, entry)
    }
    return entry
  }

  for (const session of sessions) {
    rawContextTokensEstimated += session.tokensRaw + session.tokensContextAvoided
    injectedSyncPacketTokens += session.tokensStructured
    netTokensSaved += session.tokensContextAvoided
    const isLocal = session.engine !== 'cloud'
    if (isLocal) localOffload += 1
    else cloudEscalation += 1
    if (session.createdAt >= since) {
      const entry = bucket(session.createdAt)
      entry.rawTokens += session.tokensRaw + session.tokensContextAvoided
      entry.optimizedTokens += session.tokensStructured
      if (isLocal) entry.localExecutions += 1
    }
  }

  for (const run of runs) {
    rawContextTokensEstimated += run.tokensContextAvoided
    injectedSyncPacketTokens += estimateTokens(run.injectedPrompt ?? '')
    netTokensSaved += run.tokensSavedCloud + run.tokensContextAvoided
    if (run.handledLocally) localOffload += 1
    else cloudEscalation += 1
    if (run.createdAt >= since) {
      const entry = bucket(run.createdAt)
      entry.rawTokens += run.tokensContextAvoided
      entry.optimizedTokens += estimateTokens(run.injectedPrompt ?? '')
      if (run.handledLocally) entry.localExecutions += 1
    }
  }

  const totalPromptsIntercepted = sessions.length + runs.length
  const compressionRatioPct =
    rawContextTokensEstimated > 0
      ? Math.max(0, Math.min(99.9, (1 - injectedSyncPacketTokens / rawContextTokensEstimated) * 100))
      : 0
  const totalTurns = localOffload + cloudEscalation

  return {
    totalPromptsIntercepted,
    rawContextTokensEstimated,
    injectedSyncPacketTokens,
    netTokensSaved,
    compressionRatioPct: Math.round(compressionRatioPct * 10) / 10,
    estimatedCostSavingsUsd: Math.round((netTokensSaved / 1_000_000) * COST_USD_PER_MTOKENS * 100) / 100,
    pricingUsdPerMTokens: COST_USD_PER_MTOKENS,
    localOllamaOffloadCount: localOffload,
    cloudEscalationCount: cloudEscalation,
    localOffloadPct: totalTurns > 0 ? Math.round((localOffload / totalTurns) * 1000) / 10 : 0,
    historyByDay: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, entry]) => ({ date, ...entry })),
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface CtoAuditResult {
  projectId: string
  projectName: string
  scannedAt: string
  recommendations: AICtoRecommendation[]
  stats: {
    symbolsScanned: number
    filesScanned: number
    layerViolations: number
    complexityHotspots: number
    workspaceRoot: string | null
    cache: 'hit' | 'miss'
  }
}

export class AICtoEngine {
  /** Audit the live graph, memories, scope lock and telemetry against the
   *  Project DNA rules. Deterministic: same state → same recommendations. */
  async auditProject(projectId: string, options: { force?: boolean } = {}): Promise<CtoAuditResult> {
    const project = await db.project.findUnique({
      where: { id: projectId },
      include: {
        dna: true,
        memories: { take: 500, orderBy: { createdAt: 'desc' } },
        graphNodes: { take: 400 },
      },
    })
    if (!project) throw new ApiError('Project not found', 404)

    const [scopeLock, telemetry] = await Promise.all([
      getScopeLock(project.id),
      buildTokenTelemetry(project.id),
    ])

    const dna: DnaDocument | null = project.dna ? parseDna(project.dna) : null
    const workspace = project.rootPath
      ? await auditWorkspace(project.rootPath, { force: options.force })
      : null
    const scan = workspace?.result ?? null

    const recommendations: AICtoRecommendation[] = []

    // ---- 1. SCOPE_LOCK_HAZARD: unlocked high-complexity symbols ----------
    if (scan) {
      const hot = scan.symbols
        .filter(
          (sym) =>
            sym.complexity > MAX_CYCLOMATIC_COMPLEXITY &&
            !scopeLock.lockedSymbolFqns.includes(sym.fqn),
        )
        .sort((a, b) => b.complexity - a.complexity)
        .slice(0, 3)
      for (const sym of hot) {
        const inScope = scopeLock.allowedSymbolFqns.includes(sym.fqn)
        recommendations.push({
          id: `cto-rec-lock-${slugId(sym.fqn)}`,
          category: 'SCOPE_LOCK_HAZARD',
          severity: inScope ? 'CRITICAL' : 'HIGH',
          title: `Lock high-complexity symbol: ${sym.name} (complexity ${sym.complexity})`,
          rationale:
            `Symbol '${sym.fqn}' (lines ${sym.line}–${sym.endLine}) has cyclomatic complexity ${sym.complexity} ` +
            `(threshold: ${MAX_CYCLOMATIC_COMPLEXITY}) and is ${inScope ? 'currently IN the active write scope' : 'not explicitly locked'}. ` +
            `Lock it so the PreToolUse sentinel blocks accidental mutations during the next agent turn.`,
          impactedSymbols: [sym.fqn],
          suggestedAction: {
            actionType: 'LOCK_SYMBOLS',
            commandPreview: `cortexos scope --lock "${sym.fqn}"`,
            estimatedTokenSavings: TOKENS_AVOIDED_PER_LOCAL_STEP,
          },
        })
      }
    }

    // ---- 2. ARCHITECTURE_DRIFT: cross-layer import violations -------------
    if (scan) {
      for (const violation of scan.violations.slice(0, 3)) {
        recommendations.push({
          id: `cto-rec-drift-${slugId(`${violation.from}|${violation.to}`)}`,
          category: 'ARCHITECTURE_DRIFT',
          severity: 'CRITICAL',
          title: `Layer boundary violation: ${violation.fromLayer} → ${violation.toLayer}`,
          rationale:
            `'${violation.from}' imports '${violation.to}' directly. ${violation.rule}. ` +
            `Ratify an ADR so the boundary is enforced in every future session.`,
          impactedSymbols: [violation.from, violation.to],
          suggestedAction: {
            actionType: 'RATIFY_ADR',
            commandPreview: `cortexos adr --enforce-boundary ${violation.fromLayer}->${violation.toLayer}`,
          },
        })
      }
    }

    // ---- 3. COMPLEXITY_HOTSPOT: oversized files ----------------------------
    const fileCandidates = scan
      ? scan.files.map((f) => ({ path: f.path, lines: f.lines }))
      : (dna?.fileStats.codeMap ?? []).map((f) => ({ path: f.path, lines: f.lines }))
    const oversized = fileCandidates
      .filter((f) => f.lines > MAX_FILE_LINES)
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 3)
    for (const file of oversized) {
      recommendations.push({
        id: `cto-rec-hotspot-${slugId(file.path)}`,
        category: 'COMPLEXITY_HOTSPOT',
        severity: file.lines > MAX_FILE_LINES * 2 ? 'HIGH' : 'MEDIUM',
        title: `Complexity hotspot: ${file.path} (${file.lines} lines)`,
        rationale:
          `'${file.path}' has ${file.lines} lines (threshold: ${MAX_FILE_LINES}). ` +
          `Split it through the local pre-execution agent before the next feature lands on top of it.`,
        impactedSymbols: [file.path],
        suggestedAction: {
          actionType: 'REFACTOR_LOCAL',
          commandPreview: `cortexos orchestrate --task refactor --file "${file.path}"`,
          estimatedTokenSavings: 1800,
        },
      })
    }

    // ---- 4. TOKEN_OPTIMIZATION: local offload below target ----------------
    if (telemetry.totalPromptsIntercepted > 0 && telemetry.localOffloadPct < LOCAL_OFFLOAD_TARGET_PCT) {
      const settings = await getSettings()
      const avgSavingPerTurn = telemetry.netTokensSaved / Math.max(1, telemetry.totalPromptsIntercepted)
      const estimate = Math.round(avgSavingPerTurn * telemetry.cloudEscalationCount * 0.35)
      recommendations.push({
        id: 'cto-rec-local-offload',
        category: 'TOKEN_OPTIMIZATION',
        severity: 'OPTIMIZATION',
        title: `Increase local pre-execution offload (${telemetry.localOffloadPct.toFixed(1)}% → ${LOCAL_OFFLOAD_TARGET_PCT}%)`,
        rationale:
          `${telemetry.cloudEscalationCount} of ${telemetry.totalPromptsIntercepted} intercepted turns escalated to the paid cloud tier. ` +
          `Routing contract validation, AST diffs and test scaffolding through '${settings.ollamaRouterModel}' first ` +
          `(pre-execution agent) removes that context from every cloud prompt.`,
        impactedSymbols: ['src/lib/cortex/preexec.ts#runPreExecution'],
        suggestedAction: {
          actionType: 'REFACTOR_LOCAL',
          commandPreview: `cortexos router --set-threshold 0.72 --model ${settings.ollamaRouterModel}`,
          estimatedTokenSavings: estimate > 0 ? estimate : 680,
        },
      })
    }

    // ---- 5. UNLINKED_REQUIREMENT: stale, unlinked open items --------------
    const nodeLabels = project.graphNodes.map((n) => n.label.toLowerCase()).join(' | ')
    const staleCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
    const stale = project.memories
      .filter((m) => {
        if (m.status !== 'active') return false
        if (m.type !== 'todo' && m.type !== 'requirement') return false
        if (m.createdAt.getTime() >= staleCutoff) return false
        const words = m.key.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4)
        return !words.some((w) => nodeLabels.includes(w))
      })
      .slice(0, 2)
    for (const memory of stale) {
      recommendations.push({
        id: `cto-rec-unlinked-${memory.id}`,
        category: 'UNLINKED_REQUIREMENT',
        severity: 'MEDIUM',
        title: `Unlinked requirement: ${memory.key}`,
        rationale:
          `'${memory.key}' has been open since ${memory.createdAt.toISOString().slice(0, 10)} with no matching ` +
          `Knowledge Graph node. Ratify it as a decision (ADR) or close it so the sync packet stays honest.`,
        impactedSymbols: [],
        suggestedAction: {
          actionType: 'RATIFY_ADR',
          commandPreview: `cortexos memory --triage ${memory.id}`,
        },
      })
    }

    // ---- 6. Blueprint fallback: decompose the active scope ----------------
    if (recommendations.length < 3) {
      const settings = await getSettings()
      recommendations.push({
        id: 'cto-rec-dag-precompile',
        category: 'COMPLEXITY_HOTSPOT',
        severity: 'MEDIUM',
        title: 'Decompose active scope into local + cloud DAG subtasks',
        rationale:
          `Active task scope covers ${scopeLock.allowedSymbolFqns.length} unlocked symbol(s) ` +
          `(${telemetry.localOllamaOffloadCount} local / ${telemetry.cloudEscalationCount} cloud turns so far). ` +
          `Splitting contract validation & test scaffolding to local Ollama (${settings.ollamaRouterModel}) ` +
          `before cloud execution prevents context bloat.`,
        impactedSymbols: scopeLock.allowedSymbolFqns.slice(0, 6),
        suggestedAction: {
          actionType: 'DECOMPOSE_DAG',
          commandPreview: 'cortexos orchestrate --task active --split-local-tests',
          estimatedTokenSavings: 3 * TOKENS_AVOIDED_PER_LOCAL_STEP,
        },
      })
    }

    return {
      projectId: project.id,
      projectName: project.name,
      scannedAt: new Date().toISOString(),
      recommendations,
      stats: {
        symbolsScanned: scan?.symbols.length ?? 0,
        filesScanned: scan?.files.length ?? dna?.fileStats.codeMap.length ?? 0,
        layerViolations: scan?.violations.length ?? 0,
        complexityHotspots:
          (scan?.symbols.filter((s) => s.complexity > MAX_CYCLOMATIC_COMPLEXITY).length ?? 0) + oversized.length,
        workspaceRoot: project.rootPath,
        cache: workspace?.cache ?? 'miss',
      },
    }
  }

  /** Apply the AI CTO `LOCK_SYMBOLS` recommendation (real scope mutation). */
  async applyLockSymbols(projectId: string, fqns: string[]): Promise<void> {
    await lockSymbols(projectId, fqns)
  }

  // -------------------------------------------------------------------------
  // Execution plans (DAG)
  // -------------------------------------------------------------------------

  async buildExecutionPlan(input: {
    projectId: string
    goal: string
    allowedSymbolFqns?: string[]
    triggeredBy?: string
    recommendationId?: string
  }): Promise<DagPlanDTO> {
    const goal = input.goal.trim()
    if (goal.length < 4) throw new ApiError('goal must describe the feature to decompose (min 4 chars)', 422)

    const project = await db.project.findUnique({ where: { id: input.projectId }, include: { dna: true } })
    if (!project) throw new ApiError('Project not found', 404)

    const scopeLock = await getScopeLock(project.id)
    const knownSymbolFqns = await collectKnownSymbols(project.id, project.rootPath)

    const plan = await decomposeGoal(goal, {
      projectId: project.id,
      projectName: project.name,
      knownSymbolFqns,
      allowedSymbolFqns: input.allowedSymbolFqns ?? scopeLock.allowedSymbolFqns,
    })

    const subtasks: DAGSubTaskRecord[] = plan.subtasks.map((task) => ({
      ...task,
      status: 'pending' as const,
    }))

    const row = await db.dagPlan.create({
      data: {
        projectId: project.id,
        goal,
        status: 'draft',
        subtasks: JSON.stringify(subtasks),
        waves: JSON.stringify(plan.waves),
        auditMeta: JSON.stringify({
          triggeredBy: input.triggeredBy ?? 'manual',
          recommendationId: input.recommendationId,
          estimatedTokenSavings: estimatePlanTokenSavings(plan.subtasks),
        }),
      },
    })

    await db.timelineEvent.create({
      data: {
        projectId: project.id,
        kind: 'dag.plan_created',
        message: `AI CTO decomposed "${shorten(goal, 90)}" into ${subtasks.length} DAG subtasks across ${plan.waves.length} waves.`,
        meta: JSON.stringify({ planId: row.id, waves: plan.waves.length, intent: plan.intent }),
      },
    })

    return toPlanDTO(row, project.name)
  }

  /**
   * Dispatch a plan: executes every currently-unblocked LOCAL subtask with
   * the real Phase 3 tool runner (0 cloud tokens) and marks cloud subtasks
   * as `dispatched` with their Tier-1 execution payload attached. Repeat
   * calls pick up subtasks unblocked by operator-confirmed cloud completions.
   */
  async dispatchPlan(planId: string): Promise<DagPlanDTO> {
    const row = await db.dagPlan.findUnique({ where: { id: planId }, include: { project: { include: { dna: true } } } })
    if (!row) throw new ApiError('DAG plan not found', 404)
    if (row.status === 'archived') throw new ApiError('Plan is archived — build a new plan instead', 409)

    const subtasks = JSON.parse(row.subtasks) as DAGSubTaskRecord[]
    const waves = JSON.parse(row.waves) as string[][]
    // Validate the persisted DAG still resolves (defence against tampering).
    computeExecutionWaves(subtasks)

    const project = row.project
    const dna = project.dna ? parseDna(project.dna) : null
    let executedLocal = 0
    let dispatchedCloud = 0

    if (row.status === 'draft') {
      for (const task of subtasks) task.status = 'pending'
    }

    for (let wave = 0; wave < waves.length; wave++) {
      for (const task of subtasks) {
        if (task.wave !== wave + 1) continue
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'skipped') continue
        const depsDone = task.dependencies.every((dep) => {
          const depTask = subtasks.find((s) => s.id === dep)
          // `skipped` dependencies no longer block downstream waves (e.g.
          // local tools unavailable without a workspace rootPath); `failed`
          // and still-`pending`/`dispatched` dependencies do.
          return depTask?.status === 'completed' || depTask?.status === 'skipped'
        })
        if (!depsDone) continue

        if (task.agentKind === 'local') {
          const started = Date.now()
          if (!project.rootPath) {
            task.status = 'skipped'
            task.resultSummary = 'Local execution unavailable — the project has no workspace rootPath.'
            continue
          }
          const steps = localStepsFor(task)
          const artifacts: Array<{ toolName: string; ok: boolean; summary: string }> = []
          for (const step of steps) {
            const artifact = await executeLocalToolStep(step, {
              projectId: project.id,
              rootPath: project.rootPath,
              dna,
            })
            artifacts.push({ toolName: artifact.toolName, ok: artifact.ok, summary: artifact.summary })
          }
          task.artifacts = artifacts
          task.durationMs = Date.now() - started
          task.tokensSavedEstimate = TOKENS_AVOIDED_PER_LOCAL_STEP
          if (artifacts.length > 0 && artifacts.every((a) => a.ok)) {
            task.status = 'completed'
            task.resultSummary = `Executed locally (0 cloud tokens): ${artifacts.map((a) => a.summary).join(' · ').slice(0, 220)}`
            executedLocal += 1
          } else if (artifacts.length > 0) {
            task.status = 'failed'
            task.resultSummary = `Local tools reported failures: ${artifacts.filter((a) => !a.ok).map((a) => a.summary).join(' · ').slice(0, 220)}`
          } else {
            task.status = 'skipped'
            task.resultSummary = 'No local tools mapped for this subtask.'
          }
        } else {
          // Cloud tier — deterministic Tier-1 execution payload for the
          // target agent (scope-locked, pre-execution aware).
          const scopeLock = await getScopeLock(project.id)
          const settings = await getSettings()
          task.payload = buildCloudPayload({
            projectName: project.name,
            cloudModel: settings.cloudEscalationModel,
            goal: row.goal,
            subtask: task,
            allowedSymbolFqns: task.allowedSymbolFqns.length > 0 ? task.allowedSymbolFqns : scopeLock.allowedSymbolFqns,
            forbiddenPaths: scopeLock.forbiddenPaths,
            constraints: dna
              ? [...dna.codingStandards.slice(0, 3).map((s) => s.rule), ...dna.businessRules.slice(0, 2)]
              : ['No DNA generated — keep changes minimal and reversible.'],
          })
          task.status = 'dispatched'
          task.resultSummary = `Tier-1 payload ready for ${task.assignedAgent} — paste it into the cloud agent, then mark the subtask completed.`
          dispatchedCloud += 1
        }
      }
    }

    const allSettled = subtasks.every((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'skipped')
    const nextStatus = allSettled ? 'completed' : 'dispatched'

    const updated = await db.dagPlan.update({
      where: { id: row.id },
      data: { subtasks: JSON.stringify(subtasks), status: nextStatus },
    })

    if (executedLocal > 0 || dispatchedCloud > 0 || row.status === 'draft') {
      await db.timelineEvent.create({
        data: {
          projectId: row.projectId,
          kind: 'dag.dispatched',
          message: `DAG dispatch "${shorten(row.goal, 70)}": ${executedLocal} local subtask(s) executed, ${dispatchedCloud} cloud payload(s) emitted.`,
          meta: JSON.stringify({ planId: row.id, executedLocal, dispatchedCloud, status: nextStatus }),
        },
      })
    }

    return toPlanDTO(updated, project.name)
  }

  /** Operator confirms a cloud subtask outcome (unblocks dependent waves). */
  async updateSubtask(planId: string, subtaskId: string, status: 'completed' | 'failed' | 'skipped' | 'pending'): Promise<DagPlanDTO> {
    const row = await db.dagPlan.findUnique({ where: { id: planId }, include: { project: true } })
    if (!row) throw new ApiError('DAG plan not found', 404)
    if (row.status === 'archived') throw new ApiError('Plan is archived', 409)

    const subtasks = JSON.parse(row.subtasks) as DAGSubTaskRecord[]
    const task = subtasks.find((s) => s.id === subtaskId)
    if (!task) throw new ApiError(`Subtask "${subtaskId}" not found in this plan`, 404)
    task.status = status

    const allSettled = subtasks.every((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'skipped')
    const nextStatus = allSettled ? 'completed' : row.status === 'draft' ? 'draft' : 'dispatched'

    const updated = await db.dagPlan.update({
      where: { id: row.id },
      data: { subtasks: JSON.stringify(subtasks), status: nextStatus },
    })
    if (allSettled && row.status !== 'completed') {
      await db.timelineEvent.create({
        data: {
          projectId: row.projectId,
          kind: 'dag.completed',
          message: `DAG plan "${shorten(row.goal, 70)}" fully settled — all subtasks reached a terminal state.`,
          meta: JSON.stringify({ planId: row.id }),
        },
      })
    }
    return toPlanDTO(updated, row.project.name)
  }

  async archivePlan(planId: string): Promise<DagPlanDTO> {
    const row = await db.dagPlan.findUnique({ where: { id: planId }, include: { project: true } })
    if (!row) throw new ApiError('DAG plan not found', 404)
    const updated = await db.dagPlan.update({ where: { id: planId }, data: { status: 'archived' } })
    return toPlanDTO(updated, row.project.name)
  }

  async listPlans(projectId: string, take = 10): Promise<DagPlanDTO[]> {
    const [rows, project] = await Promise.all([
      db.dagPlan.findMany({ where: { projectId, status: { not: 'archived' } }, orderBy: { createdAt: 'desc' }, take }),
      db.project.findUnique({ where: { id: projectId }, select: { name: true } }),
    ])
    return rows.map((row) => toPlanDTO(row, project?.name ?? 'Project'))
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toPlanDTO(
  row: {
    id: string
    projectId: string
    goal: string
    status: string
    subtasks: string
    waves: string
    auditMeta: string
    createdAt: Date
    updatedAt: Date
  },
  projectName: string,
): DagPlanDTO {
  let subtasks: DAGSubTaskRecord[] = []
  let waves: string[][] = []
  let auditMeta: DagPlanDTO['auditMeta'] = {}
  try {
    subtasks = JSON.parse(row.subtasks) as DAGSubTaskRecord[]
    waves = JSON.parse(row.waves) as string[][]
    auditMeta = JSON.parse(row.auditMeta) as DagPlanDTO['auditMeta']
  } catch {
    // Corrupt JSON should never happen (written only by this engine) — but
    // never let it take the dashboard down.
  }
  const status = (['draft', 'dispatched', 'completed', 'archived'] as const).includes(
    row.status as DagPlanDTO['status'],
  )
    ? (row.status as DagPlanDTO['status'])
    : 'draft'
  return {
    id: row.id,
    projectId: row.projectId,
    projectName,
    goal: row.goal,
    status,
    subtasks,
    waves,
    auditMeta,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function collectKnownSymbols(projectId: string, rootPath: string | null): Promise<string[]> {
  if (rootPath) {
    const { result } = await auditWorkspace(rootPath)
    return [...result.symbols].sort((a, b) => b.complexity - a.complexity).slice(0, 40).map((s) => s.fqn)
  }
  const fileNodes = await db.graphNode.findMany({ where: { projectId, kind: 'file' }, take: 40 })
  return fileNodes.map((n) => n.label)
}

/** Deterministic local tool plan per canonical DAG subtask. */
function localStepsFor(task: DAGSubTaskRecord): LocalToolStep[] {
  const firstFile = task.allowedSymbolFqns.map((fqn) => fqn.split('#')[0]).find((p) => p.includes('.'))
  switch (task.id) {
    case 'subtask-1-contract-validation':
      return [
        ...(firstFile
          ? [{ stepId: 's1-ast', toolName: 'ast_symbol_lookup' as const, toolArgs: { filePath: firstFile }, expectedArtifact: 'symbol table' }]
          : []),
        { stepId: 's1-schema', toolName: 'schema_inspect' as const, toolArgs: {}, expectedArtifact: 'prisma model inventory' },
      ]
    case 'subtask-3-tdd-verification':
      return [
        { stepId: 's3-docs', toolName: 'local_docs_search' as const, toolArgs: { query: 'unit test zod validation' }, expectedArtifact: 'docs sections' },
        ...(firstFile
          ? [{ stepId: 's3-ast', toolName: 'ast_symbol_lookup' as const, toolArgs: { filePath: firstFile }, expectedArtifact: 'symbol table' }]
          : []),
      ]
    case 'subtask-4-continuity-sync':
      return [{ stepId: 's4-git', toolName: 'git_diff_summary' as const, toolArgs: {}, expectedArtifact: 'workspace diff summary' }]
    default:
      return [
        { stepId: 'sN-git', toolName: 'git_diff_summary' as const, toolArgs: {}, expectedArtifact: 'workspace diff summary' },
        ...(firstFile
          ? [{ stepId: 'sN-ast', toolName: 'ast_symbol_lookup' as const, toolArgs: { filePath: firstFile }, expectedArtifact: 'symbol table' }]
          : []),
      ]
  }
}

/** Deterministic Tier-1 execution payload for a cloud-assigned subtask
 *  (blueprint Part 2 section markers, scope-locked). */
function buildCloudPayload(input: {
  projectName: string
  cloudModel: string
  goal: string
  subtask: DAGSubTaskRecord
  allowedSymbolFqns: string[]
  forbiddenPaths: string[]
  constraints: string[]
}): string {
  const { projectName, cloudModel, goal, subtask, allowedSymbolFqns, forbiddenPaths, constraints } = input
  const lines: string[] = []
  lines.push(`[CORTEX-OS SYNC | Project: ${projectName} | DAG: ${subtask.id} | Target: ${cloudModel}]`)
  lines.push('[PRE-EXECUTED BY CORTEX LOCAL AGENT — DO NOT REGENERATE]')
  lines.push('[AST SCOPE GUARD & ARCHITECTURE LOCK]')
  lines.push('  Allowed writes (symbols):')
  for (const fqn of allowedSymbolFqns.slice(0, 10)) lines.push(`    - ${fqn}`)
  if (allowedSymbolFqns.length === 0) lines.push('    - (scope defined by the active task — stay minimal)')
  lines.push('  Protected paths (NEVER touch):')
  for (const p of forbiddenPaths.slice(0, 8)) lines.push(`    - ${p}`)
  lines.push('  Immutable constraints:')
  for (const c of constraints.slice(0, 5)) lines.push(`    - ${c}`)
  lines.push('[CORE EXECUTION SPECIFICATION FOR CLOUD AGENT]')
  lines.push(`  Goal: ${goal}`)
  lines.push(`  Subtask: ${subtask.title} (wave ${subtask.wave})`)
  lines.push(`  ${subtask.prompt.replace(/\n/g, '\n  ')}`)
  lines.push('[VERIFICATION CRITERIA]')
  lines.push('  - Every edit stays inside the allowed symbols above.')
  lines.push('  - No protected path is read-modified-written.')
  lines.push('  - On completion, report the touched files so cortex_log_decision can sync every platform.')
  return lines.join('\n')
}

function slugId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'x'
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}
