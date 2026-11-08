'use client'

/**
 * Prompt Studio — the Tier-1 Prompt Interceptor UI (blueprint Phase 1).
 * Raw one-line prompt → context-enriched enterprise specification,
 * ready to paste into Codex / Hermes / Claude / any coding AI.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import {
  Sparkles, Zap, Cpu, Cloud, Timer, Coins, Target, GitBranch, Brain,
  ClipboardList, Layers, History, RotateCcw, ChevronRight, Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { cortexApi } from '@/lib/cortex-client'
import { CopyButton, EmptyState, TypeBadge, formatNumber, timeAgo } from './shared'
import type { View } from './cortex-app'
import type { EngineKind, RewriteResult } from '@/lib/cortex/types'
import { cn } from '@/lib/utils'

const SAMPLE_PROMPTS = [
  'add stripe webhook for subscription renewal and update user db',
  'build login page',
  'fix the checkout race condition bug',
  'build a realtime notification system with websocket and add rate limiting',
  'what database should we use for analytics',
]

const ENGINES: Array<{
  key: EngineKind
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
]

export function StudioView({ initialProjectId, navigate }: { initialProjectId?: string; navigate: (view: View) => void }) {
  const queryClient = useQueryClient()
  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: cortexApi.projects })
  const { data: settingsData } = useQuery({ queryKey: ['settings'], queryFn: cortexApi.settings })

  const projects = projectsData?.projects ?? []
  const [projectIdValue, setProjectId] = useState<string>(initialProjectId ?? '')
  const [engineChoice, setEngineChoice] = useState<EngineKind | null>(null)
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<RewriteResult | null>(null)

  // Derived (no effect-synced state): fall back to the first project and the
  // daemon's default engine until the user makes an explicit choice.
  const projectId = projectIdValue || projects[0]?.id || ''
  const engine: EngineKind = engineChoice ?? settingsData?.settings.defaultEngine ?? 'fast'

  const rewriteMutation = useMutation({
    mutationFn: () => cortexApi.rewrite(projectId, prompt, engine),
    onSuccess: (data) => {
      setResult(data)
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
      queryClient.invalidateQueries({ queryKey: ['rewriteHistory'] })
      if (data.engineNote) toast.info(data.engineNote, { duration: 6000 })
    },
    onError: (error: Error) => toast.error(`Rewrite failed: ${error.message}`),
  })

  const { data: history } = useQuery({
    queryKey: ['rewriteHistory', projectId],
    queryFn: () => cortexApi.rewriteHistory(projectId),
    enabled: Boolean(projectId),
  })

  const canRewrite = projectId && prompt.trim().length >= 3 && !rewriteMutation.isPending

  // Cmd/Ctrl + Enter to rewrite — the Studio "global hotkey".
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (canRewrite) rewriteMutation.mutate()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canRewrite, rewriteMutation])

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {/* ------------------------- Left: input ------------------------- */}
      <div className="space-y-4">
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
              placeholder="e.g. add stripe webhook for subscription renewal and update user db"
              className="mt-1.5 min-h-36 resize-y font-mono text-sm leading-relaxed"
              aria-describedby="studio-prompt-hint"
            />
            <p id="studio-prompt-hint" className="mt-1.5 text-[11px] text-muted-foreground">
              ⌘/Ctrl + Enter to rewrite · intent triage, Knowledge Graph pointers and open items are injected automatically
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
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
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
            disabled={!canRewrite}
            onClick={() => rewriteMutation.mutate()}
          >
            {rewriteMutation.isPending ? (
              <RotateCcw className="size-4 animate-spin" />
            ) : (
              <Wand2 className="size-4" />
            )}
            {rewriteMutation.isPending ? 'Rewriting…' : 'Rewrite into Tier-1 prompt'}
          </Button>
        </div>

        {/* History */}
        <div className="rounded-xl border border-border/60 bg-card/60">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <History className="size-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Session history</h3>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {!history || history.sessions.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">No rewrites for this project yet.</p>
            ) : (
              <ul className="space-y-1">
                {history.sessions.map((session) => (
                  <li key={session.id}>
                    <button
                      onClick={() => {
                        setPrompt(session.rawPrompt)
                        setEngineChoice(session.engine as EngineKind)
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
      <div className="space-y-4">
        {rewriteMutation.isPending && !result ? (
          <div className="space-y-4">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        ) : !result ? (
          <EmptyState
            icon={<Sparkles className="size-10" />}
            title="Your Tier-1 prompt appears here"
            description="Pick a project brain, paste a raw prompt and rewrite. The output carries the CORTEX-OS sync header, DNA-backed constraints, Knowledge Graph pointers and open items — copy it straight into your coding AI."
          />
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
