'use client'

/**
 * Phase 4 — Visual Command Center main view
 * (blueprint PHASE_4 §7 `page.tsx`, adapted to the daemon SPA shell).
 *
 * Assembles the four Phase 4 pillars over the live /api/cortex/state plane:
 *   1. Token Savings & Local Routing Telemetry  (KPI strip + daily chart)
 *   2. Interactive Knowledge Graph Explorer     (scope locks + ego networks)
 *   3. AI CTO Mode                              (drift advisories + DAG)
 *   4. Session Continuity Timeline              (+ handoff packet modal)
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity, ArrowLeftRight, Coins, Cpu, Lock, Network, ShieldCheck, Timer,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cortexApi } from '@/lib/cortex-client'
import type { CtoAuditResponse } from '@/lib/cortex/types'
import { cn } from '@/lib/utils'
import { SectionCard, StatCard, StatusPill, formatNumber } from '../shared'
import type { View } from '../cortex-app'
import { KuzuGraphCanvas } from './kuzu-graph-canvas'
import { TokenSavingsDashboard } from './token-savings-dashboard'
import { ContinuityTimeline } from './continuity-timeline'
import { AICtoPanel } from './ai-cto-panel'
import { HandoffModal } from './handoff-modal'

export function CommandCenterView({
  initialProjectId,
  navigate,
}: {
  initialProjectId?: string
  navigate: (view: View) => void
}) {
  const queryClient = useQueryClient()
  const [projectId, setProjectId] = useState<string>(initialProjectId ?? '')
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [togglingFqn, setTogglingFqn] = useState<string | null>(null)

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: cortexApi.projects,
  })

  // Default to the most recently active project once projects load.
  useEffect(() => {
    if (!projectId && projectsData && projectsData.projects.length > 0) {
      setProjectId(projectsData.projects[0].id)
    }
  }, [projectId, projectsData])

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: cortexApi.health,
    refetchInterval: 30_000,
  })

  const stateQuery = useQuery({
    queryKey: ['command-center-state', projectId],
    queryFn: () => cortexApi.commandCenterState(projectId || undefined),
    enabled: projectId !== '',
    refetchInterval: 15_000,
  })

  const ctoQuery = useQuery({
    queryKey: ['cto-audit', projectId],
    queryFn: () => cortexApi.ctoAudit(projectId || undefined),
    enabled: projectId !== '',
    refetchInterval: 60_000,
  })

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['command-center-state', projectId] })
    void queryClient.invalidateQueries({ queryKey: ['cto-audit', projectId] })
    void queryClient.invalidateQueries({ queryKey: ['health'] })
  }, [queryClient, projectId])

  const toggleScope = useMutation({
    mutationFn: (fqn: string) => cortexApi.toggleSymbolScope(fqn, projectId),
    onMutate: (fqn) => setTogglingFqn(fqn),
    onSuccess: (_data, fqn) => {
      toast.success('AST scope lock toggled', { description: fqn })
      refreshAll()
    },
    onError: (error) => {
      toast.error('Scope toggle failed', { description: error instanceof Error ? error.message : 'Unknown error' })
    },
    onSettled: () => setTogglingFqn(null),
  })

  const state = stateQuery.data
  const audit: CtoAuditResponse | undefined = ctoQuery.data
  const plans = audit?.plans ?? []

  const activeProject = projectsData?.projects.find((p) => p.id === projectId)

  function delegateToStudio(prompt: string) {
    navigate({ name: 'studio', projectId, prompt })
  }

  if (!projectId || (stateQuery.isLoading && !state)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (stateQuery.isError && !state) {
    return (
      <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-6 text-center">
        <p className="text-sm font-medium text-rose-500">Command Center state unavailable</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {stateQuery.error instanceof Error ? stateQuery.error.message : 'Unknown daemon error'}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void stateQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ---- Header -------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Visual Command Center</h2>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
              PHASE 4
            </span>
            {state ? (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-500">
                LIVE · {state.projectSlug}
              </span>
            ) : null}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {state ? (
              <>
                <span>
                  DNA <span className="font-mono text-foreground/80">{state.projectDnaVersion}</span>
                </span>
                <span>
                  state <span className="font-mono">#{state.syncPacketXml.match(/state-hash="#([^"]+)"/)?.[1] ?? '—'}</span>
                </span>
                <span>
                  audit <span className="font-mono">{state.audit.symbolsScanned} symbols / {state.audit.filesScanned} files</span>
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              {(projectsData?.projects ?? []).map((project) => (
                <SelectItem key={project.id} value={project.id} className="text-xs">
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setHandoffOpen(true)} disabled={!state}>
            <ArrowLeftRight className="size-3.5" />
            Generate Handoff Packet
          </Button>
        </div>
      </div>

      {health ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill ok={health.database === 'ok'} label={health.database === 'ok' ? 'Daemon online' : 'DB error'} detail={`cortexd v${health.version}`} />
          <StatusPill
            ok={health.ollama.reachable}
            label={health.ollama.reachable ? `Ollama · ${health.ollama.models.length} models` : 'Ollama offline · deterministic'}
            detail={health.ollama.baseUrl}
          />
          <StatusPill ok label={`${health.counts.dagPlans} DAG plans`} detail="Multi-agent orchestrator persistence" />
        </div>
      ) : null}

      {/* ---- Pillar 1: Telemetry KPI strip ---------------------------------- */}
      {state ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Net tokens saved"
            value={formatNumber(state.telemetry.netTokensSaved)}
            sub={`${state.telemetry.compressionRatioPct.toFixed(1)}% context reduction via scoped packets`}
            icon={<Coins className="size-4" />}
            accent="emerald"
          />
          <StatCard
            label="Local pre-execution"
            value={`${state.telemetry.localOffloadPct.toFixed(0)}%`}
            sub={`${state.telemetry.localOllamaOffloadCount} local / ${state.telemetry.cloudEscalationCount} cloud turns`}
            icon={<Cpu className="size-4" />}
            accent="violet"
          />
          <StatCard
            label="AST scope locks"
            value={state.activeTask.allowedSymbolFqns.length}
            sub={`${state.scopeLock.lockedSymbolFqns.length} locked · ${state.scopeLock.forbiddenPaths.length} protected paths · fail-closed`}
            icon={<Lock className="size-4" />}
            accent="amber"
          />
          <StatCard
            label="Est. API cost saved"
            value={`$${state.telemetry.estimatedCostSavingsUsd.toFixed(2)}`}
            sub={`across ${state.telemetry.totalPromptsIntercepted} intercepted prompts`}
            icon={<Activity className="size-4" />}
            accent="teal"
          />
        </div>
      ) : null}

      {/* ---- Pillar 2: Knowledge Graph Explorer ------------------------------ */}
      <SectionCard
        title="Knowledge Graph Explorer & AST Scope Sentinel"
        action={
          state ? (
            <span className="font-mono text-[10px] text-muted-foreground">
              {state.graph.nodes.length} nodes · {state.graph.edges.length} edges
            </span>
          ) : null
        }
      >
        {state ? (
          <KuzuGraphCanvas
            nodes={state.graph.nodes}
            edges={state.graph.edges}
            onToggleScopeLock={(fqn) => toggleScope.mutate(fqn)}
            togglingFqn={togglingFqn}
          />
        ) : (
          <Skeleton className="h-96" />
        )}
      </SectionCard>

      {/* ---- Pillars 3 & 4: AI CTO + Timeline -------------------------------- */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard
          title="AI CTO Mode — Drift & DAG Advisor"
          action={
            state ? (
              <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {state.ctoRecommendations.length} advisories
              </span>
            ) : null
          }
        >
          <AICtoPanel
            projectId={projectId}
            recommendations={state?.ctoRecommendations ?? []}
            plans={plans}
            auditStats={audit?.audit.stats}
            auditScannedAt={audit?.audit.scannedAt ?? state?.audit.scannedAt}
            onRefresh={refreshAll}
            onDelegateToStudio={delegateToStudio}
          />
        </SectionCard>

        <div className="space-y-6">
          <SectionCard
            title="Token Offload Telemetry"
            action={
              state ? (
                <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                  <Timer className="size-3" /> 14-day window
                </span>
              ) : null
            }
          >
            {state ? <TokenSavingsDashboard telemetry={state.telemetry} /> : <Skeleton className="h-56" />}
          </SectionCard>

          <SectionCard
            title="Session Continuity Timeline"
            action={
              state ? (
                <span className="font-mono text-[10px] text-muted-foreground">{state.timeline.length} events</span>
              ) : null
            }
          >
            {state ? <ContinuityTimeline events={state.timeline} /> : <Skeleton className="h-56" />}
          </SectionCard>
        </div>
      </div>

      {/* ---- Active task footer ---------------------------------------------- */}
      {state && activeProject ? (
        <div className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-4 py-3',
        )}>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="size-3.5 text-emerald-500" /> Active task
            </p>
            <p className="mt-0.5 truncate text-sm font-medium">
              {state.activeTask.taskId === 'TASK-NONE' ? state.activeTask.title : state.activeTask.title}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {state.activeTask.allowedSymbolFqns.length > 0
                ? `allowed: ${state.activeTask.allowedSymbolFqns.slice(0, 3).join(', ')}${state.activeTask.allowedSymbolFqns.length > 3 ? '…' : ''}`
                : 'no unlocked symbols — fail-closed scope'}
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => navigate({ name: 'project', projectId, tab: 'sync' })}>
            <Network className="size-3.5" />
            Open sync center
          </Button>
        </div>
      ) : null}

      {/* ---- Handoff modal ------------------------------------------------------ */}
      {state ? (
        <HandoffModal
          open={handoffOpen}
          onOpenChange={setHandoffOpen}
          projectSlug={state.projectSlug}
          initialXml={state.syncPacketXml}
          onHandoffRecorded={refreshAll}
        />
      ) : null}
    </div>
  )
}
