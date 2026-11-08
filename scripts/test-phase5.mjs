#!/usr/bin/env node
/**
 * CortexOS — Phase 5 automated test suite.
 *
 * Runs against the live daemon (default http://localhost:3000; pass a base
 * URL as argv[2]) and verifies every Phase 5 capability end-to-end:
 *
 *   - Daemon health: v0.5.0, Phase 5 capabilities (unified CLI + git loop)
 *   - CLI surface: help, unknown command/flag rejection, --daemon-url errors
 *   - bin entry (bin/cortexos.mjs) drives the same implementation
 *   - `cortexos status`: human render, --xml sync packet, --json contract
 *   - Fixture workspace project (real files + git repo) with real drift
 *   - `cortexos scope`: --list, --lock merge, --exact, --toggle, --unlock,
 *     --reset — every mutation verified against the daemon's persisted state
 *   - AST Sentinel enforcement: after `cortexos scope --lock` a staged
 *     modification of the locked symbol is rejected with 422, and applies
 *     again after `--unlock`
 *   - `cortexos cto`: audit (incl. --force + --json), fixture drift findings,
 *     plan → dispatch (wave-1 local tools really execute) → archive, and
 *     plan --execute chaining
 *   - `cortexos hooks install`: executable shim, .cortex/daemon.json,
 *     .gitignore hygiene, idempotent refresh, foreign sh + node hook chaining
 *   - Git hook → cortex_extract_memory round-trip in a REAL temporary git
 *     repository: interaction (git-commit-<shortSha>, platform git-hook),
 *     extracted memories, detected AST symbols, git.commit + memory timeline
 *     events, GitCommit ingestion
 *   - Offline fail-open spooling (.cortex/spool/pending-git-commits.jsonl):
 *     git commit still succeeds with the daemon down, FIFO flush-spool
 *     replay, in-file + cross-run SHA deduplication
 *   - MCP server regression (10 tools)
 *   - Cascade cleanup
 *
 * Usage:  node scripts/test-phase5.mjs [baseUrl]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile as execFileCb, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFileCb)
const BASE = process.argv[2] ?? 'http://localhost:3000'
const API = `${BASE}/api/cortex`
const ROOT = process.cwd()
const CLI = 'scripts/cortexos-cli.mjs'
const BIN = 'bin/cortexos.mjs'
const RUN = Date.now().toString(36).slice(-5)
const DEAD_DAEMON = 'http://127.0.0.1:9'

const results = []
let currentSection = ''

function section(name) {
  currentSection = name
  console.log(`\n▸ ${name}`)
}

async function check(name, fn) {
  try {
    await fn()
    results.push({ section: currentSection, name, pass: true })
    console.log(`  ✓ ${name}`)
  } catch (error) {
    results.push({ section: currentSection, name, pass: false, error: error.message })
    console.log(`  ✗ ${name}\n    ${error.message}`)
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

async function api(method, pathName, body) {
  const response = await fetch(`${API}${pathName}`, {
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

// ---------------------------------------------------------------------------
// CLI runner — every invocation is a real process, exactly like a user shell
// ---------------------------------------------------------------------------

function cliEnv(extra = {}) {
  return { ...process.env, CORTEX_DAEMON_URL: BASE, ...extra }
}

/** Environment for git commands that must resolve the daemon like the hook
 *  does (via .cortex/daemon.json) — no env-var shortcuts. */
function hookEnv() {
  const env = { ...process.env }
  delete env.CORTEX_DAEMON_URL
  delete env.CORTEX_BASE_URL
  delete env.CORTEX_PROJECT
  return env
}

async function cli(args, { env = cliEnv(), cwd = ROOT, script = CLI } = {}) {
  try {
    const { stdout, stderr } = await exec('node', [script, ...args], {
      cwd, env, timeout: 150_000, maxBuffer: 16 * 1024 * 1024,
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

// ---------------------------------------------------------------------------
// Minimal stdio JSON-RPC client for the MCP regression
// ---------------------------------------------------------------------------
class McpClient {
  constructor(child) {
    this.child = child
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
    child.stdout.on('data', (chunk) => this.onData(chunk))
  }
  static spawn() {
    const child = spawn('node', ['mcp-server/index.mjs'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CORTEX_DAEMON_URL: BASE },
    })
    return new McpClient(child)
  }
  onData(chunk) {
    this.buffer += chunk.toString('utf-8')
    let index
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line)
        if (message.id !== undefined && this.pending.has(message.id)) {
          const { resolve, reject } = this.pending.get(message.id)
          this.pending.delete(message.id)
          if (message.error) reject(new Error(message.error.message ?? 'MCP error'))
          else resolve(message.result)
        }
      } catch {
        // ignore non-JSON noise
      }
    }
  }
  request(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`MCP request timed out: ${method}`))
        }
      }, 30_000)
    })
  }
  kill() {
    return new Promise((resolve) => {
      this.child.on('exit', () => resolve())
      this.child.kill()
    })
  }
}

