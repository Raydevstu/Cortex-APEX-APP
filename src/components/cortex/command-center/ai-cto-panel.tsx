'use client'

/**
 * Phase 4 — AI CTO Mode Panel (blueprint PHASE_4 §1.4 + §7 `AICtoPanel`).
 *
 * Live architectural drift advisories with one-click actions:
 *   LOCK_SYMBOLS  → real AST scope-lock mutation
 *   DECOMPOSE_DAG → build + dispatch the Multi-Agent Execution DAG
 *   RATIFY_ADR    → create the decision memory
 *   REFACTOR_LOCAL→ hand off to the Prompt Studio pre-exec cockpit
 *
 * Plus the persisted DAG plan board: waves, subtask statuses, executed local
 * artifacts (real tool runs), Tier-1 cloud payloads and lifecycle controls.
 */
import { useState } from 'react'
import {
  BadgeCheck, Ban, Bot, BrainCircuit, ChevronDown, CircleDot, Cloud, Cpu, Loader2,
  Lock, Play, RefreshCw, ShieldAlert, Siren, Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cortexApi } from '@/lib/cortex-client'
import type { AICtoRecommendation, CtoAuditResponse, DagPlanDTO } from '@/lib/cortex/types'
import { cn } from '@/lib/utils'
import { CopyButton, timeAgo } from '../shared'
import { toast } from 'sonner'

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'border-rose-500/40 bg-rose-500/10 text-rose-400',
  HIGH: 'border-orange-500/40 bg-orange-500/10 text-orange-400',
  MEDIUM: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  OPTIMIZATION: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  ARCHITECTURE_DRIFT: <Siren className="size-3.5" />,
  SCOPE_LOCK_HAZARD: <ShieldAlert className="size-3.5" />,
  TOKEN_OPTIMIZATION: <Cpu className="size-3.5" />,
  COMPLEXITY_HOTSPOT: <BrainCircuit className="size-3.5" />,
  UNLINKED_REQUIREMENT: <CircleDot className="size-3.5" />,
}

export interface AICtoPanelProps {
  projectId: string
  recommendations: AICtoRecommendation[]
  plans: DagPlanDTO[]
  auditStats?: CtoAuditResponse['audit']['stats']
  auditScannedAt?: string
  /** Refresh the parent state after a mutation. */
  onRefresh: () => void
  /** Open the Prompt Studio with a prefilled goal (REFACTOR_LOCAL). */
  onDelegateToStudio: (prompt: string) => void
}

