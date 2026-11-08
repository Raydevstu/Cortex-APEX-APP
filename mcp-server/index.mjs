#!/usr/bin/env node
/**
 * CortexOS MCP Server — Phase 3 (blueprint §1, universal hook #1).
 *
 * A real Model Context Protocol server (stdio transport) that exposes the
 * Cortex daemon brain to every MCP-capable platform: Codex, OpenCode,
 * Cursor, Windsurf, Claude Desktop/Code, Hermes. When the IDE agent boots,
 * it pulls the current project state through `cortex_sync`; every decision
 * it makes flows back through `cortex_log_decision`; since Phase 3 it can
 * also run the Pre-Execution Local Agent (`cortex_preexecute`) and feed
 * finished turns back into the memory engine (`cortex_extract_memory`).
 *
 * Tools (blueprint-exact names first):
 *   cortex_sync                — full CrossPlatformSyncPacket for a platform handoff
 *   cortex_get_dna             — the project's DNA (stack, standards, rules)
 *   cortex_log_decision        — persist a decision/bug/todo/preference to the brain
 *   cortex_rewrite             — Tier-1 prompt rewrite (fast | deep | cloud)
 *   cortex_search_history      — semantic episodic search over past interactions
 *   cortex_capture_interaction — memory extraction from a raw chat transcript
 *   cortex_preexecute          — Phase 3 pre-execution local agent (triage → tools → Tier-1 payload)
 *   cortex_extract_memory      — Phase 3 Engine 3 turn analysis → ExtractedMemoryDelta
 *   cortex_state               — Phase 4 Visual Command Center state: graph,
 *                                 telemetry, timeline, CTO advisories and the
 *                                 AST Semantic Scope Lock (read + mutate) — CLI access
 *   cortex_cto                 — Phase 4 AI CTO mode: workspace audit + Multi-Agent
 *                                 DAG orchestration (build / dispatch / confirm /
 *                                 archive) — CLI access
 *
 * Configuration:
 *   CORTEX_DAEMON_URL  daemon base URL (default http://localhost:3000)
 *   --daemon <url>     overrides the environment variable
 *
 * Run directly:  node mcp-server/index.mjs
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Daemon client
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const daemonFlagIndex = args.indexOf('--daemon')
const DAEMON = (
  daemonFlagIndex !== -1 && args[daemonFlagIndex + 1]
    ? args[daemonFlagIndex + 1]
    : process.env.CORTEX_DAEMON_URL ?? 'http://localhost:3000'
).replace(/\/$/, '')

const API = `${DAEMON}/api/cortex`

async function daemonFetch(method, path, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    let json = null
    try {
      json = await response.json()
    } catch {
      json = null
    }
    if (!response.ok) {
      const message = json && typeof json === 'object' && 'error' in json ? String(json.error) : `daemon returned ${response.status}`
      throw new Error(message)
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

/** Resolve a project slug → { id, name } via the daemon's project list. */
async function resolveProject(slug) {
  const { projects } = await daemonFetch('GET', '/projects')
  const project = (projects ?? []).find((p) => p.slug === slug)
  if (!project) {
    throw new Error(`No CortexOS project with slug "${slug}". Known slugs: ${(projects ?? []).map((p) => p.slug).join(', ') || '(none)'}`)
  }
  return project
}

// ---------------------------------------------------------------------------
// Phase 4 formatters — CLI-friendly renders of the Command Center contracts
// ---------------------------------------------------------------------------

