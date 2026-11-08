'use client'

/**
 * Knowledge Graph canvas — dependency-free force-directed SVG layout.
 * Deterministic seeded initial positions, Verlet-style relaxation on the
 * client, draggable nodes, click-to-inspect. Handles Phase 1 graph scale
 * (dozens–hundreds of triples) comfortably.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface CanvasNode {
  id: string
  label: string
  kind: string
  props?: Record<string, unknown>
}
export interface CanvasEdge {
  id: string
  sourceId: string
  targetId: string
  relation: string
}

interface SimNode extends CanvasNode {
  x: number
  y: number
  vx: number
  vy: number
  pinned?: boolean
}

export const KIND_COLORS: Record<string, string> = {
  root: 'var(--chart-1)',
  module: 'var(--chart-2)',
  tech: 'var(--chart-3)',
  feature: 'var(--chart-4)',
  bug: 'var(--chart-5)',
  external: 'var(--muted-foreground)',
}

const WIDTH = 900
const HEIGHT = 560

/** Deterministic seeded layout — same node set, same initial positions. */
function seedNodes(nodes: CanvasNode[]): SimNode[] {
  return nodes.map((node, index) => {
    const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2
    const radius = 120 + ((index * 37) % 160)
    return {
      ...node,
      x: WIDTH / 2 + radius * Math.cos(angle + (index % 5)),
      y: HEIGHT / 2 + radius * Math.sin(angle + (index % 3)),
      vx: 0,
      vy: 0,
    }
  })
}

export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  // Seeded lazily from the initial node set. The parent remounts this
  // component (via key) whenever the visible node set changes, so no
  // effect-synced state is needed.
  const [sim, setSim] = useState<SimNode[]>(() => seedNodes(nodes))
  const dragId = useRef<string | null>(null)

  // Relaxation loop: repulsion (all pairs) + spring attraction (edges).
  useEffect(() => {
    if (sim.length === 0) return
    let cancelled = false
    let iteration = 0
    const maxIterations = 220

    const step = () => {
      if (cancelled || iteration >= maxIterations) return
      iteration += 1
      const cooling = 1 - iteration / maxIterations

      setSim((current) => {
        const next = current.map((n) => ({ ...n }))
        const nodeById = new Map(next.map((n) => [n.id, n]))

        // Pairwise repulsion
        for (let i = 0; i < next.length; i++) {
          for (let j = i + 1; j < next.length; j++) {
            const a = next[i]
            const b = next[j]
            let dx = b.x - a.x
            let dy = b.y - a.y
            let dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < 0.01) {
              dx = (Math.random() - 0.5) * 2
              dy = (Math.random() - 0.5) * 2
              dist = 1
            }
            const minDist = a.kind === 'root' || b.kind === 'root' ? 150 : 78
            const force = (9000 / (dist * dist)) * (dist < minDist * 2.4 ? 1 : 0.25)
            const fx = (dx / dist) * force
            const fy = (dy / dist) * force
            a.vx -= fx
            a.vy -= fy
            b.vx += fx
            b.vy += fy
          }
        }

        // Spring attraction along edges
        for (const edge of edges) {
          const a = nodeById.get(edge.sourceId)
          const b = nodeById.get(edge.targetId)
          if (!a || !b) continue
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const target = 120
          const force = (dist - target) * 0.012
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.vx += fx
          a.vy += fy
          b.vx -= fx
          b.vy -= fy
        }

        // Integrate + bounds
        for (const node of next) {
          if (dragId.current === node.id) continue
          if (node.pinned) {
            node.vx = 0
            node.vy = 0
            continue
          }
          node.vx *= 0.82
          node.vy *= 0.82
          node.x += Math.max(-14, Math.min(14, node.vx * cooling))
          node.y += Math.max(-14, Math.min(14, node.vy * cooling))
          node.x = Math.max(46, Math.min(WIDTH - 46, node.x))
          node.y = Math.max(30, Math.min(HEIGHT - 30, node.y))
        }
        return next
      })

      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
    return () => {
      cancelled = true
    }
  }, [edges, sim.length])

  const toSvgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * WIDTH,
      y: ((clientY - rect.top) / rect.height) * HEIGHT,
    }
  }, [])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragId.current) return
      const point = toSvgPoint(event.clientX, event.clientY)
      setSim((current) =>
        current.map((n) => (n.id === dragId.current ? { ...n, x: point.x, y: point.y, vx: 0, vy: 0 } : n)),
      )
    }
    const up = () => {
      dragId.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [toSvgPoint])

  const nodeById = useMemo(() => new Map(sim.map((n) => [n.id, n])), [sim])
  const degree = useMemo(() => {
    const counts = new Map<string, number>()
    for (const edge of edges) {
      counts.set(edge.sourceId, (counts.get(edge.sourceId) ?? 0) + 1)
      counts.set(edge.targetId, (counts.get(edge.targetId) ?? 0) + 1)
    }
    return counts
  }, [edges])

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-full w-full touch-none select-none"
      role="img"
      aria-label="Knowledge Graph visualization"
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--muted-foreground)" opacity={0.7} />
        </marker>
      </defs>

      {/* Edges */}
      {edges.map((edge) => {
        const source = nodeById.get(edge.sourceId)
        const target = nodeById.get(edge.targetId)
        if (!source || !target) return null
        const mx = (source.x + target.x) / 2
        const my = (source.y + target.y) / 2
        const active = selectedId === edge.sourceId || selectedId === edge.targetId
        return (
          <g key={edge.id}>
            <line
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={active ? 'var(--chart-1)' : 'var(--border)'}
              strokeWidth={active ? 2 : 1.2}
              markerEnd="url(#arrow)"
              opacity={selectedId && !active ? 0.25 : 0.85}
            />
            {active ? (
              <text
                x={mx}
                y={my - 5}
                textAnchor="middle"
                className="fill-primary font-mono"
                fontSize={9}
              >
                {edge.relation}
              </text>
            ) : null}
          </g>
        )
      })}

      {/* Nodes */}
      {sim.map((node) => {
        const r = node.kind === 'root' ? 22 : 10 + Math.min(8, (degree.get(node.id) ?? 0) * 1.2)
        const selected = selectedId === node.id
        return (
          <g
            key={node.id}
            transform={`translate(${node.x}, ${node.y})`}
            className="cursor-pointer"
            onPointerDown={(event) => {
              event.stopPropagation()
              dragId.current = node.id
            }}
            onClick={(event) => {
              event.stopPropagation()
              onSelect(selected ? null : node.id)
            }}
          >
            <circle
              r={r + (selected ? 6 : 0)}
              fill={KIND_COLORS[node.kind] ?? 'var(--muted-foreground)'}
              opacity={selected ? 0.95 : 0.8}
              stroke={selected ? 'var(--foreground)' : 'var(--background)'}
              strokeWidth={selected ? 2 : 1.5}
            />
            {node.kind === 'bug' ? (
              <circle r={r} fill="none" stroke="var(--foreground)" strokeWidth={1} opacity={0.4} />
            ) : null}
            <text
              y={r + 13}
              textAnchor="middle"
              fontSize={node.kind === 'root' ? 12 : 10.5}
              className={cn('pointer-events-none font-medium', selected ? 'fill-foreground' : 'fill-muted-foreground')}
            >
              {node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