export function AICtoPanel({
  projectId,
  recommendations,
  plans,
  auditStats,
  auditScannedAt,
  onRefresh,
  onDelegateToStudio,
}: AICtoPanelProps) {
  const [goal, setGoal] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [auditing, setAuditing] = useState(false)
  const [openPlanId, setOpenPlanId] = useState<string | null>(null)

  async function runAudit() {
    setAuditing(true)
    try {
      await cortexApi.ctoAudit(projectId, true)
      onRefresh()
      toast.success('AI CTO audit refreshed', { description: 'Workspace symbols, boundaries and telemetry re-scanned.' })
    } catch (error) {
      toast.error('Audit failed', { description: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setAuditing(false)
    }
  }

  async function applyRecommendation(rec: AICtoRecommendation) {
    setBusyAction(rec.id)
    try {
      if (rec.suggestedAction.actionType === 'LOCK_SYMBOLS') {
        await cortexApi.toggleSymbolScope(rec.impactedSymbols[0], projectId)
        toast.success('Symbol locked', { description: `${rec.impactedSymbols[0]} is now sentinel-protected.` })
        onRefresh()
      } else if (rec.suggestedAction.actionType === 'RATIFY_ADR') {
        await cortexApi.createMemory({
          projectId,
          type: 'decision',
          key: rec.title.replace(/^(Lock high-complexity symbol|Unlinked requirement|Layer boundary violation):\s*/i, '').slice(0, 80),
          value: `${rec.rationale} — ratified from AI CTO advisory ${rec.id} (${rec.suggestedAction.commandPreview}).`,
          importance: rec.severity === 'CRITICAL' ? 5 : 4,
        })
        toast.success('ADR ratified', { description: 'Decision memory created and linked to the sync packet.' })
        onRefresh()
      } else if (rec.suggestedAction.actionType === 'DECOMPOSE_DAG') {
        const { plan } = await cortexApi.ctoBuildPlan({
          projectId,
          goal: rec.impactedSymbols.length > 0
            ? `${rec.title} — scope: ${rec.impactedSymbols.slice(0, 4).join(', ')}`
            : rec.title,
          triggeredBy: 'cto-recommendation',
          recommendationId: rec.id,
        })
        await cortexApi.ctoDispatchPlan(plan.id)
        toast.success('DAG dispatched', { description: `Plan ${plan.id.slice(0, 8)} — local subtasks executed, cloud payload ready.` })
        onRefresh()
      } else {
        // REFACTOR_LOCAL → Prompt Studio pre-exec cockpit
        onDelegateToStudio(`${rec.title}. ${rec.suggestedAction.commandPreview}`)
      }
    } catch (error) {
      toast.error('Action failed', { description: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setBusyAction(null)
    }
  }

  async function buildAndDispatch() {
    const trimmed = goal.trim()
    if (trimmed.length < 4) {
      toast.error('Describe the goal first', { description: 'The DAG decomposer needs a feature goal (min 4 characters).' })
      return
    }
    setBusyAction('build-plan')
    try {
      const { plan } = await cortexApi.ctoBuildPlan({ projectId, goal: trimmed })
      await cortexApi.ctoDispatchPlan(plan.id)
      setGoal('')
      setOpenPlanId(plan.id)
      toast.success('DAG plan dispatched', { description: `${plan.subtasks.length} subtasks across ${plan.waves.length} waves.` })
      onRefresh()
    } catch (error) {
      toast.error('Plan failed', { description: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setBusyAction(null)
    }
  }

  async function subtaskAction(planId: string, subtaskId: string, status: 'completed' | 'failed' | 'skipped') {
    setBusyAction(`${planId}:${subtaskId}`)
    try {
      await cortexApi.ctoUpdateSubtask(planId, subtaskId, status)
      onRefresh()
    } catch (error) {
      toast.error('Subtask update failed', { description: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setBusyAction(null)
    }
  }

  async function reDispatch(planId: string) {
    setBusyAction(`redispatch:${planId}`)
    try {
      await cortexApi.ctoDispatchPlan(planId)
      toast.success('Dispatch pass complete', { description: 'Newly unblocked local subtasks executed.' })
      onRefresh()
    } catch (error) {
      toast.error('Dispatch failed', { description: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setBusyAction(null)
    }
  }

  async function archive(planId: string) {
    setBusyAction(`archive:${planId}`)
    try {
      await cortexApi.ctoArchivePlan(planId)
      onRefresh()
    } catch (error) {
      toast.error('Archive failed', { description: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* ---- Advisories -------------------------------------------------- */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <BrainCircuit className="size-3.5 text-primary" /> Live advisories
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">{recommendations.length}</span>
          </p>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={runAudit} disabled={auditing}>
            {auditing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            Re-run audit
          </Button>
        </div>

        {auditStats ? (
          <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
            scanned {auditScannedAt ? timeAgo(auditScannedAt) : '—'} · {auditStats.symbolsScanned} symbols · {auditStats.filesScanned} files ·{' '}
            {auditStats.layerViolations} boundary violations
            {auditStats.workspaceRoot ? ` · ${auditStats.workspaceRoot}` : ' · no workspace root (DNA-based audit)'}
          </p>
        ) : null}

        <div className="mt-3 space-y-2.5">
          {recommendations.map((rec) => (
            <div key={rec.id} className="rounded-lg border border-border/60 bg-card/70 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="flex items-center gap-2">
                  <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold', SEVERITY_STYLES[rec.severity])}>
                    [{rec.severity}]
                  </span>
                  <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {CATEGORY_ICONS[rec.category]} {rec.category.replace(/_/g, ' ')}
                  </span>
                </span>
                {rec.suggestedAction.estimatedTokenSavings ? (
                  <span className="font-mono text-[10px] text-emerald-500">est. ~{rec.suggestedAction.estimatedTokenSavings.toLocaleString()} tokens saved</span>
                ) : null}
              </div>
              <p className="mt-1.5 text-[13px] font-medium leading-snug">{rec.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{rec.rationale}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted/50 px-2 py-1 font-mono text-[10px] text-primary">
                  $ {rec.suggestedAction.commandPreview}
                </code>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 text-[11px]"
                  disabled={busyAction === rec.id}
                  onClick={() => applyRecommendation(rec)}
                >
                  {busyAction === rec.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : rec.suggestedAction.actionType === 'LOCK_SYMBOLS' ? (
                    <Lock className="size-3" />
                  ) : rec.suggestedAction.actionType === 'DECOMPOSE_DAG' ? (
                    <Wand2 className="size-3" />
                  ) : rec.suggestedAction.actionType === 'RATIFY_ADR' ? (
                    <BadgeCheck className="size-3" />
                  ) : (
                    <Cpu className="size-3" />
                  )}
                  {rec.suggestedAction.actionType === 'LOCK_SYMBOLS'
                    ? 'Lock now'
                    : rec.suggestedAction.actionType === 'DECOMPOSE_DAG'
                      ? 'Decompose & dispatch'
                      : rec.suggestedAction.actionType === 'RATIFY_ADR'
                        ? 'Ratify ADR'
                        : 'Delegate to Studio'}
                </Button>
              </div>
            </div>
          ))}
          {recommendations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-emerald-500/40 bg-emerald-500/5 px-4 py-6 text-center">
              <p className="text-sm font-medium text-emerald-500">Architecture is clean</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No drift, unlocked hotspots or token regressions detected in this audit pass.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* ---- DAG decomposer ---------------------------------------------- */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3.5">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Wand2 className="size-3.5 text-primary" /> Multi-agent DAG decomposer
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void buildAndDispatch()
            }}
            placeholder="Feature goal, e.g. add usage-based billing to the workspace API"
            className="min-w-0 flex-1 rounded-md border border-border/70 bg-background px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-primary/50"
          />
          <Button size="sm" className="gap-1.5" onClick={buildAndDispatch} disabled={busyAction === 'build-plan'}>
            {busyAction === 'build-plan' ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Build & dispatch
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Contracts & tests route to the local Ollama tier (0 cloud tokens); the core implementation gets a scope-locked Tier-1 payload for the cloud agent.
        </p>
      </div>

      {/* ---- Plan board ---------------------------------------------------- */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Execution plans <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{plans.length}</span>
        </p>
        {plans.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-border/70 px-4 py-6 text-center text-xs text-muted-foreground">
            No plans yet — decompose a goal above or act on a DECOMPOSE advisory.
          </p>
        ) : (
          <div className="mt-2.5 space-y-2">
            {plans.map((plan) => (
              <Collapsible
                key={plan.id}
                open={openPlanId === plan.id}
                onOpenChange={(open) => setOpenPlanId(open ? plan.id : null)}
              >
                <div className="rounded-lg border border-border/60 bg-card/70">
                  <div className="flex items-center justify-between gap-2 p-3">
                    <CollapsibleTrigger asChild>
                      <button className="flex min-w-0 items-center gap-2 text-left">
                        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', openPlanId === plan.id && 'rotate-180')} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium">{plan.goal}</span>
                          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                            {plan.id.slice(0, 10)} · {plan.status} · {plan.subtasks.length} subtasks · {plan.waves.length} waves · {timeAgo(plan.createdAt)}
                          </span>
                        </span>
                      </button>
                    </CollapsibleTrigger>
                    <span className="flex shrink-0 items-center gap-1">
                      {plan.status !== 'archived' && plan.status !== 'completed' ? (
                        <Button variant="outline" size="sm" className="h-7 gap-1 text-[10px]" onClick={() => reDispatch(plan.id)} disabled={busyAction === `redispatch:${plan.id}`}>
                          {busyAction === `redispatch:${plan.id}` ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
                          Dispatch pass
                        </Button>
                      ) : null}
                      {plan.status !== 'archived' ? (
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-[10px] text-muted-foreground" onClick={() => archive(plan.id)} disabled={busyAction === `archive:${plan.id}`}>
                          <Ban className="size-3" />
                          Archive
                        </Button>
                      ) : null}
                    </span>
                  </div>
                  <CollapsibleContent>
                    <div className="space-y-2 border-t border-border/60 p-3">
                      {plan.subtasks.map((task) => (
                        <div key={task.id} className="rounded-md border border-border/60 bg-muted/20 p-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                            <span className="flex min-w-0 items-center gap-1.5">
                              {task.agentKind === 'local' ? (
                                <Bot className="size-3.5 shrink-0 text-amber-500" />
                              ) : (
                                <Cloud className="size-3.5 shrink-0 text-sky-500" />
                              )}
                              <span className="truncate text-xs font-medium">{task.title}</span>
                            </span>
                            <span
                              className={cn(
                                'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase',
                                task.status === 'completed'
                                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                                  : task.status === 'dispatched'
                                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-500'
                                    : task.status === 'failed'
                                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-400'
                                      : task.status === 'skipped'
                                        ? 'border-border bg-muted/60 text-muted-foreground'
                                        : 'border-amber-500/40 bg-amber-500/10 text-amber-500',
                              )}
                            >
                              wave {task.wave} · {task.status}
                            </span>
                          </div>
                          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                            {task.assignedAgent}
                            {task.dependencies.length > 0 ? ` · deps: ${task.dependencies.join(', ')}` : ''}
                          </p>
                          {task.resultSummary ? (
                            <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{task.resultSummary}</p>
                          ) : null}
                          {task.tokensSavedEstimate ? (
                            <p className="mt-1 font-mono text-[10px] text-emerald-500">↓ ~{task.tokensSavedEstimate.toLocaleString()} tokens saved</p>
                          ) : null}
                          {task.payload ? (
                            <div className="mt-2">
                              <div className="flex items-center justify-between">
                                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Tier-1 cloud payload</p>
                                <CopyButton text={task.payload} label="Copy payload" className="h-6 px-2 text-[10px]" />
                              </div>
                              <ScrollArea className="mt-1 max-h-40">
                                <pre className="whitespace-pre-wrap rounded border border-border/60 bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">
                                  {task.payload}
                                </pre>
                              </ScrollArea>
                            </div>
                          ) : null}
                          {task.status === 'dispatched' || task.status === 'pending' ? (
                            <div className="mt-2 flex gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 gap-1 px-2 text-[10px] text-emerald-600 dark:text-emerald-400"
                                onClick={() => subtaskAction(plan.id, task.id, 'completed')}
                                disabled={busyAction === `${plan.id}:${task.id}`}
                              >
                                <BadgeCheck className="size-3" /> Mark done
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 gap-1 px-2 text-[10px] text-muted-foreground"
                                onClick={() => subtaskAction(plan.id, task.id, 'skipped')}
                                disabled={busyAction === `${plan.id}:${task.id}`}
                              >
                                Skip
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
