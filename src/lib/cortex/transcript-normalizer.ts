// src/lib/cortex/transcript-normalizer.ts
// Pure, dependency-free transcript normalization (Gap #3).
// Shared by live-session-daemon.ts and tests.

import path from 'node:path'
import type { ExtractSourcePlatform } from './types'

export interface NormalizedTranscriptEvent {
  platform: ExtractSourcePlatform
  sessionId: string
  role: 'user' | 'assistant'
  text: string
  timestamp: string
  projectPath?: string
}

export function parseTranscriptLine(filePath: string, rawJsonLine: string): NormalizedTranscriptEvent | null {
  try {
    const record = JSON.parse(rawJsonLine) as Record<string, unknown>
    const normPath = filePath.replace(/\\/g, '/')
    const sessionId = path.basename(filePath, '.jsonl')

    let platform: ExtractSourcePlatform = 'codex'
    if (normPath.includes('/.claude/')) platform = 'claude'
    else if (normPath.includes('/.hermes/') || record.platform === 'hermes') platform = 'hermes'
    else if (record.platform === 'opencode') platform = 'opencode'

    const roleRaw =
      (typeof record.role === 'string' ? record.role : null) ||
      (typeof (record.message as { role?: unknown } | undefined)?.role === 'string'
        ? ((record.message as { role: string }).role)
        : null) ||
      (record.type === 'user' ? 'user' : record.type === 'assistant' ? 'assistant' : null)

    if (roleRaw !== 'user' && roleRaw !== 'assistant') return null

    const rawContent = record.content ?? (record.message as { content?: unknown } | undefined)?.content ?? record.text ?? ''
    let text = ''
    if (typeof rawContent === 'string') {
      text = rawContent
    } else if (Array.isArray(rawContent)) {
      text = (rawContent as unknown[])
        .map((block) => {
          if (typeof block === 'string') return block
          if (block && typeof block === 'object') {
            const b = block as { type?: string; text?: string }
            if ((b.type === 'text' || b.type === 'input_text' || b.type === 'output_text') && typeof b.text === 'string') return b.text
          }
          return ''
        })
        .filter(Boolean)
        .join('\n')
    }
    if (!text.trim()) return null

    return {
      platform,
      sessionId,
      role: roleRaw,
      text: text.trim(),
      timestamp: typeof record.timestamp === 'string' ? record.timestamp : new Date().toISOString(),
      projectPath: typeof record.cwd === 'string' ? record.cwd : typeof record.projectRoot === 'string' ? record.projectRoot : undefined,
    }
  } catch {
    return null
  }
}
