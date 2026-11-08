#!/usr/bin/env node
/**
 * CortexOS — Phase 1 automated test suite.
 *
 * Runs against the live daemon (default http://localhost:3000) and verifies
 * every Phase 1 capability end-to-end: health, seed idempotency, project
 * lifecycle, DNA workspace scan, Tier-1 rewriter (fast + cloud + deep
 * fallback), memory engine extraction, Knowledge Graph ops, Compact State
 * Packet, metrics, settings and the development timeline.
 *
 * Usage:  node scripts/test-phase1.mjs [baseUrl]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const API = `${BASE}/api/cortex`

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

// ---------------------------------------------------------------------------
// Fixture workspace for deterministic DNA scan assertions
// ---------------------------------------------------------------------------
async function createFixtureWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-fixture-'))
  await fs.mkdir(path.join(root, 'src', 'components'), { recursive: true })
  await fs.mkdir(path.join(root, 'src', 'lib'), { recursive: true })
  await fs.mkdir(path.join(root, 'prisma'), { recursive: true })

  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-app',
        dependencies: { next: '^15.0.0', react: '^19.0.0', '@clerk/nextjs': '^6.0.0', stripe: '^17.0.0', zod: '^4.0.0' },
        devDependencies: { typescript: '^5.6.0', tailwindcss: '^4.0.0', prisma: '^6.0.0' },
        scripts: { build: 'next build' },
      },
      null,
      2,
    ),
  )
  await fs.writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', paths: { '@/*': ['./src/*'] } } }, null, 2),
  )
  await fs.writeFile(path.join(root, 'components.json'), JSON.stringify({ style: 'new-york' }))
  await fs.writeFile(
    path.join(root, 'prisma', 'schema.prisma'),
    `datasource db {\n  provider = "postgresql"\n}\n\nmodel User {\n  id String @id\n}\nmodel Order {\n  id String @id\n}\n`,
  )
  await fs.writeFile(path.join(root, '.env.example'), 'DATABASE_URL=\nSTRIPE_SECRET_KEY=\n')
  await fs.writeFile(
    path.join(root, 'src', 'lib', 'auth.ts'),
    `import { clerkClient } from '@clerk/nextjs'\n\nexport function getUser(id: string) {\n  return clerkClient.users.getUser(id)\n}\n\nexport const isAdmin = (role: string) => role === 'admin'\n`,
  )
  await fs.writeFile(
    path.join(root, 'src', 'components', 'button.tsx'),
    `import React from 'react'\n\nexport function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {\n  return <button {...props} />\n}\n`,
  )
  return root
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\x1b[1m CortexOS Phase 1 — automated test suite\x1b[0m`)
  console.log(` daemon: ${BASE}\n`)

  let saasId = ''
  let testId = ''

  // ---- 1. Daemon health ---------------------------------------------------
  section('1 · Daemon health')
  let health = null
  await check('GET /health returns online with counts', async () => {
    const { status, json } = await api('GET', '/health')
    assertEqual(status, 200, 'status')
    assertEqual(json.status, 'online', 'daemon status')
    assertEqual(json.database, 'ok', 'database')
    assert(/^0\.\d+\.\d+$/.test(json.version), 'version missing') // 0.1.0 (Phase 1) → 0.2.0 (Phase 2)
    assert(json.phase.includes('Phase'), 'phase label missing')
    assert(typeof json.counts.projects === 'number', 'counts missing')
    assert('reachable' in json.ollama, 'ollama status missing')
    health = json
  })

  // ---- 2. Seed idempotency ------------------------------------------------
  section('2 · Demo seed (idempotent)')
  await check('POST /seed is idempotent and state-consistent', async () => {
    const { status, json } = await api('POST', '/seed')
    assertEqual(status, 200, 'status')
    assert(typeof json.seeded === 'boolean', 'seeded flag missing')
    // Whether it created just now or already existed, the demo project must
    // be present with the full walkthrough state.
    const projects = await api('GET', '/projects')
    const demo = projects.json.projects.find((p) => p.slug === 'saas-crm')
    assert(demo, 'saas-crm project missing after seed')
    assert(demo.counts.memories >= 15, `expected >=15 memories, got ${demo.counts.memories}`)
    assert(demo.dnaGeneratedAt, 'demo DNA missing')
    if (json.seeded === true) {
      assert(json.projectId === demo.id, 'seeded projectId mismatch')
    }
    // After the first call the demo project definitely exists — a second
    // call must always be a no-op.
    const again = await api('POST', '/seed')
    assertEqual(again.json.seeded, false, 'second seed should always be a no-op')
  })

  // ---- 3. Projects ----------------------------------------------------------
  section('3 · Project lifecycle')
  await check('GET /projects lists the demo project with counts', async () => {
    const { status, json } = await api('GET', '/projects')
    assertEqual(status, 200, 'status')
    const demo = json.projects.find((p) => p.slug === 'saas-crm')
    assert(demo, 'saas-crm project not found')
    assert(demo.counts.memories >= 15, `expected >=15 memories, got ${demo.counts.memories}`)
    assert(demo.counts.nodes >= 15, `expected >=15 nodes, got ${demo.counts.nodes}`)
    assert(demo.counts.edges >= 25, `expected >=25 edges, got ${demo.counts.edges}`)
    assert(demo.dnaGeneratedAt, 'demo DNA missing')
    saasId = demo.id
  })
  await check('POST /projects creates a project with slug + root node', async () => {
    const { status, json } = await api('POST', '/projects', {
      name: 'Phase1 Test Harness',
      description: 'Throwaway project for the automated suite.',
      platform: 'opencode',
    })
    assertEqual(status, 201, 'status')
    assert(json.slug.startsWith('phase1-test-harness'), `unexpected slug ${json.slug}`)
    testId = json.id
    const graph = await api('GET', `/graph?projectId=${testId}`)
    assert(graph.json.nodes.some((n) => n.kind === 'root'), 'root node not seeded')
  })
  await check('POST /projects validates input (422 on short name)', async () => {
    const { status } = await api('POST', '/projects', { name: 'x' })
    assertEqual(status, 422, 'status')
  })

  // ---- 4. PROJECT DNA from a real scan ------------------------------------
  section('4 · PROJECT DNA — deterministic workspace scan')
  const fixtureRoot = await createFixtureWorkspace()
  await check('POST /dna scans the fixture workspace and detects the stack', async () => {
    const { status, json } = await api('POST', `/projects/${testId}/dna`, { mode: 'scan', rootPath: fixtureRoot })
    assertEqual(status, 200, `status (${JSON.stringify(json).slice(0, 200)})`)
    const layers = Object.fromEntries(json.dna.techStack.map((t) => [t.layer, t.technology]))
    assert(layers.Framework?.includes('Next.js'), `framework not detected: ${layers.Framework}`)
    assert(layers.Language?.includes('strict'), 'strict TS not detected')
    assert(layers.Database === 'PostgreSQL', `database wrong: ${layers.Database}`)
    assert(layers.Auth === 'Clerk', `auth wrong: ${layers.Auth}`)
    assert(layers.Payments === 'Stripe', `payments wrong: ${layers.Payments}`)
    assert(layers.ORM?.startsWith('Prisma'), `orm wrong: ${layers.ORM}`)
    assert(json.dna.fileStats.prismaModels.includes('User'), 'prisma models not parsed')
    assert(json.dna.fileStats.envKeys.includes('STRIPE_SECRET_KEY'), 'env keys not parsed')
    assert(json.scan.scannedFiles >= 6, 'fixture files not all scanned')
    assert(json.scan.graphEdgesSynced > 0, 'graph edges not synced from DNA')
  })
  await check('DNA standards cite evidence (tsconfig strict, path aliases)', async () => {
    const { json } = await api('GET', `/projects/${testId}/dna`)
    const sources = json.dna.codingStandards.map((s) => s.source).join(' ')
    assert(sources.includes('tsconfig.json'), 'tsconfig evidence missing')
    assert(json.dna.codingStandards.some((s) => s.rule.includes('Path aliases')), 'alias standard missing')
    assert(json.dna.designPatterns.length > 0, 'no design patterns inferred')
  })
  await check('POST /dna on a bad path returns a clean error', async () => {
    const { status, json } = await api('POST', `/projects/${testId}/dna`, { mode: 'scan', rootPath: '/nonexistent/definitely' })
    assertEqual(status, 500, 'status')
    assert(json.error.includes('not an accessible directory'), `unexpected error: ${json.error}`)
  })
  await check('PATCH /dna curates business rules', async () => {
    const { status, json } = await api('PATCH', `/projects/${testId}/dna`, { businessRules: ['All mutations require Zod validation.'] })
    assertEqual(status, 200, 'status')
    assertEqual(json.updated, true, 'updated flag')
    const after = await api('GET', `/projects/${testId}/dna`)
    assert(after.json.dna.businessRules.includes('All mutations require Zod validation.'), 'rule not persisted')
    assertEqual(after.json.dna.generationSource, 'hybrid', 'source should be hybrid after curation')
  })

  // ---- 5. Memory engine ----------------------------------------------------
  section('5 · Memory engine — extraction, dedupe, graph linking')
  const transcript = [
    'We decided to use Redis for the job queue.',
    'Users must receive an email receipt after every purchase.',
    'There is a bug where the invoice PDF fails to render on Safari.',
    'We still need to add the export CSV endpoint.',
    'Always use server components by default.',
  ].join('\n')
  await check('POST /interactions extracts typed memories from a raw transcript', async () => {
    const { status, json } = await api('POST', '/interactions', { projectId: testId, text: transcript, platform: 'hermes' })
    assertEqual(status, 201, 'status')
    const fresh = json.extracted.filter((m) => !m.deduped)
    const types = fresh.map((m) => m.type).sort().join(',')
    assertEqual(types, 'bug,decision,preference,requirement,todo', `types extracted: ${types}`)
    const decision = fresh.find((m) => m.type === 'decision')
    assertEqual(decision.key, 'Redis', `decision key: ${decision.key}`)
    const bug = fresh.find((m) => m.type === 'bug')
    assert(bug.key.includes('invoice'), `bug key should mention invoice: ${bug.key}`)
  })
  await check('Re-capturing the same transcript dedupes everything', async () => {
    const { json } = await api('POST', '/interactions', { projectId: testId, text: transcript })
    const fresh = json.extracted.filter((m) => !m.deduped)
    assertEqual(fresh.length, 0, `expected 0 fresh, got ${fresh.length}`)
  })
  await check('Capture links mentioned tech into the Knowledge Graph', async () => {
    const { json } = await api('GET', `/graph?projectId=${testId}`)
    const labels = json.nodes.map((n) => n.label)
    assert(labels.includes('Redis'), 'Redis tech node missing')
    const redisId = json.nodes.find((n) => n.label === 'Redis').id
    const rootId = json.nodes.find((n) => n.kind === 'root').id
    assert(json.edges.some((e) => e.sourceId === rootId && e.targetId === redisId && e.relation === 'USES'), 'root USES Redis edge missing')
  })
  await check('Memory CRUD: create → resolve → delete', async () => {
    const created = await api('POST', '/memories', { projectId: testId, type: 'todo', key: 'manual item', value: 'Manually logged test item.', importance: 2 })
    assertEqual(created.status, 201, 'create status')
    const id = created.json.memory.id
    const patched = await api('PATCH', `/memories/${id}`, { status: 'resolved' })
    assertEqual(patched.json.memory.status, 'resolved', 'resolve failed')
    const deleted = await api('DELETE', `/memories/${id}`)
    assertEqual(deleted.json.deleted, true, 'delete failed')
    const gone = await api('GET', `/memories?projectId=${testId}&q=Manually logged`)
    assert(!gone.json.memories.some((m) => m.id === id), 'memory still present after delete')
  })

  // ---- 6. Knowledge Graph --------------------------------------------------
  section('6 · Knowledge Graph — triples, subgraph, traversal')
  await check('POST /graph add_node + add_edge write verified triples', async () => {
    const node = await api('POST', '/graph', { op: 'add_node', projectId: testId, kind: 'feature', label: 'Invoice PDF' })
    assertEqual(node.status, 201, 'add_node status')
    const edge = await api('POST', '/graph', { op: 'add_edge', projectId: testId, sourceLabel: 'Invoice PDF', relation: 'DEPENDS_ON', targetLabel: 'Redis' })
    assertEqual(edge.status, 201, `add_edge status (${JSON.stringify(edge.json)})`)
    assert(edge.json.edge.includes('DEPENDS_ON'), 'edge triple malformed')
  })
  await check('GET /graph?context= matches prompt tokens to subgraph pointers', async () => {
    const { json } = await api('GET', `/graph?projectId=${testId}&context=${encodeURIComponent('fix the invoice pdf rendering bug')}`)
    assert(json.pointers.length > 0, 'no pointers matched')
    assert(json.pointers.some((p) => p.source === 'Invoice PDF' || p.target === 'Invoice PDF'), 'Invoice PDF not matched')
  })
  await check('GET /graph?nodeId= returns the one-hop neighbourhood', async () => {
    const graph = await api('GET', `/graph?projectId=${testId}`)
    const feature = graph.json.nodes.find((n) => n.label === 'Invoice PDF')
    const { json } = await api('GET', `/graph?projectId=${testId}&nodeId=${feature.id}`)
    assert(json.edges.some((e) => e.relation === 'DEPENDS_ON'), 'neighborhood missing DEPENDS_ON edge')
    assert(json.nodes.length >= 2, 'neighborhood too small')
  })
  await check('DELETE /graph removes a non-root node and cascades edges', async () => {
    const graph = await api('GET', `/graph?projectId=${testId}`)
    const feature = graph.json.nodes.find((n) => n.label === 'Invoice PDF')
    const { json } = await api('DELETE', `/graph?projectId=${testId}&nodeId=${feature.id}`)
    assertEqual(json.deleted, true, 'delete failed')
    const after = await api('GET', `/graph?projectId=${testId}`)
    assert(!after.json.nodes.some((n) => n.id === feature.id), 'node still present')
  })
  await check('Root node is protected from deletion', async () => {
    const graph = await api('GET', `/graph?projectId=${testId}`)
    const root = graph.json.nodes.find((n) => n.kind === 'root')
    const { status, json } = await api('DELETE', `/graph?projectId=${testId}&nodeId=${root.id}`)
    assertEqual(status, 422, 'status')
    assert(json.error.includes('root'), 'wrong error')
  })

  // ---- 7. Tier-1 Prompt Rewriter ------------------------------------------
  section('7 · Tier-1 Prompt Rewriter (the flagship)')
  let fastResult = null
  await check('FAST engine: blueprint example → full Tier-1 structure', async () => {
    const { status, json } = await api('POST', '/rewrite', {
      projectId: saasId,
      prompt: 'add stripe webhook for subscription renewal and update user db',
      engine: 'fast',
    })
    assertEqual(status, 200, 'status')
    fastResult = json
    assert(json.prompt.includes('[CORTEX-OS SYNC'), 'sync header missing')
    for (const sectionName of ['## Context', '## Tech Stack', '## Requirements', '## Constraints', '## Deliverables', '## Out of Scope']) {
      assert(json.prompt.includes(sectionName), `${sectionName} missing`)
    }
    assert(json.prompt.includes('(Payments) —[USES]→ (Stripe)'), 'graph pointer missing')
    assert(json.prompt.includes('race condition'), 'critical bug #14 not injected')
    assert(json.prompt.includes('1. Add stripe webhook'), 'requirement split failed')
    assert(json.prompt.includes('2. Update user db'), 'requirement split failed (2nd)')
    assert(json.metrics.tokensContextAvoided > 0, 'no context savings accounted')
    assert(json.metrics.durationMs < 2000, `fast-path too slow: ${json.metrics.durationMs}ms`)
    assertEqual(json.engineUsed, 'fast', 'engine')
    assert(json.intent.domains.includes('payments'), 'payments domain missed')
  })
  await check('FAST engine: decomposition triggers on complex prompts', async () => {
    const { json } = await api('POST', '/rewrite', {
      projectId: saasId,
      prompt: 'build a realtime notification system with websocket and add rate limiting, then add e2e tests and deploy it',
      engine: 'fast',
    })
    assert(json.decomposition.needed, 'decomposition not triggered')
    assert(json.decomposition.subtasks.length >= 3, 'too few subtasks')
    assert(json.decomposition.subtasks.some((t) => t.domain === 'realtime'), 'realtime subtask missing')
    assert(json.decomposition.subtasks.some((t) => t.domain === 'testing'), 'testing subtask missing')
  })
  await check('FAST engine: research prompts route to the local tier', async () => {
    const { json } = await api('POST', '/rewrite', { projectId: saasId, prompt: 'what database should we use for analytics?', engine: 'fast' })
    assertEqual(json.intent.intent, 'research', 'intent')
    assert(json.intent.routing.tier === 'fast-path', 'research should route to fast-path')
  })
  await check('CLOUD engine: GLM refinement returns a Tier-1 prompt', async () => {
    const { status, json } = await api('POST', '/rewrite', { projectId: saasId, prompt: 'build login page', engine: 'cloud' })
    assertEqual(status, 200, 'status')
    assert(['cloud', 'fast'].includes(json.engineUsed), `engine: ${json.engineUsed}`)
    if (json.engineUsed === 'cloud') {
      assert(json.prompt.includes('[CORTEX-OS SYNC'), 'cloud output missing sync header')
      assert(json.prompt.length > 400, 'cloud output suspiciously short')
    } else {
      assert(json.engineNote && json.engineNote.includes('Cloud engine failed'), 'fallback note missing')
      console.log(`      (cloud fell back: ${json.engineNote?.slice(0, 90)})`)
    }
  })
  await check('DEEP engine: graceful fallback when Ollama is offline', async () => {
    const { status, json } = await api('POST', '/rewrite', { projectId: saasId, prompt: 'add redis cache to the deals api', engine: 'deep' })
    assertEqual(status, 200, 'status')
    if (json.engineUsed === 'fast') {
      assert(json.engineNote && json.engineNote.toLowerCase().includes('unreachable'), 'fallback note missing')
    } else {
      assert(json.prompt.includes('[CORTEX-OS SYNC'), 'deep output missing sync header')
    }
  })
  await check('Rewrite sessions are persisted with history', async () => {
    const { json } = await api('GET', `/rewrite?projectId=${saasId}`)
    assert(json.sessions.length >= 3, `expected >=3 sessions, got ${json.sessions.length}`)
    assert(json.sessions[0].tokensContextAvoided > 0, 'history savings missing')
  })

  // ---- 8. Compact State Packet --------------------------------------------
  section('8 · Compact State Packet (cross-platform sync contract)')
  await check('GET /sync/{slug} returns a ≤350-token packet with the contract', async () => {
    const { status, json } = await api('GET', '/sync/saas-crm')
    assertEqual(status, 200, 'status')
    assert(json.markdown.includes('[CORTEX-OS SYNC'), 'header missing')
    assert(json.markdown.includes('Stack:'), 'stack line missing')
    assert(json.markdown.includes('Open ('), 'open items missing')
    assert(json.tokens > 100 && json.tokens <= 350, `token budget blown: ${json.tokens}`)
    assert(json.stateHash.length === 6, 'state hash malformed')
    assert(json.graphRoots.length > 0, 'module roots missing')
  })

  // ---- 9. Metrics ----------------------------------------------------------
  section('9 · Metrics & timeline')
  await check('GET /metrics aggregates savings, series, events and open items', async () => {
    const { status, json } = await api('GET', '/metrics')
    assertEqual(status, 200, 'status')
    assert(json.totals.projects >= 2, 'projects count')
    assert(json.totals.promptSessions >= 3, 'prompt sessions')
    assert(json.tokenSavings.tokensContextAvoided > 0, 'savings missing')
    assert(json.daily.length === 14, 'daily series should cover 14 days')
    assert(json.recentEvents.length > 0, 'recent events missing')
    assert(json.openItems.length > 0, 'open items missing')
  })
  await check('GET /projects/{id}/timeline records every engine action', async () => {
    const { json } = await api('GET', `/projects/${testId}/timeline`)
    const kinds = new Set(json.events.map((e) => e.kind))
    for (const expected of ['project.created', 'dna.generated', 'interaction.logged', 'graph.updated', 'memory.captured']) {
      assert(kinds.has(expected), `timeline missing ${expected}`)
    }
  })

  // ---- 10. Settings --------------------------------------------------------
  section('10 · Daemon settings')
  await check('GET/PUT /settings round-trips the Ollama configuration', async () => {
    const before = await api('GET', '/settings')
    assertEqual(before.json.settings.defaultEngine, 'fast', 'default engine')
    const put = await api('PUT', '/settings', { ollamaModel: 'llama3.2:3b' })
    assertEqual(put.status, 200, 'put status')
    assertEqual(put.json.settings.ollamaModel, 'llama3.2:3b', 'model not persisted')
    await api('PUT', '/settings', { ollamaModel: before.json.settings.ollamaModel })
  })
  await check('POST /settings/test probes Ollama (offline → clean status)', async () => {
    const { status, json } = await api('POST', '/settings/test', { ollamaBaseUrl: 'http://127.0.0.1:59999' })
    assertEqual(status, 200, 'status')
    assertEqual(json.status.reachable, false, 'should be unreachable')
    assert(json.status.error, 'error detail missing')
  })

  // ---- 11. Validation & cleanup ---------------------------------------------
  section('11 · Validation & cleanup')
  await check('Malformed JSON returns 400', async () => {
    const response = await fetch(`${API}/rewrite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' })
    assertEqual(response.status, 400, 'status')
  })
  await check('Unknown project returns 404 on rewrite', async () => {
    const { status } = await api('POST', '/rewrite', { projectId: 'does-not-exist', prompt: 'hello world test', engine: 'fast' })
    assertEqual(status, 500, 'status')
  })
  await check('DELETE /projects/{id} removes the test project (cascade)', async () => {
    const { status, json } = await api('DELETE', `/projects/${testId}`)
    assertEqual(status, 200, 'status')
    assertEqual(json.deleted, true, 'deleted flag')
    const after = await api('GET', '/projects')
    assert(!after.json.projects.some((p) => p.id === testId), 'project still listed')
  })

  await fs.rm(fixtureRoot, { recursive: true, force: true })

  // ---- Report ----------------------------------------------------------------
  const passed = results.filter((r) => r.pass).length
  const failed = results.length - passed
  console.log(`\n\x1b[1m─────────────────────────────────────────────\x1b[0m`)
  console.log(`  Results: \x1b[32m${passed} passed\x1b[0m${failed > 0 ? `, \x1b[31m${failed} failed\x1b[0m` : ''} · ${results.length} total`)
  if (failed > 0) {
    console.log(`\n  Failures:`)
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   \x1b[31m•\x1b[0m [${r.section}] ${r.name}\n      ${r.error}`)
    }
  }
  console.log('')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('Suite crashed:', error)
  process.exit(1)
})
