'use client'

/**
 * Development Timeline tab (blueprint Pillar 11) — the project history
 * that is never lost: every memory, DNA generation, rewrite and graph
 * update, in order.
 */
import { useQuery } from '@tanstack/react-query'
import { Plus, Brain, ScrollText, Sparkles, GitBranch, Activity, ListTodo, AlertTriangle, RefreshCw } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchTimeline } from '@/lib/cortex-client'
import { EmptyState, timeAgo } from './shared'
import { cn } from '@/lib/utils'

const EVENT_META: Record<string, { icon: React.ReactNode; color: string }> = {
  'project.created': { icon: <Plus className="size-3.5" />, color: 'text-primary border-primary/40 bg-primary/10' },
  'dna.generated': { icon: <Brain className="size-3.5" />, color: 'text-teal-400 border-teal-500/40 bg-teal-500/10' },
  'dna.updated': { icon: <Brain className="size-3.5" />, color: 'text-teal-400 border-teal-500/40 bg-teal-500/10' },
  'memory.captured': { icon: <ScrollText className="size-3.5" />, color: 'text-violet-400 border-violet-500/40 bg-violet-500/10' },
  'memory.resolved': { icon: <ListTodo className="size-3.5" />, color: 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10' },
  'prompt.rewritten': { icon: <Sparkles className="size-3.5" />, color: 'text-amber-500 border-amber-500/40 bg-amber-500/10' },
  'graph.updated': { icon: <GitBranch className="size-3.5" />, color: 'text-violet-400 border-violet-500/40 bg-violet-500/10' },
  'interaction.logged': { icon: <Activity className="size-3.5" />, color: 'text-muted-foreground border-border bg-muted' },
}

export function TimelineTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['timeline', projectId], queryFn: () => fetchTimeline(projectId) })
  const events = data?.events ?? []

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<RefreshCw className="size-10" />}
        title="Timeline is empty"
        description="Every memory capture, DNA scan, prompt rewrite and graph update lands here automatically — the project history that never gets lost."
      />
    )
  }

  // Group by day for scannability.
  const groups = new Map<string, typeof events>()
  for (const event of events) {
    const key = new Date(event.createdAt).toLocaleDateString(undefined, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    })
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(event)
  }

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([day, dayEvents]) => (
        <section key={day}>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{day}</h3>
          <ol className="relative space-y-3 border-l border-border/70 pl-6">
            {dayEvents.map((event) => {
              const meta = EVENT_META[event.kind] ?? {
                icon: <AlertTriangle className="size-3.5" />,
                color: 'text-muted-foreground border-border bg-muted',
              }
              return (
                <li key={event.id} className="relative">
                  <span
                    className={cn(
                      'absolute -left-[33px] flex size-6 items-center justify-center rounded-full border',
                      meta.color,
                    )}
                  >
                    {meta.icon}
                  </span>
                  <div className="rounded-lg border border-border/60 bg-card/60 p-3">
                    <p className="text-xs leading-relaxed">{event.message}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {event.kind} · {timeAgo(event.createdAt)} ·{' '}
                      {new Date(event.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
