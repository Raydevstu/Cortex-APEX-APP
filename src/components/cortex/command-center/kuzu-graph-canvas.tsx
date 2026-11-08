'use client'

/**
 * Phase 4 — Interactive Knowledge Graph Explorer
 * (blueprint PHASE_4 §6 `KuzuGraphCanvas.tsx`).
 *
 * Live property-graph rendering with:
 *   - scope badges: IN-SCOPE (emerald, editable) / LOCKED (rose, sentinel-
 *     enforced) / governance (zinc)
 *   - scope-status filter chips (ALL / IN_SCOPE / LOCKED)
 *   - hop-radius ego-network filtering (ALL / 1-hop / 2-hop around the
 *     selected node — real edge traversal)
 *   - node inspector (FQN, AST signature, line span, cyclomatic complexity,
 *     connected edges) with one-click scope-lock toggling
 */
import { useMemo, useState } from 'react'
import { Lock, Unlock, Scan, GitBranch, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import type { GraphEdgeDTO, GraphNodeDTO } from '@/lib/cortex/types'
import { cn } from '@/lib/utils'

type FilterMode = 'ALL' | 'IN_SCOPE' | 'LOCKED'
type HopRadius = 'ALL' | '1' | '2'

export interface KuzuGraphCanvasProps {
  nodes: GraphNodeDTO[]
  edges: GraphEdgeDTO[]
  onToggleScopeLock: (fqn: string) => void
  togglingFqn?: string | null
}

const KIND_STYLES: Record<string, string> = {
  Module: 'text-indigo-400',
  Root: 'text-indigo-400',
  Tech: 'text-cyan-400',
  Feature: 'text-teal-400',
  External: 'text-zinc-400',
  SourceFile: 'text-sky-400',
  ASTSymbol: 'text-violet-400',
  ArchitecturalDecision: 'text-purple-400',
  Task: 'text-amber-400',
  Bug: 'text-rose-400',
  SessionTurn: 'text-emerald-400',
}

export function KuzuGraphCanvas({ nodes, edges, onToggleScopeLock, togglingFqn }: KuzuGraphCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterMode, setFilterMode] = useState<FilterMode>('ALL')
  const [hopRadius, setHopRadius] = useState<HopRadius>('ALL')

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const selected = selectedId ? nodeById.get(selectedId) ?? null : null

  /** Ego-network: BFS over the live edge list from the selected node. */
  const egoIds = useMemo(() => {
    if (!selected || hopRadius === 'ALL') return null
    const radius = Number(hopRadius)
    const seen = new Set<string>([selected.id])
    let frontier = [selected.id]
    for (let depth = 0; depth < radius; depth++) {
      const next: string[] = []
      for (const edge of edges) {
        if (frontier.includes(edge.source) && !seen.has(edge.target)) {
          seen.add(edge.target)
          next.push(edge.target)
        }
        if (frontier.includes(edge.target) && !seen.has(edge.source)) {
          seen.add(edge.source)
          next.push(edge.source)
        }
      }
      frontier = next
    }
    return seen
  }, [selected, hopRadius, edges])

  const visibleNodes = useMemo(
    () =>
      nodes.filter((node) => {
        if (egoIds && !egoIds.has(node.id)) return false
        if (filterMode === 'ALL') return true
        return node.scopeStatus === filterMode
      }),
    [nodes, filterMode, egoIds],
  )

  const connectedEdges = useMemo(
    () =>
      selected
        ? edges.filter((e) => e.source === selected.id || e.target === selected.id)
        : [],
    [edges, selected],
  )

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-6 py-12 text-center">
        <Scan className="mb-3 size-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">Knowledge Graph is empty</p>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          Generate Project DNA (Projects → DNA → Scan workspace) to seed modules, files and symbols.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Scope</span>
          {(['ALL', 'IN_SCOPE', 'LOCKED'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={cn(
                'rounded px-2.5 py-1 font-mono text-[11px] transition-colors',
                filterMode === mode
                  ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted',
              )}
            >
              {mode === 'IN_SCOPE' ? 'IN-SCOPE' : mode === 'LOCKED' ? 'LOCKED' : 'ALL'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Hop radius</span>
          {(['ALL', '1', '2'] as const).map((radius) => (
            <button
              key={radius}
              onClick={() => setHopRadius(radius)}
              disabled={!selected && radius !== 'ALL'}
              className={cn(
                'rounded px-2.5 py-1 font-mono text-[11px] transition-colors disabled:opacity-40',
                hopRadius === radius
                  ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted',
              )}
            >
              {radius === 'ALL' ? 'FULL' : `${radius}-HOP`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Node topology grid */}
        <div className="lg:col-span-3">
          <ScrollArea className="h-[440px] rounded-lg border border-border/60 bg-muted/20">
            <div className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2">
              {visibleNodes.map((node) => {
                const isSelected = selected?.id === node.id
                const badge =
                  node.scopeStatus === 'IN_SCOPE'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                    : node.scopeStatus === 'LOCKED'
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-400'
                      : 'border-border bg-muted/60 text-muted-foreground'
                return (
                  <button
                    key={node.id}
                    onClick={() => setSelectedId(node.id)}
                    className={cn(
                      'flex min-w-0 flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors',
                      isSelected
                        ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/25'
                        : 'border-border/60 bg-card/70 hover:border-border hover:bg-card',
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className={cn('font-mono text-[10px] font-semibold uppercase tracking-wider', KIND_STYLES[node.label] ?? 'text-muted-foreground')}>
                        {node.label}
                      </span>
                      {(node.fqn || node.filePath) && (
                        <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold', badge)}>
                          {node.scopeStatus === 'IN_SCOPE' ? 'IN-SCOPE' : node.scopeStatus === 'LOCKED' ? 'LOCKED' : 'CTX'}
                        </span>
                      )}
                    </span>
                    <span className="w-full truncate text-[13px] font-medium">{node.title}</span>
                    {node.subtitle ? (
                      <span className="w-full truncate font-mono text-[10px] text-muted-foreground">{node.subtitle}</span>
                    ) : null}
                    {typeof node.complexity === 'number' ? (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        complexity <span className={cn('font-semibold', node.complexity > 12 ? 'text-rose-400' : node.complexity > 7 ? 'text-amber-500' : 'text-emerald-500')}>{node.complexity}</span>
                        {node.lineSpan ? ` · ${node.lineSpan}` : ''}
                      </span>
                    ) : null}
                  </button>
                )
              })}
              {visibleNodes.length === 0 ? (
                <div className="col-span-full py-10 text-center text-xs text-muted-foreground">
                  No nodes match the current filters.
                </div>
              ) : null}
            </div>
          </ScrollArea>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {visibleNodes.length} of {nodes.length} nodes · {edges.length} edges · click a node, then use the hop radius to focus its ego-network
          </p>
        </div>

        {/* Node inspector */}
        <div className="lg:col-span-2">
          <div className="flex h-[440px] flex-col rounded-lg border border-border/60 bg-card/70 p-4">
            {selected ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('font-mono text-[10px] font-semibold uppercase tracking-wider', KIND_STYLES[selected.label] ?? 'text-muted-foreground')}>
                    {selected.label} inspector
                  </span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground" title={selected.id}>
                    {selected.id}
                  </span>
                </div>
                <h3 className="mt-2 break-all text-sm font-semibold">{selected.title}</h3>

                {selected.fqn ? (
                  <Field label="Fully Qualified Name (FQN)">
                    <code className="break-all">{selected.fqn}</code>
                  </Field>
                ) : null}
                {selected.signature ? (
                  <Field label="AST signature">
                    <code className="break-all text-emerald-500">{selected.signature}</code>
                  </Field>
                ) : null}
                {typeof selected.complexity === 'number' ? (
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Cyclomatic complexity</span>
                    <span className={cn('font-mono font-semibold', selected.complexity > 12 ? 'text-rose-400' : selected.complexity > 7 ? 'text-amber-500' : 'text-emerald-500')}>
                      {selected.complexity}
                    </span>
                  </div>
                ) : null}

                <div className="mt-3 border-t border-border/60 pt-2">
                  <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Connected edges ({connectedEdges.length})
                  </p>
                  <ScrollArea className="max-h-32">
                    <ul className="space-y-1">
                      {connectedEdges.map((edge) => (
                        <li key={edge.id} className="rounded bg-muted/40 px-2 py-1 font-mono text-[10px] leading-relaxed">
                          <span className="text-muted-foreground">{shortId(edge.source, nodes)}</span>
                          <span className="mx-1 text-primary">—[{edge.relationship}]→</span>
                          <span className="text-muted-foreground">{shortId(edge.target, nodes)}</span>
                        </li>
                      ))}
                      {connectedEdges.length === 0 ? (
                        <li className="px-1 py-1 text-[10px] text-muted-foreground">No edges reference this node.</li>
                      ) : null}
                    </ul>
                  </ScrollArea>
                </div>

                <div className="mt-auto pt-3">
                  {selected.fqn ? (
                    <Button
                      variant={selected.scopeStatus === 'IN_SCOPE' ? 'destructive' : 'default'}
                      size="sm"
                      className="w-full gap-1.5 font-mono text-[11px]"
                      disabled={togglingFqn === selected.fqn}
                      onClick={() => onToggleScopeLock(selected.fqn!)}
                    >
                      {togglingFqn === selected.fqn ? (
                        <Skeleton className="size-3.5" />
                      ) : selected.scopeStatus === 'IN_SCOPE' ? (
                        <Lock className="size-3.5" />
                      ) : (
                        <Unlock className="size-3.5" />
                      )}
                      {selected.scopeStatus === 'IN_SCOPE'
                        ? 'LOCK SYMBOL IN PRETOOLUSE SENTINEL'
                        : 'UNLOCK SYMBOL FOR ACTIVE TASK'}
                    </Button>
                  ) : (
                    <p className="rounded bg-muted/40 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
                      <ShieldCheck className="mr-1 inline size-3.5" />
                      Governance node — scope locks apply to SourceFile / ASTSymbol nodes.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <GitBranch className="mb-3 size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">Select a node to inspect</p>
                <p className="mt-1 max-w-[220px] text-xs leading-relaxed text-muted-foreground">
                  The inspector shows the AST signature, complexity and live scope status, and lets you toggle the PreToolUse scope lock.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 break-all rounded border border-border/60 bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
        {children}
      </div>
    </div>
  )
}

function shortId(id: string, nodes: GraphNodeDTO[]): string {
  const node = nodes.find((n) => n.id === id)
  return node ? node.title : id.replace(/^(db|sym|file|adr|task|turn):/, '')
}
