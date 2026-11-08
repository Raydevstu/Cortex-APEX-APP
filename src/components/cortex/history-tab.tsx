'use client'

/**
 * History tab — semantic episodic search over the project's cross-platform
 * interaction history (blueprint §3, memory Tier 3). Queries are embedded
 * through the same provider chain used at index time and cosine-scored
 * against every indexed episode, blended with keyword memory matches.
 */
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Search, History, Cpu, CornerDownLeft, FileClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cortexApi } from '@/lib/cortex-client'
import { SectionCard, TypeBadge, timeAgo } from './shared'
import type { EpisodicSearchResponse } from '@/lib/cortex/types'

const SAMPLES = [
  'stripe webhook race condition',
  'why did we pick postgresql',
  'email verification requirement',
  'payment retry dunning',
]

export function HistoryTab({ projectId, projectName }: { projectId: string; projectName?: string }) {
  const [query, setQuery] = useState('')

  const search = useMutation({
    mutationFn: (q: string) => cortexApi.episodicSearch({ projectId, query: q, k: 6 }),
  })

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Ask the brain what happened — every captured interaction on every platform
          {projectName ? ` (${projectName})` : ''} is embedded in the local episodic store. This is
          the on-demand deep-history channel the compact sync packet points to, so no platform
          ever needs the full transcript in its context window.
        </p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (query.trim().length >= 2) search.mutate(query.trim())
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='e.g. "checkout double-charge webhook"'
              className="pl-9"
              aria-label="Semantic history search"
            />
          </div>
          <Button type="submit" size="sm" className="gap-1.5" disabled={search.isPending || query.trim().length < 2}>
            <CornerDownLeft className="size-3.5" /> Search
          </Button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button
              key={s}
              onClick={() => {
                setQuery(s)
                search.mutate(s)
              }}
              className="rounded-full border border-border/60 bg-background/50 px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {search.isPending ? <Skeleton className="h-64 rounded-xl" /> : null}

      {search.isError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {(search.error as Error).message}
        </p>
      ) : null}

      {search.data ? <SearchResults data={search.data} /> : null}

      {!search.data && !search.isPending && !search.isError ? (
        <SectionCard title="How it works" action={<FileClock className="size-3.5 text-muted-foreground" />}>
          <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
            <li>
              <span className="font-semibold text-foreground">1.</span> Every captured interaction
              (Memories tab → Capture, MCP <span className="font-mono">cortex_capture_interaction</span>,
              or the browser extension) is compacted to a ~60-token summary and embedded.
            </li>
            <li>
              <span className="font-semibold text-foreground">2.</span> Embeddings come from local
              Ollama (<span className="font-mono">nomic-embed-text</span>) when the runtime is up, or
              the deterministic local hashed embedder when offline — search always works.
            </li>
            <li>
              <span className="font-semibold text-foreground">3.</span> Queries are cosine-scored
              against every episode and blended with keyword memory matches — ranked results, zero
              platform tokens spent.
            </li>
          </ul>
        </SectionCard>
      ) : null}
    </div>
  )
}

function SearchResults({ data }: { data: EpisodicSearchResponse }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <SectionCard
          title="Episodes"
          action={
            <span className="flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
              <Cpu className="size-3" /> {data.provider}
            </span>
          }
        >
          {data.results.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              No matching episodes. Capture more interactions (Memories → Capture) to grow the store.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {data.results.map((r, i) => (
                <li key={r.interactionId} className="rounded-lg border border-border/60 bg-background/50 p-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] font-semibold text-primary">#{i + 1}</span>
                    <p className="min-w-0 flex-1 truncate text-xs font-medium">{r.title ?? 'Untitled interaction'}</p>
                    <span className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {r.platform ?? '—'}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(r.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                    {r.summary ?? r.snippet}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-border/60">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-primary"
                        style={{ width: `${Math.min(100, Math.round(r.score * 100))}%` }}
                      />
                    </div>
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      score {r.score.toFixed(3)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Related memories" action={<History className="size-3.5 text-muted-foreground" />}>
        {data.memories.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">No structured memories matched this query.</p>
        ) : (
          <ul className="space-y-2">
            {data.memories.map((m) => (
              <li key={m.id} className="rounded-lg border border-border/60 bg-background/50 p-2.5">
                <p className="flex items-center gap-1.5">
                  <TypeBadge type={m.type} />
                  <span className="truncate font-mono text-[11px] font-semibold">{m.key}</span>
                </p>
                <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{m.value}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{timeAgo(m.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
