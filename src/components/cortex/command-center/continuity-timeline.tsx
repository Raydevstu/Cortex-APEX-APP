'use client'

/**
 * Phase 4 — Session Continuity & Cross-Platform Timeline
 * (blueprint PHASE_4 §1.2 `ContinuityTimeline.tsx`).
 *
 * Chronological stream of ExtractedMemoryDelta commits captured across
 * platforms (session turns, Tier-1 rewrites, pre-exec agent runs, sync
 * handoffs, git commits) with AST symbol diffs and ratified decisions.
 */
import { ArrowLeftRight, Bot, GitCommitHorizontal, MessageSquare, Sparkles } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ContinuityTimelineEvent } from '@/lib/cortex/types'
import { cn } from '@/lib/utils'
import { timeAgo } from '../shared'

const KIND_META: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
  'session-turn': { icon: <MessageSquare className="size-3.5" />, label: 'Session turn', className: 'text-emerald-500 bg-emerald-500/10' },
  'tier1-rewrite': { icon: <Sparkles className="size-3.5" />, label: 'Tier-1 rewrite', className: 'text-violet-400 bg-violet-500/10' },
  'pre-exec-agent': { icon: <Bot className="size-3.5" />, label: 'Pre-exec agent', className: 'text-amber-500 bg-amber-500/10' },
  handoff: { icon: <ArrowLeftRight className="size-3.5" />, label: 'Handoff', className: 'text-sky-500 bg-sky-500/10' },
  'git-commit': { icon: <GitCommitHorizontal className="size-3.5" />, label: 'Git commit', className: 'text-rose-400 bg-rose-500/10' },
}

const CHANGE_STYLES: Record<string, string> = {
  added: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
  modified: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  deleted: 'border-rose-500/40 bg-rose-500/10 text-rose-400',
}

export function ContinuityTimeline({ events }: { events: ContinuityTimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-6 py-10 text-center">
        <MessageSquare className="mb-3 size-7 text-muted-foreground/50" />
        <p className="text-sm font-medium">No continuity events yet</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
          Every session turn, rewrite, agent run, handoff and commit for this project streams here automatically.
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="max-h-[560px] pr-3">
      <ol className="relative space-y-3 border-l border-border/70 pl-4">
        {events.map((event) => {
          const meta = KIND_META[event.kind] ?? KIND_META['session-turn']
          return (
            <li key={event.turnId} className="relative">
              <span
                className={cn(
                  'absolute -left-[26px] top-1 flex size-5 items-center justify-center rounded-full border border-border bg-card',
                  meta.className,
                )}
              >
                {meta.icon}
              </span>
              <div className="rounded-lg border border-border/60 bg-card/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase', meta.className)}>
                      {meta.label}
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">[{event.platform}]</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground" title={event.timestamp}>
                    {timeAgo(event.timestamp)}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed">{event.summary}</p>
                {event.tokensSaved > 0 ? (
                  <p className="mt-1 font-mono text-[11px] text-emerald-500">
                    ↓ {event.tokensSaved.toLocaleString()} tokens saved
                  </p>
                ) : null}
                {event.symbolsTouched.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {event.symbolsTouched.map((sym, i) => (
                      <span
                        key={`${event.turnId}-${i}`}
                        className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px]', CHANGE_STYLES[sym.changeType] ?? CHANGE_STYLES.modified)}
                        title={sym.fqn}
                      >
                        {sym.changeType.toUpperCase()}: {sym.fqn.split('/').pop()}
                      </span>
                    ))}
                  </div>
                ) : null}
                {event.decisionsRatified.length > 0 ? (
                  <p className="mt-1.5 font-mono text-[10px] text-purple-400">
                    ✓ ratified: {event.decisionsRatified.join(' · ')}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </ScrollArea>
  )
}
