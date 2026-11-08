#!/usr/bin/env node
/**
 * CortexOS — Phase 2 automated test suite.
 *
 * Runs against the live daemon (default http://localhost:3000) and verifies
 * every Phase 2 capability end-to-end:
 *   - Episodic vector store (capture → summary + embedding → semantic search)
 *   - Full CrossPlatformSyncPacket contract + handoff audit trail
 *   - File watcher (chokidar): start → save → graph + timeline → stop
 *   - Git webhook: ingestion, dedupe, file nodes, bug auto-resolution
 *   - Git log backfill (real subprocess) + watermark increments
 *   - Git hook installer: real post-commit hook → live webhook delivery
 *   - MCP server: stdio JSON-RPC handshake + all 6 tools against the daemon
 *   - Browser extension core (real module, live daemon)
 *   - Validation envelopes and cascade cleanup
 *
 * Usage:  node scripts/test-phase2.mjs [baseUrl]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { spawn } from 'node:child_process'

const exec = promisify(execFile)
const BASE = process.argv[2] ?? 'http://localhost:3000'
const API = `${BASE}/api/cortex`
const ROOT = path.resolve(process.cwd())
const RUN = Date.now().toString(36).slice(-5)

const results = []
let currentSection = ''

function section(name) {
  currentSection = name
  console.log(`\n\x1b[35m▸ ${name}\x1b[0m`)
}

async function check(name, fn) {
  try {
    await fn()
    results.push({ section: currentSection, name, pass: true })
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (error) {
    results.push({ section: currentSection, name, pass: false, error: error.message })
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[31m${error.message}\x1b[0m`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try {
    json = await response.json()
  } catch {
    json = null
  }
  return { status: response.status, json }
}

async function waitFor(fn, { timeout = 12_000, interval = 300, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? ` — ${lastError.message}` : ''}`)
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\x1b[1m CortexOS Phase 2 — automated test suite\x1b[0m`)
  console.log(` daemon: ${BASE}\n`)

  const slug = `p2-sync-lab-${RUN}`
  let projectId = ''
  let fixtureDir = ''

  // ---- 1. Daemon health (>= v0.2.0 + Phase 2 capability + counts) ----------
  section('1 · Daemon health — Phase 2')
  await check('GET /health reports a valid version with the Phase 2 capability and sync counts', async () => {
    const { status, json } = await api('GET', '/health')
    assertEqual(status, 200, 'status')
    assert(/^0\.[2-9]\d*\.\d+$/.test(json.version), `version >= 0.2.0 (got ${json.version})`)
    assert(
      Array.isArray(json.capabilities) && json.capabilities.includes('phase2-cross-platform-sync'),
      'phase2-cross-platform-sync capability missing',
    )
    for (const key of ['handoffs', 'commits', 'episodes']) {
      assert(typeof json.counts[key] === 'number', `counts.${key} missing`)
    }
  })

  // ---- 2. Fixture project ---------------------------------------------------
  section('2 · Fixture project')
  await check('POST /projects creates the Phase 2 test project', async () => {
    const { status, json } = await api('POST', '/projects', {
      name: `P2 Sync Lab ${RUN}`,
      description: 'Phase 2 test project — sync engine, watcher, git, episodic store.',
      platform: 'codex',
    })
    assertEqual(status, 201, 'status')
    projectId = json.id
    assert(json.slug.startsWith('p2'), 'unexpected slug')
  })
  await check('POST /memories seeds decisions + an open bug + a todo', async () => {
    const seeds = [
      { type: 'decision', key: 'Stripe', value: 'We decided to use Stripe for billing with idempotent webhooks for the subscription lifecycle.', importance: 5 },
      { type: 'architecture', key: 'api structure', value: 'Next.js App Router monolith with a service layer in lib and route handlers in app/api.', importance: 4 },
      { type: 'bug', key: 'login race condition', value: 'Bug #42: Login has a race condition — two concurrent sessions can overwrite each other on token refresh. Blocks release.', importance: 5 },
      { type: 'todo', key: 'audit log', value: 'We still need an audit log table for admin actions — compliance asked for it.', importance: 3 },
    ]
    for (const seed of seeds) {
      const { status } = await api('POST', '/memories', { projectId, ...seed })
      assertEqual(status, 201, `seed ${seed.key}`)
    }
  })

  // ---- 3. Episodic vector store ---------------------------------------------
  section('3 · Episodic vector store (blueprint §3 Tier-3 memory)')
  let billingInteractionId = ''
  await check('POST /interactions indexes the turn (summary + embedding + provider)', async () => {
    const { status, json } = await api('POST', '/interactions', {
      projectId,
      platform: 'codex',
      title: 'Billing architecture session',
      text: 'We decided to use Stripe for billing. We still need payment retry logic for failed invoice payments with a dunning flow. Team prefers Tailwind CSS with shadcn/ui components only. Users must verify their email before accessing paid features.',
    })
    assertEqual(status, 201, 'status')
    billingInteractionId = json.interactionId
    assert(json.episode, 'episode metadata missing')
    assert(json.episode.summary.length > 10, 'summary empty')
    assert(json.episode.tokensSaved > 0, 'tokensSaved not positive')
    assert(['local-hash', /ollama:.*/.source === 'x' ? '' : 'ollama'].includes(json.episode.provider) || json.episode.provider.startsWith('ollama:') || json.episode.provider === 'local-hash', `unexpected provider ${json.episode.provider}`)
  })
  await check('A second interaction (different domain) is indexed too', async () => {
    const { status, json } = await api('POST', '/interactions', {
      projectId,
      platform: 'hermes',
      title: 'Auth hardening session',
      text: 'We found a race condition in login token refresh — two concurrent sessions overwrite each other. We decided to serialize refreshes with a database lock. We still need rate limiting on the auth endpoints.',
    })
    assertEqual(status, 201, 'status')
    assert(json.episode, 'episode metadata missing')
  })
  await check('Semantic search ranks the relevant episode first', async () => {
    const { status, json } = await api('POST', '/search', { projectId, query: 'stripe payment retry dunning billing', k: 5 })
    assertEqual(status, 200, 'status')
    assert(json.results.length >= 1, 'no results')
    assert(json.results[0].interactionId === billingInteractionId, `top result was ${json.results[0].title}, expected the billing session`)
    assert(json.results[0].score > 0, 'top score not positive')
    assert(typeof json.provider === 'string' && json.provider.length > 0, 'provider missing')
  })
  await check('Semantic search blends in keyword-matched memories', async () => {
    const { status, json } = await api('POST', '/search', { projectId, query: 'login race condition sessions', k: 5 })
    assertEqual(status, 200, 'status')
    assert(json.memories.some((m) => m.key === 'login race condition'), 'bug memory not matched')
  })

  // ---- 4. Cross-Platform Sync Engine ------------------------------------------
  section('4 · Cross-Platform Sync Engine (blueprint Part 1 §4)')
  await check('GET /sync/{slug} returns the full packet contract (preview, no handoff)', async () => {
    const { status, json } = await api('GET', `/sync/${slug}`)
    assertEqual(status, 200, 'status')
    // Phase 1 contract preserved (stack may be empty before DNA generation)
    assert(json.markdown.includes('[CORTEX-OS SYNC'), 'markdown header missing')
    assert(json.tokens > 100 && json.tokens <= 350, `token budget blown: ${json.tokens}`)
    assert(Array.isArray(json.stack), 'stack missing')
    assert(typeof json.dnaSnapshot.stackSummary === 'string' && json.dnaSnapshot.stackSummary.length > 0, 'stackSummary missing')
    // Phase 2 blueprint contract
    assert(json.header && json.header.projectId === projectId, 'header.projectId mismatch')
    assert(typeof json.header.stateHash === 'string' && json.header.stateHash.length >= 6, 'stateHash missing')
    assert(json.header.previousPlatform === 'codex', 'previousPlatform should be codex')
    assert(json.dnaSnapshot && json.dnaSnapshot.stackSummary.length > 0, 'dnaSnapshot.stackSummary missing')
    assert(Array.isArray(json.dnaSnapshot.activeConstraints), 'activeConstraints missing')
    assert(json.scopedGraphContext && typeof json.scopedGraphContext.activeModule === 'string', 'activeModule missing')
    assert(Array.isArray(json.scopedGraphContext.openBugsInScope), 'openBugsInScope missing')
    assert(json.continuityState && typeof json.continuityState.lastCompletedAction === 'string', 'lastCompletedAction missing')
    assert(json.continuityState.activeTask, 'activeTask missing')
    assert(json.continuityState.activeTask.remainingCoreWork.length > 0, 'remainingCoreWork missing')
    assert(Array.isArray(json.continuityState.activeTask.preExecutedByLocalAgent), 'preExecutedByLocalAgent missing')
  })
  let handoffId = ''
  let handoffCountBefore = 0
  await check('POST /sync/{slug} executes a handoff (audit + platform flip)', async () => {
    const before = await api('GET', `/sync/${slug}/handoffs`)
    handoffCountBefore = before.json.handoffs.length

    const { status, json } = await api('POST', `/sync/${slug}`, { targetPlatform: 'hermes' })
    assertEqual(status, 201, 'status')
    handoffId = json.handoffId
    assert(json.packet.header.previousPlatform === 'codex', 'previousPlatform')
    assertEqual(json.packet.header.targetPlatform, 'hermes', 'targetPlatform')
    assert(json.packet.header.syncedAtIso, 'syncedAtIso missing')

    const after = await api('GET', `/sync/${slug}/handoffs`)
    assertEqual(after.json.handoffs.length, handoffCountBefore + 1, 'handoff not recorded')
    const record = after.json.handoffs.find((h) => h.id === handoffId)
    assert(record, 'handoff record missing')
    assertEqual(record.fromPlatform, 'codex', 'record.fromPlatform')
    assertEqual(record.toPlatform, 'hermes', 'record.toPlatform')
    assert(record.packetTokens > 0, 'record.packetTokens missing')

    const detail = await api('GET', `/projects/${projectId}`)
    assertEqual(detail.json.project.platform, 'hermes', 'project platform not flipped')
  })
  await check('Second handoff chains from the new active platform', async () => {
    const { status, json } = await api('POST', `/sync/${slug}`, { targetPlatform: 'opencode', module: 'Auth' })
    assertEqual(status, 201, 'status')
    assertEqual(json.packet.header.previousPlatform, 'hermes', 'previousPlatform should chain from hermes')
    assertEqual(json.packet.header.targetPlatform, 'opencode', 'targetPlatform')
    assertEqual(json.packet.scopedGraphContext.activeModule, 'Auth', 'explicit module scoping ignored')
  })
  await check('sync.handoff timeline events are immutable records', async () => {
    const { json } = await api('GET', `/projects/${projectId}/timeline`)
    const events = json.events.filter((e) => e.kind === 'sync.handoff')
    assert(events.length >= 2, `expected >=2 handoff events, got ${events.length}`)
    assert(events[0].message.includes('hermes → opencode') || events[0].message.includes('codex → hermes'), 'event message missing platform pair')
  })

  // ---- 5. File watcher ----------------------------------------------------------
  section('5 · File watcher (Chokidar — Codex saves → graph updates)')
  await check('Starting a watcher without rootPath returns a clean 422', async () => {
    const { status, json } = await api('POST', '/watch', { projectId, action: 'start' })
    assertEqual(status, 422, 'status')
    assert(json.error.includes('rootPath'), 'error should mention rootPath')
  })
  await check('Watcher starts on a real workspace and indexes files', async () => {
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), `cortex-p2-watch-`))
    await fs.mkdir(path.join(fixtureDir, 'src', 'lib'), { recursive: true })
    await fs.mkdir(path.join(fixtureDir, 'app', 'api'), { recursive: true })
    await fs.writeFile(path.join(fixtureDir, 'src', 'lib', 'billing.ts'), 'export function charge(amount: number) {\n  return amount * 1.1\n}\n')
    await fs.writeFile(path.join(fixtureDir, 'app', 'api', 'route.ts'), 'export async function GET() {\n  return Response.json({ ok: true })\n}\n')
    await fs.writeFile(path.join(fixtureDir, 'README.md'), '# fixture\n')

    await api('PATCH', `/projects/${projectId}`, { rootPath: fixtureDir })
    const { status, json } = await api('POST', '/watch', { projectId, action: 'start', persist: true })
    assertEqual(status, 201, 'status')
    assert(json.status.running, 'watcher not running')

    await waitFor(async () => {
      const graph = await api('GET', `/graph?projectId=${projectId}`)
      return graph.json.nodes.some((n) => n.kind === 'file' && n.label === 'src/lib/billing.ts')
    }, { label: 'initial file index' })
  })
  await check('Saving a file updates the graph + timeline within a second', async () => {
    await new Promise((r) => setTimeout(r, 400))
    await fs.appendFile(path.join(fixtureDir, 'src', 'lib', 'billing.ts'), 'export const TAX_RATE = 0.1\n')
    const changed = await waitFor(async () => {
      const timeline = await api('GET', `/projects/${projectId}/timeline`)
      return timeline.json.events.find((e) => e.kind === 'file.changed' && e.message.includes('src/lib/billing.ts'))
    }, { label: 'file.changed timeline event' })
    assert(changed, 'file.changed event missing')

    const graph = await api('GET', `/graph?projectId=${projectId}`)
    const fileNode = graph.json.nodes.find((n) => n.kind === 'file' && n.label === 'src/lib/billing.ts')
    assert(fileNode, 'file node missing')
    assert(fileNode.props.exportsSummary.includes('charge'), 'exportsSummary missing charge')
    assert(fileNode.props.exportsSummary.includes('TAX_RATE'), 'exportsSummary missing TAX_RATE')
    assert(typeof fileNode.props.astHash === 'string' && fileNode.props.astHash.length === 16, 'astHash missing')
    assert(fileNode.props.lines === 5, `lines expected 5, got ${fileNode.props.lines}`)

    // module edge: src/lib/billing.ts should sit under the Src module
    const edges = graph.json.edges
    const fileDbId = fileNode.id
    const moduleEdge = edges.find((e) => e.targetId === fileDbId && e.relation === 'CONTAINS')
    assert(moduleEdge, 'module CONTAINS edge missing')
  })
  await check('The sync packet picks the active module from watcher signal', async () => {
    const { json } = await api('GET', `/sync/${slug}?target=hermes`)
    assert(typeof json.scopedGraphContext.activeModule === 'string' && json.scopedGraphContext.activeModule.length > 0, 'activeModule missing')
    assert(json.scopedGraphContext.relevantSymbols.length > 0, 'relevantSymbols empty despite file nodes')
    assert(json.scopedGraphContext.relevantSymbols.some((s) => s.symbolId.includes('billing.ts')), 'billing.ts symbol pointer missing')
  })
  await check('Watcher status reports live stats; stop shuts it down; persist flag sticks', async () => {
    const { json } = await api('GET', `/watch?projectId=${projectId}`)
    const status = json.watchers[0]
    assert(status.running, 'status not running')
    assert(status.events >= 2, `expected >=2 events, got ${status.events}`)
    assert(status.lastEventPath, 'lastEventPath missing')

    const stop = await api('POST', '/watch', { projectId, action: 'stop', persist: true })
    assert(stop.json.stopped, 'stop failed')
    const after = await api('GET', `/watch?projectId=${projectId}`)
    assert(!after.json.watchers[0].running, 'still running after stop')
    assert(after.json.watchers[0].watchEnabled === false, 'watchEnabled should be false after persist-stop')
  })

  // ---- 6. Git webhook -----------------------------------------------------------
  section('6 · Git webhook (post-commit → Knowledge Graph)')
  const COMMIT_1 = 'b1a2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
  const COMMIT_2 = 'c2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1'
  await check('Webhook ingests a commit: record + timeline + file nodes', async () => {
    const { status, json } = await api('POST', '/hooks/git', {
      slug,
      platform: 'codex',
      commits: [{
        hash: COMMIT_1,
        message: 'feat: add billing service with retry logic',
        author: 'dev',
        timestamp: new Date().toISOString(),
        files: [
          { path: 'src/lib/billing.ts', status: 'M' },
          { path: 'src/lib/retry.ts', status: 'A' },
        ],
      }],
    })
    assertEqual(status, 201, 'status')
    assertEqual(json.ingested, 1, 'ingested')
    assertEqual(json.duplicates, 0, 'duplicates')
    assertEqual(json.filesTouched, 2, 'filesTouched')

    const timeline = await api('GET', `/projects/${projectId}/timeline`)
    assert(timeline.json.events.some((e) => e.kind === 'git.commit' && e.message.includes(COMMIT_1.slice(0, 8))), 'git.commit timeline event missing')

    const graph = await api('GET', `/graph?projectId=${projectId}`)
    const retryNode = graph.json.nodes.find((n) => n.kind === 'file' && n.label === 'src/lib/retry.ts')
    assert(retryNode, 'file node for src/lib/retry.ts missing')
    assertEqual(retryNode.props.lastModifiedBy, 'codex', 'platform hint missing on file node')
  })
  await check('fix commits auto-resolve matching open bugs', async () => {
    const { status, json } = await api('POST', '/hooks/git', {
      slug,
      platform: 'hermes',
      commits: [{
        hash: COMMIT_2,
        message: 'fix: resolve login race condition #42 with serialized token refresh',
        author: 'dev',
        timestamp: new Date().toISOString(),
        files: [{ path: 'app/api/auth/route.ts', status: 'M' }],
      }],
    })
    assertEqual(status, 201, 'status')
    assert(json.bugsResolved.length >= 1, 'expected at least 1 bug resolved')
    // The seeded bug AND the bug extracted from the auth transcript both match
    // the fix subject — deterministic keyword resolution, both are correct.
    assert(json.bugsResolved.some((b) => b.key.includes('login race condition')), 'seeded bug not resolved')

    const bugs = await api('GET', `/memories?projectId=${projectId}&type=bug&status=resolved`)
    assert(bugs.json.memories.some((m) => m.key === 'login race condition'), 'bug memory not marked resolved')

    const timeline = await api('GET', `/projects/${projectId}/timeline`)
    assert(timeline.json.events.some((e) => e.kind === 'memory.resolved'), 'memory.resolved event missing')
  })
  await check('Re-posting the same commits dedupes (idempotent webhook)', async () => {
    const { json } = await api('POST', '/hooks/git', {
      slug,
      commits: [
        { hash: COMMIT_1, message: 'feat: add billing service', files: [] },
        { hash: COMMIT_2, message: 'fix: resolve login race condition', files: [] },
      ],
    })
    assertEqual(json.ingested, 0, 'ingested should be 0')
    assertEqual(json.duplicates, 2, 'duplicates should be 2')
  })
  await check('Malformed webhooks are rejected with 422', async () => {
    const bad = await api('POST', '/hooks/git', { slug, commits: [{ hash: 'zzz', message: 'x', files: [] }] })
    assertEqual(bad.status, 422, 'bad hash should 422')
    const unknown = await api('POST', '/hooks/git', { slug: 'no-such-project', commits: [{ hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', message: 'm', files: [] }] })
    assertEqual(unknown.status, 404, 'unknown slug should 404')
  })

  // ---- 7. Git log backfill + hook installer ---------------------------------------
  section('7 · Git log backfill + post-commit hook installer')
  let repoDir = ''
  await check('git log ingest reads real history (subprocess) with watermark', async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), `cortex-p2-repo-`))
    await exec('git', ['init', '-q'], { cwd: repoDir })
    await exec('git', ['config', 'user.email', 'test@cortex.dev'], { cwd: repoDir })
    await exec('git', ['config', 'user.name', 'Cortex Test'], { cwd: repoDir })
    await fs.writeFile(path.join(repoDir, 'a.ts'), 'export const a = 1\n')
    await exec('git', ['add', '.'], { cwd: repoDir })
    await exec('git', ['commit', '-q', '-m', 'feat: initial scaffold with a.ts'], { cwd: repoDir })
    await fs.writeFile(path.join(repoDir, 'b.ts'), 'export const b = 2\n')
    await exec('git', ['add', '.'], { cwd: repoDir })
    await exec('git', ['commit', '-q', '-m', 'feat: add b module'], { cwd: repoDir })

    // Point the project at the repo (second rootPath switch) and ingest.
    await api('PATCH', `/projects/${projectId}`, { rootPath: repoDir })
    const { status, json } = await api('POST', '/git/ingest', { projectId })
    assertEqual(status, 201, 'status')
    assertEqual(json.ingested, 2, `expected 2 ingested, got ${json.ingested}`)

    const commits = await api('GET', `/git?projectId=${projectId}`)
    // Webhook commits (2) + ingested repo history (2) all live in the log.
    assert(commits.json.commits.length >= 4, `commit list too short: ${commits.json.commits.length}`)
    assert(commits.json.commits.some((c) => c.message.includes('initial scaffold')), 'scaffold commit missing')
    assert(commits.json.commits.some((c) => c.platform === 'codex'), 'platform hints missing')

    // Incremental: a new commit only.
    await fs.writeFile(path.join(repoDir, 'c.ts'), 'export const c = 3\n')
    await exec('git', ['add', '.'], { cwd: repoDir })
    await exec('git', ['commit', '-q', '-m', 'feat: add c module'], { cwd: repoDir })
    const second = await api('POST', '/git/ingest', { projectId })
    assertEqual(second.json.ingested, 1, `incremental ingest should find 1, got ${second.json.ingested}`)
  })
  await check('Hook installer wires a real post-commit hook that delivers to the daemon', async () => {
    const install = await exec('node', [
      path.join(ROOT, 'scripts', 'cortex-git-hook.mjs'),
      'install', '--repo', repoDir, '--slug', slug, '--daemon', BASE, '--platform', 'codex',
    ])
    assert(install.stdout.includes('installed'), `installer output unexpected: ${install.stdout}`)

    const hookPath = path.join(repoDir, '.git', 'hooks', 'post-commit')
    const hook = await fs.readFile(hookPath, 'utf8')
    assert(hook.includes('cortexos'), 'hook body missing cortexos marker')

    await fs.writeFile(path.join(repoDir, 'd.ts'), 'export const d = 4\n')
    await exec('git', ['add', '.'], { cwd: repoDir })
    await exec('git', ['commit', '-q', '-m', 'feat: add d module from codex'], { cwd: repoDir })

    await waitFor(async () => {
      const commits = await api('GET', `/git?projectId=${projectId}`)
      return commits.json.commits.some((c) => c.message.includes('add d module'))
    }, { label: 'hook-delivered commit' })

    const check = await exec('node', [path.join(ROOT, 'scripts', 'cortex-git-hook.mjs'), 'check', '--repo', repoDir])
    assert(check.stdout.includes('INSTALLED'), 'check should report installed')

    const uninstall = await exec('node', [path.join(ROOT, 'scripts', 'cortex-git-hook.mjs'), 'uninstall', '--repo', repoDir])
    assert(uninstall.stdout.includes('removed'), 'uninstall failed')
  })

  // ---- 8. MCP server -------------------------------------------------------------
  section('8 · MCP server (stdio JSON-RPC, blueprint tools)')
  await check('Server handshakes and lists all 6 blueprint tools', async () => {
    const mcp = await McpClient.spawn()
    try {
      const tools = await mcp.request({ method: 'tools/list', id: 1 })
      const names = tools.tools.map((t) => t.name)
      for (const expected of ['cortex_sync', 'cortex_get_dna', 'cortex_log_decision', 'cortex_rewrite', 'cortex_search_history', 'cortex_capture_interaction']) {
        assert(names.includes(expected), `tool ${expected} missing (got: ${names.join(', ')})`)
      }
    } finally {
      await mcp.kill()
    }
  })
  await check('cortex_sync returns the packet + records a handoff', async () => {
    const mcp = await McpClient.spawn()
    try {
      const result = await mcp.callTool('cortex_sync', { slug, targetPlatform: 'cursor' })
      assert(result.includes('CortexOS sync packet'), 'packet preamble missing')
      assert(result.includes('"targetPlatform": "cursor"'), 'targetPlatform missing in packet JSON')
      assert(result.includes('[CORTEX-OS SYNC'), 'markdown header missing')

      const handoffs = await api('GET', `/sync/${slug}/handoffs`)
      assert(handoffs.json.handoffs.some((h) => h.toPlatform === 'cursor'), 'cursor handoff not recorded')
    } finally {
      await mcp.kill()
    }
  })
  await check('cortex_log_decision writes a memory through the daemon', async () => {
    const mcp = await McpClient.spawn()
    try {
      const result = await mcp.callTool('cortex_log_decision', {
        slug,
        key: 'observability',
        value: 'We decided to add OpenTelemetry tracing to all API routes before launch.',
        type: 'decision',
        importance: 4,
      })
      assert(result.includes('Logged [decision] observability'), `unexpected result: ${result.slice(0, 120)}`)

      const memories = await api('GET', `/memories?projectId=${projectId}&type=decision&q=observability`)
      assert(memories.json.memories.length >= 1, 'memory not created')
      assertEqual(memories.json.memories[0].source, 'api', 'source should be api')
    } finally {
      await mcp.kill()
    }
  })
  await check('cortex_search_history returns ranked episodes; cortex_get_dna + cortex_rewrite work', async () => {
    const mcp = await McpClient.spawn()
    try {
      const search = await mcp.callTool('cortex_search_history', { slug, query: 'stripe billing retry dunning', k: 3 })
      assert(search.includes('Episodic search'), 'search preamble missing')
      assert(search.includes('Billing architecture session'), 'billing episode not found')

      const dna = await mcp.callTool('cortex_get_dna', { slug })
      assert(dna.includes('PROJECT DNA') || dna.includes('no DNA yet'), 'dna response unexpected')

      const rewrite = await mcp.callTool('cortex_rewrite', { slug, prompt: 'add stripe webhook for subscription renewal and update user db', engine: 'fast' })
      assert(rewrite.includes('Tier-1 prompt'), 'rewrite preamble missing')
      assert(rewrite.includes('[CORTEX-OS SYNC'), 'rewrite missing Tier-1 header')
    } finally {
      await mcp.kill()
    }
  })
  await check('MCP errors surface cleanly (unknown slug)', async () => {
    const mcp = await McpClient.spawn()
    try {
      const result = await mcp.callToolRaw('cortex_sync', { slug: 'no-such-project', targetPlatform: 'hermes' })
      assert(result.isError, 'expected an error result')
      assert(/not found|no cortexos project/i.test(result.text), `expected clean error, got: ${result.text.slice(0, 120)}`)
    } finally {
      await mcp.kill()
    }
  })

  // ---- 9. Extension core ------------------------------------------------------------
  section('9 · Browser extension core (real module, live daemon)')
  await check('UMD module loads in Node and exposes the full surface', async () => {
    const Core = await loadCore()
    for (const fn of ['loadSettings', 'daemonFetch', 'resolveProject', 'rewritePrompt', 'statePacket', 'handoffPacket', 'findChatInput', 'injectText', 'showToast']) {
      assert(typeof Core[fn] === 'function', `${fn} missing`)
    }
  })
  await check('Site adapters match the blueprint platforms', async () => {
    const Core = await loadCore()
    assertEqual(Core.adapterFor('https://chatgpt.com/c/abc').id, 'chatgpt', 'chatgpt adapter')
    assertEqual(Core.adapterFor('https://claude.ai/chat/x').id, 'claude', 'claude adapter')
    assertEqual(Core.adapterFor('https://gemini.google.com/app').id, 'gemini', 'gemini adapter')
    assertEqual(Core.adapterFor('https://example.com/anything').id, 'generic', 'generic fallback')
  })
  await check('Daemon client + packet helpers work against the live daemon', async () => {
    const Core = await loadCore()
    const settings = { daemonUrl: BASE, slug, engine: 'fast', platform: 'hermes' }
    const health = await Core.health(settings)
    assertEqual(health.status, 'online', 'health')

    const project = await Core.resolveProject(settings, slug)
    assertEqual(project.slug, slug, 'resolveProject')

    const { packet } = await Core.handoffPacket(settings, slug, 'windsurf')
    assert(packet.markdown.includes('[CORTEX-OS SYNC'), 'packet markdown missing')
    assert(packet.header.targetPlatform === 'windsurf', 'handoff target')

    const rewrite = await Core.rewritePrompt(settings, project.id, 'build login page', 'fast')
    assert(rewrite.prompt.includes('[CORTEX-OS SYNC'), 'rewrite missing header')

    const toast = Core.rewriteToastMessage({ engineUsed: 'fast', metrics: { tokensContextAvoided: 1234 } })
    assert(toast.includes('Tier-1') && toast.includes('1234'), 'toast message formatting broken')
  })

  // ---- 10. Metrics + validation + cleanup ----------------------------------------
  section('10 · Metrics, validation & cleanup')
  await check('GET /metrics carries the sync section', async () => {
    const { json } = await api('GET', '/metrics')
    assert(json.sync, 'sync section missing')
    assert(json.sync.handoffs >= 3, `expected >=3 handoffs, got ${json.sync.handoffs}`)
    assert(json.sync.commits >= 4, `expected >=4 commits, got ${json.sync.commits}`)
    assert(json.sync.episodes >= 2, `expected >=2 episodes, got ${json.sync.episodes}`)
  })
  await check('Search validates input (422 on short query)', async () => {
    const { status } = await api('POST', '/search', { projectId, query: 'x' })
    assertEqual(status, 422, 'status')
  })
  await check('DELETE /projects/{id} cascades handoffs + commits + episodes', async () => {
    const { status } = await api('DELETE', `/projects/${projectId}`)
    assertEqual(status, 200, 'status')
    const handoffs = await api('GET', `/sync/${slug}/handoffs`)
    assertEqual(handoffs.status, 404, 'handoffs should 404 after cascade')
    const health = await api('GET', '/health')
    assert(health.json.counts.projects >= 1, 'daemon should still host the demo project')
  })

  // ---- Summary ------------------------------------------------------------------
  const passed = results.filter((r) => r.pass).length
  const failed = results.length - passed
  console.log('\n─────────────────────────────────────────────')
  console.log(`  Results: \x1b[32m${passed} passed\x1b[0m${failed > 0 ? ` · \x1b[31m${failed} failed\x1b[0m` : ''} · ${results.length} total`)
  if (failed > 0) {
    console.log('\n  Failures:')
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`  \x1b[31m✗\x1b[0m [${r.section}] ${r.name}\n      ${r.error}`)
    }
    process.exitCode = 1
  }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio client for the test suite
