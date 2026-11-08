'use client'

/**
 * Sync tab — the Compact State Packet: the Phase 2 cross-platform sync
 * contract (Codex → CortexOS → Hermes), inspectable and copyable today.
 */
import { useQuery } from '@tanstack/react-query'
import { Database, RefreshCcw, TerminalSquare, FileJson } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cortexApi } from '@/lib/cortex-client'
import { CopyButton, SectionCard } from './shared'

export function SyncTab({ slug }: { slug: string }) {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['statePacket', slug],
    queryFn: () => cortexApi.statePacket(slug),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/60 px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          The Compact State Packet is what the next platform receives when you switch —
          stack, latest decisions, open items and module roots in ~150–300 tokens, instead of a
          full project dump.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCcw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /> Refresh
          </Button>
          {data ? <CopyButton text={data.markdown} label="Copy state packet" /> : null}
        </div>
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Tabs defaultValue="markdown">
              <TabsList className="h-9">
                <TabsTrigger value="markdown" className="gap-1.5 text-xs">
                  <TerminalSquare className="size-3.5" /> State header (markdown)
                </TabsTrigger>
                <TabsTrigger value="json" className="gap-1.5 text-xs">
                  <FileJson className="size-3.5" /> JSON contract
                </TabsTrigger>
              </TabsList>
              <TabsContent value="markdown">
                <div className="rounded-xl border border-border/60 bg-card/60">
                  <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      state #{data.stateHash} · {data.tokens} tokens (est.)
                    </span>
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap p-4 font-mono text-[12px] leading-relaxed">
                    {data.markdown}
                  </pre>
                </div>
              </TabsContent>
              <TabsContent value="json">
                <div className="rounded-xl border border-border/60 bg-card/60">
                  <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                    <span className="font-mono text-[11px] text-muted-foreground">GET /api/cortex/sync/{slug}</span>
                    <CopyButton text={JSON.stringify(data, null, 2)} label="Copy JSON" />
                  </div>
                  <pre className="max-h-96 overflow-auto p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {JSON.stringify({ ...data, markdown: `${data.markdown.slice(0, 80)}…` }, null, 2)}
                  </pre>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <SectionCard title="How to use it today">
            <ol className="space-y-3 text-xs leading-relaxed text-muted-foreground">
              <li>
                <span className="font-semibold text-foreground">1.</span> Copy the state header above and paste
                it as the first message when you open the project on another platform (Hermes, OpenCode,
                Claude…).
              </li>
              <li>
                <span className="font-semibold text-foreground">2.</span> Or let tooling fetch it:
                <pre className="mt-1.5 overflow-x-auto rounded-lg border border-border/60 bg-background/60 p-2.5 font-mono text-[10.5px] text-foreground">
{`curl ${typeof window !== 'undefined' ? window.location.origin : ''}/api/cortex/sync/${slug}`}
                </pre>
              </li>
              <li>
                <span className="font-semibold text-foreground">3.</span> In Phase 2, the MCP server
                (<span className="font-mono text-[10.5px]">cortex_sync</span>,{' '}
                <span className="font-mono text-[10.5px]">cortex_get_dna</span>,{' '}
                <span className="font-mono text-[10.5px]">cortex_log_decision</span>) and file watchers make
                this injection automatic — the contract shown here is exactly what those tools will serve.
              </li>
            </ol>
            <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                <Database className="size-3.5" /> Delta, not dump
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                The packet carries a state hash. When nothing changed, platforms can skip re-ingestion
                entirely — that is the zero-token sync promise.
              </p>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  )
}
