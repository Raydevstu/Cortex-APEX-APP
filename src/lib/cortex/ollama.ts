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

export interface OllamaStructuredRequest<T> {
  model: string
  systemPrompt: string
  /** JSON-stringified into the user message (blueprint payload contract). */
  userPayload: Record<string, unknown>
  /** Ollama Structured Outputs grammar — passed verbatim as `format`. */
  jsonSchema: Record<string, unknown>
  temperature?: number
}

/**
 * Deterministic, zero-markdown-hallucination call to local Ollama using
 * Ollama's native `format` JSON-schema constraint (blueprint Part 2,
 * `callLocalOllamaStructured`). Low temperature + strict grammar so local
 * models (qwen2.5:1.5b … llama3.2:3b) never emit markdown wrappers or
 * invalid JSON. The caller validates the parsed result with zod and falls
 * back to the deterministic Fast-Path engine when anything is off.
 */
export async function ollamaChatStructured<T>(
  baseUrl: string,
  req: OllamaStructuredRequest<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        stream: false,
        format: req.jsonSchema,
        options: {
          temperature: req.temperature ?? 0.1, // Low temp for deterministic routing & code specs
          num_ctx: 8192,
        },
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: JSON.stringify(req.userPayload) },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Ollama structured call failed (${response.status}): ${detail.slice(0, 200)}`)
    }

    const data = (await response.json()) as { message?: { content?: string } }
    const content = data.message?.content?.trim()
    if (!content) {
      throw new Error('Ollama returned an empty structured completion')
    }

    // Some models still wrap the JSON in fences even with format constraints.
    const unwrapped = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    try {
      return JSON.parse(unwrapped) as T
    } catch {
      throw new Error(`Ollama structured output is not valid JSON: ${unwrapped.slice(0, 160)}`)
    }
  } finally {
    clearTimeout(timer)
  }
}
