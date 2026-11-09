// src/app/api/cortex/proxy/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { startReverseProxy, type ReverseProxyHandle } from '@/lib/cortex/reverse-proxy'

const registry = (globalThis as typeof globalThis & { __cortexProxyRegistry?: Map<string, ReverseProxyHandle> }).__cortexProxyRegistry
  ?? new Map<string, ReverseProxyHandle>()
;(globalThis as typeof globalThis & { __cortexProxyRegistry?: Map<string, ReverseProxyHandle> }).__cortexProxyRegistry = registry

const bodySchema = z.object({
  action: z.enum(['start', 'stop', 'status']),
  port: z.number().int().min(1024).max(65535).optional(),
  upstreamBaseUrl: z.string().url().optional(),
  projectId: z.string().min(1).optional(),
  platform: z.string().optional(),
  enablePreExec: z.boolean().optional(),
  enableMemory: z.boolean().optional(),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  const { action, port = 11435, upstreamBaseUrl, projectId, platform, enablePreExec, enableMemory } = parsed.data
  const key = String(port)

  if (action === 'status') {
    return NextResponse.json({ running: registry.has(key), port: Number(key), upstreamBaseUrl: registry.get(key)?.upstreamBaseUrl ?? null })
  }

  if (action === 'stop') {
    const handle = registry.get(key)
    if (!handle) return NextResponse.json({ stopped: false, reason: 'not running' })
    await handle.close()
    registry.delete(key)
    return NextResponse.json({ stopped: true, port: Number(key) })
  }

  // start
  if (!upstreamBaseUrl) {
    return NextResponse.json({ error: 'upstreamBaseUrl is required to start' }, { status: 400 })
  }
  if (registry.has(key)) {
    return NextResponse.json({ started: false, reason: 'already running', port: Number(key), upstreamBaseUrl: registry.get(key)!.upstreamBaseUrl })
  }
  try {
    const handle = await startReverseProxy({
      port,
      upstreamBaseUrl,
      projectId: projectId ?? null,
      platform: (platform as 'codex' | 'hermes' | 'opencode' | 'cursor' | 'claude' | 'chatgpt' | 'local_ollama') ?? 'codex',
      enablePreExec,
      enableMemory,
    })
    registry.set(key, handle)
    return NextResponse.json({ started: true, port: handle.port, upstreamBaseUrl: handle.upstreamBaseUrl })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed to start proxy' }, { status: 500 })
  }
}
