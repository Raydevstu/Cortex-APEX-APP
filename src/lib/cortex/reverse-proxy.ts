// src/lib/cortex/reverse-proxy.ts
//
// Gap #4 — Local Reverse Proxy (localhost:11435/v1).
//
// OpenAI-compatible reverse proxy that sits between a coding agent (Codex,
// Hermes, OpenCode, Cursor, Claude) and the real upstream API. On every
// /v1/chat/completions request it:
//   1. extracts the latest user prompt,
//   2. runs the Cortex pre-execution pipeline (Engine 1 + Engine 2) to
//      produce a Tier-1 structured prompt + scope lock,
//   3. injects that as a system message so the upstream model receives only
//      the high-value core task,
//   4. forwards the (possibly rewritten) request to the configured upstream
//      base URL, streaming the response back verbatim,
//   5. captures the turn in the memory engine for cross-platform sync.
//
// All other paths are transparently proxied. The proxy binds to 127.0.0.1
// only and never logs credentials.

import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

import { db } from '@/lib/db'
import { runPreExecution } from './preexec'
import { extractAndApplyMemoryDelta } from './memory-delta'
import type { ExtractSourcePlatform } from './types'

export interface ReverseProxyOptions {
  port?: number
  /** Upstream OpenAI-compatible base URL, e.g. https://api.openai.com */
  upstreamBaseUrl: string
  projectId?: string | null
  /** Platform label recorded in memory + ledger. */
  platform?: ExtractSourcePlatform
  /** When false, proxy is transparent (no pre-exec injection). Default true. */
  enablePreExec?: boolean
  /** When false, skip memory extraction after the turn. Default true. */
  enableMemory?: boolean
  /** Request timeout (ms). Default 300000. */
  timeoutMs?: number
}

export interface ReverseProxyHandle {
  port: number
  upstreamBaseUrl: string
  close: () => Promise<void>
}

const DEFAULT_PORT = 11435
const DEFAULT_TIMEOUT = 300_000

interface ChatMessage {
  role: string
  content: string | Array<{ type?: string; text?: string }>
}

interface ChatCompletionBody {
  model?: string
  messages?: ChatMessage[]
  stream?: boolean
  [key: string]: unknown
}

