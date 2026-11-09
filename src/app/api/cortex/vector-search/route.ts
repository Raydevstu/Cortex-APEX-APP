import { NextResponse } from 'next/server'
import { z } from 'zod'
import { semanticSearch, hybridSearch, embedProjectMemories, embedProjectNodes, upsertVector } from '@/lib/cortex/vector-store'

const bodySchema = z.object({
  action: z.enum(['search', 'hybrid', 'embed-memories', 'embed-nodes', 'upsert']),
  projectId: z.string().min(1),
  query: z.string().optional(),
  kind: z.enum(['memory', 'node', 'all']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  entityId: z.string().optional(),
  entityKind: z.string().optional(),
  text: z.string().optional(),
})

export async function POST(request: Request) {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  const { action, projectId, query, kind, limit, entityId, entityKind, text } = parsed.data

  try {
    switch (action) {
      case 'search': {
        if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 })
        const hits = await semanticSearch(projectId, query, { kind, limit })
        return NextResponse.json({ hits })
      }
      case 'hybrid': {
        if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 })
        const result = await hybridSearch(projectId, query, limit)
        return NextResponse.json(result)
      }
      case 'embed-memories': {
        const r = await embedProjectMemories(projectId)
        return NextResponse.json(r)
      }
      case 'embed-nodes': {
        const r = await embedProjectNodes(projectId)
        return NextResponse.json(r)
      }
      case 'upsert': {
        if (!entityId || !entityKind || !text) return NextResponse.json({ error: 'entityId, entityKind, text required' }, { status: 400 })
        const r = await upsertVector(projectId, entityKind, entityId, text)
        return NextResponse.json(r)
      }
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}