/** Compact dashboard-state render (what the browser shows, for the terminal). */
function formatDashboardState(state, { includeXml = false } = {}) {
  const labels = {}
  for (const node of state.graph.nodes) labels[node.label] = (labels[node.label] ?? 0) + 1
  const graphSummary = Object.entries(labels)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label} ×${count}`)
    .join(', ')

  const scope = state.scopeLock
  const t = state.telemetry
  const activeTask = state.activeTask?.taskId
    ? `${state.activeTask.title} [${state.activeTask.status}]`
    : '(none)'

  const recommendations = (state.ctoRecommendations ?? []).map(
    (r, i) => {
      const impact = r.impactedSymbols?.length > 0 ? `\n   Impacted: ${r.impactedSymbols.slice(0, 4).join(', ')}${r.impactedSymbols.length > 4 ? ', …' : ''}` : ''
      const savings = r.suggestedAction?.estimatedTokenSavings ? ` · saves ~${r.suggestedAction.estimatedTokenSavings} tokens` : ''
      return `${i + 1}. [${r.severity}] ${r.category} — ${r.title}\n   ${r.rationale}${impact}\n   → ${r.suggestedAction?.actionType ?? 'REVIEW'}: ${r.suggestedAction?.commandPreview ?? '—'}${savings}`
    },
  ).join('\n')

  const timeline = (state.timeline ?? []).slice(0, 6).map(
    (e) => `· [${e.kind}] ${e.summary}${e.platform ? ` (${e.platform})` : ''} — ${e.timestamp.slice(0, 16).replace('T', ' ')}`,
  ).join('\n')

  const lines = [
    `CORTEX STATE — ${state.projectName} (${state.projectSlug}) · DNA v${state.projectDnaVersion}`,
    `Active task: ${activeTask}`,
    `Scope lock: ${scope.allowedSymbolFqns.length} allowed · ${scope.lockedSymbolFqns.length} locked · ${scope.forbiddenPaths.length} forbidden path(s) (source: ${scope.source}, updated ${scope.updatedAt.slice(0, 16).replace('T', ' ')})`,
    `Graph: ${state.graph.nodes.length} nodes / ${state.graph.edges.length} edges — ${graphSummary}`,
    `Telemetry: ${t.totalPromptsIntercepted} prompts intercepted · ${t.netTokensSaved.toLocaleString('en-US')} net tokens saved (${t.compressionRatioPct}% compression, $${t.estimatedCostSavingsUsd}) · ${t.localOffloadPct}% local offload`,
    `Workspace audit: ${state.audit.symbolsScanned} symbols / ${state.audit.filesScanned} files scanned (${state.audit.cache === 'hit' ? 'cache hit' : 'fresh scan'} @ ${state.audit.scannedAt.slice(0, 16).replace('T', ' ')})`,
    '',
    `CTO RECOMMENDATIONS (${state.ctoRecommendations?.length ?? 0}):`,
    recommendations || 'None — the workspace is clean for the current scope.',
    '',
    `RECENT TIMELINE (last ${Math.min(6, state.timeline?.length ?? 0)}):`,
    timeline || '(no events yet)',
  ]
  if (includeXml && state.syncPacketXml) {
    lines.push('', '--- <cortex_sync_packet> XML (injectable) ---', state.syncPacketXml)
  }
  return lines.join('\n')
}

/** Compact CTO audit render. */
function formatCtoAudit(payload) {
  const { audit, plans } = payload
  const recommendations = (audit.recommendations ?? []).map(
    (r, i) => {
      const impact = r.impactedSymbols?.length > 0 ? `\n   Impacted: ${r.impactedSymbols.slice(0, 4).join(', ')}${r.impactedSymbols.length > 4 ? ', …' : ''}` : ''
      const savings = r.suggestedAction?.estimatedTokenSavings ? ` · saves ~${r.suggestedAction.estimatedTokenSavings} tokens` : ''
      return `${i + 1}. [${r.severity}] ${r.category} — ${r.title}\n   ${r.rationale}${impact}\n   → ${r.suggestedAction?.actionType ?? 'REVIEW'}: ${r.suggestedAction?.commandPreview ?? '—'}${savings}`
    },
  ).join('\n')
  const planLines = (plans ?? []).map(
    (p) => `· ${String(p.id).slice(0, 8)} [${p.status}] ${p.goal} — ${p.subtasks.length} subtask(s), ${p.waves.length} wave(s) (created ${p.createdAt.slice(0, 10)})`,
  ).join('\n')
  return [
    `AI CTO AUDIT — ${audit.projectName} (scanned ${audit.scannedAt.slice(0, 16).replace('T', ' ')}, ${audit.stats.cache === 'hit' ? 'cache hit' : 'fresh scan'})`,
    `Workspace: ${audit.stats.symbolsScanned} symbols / ${audit.stats.filesScanned} files · ${audit.stats.layerViolations} layer violation(s) · ${audit.stats.complexityHotspots} complexity hotspot(s)`,
    '',
    `RECOMMENDATIONS (${audit.recommendations?.length ?? 0}):`,
    recommendations || 'None — the workspace is clean for the current scope.',
    '',
    `DAG PLANS (${plans?.length ?? 0}):`,
    planLines || '(no plans yet — build one with action BUILD_DAG_PLAN)',
  ].join('\n')
}

/** Full DAG plan render grouped by topological wave. */
function formatDagPlan(plan) {
  const lines = [
    `DAG PLAN ${String(plan.id).slice(0, 8)} — ${plan.goal}`,
    `Status: ${plan.status} · ${plan.subtasks.length} subtask(s) in ${plan.waves.length} wave(s) · created ${plan.createdAt.slice(0, 16).replace('T', ' ')}`,
  ]
  if (plan.auditMeta?.estimatedTokenSavings) {
    lines.push(`Estimated cloud-token savings: ~${plan.auditMeta.estimatedTokenSavings.toLocaleString('en-US')}`)
  }
  if (plan.auditMeta?.triggeredBy === 'cto-recommendation' && plan.auditMeta.recommendationId) {
    lines.push(`Triggered by CTO recommendation ${plan.auditMeta.recommendationId.slice(0, 8)}`)
  }
  plan.waves.forEach((wave, waveIndex) => {
    lines.push('', `Wave ${waveIndex + 1} (parallel):`)
    for (const subtaskId of wave) {
      const task = plan.subtasks.find((s) => s.id === subtaskId)
      if (!task) continue
      const depTitles = (task.dependencies ?? []).map(
        (d) => plan.subtasks.find((s) => s.id === d)?.title ?? d,
      )
      const deps = depTitles.length > 0 ? ` · after “${depTitles.join('” + “')}”` : ''
      lines.push(`  · ${task.title} [${task.status}] — ${task.assignedAgent}${deps}`)
      if (task.resultSummary) lines.push(`      result: ${task.resultSummary}`)
      for (const artifact of task.artifacts ?? []) {
        lines.push(`      ${artifact.ok ? '✓' : '✗'} ${artifact.toolName}: ${artifact.summary}`)
      }
    }
  })
  return lines.join('\n')
}

/** Dispatch render: plan + the Tier-1 payloads awaiting the cloud tier. */
function formatDispatch(plan) {
  const base = formatDagPlan(plan)
  const awaiting = (plan.subtasks ?? []).filter(
    (s) => s.agentKind === 'cloud' && s.status === 'dispatched' && s.payload,
  )
  if (awaiting.length === 0) {
    const settled = (plan.subtasks ?? []).every((s) => ['completed', 'failed', 'skipped'].includes(s.status))
    return `${base}\n\n${settled ? 'The plan is fully settled — no cloud payloads pending.' : 'No cloud payloads pending. Confirm local outcomes or re-dispatch when dependencies complete.'}`
  }
  const payloads = awaiting.map(
    (s) => `--- TIER-1 PAYLOAD — "${s.title}" → ${s.assignedAgent} ---\n(When finished, confirm with: action UPDATE_SUBTASK, planId ${plan.id}, subtaskId ${s.id}, status completed)\n\n${s.payload}`,
  ).join('\n\n')
  return `${base}\n\n${payloads}`
}

// ---------------------------------------------------------------------------
// Server + tools
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'cortexos',
  version: '0.4.0',
})

const PLATFORMS = z.enum(['codex', 'hermes', 'opencode', 'cursor', 'windsurf', 'claude', 'chatgpt', 'local_ollama'])
const MEMORY_TYPES = z.enum(['decision', 'architecture', 'requirement', 'todo', 'bug', 'preference'])

server.tool(
  'cortex_sync',
  'Pull the current project state from the CortexOS brain as a compact CrossPlatformSyncPacket (header, stack + constraints, scoped graph context — active module decisions/symbols/bugs — and continuity: active task + pending tasks). Call this when a session/chat starts or when switching platform. Records a handoff and flips the project\'s active platform.',
  {
    slug: z.string().min(1).describe('CortexOS project slug, e.g. "saas-crm"'),
    targetPlatform: PLATFORMS.optional().describe('Platform receiving the state (e.g. "hermes"). Defaults to the project\'s current platform.'),
    module: z.string().max(60).optional().describe('Explicit active module to scope the graph context (e.g. "Payments"). Omit for auto-inference from recent activity.'),
  },
  async ({ slug, targetPlatform, module }) => {
    const { handoffId, packet } = await daemonFetch('POST', `/sync/${encodeURIComponent(slug)}`, {
      targetPlatform: targetPlatform ?? 'codex',
      ...(module ? { module } : {}),
    })
    return {
      content: [{
        type: 'text',
        text: `CortexOS sync packet (handoff ${handoffId.slice(0, 8)}, state #${packet.stateHash}, ~${packet.tokens} tokens)\n\n${JSON.stringify({
          header: packet.header,
          dnaSnapshot: packet.dnaSnapshot,
          scopedGraphContext: packet.scopedGraphContext,
          continuityState: packet.continuityState,
        }, null, 2)}\n\n--- Injectable markdown state header ---\n${packet.markdown}`,
      }],
    }
  },
)

server.tool(
  'cortex_get_dna',
  'Get the project\'s DNA — architecture philosophy, tech stack with evidence, coding standards, business rules, preferred libraries and design patterns. Read this before generating any code so nothing violates the architecture.',
  {
    slug: z.string().min(1).describe('CortexOS project slug'),
  },
  async ({ slug }) => {
    const project = await resolveProject(slug)
    const detail = await daemonFetch('GET', `/projects/${encodeURIComponent(project.id)}`)
    if (!detail.project.dna) {
      return { content: [{ type: 'text', text: `Project "${slug}" has no DNA yet — generate it from the workspace in the Command Center (Projects → DNA → Generate).` }] }
    }
    return {
      content: [{
        type: 'text',
        text: `PROJECT DNA — ${detail.project.name} (generated ${detail.project.dna.generatedAt})\n\n${JSON.stringify(detail.project.dna, null, 2)}`,
      }],
    }
  },
)

server.tool(
  'cortex_log_decision',
  'Persist a decision/requirement/bug/todo/preference into the CortexOS memory engine so it is never lost and is injected into every future session and platform. Use after making any architectural or business decision.',
  {
    slug: z.string().min(1).describe('CortexOS project slug'),
    key: z.string().min(1).max(120).describe('Short label, e.g. "database" or "auth-provider"'),
    value: z.string().min(3).max(1000).describe('Full detail, e.g. "PostgreSQL chosen as primary datastore — transactional guarantees required"'),
    type: MEMORY_TYPES.optional().describe('Memory type (default "decision")'),
    importance: z.number().int().min(1).max(5).optional().describe('1–5, default 3'),
  },
  async ({ slug, key, value, type, importance }) => {
    const project = await resolveProject(slug)
    const { memory } = await daemonFetch('POST', '/memories', {
      projectId: project.id,
      type: type ?? 'decision',
      key,
      value,
      importance: importance ?? 3,
    })
    return {
      content: [{
        type: 'text',
        text: `Logged [${memory.type}] ${memory.key} (importance ${memory.importance}, id ${memory.id}) to the ${slug} brain. It will be carried into every future sync packet and platform handoff.`,
      }],
    }
  },
)

server.tool(
  'cortex_rewrite',
  'Rewrite a raw one-line prompt into a Tier-1 enterprise-grade specification using the project\'s DNA, memories and Knowledge Graph pointers. Engines: "fast" (deterministic, <50ms), "deep" (local Ollama), "cloud" (GLM refinement).',
  {
    slug: z.string().min(1).describe('CortexOS project slug'),
    prompt: z.string().min(3).max(4_000).describe('The raw prompt to rewrite'),
    engine: z.enum(['fast', 'deep', 'cloud']).optional().describe('Rewrite engine (default "fast")'),
  },
  async ({ slug, prompt, engine }) => {
    const project = await resolveProject(slug)
    const result = await daemonFetch('POST', '/rewrite', {
      projectId: project.id,
      prompt,
      engine: engine ?? 'fast',
    })
    return {
      content: [{
        type: 'text',
        text: `Tier-1 prompt (engine: ${result.engineUsed}${result.engineNote ? ` — ${result.engineNote}` : ''})\n\n${result.prompt}\n\n--- Metrics ---\nIntent: ${result.intent.intent} (complexity ${result.intent.complexity}/10) · routing: ${result.intent.routing.tier} → ${result.intent.routing.target}\nContext tokens avoided: ${result.metrics.tokensContextAvoided} (${result.metrics.savingsPct}% savings, ${result.metrics.durationMs}ms)`,
      }],
    }
  },
)

server.tool(
  'cortex_search_history',
  'Semantic search over the project\'s episodic memory — past interactions, decisions and transcripts. Use this instead of asking the user to re-explain history.',
  {
    slug: z.string().min(1).describe('CortexOS project slug'),
    query: z.string().min(2).max(500).describe('What to search for, e.g. "stripe webhook race condition"'),
    k: z.number().int().min(1).max(10).optional().describe('Max episodes to return (default 5)'),
  },
  async ({ slug, query, k }) => {
    const search = await daemonFetch('POST', '/search', { slug, query, k: k ?? 5 })
    const episodes = (search.results ?? []).map(
      (r, i) => `${i + 1}. [${r.score}] ${r.title ?? 'Untitled'} (${r.platform ?? 'unknown platform'}, ${r.createdAt.slice(0, 10)})\n   ${r.summary ?? r.snippet}`,
    )
    const memories = (search.memories ?? []).map((m) => `- [${m.type}] ${m.key}: ${m.value.slice(0, 120)}`)
    return {
      content: [{
        type: 'text',
        text: `Episodic search "${query}" (embedding provider: ${search.provider})\n\n${episodes.length > 0 ? episodes.join('\n') : 'No matching episodes found.'}${memories.length > 0 ? `\n\nRelated memories:\n${memories.join('\n')}` : ''}`,
      }],
    }
  },
)

server.tool(
  'cortex_capture_interaction',
  'Feed a raw chat transcript into the memory engine: typed memories (decisions, requirements, TODOs, bugs, preferences) are extracted with dedupe, mentioned tech is linked in the Knowledge Graph, and the turn is indexed into the episodic vector store.',
  {
    slug: z.string().min(1).describe('CortexOS project slug'),
    text: z.string().min(5).max(20_000).describe('The raw transcript/turn text'),
    title: z.string().max(200).optional().describe('Optional session title'),
    platform: z.enum(['codex', 'hermes', 'opencode', 'claude', 'cursor', 'windsurf', 'web', 'other']).optional().describe('Platform the transcript came from'),
  },
  async ({ slug, text, title, platform }) => {
    const project = await resolveProject(slug)
    const result = await daemonFetch('POST', '/interactions', {
      projectId: project.id,
      text,
      ...(title ? { title } : {}),
      ...(platform ? { platform } : {}),
    })
    const extracted = (result.extracted ?? []).map((m) => `- [${m.type}] ${m.key}: ${m.value.slice(0, 100)}${m.deduped ? ' (deduped)' : ''}`)
    return {
      content: [{
        type: 'text',
        text: `Captured interaction ${result.interactionId.slice(0, 8)}: ${(result.extracted ?? []).length} memories (${(result.extracted ?? []).filter((m) => !m.deduped).length} new), ${(result.techLinked ?? []).length} tech linked${result.episode ? `, episode indexed via ${result.episode.provider} (summary: "${result.episode.summary.slice(0, 120)}…", saved ~${result.episode.tokensSaved} tokens)` : ''}.\n${extracted.length > 0 ? `\n${extracted.join('\n')}` : ''}`,
      }],
    }
  },
)

server.tool(
  'cortex_preexecute',
  'Run the Phase 3 Pre-Execution Local Agent on a raw prompt: Engine 1 triages it (LOCAL_ONLY | HYBRID_PRE_EXECUTE | CLOUD_DIRECT_WITH_DNA), deterministic local tools inspect the REAL workspace (git state, Prisma schema fields, AST symbol signatures, cached SDK docs) and scaffold boilerplate into a staged area (never written without your apply). Returns the router decision, the executed tool artifacts, the staged files and — unless the task was completed 100% locally — the blueprint-format Tier-1 payload to inject.',
  {
    slug: z.string().min(1).describe('CortexOS project slug'),
    prompt: z.string().min(3).max(4_000).describe('The raw prompt exactly as the developer would type it'),
    targetPlatform: PLATFORMS.optional().describe('Platform the payload is optimized for (default: the project\'s current platform)'),
    module: z.string().max(60).optional().describe('Explicit active module to scope the graph context'),
  },
  async ({ slug, prompt, targetPlatform, module }) => {
    const project = await resolveProject(slug)
    const result = await daemonFetch('POST', '/preexecute', {
      projectId: project.id,
      prompt,
      ...(targetPlatform ? { targetPlatform } : {}),
      ...(module ? { module } : {}),
    })

    const toolLines = (result.artifacts ?? [])
      .map((a) => `${a.ok ? '✓' : '✗'} ${a.toolName} (${a.durationMs}ms): ${a.summary}`)
      .join('\n')
    const stagedLines = (result.staged ?? [])
      .map((s) => `· ${s.kind} → ${s.targetPath} [${s.status}]`)
      .join('\n')

    const header = [
      `Pre-execution run ${String(result.runId).slice(0, 8)} — ${result.router.executionMode} (${result.router.intentCategory}, complexity ${result.router.complexityScore}/10)`,
      `Router engine: ${result.routerEngine}${result.tier1Engine ? ` · Tier-1 engine: ${result.tier1Engine}` : ''}`,
      `Cloud tokens saved: ~${result.metrics.tokensSavedCloud} · local tools took ${result.metrics.localToolMs}ms`,
      '',
      'LOCAL TOOL EXECUTION:',
      toolLines || '(no steps)',
      '',
      stagedLines ? `STAGED FILES (apply via the daemon: POST /api/cortex/preexecute/staged/{id} {"action":"apply"}):\n${stagedLines}\n` : '',
    ].join('\n')

    if (result.handledCompletelyLocally || !result.injectedPrompt) {
      return {
        content: [{
          type: 'text',
          text: `${header}\nThe task was completed 100% locally — nothing to send to the main model. Apply the staged files and you are done.`,
        }],
      }
    }

    return {
      content: [{
        type: 'text',
        text: `${header}\n--- INJECT THIS INTO THE MAIN MODEL ---\n\n${result.injectedPrompt}`,
      }],
    }
  },
)

server.tool(
  'cortex_extract_memory',
  'Phase 3 Engine 3 — feed a FINISHED AI coding turn (user prompt + AI response + modified-file symbols) into the memory engine. Extracts decisions (with supersede detection when the course changed), requirements, task transitions (completed only when the diff proves it), discovered/resolved bugs and preferences, then applies them to the memory engine, the Knowledge Graph (GOVERNED_BY / SUPERSEDES / HAS_BUG edges) and the episodic store. Call this after every completed turn.',
  {
    slug: z.string().min(1).describe('CortexOS project slug'),
    sourcePlatform: PLATFORMS.describe('Platform the turn happened on (codex | hermes | …)'),
    rawUserPrompt: z.string().min(3).max(20_000).describe('What the user asked in this turn'),
    aiResponseText: z.string().min(3).max(20_000).describe('The AI\'s response/summary of what it did'),
    modifiedFiles: z.array(z.string().max(500)).max(50).optional().describe('Files modified in this turn (paths only, when symbol-level diffs are unavailable)'),
  },
  async ({ slug, sourcePlatform, rawUserPrompt, aiResponseText, modifiedFiles }) => {
    const project = await resolveProject(slug)
    const report = await daemonFetch('POST', '/extract', {
      projectId: project.id,
      sourcePlatform,
      rawUserPrompt,
      aiResponseText,
      ...(modifiedFiles && modifiedFiles.length > 0
        ? { modifiedFilesAstDiff: modifiedFiles.map((path) => ({ path, addedSymbols: [], modifiedSymbols: [] })) }
        : {}),
    })

    const delta = report.delta ?? {}
    const decisions = (delta.newDecisions ?? [])
      .map((d) => `- [${d.category}] ${d.title}${d.supersedesDecisionId ? ' (SUPERSEDES a previous decision)' : ''}: ${d.rationale.slice(0, 120)}`)
      .join('\n')
    const tasks = (delta.taskUpdates ?? [])
      .map((t) => `- ${t.title} → ${t.status}${t.targetFiles.length > 0 ? ` (${t.targetFiles.join(', ')})` : ''}`)
      .join('\n')
    const bugs = (delta.discoveredBugs ?? [])
      .map((b) => `- [${b.severity}/${b.status}] ${b.title}: ${b.rootCause.slice(0, 120)}`)
      .join('\n')

    return {
      content: [{
        type: 'text',
        text: [
          `Memory delta applied (engine: ${report.engineUsed}) — ${report.decisionsCreated} decision(s) created, ${report.decisionsSuperseded} superseded, ${report.requirementsCreated} requirement(s), ${report.tasksUpdated} task update(s) + ${report.tasksCreated} new, ${report.bugsCreated} bug(s) created / ${report.bugsResolved} resolved, ${report.preferencesCreated} preference(s).`,
          `Turn summary: ${delta.compactTurnSummary ?? ''}`,
          decisions ? `\nDecisions:\n${decisions}` : '',
          tasks ? `\nTasks:\n${tasks}` : '',
          bugs ? `\nBugs:\n${bugs}` : '',
        ].filter(Boolean).join('\n'),
      }],
    }
  },
)

// ---------------------------------------------------------------------------
// Phase 4 — Visual Command Center + AI CTO over MCP (CLI access)
// ---------------------------------------------------------------------------

server.tool(
  'cortex_state',
  'Read or mutate the Phase 4 Visual Command Center state for a project from the CLI: live Knowledge Graph (nodes/edges with AST scope statuses), token-savings telemetry, continuity timeline, AI CTO recommendations and the AST Semantic Scope Lock. Actions: GET (default, read-only) · TOGGLE_SYMBOL_SCOPE (flip one symbol between IN_SCOPE and LOCKED, recalculation of CTO advisories included) · SET_SCOPE_LOCK (persist allowed/locked symbols + forbidden paths) · RESET_SCOPE_LOCK (clear and deterministically reseed).',
  {
    slug: z.string().min(1).describe('CortexOS project slug, e.g. "saas-crm"'),
    action: z.enum(['GET', 'TOGGLE_SYMBOL_SCOPE', 'SET_SCOPE_LOCK', 'RESET_SCOPE_LOCK']).optional().describe('State action (default "GET")'),
    fqn: z.string().min(1).max(400).optional().describe('TOGGLE_SYMBOL_SCOPE: fully-qualified symbol name (see graph ASTSymbol fqns)'),
    allowedSymbolFqns: z.array(z.string().min(1).max(400)).max(200).optional().describe('SET_SCOPE_LOCK: symbols the next agent may touch'),
    lockedSymbolFqns: z.array(z.string().min(1).max(400)).max(200).optional().describe('SET_SCOPE_LOCK: symbols placed under a hard lock (modifications are rejected by the daemon)'),
    forbiddenPaths: z.array(z.string().min(1).max(400)).max(100).optional().describe('SET_SCOPE_LOCK: paths the next agent must not modify'),
    includeXml: z.boolean().optional().describe('GET: also return the full injectable <cortex_sync_packet> XML (default false)'),
  },
  async ({ slug, action, fqn, allowedSymbolFqns, lockedSymbolFqns, forbiddenPaths, includeXml }) => {
    const verb = action ?? 'GET'

    if (verb === 'GET') {
      // Resolve the slug first so unknown projects yield the actionable
      // "Known slugs: …" error instead of a bare 404 (CLI UX parity with
      // every other cortex_* tool).
      const project = await resolveProject(slug)
      const state = await daemonFetch('GET', `/state?project=${encodeURIComponent(project.id)}`)
      return { content: [{ type: 'text', text: formatDashboardState(state, { includeXml: includeXml ?? false }) }] }
    }

    const project = await resolveProject(slug)
    if (verb === 'TOGGLE_SYMBOL_SCOPE' && !fqn) {
      throw new Error('TOGGLE_SYMBOL_SCOPE requires "fqn" — list ASTSymbol fqns via action GET first.')
    }
    if (verb === 'SET_SCOPE_LOCK' && !allowedSymbolFqns && !lockedSymbolFqns && !forbiddenPaths) {
      throw new Error('SET_SCOPE_LOCK requires at least one of allowedSymbolFqns / lockedSymbolFqns / forbiddenPaths.')
    }
    const state = await daemonFetch('POST', '/state', {
      projectId: project.id,
      action: verb,
      ...(verb === 'TOGGLE_SYMBOL_SCOPE' ? { fqn } : {}),
      ...(verb === 'SET_SCOPE_LOCK'
        ? {
            ...(allowedSymbolFqns ? { allowedSymbolFqns } : {}),
            ...(lockedSymbolFqns ? { lockedSymbolFqns } : {}),
            ...(forbiddenPaths ? { forbiddenPaths } : {}),
          }
        : {}),
    })

    const headlines = {
      TOGGLE_SYMBOL_SCOPE: `Toggled "${fqn}" — the daemon recomputed CTO advisories against the new scope.`,
      SET_SCOPE_LOCK: `Scope lock persisted (${(allowedSymbolFqns ?? state.scopeLock.allowedSymbolFqns).length} allowed · ${(lockedSymbolFqns ?? state.scopeLock.lockedSymbolFqns).length} locked · ${(forbiddenPaths ?? state.scopeLock.forbiddenPaths).length} forbidden paths). Staged modifications of locked symbols will now be rejected until RESET_SCOPE_LOCK.`,
      RESET_SCOPE_LOCK: 'Scope lock cleared and deterministically reseeded from the active task context.',
    }
    return {
      content: [{
        type: 'text',
        text: `${headlines[verb]}\n\n${formatDashboardState(state)}`,
      }],
    }
  },
)

server.tool(
  'cortex_cto',
  'Run the Phase 4 AI CTO from the CLI. Actions: AUDIT (default) — live workspace audit with prioritized recommendations (architecture drift, scope-lock hazards, complexity hotspots, token optimization) plus the project\'s DAG plan history · BUILD_DAG_PLAN — decompose a goal into a persisted Multi-Agent DAG of dependency-ordered waves · DISPATCH_PLAN — execute unblocked LOCAL subtasks through the real Phase 3 tool runner (0 cloud tokens) and emit scope-locked Tier-1 payloads for CLOUD subtasks · UPDATE_SUBTASK — confirm a cloud subtask outcome (unblocks dependent waves) · ARCHIVE_PLAN — retire a plan.',
  {
    slug: z.string().min(1).describe('CortexOS project slug'),
    action: z.enum(['AUDIT', 'BUILD_DAG_PLAN', 'DISPATCH_PLAN', 'UPDATE_SUBTASK', 'ARCHIVE_PLAN']).optional().describe('CTO action (default "AUDIT")'),
    force: z.boolean().optional().describe('AUDIT: bypass the workspace audit cache for a fresh scan (default false)'),
    goal: z.string().min(4).max(2000).optional().describe('BUILD_DAG_PLAN: the objective to decompose, e.g. "add Stripe billing with webhooks"'),
    allowedSymbolFqns: z.array(z.string().min(1).max(400)).max(50).optional().describe('BUILD_DAG_PLAN: restrict the plan\'s agents to these symbols'),
    recommendationId: z.string().min(1).max(120).optional().describe('BUILD_DAG_PLAN: CTO recommendation that triggered the plan (links them in audit meta)'),
    planId: z.string().min(1).optional().describe('DISPATCH_PLAN / UPDATE_SUBTASK / ARCHIVE_PLAN: the DAG plan id (see AUDIT plan list)'),
    subtaskId: z.string().min(1).optional().describe('UPDATE_SUBTASK: the subtask id to confirm'),
    status: z.enum(['completed', 'failed', 'skipped', 'pending']).optional().describe('UPDATE_SUBTASK: the outcome to record ("completed" unblocks dependents)'),
  },
  async ({ slug, action, force, goal, allowedSymbolFqns, recommendationId, planId, subtaskId, status }) => {
    const verb = action ?? 'AUDIT'

    if (verb === 'AUDIT') {
      const project = await resolveProject(slug)
      const payload = await daemonFetch('GET', `/cto?project=${encodeURIComponent(project.id)}${force ? '&force=true' : ''}`)
      return { content: [{ type: 'text', text: formatCtoAudit(payload) }] }
    }

    const project = await resolveProject(slug)

    if (verb === 'BUILD_DAG_PLAN') {
      if (!goal) {
        throw new Error('BUILD_DAG_PLAN requires "goal" — describe the objective to decompose.')
      }
      const { plan } = await daemonFetch('POST', '/cto', {
        projectId: project.id,
        action: 'BUILD_DAG_PLAN',
        goal,
        ...(allowedSymbolFqns ? { allowedSymbolFqns } : {}),
        triggeredBy: recommendationId ? 'cto-recommendation' : 'manual',
        ...(recommendationId ? { recommendationId } : {}),
      })
      return {
        content: [{
          type: 'text',
          text: `Plan built and persisted. Dispatch it with: action DISPATCH_PLAN, planId ${plan.id}\n\n${formatDagPlan(plan)}`,
        }],
      }
    }

    if (!planId) {
      throw new Error(`${verb} requires "planId" — list plans via action AUDIT.`)
    }

    if (verb === 'DISPATCH_PLAN') {
      const { plan } = await daemonFetch('POST', '/cto', { action: 'DISPATCH_PLAN', planId })
      return { content: [{ type: 'text', text: formatDispatch(plan) }] }
    }

    if (verb === 'UPDATE_SUBTASK') {
      if (!subtaskId || !status) {
        throw new Error('UPDATE_SUBTASK requires "subtaskId" and "status" (completed | failed | skipped | pending).')
      }
      const { plan } = await daemonFetch('POST', '/cto', { action: 'UPDATE_SUBTASK', planId, subtaskId, status })
      const settled = plan.subtasks.every((s) => ['completed', 'failed', 'skipped'].includes(s.status))
      return {
        content: [{
          type: 'text',
          text: `Subtask ${String(subtaskId).slice(0, 8)} recorded as ${status}. ${settled ? 'The plan is fully settled.' : 'Dependent waves are now unblocked — re-dispatch with action DISPATCH_PLAN.'}\n\n${formatDagPlan(plan)}`,
        }],
      }
    }

    // ARCHIVE_PLAN
    const { plan } = await daemonFetch('POST', '/cto', { action: 'ARCHIVE_PLAN', planId })
    return {
      content: [{
        type: 'text',
        text: `Plan ${String(plan.id).slice(0, 8)} archived — it no longer appears in the active plan list.\n\n${formatDagPlan(plan)}`,
      }],
    }
  },
)

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // MCP logging goes to stderr only — stdout is the protocol channel.
  console.error(`[cortexos-mcp] ready — daemon: ${DAEMON}`)
}

main().catch((error) => {
  console.error('[cortexos-mcp] fatal:', error)
  process.exit(1)
})
