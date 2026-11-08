'use client'

/**
 * Dashboard — the daemon overview: knowledge stats, token savings engine
 * metrics, development timeline and cross-project open items.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  FolderKanban, Brain, GitBranch, Coins, Sparkles, ScrollText, AlertTriangle,
  ListTodo, Bug, Plus, FlaskConical, ArrowRight, Activity, ArrowRightLeft, History,
  GitCommitHorizontal, Radar, Bot, Package, Timer, Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cortexApi } from '@/lib/cortex-client'
import { EmptyState, SectionCard, StatCard, TypeBadge, formatNumber, timeAgo } from './shared'
import type { View } from './cortex-app'

const EVENT_ICONS: Record<string, React.ReactNode> = {
  'project.created': <Plus className="size-3.5" />,
  'dna.generated': <Brain className="size-3.5" />,
  'memory.captured': <ScrollText className="size-3.5" />,
  'prompt.rewritten': <Sparkles className="size-3.5" />,
  'graph.updated': <GitBranch className="size-3.5" />,
  'interaction.logged': <Activity className="size-3.5" />,
  'memory.resolved': <ListTodo className="size-3.5" />,
  'dna.updated': <Brain className="size-3.5" />,
  'sync.handoff': <ArrowRightLeft className="size-3.5" />,
  'git.commit': <GitCommitHorizontal className="size-3.5" />,
  'file.changed': <Radar className="size-3.5" />,
  'file.added': <Radar className="size-3.5" />,
  'file.removed': <Radar className="size-3.5" />,
  'watcher.started': <Radar className="size-3.5" />,
  'preexec.run': <Bot className="size-3.5" />,
  'preexec.local_only': <Bot className="size-3.5" />,
  'staging.applied': <Package className="size-3.5" />,
  'staging.discarded': <Package className="size-3.5" />,
  'staging.reverted': <Package className="size-3.5" />,
  'memory.delta_applied': <Wrench className="size-3.5" />,
}

export function DashboardView({ navigate }: { navigate: (view: View) => void }) {
  const queryClient = useQueryClient()
  const { data: metrics, isLoading } = useQuery({ queryKey: ['metrics'], queryFn: cortexApi.metrics })

  const seedMutation = useMutation({
    mutationFn: cortexApi.seed,
    onSuccess: (result) => {
      toast.success(result.message)
      queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast.error(`Seed failed: ${error.message}`),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!metrics) {
    return (
      <EmptyState
        icon={<Activity className="size-10" />}
        title="Daemon metrics unavailable"
        description="The metrics endpoint did not respond. Check the daemon logs and retry."
      />
    )
  }

  const { totals, tokenSavings, daily, recentEvents, openItems, sync, preExec } = metrics
  const hasData = totals.projects > 0

  const chartData = daily.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }))

  return (
    <div className="space-y-6">
      {/* ---- Hero ---- */}
      <section className="relative overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-primary/15 via-card to-card p-6 sm:p-8">
        <div className="absolute -right-16 -top-16 size-56 rounded-full bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">CortexOS · Phase 3</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              The persistent brain for AI-assisted development
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Memory engine, Knowledge Graph, Project DNA and cross-platform sync online — now with the
              Pre-Execution Local Agent: tasks are triaged locally, deterministic tools inspect your real
              workspace and stage boilerplate, and only the core architectural delta reaches Codex / Hermes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate({ name: 'studio' })} className="gap-2">
              <Sparkles className="size-4" /> Open Prompt Studio
            </Button>
            {!hasData ? (
              <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
                <FlaskConical className="size-4" /> Seed demo project
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {/* ---- Stat grid ---- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Projects" value={totals.projects} sub="brains under management" icon={<FolderKanban className="size-4.5" />} />
        <StatCard
          label="Memories"
          value={formatNumber(totals.memories)}
          sub={`${totals.memoriesByType.decision ?? 0} decisions · ${totals.memoriesByType.bug ?? 0} bugs · ${totals.memoriesByType.todo ?? 0} todos`}
          icon={<Brain className="size-4.5" />}
          accent="teal"
        />
        <StatCard
          label="Knowledge Graph"
          value={formatNumber(totals.nodes)}
          sub={`${totals.edges} typed relations (triples)`}
          icon={<GitBranch className="size-4.5" />}
          accent="violet"
        />
        <StatCard
          label="Context tokens avoided"
          value={formatNumber(tokenSavings.tokensContextAvoided)}
          sub={`${tokenSavings.savingsPct}% of naive context · avg ${tokenSavings.avgLatencyMs}ms/rewrite`}
          icon={<Coins className="size-4.5" />}
          accent="emerald"
        />
      </div>

      {/* ---- Cross-platform sync strip ---- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Platform handoffs"
          value={formatNumber(sync?.handoffs ?? 0)}
          sub={sync?.lastHandoffAt ? `last ${timeAgo(sync.lastHandoffAt)}` : 'none yet — try the Sync tab'}
          icon={<ArrowRightLeft className="size-4.5" />}
          accent="violet"
        />
        <StatCard
          label="Episodes indexed"
          value={formatNumber(sync?.episodes ?? 0)}
          sub="episodic vector store (semantic search)"
          icon={<History className="size-4.5" />}
          accent="teal"
        />
        <StatCard
          label="Git commits ingested"
          value={formatNumber(sync?.commits ?? 0)}
          sub="webhook + git log backfill"
          icon={<GitCommitHorizontal className="size-4.5" />}
          accent="amber"
        />
        <StatCard
          label="File watchers"
          value={`${sync?.watchersRunning ?? 0} live`}
          sub="workspace → Knowledge Graph"
          icon={<Radar className="size-4.5" />}
          accent="emerald"
        />
      </div>

      {/* ---- Phase 3: Pre-execution agent strip ---- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pre-exec agent runs"
          value={formatNumber(preExec?.runs ?? 0)}
          sub={`${preExec?.localOnlyRuns ?? 0} solved 100% locally${preExec?.lastRunAt ? ` · last ${timeAgo(preExec.lastRunAt)}` : ''}`}
          icon={<Bot className="size-4.5" />}
          accent="sky"
        />
        <StatCard
          label="Cloud tokens saved"
          value={formatNumber(preExec?.cloudTokensSaved ?? 0)}
          sub="work the local agent pre-completed"
          icon={<Coins className="size-4.5" />}
          accent="emerald"
        />
        <StatCard
          label="Files staged"
          value={formatNumber(preExec?.filesStaged ?? 0)}
          sub="scope-guard-validated scaffolds"
          icon={<Package className="size-4.5" />}
          accent="violet"
        />
        <StatCard
          label="Agent latency"
          value={`${preExec?.avgDurationMs ?? 0}ms`}
          sub="average full pipeline (triage → tools → spec)"
          icon={<Timer className="size-4.5" />}
          accent="amber"
        />
      </div>

      {!hasData ? (
        <EmptyState
          icon={<FlaskConical className="size-10" />}
          title="No projects yet"
          description="Create a project and generate its PROJECT DNA from a workspace scan, or seed the SaaS-CRM demo project to explore every Phase 1 capability immediately."
          action={
            <div className="flex gap-2">
              <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>Seed demo</Button>
              <Button variant="outline" onClick={() => navigate({ name: 'projects' })}>
                <Plus className="size-4" /> New project
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* ---- Token savings chart ---- */}
          <SectionCard
            title="Token Savings Engine — last 14 days"
            className="lg:col-span-3"
            action={
              <span className="font-mono text-xs text-muted-foreground">
                {formatNumber(tokenSavings.tokensRaw)} raw → {formatNumber(tokenSavings.tokensStructured)} structured
              </span>
            }
          >
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="tokenFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                      color: 'var(--popover-foreground)',
                    }}
                    formatter={(value: number, name: string) => [
                      `${value.toLocaleString()} ${name === 'tokensAvoided' ? 'tokens avoided' : 'sessions'}`,
                      undefined,
                    ]}
                  />
                  <Area type="monotone" dataKey="tokensAvoided" stroke="var(--chart-1)" strokeWidth={2} fill="url(#tokenFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <span className="font-mono text-emerald-500">{formatNumber(tokenSavings.tokensContextAvoided)} tokens</span>{' '}
              of project context were replaced by symbolic pointers — knowledge the target AI no longer
              has to re-read from files.
            </p>
          </SectionCard>

          {/* ---- Open items ---- */}
          <SectionCard
            title="Open items across projects"
            className="lg:col-span-2"
            action={<span className="font-mono text-xs text-muted-foreground">{openItems.length} shown</span>}
          >
            {openItems.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No open TODOs or bugs. Clean slate.</p>
            ) : (
              <ul className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
                {openItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-background/40 p-3"
                  >
                    <span className="mt-0.5">
                      {item.type === 'bug' ? (
                        <Bug className="size-4 text-rose-400" />
                      ) : (
                        <ListTodo className="size-4 text-amber-500" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <TypeBadge type={item.type} />
                        <span className="truncate text-xs font-medium">{item.key}</span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                          {timeAgo(item.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{item.value}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">{item.projectName}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* ---- Timeline ---- */}
          <SectionCard
            title="Development timeline"
            className="lg:col-span-3"
            action={
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => navigate({ name: 'projects' })}>
                All projects <ArrowRight className="size-3" />
              </Button>
            }
          >
            {recentEvents.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No events yet.</p>
            ) : (
              <ol className="relative max-h-80 space-y-4 overflow-y-auto border-l border-border/70 pl-5 pr-1">
                {recentEvents.map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute -left-[27px] flex size-5 items-center justify-center rounded-full border border-border/70 bg-card text-primary">
                      {EVENT_ICONS[event.kind] ?? <AlertTriangle className="size-3" />}
                    </span>
                    <p className="text-xs leading-snug">{event.message}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] text-muted-foreground">
                      <span className="text-primary/80">{event.projectName}</span>
                      <span>·</span>
                      <span>{event.kind}</span>
                      <span>·</span>
                      <span>{timeAgo(event.createdAt)}</span>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>

          {/* ---- Memory composition ---- */}
          <SectionCard title="Memory composition" className="lg:col-span-2">
            <ul className="space-y-2.5">
              {(['decision', 'architecture', 'requirement', 'todo', 'bug', 'preference'] as const).map((type) => {
                const count = totals.memoriesByType[type] ?? 0
                const pct = totals.memories > 0 ? Math.round((count / totals.memories) * 100) : 0
                return (
                  <li key={type} className="flex items-center gap-3">
                    <TypeBadge type={type} />
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-14 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {count} · {pct}%
                    </span>
                  </li>
                )
              })}
            </ul>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 text-center">
              <div>
                <p className="font-mono text-lg font-semibold">{totals.interactions}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Interactions captured</p>
              </div>
              <div>
                <p className="font-mono text-lg font-semibold">{totals.promptSessions}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Prompts rewritten</p>
              </div>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  )
}