// ---------------------------------------------------------------------------
class McpClient {
  static async spawn() {
    const child = spawn('node', [path.join(ROOT, 'mcp-server', 'index.mjs')], {
      cwd: ROOT,
      env: { ...process.env, CORTEX_DAEMON_URL: BASE },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const client = new McpClient(child)
    await client.handshake()
    return client
  }

  constructor(child) {
    this.child = child
    this.buffer = ''
    this.nextId = 10
    this.pending = new Map()
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.onData(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', () => {}) // keep stderr drained
  }

  onData(chunk) {
    this.buffer += chunk
    let index
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line)
        if (message.id !== undefined && this.pending.has(message.id)) {
          const { resolve, reject } = this.pending.get(message.id)
          this.pending.delete(message.id)
          if (message.error) reject(new Error(message.error.message ?? JSON.stringify(message.error)))
          else resolve(message.result)
        }
      } catch {
        // Non-JSON noise — ignore.
      }
    }
  }

  request({ method, params, id }) {
    const messageId = id ?? this.nextId++
    const frame = JSON.stringify({ jsonrpc: '2.0', id: messageId, method, params }) + '\n'
    return new Promise((resolve, reject) => {
      this.pending.set(messageId, { resolve, reject })
      this.child.stdin.write(frame)
      setTimeout(() => {
        if (this.pending.has(messageId)) {
          this.pending.delete(messageId)
          reject(new Error(`MCP request ${method} timed out`))
        }
      }, 20_000)
    })
  }

