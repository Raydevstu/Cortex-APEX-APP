'use client'

/**
 * Knowledge Graph tab — interactive triple store explorer with the
 * force-directed canvas, node inspector and triple writer.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useMemo, useState } from 'react'
import { GitBranch, Plus, Trash2, ArrowRight, CircleDot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cortexApi } from '@/lib/cortex-client'
import { EmptyState } from './shared'
import { GraphCanvas, KIND_COLORS } from './graph-canvas'
import { cn } from '@/lib/utils'

const KINDS = ['root', 'module', 'tech', 'feature', 'bug', 'external'] as const
const RELATIONS = ['CONTAINS', 'USES', 'DEPENDS_ON', 'IMPLEMENTS', 'BLOCKED_BY', 'HAS_BUG', 'PREFERS', 'SYNCED_WITH'] as const

export function GraphTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['graph', projectId], queryFn: () => cortexApi.graph(projectId) })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [showAdd, setShowAdd] = useState(false)

  const addNodeMutation = useMutation({
    mutationFn: ({ kind, label }: { kind: string; label: string }) => cortexApi.addGraphNode(projectId, kind, label),
    onSuccess: () => {
      toast.success('Node added to the Knowledge Graph.')
      queryClient.invalidateQueries({ queryKey: ['graph', projectId] })
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
    },
    onError: (error: Error) => toast.error(`Add node failed: ${error.message}`),
  })

  const addEdgeMutation = useMutation({
    mutationFn: ({ sourceLabel, relation, targetLabel }: { sourceLabel: string; relation: string; targetLabel: string }) =>
      cortexApi.addGraphEdge(projectId, sourceLabel, relation, targetLabel),
    onSuccess: (result) => {
      toast.success(`Triple written: ${result.edge}`)
      queryClient.invalidateQueries({ queryKey: ['graph', projectId] })
    },
    onError: (error: Error) => toast.error(`Add edge failed: ${error.message}`),
  })

  const deleteNodeMutation = useMutation({
    mutationFn: (nodeId: string) => cortexApi.deleteGraphNode(projectId, nodeId),
    onSuccess: () => {
      toast.success('Node and its edges removed.')
      setSelectedId(null)
      queryClient.invalidateQueries({ queryKey: ['graph', projectId] })
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
    },
    onError: (error: Error) => toast.error(`Delete failed: ${error.message}`),
  })

  const graph = data ?? { nodes: [], edges: [] }

  const visibleNodes = useMemo(
    () => (kindFilter === 'all' ? graph.nodes : graph.nodes.filter((n) => n.kind === kindFilter)),
    [graph.nodes, kindFilter],
  )
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes])
  const visibleEdges = useMemo(
    () => graph.edges.filter((e) => visibleNodeIds.has(e.sourceId) && visibleNodeIds.has(e.targetId)),
    [graph.edges, visibleNodeIds],
  )

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null
  const neighbors = useMemo(() => {
    if (!selectedId) return []
    return graph.edges
      .filter((e) => e.sourceId === selectedId || e.targetId === selectedId)
      .map((e) => {
        const isSource = e.sourceId === selectedId
        const other = graph.nodes.find((n) => n.id === (isSource ? e.targetId : e.sourceId))
        return other ? { relation: isSource ? e.relation : `← ${e.relation}`, other } : null
      })
      .filter((x): x is { relation: string; other: (typeof graph.nodes)[number] } => Boolean(x))
  }, [selectedId, graph.edges, graph.nodes])

  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of graph.nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1)
    return counts
  }, [graph.nodes])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-4 py-3">
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <GitBranch className="size-3.5" /> {graph.nodes.length} nodes · {graph.edges.length} triples
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setKindFilter('all')}
            className={cn(
              'rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors',
              kindFilter === 'all' ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border/70 text-muted-foreground hover:text-foreground',
            )}
          >
            all ({graph.nodes.length})
          </button>
          {KINDS.filter((kind) => kindCounts.get(kind)).map((kind) => (
            <button
              key={kind}
              onClick={() => setKindFilter(kind)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors',
                kindFilter === kind ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border/70 text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="size-2 rounded-full" style={{ background: KIND_COLORS[kind] }} />
              {kind} ({kindCounts.get(kind)})
            </button>
          ))}
          <Button size="sm" variant="outline" className="ml-1 h-7 gap-1 text-xs" onClick={() => setShowAdd((v) => !v)}>
            <Plus className="size-3.5" /> Add triple
          </Button>
        </div>
      </div>

      {/* Triple writer */}
      {showAdd ? (
        <TripleWriter
          pendingNode={addNodeMutation.isPending}
          pendingEdge={addEdgeMutation.isPending}
          existingLabels={graph.nodes.map((n) => n.label)}
          onAddNode={(kind, label) => addNodeMutation.mutate({ kind, label })}
          onAddEdge={(sourceLabel, relation, targetLabel) => addEdgeMutation.mutate({ sourceLabel, relation, targetLabel })}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Canvas */}
        <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card/40 lg:col-span-2">
          {isLoading ? (
            <Skeleton className="h-[460px] rounded-xl" />
          ) : visibleNodes.length === 0 ? (
            <div className="flex h-[460px] items-center justify-center">
              <EmptyState
                icon={<GitBranch className="size-10" />}
                title="No graph state"
                description="Generate the PROJECT DNA from a workspace scan or capture an interaction — tech and module triples appear here automatically."
              />
            </div>
          ) : (
            <>
              <div className="h-[460px]" onClick={() => setSelectedId(null)}>
                <GraphCanvas
                  key={visibleNodes.map((n) => n.id).sort().join('|')}
                  nodes={visibleNodes}
                  edges={visibleEdges}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
              <p className="absolute bottom-2 left-3 font-mono text-[10px] text-muted-foreground/70">
                drag nodes · click to inspect
              </p>
            </>
          )}
        </div>

        {/* Inspector */}
        <div className="rounded-xl border border-border/60 bg-card/60">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <CircleDot className="size-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Node inspector</h3>
          </div>
          <div className="max-h-[460px] overflow-y-auto p-4">
            {!selected ? (
              <p className="py-8 text-center text-xs leading-relaxed text-muted-foreground">
                Select a node in the canvas to inspect its properties and one-hop neighbourhood.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="size-3 rounded-full" style={{ background: KIND_COLORS[selected.kind] ?? 'var(--muted-foreground)' }} />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{selected.kind}</span>
                  </div>
                  <p className="mt-1 break-words text-base font-semibold">{selected.label}</p>
                  {Object.keys(selected.props).length > 0 ? (
                    <dl className="mt-3 space-y-1.5">
                      {Object.entries(selected.props).map(([key, value]) => (
                        <div key={key} className="flex gap-2 text-[11px]">
                          <dt className="shrink-0 font-mono text-muted-foreground">{key}</dt>
                          <dd className="min-w-0 break-words">{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>

                <div className="border-t border-border/60 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Neighbourhood ({neighbors.length})
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {neighbors.map(({ relation, other }, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-xs">
                        <button className="min-w-0 flex-1 truncate text-left hover:text-primary" onClick={() => setSelectedId(other.id)}>
                          ({other.label})
                        </button>
                        <span className="shrink-0 font-mono text-[10px] text-primary/80">{relation}</span>
                        <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                      </li>
                    ))}
                  </ul>
                </div>

                {selected.kind !== 'root' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => deleteNodeMutation.mutate(selected.id)}
                    disabled={deleteNodeMutation.isPending}
                  >
                    <Trash2 className="size-3.5" /> Delete node
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function TripleWriter({
  pendingNode,
  pendingEdge,
  existingLabels,
  onAddNode,
  onAddEdge,
}: {
  pendingNode: boolean
  pendingEdge: boolean
  existingLabels: string[]
  onAddNode: (kind: string, label: string) => void
  onAddEdge: (sourceLabel: string, relation: string, targetLabel: string) => void
}) {
  const [nodeKind, setNodeKind] = useState('module')
  const [nodeLabel, setNodeLabel] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [relation, setRelation] = useState('USES')
  const [targetLabel, setTargetLabel] = useState('')

  return (
    <div className="grid gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:grid-cols-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Add node</p>
        <div className="mt-2 space-y-2">
          <Select value={nodeKind} onValueChange={setNodeKind}>
            <SelectTrigger className="h-8 text-xs" aria-label="Node kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>{kind}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Input
              value={nodeLabel}
              onChange={(e) => setNodeLabel(e.target.value)}
              placeholder="Label, e.g. Notifications"
              className="h-8 text-xs"
              aria-label="Node label"
            />
            <Button
              size="sm"
              className="h-8 shrink-0"
              disabled={pendingNode || nodeLabel.trim().length < 2}
              onClick={() => {
                onAddNode(nodeKind, nodeLabel.trim())
                setNodeLabel('')
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Add edge (triple)</p>
        <div className="mt-2 space-y-2">
          <Select value={relation} onValueChange={setRelation}>
            <SelectTrigger className="h-8 text-xs" aria-label="Relation">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RELATIONS.map((rel) => (
                <SelectItem key={rel} value={rel}>{rel}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <Input
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              placeholder="(source)"
              className="h-8 text-xs"
              list="graph-labels"
              aria-label="Source label"
            />
            <span className="shrink-0 font-mono text-[10px] text-primary">—[{relation}]→</span>
            <Input
              value={targetLabel}
              onChange={(e) => setTargetLabel(e.target.value)}
              placeholder="(target)"
              className="h-8 text-xs"
              list="graph-labels"
              aria-label="Target label"
            />
            <Button
              size="sm"
              className="h-8 shrink-0"
              disabled={pendingEdge || sourceLabel.trim().length < 2 || targetLabel.trim().length < 2}
              onClick={() => {
                onAddEdge(sourceLabel.trim(), relation, targetLabel.trim())
                setSourceLabel('')
                setTargetLabel('')
              }}
            >
              Link
            </Button>
          </div>
          <datalist id="graph-labels">
            {existingLabels.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </div>
      </div>
    </div>
  )
}
