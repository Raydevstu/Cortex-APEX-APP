#!/usr/bin/env node
/**
 * CortexOS — Phase 4 automated test suite.
 *
 * Runs against the live daemon (default http://localhost:3000; pass a base
 * URL as argv[2], e.g. http://localhost:4300 for the Command Center port)
 * and verifies every Phase 4 capability end-to-end:
 *
 *   - Daemon health (v0.4.0, phase-4 capabilities, dagPlans count)
 *   - Settings: cloudEscalationModel (DAG cloud tier) round-trip
 *   - GET /api/cortex/state full contract on the live demo project:
 *     graph DTO labels, telemetry arithmetic consistency, timeline,
 *     CTO recommendations and the <cortex_sync_packet> XML envelope
 *   - Real workspace audit on a fixture repo: SCOPE_LOCK_HAZARD fires on a
 *     genuine high-complexity symbol, ARCHITECTURE_DRIFT fires on a real
 *     ui→storage import, stats carry the scanned counts
 *   - AST Semantic Scope Locks: toggle round-trip, persistence, timeline
 *     audit trail, RESET reseed
 *   - Scope-lock ENFORCEMENT: a staged `modify` of a file with explicitly
 *     locked symbols is rejected (422) until unlocked — then applies
 *   - Multi-Agent DAG Orchestrator: build → topological waves validated →
 *     dispatch (wave-1 local subtasks REALLY execute via the Phase 3 tool
 *     runner; cloud subtask gets the Tier-1 payload) → subtask confirmation
 *     → re-dispatch settles the plan → archive
 *   - Handoff XML contract (structure + escaping)
 *   - Validation envelopes (422/404)
 *   - MCP server regression + functional CLI wiring (10 tools — the Phase 4
 *     cortex_state / cortex_cto tools are exercised through real
 *     tools/call round-trips: state read, scope toggle + reset, CTO audit,
 *     DAG build → dispatch → archive)
 *   - Cascade cleanup
 *
 * Usage:  node scripts/test-phase4.mjs [baseUrl]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const BASE = process.argv[2] ?? 'http://localhost:3000'
const API = `${BASE}/api/cortex`
const RUN = Date.now().toString(36).slice(-5)

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
// Minimal stdio JSON-RPC client for the MCP server regression
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
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${payload}\n`)
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`MCP request timed out: ${method}`))
        }
      }, 30_000)
    })
  }
  async callTool(name, args) {
    return this.request('tools/call', { name, arguments: args })
  }
  kill() {
    return new Promise((resolve) => {
      this.child.on('exit', () => resolve())
      this.child.kill('SIGTERM')
      setTimeout(() => this.child.kill('SIGKILL'), 3000)
    })
  }
}

// ---------------------------------------------------------------------------
// Fixture workspace (real files, real git repo)
// ---------------------------------------------------------------------------
async function buildFixtureWorkspace() {
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), `cortex-p4-${RUN}-`))
  await fs.mkdir(path.join(fixtureDir, 'src', 'components'), { recursive: true })
  await fs.mkdir(path.join(fixtureDir, 'src', 'lib'), { recursive: true })
  await fs.mkdir(path.join(fixtureDir, 'src', 'app', 'api', 'health'), { recursive: true })
  await fs.mkdir(path.join(fixtureDir, 'prisma'), { recursive: true })

  await fs.writeFile(
    path.join(fixtureDir, 'prisma', 'schema.prisma'),
    [
      'datasource db { provider = "sqlite"; url = env("DATABASE_URL") }',
      '',
      'model User {',
      '  id        String   @id @default(cuid())',
      '  email     String   @unique',
      '  name      String?',
      '  role      String   @default("member")',
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
      '  else if (total > 5000 && (usage.tier === "pro" || usage.tier === "member")) { total *= 0.95 }',
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

  await fs.writeFile(
    path.join(fixtureDir, 'src', 'app', 'api', 'health', 'route.ts'),
    ["export async function GET() { return Response.json({ ok: true }) }", ''].join('\n'),
  )
  await fs.writeFile(path.join(fixtureDir, '.env.example'), 'DATABASE_URL=file:./dev.db\n')

  await exec('git', ['init', '-q', '.'], { cwd: fixtureDir })
  await exec('git', ['add', '.'], { cwd: fixtureDir })
  await exec('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'], { cwd: fixtureDir })
  return fixtureDir
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
let fixtureDir = null
let projectId = null
let planId = null

section('1 · Daemon health — v0.4.0 Phase 4 capabilities')
await check('health reports v0.4.0 with the phase-4 capability set and dagPlans counter', async () => {
  const { status, json } = await api('GET', '/health')
  assertEqual(status, 200, 'status')
  assertEqual(json.status, 'online', 'daemon status')
  assertEqual(json.version, '0.4.0', 'version')
  assert(json.phase.includes('Phase 4'), `phase string must mention Phase 4 (got: ${json.phase})`)
  for (const capability of [
    'phase4-visual-command-center', 'phase4-ai-cto-mode', 'phase4-dag-orchestrator', 'phase4-ast-scope-locks',
  ]) {
    assert(json.capabilities.includes(capability), `capability ${capability} missing`)
  }
  assert(typeof json.counts.dagPlans === 'number', 'counts.dagPlans missing')
})

section('2 · Settings — DAG cloud escalation model')
await check('cloudEscalationModel round-trips through PUT /settings', async () => {
  const original = await api('GET', '/settings')
  const put = await api('PUT', '/settings', { cloudEscalationModel: 'gpt-4o-class' })
  assertEqual(put.status, 200, 'status')
  assertEqual(put.json.settings.cloudEscalationModel, 'gpt-4o-class', 'value not persisted')
  const restore = await api('PUT', '/settings', {
    cloudEscalationModel: original.json.settings.cloudEscalationModel ?? 'claude-sonnet-class',
  })
  assertEqual(restore.status, 200, 'restore status')
})

section('3 · Command Center state contract (live demo project)')
let demoState = null
await check('GET /state resolves the most recently active project by default', async () => {
  const { status, json } = await api('GET', '/state')
  assertEqual(status, 200, 'status')
  demoState = json
  assert(json.projectName && json.projectSlug, 'project identity missing')
  assert(Array.isArray(json.graph.nodes) && json.graph.nodes.length > 0, 'graph nodes empty')
  assert(Array.isArray(json.graph.edges), 'graph edges missing')
  assert(json.serverTime, 'serverTime missing')
})
await check('graph nodes carry blueprint labels and valid scope statuses', async () => {
  const validLabels = ['Module', 'SourceFile', 'ASTSymbol', 'ArchitecturalDecision', 'Task', 'Bug', 'SessionTurn', 'Tech', 'Feature', 'External', 'Root']
  const validScopes = ['IN_SCOPE', 'LOCKED', 'NEUTRAL']
  for (const node of demoState.graph.nodes) {
    assert(validLabels.includes(node.label), `invalid node label ${node.label}`)
    assert(validScopes.includes(node.scopeStatus), `invalid scopeStatus ${node.scopeStatus}`)
    assert(node.id && node.title, 'node id/title missing')
  }
  const edgeIds = new Set(demoState.graph.nodes.map((n) => n.id))
  for (const edge of demoState.graph.edges) {
    assert(edgeIds.has(edge.source) && edgeIds.has(edge.target), `edge ${edge.id} references a missing node`)
    assert(typeof edge.relationship === 'string' && edge.relationship.length > 0, 'edge relationship missing')
  }
})
await check('telemetry is arithmetically consistent (Token Savings Engine accounting)', async () => {
  const t = demoState.telemetry
  assert(t.totalPromptsIntercepted >= 0, 'totalPromptsIntercepted missing')
  assert(t.rawContextTokensEstimated >= t.injectedSyncPacketTokens, 'raw baseline must dominate injected tokens')
  assert(t.netTokensSaved >= 0, 'netTokensSaved must be non-negative')
  assert(t.compressionRatioPct >= 0 && t.compressionRatioPct <= 100, 'compressionRatioPct out of range')
  assertEqual(t.localOllamaOffloadCount + t.cloudEscalationCount, t.totalPromptsIntercepted, 'offload + escalation must equal intercepted prompts')
  assert(t.localOffloadPct >= 0 && t.localOffloadPct <= 100, 'localOffloadPct out of range')
  assert(t.pricingUsdPerMTokens > 0, 'pricing constant missing')
  const expectedCost = Math.round((t.netTokensSaved / 1_000_000) * t.pricingUsdPerMTokens * 100) / 100
  assertEqual(t.estimatedCostSavingsUsd, expectedCost, 'cost savings must derive from the documented rate')
  assert(Array.isArray(t.historyByDay), 'historyByDay missing')
})
await check('timeline carries cross-platform continuity events', async () => {
  assert(demoState.timeline.length > 0, 'timeline empty for the demo project')
  for (const event of demoState.timeline) {
    assert(event.turnId && event.timestamp, 'turnId/timestamp missing')
    assert(typeof event.platform === 'string' && event.platform.length > 0, 'platform missing')
    assert(typeof event.summary === 'string' && event.summary.length > 0, 'summary missing')
    assert(Array.isArray(event.symbolsTouched) && Array.isArray(event.decisionsRatified), 'symbolsTouched/decisionsRatified missing')
  }
})
await check('CTO recommendations are present and structurally valid', async () => {
  assert(demoState.ctoRecommendations.length >= 1, 'no recommendations — audit must at least emit the fallback advisory')
  const categories = ['ARCHITECTURE_DRIFT', 'SCOPE_LOCK_HAZARD', 'TOKEN_OPTIMIZATION', 'COMPLEXITY_HOTSPOT', 'UNLINKED_REQUIREMENT']
  const actions = ['LOCK_SYMBOLS', 'DECOMPOSE_DAG', 'REFACTOR_LOCAL', 'RATIFY_ADR']
  const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'OPTIMIZATION']
  for (const rec of demoState.ctoRecommendations) {
    assert(categories.includes(rec.category), `invalid category ${rec.category}`)
    assert(severities.includes(rec.severity), `invalid severity ${rec.severity}`)
    assert(actions.includes(rec.suggestedAction.actionType), `invalid actionType ${rec.suggestedAction.actionType}`)
    assert(rec.suggestedAction.commandPreview, 'commandPreview missing')
    assert(rec.rationale && rec.rationale.length > 20, 'rationale must be substantive')
  }
})
await check('syncPacketXml is a well-formed <cortex_sync_packet> envelope', async () => {
  const xml = demoState.syncPacketXml
  assert(xml.startsWith('<cortex_sync_packet version="1.0.0"'), 'packet must open with the versioned root element')
  assert(xml.trimEnd().endsWith('</cortex_sync_packet>'), 'packet must close the root element')
  for (const element of ['<active_task', '<allowed_symbols>', '<forbidden_paths>', '<dna_snapshot>', '<scoped_graph_context', '<continuity_state>', '<recent_continuity_delta']) {
    assert(xml.includes(element), `element ${element} missing`)
  }
  const opens = (xml.match(/<[a-z_]+[\s>]/g) ?? []).length
  const closes = (xml.match(/<\/[a-z_]+>/g) ?? []).length
  const selfClosing = (xml.match(/\/>/g) ?? []).length
  assertEqual(opens, closes + selfClosing, 'tag balance (open vs close+self-closing)')
})

section('4 · Fixture workspace project')
await check('workspace project with real drift + hotspots is created and DNA-scanned', async () => {
  fixtureDir = await buildFixtureWorkspace()
  const created = await api('POST', '/projects', {
    name: `P4 CTO Lab ${RUN}`,
    description: 'Phase 4 test project — AI CTO audit, scope locks, DAG orchestration.',
    platform: 'codex',
    rootPath: fixtureDir,
  })
  assertEqual(created.status, 201, 'status')
  projectId = created.json.id
  const dna = await api('POST', `/projects/${projectId}/dna`, { mode: 'scan' })
  assertEqual(dna.status, 200, 'dna status')
  assert(dna.json.dna.fileStats.prismaModels.includes('User'), 'User model not in DNA')
})

section('5 · AI CTO audit — real workspace drift detection')
let auditJson = null
await check('GET /cto scans the workspace and reports real stats', async () => {
  const { status, json } = await api('GET', `/cto?project=${projectId}&force=true`)
  assertEqual(status, 200, 'status')
  auditJson = json
  assert(json.audit.stats.symbolsScanned >= 3, `symbolsScanned too low: ${json.audit.stats.symbolsScanned}`)
  assert(json.audit.stats.filesScanned >= 3, `filesScanned too low: ${json.audit.stats.filesScanned}`)
  assert(json.audit.stats.workspaceRoot === fixtureDir, 'workspaceRoot mismatch')
})
await check('SCOPE_LOCK_HAZARD fires on the genuine high-complexity symbol', async () => {
  const rec = auditJson.audit.recommendations.find((r) => r.category === 'SCOPE_LOCK_HAZARD')
  assert(rec, 'no SCOPE_LOCK_HAZARD recommendation')
  assert(rec.impactedSymbols.some((fqn) => fqn.includes('billing.ts#computeInvoice')), `expected computeInvoice in impacted symbols: ${rec.impactedSymbols}`)
  assert(rec.rationale.includes('cyclomatic complexity'), 'rationale must cite the complexity')
  assertEqual(rec.suggestedAction.actionType, 'LOCK_SYMBOLS', 'actionType')
})
await check('ARCHITECTURE_DRIFT fires on the real ui→storage import', async () => {
  const rec = auditJson.audit.recommendations.find((r) => r.category === 'ARCHITECTURE_DRIFT')
  assert(rec, 'no ARCHITECTURE_DRIFT recommendation')
  assert(rec.impactedSymbols.some((s) => s.includes('report-widget.tsx')), 'violation must cite report-widget.tsx')
  assert(rec.rationale.includes('ui') && rec.rationale.includes('storage'), 'rationale must name the layers')
  assertEqual(rec.severity, 'CRITICAL', 'drift severity')
})
await check('GET /state for the workspace project exposes ASTSymbol nodes with real complexity', async () => {
  const { status, json } = await api('GET', `/state?project=${projectId}`)
  assertEqual(status, 200, 'status')
  const symbols = json.graph.nodes.filter((n) => n.label === 'ASTSymbol')
  assert(symbols.length > 0, 'no ASTSymbol nodes')
  const invoice = symbols.find((n) => n.fqn && n.fqn.includes('computeInvoice'))
  assert(invoice, 'computeInvoice symbol node missing')
  assert(invoice.complexity > 12, `computeInvoice complexity must exceed 12 (got ${invoice.complexity})`)
  assert(invoice.lineSpan && invoice.signature, 'symbol node must carry lineSpan + signature')
  assert(json.audit.symbolsScanned > 0, 'state audit section must carry scanned counts')
})

section('6 · AST Semantic Scope Locks')
let probeFqn = null
await check('TOGGLE_SYMBOL_SCOPE unlocks a symbol into the active write scope', async () => {
  const state = await api('GET', `/state?project=${projectId}`)
  const symbol = state.json.graph.nodes.find((n) => n.fqn && n.label === 'ASTSymbol')
  probeFqn = symbol.fqn
  const toggle = await api('POST', '/state', { projectId, action: 'TOGGLE_SYMBOL_SCOPE', fqn: probeFqn })
  assertEqual(toggle.status, 200, 'status')
  assert(toggle.json.scopeLock.allowedSymbolFqns.includes(probeFqn), 'fqn not in allowed list')
  assertEqual(toggle.json.scopeLock.source, 'toggle', 'source')
})
await check('second toggle locks the symbol (sentinel-enforced)', async () => {
  const toggle = await api('POST', '/state', { projectId, action: 'TOGGLE_SYMBOL_SCOPE', fqn: probeFqn })
  assertEqual(toggle.status, 200, 'status')
  assert(!toggle.json.scopeLock.allowedSymbolFqns.includes(probeFqn), 'fqn must leave the allowed list')
  assert(toggle.json.scopeLock.lockedSymbolFqns.includes(probeFqn), 'fqn must join the locked list')
  const symbolNode = toggle.json.graph.nodes.find((n) => n.fqn === probeFqn)
  assertEqual(symbolNode?.scopeStatus, 'LOCKED', 'graph node must render LOCKED')
})
await check('scope lock persists across requests and writes a timeline audit trail', async () => {
  const state = await api('GET', `/state?project=${projectId}`)
  assert(state.json.scopeLock.lockedSymbolFqns.includes(probeFqn), 'lock must persist')
  assertEqual(state.json.activeTask.allowedSymbolFqns.includes(probeFqn), false, 'active task must reflect the lock')
  const timeline = await api('GET', `/projects/${projectId}/timeline`)
  const scopeEvents = timeline.json.events.filter((e) => e.kind.startsWith('scope.'))
  assert(scopeEvents.length >= 2, 'scope.toggled events missing from the timeline')
})
await check('RESET_SCOPE_LOCK reseeds deterministically', async () => {
  const reset = await api('POST', '/state', { projectId, action: 'RESET_SCOPE_LOCK' })
  assertEqual(reset.status, 200, 'status')
  assert(reset.json.scopeLock.source.startsWith('seed:'), `source must be a seed (got ${reset.json.scopeLock.source})`)
  assert(!reset.json.scopeLock.lockedSymbolFqns.includes(probeFqn), 'explicit lock must be cleared')
})

section('7 · Scope-lock enforcement on the staging guard')
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
  assertEqual(env.action, 'modify', 'env-example must be a modify artifact')
})
await check('locking .env.example BLOCKS the staged modify (422, sentinel)', async () => {
  const lock = await api('POST', '/state', {
    projectId, action: 'SET_SCOPE_LOCK', lockedSymbolFqns: ['.env.example'],
  })
  assertEqual(lock.status, 200, 'lock status')
  const staged = await api('GET', `/preexecute/staged?projectId=${projectId}&status=staged`)
  const env = staged.json.artifacts.find((a) => a.kind === 'env-example')
  const apply = await api('POST', `/preexecute/staged/${env.id}`, { action: 'apply' })
  assertEqual(apply.status, 422, 'locked-symbol modify must be rejected')
  assert(apply.json.error.includes('locked symbol'), `error must cite the lock (got: ${apply.json.error})`)
})
await check('unlocking .env.example lets the merge apply again', async () => {
  const unlock = await api('POST', '/state', {
    projectId, action: 'SET_SCOPE_LOCK', lockedSymbolFqns: [],
  })
  assertEqual(unlock.status, 200, 'unlock status')
  const staged = await api('GET', `/preexecute/staged?projectId=${projectId}&status=staged`)
  const env = staged.json.artifacts.find((a) => a.kind === 'env-example')
  const apply = await api('POST', `/preexecute/staged/${env.id}`, { action: 'apply' })
  assertEqual(apply.status, 200, 'apply status after unlock')
  const onDisk = await fs.readFile(path.join(fixtureDir, '.env.example'), 'utf-8')
  assert(onDisk.includes('STRIPE_SECRET_KEY'), 'merged env keys missing on disk')
})

section('8 · Multi-Agent DAG Orchestrator')
await check('BUILD_DAG_PLAN decomposes a goal into a persisted plan', async () => {
  const build = await api('POST', '/cto', {
    action: 'BUILD_DAG_PLAN',
    projectId,
    goal: 'add usage metering and monthly invoicing to the User API',
  })
  assertEqual(build.status, 200, 'status')
  planId = build.json.plan.id
  const plan = build.json.plan
  assertEqual(plan.status, 'draft', 'initial status')
  assertEqual(plan.subtasks.length, 4, 'canonical 4-subtask decomposition')
  assertEqual(plan.waves.length, 3, 'topological wave count')
  assertEqual(plan.waves[0].join(), 'subtask-1-contract-validation', 'wave 1 = contract validation (no deps)')
  assertEqual(plan.waves[1].join(), 'subtask-2-core-implementation', 'wave 2 = core implementation')
  assertEqual([...plan.waves[2]].sort().join(), 'subtask-3-tdd-verification,subtask-4-continuity-sync', 'wave 3 = tests + continuity')
  const local = plan.subtasks.filter((s) => s.agentKind === 'local')
  const cloud = plan.subtasks.filter((s) => s.agentKind === 'cloud')
  assertEqual(local.length, 3, '3 local subtasks')
  assertEqual(cloud.length, 1, '1 cloud subtask')
  assert(cloud[0].assignedAgent.startsWith('cloud:'), 'cloud agent label')
  assert(local.every((s) => s.assignedAgent.startsWith('local-ollama:')), 'local agent labels')
  assert(plan.auditMeta.estimatedTokenSavings >= 3 * 1400, 'grounded savings estimate missing')
})
await check('DISPATCH_PLAN executes wave-1 locally (real tools) and emits the Tier-1 cloud payload', async () => {
  const dispatch = await api('POST', '/cto', { action: 'DISPATCH_PLAN', planId })
  assertEqual(dispatch.status, 200, 'status')
  const plan = dispatch.json.plan
  assertEqual(plan.status, 'dispatched', 'plan status')

  const validation = plan.subtasks.find((s) => s.id === 'subtask-1-contract-validation')
  assertEqual(validation.status, 'completed', 'wave-1 local subtask must complete')
  assert(validation.artifacts && validation.artifacts.length > 0, 'local subtask must carry executed artifacts')
  assert(validation.artifacts.some((a) => a.toolName === 'schema_inspect' && a.ok), 'schema_inspect must really run')
  assert(validation.tokensSavedEstimate > 0, 'local savings must be accounted')

  const core = plan.subtasks.find((s) => s.id === 'subtask-2-core-implementation')
  assertEqual(core.status, 'dispatched', 'cloud subtask must be dispatched with its payload')
  assert(core.payload.includes('[CORTEX-OS SYNC'), 'payload: sync header missing')
  assert(core.payload.includes('[AST SCOPE GUARD & ARCHITECTURE LOCK]'), 'payload: scope guard section missing')
  assert(core.payload.includes('[VERIFICATION CRITERIA]'), 'payload: verification section missing')

  for (const pending of ['subtask-3-tdd-verification', 'subtask-4-continuity-sync']) {
    assertEqual(plan.subtasks.find((s) => s.id === pending).status, 'pending', `${pending} must wait for the cloud dependency`)
  }
})
await check('confirming the cloud subtask and re-dispatching settles the plan', async () => {
  const confirm = await api('POST', '/cto', {
    action: 'UPDATE_SUBTASK', planId, subtaskId: 'subtask-2-core-implementation', status: 'completed',
  })
  assertEqual(confirm.status, 200, 'confirm status')

  const redispatch = await api('POST', '/cto', { action: 'DISPATCH_PLAN', planId })
  assertEqual(redispatch.status, 200, 'redispatch status')
  const plan = redispatch.json.plan
  assertEqual(plan.status, 'completed', 'plan must complete once every subtask settles')
  for (const task of plan.subtasks) {
    assert(['completed', 'skipped'].includes(task.status), `subtask ${task.id} not settled (${task.status})`)
  }
  const timeline = await api('GET', `/projects/${projectId}/timeline`)
  const dagEvents = timeline.json.events.filter((e) => e.kind.startsWith('dag.'))
  assert(dagEvents.length >= 3, 'dag.plan_created + dag.dispatched + dag.completed events missing')
})
await check('ARCHIVE_PLAN retires the plan and GET /cto lists plans', async () => {
  const archive = await api('POST', '/cto', { action: 'ARCHIVE_PLAN', planId })
  assertEqual(archive.status, 200, 'archive status')
  assertEqual(archive.json.plan.status, 'archived', 'archived status')
  const list = await api('GET', `/cto?project=${projectId}`)
  assertEqual(list.status, 200, 'list status')
  assert(!list.json.plans.some((p) => p.id === planId), 'archived plan must leave the active list')
  assert(Array.isArray(list.json.audit.recommendations), 'audit recommendations missing from GET /cto')
})

section('9 · Validation envelopes')
await check('phase-4 endpoints reject invalid payloads (422) and unknown ids (404)', async () => {
  const shortGoal = await api('POST', '/cto', { action: 'BUILD_DAG_PLAN', projectId, goal: 'x' })
  assertEqual(shortGoal.status, 422, 'short goal status')
  const badAction = await api('POST', '/state', { projectId, action: 'NOT_AN_ACTION' })
  assertEqual(badAction.status, 422, 'bad action status')
  const noFqn = await api('POST', '/state', { projectId, action: 'TOGGLE_SYMBOL_SCOPE' })
  assertEqual(noFqn.status, 422, 'missing fqn status')
  const unknownPlan = await api('POST', '/cto', { action: 'DISPATCH_PLAN', planId: 'no-such-plan' })
  assertEqual(unknownPlan.status, 404, 'unknown plan status')
  const unknownProject = await api('GET', '/state?project=no-such-project')
  assertEqual(unknownProject.status, 404, 'unknown project status')
})

section('10 · MCP server — CLI wiring of cortex_state / cortex_cto')
await check('server lists all 10 tools incl. the Phase 4 cortex_state / cortex_cto', async () => {
  const mcp = McpClient.spawn()
  try {
    const tools = await mcp.request('tools/list')
    const names = tools.tools.map((t) => t.name)
    assertEqual(names.length, 10, `tool count (got: ${names.join(', ')})`)
    for (const expected of ['cortex_state', 'cortex_cto']) {
      assert(names.includes(expected), `tool ${expected} missing`)
    }
  } finally {
    await mcp.kill()
  }
})
let fixtureSlug = null
await check('fixture slug resolves for MCP addressing', async () => {
  const { status, json } = await api('GET', '/projects')
  assertEqual(status, 200, 'status')
  const hit = json.projects.find((p) => p.id === projectId)
  assert(hit, 'fixture project not in list')
  fixtureSlug = hit.slug
})
await check('cortex_state GET renders the live Command Center state over stdio', async () => {
  const mcp = McpClient.spawn()
  try {
    const result = await mcp.callTool('cortex_state', { slug: fixtureSlug })
    const text = result.content.map((c) => c.text).join('\n')
    assert(result.content[0].type === 'text', 'content type')
    assert(text.includes('CORTEX STATE —'), 'state header missing')
    assert(text.includes('Graph: ') && text.includes('nodes / '), 'graph summary missing')
    assert(text.includes('Telemetry: ') && text.includes('prompts intercepted'), 'telemetry summary missing')
    assert(text.includes('CTO RECOMMENDATIONS ('), 'recommendations block missing')
    assert(text.includes('RECENT TIMELINE'), 'timeline block missing')
    assert(!text.includes('<cortex_sync_packet>'), 'XML must stay hidden without includeXml')
  } finally {
    await mcp.kill()
  }
})
await check('cortex_state includeXml returns the injectable sync packet XML', async () => {
  const mcp = McpClient.spawn()
  try {
    const result = await mcp.callTool('cortex_state', { slug: fixtureSlug, includeXml: true })
    const text = result.content.map((c) => c.text).join('\n')
    assert(text.includes('<cortex_sync_packet'), 'sync packet XML missing')
    assert(text.includes('<dna_snapshot'), 'dna snapshot element missing')
  } finally {
    await mcp.kill()
  }
})
await check('cortex_state TOGGLE_SYMBOL_SCOPE → RESET_SCOPE_LOCK round-trip mutates the daemon', async () => {
  const mcp = McpClient.spawn()
  try {
    const state = await api('GET', `/state?project=${projectId}`)
    const symbol = state.json.graph.nodes.find((n) => n.label === 'ASTSymbol' && n.fqn)
    assert(symbol, 'no ASTSymbol with fqn in the fixture graph')
    const toggled = await mcp.callTool('cortex_state', {
      slug: fixtureSlug,
      action: 'TOGGLE_SYMBOL_SCOPE',
      fqn: symbol.fqn,
    })
    const toggledText = toggled.content.map((c) => c.text).join('\n')
    assert(toggledText.includes(`Toggled "${symbol.fqn}"`), 'toggle confirmation missing')
    const after = await api('GET', `/state?project=${projectId}`)
    const scopeChanged = after.json.scopeLock.allowedSymbolFqns.includes(symbol.fqn)
      || after.json.scopeLock.lockedSymbolFqns.includes(symbol.fqn)
    assert(scopeChanged, 'toggle did not reach the persisted scope lock')
    const reset = await mcp.callTool('cortex_state', { slug: fixtureSlug, action: 'RESET_SCOPE_LOCK' })
    const resetText = reset.content.map((c) => c.text).join('\n')
    assert(resetText.includes('Scope lock cleared and deterministically reseeded'), 'reset confirmation missing')
  } finally {
    await mcp.kill()
  }
})
await check('cortex_state unknown slug surfaces the daemon error over MCP', async () => {
  const mcp = McpClient.spawn()
  try {
    const result = await mcp.callTool('cortex_state', { slug: 'no-such-project' })
    assert(result.isError === true, 'expected an MCP error result')
    assert(result.content[0].text.includes('No CortexOS project with slug'), 'error text must name the unknown slug')
  } finally {
    await mcp.kill()
  }
})
await check('cortex_cto AUDIT renders live recommendations + plan history over stdio', async () => {
  const mcp = McpClient.spawn()
  try {
    const result = await mcp.callTool('cortex_cto', { slug: fixtureSlug, action: 'AUDIT', force: true })
    const text = result.content.map((c) => c.text).join('\n')
    assert(text.includes('AI CTO AUDIT —'), 'audit header missing')
    assert(text.includes('symbols / ') && text.includes('files'), 'workspace stats missing')
    assert(text.includes('RECOMMENDATIONS ('), 'recommendations block missing')
    assert(text.includes('DAG PLANS ('), 'plan history block missing')
    assert(text.includes('fresh scan'), 'force=true must bypass the cache')
  } finally {
    await mcp.kill()
  }
})
await check('cortex_cto BUILD_DAG_PLAN → DISPATCH_PLAN → ARCHIVE_PLAN full lifecycle over stdio', async () => {
  const mcp = McpClient.spawn()
  try {
    const build = await mcp.callTool('cortex_cto', {
      slug: fixtureSlug,
      action: 'BUILD_DAG_PLAN',
      goal: `ship the export endpoint for run ${RUN}`,
    })
    const buildText = build.content.map((c) => c.text).join('\n')
    assert(buildText.includes('Plan built and persisted'), 'build confirmation missing')
    const planId = /planId ([a-zA-Z0-9-]+)/.exec(buildText)?.[1]
    assert(planId, 'planId not advertised in the build output')
    assert(buildText.includes('Wave 1 (parallel):'), 'wave render missing')

    const dispatch = await mcp.callTool('cortex_cto', { slug: fixtureSlug, action: 'DISPATCH_PLAN', planId })
    const dispatchText = dispatch.content.map((c) => c.text).join('\n')
    assert(dispatchText.includes('Status: dispatched') || dispatchText.includes('Status: completed'), 'dispatch status missing')
    assert(
      dispatchText.includes('✓ ') || dispatchText.includes('Executed locally (0 cloud tokens)'),
      'wave-1 local subtask must really execute through the Phase 3 tool runner',
    )

    const archive = await mcp.callTool('cortex_cto', { slug: fixtureSlug, action: 'ARCHIVE_PLAN', planId })
    const archiveText = archive.content.map((c) => c.text).join('\n')
    assert(archiveText.includes('archived — it no longer appears in the active plan list'), 'archive confirmation missing')
  } finally {
    await mcp.kill()
  }
})

section('11 · Health counters + cascade cleanup')
await check('dagPlans counter is live in health', async () => {
  const health = await api('GET', '/health')
  assert(health.json.counts.dagPlans >= 1, 'health must count the built plan')
})
await check('deleting the workspace project cascades plans, scope locks and runs', async () => {
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
console.log(`Phase 4 suite: ${passed}/${results.length} passed${failed > 0 ? ` — ${failed} FAILED` : ''}`)
if (failed > 0) {
  console.log('\nFailed checks:')
  for (const r of results.filter((x) => !x.pass)) console.log(`  ✗ [${r.section}] ${r.name}\n    ${r.error}`)
  process.exit(1)
}
process.exit(0)