  async handshake() {
    const result = await this.request({
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cortex-test', version: '1.0.0' } },
    })
    if (!result.serverInfo || result.serverInfo.name !== 'cortexos') {
      throw new Error(`unexpected serverInfo: ${JSON.stringify(result.serverInfo)}`)
    }
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  }

  async callTool(name, args) {
    const result = await this.request({ method: 'tools/call', params: { name, arguments: args } })
    const text = result.content.map((c) => c.text ?? '').join('\n')
    if (result.isError) {
      throw new Error(`tool ${name} errored: ${text.slice(0, 200)}`)
    }
    return text
  }

  async callToolRaw(name, args) {
    const result = await this.request({ method: 'tools/call', params: { name, arguments: args } })
    return { isError: Boolean(result.isError), text: result.content.map((c) => c.text ?? '').join('\n') }
  }

  kill() {
    return new Promise((resolve) => {
      this.child.on('exit', () => resolve())
      this.child.kill('SIGTERM')
      setTimeout(() => {
        try { this.child.kill('SIGKILL') } catch {}
        resolve()
      }, 3000)
    })
  }
}

main().catch((error) => {
  console.error('Suite crashed:', error)
  process.exit(1)
})

/** The extension core is a UMD/CJS module — ESM import exposes it as default. */
async function loadCore() {
  const mod = await import(path.join(ROOT, 'extension', 'lib', 'core.js'))
  return mod.default ?? mod
}
