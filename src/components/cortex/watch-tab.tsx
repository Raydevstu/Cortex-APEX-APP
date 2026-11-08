'use client'

/**
 * Watch tab — the live intelligence surface: file watcher control (Codex
 * saves → Knowledge Graph updates) and git integration (hook installer
 * command, log ingest, commit feed with bug auto-resolution evidence).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Radar, Play, Square, RefreshCcw, GitCommitHorizontal, Download, Terminal,
  Activity, FolderOpen, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cortexApi, fetchTimeline } from '@/lib/cortex-client'
import { CopyButton, SectionCard, StatusPill, timeAgo } from './shared'

export function WatchTab({
  projectId, slug, rootPath,
}: {
  projectId: string
  slug: string
  rootPath: string | null
}) {
  const queryClient = useQueryClient()
  const [ingestNote, setIngestNote] = useState<string | null>(null)
  const [ingestError, setIngestError] = useState<string | null>(null)

  const watcher = useQuery({
    queryKey: ['watcher', projectId],
    queryFn: () => cortexApi.watchStatus(projectId),
    refetchInterval: 5_000,
  })

  const timeline = useQuery({
    queryKey: ['watchTimeline', projectId],
    queryFn: () => fetchTimeline(projectId),
    refetchInterval: 5_000,
  })

  const commits = useQuery({
    queryKey: ['gitCommits', projectId],
    queryFn: () => cortexApi.gitCommits(projectId),
  })

  const watchAction = useMutation({
    mutationFn: (action: 'start' | 'stop') => cortexApi.watchAction(projectId, action, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watcher', projectId] })
      queryClient.invalidateQueries({ queryKey: ['watchTimeline', projectId] })
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })

  const ingest = useMutation({
    mutationFn: () => cortexApi.gitIngest(projectId),
    onSuccess: (data) => {
      setIngestError(null)
      setIngestNote(
        data.ingested === 0 && data.duplicates > 0
          ? `No new commits — ${data.duplicates} already ingested (deduped).`
          : `Ingested ${data.ingested} commit(s) · ${data.filesTouched} file(s) touched${data.duplicates > 0 ? ` · ${data.duplicates} deduped` : ''}.`,
      )
      queryClient.invalidateQueries({ queryKey: ['gitCommits', projectId] })
      queryClient.invalidateQueries({ queryKey: ['watchTimeline', projectId] })
    },
    onError: (error) => setIngestError((error as Error).message),
  })

  const status = watcher.data?.watchers[0]
  const fileEvents = (timeline.data?.events ?? [])
    .filter((e) => e.kind.startsWith('file.') || e.kind.startsWith('watcher.') || e.kind === 'git.commit')
    .slice(0, 12)

  const hookCommand = `node scripts/cortex-git-hook.mjs install --repo /path/to/your/repo --slug ${slug} --platform codex`

  return (
    <div className="space-y-4">
      {/* File watcher */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="File watcher"
          action={
            status?.running ? (
              <StatusPill ok label="watching" detail={status.rootPath ?? undefined} />
            ) : (
              <StatusPill ok={false} label="idle" />
            )
          }
        >
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Watches the workspace and updates the Knowledge Graph the moment a file is saved —
              file nodes, module edges, content hashes, export summaries and timeline events. The
              sync packet&apos;s <span className="font-mono">scopedGraphContext</span> picks the
              active module from this signal.
            </p>
            {rootPath ? (
              <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                <FolderOpen className="size-3.5 shrink-0" /> {rootPath}
              </p>
            ) : (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-600 dark:text-amber-400">
                This project has no workspace path — set one (Projects → edit) before watching.
              </p>
            )}

            {status ? (
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Files" value={status.watchedFiles} />
                <MiniStat label="Events" value={status.events} />
                <MiniStat label="Errors" value={status.errors} danger={status.errors > 0} />
              </div>
            ) : null}
            {status?.lastEventPath ? (
              <p className="truncate font-mono text-[11px] text-muted-foreground" title={status.lastEventPath}>
                last: {status.lastEventPath} · {status.lastEventAt ? timeAgo(status.lastEventAt) : ''}
              </p>
            ) : null}
            {status?.lastError ? (
              <p className="text-[11px] text-rose-500">{status.lastError}</p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {status?.running ? (
                <Button size="sm" variant="outline" className="gap-1.5" disabled={watchAction.isPending} onClick={() => watchAction.mutate('stop')}>
                  <Square className="size-3.5" /> Stop watcher
                </Button>
              ) : (
                <Button size="sm" className="gap-1.5" disabled={watchAction.isPending || !rootPath} onClick={() => watchAction.mutate('start')}>
                  <Play className="size-3.5" /> Start watcher
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['watcher', projectId] })}
              >
                <RefreshCcw className="size-3.5" /> Refresh
              </Button>
            </div>
            {watchAction.isError ? (
              <p className="text-[11px] text-rose-500">{(watchAction.error as Error).message}</p>
            ) : null}
            {status?.watchEnabled ? (
              <p className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" /> Auto-starts with the daemon (persisted).
              </p>
            ) : null}
          </div>
        </SectionCard>

        {/* Git integration */}
        <SectionCard title="Git intelligence" action={<GitCommitHorizontal className="size-3.5 text-muted-foreground" />}>
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Install the post-commit hook so every commit (from Codex, Hermes, you) lands in the
              brain — timeline events, file-node updates and deterministic bug auto-resolution
              (<span className="font-mono">fix: …</span> commits close matching open bugs).
            </p>
            <div className="rounded-lg border border-border/60 bg-background/60">
              <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                  <Terminal className="size-3" /> install the hook (from the CortexOS repo root)
                </span>
                <CopyButton text={hookCommand} label="Copy" />
              </div>
              <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed">{hookCommand}</pre>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={ingest.isPending || !rootPath}
                onClick={() => ingest.mutate()}
              >
                <Download className={ingest.isPending ? 'size-3.5 animate-pulse' : 'size-3.5'} />
                {ingest.isPending ? 'Ingesting…' : 'Run git log ingest now'}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                no-hook fallback: incremental <span className="font-mono">git log</span> backfill
              </span>
            </div>
            {ingestNote ? (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-emerald-600 dark:text-emerald-400">
                {ingestNote}
              </p>
            ) : null}
            {ingestError ? (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {ingestError}
              </p>
            ) : null}
            {commits.data && commits.data.commits.length > 0 ? (
              <ul className="max-h-40 space-y-1.5 overflow-auto">
                {commits.data.commits.slice(0, 6).map((c) => (
                  <li key={c.id} className="rounded-lg border border-border/60 bg-background/50 p-2 font-mono text-[11px]">
                    <p className="flex items-center gap-1.5">
                      <span className="text-primary">{c.hash.slice(0, 8)}</span>
                      <span className="truncate text-foreground">{c.message.split('\n')[0]}</span>
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {c.author ?? 'unknown'} · {timeAgo(c.committedAt)} · {c.filesCount} file(s)
                      {c.platform ? ` · via ${c.platform}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </SectionCard>
      </div>

      {/* Live event feed */}
      <SectionCard
        title="Live intelligence feed"
        action={<Activity className="size-3.5 text-muted-foreground" />}
      >
        {timeline.isLoading ? (
          <Skeleton className="h-28 rounded-lg" />
        ) : fileEvents.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            No file/git activity yet. Start the watcher and save a file in the workspace, or make a
            commit in a hooked repo — events appear here within a second.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {fileEvents.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-xs">
                <Radar className={`mt-0.5 size-3.5 shrink-0 ${e.kind.startsWith('file.') ? 'text-sky-500' : e.kind === 'git.commit' ? 'text-violet-500' : 'text-muted-foreground'}`} />
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{e.kind}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.message}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}

function MiniStat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-background/50 p-2 text-center">
      <p className={`font-mono text-sm font-semibold tabular-nums ${danger ? 'text-rose-500' : ''}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  )
}
