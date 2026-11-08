'use client'

/**
 * Prompt Studio — the Tier-1 Prompt Interceptor UI (blueprint Phase 1) and,
 * since Phase 3, the cockpit of the Pre-Execution Local Agent.
 *
 * Raw one-line prompt → context-enriched enterprise specification, ready to
 * paste into Codex / Hermes / Claude / any coding AI. The Pre-Exec engine
 * additionally triages the task (Engine 1), runs the deterministic local
 * tools (0 cloud tokens), stages boilerplate behind the AST Scope Guard and
 * composes the blueprint-format injection payload (Engine 2).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import {
  Sparkles, Zap, Cpu, Cloud, Timer, Coins, Target, GitBranch, Brain,
  ClipboardList, Layers, History, RotateCcw, ChevronRight, Wand2, Bot,
  Wrench, ShieldCheck, Package, CheckCircle2, XCircle, Undo2, CircleDot,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { cortexApi } from '@/lib/cortex-client'
import { CopyButton, EmptyState, TypeBadge, formatNumber, timeAgo } from './shared'
import type { View } from './cortex-app'
import type { EngineKind, PreExecResult, RewriteResult, StagedArtifactDetailClient } from '@/lib/cortex/types'
import { cn } from '@/lib/utils'

type StudioEngine = EngineKind | 'preexec'

const SAMPLE_PROMPTS = [
  'add stripe webhook for subscription renewal and update user db',
  'build login page',
  'fix the checkout race condition bug',
  'build a realtime notification system with websocket and add rate limiting',
  'what database should we use for analytics',
]

const LOCAL_SAMPLE_PROMPTS = ['add a zod schema for the User prisma model']

const ENGINES: Array<{
  key: StudioEngine
  name: string
  icon: React.ReactNode
  tagline: string
  detail: string
}> = [
  {
    key: 'fast',
    name: 'Fast-Path',
    icon: <Zap className="size-4" />,
    tagline: '<50ms · deterministic',
    detail: 'Zero LLM tokens. Intent triage, graph pointers and DNA context assembled deterministically.',
  },
  {
    key: 'deep',
    name: 'Deep-Path',
    icon: <Cpu className="size-4" />,
    tagline: 'local · Ollama',
    detail: 'Refined by your local Ollama model via the Master System Prompt. Falls back to Fast-Path when offline.',
  },
  {
    key: 'cloud',
    name: 'Cloud',
    icon: <Cloud className="size-4" />,
    tagline: 'GLM · backend only',
    detail: 'Refined by the cloud GLM engine when you want maximum prompt quality regardless of local models.',
  },
  {
    key: 'preexec',
    name: 'Pre-Exec Agent',
    icon: <Bot className="size-4" />,
    tagline: 'local tools · 0 cloud tokens',
    detail: 'Phase 3 pipeline: Engine 1 triage → deterministic local tools (AST, schema, docs, git, staged scaffolds) → Engine 2 blueprint-format specification. LOCAL_ONLY tasks never reach the cloud at all.',
  },
]

export function StudioView({ initialProjectId, navigate }: { initialProjectId?: string; navigate: (view: View) => void }) {
  const queryClient = useQueryClient()
  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: cortexApi.projects })
  const { data: settingsData } = useQuery({ queryKey: ['settings'], queryFn: cortexApi.settings })

  const projects = projectsData?.projects ?? []
  const [projectIdValue, setProjectId] = useState<string>(initialProjectId ?? '')
  const [engineChoice, setEngineChoice] = useState<StudioEngine | null>(null)
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<RewriteResult | PreExecResult | null>(null)

  // Derived (no effect-synced state): fall back to the first project and the
  // daemon's default engine until the user makes an explicit choice.
  const projectId = projectIdValue || projects[0]?.id || ''
  const engine: StudioEngine = engineChoice ?? settingsData?.settings.defaultEngine ?? 'fast'

  const runMutation = useMutation({
    mutationFn: async () => {
      if (engine === 'preexec') {
        return cortexApi.preExecute({ projectId, prompt, targetPlatform: 'codex' })
      }
      return cortexApi.rewrite(projectId, prompt, engine)
    },
    onSuccess: (data) => {
      setResult(data)
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
      queryClient.invalidateQueries({ queryKey: ['rewriteHistory'] })
      queryClient.invalidateQueries({ queryKey: ['preExecHistory'] })
      queryClient.invalidateQueries({ queryKey: ['stagedArtifacts'] })
      const note =
        'routerNote' in data && data.routerNote
          ? data.routerNote
          : 'engineNote' in data && data.engineNote
            ? data.engineNote
            : null
      if (note) toast.info(note, { duration: 7000 })
    },
    onError: (error: Error) => toast.error(`Pre-execution failed: ${error.message}`),
  })

  const { data: history } = useQuery({
    queryKey: ['rewriteHistory', projectId],
    queryFn: () => cortexApi.rewriteHistory(projectId),
    enabled: Boolean(projectId) && engine !== 'preexec',
  })

  const { data: agentHistory } = useQuery({
    queryKey: ['preExecHistory', projectId],
    queryFn: () => cortexApi.preExecHistory(projectId),
    enabled: Boolean(projectId) && engine === 'preexec',
  })

  const canRun = projectId && prompt.trim().length >= 3 && !runMutation.isPending

  // Cmd/Ctrl + Enter to run — the Studio "global hotkey".
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (canRun) runMutation.mutate()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canRun, runMutation])

  const isPreExec = engine === 'preexec'

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {/* ------------------------- Left: input ------------------------- */}
      <div className="min-w-0 space-y-4">
        <div className="rounded-xl border border-border/60 bg-card/60 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <label htmlFor="studio-project" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Project brain
              </label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="studio-project" className="mt-1.5 w-full">
                  <SelectValue placeholder={projects.length === 0 ? 'No projects — create one first' : 'Select project'} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.dnaGeneratedAt ? ' · DNA ready' : ' · no DNA yet'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="studio-prompt" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Raw prompt — paste exactly what you would type into Codex / Hermes
            </label>
            <Textarea
              id="studio-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                isPreExec
                  ? 'e.g. add stripe webhook for subscription renewal and update user db'
                  : 'e.g. add stripe webhook for subscription renewal and update user db'
              }
              className="mt-1.5 min-h-36 resize-y font-mono text-sm leading-relaxed"
              aria-describedby="studio-prompt-hint"
            />
            <p id="studio-prompt-hint" className="mt-1.5 text-[11px] text-muted-foreground">
              {isPreExec
                ? '⌘/Ctrl + Enter to run · the local agent triages, inspects your real workspace and stages boilerplate before any cloud token is spent'
                : '⌘/Ctrl + Enter to rewrite · intent triage, Knowledge Graph pointers and open items are injected automatically'}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {SAMPLE_PROMPTS.map((sample) => (
              <button
                key={sample}
                onClick={() => setPrompt(sample)}
                className="rounded-full border border-border/70 bg-background/50 px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {sample.length > 44 ? `${sample.slice(0, 44)}…` : sample}
              </button>
            ))}
            {isPreexecSample(engine) &&
              LOCAL_SAMPLE_PROMPTS.map((sample) => (
                <button
                  key={sample}
                  onClick={() => setPrompt(sample)}
                  className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] text-emerald-600 transition-colors hover:border-emerald-500/70 dark:text-emerald-400"
                >
                  LOCAL_ONLY demo: {sample}
                </button>
              ))}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {ENGINES.map((item) => (
              <button
                key={item.key}
                onClick={() => setEngineChoice(item.key)}
                title={item.detail}
                className={cn(
                  'rounded-lg border p-3 text-left transition-all',
                  engine === item.key
                    ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/30'
                    : 'border-border/60 bg-background/40 hover:border-border',
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span className={engine === item.key ? 'text-primary' : 'text-muted-foreground'}>{item.icon}</span>
                  {item.name}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{item.tagline}</span>
              </button>
            ))}
          </div>

          <Button
            className="mt-4 w-full gap-2"
            size="lg"
            disabled={!canRun}
            onClick={() => runMutation.mutate()}
          >
            {runMutation.isPending ? (
              <RotateCcw className="size-4 animate-spin" />
            ) : isPreExec ? (
              <Bot className="size-4" />
            ) : (
              <Wand2 className="size-4" />
            )}
            {runMutation.isPending
              ? 'Running pre-execution…'
              : isPreExec
                ? 'Run local agent & build Tier-1 payload'
                : 'Rewrite into Tier-1 prompt'}
          </Button>
        </div>

        {/* History (prompt sessions or agent runs depending on engine) */}
        <div className="rounded-xl border border-border/60 bg-card/60">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <History className="size-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {isPreExec ? 'Agent run history' : 'Session history'}
            </h3>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {isPreExec ? (
              !agentHistory || agentHistory.runs.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">No pre-execution runs for this project yet.</p>
              ) : (
                <ul className="space-y-1">
                  {agentHistory.runs.map((run) => (
                    <li key={run.id}>
                      <button
                        onClick={() => {
                          setPrompt(run.rawPrompt)
                          toast.info('Loaded into the editor — press Run to re-execute with fresh workspace state.')
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent"
                        title={run.rawPrompt}
                      >
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase',
                            run.executionMode === 'LOCAL_ONLY'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : run.executionMode === 'HYBRID_PRE_EXECUTE'
                                ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                                : 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
                          )}
                        >
                          {run.executionMode === 'LOCAL_ONLY' ? 'local' : run.executionMode === 'HYBRID_PRE_EXECUTE' ? 'hybrid' : 'cloud'}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs">{run.rawPrompt}</span>
                        <span className="shrink-0 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                          −{formatNumber(run.tokensSavedCloud)} cloud
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{timeAgo(run.createdAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : !history || history.sessions.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">No rewrites for this project yet.</p>
            ) : (
              <ul className="space-y-1">
                {history.sessions.map((session) => (
                  <li key={session.id}>
                    <button
                      onClick={() => {
                        setPrompt(session.rawPrompt)
                        setEngineChoice(session.engine as StudioEngine)
                        toast.info('Loaded into the editor — press Rewrite to regenerate with fresh context.')
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent"
                      title={session.rewrittenPrompt.slice(0, 200)}
                    >
                      <span className="font-mono text-[10px] uppercase text-primary/80">{session.engine}</span>
                      <span className="min-w-0 flex-1 truncate text-xs">{session.rawPrompt}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        −{formatNumber(session.tokensContextAvoided)} ctx · {timeAgo(session.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------- Right: output ------------------------- */}
      <div className="min-w-0 space-y-4">
        {runMutation.isPending && !result ? (
          <div className="space-y-4">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        ) : !result ? (
          <EmptyState
            icon={<Sparkles className="size-10" />}
            title={isPreExec ? 'Your pre-execution run appears here' : 'Your Tier-1 prompt appears here'}
            description={
              isPreExec
                ? 'The local agent triages the task, executes real tools against your workspace (git state, Prisma schema, AST signatures, cached SDK docs), stages boilerplate behind the scope guard and hands you the blueprint-format payload for your coding AI.'
                : 'Pick a project brain, paste a raw prompt and rewrite. The output carries the CORTEX-OS sync header, DNA-backed constraints, Knowledge Graph pointers and open items — copy it straight into your coding AI.'
            }
          />
        ) : 'runId' in result ? (
          <PreExecResultPanel result={result} projectId={projectId} />
        ) : (
          <>
            {/* Metrics strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricChip icon={<Target className="size-3.5" />} label="Intent" value={result.intent.intent.replace('_', ' ')} />
              <MetricChip icon={<Layers className="size-3.5" />} label="Complexity" value={`${result.intent.complexity}/10`} />
              <MetricChip icon={<Timer className="size-3.5" />} label="Latency" value={`${result.metrics.durationMs}ms`} />
              <MetricChip
                icon={<Coins className="size-3.5" />}
                label="Ctx avoided"
                value={`−${formatNumber(result.metrics.tokensContextAvoided)}`}
                accent
              />
            </div>

            <Tabs defaultValue="prompt" className="gap-4">
              <TabsList className="h-9 w-full justify-start overflow-x-auto">
                <TabsTrigger value="prompt" className="gap-1.5 text-xs">
                  <ClipboardList className="size-3.5" /> Tier-1 Prompt
                </TabsTrigger>
                <TabsTrigger value="analysis" className="gap-1.5 text-xs">
                  <Brain className="size-3.5" /> Analysis
                </TabsTrigger>
                <TabsTrigger value="plan" className="gap-1.5 text-xs">
                  <GitBranch className="size-3.5" /> Plan
                </TabsTrigger>
                <TabsTrigger value="context" className="gap-1.5 text-xs">
                  <Layers className="size-3.5" /> Context ({result.context.memories.length + result.context.graphPointers.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="prompt">
                <div className="rounded-xl border border-border/60 bg-card/60">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
                    <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      <span className="uppercase text-primary/80">{result.engineUsed}-path</span>
                      <span>·</span>
                      <span>{result.metrics.tokensRaw} → {result.metrics.tokensStructured} tokens</span>
                      <span>·</span>
                      <span className="text-emerald-500">{result.metrics.savingsPct}% ctx saved</span>
                    </div>
                    <CopyButton text={result.prompt} label="Copy for Codex / Hermes" />
                  </div>
                  <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap p-4 font-mono text-[12.5px] leading-relaxed">
                    {result.prompt}
                  </pre>
                </div>
              </TabsContent>

              <TabsContent value="analysis">
                <div className="space-y-4">
                  <div className="rounded-xl border border-border/60 bg-card/60 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Classification</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="font-mono text-2xl font-semibold capitalize">{result.intent.intent.replace('_', ' ')}</p>
                        <p className="text-xs text-muted-foreground">intent · confidence {(result.intent.confidence * 100).toFixed(0)}%</p>
                      </div>
                      <div>
                        <p className="font-mono text-2xl font-semibold">{result.intent.complexity}/10</p>
                        <p className="text-xs text-muted-foreground">
                          {result.intent.domains.length > 0 ? `domains: ${result.intent.domains.join(', ')}` : 'single domain'}
                        </p>
                      </div>
                    </div>
                    <ul className="mt-3 space-y-1 border-t border-border/60 pt-3">
                      {result.intent.signals.map((signal, i) => (
                        <li key={i} className="font-mono text-[11px] text-muted-foreground">— {signal}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                      <Zap className="size-3.5" /> Smart routing recommendation
                    </p>
                    <p className="mt-2 text-sm font-medium">{result.intent.routing.tier} → {result.intent.routing.target}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{result.intent.routing.reason}</p>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-card/60 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Token accounting</p>
                    <dl className="mt-3 space-y-2 font-mono text-xs">
                      <AccountRow label="Raw prompt" value={result.metrics.tokensRaw} />
                      <AccountRow label="Structured prompt (injected)" value={result.metrics.tokensStructured} />
                      <AccountRow label="Naive context dump (avoided)" value={result.context.tokensNaiveContext} strike />
                      <AccountRow label="Compact context actually used" value={result.context.tokensCompactContext} />
                      <AccountRow
                        label="Context tokens avoided"
                        value={result.metrics.tokensContextAvoided}
                        accent
                      />
                    </dl>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="plan">
                {result.decomposition.needed ? (
                  <div className="space-y-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">{result.decomposition.rationale}</p>
                    <ol className="space-y-2">
                      {result.decomposition.subtasks.map((task) => (
                        <li key={task.id} className="rounded-lg border border-border/60 bg-card/60 p-3">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                              {task.id.toUpperCase()}
                            </span>
                            <span className="text-sm font-medium">{task.title}</span>
                            {task.dependsOn.length > 0 ? (
                              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                                after {task.dependsOn.map((d) => d.toUpperCase()).join(', ')}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{task.description}</p>
                          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-primary/70">{task.domain}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <EmptyState
                    icon={<GitBranch className="size-8" />}
                    title="No decomposition needed"
                    description={result.decomposition.rationale}
                  />
                )}
              </TabsContent>

              <TabsContent value="context">
                <div className="space-y-4">
                  <div className="rounded-xl border border-border/60 bg-card/60 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Brain className="size-3.5" /> PROJECT DNA sections injected
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {result.context.dnaSections.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No DNA for this project yet — generate it from the Projects tab.</span>
                      ) : (
                        result.context.dnaSections.map((section) => (
                          <span key={section} className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                            {section}
                          </span>
                        ))
                      )}
                    </div>
                    {result.context.stackLines.length > 0 ? (
                      <ul className="mt-3 space-y-1 border-t border-border/60 pt-3 font-mono text-[11px] text-muted-foreground">
                        {result.context.stackLines.map((line) => (
                          <li key={line}>— {line}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-border/60 bg-card/60 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <GitBranch className="size-3.5" /> Knowledge Graph pointers (symbolic, zero-token)
                    </p>
                    {result.context.graphPointers.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">No graph nodes matched this prompt.</p>
                    ) : (
                      <ul className="mt-2 space-y-1 font-mono text-[11.5px]">
                        {result.context.graphPointers.map((pointer, i) => (
                          <li key={i} className="text-muted-foreground">
                            <span className="text-foreground">({pointer.source})</span>{' '}
                            <span className="text-primary">—[{pointer.relation}]→</span>{' '}
                            <span className="text-foreground">({pointer.target})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-xl border border-border/60 bg-card/60 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <ClipboardList className="size-3.5" /> Memories &amp; open items injected
                    </p>
                    {result.context.memories.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">No relevant memories matched this prompt.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {result.context.memories.map((memory) => (
                          <li key={memory.id} className="flex items-start gap-2">
                            <TypeBadge type={memory.type} />
                            <div className="min-w-0">
                              <p className="text-xs leading-snug">
                                <span className="font-medium">{memory.key}:</span>{' '}
                                <span className="text-muted-foreground">{memory.value}</span>
                              </p>
                              <p className="font-mono text-[10px] text-muted-foreground/70">
                                matched via {memory.matched} · importance {memory.importance}/5
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phase 3 — Pre-Execution Agent result panel
// ---------------------------------------------------------------------------

function PreExecResultPanel({ result, projectId }: { result: PreExecResult; projectId: string }) {
  const queryClient = useQueryClient()
  const [expandedArtifact, setExpandedArtifact] = useState<string | null>(null)

  const { data: stagedData, refetch: refetchStaged } = useQuery({
    queryKey: ['stagedArtifacts', projectId],
    queryFn: () => cortexApi.stagedArtifacts(projectId),
  })

  const stagedAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'apply' | 'discard' | 'revert' }) =>
      cortexApi.stagedAction(id, action),
    onSuccess: (data, variables) => {
      toast.success(
        variables.action === 'apply'
          ? `Applied to ${data.writtenPath ?? 'workspace'}${data.merged ? ' (keys merged into the existing file)' : ''}`
          : variables.action === 'discard'
            ? 'Staged artifact discarded — workspace untouched.'
            : `Reverted (${data.restored ?? 'restored'}).`,
      )
      refetchStaged()
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
      queryClient.invalidateQueries({ queryKey: ['preExecHistory'] })
    },
    onError: (error: Error) => toast.error(`Staging action failed: ${error.message}`),
  })

  const staged = stagedData?.artifacts ?? []
  const okCount = result.artifacts.filter((a) => a.ok).length

  return (
    <>
      {/* Metrics strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricChip icon={<Target className="size-3.5" />} label="Intent" value={result.router.intentCategory.replace('_', ' ')} />
        <MetricChip icon={<Layers className="size-3.5" />} label="Complexity" value={`${result.router.complexityScore}/10`} />
        <MetricChip
          icon={<Bot className="size-3.5" />}
          label="Mode"
          value={
            result.router.executionMode === 'LOCAL_ONLY'
              ? 'local only'
              : result.router.executionMode === 'HYBRID_PRE_EXECUTE'
                ? 'hybrid'
                : 'cloud + DNA'
          }
        />
        <MetricChip icon={<Coins className="size-3.5" />} label="Cloud tokens saved" value={`−${formatNumber(result.metrics.tokensSavedCloud)}`} accent />
      </div>

      <Tabs defaultValue={result.injectedPrompt ? 'prompt' : 'agent'} className="gap-4">
        <TabsList className="h-9 w-full justify-start overflow-x-auto">
          <TabsTrigger value="prompt" className="gap-1.5 text-xs">
            <ClipboardList className="size-3.5" /> Injected payload
          </TabsTrigger>
          <TabsTrigger value="agent" className="gap-1.5 text-xs">
            <Wrench className="size-3.5" /> Agent run ({okCount}/{result.artifacts.length})
          </TabsTrigger>
          <TabsTrigger value="subtasks" className="gap-1.5 text-xs">
            <GitBranch className="size-3.5" /> Subtasks ({result.tier1?.decomposedSubtasks.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="staging" className="gap-1.5 text-xs">
            <Package className="size-3.5" /> Staging ({staged.filter((s) => s.status === 'staged').length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prompt">
          {result.injectedPrompt ? (
            <div className="rounded-xl border border-border/60 bg-card/60">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
                <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <span className="uppercase text-primary/80">{result.tier1Engine}</span>
                  <span>·</span>
                  <span>engine 2 · blueprint format</span>
                  <span>·</span>
                  <span className="text-emerald-500">{result.router.executionMode}</span>
                </div>
                <CopyButton text={result.injectedPrompt} label="Copy for Codex / Hermes" />
              </div>
              <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap p-4 font-mono text-[12.5px] leading-relaxed">
                {result.injectedPrompt}
              </pre>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-4" /> Completed 100% locally — zero cloud tokens spent
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Engine 1 routed this task to <span className="font-mono">LOCAL_ONLY</span>: the deterministic local agent executed{' '}
                {result.artifacts.length} tool step(s) and staged {result.staged.length} file(s). Nothing was sent to Codex /
                Hermes — apply the staged artifacts from the Staging tab and you are done.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="agent">
          <div className="space-y-4">
            {/* Router card */}
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Bot className="size-3.5" /> Engine 1 — Router decision ({result.routerEngine})
                </p>
                <span className="font-mono text-[10px] text-muted-foreground">
                  local tools {result.metrics.localToolMs}ms · total {result.metrics.durationMs}ms
                </span>
              </div>
              <div className="mt-3 grid gap-2 font-mono text-[11px] sm:grid-cols-2">
                <p>
                  <span className="text-muted-foreground">intent:</span>{' '}
                  <span className="text-foreground">{result.router.intentCategory}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">complexity:</span>{' '}
                  <span className="text-foreground">{result.router.complexityScore}/10</span>
                </p>
                <p>
                  <span className="text-muted-foreground">modules:</span>{' '}
                  <span className="text-foreground">{result.router.relevantModuleIds.join(', ') || '—'}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">est. cloud tokens saved:</span>{' '}
                  <span className="text-emerald-600 dark:text-emerald-400">{result.router.estimatedCloudTokensSaved}</span>
                </p>
              </div>
              {result.routerNote ? (
                <p className="mt-2 border-t border-primary/20 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {result.routerNote}
                </p>
              ) : null}
            </div>

            {/* Tool run timeline */}
            <div className="rounded-xl border border-border/60 bg-card/60 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Wrench className="size-3.5" /> Local tool execution — 0 cloud tokens
              </p>
              <ol className="mt-3 space-y-2">
                {result.artifacts.map((artifact) => (
                  <li key={artifact.stepId} className="rounded-lg border border-border/60 bg-background/40">
                    <button
                      className="flex w-full items-start gap-2 p-2.5 text-left"
                      onClick={() => setExpandedArtifact(expandedArtifact === artifact.stepId ? null : artifact.stepId)}
                      aria-expanded={expandedArtifact === artifact.stepId}
                    >
                      {artifact.ok ? (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-primary/80">
                            {artifact.toolName}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">{artifact.durationMs}ms</span>
                          {artifact.stagedFileCount > 0 ? (
                            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-sky-600 dark:text-sky-400">
                              +{artifact.stagedFileCount} staged
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                          {artifact.summary}
                        </span>
                      </span>
                      <ChevronRight
                        className={cn(
                          'mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform',
                          expandedArtifact === artifact.stepId && 'rotate-90',
                        )}
                      />
                    </button>
                    {expandedArtifact === artifact.stepId ? (
                      <pre className="max-h-64 overflow-auto border-t border-border/60 p-3 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                        {JSON.stringify(artifact.data, null, 2).slice(0, 4000)}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ol>
              {result.tier1Note ? (
                <p className="mt-3 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-semibold">Engine 2 ({result.tier1Engine}):</span> {result.tier1Note}
                </p>
              ) : null}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="subtasks">
          {result.tier1 ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/60 bg-card/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Task</p>
                <p className="mt-1.5 text-sm font-medium">{result.tier1.taskTitle}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-primary/70">
                  optimized for {result.tier1.targetPlatformOptimized}
                </p>
              </div>
              <ol className="space-y-2">
                {result.tier1.decomposedSubtasks.map((subtask) => (
                  <li
                    key={subtask.stepNumber}
                    className={cn(
                      'rounded-lg border p-3',
                      subtask.handledBy === 'COMPLETED_BY_LOCAL_OLLAMA'
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-border/60 bg-card/60',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] font-bold text-muted-foreground">
                        {String(subtask.stepNumber).padStart(2, '0')}
                      </span>
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-primary">
                        {subtask.layer}
                      </span>
                      {subtask.handledBy === 'COMPLETED_BY_LOCAL_OLLAMA' ? (
                        <span className="ml-auto flex items-center gap-1 font-mono text-[9px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="size-3" /> local agent
                        </span>
                      ) : (
                        <span className="ml-auto flex items-center gap-1 font-mono text-[9px] font-bold uppercase text-violet-600 dark:text-violet-400">
                          <CircleDot className="size-3" /> main AI
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed">{subtask.action}</p>
                  </li>
                ))}
              </ol>

              {/* Scope lock */}
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  <ShieldCheck className="size-3.5" /> AST Scope Guard &amp; architecture lock
                </p>
                <div className="mt-3 space-y-3 text-[11px] leading-relaxed">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase text-muted-foreground">Allowed write</p>
                    <ul className="mt-1 space-y-0.5 font-mono text-emerald-700 dark:text-emerald-400">
                      {result.tier1.scopeLock.allowedWriteFiles.length === 0 ? (
                        <li className="text-muted-foreground">(minimal change surface)</li>
                      ) : (
                        result.tier1.scopeLock.allowedWriteFiles.map((file) => <li key={file}>+ {file}</li>)
                      )}
                    </ul>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase text-muted-foreground">Read-only context</p>
                    <ul className="mt-1 space-y-0.5 font-mono text-muted-foreground">
                      {result.tier1.scopeLock.readOnlyContextFiles.length === 0 ? (
                        <li>—</li>
                      ) : (
                        result.tier1.scopeLock.readOnlyContextFiles.map((file) => <li key={file}>· {file}</li>)
                      )}
                    </ul>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase text-muted-foreground">Immutable constraints</p>
                    <ul className="mt-1 space-y-0.5">
                      {result.tier1.scopeLock.forbiddenPatterns.map((pattern, i) => (
                        <li key={i} className="text-foreground/90">• {pattern}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<GitBranch className="size-8" />}
              title="No cloud subtasks — LOCAL_ONLY"
              description="The router determined the whole task could be completed by the local agent. Review and apply the staged artifacts instead."
            />
          )}
        </TabsContent>

        <TabsContent value="staging">
          <StagingManager artifacts={staged} action={stagedAction} />
        </TabsContent>
      </Tabs>
    </>
  )
}

// ---------------------------------------------------------------------------
// Staged artifact manager
// ---------------------------------------------------------------------------

function StagingManager({
  artifacts,
  action,
}: {
  artifacts: StagedArtifactDetailClient[]
  action: {
    mutate: (input: { id: string; action: 'apply' | 'discard' | 'revert' }) => void
    isPending: boolean
  }
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (artifacts.length === 0) {
    return (
      <EmptyState
        icon={<Package className="size-8" />}
        title="Nothing staged"
        description="Scaffolds produced by the local agent (Zod schemas, TypeScript types, route stubs, .env.example keys) wait here behind the AST Scope Guard until you apply or discard them."
      />
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Staged files are never written to your workspace automatically. <span className="font-semibold">Apply</span> writes them
        through the scope guard (inside the project root, protected paths refused, previous content captured for one-click
        revert).
      </p>
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="rounded-xl border border-border/60 bg-card/60">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
            <span
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase',
                artifact.status === 'staged'
                  ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                  : artifact.status === 'applied'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground line-through',
              )}
            >
              {artifact.status}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">{artifact.targetPath}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {artifact.kind} · {artifact.action} · {formatNumber(artifact.contentLength)}B
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => setOpenId(openId === artifact.id ? null : artifact.id)}
            >
              {openId === artifact.id ? 'Hide' : 'Review'}
            </Button>
            {artifact.status === 'staged' ? (
              <>
                <Button
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ id: artifact.id, action: 'apply' })}
                >
                  <CheckCircle2 className="size-3" /> Apply
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px] text-destructive hover:text-destructive"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ id: artifact.id, action: 'discard' })}
                >
                  <XCircle className="size-3" /> Discard
                </Button>
              </>
            ) : artifact.status === 'applied' ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                disabled={action.isPending}
                onClick={() => action.mutate({ id: artifact.id, action: 'revert' })}
              >
                <Undo2 className="size-3" /> Revert
              </Button>
            ) : null}
          </div>
          {openId === artifact.id ? (
            <div className="border-t border-border/60 p-3">
              <p className="text-[11px] leading-relaxed text-muted-foreground">{artifact.rationale}</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                from run {artifact.runId.slice(0, 8)} · staged {timeAgo(artifact.createdAt)}
                {artifact.appliedAt ? ` · applied ${timeAgo(artifact.appliedAt)}` : ''}
              </p>
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border/60 bg-background/60 p-3 font-mono text-[11px] leading-relaxed">
                {artifact.content}
              </pre>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

function isPreexecSample(engine: StudioEngine): boolean {
  return engine === 'preexec'
}

function MetricChip({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className={cn('rounded-xl border p-3', accent ? 'border-emerald-500/30 bg-emerald-500/8' : 'border-border/60 bg-card/60')}>
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </p>
      <p className={cn('mt-1 truncate font-mono text-sm font-semibold capitalize', accent && 'text-emerald-500')}>
        {value}
      </p>
    </div>
  )
}

function AccountRow({ label, value, accent, strike }: { label: string; value: number; accent?: boolean; strike?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className={cn('text-muted-foreground', strike && 'line-through opacity-60')}>{label}</dt>
      <dd className={cn('tabular-nums', accent ? 'font-bold text-emerald-500' : 'text-foreground')}>
        {value.toLocaleString()}
      </dd>
    </div>
  )
}
