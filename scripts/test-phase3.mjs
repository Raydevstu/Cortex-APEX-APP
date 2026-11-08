#!/usr/bin/env node
/**
 * CortexOS — Phase 3 automated test suite.
 *
 * Runs against the live daemon (default http://localhost:3000) and verifies
 * every Phase 3 capability end-to-end:
 *   - Daemon health (≥ v0.3.0, phase-3 capability, new counts)
 *   - Settings round-trip for the local-agent model roles
 *   - Blueprint assets endpoint (3 master prompts + 3 JSON grammars + docs cache)
 *   - HYBRID_PRE_EXECUTE run: Engine 1 contract, all 5 local tools executing
 *     against a REAL git workspace, staged scaffolds derived from the real
 *     Prisma schema, Engine 2 blueprint-format payload with the exact section
 *     markers, scope lock, decomposed subtasks (handledBy both sides)
 *   - LOCAL_ONLY run: early return, staged artifacts, zero cloud prompt
 *   - Staging lifecycle: apply → real file on disk, 409 double-apply, env
 *     merge (only missing keys), discard, revert restores the exact bytes
 *   - Engine 3 extract: ExtractedMemoryDelta contract, supersede detection
 *     (memory status + SUPERSEDES graph edge), task completion only when the
 *     diff proves it, bug resolution, episodic indexing
 *   - Sync packet continuity: preExecutedByLocalAgent carries real work
 *   - Mock Ollama: the REAL LLM paths (format: jsonSchema) execute end-to-end
 *     against a local mock; invalid output falls back to deterministic engines
 *   - Validation envelopes (422/404/409)
 *   - MCP server: 8 tools incl. cortex_preexecute + cortex_extract_memory
 *   - Extension core: preexec engine mapping against the live daemon
 *   - Metrics preExec section + cascade cleanup
 *
 * Usage:  node scripts/test-phase3.mjs [baseUrl]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
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

async function waitFor(fn, { timeout = 15_000, interval = 300, label = 'condition' } = {}) {
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

const INTENT_CATEGORIES = ['feature_build', 'bug_fix', 'refactor', 'schema_change', 'architecture', 'test_gen', 'docs']
const EXECUTION_MODES = ['LOCAL_ONLY', 'HYBRID_PRE_EXECUTE', 'CLOUD_DIRECT_WITH_DNA']
const TOOL_NAMES = ['ast_symbol_lookup', 'schema_inspect', 'local_docs_search', 'scaffold_boilerplate', 'git_diff_summary']

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\x1b[1m CortexOS Phase 3 — automated test suite\x1b[0m`)
  console.log(` daemon: ${BASE}\n`)

  const slug = `p3-agent-lab-${RUN}`
  let projectId = ''
  let fixtureDir = ''
  let originalSettings = null

  // ---- 1. Daemon health ----------------------------------------------------
  section('1 · Daemon health — Phase 3')
  await check('GET /health reports ≥ v0.3.0 with the phase-3 capability and new counts', async () => {
    const { status, json } = await api('GET', '/health')
    assertEqual(status, 200, 'status')
    const [major, minor] = json.version.split('.').map(Number)
    assert(major > 0 || minor >= 3, `version must be >= 0.3.0 (got ${json.version})`)
    assert(typeof json.phase === 'string' && json.phase.length > 0, 'phase label missing')
    assert(Array.isArray(json.capabilities), 'capabilities array missing')
    for (const capability of ['phase1-brain-prompt-interceptor', 'phase2-cross-platform-sync', 'phase3-pre-execution-agent']) {
      assert(json.capabilities.includes(capability), `capability ${capability} missing`)
    }
    assert(typeof json.counts.preExecRuns === 'number', 'counts.preExecRuns missing')
    assert(typeof json.counts.stagedArtifacts === 'number', 'counts.stagedArtifacts missing')
  })

  // ---- 2. Settings round-trip ----------------------------------------------
  section('2 · Settings — local-agent model roles')
  await check('GET/PUT settings round-trips the Phase 3 model roles', async () => {
    const before = await api('GET', '/settings')
    originalSettings = before.json.settings
    assert(originalSettings.ollamaRouterModel, 'ollamaRouterModel missing from defaults')
    assert(originalSettings.ollamaExtractorModel, 'ollamaExtractorModel missing from defaults')
    assert('searxngUrl' in originalSettings, 'searxngUrl missing')

    const put = await api('PUT', '/settings', {
      ollamaRouterModel: 'mock-router:1.5b',
      ollamaExtractorModel: 'mock-extractor:3b',
    })
    assertEqual(put.status, 200, 'PUT status')
    assertEqual(put.json.settings.ollamaRouterModel, 'mock-router:1.5b', 'router model not persisted')
    assertEqual(put.json.settings.ollamaExtractorModel, 'mock-extractor:3b', 'extractor model not persisted')
    assertEqual(put.json.settings.ollamaBaseUrl, originalSettings.ollamaBaseUrl, 'baseUrl must not change')
  })

  // ---- 3. Blueprint assets ---------------------------------------------------
  section('3 · Blueprint assets (prompts + JSON grammars + docs cache)')
  await check('GET /assets lists the 3 master prompts, 3 grammars and the docs cache', async () => {
    const { status, json } = await api('GET', '/assets')
    assertEqual(status, 200, 'status')
    const promptNames = json.assets.prompts.map((p) => p.name)
    for (const expected of ['pre-execution-router.system.md', 'tier1-prompt-engineer.system.md', 'memory-extractor.system.md']) {
      assert(promptNames.includes(expected), `prompt ${expected} missing`)
    }
    const schemaNames = json.assets.schemas.map((s) => s.name)
    for (const expected of ['router-decision.schema.json', 'tier1-rewritten-prompt.schema.json', 'extracted-memory-delta.schema.json']) {
      assert(schemaNames.includes(expected), `schema ${expected} missing`)
    }
    const routerSchema = json.assets.schemas.find((s) => s.name === 'router-decision.schema.json')
    assert(Array.isArray(routerSchema.required) && routerSchema.required.includes('executionMode'), 'router schema required fields missing')
    const docs = json.assets.docs.map((d) => d.name)
    assert(docs.includes('stripe-webhooks.md') && docs.includes('prisma-schema.md'), 'docs cache seeds missing')
  })

  // ---- 4. Fixture workspace ---------------------------------------------------
  section('4 · Fixture project (real git workspace)')
  fixtureDir = path.join(os.tmpdir(), `cortex-p3-${RUN}`)
  await check('git fixture with schema, routes and auth lib is created', async () => {
    await fs.mkdir(path.join(fixtureDir, 'prisma'), { recursive: true })
    await fs.mkdir(path.join(fixtureDir, 'src', 'lib'), { recursive: true })
    await fs.mkdir(path.join(fixtureDir, 'src', 'app', 'api', 'health'), { recursive: true })
    await fs.writeFile(
      path.join(fixtureDir, 'prisma', 'schema.prisma'),
      [
        'generator client { provider = "prisma-client-js" }',
        'datasource db { provider = "sqlite" url = env("DATABASE_URL") }',
        '',
        'model User {',
        '  id        String   @id @default(cuid())',
        '  email     String   @unique',
        '  name      String?',
        '  role      String   @default("member")',
        '  createdAt DateTime @default(now())',
        '  updatedAt DateTime @updatedAt',
        '}',
        '',
        'model Subscription {',
        '  id           String   @id @default(cuid())',
        '  userId       String',
        '  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)',
        '  stripeSubId  String   @unique',
        '  status       String',
        '  currentPeriodEnd DateTime',
        '  createdAt    DateTime @default(now())',
        '  updatedAt    DateTime @updatedAt',
        '  @@index([userId, status])',
        '}',
        '',
      ].join('\n'),
    )
    await fs.writeFile(
      path.join(fixtureDir, 'src', 'app', 'api', 'health', 'route.ts'),
      [
        "import { NextResponse } from 'next/server'",
        '',
        'export async function GET() {',
        '  return NextResponse.json({ ok: true })',
        '}',
        '',
      ].join('\n'),
    )
    await fs.writeFile(
      path.join(fixtureDir, 'src', 'lib', 'auth.ts'),
      [
        'export interface Session { userId: string; role: string }',
        '',
        'export function parseSession(token: string): Session | null {',
        '  if (!token) return null',
        '  return { userId: token, role: "member" }',
        '}',
        '',
      ].join('\n'),
    )
    await fs.writeFile(path.join(fixtureDir, '.env.example'), 'DATABASE_URL=file:./dev.db\n')
    await exec('git', ['init', '-q', '.'], { cwd: fixtureDir })
    await exec('git', ['add', '.'], { cwd: fixtureDir })
    await exec('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'], { cwd: fixtureDir })
  })
  await check('project is created with the fixture rootPath and DNA generated', async () => {
    const created = await api('POST', '/projects', {
      name: `P3 Agent Lab ${RUN}`,
      description: 'Phase 3 test project — pre-execution agent, tools, staging, memory delta.',
      platform: 'codex',
      rootPath: fixtureDir,
    })
    assertEqual(created.status, 201, 'status')
    projectId = created.json.id
    assert(created.json.slug.startsWith('p3'), 'unexpected slug')

    const dna = await api('POST', `/projects/${projectId}/dna`, { mode: 'scan' })
    assertEqual(dna.status, 200, 'dna status')
    assert(dna.json.dna.fileStats.prismaModels.includes('User'), 'User model not in DNA')
    assert(dna.json.dna.fileStats.prismaModels.includes('Subscription'), 'Subscription model not in DNA')
  })

  // ---- 5. HYBRID pre-execution run ------------------------------------------
  section('5 · HYBRID_PRE_EXECUTE run — Engine 1 + tools + Engine 2')
  let hybrid = null
  await check('POST /preexecute returns the full RouterDecision contract', async () => {
    const { status, json } = await api('POST', '/preexecute', {
      projectId,
      prompt: 'add stripe webhook for subscription renewal and update user db',
      targetPlatform: 'codex',
    })
    assertEqual(status, 201, 'status')
    hybrid = json

    assert(json.runId, 'runId missing')
    const router = json.router
    assert(INTENT_CATEGORIES.includes(router.intentCategory), `invalid intentCategory ${router.intentCategory}`)
    assert(Number.isInteger(router.complexityScore) && router.complexityScore >= 1 && router.complexityScore <= 10, 'complexityScore out of range')
    assert(EXECUTION_MODES.includes(router.executionMode), `invalid executionMode ${router.executionMode}`)
    assert(Array.isArray(router.relevantModuleIds), 'relevantModuleIds missing')
    assert(Array.isArray(router.localPreExecutionPlan) && router.localPreExecutionPlan.length >= 3, 'plan too small')
    for (const step of router.localPreExecutionPlan) {
      assert(TOOL_NAMES.includes(step.toolName), `invalid toolName ${step.toolName}`)
      assert(typeof step.toolArgs === 'object', 'toolArgs must be an object')
      assert(step.expectedArtifact, 'expectedArtifact missing')
    }
    for (const key of ['coreObjective', 'targetFiles', 'readOnlyReferenceFiles', 'scopeGuardConstraints']) {
      assert(router.cloudCoreTaskSpec[key] !== undefined, `cloudCoreTaskSpec.${key} missing`)
    }
    assert(typeof router.estimatedCloudTokensSaved === 'number', 'estimatedCloudTokensSaved missing')
    assertEqual(json.routerEngine, 'deterministic', 'routerEngine (Ollama is offline in this suite)')
    assert(json.routerNote && json.routerNote.includes('deterministic'), 'offline router note missing')
  })
  await check('executionMode routes to HYBRID_PRE_EXECUTE for the stripe webhook prompt', async () => {
    assertEqual(hybrid.router.executionMode, 'HYBRID_PRE_EXECUTE', 'mode')
    assert(!hybrid.handledCompletelyLocally, 'hybrid runs are not fully local')
    assert(hybrid.injectedPrompt, 'hybrid runs must produce an injected prompt')
  })
  await check('all 5 local tools execute for real against the workspace', async () => {
    const byTool = new Map(hybrid.artifacts.map((a) => [a.toolName, a]))
    for (const tool of TOOL_NAMES) {
      assert(byTool.has(tool), `tool ${tool} did not run`)
      assert(byTool.get(tool).ok, `tool ${tool} failed: ${byTool.get(tool).error}`)
    }
    const schema = byTool.get('schema_inspect')
    const fields = schema.data.fields.map((f) => f.name)
    for (const field of ['id', 'email', 'name', 'role']) assert(fields.includes(field), `User field ${field} not inspected`)
    const ast = byTool.get('ast_symbol_lookup')
    assert(ast.data.symbols.length >= 1, 'no symbols extracted')
    assert(ast.data.symbols.every((s) => Number.isInteger(s.line)), 'symbols must carry line numbers')
    const docs = byTool.get('local_docs_search')
    assert(docs.data.results.some((r) => r.file === 'stripe-webhooks.md'), 'stripe docs cache not hit')
    const git = byTool.get('git_diff_summary')
    assert(git.data.branch && git.data.clean === true, 'git summary missing branch/clean state')
  })
  await check('scaffold_boilerplate stages a real Zod schema derived from the Prisma model', async () => {
    const staged = await api('GET', `/preexecute/staged?projectId=${projectId}&status=staged`)
    assertEqual(staged.status, 200, 'status')
    const zod = staged.json.artifacts.find((a) => a.kind === 'zod-schema')
    assert(zod, 'zod-schema artifact missing')
    assert(zod.content.includes('z.object'), 'zod content missing z.object')
    assert(zod.content.includes('email'), 'zod content missing email field')
    assert(zod.content.includes('z.string().min(1)'), 'id-like fields must be min(1)')
    assert(zod.content.includes('z.coerce.date()'), 'DateTime must map to z.coerce.date()')
    assert(zod.rationale.includes('prisma/schema.prisma'), 'rationale must cite the source schema')

    const route = staged.json.artifacts.find((a) => a.kind === 'route-stub')
    assert(route, 'route-stub artifact missing')
    assert(route.targetPath.includes('webhooks/stripe'), `unexpected route target ${route.targetPath}`)
    assert(route.content.includes('safeParse'), 'route stub must validate input')

    const env = staged.json.artifacts.find((a) => a.kind === 'env-example')
    assert(env, 'env-example artifact missing')
    assert(env.content.includes('STRIPE_SECRET_KEY') && env.content.includes('STRIPE_WEBHOOK_SECRET'), 'stripe env keys missing')
  })
  await check('Engine 2 emits the blueprint-format payload with the exact section markers', async () => {
    const prompt = hybrid.injectedPrompt
    assert(prompt.includes('[CORTEX-OS SYNC | Project:'), 'CORTEX-OS SYNC header missing')
    assert(prompt.includes('Prev:') && prompt.includes('-> Target:'), 'platform pair missing')
    assert(prompt.includes('[PRE-EXECUTED BY CORTEX LOCAL AGENT — DO NOT REGENERATE]'), 'pre-executed marker missing')
    assert(prompt.includes('[AST SCOPE GUARD & ARCHITECTURE LOCK]'), 'scope guard marker missing')
    assert(prompt.includes('ALLOWED WRITE paths'), 'allowed write list missing')
    assert(prompt.includes('PROTECTED (DO NOT MODIFY)'), 'protected list missing')
    assert(prompt.includes('[CORE EXECUTION SPECIFICATION FOR CODEX]'), 'core specification marker missing')
    assert(prompt.includes('[VERIFICATION CRITERIA]'), 'verification criteria missing')
    assert(prompt.includes('Prisma User inspected'), 'schema inspection not carried into the payload')
    assert(prompt.includes('stripe-webhooks.md'), 'docs cache hit not carried into the payload')
  })
  await check('tier1 contract: scope lock + decomposed subtasks with both handledBy sides', async () => {
    const tier1 = hybrid.tier1
    assert(tier1.taskTitle, 'taskTitle missing')
    assert(['codex', 'hermes', 'opencode', 'cursor', 'claude', 'generic'].includes(tier1.targetPlatformOptimized), 'invalid targetPlatformOptimized')
    for (const key of ['allowedWriteFiles', 'readOnlyContextFiles', 'forbiddenPatterns']) {
      assert(Array.isArray(tier1.scopeLock[key]), `scopeLock.${key} missing`)
    }
    assert(tier1.scopeLock.allowedWriteFiles.some((f) => f.includes('webhooks/stripe')), 'route target missing from allowed writes')
    const handlers = new Set(tier1.decomposedSubtasks.map((s) => s.handledBy))
    assert(handlers.has('COMPLETED_BY_LOCAL_OLLAMA'), 'no locally-completed subtasks')
    assert(handlers.has('ASSIGNED_TO_MAIN_AI'), 'no main-AI subtasks')
    for (const subtask of tier1.decomposedSubtasks) {
      assert(['database', 'backend', 'frontend', 'auth', 'testing'].includes(subtask.layer), `invalid layer ${subtask.layer}`)
    }
  })
  await check('run history + timeline record the pre-execution', async () => {
    const history = await api('GET', `/preexecute?projectId=${projectId}`)
    assertEqual(history.status, 200, 'status')
    const run = history.json.runs.find((r) => r.id === hybrid.runId)
    assert(run, 'run missing from history')
    assertEqual(run.executionMode, 'HYBRID_PRE_EXECUTE', 'history mode')
    assert(run.stagedCount >= 3, `expected >=3 staged files, got ${run.stagedCount}`)
    assert(run.tokensSavedCloud > 0, 'tokensSavedCloud must be positive')

    const timeline = await api('GET', `/projects/${projectId}/timeline`)
    assert(timeline.json.events.some((e) => e.kind === 'preexec.run'), 'preexec.run timeline event missing')
  })

  // ---- 6. LOCAL_ONLY run ------------------------------------------------------
  section('6 · LOCAL_ONLY run — 0 cloud tokens')
  let localRun = null
  await check('a schema/boilerplate prompt routes to LOCAL_ONLY and returns early', async () => {
    const { status, json } = await api('POST', '/preexecute', {
      projectId,
      prompt: 'add a zod schema for the User prisma model',
    })
    assertEqual(status, 201, 'status')
    localRun = json
    assertEqual(json.router.executionMode, 'LOCAL_ONLY', 'mode')
    assertEqual(json.handledCompletelyLocally, true, 'handledCompletelyLocally')
    assertEqual(json.injectedPrompt, null, 'LOCAL_ONLY must not produce a cloud prompt')
    assert(json.metrics.tokensSavedCloud > 0, 'LOCAL_ONLY must report cloud tokens saved')

    const staged = await api('GET', `/preexecute/staged?projectId=${projectId}&status=staged`)
    const kinds = staged.json.artifacts.map((a) => a.kind)
    assert(kinds.includes('zod-schema') && kinds.includes('ts-types'), `expected zod + types staged, got ${kinds.join(',')}`)
    const types = staged.json.artifacts.find((a) => a.kind === 'ts-types')
    assert(types.content.includes('export interface User'), 'ts-types content missing interface')
    assert(types.content.includes('name?: string'), 'nullable field must be optional')
  })

  // ---- 7. Staging lifecycle -----------------------------------------------------
  section('7 · Staging lifecycle (scope-guard validated)')
  let applyTarget = null
  let envTarget = null
  let discardTarget = null
  await check('apply writes a staged file into the real workspace', async () => {
    const staged = await api('GET', `/preexecute/staged?projectId=${projectId}&status=staged`)
    applyTarget = staged.json.artifacts.find((a) => a.kind === 'zod-schema')
    envTarget = staged.json.artifacts.find((a) => a.kind === 'env-example')
    discardTarget = staged.json.artifacts.find((a) => a.kind === 'ts-types')
    assert(applyTarget && envTarget && discardTarget, 'staged fixtures missing')

    const applied = await api('POST', `/preexecute/staged/${applyTarget.id}`, { action: 'apply' })
    assertEqual(applied.status, 200, 'apply status')
    assertEqual(applied.json.artifact.status, 'applied', 'artifact status')
    const onDisk = await fs.readFile(path.join(fixtureDir, applyTarget.targetPath), 'utf-8')
    assert(onDisk === applyTarget.content, 'file on disk must match the staged content exactly')

    const timeline = await api('GET', `/projects/${projectId}/timeline`)
    assert(timeline.json.events.some((e) => e.kind === 'staging.applied'), 'staging.applied event missing')
  })
  await check('double-apply is rejected (409)', async () => {
    const again = await api('POST', `/preexecute/staged/${applyTarget.id}`, { action: 'apply' })
    assertEqual(again.status, 409, 'status')
  })
  await check('env-example merges ONLY the missing keys into the existing file', async () => {
    const applied = await api('POST', `/preexecute/staged/${envTarget.id}`, { action: 'apply' })
    assertEqual(applied.status, 200, 'apply status')
    assertEqual(applied.json.merged, true, 'merge flag')

    const content = await fs.readFile(path.join(fixtureDir, '.env.example'), 'utf-8')
    assert(content.includes('DATABASE_URL=file:./dev.db'), 'existing key must survive the merge')
    assert(content.includes('STRIPE_SECRET_KEY='), 'missing key not appended')
    assert(content.includes('CortexOS local agent'), 'merge marker missing')
    assert(!content.includes('DATABASE_URL=file:./dev.db\nDATABASE_URL'), 'no duplicate keys allowed')

    const revert = await api('POST', `/preexecute/staged/${envTarget.id}`, { action: 'revert' })
    assertEqual(revert.status, 200, 'revert status')
    assertEqual(revert.json.restored, 'restored', 'restored kind')
    const after = await fs.readFile(path.join(fixtureDir, '.env.example'), 'utf-8')
    assertEqual(after, 'DATABASE_URL=file:./dev.db\n', 'revert must restore the exact previous bytes')
  })
  await check('revert deletes an applied create (file removed, artifact back to staged)', async () => {
    const revert = await api('POST', `/preexecute/staged/${applyTarget.id}`, { action: 'revert' })
    assertEqual(revert.status, 200, 'status')
    assertEqual(revert.json.restored, 'deleted', 'create revert must delete')
    const exists = await fs.stat(path.join(fixtureDir, applyTarget.targetPath)).then(() => true).catch(() => false)
    assert(!exists, 'file must be gone after revert')
    assertEqual(revert.json.artifact.status, 'staged', 'artifact back to staged')
  })
  await check('discard drops a staged artifact without touching the workspace', async () => {
    const discarded = await api('POST', `/preexecute/staged/${discardTarget.id}`, { action: 'discard' })
    assertEqual(discarded.status, 200, 'status')
    assertEqual(discarded.json.artifact.status, 'discarded', 'status')
    const exists = await fs.stat(path.join(fixtureDir, discardTarget.targetPath)).then(() => true).catch(() => false)
    assert(!exists, 'discarded artifact must never have been written')

    const reDiscard = await api('POST', `/preexecute/staged/${discardTarget.id}`, { action: 'discard' })
    assertEqual(reDiscard.status, 409, 'double-discard must 409')
    const revertDiscarded = await api('POST', `/preexecute/staged/${discardTarget.id}`, { action: 'revert' })
    assertEqual(revertDiscarded.status, 409, 'revert of discarded must 409')
  })
  await check('unknown artifact id → 404; invalid action → 422', async () => {
    const missing = await api('POST', '/preexecute/staged/no-such-id', { action: 'apply' })
    assertEqual(missing.status, 404, 'status')
    const invalid = await api('POST', '/preexecute/staged/whatever', { action: 'destroy' })
    assertEqual(invalid.status, 422, 'status')
  })

  // ---- 8. Engine 3 — Automatic Memory Extractor -------------------------------
  section('8 · Engine 3 — ExtractedMemoryDelta (supersedes, tasks, bugs)')
  let redisDecisionId = ''
  let paymentTodoId = ''
  await check('seed a decision + an open todo + an open bug to supersede/complete/resolve', async () => {
    const redis = await api('POST', '/memories', {
      projectId,
      type: 'decision',
      key: 'Redis',
      value: 'We decided to use Redis Queue for background job processing.',
      importance: 4,
    })
    redisDecisionId = redis.json.memory.id
    const todo = await api('POST', '/memories', {
      projectId,
      type: 'todo',
      key: 'payment integration',
      value: 'We still need to add the payment integration with Stripe.',
      importance: 4,
    })
    paymentTodoId = todo.json.memory.id
    const bug = await api('POST', '/memories', {
      projectId,
      type: 'bug',
      key: 'login race condition',
      value: 'Bug: login has a race condition on token refresh.',
      importance: 4,
    })
    assert(bug.json.memory.id, 'bug memory not created')
  })
  let extractReport = null
  await check('POST /extract returns the full delta contract (deterministic engine offline)', async () => {
    const { status, json } = await api('POST', '/extract', {
      projectId,
      sourcePlatform: 'codex',
      rawUserPrompt:
        'we decided to use Inngest instead of Redis for background jobs. users must verify email before checkout.',
      aiResponseText:
        'Implemented the webhook handler in src/app/api/webhooks/stripe/route.ts with signature verification. The payment integration is done and tested. Also fixed the login race condition.',
      modifiedFilesAstDiff: [
        { path: 'src/app/api/webhooks/stripe/route.ts', addedSymbols: ['POST'], modifiedSymbols: [] },
      ],
    })
    assertEqual(status, 201, 'status')
    extractReport = json

    const delta = json.delta
    assert(delta.turnId && typeof delta.timestamp === 'number', 'turnId/timestamp missing')
    assert(delta.compactTurnSummary.length > 10, 'compactTurnSummary missing')
    const decision = delta.newDecisions.find((d) => d.title === 'Inngest')
    assert(decision, 'Inngest decision not extracted')
    assertEqual(decision.supersedesDecisionId, redisDecisionId, 'supersedesDecisionId must point at the Redis decision')
    for (const category of ['database', 'auth', 'state', 'api', 'ui', 'security']) {
      if (decision.category === category) break
    }
    assert(['database', 'auth', 'state', 'api', 'ui', 'security'].includes(decision.category), 'invalid decision category')
    assert(delta.newRequirements.some((r) => r.rule.includes('verify email')), 'glued requirement not extracted')
    assert(delta.taskUpdates.some((t) => t.taskId === paymentTodoId && t.status === 'completed'), 'payment todo not completed')
    assert(delta.discoveredBugs.some((b) => b.status === 'resolved' && b.title.includes('login race condition')), 'bug resolution not extracted')
    assertEqual(json.engineUsed, 'deterministic', 'engine (offline)')
    assert(json.engineNote && json.engineNote.includes('deterministic'), 'offline note missing')
  })
  await check('the delta is applied: memory statuses, SUPERSEDES edge, episodic index', async () => {
    assertEqual(extractReport.decisionsCreated, 1, 'decisionsCreated')
    assertEqual(extractReport.decisionsSuperseded, 1, 'decisionsSuperseded')
    assert(extractReport.tasksUpdated >= 1, 'tasksUpdated')
    assert(extractReport.bugsResolved >= 1, 'bugsResolved')

    const redis = await api('GET', `/memories?projectId=${projectId}&type=decision`)
    const redisMemory = redis.json.memories.find((m) => m.id === redisDecisionId)
    assertEqual(redisMemory.status, 'superseded', 'old decision must be superseded')
    const inngest = redis.json.memories.find((m) => m.key === 'Inngest')
    assert(inngest && inngest.status === 'active', 'Inngest decision must be active')

    const graph = await api('GET', `/graph?projectId=${projectId}`)
    const labels = new Set(graph.json.nodes.map((n) => n.label))
    const supersedeEdge = graph.json.edges.find((e) => {
      const source = graph.json.nodes.find((n) => n.id === e.sourceId)
      const target = graph.json.nodes.find((n) => n.id === e.targetId)
      return e.relation === 'SUPERSEDES' && source?.label.includes('Redis') && target?.label.includes('Inngest')
    })
    assert(supersedeEdge, 'SUPERSEDES graph edge missing')
    assert(labels.has('Decision: Inngest'), 'decision node missing from the graph')

    const search = await api('POST', '/search', { projectId, query: 'inngest background jobs webhook', k: 3 })
    assert(
      search.json.results.some((r) => (r.summary ?? r.snippet).includes('Inngest') || (r.summary ?? '').includes('webhook')),
      'extracted turn not indexed into the episodic store',
    )

    const timeline = await api('GET', `/projects/${projectId}/timeline`)
    assert(timeline.json.events.some((e) => e.kind === 'memory.delta_applied'), 'memory.delta_applied event missing')
  })

  // ---- 9. Sync packet carries pre-executed work --------------------------------
  section('9 · Sync packet — preExecutedByLocalAgent')
  await check('continuity state carries the local agent work after a fresh todo', async () => {
    await api('POST', '/memories', {
      projectId,
      type: 'todo',
      key: 'notification system',
      value: 'We still need to add realtime notifications.',
      importance: 4,
    })
    const packet = await api('GET', `/sync/p3-agent-lab-${RUN}`)
    assertEqual(packet.status, 200, 'status')
    const activeTask = packet.json.packet ? packet.json.packet.continuityState.activeTask : packet.json.continuityState.activeTask
    assert(activeTask, 'active task missing')
    assert(Array.isArray(activeTask.preExecutedByLocalAgent), 'preExecutedByLocalAgent missing')
    assert(activeTask.preExecutedByLocalAgent.length > 0, 'preExecutedByLocalAgent must carry real work after Phase 3 runs')
    assert(
      activeTask.preExecutedByLocalAgent.some((entry) => entry.includes('schema') || entry.includes('Staged') || entry.includes('Prisma')),
      'carried work must mention real executed steps',
    )
  })

  // ---- 10. Mock Ollama — the REAL LLM paths ------------------------------------
  section('10 · Ollama structured-output paths (mock daemon, real code path)')
  const mockPort = 46000 + (Date.now() % 500)
  const mockState = { mode: 'valid', calls: [] }
  const mockServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          models: [{ name: 'mock-router:1.5b' }, { name: 'mock-coder:7b' }, { name: 'mock-extractor:3b' }],
        }),
      )
      return
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const payload = JSON.parse(body)
        mockState.calls.push({ model: payload.model, hasFormat: payload.format !== undefined, temperature: payload.options?.temperature })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (mockState.mode === 'invalid') {
          res.end(JSON.stringify({ message: { content: 'not json {{ garbage' } }))
          return
        }
        const system = payload.messages?.[0]?.content ?? ''
        let decision
        if (system.includes('Pre-Execution Router')) {
          decision = {
            intentCategory: 'feature_build',
            complexityScore: 5,
            executionMode: 'HYBRID_PRE_EXECUTE',
            relevantModuleIds: ['Payments'],
            localPreExecutionPlan: [
              { stepId: 'git-state', toolName: 'git_diff_summary', toolArgs: {}, expectedArtifact: 'workspace state' },
              { stepId: 'schema', toolName: 'schema_inspect', toolArgs: { modelName: 'Subscription' }, expectedArtifact: 'Subscription fields' },
            ],
            cloudCoreTaskSpec: {
              coreObjective: 'Implement the Stripe webhook renewal handler',
              targetFiles: ['src/app/api/webhooks/stripe/route.ts'],
              readOnlyReferenceFiles: ['prisma/schema.prisma'],
              scopeGuardConstraints: ['Zero `any` types'],
            },
            estimatedCloudTokensSaved: 900,
          }
        } else if (system.includes('Tier-1 Principal Prompt Engineer')) {
          decision = {
            taskTitle: 'Stripe subscription renewal webhook',
            targetPlatformOptimized: 'codex',
            decomposedSubtasks: [
              { stepNumber: 1, layer: 'database', action: 'Inspect the Subscription model', handledBy: 'COMPLETED_BY_LOCAL_OLLAMA' },
              { stepNumber: 2, layer: 'backend', action: 'Implement the idempotent webhook handler', handledBy: 'ASSIGNED_TO_MAIN_AI' },
            ],
            scopeLock: {
              allowedWriteFiles: ['src/app/api/webhooks/stripe/route.ts'],
              readOnlyContextFiles: ['prisma/schema.prisma'],
              forbiddenPatterns: ['no `any` types', 'never trust unverified webhook bodies'],
            },
            finalInjectedMarkdownPrompt:
              '[CORTEX-OS SYNC | Project: P3 | State: #mock | Prev: codex -> Target: codex]\n- Stack: mock stack.\n\n[PRE-EXECUTED BY CORTEX LOCAL AGENT — DO NOT REGENERATE]\n1. Subscription model inspected via the mock Ollama router.\n\n[AST SCOPE GUARD & ARCHITECTURE LOCK]\n- ALLOWED WRITE paths:\n  • src/app/api/webhooks/stripe/route.ts\n\n[CORE EXECUTION SPECIFICATION FOR CODEX]\n1. Implement the idempotent webhook handler.\n\n[VERIFICATION CRITERIA]\n- Signature verified, events idempotent.',
          }
        } else {
          decision = {
            turnId: 'mock-turn',
            sourcePlatform: 'codex',
            timestamp: Date.now(),
            compactTurnSummary: 'Mock extractor summary: implemented webhook handler in route.ts. Next: add tests.',
            newDecisions: [
              { category: 'api', title: 'Mock Decision', rationale: 'the mock extractor decided this', constraints: '', targetModuleId: 'Payments' },
            ],
            newRequirements: [],
            taskUpdates: [],
            discoveredBugs: [],
          }
        }
        res.end(JSON.stringify({ message: { content: JSON.stringify(decision) } }))
      })
      return
    }
    res.writeHead(404)
    res.end('{}')
  })
  await check('mock Ollama daemon boots and the daemon routes through it (Engine 1 + 2, format: jsonSchema)', async () => {
    await new Promise((resolve) => mockServer.listen(mockPort, '127.0.0.1', resolve))
    const put = await api('PUT', '/settings', {
      ollamaBaseUrl: `http://127.0.0.1:${mockPort}`,
      ollamaModel: 'mock-coder:7b',
    })
    assertEqual(put.status, 200, 'settings PUT')

    const { status, json } = await api('POST', '/preexecute', {
      projectId,
      prompt: 'implement the stripe subscription renewal webhook handler with idempotency',
      targetPlatform: 'codex',
      useLlm: true,
    })
    assertEqual(status, 201, 'status')
    assertEqual(json.routerEngine, 'ollama:mock-router:1.5b', 'routerEngine must use the Ollama path')
    assert(json.routerNote && json.routerNote.includes('mock-router'), 'router note missing')
    assertEqual(json.router.executionMode, 'HYBRID_PRE_EXECUTE', 'mocked router mode')
    assert(json.router.localPreExecutionPlan.some((s) => s.toolName === 'schema_inspect'), 'mocked plan must be executed')
    const schemaArtifact = json.artifacts.find((a) => a.toolName === 'schema_inspect')
    assert(schemaArtifact && schemaArtifact.ok, 'mocked plan step did not execute for real')
    assert(
      schemaArtifact.data.fields.some((f) => f.name === 'stripeSubId'),
      'Subscription model must be inspected by the mocked plan',
    )

    assertEqual(json.tier1Engine, 'ollama:mock-coder:7b', 'tier1Engine must use the Ollama path')
    assert(json.injectedPrompt.includes('[CORTEX-OS SYNC | Project: P3'), 'mocked Tier-1 payload missing')

    // The structured call must carry the blueprint grammar + low temperature.
    const chatCall = mockState.calls.find((c) => c.model === 'mock-router:1.5b')
    assert(chatCall, 'no /api/chat call recorded against the mock')
    assert(chatCall.hasFormat, 'Ollama structured outputs must pass the grammar as `format`')
    assert(chatCall.temperature <= 0.2, 'structured calls must use low temperature')
  })
  await check('invalid model output falls back to the deterministic engines with a note', async () => {
    mockState.mode = 'invalid'
    const { status, json } = await api('POST', '/preexecute', {
      projectId,
      prompt: 'add payment retry logic to the billing queue worker',
      targetPlatform: 'codex',
      useLlm: true,
    })
    assertEqual(status, 201, 'status')
    assertEqual(json.routerEngine, 'deterministic', 'must fall back to the deterministic router')
    assert(json.routerNote && json.routerNote.includes('Ollama router failed'), 'fallback note missing')
    assert(json.injectedPrompt, 'deterministic assembler must still produce the payload')
    mockState.mode = 'valid'
  })
  await check('Engine 3 uses the Ollama extractor path when reachable', async () => {
    const { status, json } = await api('POST', '/extract', {
      projectId,
      sourcePlatform: 'codex',
      rawUserPrompt: 'we decided to use the mock extractor path for this turn',
      aiResponseText: 'The mock extractor response summarises the work done in src/lib/mock.ts.',
      modifiedFilesAstDiff: [{ path: 'src/lib/mock.ts', addedSymbols: ['mockFn'], modifiedSymbols: [] }],
      useLlm: true,
    })
    assertEqual(status, 201, 'status')
    assertEqual(json.engineUsed, 'ollama:mock-extractor:3b', 'engineUsed must use the Ollama path')
    assert(json.delta.newDecisions.some((d) => d.title === 'Mock Decision'), 'mock decision missing from the delta')
    assert(json.delta.compactTurnSummary.includes('Mock extractor summary'), 'mock summary missing')
    assertEqual(json.decisionsCreated, 1, 'mock decision must be applied')
  })
  await check('daemon settings are restored after the mock section', async () => {
    const put = await api('PUT', '/settings', {
      ollamaBaseUrl: originalSettings.ollamaBaseUrl,
      ollamaModel: originalSettings.ollamaModel,
      ollamaRouterModel: originalSettings.ollamaRouterModel,
      ollamaExtractorModel: originalSettings.ollamaExtractorModel,
    })
    assertEqual(put.status, 200, 'status')
    assertEqual(put.json.settings.ollamaBaseUrl, originalSettings.ollamaBaseUrl, 'baseUrl restored')
    assertEqual(put.json.settings.ollamaModel, originalSettings.ollamaModel, 'model restored')
    mockServer.close()
  })

  // ---- 11. Validation envelopes ----------------------------------------------
  section('11 · Validation envelopes')
  await check('preexecute validates input (422 short prompt, 404 unknown project)', async () => {
    const short = await api('POST', '/preexecute', { projectId, prompt: 'x' })
    assertEqual(short.status, 422, 'short prompt status')
    const missing = await api('POST', '/preexecute', { prompt: 'build a full thing here' })
    assertEqual(missing.status, 422, 'missing projectId status')
    const unknown = await api('POST', '/preexecute', { projectId: 'no-such-project', prompt: 'build the thing' })
    assertEqual(unknown.status, 404, 'unknown project status')
  })
  await check('extract validates input (422 empty response, 422 bad platform, 404 unknown project)', async () => {
    const empty = await api('POST', '/extract', {
      projectId,
      sourcePlatform: 'codex',
      rawUserPrompt: 'valid prompt here',
      aiResponseText: 'x',
    })
    assertEqual(empty.status, 422, 'short response status')
    const badPlatform = await api('POST', '/extract', {
      projectId,
      sourcePlatform: 'not-a-platform',
      rawUserPrompt: 'valid prompt here',
      aiResponseText: 'a valid response text',
    })
    assertEqual(badPlatform.status, 422, 'bad platform status')
    const unknown = await api('POST', '/extract', {
      projectId: 'nope',
      sourcePlatform: 'codex',
      rawUserPrompt: 'valid prompt here',
      aiResponseText: 'a valid response text',
    })
    assertEqual(unknown.status, 404, 'unknown project status')
  })

  // ---- 12. MCP server -----------------------------------------------------------
  section('12 · MCP server (stdio JSON-RPC, Phase 3 tools)')
  await check('server handshakes and lists all 8 tools', async () => {
    const mcp = await McpClient.spawn()
    try {
      const tools = await mcp.request({ method: 'tools/list', id: 1 })
      const names = tools.tools.map((t) => t.name)
      for (const expected of [
        'cortex_sync', 'cortex_get_dna', 'cortex_log_decision', 'cortex_rewrite',
        'cortex_search_history', 'cortex_capture_interaction', 'cortex_preexecute', 'cortex_extract_memory',
      ]) {
        assert(names.includes(expected), `tool ${expected} missing (got: ${names.join(', ')})`)
      }
    } finally {
      await mcp.kill()
    }
  })
  await check('cortex_preexecute returns router + tools + payload', async () => {
    const mcp = await McpClient.spawn()
    try {
      const result = await mcp.callTool('cortex_preexecute', {
        slug: `p3-agent-lab-${RUN}`,
        prompt: 'add an audit log table and write the zod schema for it',
      })
      assert(result.includes('LOCAL TOOL EXECUTION'), 'tool execution block missing')
      assert(result.includes('schema_inspect'), 'schema_inspect step missing')
      assert(result.includes('Router engine:'), 'router engine line missing')
    } finally {
      await mcp.kill()
    }
  })
  await check('cortex_extract_memory applies a turn through the daemon', async () => {
    const mcp = await McpClient.spawn()
    try {
      const result = await mcp.callTool('cortex_extract_memory', {
        slug: `p3-agent-lab-${RUN}`,
        sourcePlatform: 'codex',
        rawUserPrompt: 'we decided to document every MCP tool in the readme',
        aiResponseText: 'Documented the tools. Next we should add usage examples for each platform.',
        modifiedFiles: ['README.md'],
      })
      assert(result.includes('Memory delta applied'), 'report preamble missing')
      assert(result.includes('engine:'), 'engine line missing')
    } finally {
      await mcp.kill()
    }
  })

  // ---- 13. Extension core --------------------------------------------------------
  section('13 · Browser extension core (preexec engine)')
  await check('UMD module loads and maps the preexec result onto the rewrite contract', async () => {
    const Core = await loadCore()
    const settings = { daemonUrl: BASE, slug: `p3-agent-lab-${RUN}`, engine: 'preexec', platform: 'codex' }
    const project = await Core.resolveProject(settings, settings.slug)
    const result = await Core.rewritePrompt(settings, project.id, 'add a zod schema for the Subscription prisma model', 'preexec')
    assertEqual(result.engineUsed, 'preexec', 'engineUsed')
    assert(typeof result.metrics.tokensSavedCloud === 'number', 'tokensSavedCloud missing from mapped metrics')
    assert(result.prompt, 'mapped prompt missing')
    assert(
      result.prompt.includes('[CORTEX-OS LOCAL AGENT') || result.prompt.includes('[CORTEX-OS SYNC'),
      'mapped prompt must be the local summary or the injected payload',
    )
    assert(result.preExec && typeof result.preExec.handledCompletelyLocally === 'boolean', 'preExec summary missing')

    const toast = Core.rewriteToastMessage(result)
    assert(toast.includes('cloud tokens saved'), 'preexec toast formatting broken')
  })

  // ---- 14. Metrics + cleanup -------------------------------------------------------
  section('14 · Metrics & cleanup')
  await check('GET /metrics carries the preExec section with real numbers', async () => {
    const { json } = await api('GET', '/metrics')
    assert(json.preExec, 'preExec section missing')
    assert(json.preExec.runs >= 2, `expected >=2 runs, got ${json.preExec.runs}`)
    assert(json.preExec.localOnlyRuns >= 1, 'localOnlyRuns missing')
    assert(json.preExec.cloudTokensSaved > 0, 'cloudTokensSaved must be positive')
    assert(json.preExec.filesStaged >= 3, 'filesStaged must reflect staged scaffolds')
    assert(typeof json.preExec.avgDurationMs === 'number', 'avgDurationMs missing')
  })
  await check('DELETE /projects/{id} cascades runs + staged artifacts', async () => {
    const { status } = await api('DELETE', `/projects/${projectId}`)
    assertEqual(status, 200, 'status')
    const runs = await api('GET', `/preexecute?projectId=${projectId}`)
    assertEqual(runs.json.runs.length, 0, 'runs must cascade')
    const staged = await api('GET', `/preexecute/staged?projectId=${projectId}`)
    assert(
      staged.status === 404 || (staged.json.artifacts ?? []).length === 0,
      `staged artifacts must cascade (status ${staged.status}: ${JSON.stringify(staged.json).slice(0, 120)})`,
    )
    const health = await api('GET', '/health')
    assert(health.json.counts.projects >= 1, 'daemon should still host other projects')
  })

  // ---- Summary ------------------------------------------------------------------
  const passed = results.filter((r) => r.pass).length
  const failed = results.length - passed
  console.log('\n─────────────────────────────────────────────')
  console.log(`  Results: \x1b[32m${passed} passed\x1b[0m${failed > 0 ? ` · \x1b[31m${failed} failed\x1b[0m` : ''} · ${results.length} total`)
  if (failed > 0) {
    console.log('\n  Failed checks:')
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   \x1b[31m✗\x1b[0m [${r.section}] ${r.name}\n      ${r.error}`)
    }
    process.exitCode = 1
  } else {
    console.log('\n  \x1b[1mPhase 3 — Pre-Execution Local Agent & Token Optimizer: all systems verified.\x1b[0m')
  }
}

// ---------------------------------------------------------------------------
// MCP stdio client (mirrors the phase-2 harness)
// ---------------------------------------------------------------------------

class McpClient {
  static async spawn() {
    const child = spawn('node', [path.join(ROOT, 'mcp-server', 'index.mjs'), '--daemon', BASE], {
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
    child.stderr.on('data', () => {})
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
      }, 30_000)
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

  kill() {
    return new Promise((resolve) => {
      this.child.on('exit', () => resolve())
      this.child.kill('SIGTERM')
      setTimeout(() => this.child.kill('SIGKILL'), 3000)
    })
  }
}

/** The extension core is a UMD/CJS module — ESM import exposes it as default. */
async function loadCore() {
  const mod = await import(path.join(ROOT, 'extension', 'lib', 'core.js'))
  return mod.default ?? mod
}

main().catch((error) => {
  console.error('\x1b[31mSuite crashed:\x1b[0m', error)
  process.exitCode = 1
})
