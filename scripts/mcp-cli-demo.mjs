#!/usr/bin/env node
/**
 * Manual CLI verification — drives the CortexOS MCP server exactly like a real
 * MCP client (stdio JSON-RPC): initialize → tools/list → tools/call for the new
 * Phase 4 tools cortex_state / cortex_cto.
 *
 * Usage: node scripts/mcp-cli-demo.mjs [daemonBaseUrl]
 */
import { spawn } from 'node:child_process'

const DAEMON = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '')

const child = spawn('node', ['mcp-server/index.mjs', '--daemon', DAEMON], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
})
child.stderr.on('data', (d) => process.stderr.write(`[srv] ${d}`))

let buffer = ''
let nextId = 1
const pending = new Map()
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf-8')
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    try {
      const message = JSON.parse(line)
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      }
    } catch {
      /* ignore noise */
    }
  }
})

function request(method, params = {}, timeoutMs = 60_000) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`timeout: ${method}`))
      }
    }, timeoutMs)
  })
}

async function callTool(name, args) {
  const result = await request('tools/call', { name, arguments: args })
  if (result.isError) throw new Error(result.content?.[0]?.text ?? 'tool error')
  return result.content.map((c) => c.text).join('\n')
}

function hr(title) {
  console.log(`\n${'═'.repeat(72)}\n  ${title}\n${'═'.repeat(72)}`)
}

async function main() {
  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'cortex-cli-demo', version: '0.4.0' },
  })

  const tools = await request('tools/list')
  hr(`tools/list — ${tools.tools.length} tools`)
  console.log(tools.tools.map((t) => `  · ${t.name}`).join('\n'))

  // Pick the project that has real workspace data for the demo.
  const projects = await (await fetch(`${DAEMON}/api/cortex/projects`)).json()
  const withRoot = projects.projects.find((p) => p.rootPath) ?? projects.projects[0]
  const slug = withRoot.slug
  hr(`cortex_state GET (${slug})`)
  console.log(await callTool('cortex_state', { slug }))

  hr('cortex_cto AUDIT (force)')
  console.log(await callTool('cortex_cto', { slug, action: 'AUDIT', force: true }))

  hr('cortex_cto BUILD_DAG_PLAN')
  const buildText = await callTool('cortex_cto', {
    slug,
    action: 'BUILD_DAG_PLAN',
    goal: 'add an audit log table with a migration and an export endpoint',
  })
  console.log(buildText)

  const planId = /planId ([a-zA-Z0-9-]+)/.exec(buildText)?.[1]
  if (planId) {
    hr('cortex_cto DISPATCH_PLAN')
    const dispatchText = await callTool('cortex_cto', { slug, action: 'DISPATCH_PLAN', planId })
    console.log(dispatchText.slice(0, 2600))
    hr('cortex_cto ARCHIVE_PLAN')
    console.log((await callTool('cortex_cto', { slug, action: 'ARCHIVE_PLAN', planId })).slice(0, 900))
  }

  child.kill()
  process.exit(0)
}

main().catch((error) => {
  console.error('FAILED:', error.message)
  child.kill()
  process.exit(1)
})
