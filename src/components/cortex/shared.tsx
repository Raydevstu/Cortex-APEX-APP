'use client'

/**
 * Shared presentational primitives for the CortexOS Command Center.
 */
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, Copy, Star } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('h-8 gap-1.5 font-mono text-xs', className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          // Fallback for non-secure contexts
          const area = document.createElement('textarea')
          area.value = text
          document.body.appendChild(area)
          area.select()
          document.execCommand('copy')
          document.body.removeChild(area)
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
      aria-label={label}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : label}
    </Button>
  )
}

const TYPE_STYLES: Record<string, { label: string; className: string }> = {
  decision: { label: 'DECISION', className: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  architecture: { label: 'ARCH', className: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  requirement: { label: 'REQ', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  todo: { label: 'TODO', className: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  bug: { label: 'BUG', className: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
  preference: { label: 'PREF', className: 'bg-teal-500/15 text-teal-400 border-teal-500/30' },
}

export function TypeBadge({ type, className }: { type: string; className?: string }) {
  const style = TYPE_STYLES[type] ?? { label: type.toUpperCase(), className: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30' }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide',
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  )
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = 'violet',
}: {
  label: string
  value: string | number
  sub?: string
  icon?: React.ReactNode
  accent?: 'violet' | 'emerald' | 'amber' | 'teal' | 'rose' | 'sky'
}) {
  const accents: Record<string, string> = {
    violet: 'text-violet-400 bg-violet-500/[0.08] ring-violet-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/[0.08] ring-emerald-500/20',
    amber: 'text-amber-400 bg-amber-500/[0.08] ring-amber-500/20',
    teal: 'text-teal-400 bg-teal-500/[0.08] ring-teal-500/20',
    rose: 'text-rose-400 bg-rose-500/[0.08] ring-rose-500/20',
    sky: 'text-sky-400 bg-sky-500/[0.08] ring-sky-500/20',
  }
  return (
    <Card className="group relative overflow-hidden border-border/50 bg-card/40 backdrop-blur-sm transition-all hover:bg-card/60 hover:border-border/80">
      <CardContent className="p-4">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/0 to-transparent opacity-0 transition-opacity group-hover:opacity-100 group-hover:via-primary/20" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/80">{label}</p>
            <p className="mt-2 truncate font-mono text-[22px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
            {sub ? <p className="mt-1.5 truncate text-[11px] leading-snug text-muted-foreground">{sub}</p> : null}
          </div>
          {icon ? (
            <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 transition-colors', accents[accent])}>
              <span className="size-4">{icon}</span>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn('overflow-hidden border-border/50 bg-card/40 backdrop-blur-sm', className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/40 bg-card/20 px-4 py-3">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-muted-foreground/60">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function ImportanceStars({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`Importance ${value}/${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            'size-3',
            i < value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30',
          )}
        />
      ))}
    </span>
  )
}

export function StatusPill({
  ok,
  label,
  detail,
}: {
  ok: boolean
  label: string
  detail?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none',
        ok
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
          : 'border-amber-500/20 bg-amber-500/10 text-amber-400',
      )}
      title={detail}
    >
      <span className={cn('size-1.5 rounded-full', ok ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]')} />
      {label}
    </span>
  )
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export { Badge }