// ---------------------------------------------------------------------------
// Fixture workspace (real files, real git repo — mirrors the Phase 4 fixture)
// ---------------------------------------------------------------------------
async function buildFixtureWorkspace(prefix) {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-${RUN}-`))
  await fs.mkdir(path.join(fixtureDir, 'src', 'components'), { recursive: true })
  await fs.mkdir(path.join(fixtureDir, 'src', 'lib'), { recursive: true })
  await fs.mkdir(path.join(fixtureDir, 'prisma'), { recursive: true })
  await fs.writeFile(path.join(fixtureDir, '.gitignore'), 'node_modules/\n')

  await fs.writeFile(
    path.join(fixtureDir, 'prisma', 'schema.prisma'),
    [
      'datasource db { provider = "sqlite"; url = env("DATABASE_URL") }',
      '',
      'model User {',
      '  id        String   @id @default(cuid())',
      '  email     String   @unique',
      '  createdAt DateTime @default(now())',
      '}',
      '',
    ].join('\n'),
  )

  // Genuine high-complexity symbol (> 12 decision points).
  await fs.writeFile(
    path.join(fixtureDir, 'src', 'lib', 'billing.ts'),
    [
      'export interface MeteredUsage { userId: string; units: number; tier: string }',
      '',
      'export function computeInvoice(usage: MeteredUsage, overrides?: Record<string, number>): number {',
      '  let total = 0',
      '  if (usage.units > 0) {',
      '    if (usage.tier === "pro") { total += usage.units * 2 }',
      '    else if (usage.tier === "enterprise") { total += usage.units * 1.5 }',
      '    else { total += usage.units * 3 }',
      '  }',
      '  if (overrides) {',
      '    for (const key of Object.keys(overrides)) {',
      '      if (key.startsWith("credit") && overrides[key] > 0) { total -= overrides[key] }',
      '      else if (key.startsWith("surcharge") && overrides[key] > 0) { total += overrides[key] }',
      '    }',
      '  }',
      '  if (total > 10000 && usage.tier === "enterprise") { total *= 0.9 }',
      '  while (total < 0) { total += 1 }',
      '  return Math.round(total)',
      '}',
      '',
    ].join('\n'),
  )

  // Genuine layer violation: UI importing storage directly.
  await fs.writeFile(
    path.join(fixtureDir, 'src', 'components', 'report-widget.tsx'),
    [
      "import { db } from '@/lib/db'",
      '',
      'export function ReportWidget({ orgId }: { orgId: string }) {',
      '  void db; void orgId',
      '  return null',
      '}',
      '',
    ].join('\n'),
  )

  await fs.writeFile(path.join(fixtureDir, '.env.example'), 'DATABASE_URL=file:./dev.db\n')

  await exec('git', ['init', '-q', '.'], { cwd: fixtureDir })
  await exec('git', ['add', '.'], { cwd: fixtureDir })
  await exec('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'], { cwd: fixtureDir })
  return fixtureDir
}

async function gitCommit(repoDir, message, env = cliEnv()) {
  await exec('git', ['add', '.'], { cwd: repoDir, env })
  await exec('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', message], { cwd: repoDir, env })
  return (await exec('git', ['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim()
}

async function projectInteractions(projectId) {
  const { json } = await api('GET', `/interactions?projectId=${projectId}`)
  return json.interactions ?? []
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
let fixtureDir = null
let projectId = null
let fixtureSlug = null

section('1 · Daemon health — v0.5.0 Phase 5 capabilities')
await check('health reports the Phase 5 version, label and capabilities', async () => {
  const { status, json } = await api('GET', '/health')
  assertEqual(status, 200, 'status')
  assertEqual(json.status, 'online', 'daemon status')
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(json.version ?? '')
  assert(versionMatch, `version must be semver (got: ${json.version})`)
  const [major, minor] = versionMatch.slice(1).map(Number)
  assert(major > 0 || minor >= 5, `version must be >= 0.5.0 (got ${json.version})`)
  assert(/^Phase 5/.test(json.phase ?? ''), `phase must be Phase 5 (got: ${json.phase})`)
  for (const capability of ['phase5-unified-cli', 'phase5-git-memory-loop']) {
    assert(json.capabilities.includes(capability), `capability ${capability} missing`)
  }
})

section('2 · CLI surface — help and error envelopes')
await check('bare invocation and help print usage with exit 0', async () => {
  const bare = await cli([])
  assertEqual(bare.code, 0, 'bare exit code')
  assert(bare.stdout.includes('cortexos — CortexOS unified CLI'), 'usage header missing')
  const help = await cli(['help'])
  assertEqual(help.code, 0, 'help exit code')
  for (const domain of ['status', 'scope', 'cto', 'hooks']) {
    assert(help.stdout.includes(`cortexos ${domain}`), `usage must document ${domain}`)
  }
})
await check('unknown command and unknown flag exit 1 with actionable errors', async () => {
  const badCommand = await cli(['frobnicate'])
  assertEqual(badCommand.code, 1, 'unknown command exit code')
  assert(badCommand.stderr.includes('unknown command'), 'unknown command message missing')
  const badFlag = await cli(['status', '--josn'])
  assertEqual(badFlag.code, 1, 'unknown flag exit code')
  assert(badFlag.stderr.includes('unknown option --josn'), 'unknown flag message missing')
})
await check('unreachable daemon exits 1 with the connectivity hint', async () => {
  const offline = await cli(['status', '--daemon-url', DEAD_DAEMON])
  assertEqual(offline.code, 1, 'exit code')
  assert(offline.stderr.includes('cortexos:'), 'error prefix missing')
  assert(offline.stderr.includes('daemon'), 'error must mention the daemon')
})
await check('unknown project exits 1 with the daemon 404 surfaced', async () => {
  const missing = await cli(['status', '--project', 'no-such-project'])
  assertEqual(missing.code, 1, 'exit code')
  assert(missing.stderr.includes('Project not found'), '404 message missing')
})

section('3 · bin entry + status subcommand')
await check('bin/cortexos.mjs drives the same implementation (--json)', async () => {
  const result = await cli(['status', '--project', 'cortexos-daemon-self-audit', '--json'], { script: BIN })
  assertEqual(result.code, 0, 'exit code')
  const parsed = JSON.parse(result.stdout)
  assertEqual(parsed.projectSlug, 'cortexos-daemon-self-audit', 'slug')
  assert(Array.isArray(parsed.graph.nodes) && parsed.graph.nodes.length > 0, 'graph nodes missing')
})
await check('status prints node counts by label, savings %, locks and CTO recs', async () => {
  const result = await cli(['status', '--project', 'cortexos-daemon-self-audit'])
  assertEqual(result.code, 0, 'exit code')
  assert(/Graph:\s+\d+ nodes \/ \d+ edges/.test(result.stdout), 'graph counts line missing')
  const nodes = Number(/Graph:\s+(\d+) nodes/.exec(result.stdout)?.[1])
  assert(nodes >= 40, `expected the real self-audit graph (got ${nodes} nodes)`)
  assert(/ASTSymbol ×\d+/.test(result.stdout), 'label breakdown missing')
  assert(/Tokens:.*%\s*compression/.test(result.stdout), 'token savings % missing')
  assert(/CTO:\s+\d+ recommendation/.test(result.stdout), 'CTO recommendation count missing')
  assert(/Timeline:/.test(result.stdout), 'timeline line missing')
})
await check('status --xml appends the injectable sync packet', async () => {
  const result = await cli(['status', '--project', 'cortexos-daemon-self-audit', '--xml'])
  assertEqual(result.code, 0, 'exit code')
  assert(result.stdout.includes('<cortex_sync_packet'), 'sync packet missing')
  assert(result.stdout.includes('<dna_snapshot'), 'dna snapshot element missing')
})

section('4 · Fixture workspace project')
await check('workspace project with real drift + hotspots is created and DNA-scanned', async () => {
  fixtureDir = await buildFixtureWorkspace('cortex-p5')
  const created = await api('POST', '/projects', {
    name: `P5 CLI Lab ${RUN}`,
    description: 'Phase 5 test project — unified CLI, scope locks, git memory loop.',
    platform: 'codex',
    rootPath: fixtureDir,
  })
  assertEqual(created.status, 201, 'status')
  projectId = created.json.id
  fixtureSlug = created.json.slug
  const dna = await api('POST', `/projects/${projectId}/dna`, { mode: 'scan' })
  assertEqual(dna.status, 200, 'dna status')
  assert(dna.json.dna.fileStats.prismaModels.includes('User'), 'User model not in DNA')
})

section('5 · scope subcommand — lock lifecycle through the CLI')
let defaultLock = null
let scopeFqn = null
await check('scope --list (default) renders the persisted scope lock', async () => {
  const state = await api('GET', `/state?project=${projectId}`)
  defaultLock = state.json.scopeLock
  const human = await cli(['scope', '--project', fixtureSlug])
  assertEqual(human.code, 0, 'exit code')
  assert(human.stdout.includes('SCOPE LOCK —'), 'header missing')
  assert(human.stdout.includes('Locked symbols'), 'locked list missing')
  const json = await cli(['scope', '--project', fixtureSlug, '--list', '--json'])
  assertEqual(json.code, 0, 'json exit code')
  const parsed = JSON.parse(json.stdout)
  assertEqual(parsed.projectId, projectId, 'json projectId')
  assert(Array.isArray(parsed.lockedSymbolFqns), 'json lockedSymbolFqns')
})
await check('scope --lock merges multiple FQNs into the active lock set', async () => {
  scopeFqn = 'src/lib/billing.ts#computeInvoice'
  const second = 'src/components/report-widget.tsx#ReportWidget'
  const result = await cli(['scope', '--project', fixtureSlug, '--lock', scopeFqn, second])
  assertEqual(result.code, 0, 'exit code')
  assert(result.stdout.includes('2 active lock(s)'), 'merge confirmation missing')
  const state = await api('GET', `/state?project=${projectId}`)
  assert(state.json.scopeLock.lockedSymbolFqns.includes(scopeFqn), 'first fqn not locked')
  assert(state.json.scopeLock.lockedSymbolFqns.includes(second), 'second fqn not locked')
})
await check('scope --lock is additive across invocations (merge, not replace)', async () => {
  const third = 'prisma/schema.prisma#User'
  const result = await cli(['scope', '--project', fixtureSlug, '--lock', third])
  assertEqual(result.code, 0, 'exit code')
  const state = await api('GET', `/state?project=${projectId}`)
  assertEqual(state.json.scopeLock.lockedSymbolFqns.length, 3, 'previous locks must survive')
})
await check('scope --lock --exact replaces the lock list', async () => {
  const result = await cli(['scope', '--project', fixtureSlug, '--lock', scopeFqn, '--exact'])
  assertEqual(result.code, 0, 'exit code')
  assert(result.stdout.includes('exact list'), 'exact confirmation missing')
  const state = await api('GET', `/state?project=${projectId}`)
  assertEqual(state.json.scopeLock.lockedSymbolFqns.length, 1, 'exact must replace')
  assert(state.json.scopeLock.lockedSymbolFqns.includes(scopeFqn), 'exact lock content')
})
await check('scope --toggle flips the locked symbol into the allowed set', async () => {
  const result = await cli(['scope', '--project', fixtureSlug, '--toggle', scopeFqn])
  assertEqual(result.code, 0, 'exit code')
  const state = await api('GET', `/state?project=${projectId}`)
  assert(!state.json.scopeLock.lockedSymbolFqns.includes(scopeFqn), 'fqn must leave the locked set')
  assert(state.json.scopeLock.allowedSymbolFqns.includes(scopeFqn), 'fqn must enter the allowed set')
})
await check('scope --unlock removes a symbol and --reset restores the defaults', async () => {
  const lock = await cli(['scope', '--project', fixtureSlug, '--lock', 'tmp/locked.ts#Temp'])
  assertEqual(lock.code, 0, 'lock exit code')
  const unlock = await cli(['scope', '--project', fixtureSlug, '--unlock', 'tmp/locked.ts#Temp'])
  assertEqual(unlock.code, 0, 'unlock exit code')
  const afterUnlock = await api('GET', `/state?project=${projectId}`)
  assert(!afterUnlock.json.scopeLock.lockedSymbolFqns.includes('tmp/locked.ts#Temp'), 'unlock must remove')

  const reset = await cli(['scope', '--project', fixtureSlug, '--reset'])
  assertEqual(reset.code, 0, 'reset exit code')
  const after = await api('GET', `/state?project=${projectId}`)
  assertEqual(
    JSON.stringify(after.json.scopeLock.lockedSymbolFqns),
    JSON.stringify(defaultLock.lockedSymbolFqns),
    'reset must restore the deterministic default locks',
  )
})

section('6 · AST Sentinel enforcement — 422 after `cortexos scope --lock`')
await check('pre-execution agent stages the env-example modify artifact', async () => {
  const run = await api('POST', '/preexecute', {
    projectId,
    prompt: 'add stripe webhook for subscription renewal and update user db',
    targetPlatform: 'codex',
  })
  assertEqual(run.status, 201, 'status')
  const staged = await api('GET', `/preexecute/staged?projectId=${projectId}&status=staged`)
  const env = staged.json.artifacts.find((a) => a.kind === 'env-example')
  assert(env, 'env-example artifact missing')
})
await check('locking .env.example via the CLI BLOCKS the staged modify (422 sentinel)', async () => {
  const lock = await cli(['scope', '--project', fixtureSlug, '--lock', '.env.example'])
  assertEqual(lock.code, 0, 'lock exit code')
  const staged = await api('GET', `/preexecute/staged?projectId=${projectId}&status=staged`)
  const env = staged.json.artifacts.find((a) => a.kind === 'env-example')
  const apply = await api('POST', `/preexecute/staged/${env.id}`, { action: 'apply' })
  assertEqual(apply.status, 422, 'locked-symbol modify must be rejected')
  assert(apply.json.error.includes('locked symbol'), `error must cite the lock (got: ${apply.json.error})`)
})
await check('unlocking via the CLI lets the staged merge apply again', async () => {
  const unlock = await cli(['scope', '--project', fixtureSlug, '--unlock', '.env.example'])
  assertEqual(unlock.code, 0, 'unlock exit code')
  const staged = await api('GET', `/preexecute/staged?projectId=${projectId}&status=staged`)
  const env = staged.json.artifacts.find((a) => a.kind === 'env-example')
  const apply = await api('POST', `/preexecute/staged/${env.id}`, { action: 'apply' })
  assertEqual(apply.status, 200, 'apply status after unlock')
  const onDisk = await fs.readFile(path.join(fixtureDir, '.env.example'), 'utf-8')
  assert(onDisk.includes('STRIPE_SECRET_KEY'), 'merged env keys missing on disk')
})

section('7 · cto subcommand — audit, plan, dispatch, archive')
await check('cto audit lists the real self-audit findings (parseInlineFormatting)', async () => {
  const result = await cli(['cto', 'audit', '--project', 'cortexos-daemon-self-audit'])
  assertEqual(result.code, 0, 'exit code')
  assert(result.stdout.includes('AI CTO AUDIT —'), 'audit header missing')
  assert(result.stdout.includes('parseInlineFormatting'), 'the complexity-100 finding must be listed')
  assert(result.stdout.includes('cortexos scope --lock'), 'remediation must suggest the CLI command')
})
await check('cto audit --force bypasses the cache (fresh scan)', async () => {
  const result = await cli(['cto', 'audit', '--project', 'cortexos-daemon-self-audit', '--force'])
  assertEqual(result.code, 0, 'exit code')
  assert(result.stdout.includes('fresh scan'), 'fresh-scan marker missing')
})
await check('cto audit --json returns the full machine-readable contract', async () => {
  const result = await cli(['cto', 'audit', '--project', fixtureSlug, '--json'])
  assertEqual(result.code, 0, 'exit code')
  const parsed = JSON.parse(result.stdout)
  assert(Array.isArray(parsed.audit.recommendations), 'audit.recommendations missing')
  assert(typeof parsed.audit.stats.symbolsScanned === 'number', 'stats.symbolsScanned missing')
  const categories = parsed.audit.recommendations.map((r) => r.category)
  assert(categories.includes('SCOPE_LOCK_HAZARD'), `fixture must fire SCOPE_LOCK_HAZARD (got: ${categories.join(',')})`)
})
await check('cto plan → dispatch → archive full lifecycle over the CLI', async () => {
  const build = await cli(['cto', 'plan', '--project', fixtureSlug, '--goal', `ship the export endpoint for run ${RUN}`])
  assertEqual(build.code, 0, 'build exit code')
  assert(build.stdout.includes('Built DAG plan'), 'build confirmation missing')
  const planId = /Built DAG plan ([a-zA-Z0-9]+)/.exec(build.stdout)?.[1]
  assert(planId, 'planId not advertised')
  assert(build.stdout.includes('Wave 1 (parallel):'), 'wave render missing')

  const dispatch = await cli(['cto', 'dispatch', '--plan-id', planId])
  assertEqual(dispatch.code, 0, 'dispatch exit code')
  assert(/Status: (dispatched|completed)/.test(dispatch.stdout), 'dispatch status missing')
  assert(
    dispatch.stdout.includes('✓ ') || dispatch.stdout.includes('Executed locally (0 cloud tokens)'),
    'wave-1 local subtasks must really execute',
  )

  const archive = await cli(['cto', 'archive', '--plan-id', planId])
  assertEqual(archive.code, 0, 'archive exit code')
  assert(archive.stdout.includes('Archived DAG plan'), 'archive confirmation missing')
  const audit = await api('GET', `/cto?project=${projectId}`)
  assert(!audit.json.plans.some((p) => p.id === planId), 'archived plan must leave the active list')
})
await check('cto plan --execute chains the dispatch immediately', async () => {
  const result = await cli(['cto', 'plan', '--project', fixtureSlug, '--goal', `extract validation helpers for run ${RUN}`, '--execute'])
  assertEqual(result.code, 0, 'exit code')
  assert(result.stdout.includes('Built and dispatched DAG plan'), 'chained confirmation missing')
  assert(
    result.stdout.includes('✓ ') || result.stdout.includes('Executed locally (0 cloud tokens)'),
    'wave-1 must execute through the chained dispatch',
  )
  const planId = /dispatched DAG plan ([a-zA-Z0-9]+)/.exec(result.stdout)?.[1]
  assert(planId, 'planId not advertised')
  const archive = await cli(['cto', 'archive', '--plan-id', planId])
  assertEqual(archive.code, 0, 'archive exit code')
})

section('8 · hooks install — shim, config and chaining')
await check('install writes an executable shim, .cortex/daemon.json and gitignore hygiene', async () => {
  const result = await cli(['hooks', 'install', '--dir', fixtureDir, '--project', fixtureSlug])
  assertEqual(result.code, 0, 'exit code')
  assert(result.stdout.includes('installed (created)'), 'install confirmation missing')

  const hookStat = await fs.stat(path.join(fixtureDir, '.git', 'hooks', 'post-commit'))
  assert(hookStat.mode & 0o111, 'hook must be executable')
  const hook = await fs.readFile(path.join(fixtureDir, '.git', 'hooks', 'post-commit'), 'utf8')
  assert(hook.includes('# >>> cortexos >>>'), 'managed marker missing')
  assert(hook.includes('hooks run-post-commit'), 'CLI invocation missing')

  const config = JSON.parse(await fs.readFile(path.join(fixtureDir, '.cortex', 'daemon.json'), 'utf8'))
  assertEqual(config.slug, fixtureSlug, 'config slug')
  assertEqual(config.daemonUrl, BASE, 'config daemonUrl')
  const gitignore = await fs.readFile(path.join(fixtureDir, '.gitignore'), 'utf8')
  assert(gitignore.split('\n').some((l) => l.trim() === '.cortex/'), '.cortex/ must be gitignored')
})
await check('install is idempotent — refresh keeps exactly one managed block', async () => {
  const result = await cli(['hooks', 'install', '--dir', fixtureDir, '--project', fixtureSlug])
  assertEqual(result.code, 0, 'exit code')
  assert(result.stdout.includes('(refreshed)'), 'refresh mode missing')
  const hook = await fs.readFile(path.join(fixtureDir, '.git', 'hooks', 'post-commit'), 'utf8')
  assertEqual(hook.split('# >>> cortexos >>>').length - 1, 1, 'exactly one managed block')
})
await check('install chains after a foreign sh hook (and both run)', async () => {
  const foreignDir = await buildFixtureWorkspace('cortex-p5-foreign-sh')
  await fs.writeFile(path.join(foreignDir, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho foreign-sh-hook-ran\n')
  const install = await cli(['hooks', 'install', '--dir', foreignDir, '--project', fixtureSlug])
  assert(install.stdout.includes('(chained-sh)'), 'chain mode missing')
  const hook = await fs.readFile(path.join(foreignDir, '.git', 'hooks', 'post-commit'), 'utf8')
  assert(hook.includes('foreign-sh-hook-ran'), 'foreign part must be preserved')
  assert(hook.includes('# >>> cortexos >>>'), 'managed block missing')

  await fs.writeFile(path.join(foreignDir, 'src', 'lib', 'chained.ts'), 'export function chainedShMarker() { return 1 }\n')
  const { stdout, stderr } = await exec('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'chore: sh chain'], { cwd: foreignDir, env: cliEnv() })
  assert(`${stdout}${stderr}`.includes('foreign-sh-hook-ran'), 'foreign hook must still run (git routes hook output to stderr)')
  const sha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: foreignDir })).stdout.trim()
  const interactions = await projectInteractions(projectId)
  assert(interactions.some((i) => i.sessionId === `git-commit-${sha.slice(0, 8)}`), 'chained extraction missing')
  await fs.rm(foreignDir, { recursive: true, force: true })
})
await check('install chains after a foreign node hook (node-flavoured block)', async () => {
  const foreignDir = await buildFixtureWorkspace('cortex-p5-foreign-node')
  await fs.writeFile(
    path.join(foreignDir, '.git', 'hooks', 'post-commit'),
    '#!/usr/bin/env node\nconsole.log("foreign-node-hook-ran");\n',
  )
  const install = await cli(['hooks', 'install', '--dir', foreignDir, '--project', fixtureSlug])
  assert(install.stdout.includes('(chained-node)'), 'chain-node mode missing')
  const hook = await fs.readFile(path.join(foreignDir, '.git', 'hooks', 'post-commit'), 'utf8')
  assert(hook.includes('foreign-node-hook-ran'), 'foreign part must be preserved')
  assert(hook.includes('// >>> cortexos >>>'), 'node-flavoured managed block missing')

  await fs.writeFile(path.join(foreignDir, 'src', 'lib', 'chained.ts'), 'export function chainedNodeMarker() { return 2 }\n')
  const { stdout, stderr } = await exec('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'chore: node chain'], { cwd: foreignDir, env: cliEnv() })
  assert(`${stdout}${stderr}`.includes('foreign-node-hook-ran'), 'foreign node hook must still run (git routes hook output to stderr)')
  const sha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: foreignDir })).stdout.trim()
  const interactions = await projectInteractions(projectId)
  assert(interactions.some((i) => i.sessionId === `git-commit-${sha.slice(0, 8)}`), 'chained node extraction missing')
  await fs.rm(foreignDir, { recursive: true, force: true })
})

section('9 · Git hook → cortex_extract_memory round-trip (real commit)')
let hookSha = null
await check('a real commit triggers extraction: interaction, symbols, memories, timeline', async () => {
  const before = await api('GET', `/memories?projectId=${projectId}&limit=200`)
  const memoriesBefore = before.json.memories.length
  const healthBefore = await api('GET', '/health')
  const commitsBefore = healthBefore.json.counts.commits

  await fs.writeFile(
    path.join(fixtureDir, 'src', 'lib', 'roundtrip.ts'),
    'export function roundTripSymbol(units: number): number {\n  return units * 100\n}\nexport const ROUNDTRIP_CONST = 7\n',
  )
  hookSha = await gitCommit(
    fixtureDir,
    'feat(pricing): integer-cents money handling\n\nDecided: all money values are stored as integer cents to eliminate float rounding drift.\nTODO: migrate the invoices table columns.\nThis fixes the rounding bug in invoice totals.',
  )

  const interactions = await projectInteractions(projectId)
  const interaction = interactions.find((i) => i.sessionId === `git-commit-${hookSha.slice(0, 8)}`)
  assert(interaction, `interaction git-commit-${hookSha.slice(0, 8)} missing`)
  assertEqual(interaction.platform, 'git-hook', 'interaction platform')
  assert(interaction.rawText.includes('[git commit '), 'synthesized user turn missing')
  assert(interaction.rawText.includes('AST symbols added: src/lib/roundtrip.ts#roundTripSymbol'), 'detected AST symbols missing from the transcript')
  assert(interaction.rawText.includes('src/lib/roundtrip.ts#ROUNDTRIP_CONST'), 'const symbol detection missing')

  const after = await api('GET', `/memories?projectId=${projectId}&limit=200`)
  assert(after.json.memories.length >= memoriesBefore + 2, `memories must grow by >= 2 (before ${memoriesBefore}, after ${after.json.memories.length})`)
  const keys = after.json.memories.map((m) => m.key)
  assert(keys.some((k) => k.includes('todo')), 'todo memory missing')
  assert(keys.some((k) => k.includes('rounding')), 'bug memory missing')

  const state = await api('GET', `/state?project=${projectId}`)
  const timelineHit = state.json.timeline.find((e) => e.summary.includes(hookSha.slice(0, 8)))
  assert(timelineHit, 'git.commit timeline event missing')
  const turnHit = state.json.timeline.find((e) => e.summary.includes('session-turn') || e.kind === 'session-turn')
  assert(turnHit || state.json.timeline.some((e) => e.summary.includes('[git commit')), 'turn/continuity timeline entry missing')

  const healthAfter = await api('GET', '/health')
  assert(healthAfter.json.counts.commits === commitsBefore + 1, `GitCommit count must grow by 1 (${commitsBefore} → ${healthAfter.json.counts.commits})`)
})

section('10 · Offline fail-open spooling + FIFO replay + dedupe')
await check('git commit SUCCEEDS with the daemon down and the entry is spooled', async () => {
  const configPath = path.join(fixtureDir, '.cortex', 'daemon.json')
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
  await fs.writeFile(configPath, JSON.stringify({ ...config, daemonUrl: DEAD_DAEMON }))

  await fs.writeFile(path.join(fixtureDir, 'src', 'lib', 'offline.ts'), 'export function offlineSpoolMarker() { return 3 }\n')
  const offlineSha = await gitCommit(fixtureDir, 'chore: committed while the daemon is down', hookEnv())
  assert(offlineSha, 'git commit must succeed (fail-open)')

  const spoolPath = path.join(fixtureDir, '.cortex', 'spool', 'pending-git-commits.jsonl')
  const lines = (await fs.readFile(spoolPath, 'utf8')).split('\n').filter((l) => l.trim())
  assertEqual(lines.length, 1, 'exactly one spool entry')
  const entry = JSON.parse(lines[0])
  assertEqual(entry.commit.sha, offlineSha, 'spooled sha')
  assertEqual(entry.project, fixtureSlug, 'spooled project')
})
await check('direct run-post-commit against a dead daemon spools with exit 0', async () => {
  const result = await cli(['hooks', 'run-post-commit', '--dir', fixtureDir, '--sha', hookSha, '--daemon-url', DEAD_DAEMON])
  assertEqual(result.code, 0, 'must exit 0 (fail-open)')
  assert(result.stdout.includes('SPOOLED'), 'spooled confirmation missing')
  assert(result.stdout.includes('pending-git-commits.jsonl'), 'spool path missing')

  // A duplicate of the same SHA — exercises the in-file FIFO dedupe.
  const again = await cli(['hooks', 'run-post-commit', '--dir', fixtureDir, '--sha', hookSha, '--daemon-url', DEAD_DAEMON])
  assertEqual(again.code, 0, 'second spool exit code')
})
await check('flush-spool replays FIFO, skips already-extracted SHAs and empties the queue', async () => {
  const spoolPath = path.join(fixtureDir, '.cortex', 'spool', 'pending-git-commits.jsonl')
  const before = (await fs.readFile(spoolPath, 'utf8')).split('\n').filter((l) => l.trim())
  assertEqual(before.length, 3, `expected 3 spooled entries (got ${before.length})`)

  const flush = await cli(['hooks', 'flush-spool', '--dir', fixtureDir])
  assertEqual(flush.code, 0, 'exit code')
  assert(/1 replayed/.test(flush.stdout), `first flush must replay the offline commit (got: ${flush.stdout.trim()})`)
  assert(/1 duplicate\(s\) skipped/.test(flush.stdout), 'the already-extracted SHA must be skipped')

  const json = await cli(['hooks', 'flush-spool', '--dir', fixtureDir, '--json'])
  const parsed = JSON.parse(json.stdout)
  assertEqual(parsed.flushed, 0, 'second flush must find an empty queue')
  assertEqual(parsed.remaining, 0, 'nothing may remain')

  const offlineSha = JSON.parse(before[0]).commit.sha
  const interactions = await projectInteractions(projectId)
  assert(interactions.some((i) => i.sessionId === `git-commit-${offlineSha.slice(0, 8)}`), 'offline commit must be replayed')
  assert(!await fs.stat(spoolPath).then(() => true).catch(() => false), 'spool file must be removed when empty')
})
await check('the replayed commit produced the full memory + timeline trail', async () => {
  const offlineSha = (await exec('git', ['rev-parse', 'HEAD'], { cwd: fixtureDir })).stdout.trim()
  const interactions = await projectInteractions(projectId)
  const interaction = interactions.find((i) => i.sessionId === `git-commit-${offlineSha.slice(0, 8)}`)
  assert(interaction, 'replayed interaction missing')
  assert(interaction.rawText.includes('offlineSpoolMarker'), 'replayed AST symbols missing')
  const state = await api('GET', `/state?project=${projectId}`)
  assert(state.json.timeline.some((e) => e.summary.includes(offlineSha.slice(0, 8))), 'replayed git.commit timeline event missing')
})
await check('flush-spool on an empty queue is a clean no-op', async () => {
  const result = await cli(['hooks', 'flush-spool', '--dir', fixtureDir, '--json'])
  assertEqual(result.code, 0, 'exit code')
  const parsed = JSON.parse(result.stdout)
  assertEqual(parsed.flushed, 0, 'flushed')
  assertEqual(parsed.remaining, 0, 'remaining')
})

section('11 · MCP server regression')
await check('MCP server still lists all 10 tools (Phase 5 breaks none)', async () => {
  const mcp = McpClient.spawn()
  try {
    const tools = await mcp.request('tools/list')
    const names = tools.tools.map((t) => t.name)
    assertEqual(names.length, 10, `tool count (got: ${names.join(', ')})`)
  } finally {
    await mcp.kill()
  }
})

section('12 · Cascade cleanup')
await check('deleting the fixture project cascades and temp repos are removed', async () => {
  const del = await api('DELETE', `/projects/${projectId}`)
  assertEqual(del.status, 200, 'delete status')
  const gone = await api('GET', `/state?project=${projectId}`)
  assertEqual(gone.status, 404, 'state must 404 after cascade delete')
  await fs.rm(fixtureDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const passed = results.filter((r) => r.pass).length
const failed = results.length - passed
console.log(`\n${'─'.repeat(64)}`)
console.log(`Phase 5 suite: ${passed}/${results.length} passed${failed > 0 ? ` — ${failed} FAILED` : ''}`)
if (failed > 0) {
  console.log('\nFailed checks:')
  for (const r of results.filter((x) => !x.pass)) console.log(`  ✗ [${r.section}] ${r.name}\n    ${r.error}`)
  process.exit(1)
}
process.exit(0)
