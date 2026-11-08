'use client'

/**
 * Sync tab v2 — the Cross-Platform Sync Engine control surface.
 * Preview the full blueprint packet (header / DNA snapshot / scoped graph
 * context / continuity), execute real platform handoffs (recorded + audited)
 * and browse the handoff history.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ArrowRightLeft, RefreshCcw, TerminalSquare, FileJson, ArrowRight, History,
  Radar, ScrollText, ListChecks, GitBranch, Send,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cortexApi } from '@/lib/cortex-client'
import { CopyButton, SectionCard, timeAgo } from './shared'
import type { CrossPlatformSyncPacket } from '@/lib/cortex/types'

const PLATFORMS = ['codex', 'hermes', 'opencode', 'cursor', 'windsurf', 'claude', 'chatgpt', 'local_ollama'] as const

export function SyncTab({ slug, projectName }: { slug: string; projectName?: string }) {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<(typeof PLATFORMS)[number]>('hermes')

  const packetQuery = useQuery({
    queryKey: ['syncPacket', slug],
    queryFn: () => cortexApi.statePacket(slug) as Promise<CrossPlatformSyncPacket>,
  })

  const handoffHistory = useQuery({
    queryKey: ['handoffs', slug],
    queryFn: () => cortexApi.handoffs(slug),
  })

  const handoff = useMutation({
    mutationFn: () => cortexApi.syncHandoff(slug, target),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['handoffs', slug] })
      queryClient.invalidateQueries({ queryKey: ['syncPacket', slug] })
    },
  })

  const packet = handoff.data?.packet ?? packetQuery.data
  const isLoading = packetQuery.isLoading || (handoff.isPending && !packetQuery.data)

  return (
    <div className="space-y-4">
      {/* Handoff bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
            <span className="text-muted-foreground">Execute a cross-platform handoff:</span>
            <span className="font-mono text-foreground">{packet?.header.previousPlatform ?? '…'}</span>
            <ArrowRight className="size-3.5 text-primary" />
            <Select value={target} onValueChange={(v) => setTarget(v as (typeof PLATFORMS)[number])}>
              <SelectTrigger className="h-7 w-36 border-primary/40 bg-primary/5 font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p} className="font-mono text-xs">{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Records the handoff, flips the active platform, and produces the exact packet the MCP
            <span className="font-mono"> cortex_sync</span> tool serves — the target platform starts with full context in ~150–300 tokens.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="gap-1.5"
            disabled={handoff.isPending}
            onClick={() => handoff.mutate()}
          >
            <Send className={handoff.isPending ? 'size-3.5 animate-pulse' : 'size-3.5'} />
            {handoff.isPending ? 'Executing…' : 'Execute handoff'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['syncPacket', slug] })
              queryClient.invalidateQueries({ queryKey: ['handoffs', slug] })
            }}
          >
            <RefreshCcw className="size-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {handoff.isError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {(handoff.error as Error).message}
        </p>
      ) : null}
      {handoff.isSuccess ? (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
          Handoff executed — {handoff.data.packet.header.previousPlatform} → {handoff.data.packet.header.targetPlatform}
          {' '}(state #{handoff.data.packet.stateHash}, module &quot;{handoff.data.packet.scopedGraphContext.activeModule}&quot;,
          {' '}{handoff.data.packet.tokens} tokens). Recorded in the audit trail below.
        </p>
      ) : null}

      {isLoading || !packet ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Packet display */}
          <div className="space-y-4 lg:col-span-2">
            <Tabs defaultValue="contract">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TabsList className="h-9">
                  <TabsTrigger value="contract" className="gap-1.5 text-xs">
                    <ArrowRightLeft className="size-3.5" /> Blueprint contract
                  </TabsTrigger>
                  <TabsTrigger value="markdown" className="gap-1.5 text-xs">
                    <TerminalSquare className="size-3.5" /> State header
                  </TabsTrigger>
                  <TabsTrigger value="json" className="gap-1.5 text-xs">
                    <FileJson className="size-3.5" /> JSON
                  </TabsTrigger>
                </TabsList>
                <span className="font-mono text-[11px] text-muted-foreground">
                  state #{packet.stateHash} · {packet.tokens} tokens (est.)
                </span>
              </div>

              <TabsContent value="contract" className="space-y-3">
                <PacketSection
                  icon={<Radar className="size-3.5" />}
                  title="Scoped graph context"
                  badge={`active module: ${packet.scopedGraphContext.activeModule}`}
                >
                  <PacketRows
                    rows={[
                      ['Decisions in scope', packet.scopedGraphContext.relevantDecisions.map((d) => `${d.title}: ${d.constraint}`)],
                      ['Symbols (code map)', packet.scopedGraphContext.relevantSymbols.map((s) => `${s.symbolId} — ${s.signature}`)],
                      ['Open bugs in scope', packet.scopedGraphContext.openBugsInScope.map((b) => `${b.title}: ${b.rootCause}`)],
                    ]}
                    empty="No scoped context yet — capture interactions or run the file watcher to give the graph signal."
                  />
                </PacketSection>

                <PacketSection icon={<GitBranch className="size-3.5" />} title="DNA snapshot">
                  <PacketRows
                    rows={[
                      ['Stack', [packet.dnaSnapshot.stackSummary]],
                      ['Active constraints', packet.dnaSnapshot.activeConstraints],
                    ]}
                  />
                </PacketSection>

                <PacketSection icon={<ListChecks className="size-3.5" />} title="Continuity state">
                  <div className="space-y-2 text-xs leading-relaxed">
                    <p className="text-muted-foreground">
                      <span className="font-semibold text-foreground">Last completed:</span>{' '}
                      {packet.continuityState.lastCompletedAction}
                    </p>
                    {packet.continuityState.activeTask ? (
                      <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5">
                        <p className="font-mono text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          ACTIVE TASK — {packet.continuityState.activeTask.title}
                        </p>
                        <p className="mt-1 text-muted-foreground">{packet.continuityState.activeTask.remainingCoreWork}</p>
                        <p className="mt-1 text-[10.5px] text-muted-foreground">
                          Pre-executed by local agent: {packet.continuityState.activeTask.preExecutedByLocalAgent.length === 0 ? 'none yet (Phase 3 pipeline)' : packet.continuityState.activeTask.preExecutedByLocalAgent.join(', ')}
                        </p>
                      </div>
                    ) : null}
                    {packet.continuityState.nextPendingTasks.length > 0 ? (
                      <div>
                        <p className="font-semibold">Next pending:</p>
                        <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
                          {packet.continuityState.nextPendingTasks.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </PacketSection>

                <PacketSection
                  icon={<ArrowRightLeft className="size-3.5" />}
                  title="Header"
                  badge={`${packet.header.previousPlatform} → ${packet.header.targetPlatform}`}
                >
                  <div className="grid gap-1.5 font-mono text-[11px] text-muted-foreground sm:grid-cols-2">
                    <p>projectId: <span className="text-foreground">{packet.header.projectId.slice(0, 14)}…</span></p>
                    <p>project: <span className="text-foreground">{packet.header.projectName}</span></p>
                    <p>stateHash: <span className="text-foreground">#{packet.header.stateHash}</span></p>
                    <p>syncedAt: <span className="text-foreground">{packet.header.syncedAtIso.slice(0, 19).replace('T', ' ')}Z</span></p>
                  </div>
                </PacketSection>
              </TabsContent>

              <TabsContent value="markdown">
                <div className="rounded-xl border border-border/60 bg-card/60">
                  <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      Injectable state header (paste as the first message)
                    </span>
                    <CopyButton text={packet.markdown} label="Copy state packet" />
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap p-4 font-mono text-[12px] leading-relaxed">
                    {packet.markdown}
                  </pre>
                </div>
              </TabsContent>

              <TabsContent value="json">
                <div className="rounded-xl border border-border/60 bg-card/60">
                  <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      GET /api/cortex/sync/{slug}
                    </span>
                    <CopyButton text={JSON.stringify(packet, null, 2)} label="Copy JSON" />
                  </div>
                  <pre className="max-h-96 overflow-auto p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {JSON.stringify({ ...packet, markdown: `${packet.markdown.slice(0, 80)}…` }, null, 2)}
                  </pre>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Side rail */}
          <div className="space-y-4">
            <SectionCard title="Handoff history" action={<History className="size-3.5 text-muted-foreground" />}>
              {handoffHistory.isLoading ? (
                <Skeleton className="h-32 rounded-lg" />
              ) : (handoffHistory.data?.handoffs.length ?? 0) === 0 ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  No handoffs yet — execute one above or connect a platform via the MCP server.
                </p>
              ) : (
                <ul className="space-y-2">
                  {handoffHistory.data!.handoffs.slice(0, 8).map((h) => (
                    <li key={h.id} className="rounded-lg border border-border/60 bg-background/50 p-2.5 text-xs">
                      <p className="flex items-center gap-1.5 font-mono">
                        <span className="text-muted-foreground">{h.fromPlatform}</span>
                        <ArrowRight className="size-3 text-primary" />
                        <span className="font-semibold text-primary">{h.toPlatform}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">{timeAgo(h.createdAt)}</span>
                      </p>
                      <p className="mt-1 text-[10.5px] text-muted-foreground">
                        state #{h.stateHash}{h.activeModule ? ` · module "${h.activeModule}"` : ''} · {h.packetTokens} tokens
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Automatic injection paths">
              <ul className="space-y-2.5 text-[11px] leading-relaxed text-muted-foreground">
                <li>
                  <span className="font-semibold text-foreground">MCP server</span> — platforms call{' '}
                  <span className="font-mono">cortex_sync</span> on session start. Config snippets in
                  Integration Docs.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Browser extension</span> — hotkey{' '}
                  <span className="font-mono">Ctrl/Cmd+Shift+V</span> injects this packet into any web chat.
                </li>
                <li>
                  <span className="font-semibold text-foreground">curl</span>
                  <pre className="mt-1 overflow-x-auto rounded-lg border border-border/60 bg-background/60 p-2 font-mono text-[10.5px] text-foreground">
{`curl -X POST ${typeof window !== 'undefined' ? window.location.origin : ''}/api/cortex/sync/${slug} \\
  -H 'Content-Type: application/json' \\
  -d '{"targetPlatform":"hermes"}'`}
                  </pre>
                </li>
              </ul>
              <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                  <ScrollText className="size-3.5" /> Delta, not dump
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  The packet carries a state hash. When nothing changed, platforms skip re-ingestion entirely —
                  and deep history stays one semantic query away (<span className="font-mono">POST /api/cortex/search</span>).
                </p>
              </div>
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  )
}

function PacketSection({
  icon, title, badge, children,
}: {
  icon: React.ReactNode
  title: string
  badge?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="text-primary">{icon}</span> {title}
        </p>
        {badge ? (
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
            {badge}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function PacketRows({ rows, empty }: {
  rows: Array<[string, string[]]>
  empty?: string
}) {
  const hasContent = rows.some(([, values]) => values.length > 0)
  if (!hasContent && empty) {
    return <p className="text-xs leading-relaxed text-muted-foreground">{empty}</p>
  }
  return (
    <div className="space-y-2.5">
      {rows.map(([label, values]) =>
        values.length === 0 ? null : (
          <div key={label}>
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
            <ul className="mt-1 space-y-1">
              {values.map((v, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs leading-relaxed">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                  <span className="text-muted-foreground">{v}</span>
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  )
}