function messageText(m: ChatMessage): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) {
    return m.content
      .map((b) => (typeof b?.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function lastUserPrompt(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const t = messageText(messages[i])
      if (t.trim()) return t.trim()
    }
  }
  return ''
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export async function startReverseProxy(options: ReverseProxyOptions): Promise<ReverseProxyHandle> {
  const port = options.port ?? DEFAULT_PORT
  const upstream = new URL(options.upstreamBaseUrl)
  if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
    throw new Error('upstreamBaseUrl must be an http(s) URL')
  }
  const upstreamOrigin = `${upstream.protocol}//${upstream.host}`
  const enablePreExec = options.enablePreExec !== false
  const enableMemory = options.enableMemory !== false
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const platform: ExtractSourcePlatform = options.platform ?? 'codex'

  let projectId = options.projectId ?? null
  if (!projectId) {
    try {
      const project = await db.project.findFirst({ where: { rootPath: process.cwd() } })
      projectId = project?.id ?? null
    } catch {
      projectId = null
    }
  }

  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      if (!res.headersSent) {
        json(res, 502, { error: { message: err instanceof Error ? err.message : 'proxy error', type: 'cortex_proxy_error' } })
      } else {
        res.end()
      }
    })
  })

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method ?? 'GET'
    const urlPath = req.url ?? '/'
    const targetUrl = new URL(urlPath, upstreamOrigin)

    // Read request body (bounded).
    const chunks: Buffer[] = []
    let total = 0
    const MAX_BODY = 10 * 1024 * 1024
    for await (const chunk of req) {
      const buf = chunk as Buffer
      total += buf.length
      if (total > MAX_BODY) {
        json(res, 413, { error: { message: 'request body too large', type: 'cortex_proxy_error' } })
        return
      }
      chunks.push(buf)
    }
    const rawBody = Buffer.concat(chunks)
    let bodyText = rawBody.toString('utf-8')

    // Only intercept chat completions when pre-exec is enabled and we have a project.
    const isChat = method === 'POST' && /\/v1\/chat\/completions\/?$/.test(urlPath)
    let rewrittenBody = bodyText
    let injectedPrompt: string | null = null
    let originalPrompt = ''

    if (isChat && enablePreExec && projectId) {
      let parsed: ChatCompletionBody | null = null
      try {
        parsed = JSON.parse(bodyText) as ChatCompletionBody
      } catch {
        parsed = null
      }
      if (parsed && Array.isArray(parsed.messages)) {
        originalPrompt = lastUserPrompt(parsed.messages)
        if (originalPrompt.length >= 3) {
          try {
            const result = await runPreExecution({ projectId, prompt: originalPrompt, targetPlatform: platform, useLlm: true })
            injectedPrompt = result.injectedPrompt ?? null
            if (injectedPrompt) {
              const messages = [...parsed.messages]
              // Replace the last user message content with the Tier-1 prompt so
              // the upstream model receives the compressed, pre-executed spec.
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user') {
                  messages[i] = { ...messages[i], content: injectedPrompt }
                  break
                }
              }
              // Also prepend a system message carrying the scope lock.
              const systemMsg: ChatMessage = {
                role: 'system',
                content: `[CortexOS Reverse Proxy] Pre-execution completed by local agent. Scope lock and Tier-1 spec injected. Original prompt summarized above.`,
              }
              const hasSystem = messages.some((m) => m.role === 'system')
              const finalMessages = hasSystem ? messages : [systemMsg, ...messages]
              parsed.messages = finalMessages
              rewrittenBody = JSON.stringify(parsed)
            }
          } catch (err) {
            // Fail open: forward original request untouched.
            console.error('[cortexd proxy] pre-exec failed, forwarding original:', err instanceof Error ? err.message : err)
          }
        }
      }
    }

    // Forward request.
    const upstreamReq = (upstream.protocol === 'https:' ? https : http).request(
      targetUrl,
      {
        method,
        headers: {
          ...req.headers,
          host: upstream.host,
          'content-length': Buffer.byteLength(rewrittenBody).toString(),
        },
        timeout: timeoutMs,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
        upstreamRes.pipe(res)

        // Capture memory after the response completes (fire-and-forget).
        if (isChat && enableMemory && projectId && originalPrompt) {
          let assistantText = ''
          const chunks2: Buffer[] = []
          upstreamRes.on('data', (c: Buffer) => chunks2.push(c))
          upstreamRes.on('end', () => {
            try {
              const raw = Buffer.concat(chunks2).toString('utf-8')
              // Best-effort: parse SSE or JSON to extract assistant text.
              if (raw.includes('data:')) {
                for (const line of raw.split('\n')) {
                  const trimmed = line.trim()
                  if (!trimmed.startsWith('data:')) continue
                  const jsonPart = trimmed.slice(5).trim()
                  if (jsonPart === '[DONE]') continue
                  try {
                    const obj = JSON.parse(jsonPart) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> }
                    const delta = obj.choices?.[0]?.delta?.content ?? obj.choices?.[0]?.message?.content
                    if (typeof delta === 'string') assistantText += delta
                  } catch {
                    // ignore non-JSON SSE frames
                  }
                }
              } else {
                try {
                  const obj = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> }
                  assistantText = obj.choices?.[0]?.message?.content ?? ''
                } catch {
                  assistantText = raw.slice(0, 4000)
                }
              }
              if (assistantText.trim().length >= 3) {
                void extractAndApplyMemoryDelta({
                  projectId: projectId!,
                  sourcePlatform: platform,
                  rawUserPrompt: originalPrompt,
                  aiResponseText: assistantText,
                  useLlm: true,
                }).catch((e) => console.error('[cortexd proxy] memory capture failed:', e instanceof Error ? e.message : e))
              }
            } catch (e) {
              console.error('[cortexd proxy] response parse failed:', e instanceof Error ? e.message : e)
            }
          })
        }
      },
    )

    upstreamReq.on('error', (err) => {
      if (!res.headersSent) json(res, 502, { error: { message: err.message, type: 'cortex_proxy_error' } })
      else res.end()
    })
    upstreamReq.on('timeout', () => {
      upstreamReq.destroy(new Error('upstream timeout'))
    })
    upstreamReq.write(rewrittenBody)
    upstreamReq.end()
  }

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })

  return {
    port,
    upstreamBaseUrl: upstreamOrigin,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
