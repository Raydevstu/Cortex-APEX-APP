/**
 * Ollama client — the Local LLM Layer transport (blueprint Pillar 8).
 *
 * Real HTTP integration against a configurable local Ollama daemon
 * (default http://127.0.0.1:11434). When Ollama is not reachable the
 * caller degrades gracefully to the deterministic Fast-Path engine —
 * CortexOS never hard-fails because a model is offline.
 */
import type { OllamaStatus } from './types'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const statusCache = new Map<string, { status: OllamaStatus; at: number }>()
const STATUS_TTL_MS = 15_000

export async function getOllamaStatus(baseUrl: string): Promise<OllamaStatus> {
  const cached = statusCache.get(baseUrl)
  if (cached && Date.now() - cached.at < STATUS_TTL_MS) {
    return cached.status
  }

  const started = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timer)

    if (!response.ok) {
      const status: OllamaStatus = {
        reachable: false,
        baseUrl,
        models: [],
        error: `Ollama responded ${response.status}`,
        latencyMs: Date.now() - started,
      }
      statusCache.set(baseUrl, { status, at: Date.now() })
      return status
    }

    const body = (await response.json()) as { models?: Array<{ name: string }> }
    const status: OllamaStatus = {
      reachable: true,
      baseUrl,
      models: (body.models ?? []).map((m) => m.name),
      latencyMs: Date.now() - started,
    }
    statusCache.set(baseUrl, { status, at: Date.now() })
    return status
  } catch (error) {
    const status: OllamaStatus = {
      reachable: false,
      baseUrl,
      models: [],
      error: error instanceof Error ? error.message : 'connection failed',
      latencyMs: Date.now() - started,
    }
    statusCache.set(baseUrl, { status, at: Date.now() })
    return status
  }
}

export function invalidateOllamaCache(baseUrl?: string): void {
  if (baseUrl) statusCache.delete(baseUrl)
  else statusCache.clear()
}

export async function ollamaChat(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  opts: { timeoutMs?: number; temperature?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 90_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: { temperature: opts.temperature ?? 0.2 },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Ollama chat failed (${response.status}): ${detail.slice(0, 200)}`)
    }

    const body = (await response.json()) as {
      message?: { content?: string }
    }
    const content = body.message?.content?.trim()
    if (!content) {
      throw new Error('Ollama returned an empty completion')
    }
    return content
  } finally {
    clearTimeout(timer)
  }
}
