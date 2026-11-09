// src/cli/cortexos-pty-wrap.ts — Universal PTY Wrapper for non-JSONL CLI tools
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export type PtyAgent = 'hermes' | 'opencode' | 'codex' | 'claude'

export function runAgentWithPtySpool(
  agentName: PtyAgent,
  args: string[],
  projectRoot = process.cwd(),
): void {
  const spoolDir = path.join(projectRoot, '.cortex', 'pty-spool')
  fs.mkdirSync(spoolDir, { recursive: true })
  const spoolFile = path.join(spoolDir, `${agentName}-live.jsonl`)

  const child = spawn(agentName, args, {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, CORTEX_PROJECT_ROOT: projectRoot },
    shell: process.platform === 'win32',
  })

  process.stdin.on('data', (chunk) => {
    child.stdin.write(chunk)
    const text = chunk.toString('utf-8').trim()
    if (text.length > 2) {
      fs.appendFileSync(
        spoolFile,
        JSON.stringify({ platform: agentName, role: 'user', content: text, projectRoot, timestamp: new Date().toISOString() }) + '\n',
      )
    }
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    const cleanText = chunk.toString('utf-8').replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim()
    if (cleanText.length > 10) {
      fs.appendFileSync(
        spoolFile,
        JSON.stringify({ platform: agentName, role: 'assistant', content: cleanText, projectRoot, timestamp: new Date().toISOString() }) + '\n',
      )
    }
  })

  child.on('error', (err) => {
    console.error(`[cortexos wrap] failed to spawn ${agentName}:`, err.message)
    process.exit(1)
  })
  child.on('exit', (code) => process.exit(code ?? 0))
}
