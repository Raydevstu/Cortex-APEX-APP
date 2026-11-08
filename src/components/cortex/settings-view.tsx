'use client'

/**
 * Daemon Settings — Ollama endpoint configuration, engine defaults,
 * connection probe and data management.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useState } from 'react'
import { Cpu, Cloud, Zap, FlaskConical, Save, PlugZap, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cortexApi } from '@/lib/cortex-client'
import { SectionCard, StatusPill, formatNumber } from './shared'
import type { EngineKind } from '@/lib/cortex/types'
import { cn } from '@/lib/utils'

export function SettingsView() {
  const queryClient = useQueryClient()
  const { data: settingsData, isLoading } = useQuery({ queryKey: ['settings'], queryFn: cortexApi.settings })
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: cortexApi.health, refetchInterval: 30_000 })

  // Draft pattern: local edits override the persisted settings; no
  // effect-synced state (values derive from `effective` on every render).
  const [draft, setDraft] = useState<Partial<{ ollamaBaseUrl: string; ollamaModel: string; ollamaEmbeddingModel: string; defaultEngine: EngineKind }> | null>(null)
  const effective = {
    ollamaBaseUrl: draft?.ollamaBaseUrl ?? settingsData?.settings.ollamaBaseUrl ?? 'http://127.0.0.1:11434',
    ollamaModel: draft?.ollamaModel ?? settingsData?.settings.ollamaModel ?? 'qwen2.5-coder:7b',
    ollamaEmbeddingModel: draft?.ollamaEmbeddingModel ?? settingsData?.settings.ollamaEmbeddingModel ?? 'nomic-embed-text',
    defaultEngine: draft?.defaultEngine ?? settingsData?.settings.defaultEngine ?? ('fast' as EngineKind),
  }
  const setField = function <K extends keyof typeof effective>(key: K, value: (typeof effective)[K]) {
    setDraft((current) => ({ ...(current ?? {}), [key]: value }))
  }

  const saveMutation = useMutation({
    mutationFn: () => cortexApi.saveSettings(effective),
    onSuccess: (settings) => {
      toast.success('Daemon settings saved.')
      setDraft(null)
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
    onError: (error: Error) => toast.error(`Save failed: ${error.message}`),
  })

  const testMutation = useMutation({
    mutationFn: () => cortexApi.testOllama(effective.ollamaBaseUrl.trim()),
    onSuccess: ({ status }) => {
      if (status.reachable) {
        toast.success(`Ollama reachable — ${status.models.length} model(s): ${status.models.slice(0, 4).join(', ')}`)
      } else {
        toast.warning(`Ollama unreachable: ${status.error ?? 'no response'}`, {
          description: 'The Fast-Path deterministic engine remains fully functional without Ollama.',
          duration: 7000,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
    onError: (error: Error) => toast.error(`Probe failed: ${error.message}`),
  })

  const seedMutation = useMutation({
    mutationFn: cortexApi.seed,
    onSuccess: (result) => {
      toast.success(result.message)
      queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast.error(`Seed failed: ${error.message}`),
  })

  if (isLoading || !settingsData) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* --- Local LLM layer --- */}
      <SectionCard title="Local LLM layer — Ollama">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ollama-url">Ollama base URL</Label>
            <Input
              id="ollama-url"
              value={effective.ollamaBaseUrl}
              onChange={(e) => setField('ollamaBaseUrl', e.target.value)}
              placeholder="http://127.0.0.1:11434"
              className="font-mono text-xs"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The daemon probes this endpoint (GET /api/tags, 2.5s timeout). When reachable, the Prompt
              Studio Deep-Path refines prompts with your local model — nothing leaves your machine.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ollama-model">Deep-Path model</Label>
            <Input
              id="ollama-model"
              value={effective.ollamaModel}
              onChange={(e) => setField('ollamaModel', e.target.value)}
              placeholder="qwen2.5-coder:7b"
              className="font-mono text-xs"
            />
            {health?.ollama.reachable && health.ollama.models.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {health.ollama.models.slice(0, 8).map((model) => (
                  <button
                    key={model}
                    onClick={() => setField('ollamaModel', model)}
                    className="rounded border border-border/70 bg-background/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  >
                    {model}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ollama-embed-model">Embedding model (episodic store)</Label>
            <Input
              id="ollama-embed-model"
              value={effective.ollamaEmbeddingModel}
              onChange={(e) => setField('ollamaEmbeddingModel', e.target.value)}
              placeholder="nomic-embed-text"
              className="font-mono text-xs"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Phase 2: captured interactions are embedded for semantic history search. When Ollama is
              reachable this model is used; otherwise the deterministic local hashed embedder takes
              over (offline-safe, same cosine behaviour).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || effective.ollamaBaseUrl.trim().length === 0}
            >
              <PlugZap className="size-3.5" /> {testMutation.isPending ? 'Probing…' : 'Test connection'}
            </Button>
            {health ? (
              <StatusPill
                ok={health.ollama.reachable}
                label={health.ollama.reachable ? `online · ${health.ollama.latencyMs}ms` : 'offline'}
                detail={health.ollama.error ?? health.ollama.baseUrl}
              />
            ) : null}
          </div>
        </div>
      </SectionCard>

      {/* --- Engine defaults --- */}
      <SectionCard title="Rewrite engine defaults">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="default-engine">Default engine in Prompt Studio</Label>
            <Select value={effective.defaultEngine} onValueChange={(value) => setField('defaultEngine', value as EngineKind)}>
              <SelectTrigger id="default-engine">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast" className="gap-2">
                  <span className="flex items-center gap-2"><Zap className="size-3.5" /> Fast-Path — deterministic, &lt;50ms</span>
                </SelectItem>
                <SelectItem value="deep" className="gap-2">
                  <span className="flex items-center gap-2"><Cpu className="size-3.5" /> Deep-Path — local Ollama refinement</span>
                </SelectItem>
                <SelectItem value="cloud" className="gap-2">
                  <span className="flex items-center gap-2"><Cloud className="size-3.5" /> Cloud — GLM refinement (backend)</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ul className="space-y-2 pt-1 text-[11px] leading-relaxed text-muted-foreground">
            <li className="flex items-start gap-2">
              <Zap className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <span><span className="font-semibold text-foreground">Fast-Path</span> never requires a model: intent triage, context assembly and Tier-1 structuring are fully deterministic.</span>
            </li>
            <li className="flex items-start gap-2">
              <Cpu className="mt-0.5 size-3.5 shrink-0 text-teal-400" />
              <span><span className="font-semibold text-foreground">Deep-Path</span> sends the Fast-Path draft plus project context to your local Ollama model under the Master System Prompt; falls back to Fast-Path when offline.</span>
            </li>
            <li className="flex items-start gap-2">
              <Cloud className="mt-0.5 size-3.5 shrink-0 text-violet-400" />
              <span><span className="font-semibold text-foreground">Cloud</span> uses the hosted GLM engine (server-side only) for maximum rewrite quality when local models are unavailable.</span>
            </li>
          </ul>
        </div>
      </SectionCard>

      {/* --- Daemon status --- */}
      <SectionCard title="Daemon status">
        {health ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <StatusRow ok={health.status === 'online'} label="cortexd daemon" value={`v${health.version} · ${health.phase}`} />
              <StatusRow ok={health.database === 'ok'} label="SQLite storage" value={health.database === 'ok' ? 'connected' : 'error'} />
            </div>
            <dl className="grid grid-cols-3 gap-3 border-t border-border/60 pt-3 text-center">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Projects</dt>
                <dd className="font-mono text-lg font-semibold">{health.counts.projects}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Memories</dt>
                <dd className="font-mono text-lg font-semibold">{formatNumber(health.counts.memories)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Triples</dt>
                <dd className="font-mono text-lg font-semibold">{health.counts.edges}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <Skeleton className="h-32 rounded-lg" />
        )}
      </SectionCard>

      {/* --- Data management --- */}
      <SectionCard title="Data management">
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            All data lives in the daemon&apos;s local SQLite database. The demo seed is idempotent — it
            only creates the SaaS-CRM walkthrough project if it does not exist yet.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
          >
            <FlaskConical className="size-3.5" /> {seedMutation.isPending ? 'Seeding…' : 'Seed demo project'}
          </Button>
        </div>
      </SectionCard>

      <div className="lg:col-span-2">
        <Button
          className="gap-2"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || effective.ollamaBaseUrl.trim().length === 0}
        >
          <Save className="size-4" /> {saveMutation.isPending ? 'Saving…' : 'Save daemon settings'}
        </Button>
      </div>
    </div>
  )
}

function StatusRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {ok ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <XCircle className="size-3.5 text-destructive" />}
        {label}
      </p>
      <p className={cn('mt-1 truncate font-mono text-xs', ok ? 'text-foreground' : 'text-destructive')}>{value}</p>
    </div>
  )
}
