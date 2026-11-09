// src/lib/cortex/vector-store.ts
//
// Gap #6 — Kuzu/Lance-style embedded graph + vector store.
//
// The project already persists a property graph in SQLite (graph.ts) and
// stores L2-normalised embeddings on the Memory row (embeddings.ts). This
// module unifies both into a single "vector store" surface:
//   - upsertVector(entityKind, entityId, text, provider?)  → stores/refreshes
//     the embedding for a graph node or memory row.
//   - semanticSearch(projectId, query, { kind, limit })     → cosine-similarity
//     ranking over stored embeddings, returning symbolic pointers (zero-token).
//   - hybridSearch(projectId, query)                        → merges graph
//     contextSubgraph pointers with semantic hits.
//
// No native Kuzu/Lance dependency is required: SQLite + the existing
// embedding provider chain cover the same retrieval contract. The interface
// is shaped so a future swap to Kuzu/Lance is a drop-in.

import { db } from '@/lib/db'
import { embedText, cosineSimilarity } from './embeddings'
import { getSettings } from './settings'
import { contextSubgraph } from './graph'
import type { GraphContextPointer } from './types'

export interface VectorHit {
  id: string
  kind: string
  label: string
  score: number
  text: string
  provider: string
}

export interface HybridResult {
  semantic: VectorHit[]
  graph: GraphContextPointer[]
}

const KIND_MEMORY = 'memory'
const KIND_NODE = 'node'

export async function upsertVector(
  projectId: string,
  kind: string,
  entityId: string,
  text: string,
): Promise<{ provider: string; dims: number }> {
  const settings = await getSettings()
  const { vector, provider } = await embedText(text, settings.ollamaBaseUrl, settings.ollamaEmbeddingModel)

  if (kind === KIND_MEMORY) {
    await (db.memory as any).update({
      where: { id: entityId },
      data: { embedding: JSON.stringify(vector), embeddingProvider: provider },
    })
  } else if (kind === KIND_NODE) {
    const node = await db.graphNode.findUnique({ where: { id: entityId } })
    if (!node) throw new Error('graph node not found')
    const props = safeParse(node.props)
    props.embedding = vector
    props.embeddingProvider = provider
    props.embeddingText = text.slice(0, 500)
    await db.graphNode.update({ where: { id: entityId }, data: { props: JSON.stringify(props) } })
  } else {
    throw new Error(`unknown vector kind: ${kind}`)
  }
  return { provider, dims: vector.length }
}

export async function semanticSearch(
  projectId: string,
  query: string,
  options: { kind?: 'memory' | 'node' | 'all'; limit?: number } = {},
): Promise<VectorHit[]> {
  const kind = options.kind ?? 'all'
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50))
  const settings = await getSettings()
  const { vector: queryVec } = await embedText(query, settings.ollamaBaseUrl, settings.ollamaEmbeddingModel)

  const hits: VectorHit[] = []

  if (kind === 'memory' || kind === 'all') {
    const memories = await (db.memory as any).findMany({ where: { projectId } })
    for (const m of memories) {
      if (!m.embedding) continue
      let vec: number[] = []
      try { vec = JSON.parse(m.embedding) as number[] } catch { continue }
      if (!Array.isArray(vec) || vec.length === 0) continue
      hits.push({
        id: m.id,
        kind: 'memory',
        label: `${m.type}::${m.key}`,
        score: cosineSimilarity(queryVec, vec),
        text: m.value.slice(0, 300),
        provider: m.embeddingProvider ?? 'unknown',
      })
    }
  }

  if (kind === 'node' || kind === 'all') {
    const nodes = await db.graphNode.findMany({ where: { projectId } })
    for (const n of nodes) {
      const props = safeParse(n.props)
      const vec = props.embedding
      if (!Array.isArray(vec) || vec.length === 0) continue
      hits.push({
        id: n.id,
        kind: 'node',
        label: `${n.kind}:${n.label}`,
        score: cosineSimilarity(queryVec, vec as number[]),
        text: String(props.embeddingText ?? n.label),
        provider: String(props.embeddingProvider ?? 'unknown'),
      })
    }
  }

  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

export async function hybridSearch(projectId: string, query: string, limit = 10): Promise<HybridResult> {
  const [semantic, graph] = await Promise.all([
    semanticSearch(projectId, query, { kind: 'all', limit }),
    contextSubgraph(projectId, query, limit),
  ])
  return { semantic, graph }
}

export async function embedProjectMemories(projectId: string): Promise<{ embedded: number; skipped: number }> {
  const memories = await (db.memory as any).findMany({ where: { projectId } })
  const settings = await getSettings()
  let embedded = 0
  let skipped = 0
  for (const m of memories) {
    if (m.embedding) { skipped++; continue }
    try {
      await upsertVector(projectId, KIND_MEMORY, m.id, `${m.key}\n${m.value}`)
      embedded++
    } catch {
      skipped++
    }
  }
  return { embedded, skipped }
}

export async function embedProjectNodes(projectId: string): Promise<{ embedded: number; skipped: number }> {
  const nodes = await db.graphNode.findMany({ where: { projectId } })
  let embedded = 0
  let skipped = 0
  for (const n of nodes) {
    const props = safeParse(n.props)
    if (Array.isArray(props.embedding)) { skipped++; continue }
    try {
      await upsertVector(projectId, KIND_NODE, n.id, `${n.kind} ${n.label} ${JSON.stringify(props)}`)
      embedded++
    } catch {
      skipped++
    }
  }
  return { embedded, skipped }
}

function safeParse(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown> } catch { return {} }
}
