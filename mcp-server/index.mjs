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
// Server + tools
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'cortexos',
  version: '0.3.0',
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
