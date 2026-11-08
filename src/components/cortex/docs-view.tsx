'use client'

/**
 * Integration Docs — the auditable contract of the Phase 1 + 2 + 3 daemon:
 * architecture mapping to the blueprint, full API reference, the Master
 * System Prompts, cross-platform integration guides (MCP / git hook /
 * extension / watcher) and the phase roadmap.
 */
import {
  Brain, GitBranch, Sparkles, Database, Server, ArrowRight, ScrollText,
  Radar, Plug, History as HistoryIcon, Chrome, Terminal, ArrowRightLeft,
  Bot, Wrench, Package, ShieldCheck,
} from 'lucide-react'
import { SectionCard, CopyButton } from './shared'

const API_REFERENCE: Array<{ method: string; path: string; purpose: string }> = [
  { method: 'GET', path: '/api/cortex/health', purpose: 'Daemon heartbeat — database, Ollama status, entity counts' },
  { method: 'GET', path: '/api/cortex/metrics', purpose: 'Dashboard aggregates + sync stats + 14-day token savings series' },
  { method: 'GET', path: '/api/cortex/projects', purpose: 'List project brains with live counts' },
  { method: 'POST', path: '/api/cortex/projects', purpose: 'Create a project (root graph node seeded)' },
  { method: 'GET', path: '/api/cortex/projects/{id}', purpose: 'Project detail incl. full DNA document' },
  { method: 'PATCH', path: '/api/cortex/projects/{id}', purpose: 'Update project metadata / workspace path' },
  { method: 'DELETE', path: '/api/cortex/projects/{id}', purpose: 'Delete project (cascades all state)' },
  { method: 'GET', path: '/api/cortex/projects/{id}/dna', purpose: 'Fetch the PROJECT DNA' },
  { method: 'POST', path: '/api/cortex/projects/{id}/dna', purpose: 'Regenerate DNA from a workspace scan {mode:"scan", rootPath}' },
  { method: 'PATCH', path: '/api/cortex/projects/{id}/dna', purpose: 'Curate DNA sections (rules, patterns, standards)' },
  { method: 'GET', path: '/api/cortex/projects/{id}/timeline', purpose: 'Development timeline events' },
  { method: 'GET', path: '/api/cortex/memories?projectId=&type=&status=&q=', purpose: 'Filtered memory list' },
  { method: 'POST', path: '/api/cortex/memories', purpose: 'Write a typed memory (manual / API / MCP cortex_log_decision)' },
  { method: 'PATCH', path: '/api/cortex/memories/{id}', purpose: 'Resolve/reopen, re-weight a memory' },
  { method: 'DELETE', path: '/api/cortex/memories/{id}', purpose: 'Delete a memory' },
  { method: 'GET', path: '/api/cortex/interactions?projectId=', purpose: 'Episodic interaction log' },
  { method: 'POST', path: '/api/cortex/interactions', purpose: 'Capture a transcript → memory extraction + graph linking + episodic indexing' },
  { method: 'GET', path: '/api/cortex/graph?projectId=[&nodeId=|&context=]', purpose: 'Full graph, node neighbourhood, or prompt-matched subgraph' },
  { method: 'POST', path: '/api/cortex/graph', purpose: 'Add a node or a triple {op:"add_node"|"add_edge"}' },
  { method: 'DELETE', path: '/api/cortex/graph?projectId=&nodeId=', purpose: 'Remove a node (edges cascade)' },
  { method: 'POST', path: '/api/cortex/rewrite', purpose: 'THE FLAGSHIP — Tier-1 prompt rewrite {projectId, prompt, engine}' },
  { method: 'GET', path: '/api/cortex/rewrite?projectId=', purpose: 'Prompt session history' },
  { method: 'GET', path: '/api/cortex/sync/{slug}[?target=&module=]', purpose: 'CrossPlatformSyncPacket preview (no handoff recorded)' },
  { method: 'POST', path: '/api/cortex/sync/{slug}', purpose: 'PHASE 2 — Execute handoff {targetPlatform} → packet + SyncHandoff + timeline' },
  { method: 'GET', path: '/api/cortex/sync/{slug}/handoffs', purpose: 'Handoff audit trail (platform pair, state hash, tokens)' },
  { method: 'POST', path: '/api/cortex/search', purpose: 'PHASE 2 — Semantic episodic search {slug|projectId, query, k}' },
  { method: 'GET', path: '/api/cortex/watch[?projectId=]', purpose: 'PHASE 2 — File watcher live status' },
  { method: 'POST', path: '/api/cortex/watch', purpose: 'PHASE 2 — Start/stop a watcher {projectId, action, persist}' },
  { method: 'POST', path: '/api/cortex/hooks/git', purpose: 'PHASE 2 — Git post-commit webhook {slug, commits[]}' },
  { method: 'POST', path: '/api/cortex/git/ingest', purpose: 'PHASE 2 — Incremental git log backfill {projectId|slug}' },
  { method: 'GET', path: '/api/cortex/git?projectId=', purpose: 'PHASE 2 — Ingested commit log' },
  { method: 'GET', path: '/api/cortex/settings', purpose: 'Daemon settings (Ollama models, default engine, SearXNG)' },
  { method: 'PUT', path: '/api/cortex/settings', purpose: 'Update daemon settings' },
  { method: 'POST', path: '/api/cortex/settings/test', purpose: 'Probe the Ollama endpoint' },
  { method: 'POST', path: '/api/cortex/seed', purpose: 'Idempotent SaaS-CRM demo seed' },
  { method: 'POST', path: '/api/cortex/preexecute', purpose: 'PHASE 3 — Pre-Execution Local Agent {projectId, prompt, targetPlatform, module, useLlm}' },
  { method: 'GET', path: '/api/cortex/preexecute?projectId=', purpose: 'PHASE 3 — Agent run history' },
  { method: 'GET', path: '/api/cortex/preexecute/staged?projectId=&status=', purpose: 'PHASE 3 — Staged artifact queue (content included)' },
  { method: 'GET', path: '/api/cortex/preexecute/staged/{id}', purpose: 'PHASE 3 — One staged artifact' },
  { method: 'POST', path: '/api/cortex/preexecute/staged/{id}', purpose: 'PHASE 3 — Staging lifecycle {action: apply|discard|revert} — scope-guard validated' },
  { method: 'POST', path: '/api/cortex/extract', purpose: 'PHASE 3 — Engine 3 memory extractor {sourcePlatform, rawUserPrompt, aiResponseText, modifiedFilesAstDiff}' },
  { method: 'GET', path: '/api/cortex/assets', purpose: 'PHASE 3 — Blueprint asset inventory (prompts, JSON grammars, docs cache)' },
]

const MASTER_PROMPT_SNIPPET = `You are CORTEX-OS TIER-1 PROMPT ENGINEER — the prompt engineering and task
decomposition engine of CortexOS, the persistent brain for AI-assisted development.

MISSION
Transform the developer's raw prompt into one Tier-1 enterprise-grade structured
prompt that will be sent to a senior coding AI (Codex, Claude, GPT, Hermes)…

RULES (abridged)
1. PRESERVE INTENT — never invent scope, never drop a requirement.
2. STRUCTURE — [CORTEX-OS SYNC] header, then Context, Tech Stack, Known State,
   Open Items, Requirements, Constraints, Deliverables, Out of Scope.
3. REQUIREMENTS — atomic, numbered, verifiable.
4. CONSTRAINTS — quote the injected coding standards and business rules.
5. KNOWN STATE — symbolic pointers like "(Payments) —[USES]→ (Stripe)"; never
   dump raw code.
6. ECONOMY — keep the final prompt under ~900 tokens unless decomposition
   demands more.
7. FIDELITY TO DATA — use ONLY the provided DNA, memories and graph pointers.
8. OUTPUT — only the final prompt inside one markdown code block.`

const MCP_TOOLS: Array<{ tool: string; purpose: string }> = [
  { tool: 'cortex_sync', purpose: 'CrossPlatformSyncPacket on session start / platform switch (records the handoff)' },
  { tool: 'cortex_get_dna', purpose: 'Full PROJECT DNA — read before generating any code' },
  { tool: 'cortex_log_decision', purpose: 'Persist decisions/bugs/todos so nothing is ever lost' },
  { tool: 'cortex_rewrite', purpose: 'Tier-1 prompt rewrite (fast | deep | cloud)' },
  { tool: 'cortex_search_history', purpose: 'Semantic episodic search over past interactions' },
  { tool: 'cortex_capture_interaction', purpose: 'Memory extraction from a raw chat transcript' },
  { tool: 'cortex_preexecute', purpose: 'PHASE 3 — run the Pre-Execution Local Agent (triage → local tools → staged scaffolds → Tier-1 payload)' },
  { tool: 'cortex_extract_memory', purpose: 'PHASE 3 — Engine 3 turn analysis → ExtractedMemoryDelta (supersedes, task transitions, bugs)' },
]

const CLAUDE_CONFIG = `{
  "mcpServers": {
    "cortexos": {
      "command": "node",
      "args": ["/absolute/path/to/CortexOS/mcp-server/index.mjs"],
      "env": { "CORTEX_DAEMON_URL": "http://localhost:3000" }
    }
  }
}`

const CODEX_CONFIG = `[mcp_servers.cortexos]
command = "node"
args = ["/absolute/path/to/CortexOS/mcp-server/index.mjs"]
env = { CORTEX_DAEMON_URL = "http://localhost:3000" }`

export function DocsView() {
  return (
    <div className="space-y-6">
      {/* Phase 3 architecture */}
      <SectionCard title="Phase 3 architecture — the Pre-Execution Local Agent & Token Optimizer">
        <div className="grid gap-3 md:grid-cols-3">
          <ArchCard
            icon={<Bot className="size-4" />}
            title="Engine 1 — Pre-Execution Router — NEW"
            lines={[
              'Ollama structured outputs (format: jsonSchema, qwen2.5:1.5b) under the blueprint RouterDecisionSchema',
              'Deterministic Fast-Path triage (<800ms) when local models are offline',
              'Execution modes: LOCAL_ONLY · HYBRID_PRE_EXECUTE · CLOUD_DIRECT_WITH_DNA',
            ]}
          />
          <ArchCard
            icon={<Wrench className="size-4" />}
            title="Local Tool Runner (0 cloud tokens) — NEW"
            lines={[
              'ast_symbol_lookup: real symbol/line/import tables from your workspace files',
              'schema_inspect · local_docs_search (cached SDK docs + optional SearXNG) · git_diff_summary (real git)',
              'scaffold_boilerplate: Zod schemas, TS types, route stubs, .env.example keys — derived from your real Prisma schema',
            ]}
          />
          <ArchCard
            icon={<Sparkles className="size-4" />}
            title="Engine 2 — Tier-1 Injection — NEW"
            lines={[
              'Blueprint-exact payload: [CORTEX-OS SYNC] · [PRE-EXECUTED BY CORTEX LOCAL AGENT — DO NOT REGENERATE] · [AST SCOPE GUARD & ARCHITECTURE LOCK] · [CORE EXECUTION SPECIFICATION]',
              'decomposedSubtasks with handledBy: COMPLETED_BY_LOCAL_OLLAMA vs ASSIGNED_TO_MAIN_AI',
              'Ollama Tier1RewrittenPromptSchema grammar with deterministic assembler fallback',
            ]}
          />
          <ArchCard
            icon={<Package className="size-4" />}
            title="Staging Area — NEW"
            lines={[
              'Scaffolds are NEVER written to your workspace directly — they wait in `staged` state',
              'Apply enforces the AST Scope Guard: inside root, protected paths refused, create never clobbers',
              'One-click revert (previous content captured) · .env.example merges only missing keys',
            ]}
          />
          <ArchCard
            icon={<Brain className="size-4" />}
            title="Engine 3 — Memory Extractor — NEW"
            lines={[
              'Background hook per AI turn: prompt + response + AST diff → ExtractedMemoryDelta',
              'Supersede detection: course changes mark old decisions superseded (SUPERSEDES graph edge)',
              'Task continuity (completed only when the diff proves it) + bug discovery/resolution + preferences',
            ]}
          />
          <ArchCard
            icon={<ShieldCheck className="size-4" />}
            title="Token Optimizer — NEW"
            lines={[
              'Grounded savings: real artifact tokens + staged boilerplate + context the cloud never re-reads',
              'LOCAL_ONLY tasks cost 0 cloud tokens — the agent finishes them alone',
              'Sync packet continuity now carries preExecutedByLocalAgent with real completed work',
            ]}
          />
        </div>
        <pre className="mt-4 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background/50 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
{`# The Phase 3 flagship, against a real workspace:
curl -X POST localhost:3000/api/cortex/preexecute \\
  -H 'Content-Type: application/json' \\
  -d '{"projectId":"<id>","prompt":"add stripe webhook for subscription renewal and update user db"}'

# → router: HYBRID_PRE_EXECUTE · 7 local tool steps · 3 files staged
# → injected payload carries verified AST signatures + schema fields + SDK syntax

# Engine 3, after Codex finishes the turn:
curl -X POST localhost:3000/api/cortex/extract \\
  -H 'Content-Type: application/json' \\
  -d '{"projectId":"<id>","sourcePlatform":"codex","rawUserPrompt":"...","aiResponseText":"...", "modifiedFilesAstDiff":[{"path":"src/app/api/webhooks/stripe/route.ts","addedSymbols":["POST"],"modifiedSymbols":[]}]}'`}
        </pre>
      </SectionCard>

      {/* Phase 2 architecture */}
      <SectionCard title="Phase 2 architecture — the Cross-Platform Sync Engine">
        <div className="grid gap-3 md:grid-cols-3">
          <ArchCard
            icon={<Brain className="size-4" />}
            title="Memory Engine (Pillar 1)"
            lines={[
              'Deterministic extraction of decisions / requirements / TODOs / bugs / preferences',
              'Dedupe against the project memory store',
              'Episodic vector store: every turn embedded for semantic recall',
            ]}
          />
          <ArchCard
            icon={<GitBranch className="size-4" />}
            title="Knowledge Graph (Pillar 2)"
            lines={[
              'SQLite-backed property graph: (source) —[RELATION]→ (target)',
              'File watcher + git hook write file/module triples automatically',
              'Context-matched subgraphs → symbolic pointers (zero-token context)',
            ]}
          />
          <ArchCard
            icon={<Sparkles className="size-4" />}
            title="Prompt Rewriter (Pillar 5 + 6)"
            lines={[
              'Fast-Path: deterministic Tier-1 assembly in <50ms',
              'Deep-Path: Ollama refinement under the Master System Prompt',
              'Task decomposition into a dependency-ordered subtask graph',
            ]}
          />
          <ArchCard
            icon={<ArrowRightLeft className="size-4" />}
            title="Cross-Platform Sync (Pillar 3) — NEW"
            lines={[
              'Full CrossPlatformSyncPacket: header, DNA snapshot, scoped graph context, continuity',
              'Handoff audit trail (platform pair, state hash, token count)',
              'Delta, not dump: state hash lets platforms skip no-op re-ingestion',
            ]}
          />
          <ArchCard
            icon={<Radar className="size-4" />}
            title="File Watcher + Git Intelligence — NEW"
            lines={[
              'Chokidar watcher: saves become file nodes, module edges, timeline events',
              'Post-commit hook + git log backfill: commits land in the brain',
              'Deterministic bug auto-resolution on fix commits',
            ]}
          />
          <ArchCard
            icon={<HistoryIcon className="size-4" />}
            title="Episodic Vector Store — NEW"
            lines={[
              'Turn summaries (~60 tokens) embedded per blueprint SessionTurnNode',
              'Ollama embeddings with deterministic local hashed fallback (offline-safe)',
              'Cosine semantic search blended with keyword memory matches',
            ]}
          />
          <ArchCard
            icon={<Plug className="size-4" />}
            title="MCP Server (hook #1) — NEW"
            lines={[
              'Real stdio MCP server: 6 tools, blueprint-exact names',
              'Codex, OpenCode, Cursor, Windsurf, Claude, Hermes configs below',
              'Session start pulls state; decisions flow back — full loop',
            ]}
          />
          <ArchCard
            icon={<Chrome className="size-4" />}
            title="Browser Extension (hook #3) — NEW"
            lines={[
              'MV3 extension: Tier-1 rewrite + packet injection on any web chat',
              'Global hotkeys Ctrl/Cmd+Shift+Space and Ctrl/Cmd+Shift+V',
              'Works on ChatGPT, Claude, Gemini, Bolt, v0 — everywhere',
            ]}
          />
          <ArchCard
            icon={<Server className="size-4" />}
            title="cortexd daemon API"
            lines={[
              '31 REST endpoints (see reference below) on the local server',
              'Zod-validated with uniform error envelopes',
              'Watchers auto-start on daemon boot (instrumentation hook)',
            ]}
          />
        </div>
      </SectionCard>

      {/* MCP integration */}
      <SectionCard
        title="Connect your platforms — MCP server (universal hook #1)"
        action={<CopyButton text={CLAUDE_CONFIG} label="Copy Claude config" />}
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            The MCP server (<span className="font-mono">mcp-server/index.mjs</span>) speaks stdio and
            proxies the daemon brain. Point any MCP-capable platform at it — config snippets for the
            big five below. Full guide in <span className="font-mono">mcp-server/README.md</span>.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Tool</th>
                  <th className="pb-2 font-medium">Purpose</th>
                </tr>
              </thead>
              <tbody>
                {MCP_TOOLS.map((row) => (
                  <tr key={row.tool} className="border-b border-border/30 last:border-0">
                    <td className="py-2 pr-4 font-mono text-[11px] text-primary">{row.tool}</td>
                    <td className="py-2 text-muted-foreground">{row.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-background/50">
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                <span className="font-mono text-[10.5px] text-muted-foreground">Claude Desktop · claude_desktop_config.json</span>
                <CopyButton text={CLAUDE_CONFIG} label="Copy" />
              </div>
              <pre className="overflow-x-auto p-3 font-mono text-[10.5px] leading-relaxed">{CLAUDE_CONFIG}</pre>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/50">
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                <span className="font-mono text-[10.5px] text-muted-foreground">Codex CLI · ~/.codex/config.toml</span>
                <CopyButton text={CODEX_CONFIG} label="Copy" />
              </div>
              <pre className="overflow-x-auto p-3 font-mono text-[10.5px] leading-relaxed">{CODEX_CONFIG}</pre>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Cursor (<span className="font-mono">.cursor/mcp.json</span>), Windsurf
            (<span className="font-mono">~/.codeium/windsurf/mcp_config.json</span>) and OpenCode use the same
            command/args shape — see <span className="font-mono">mcp-server/README.md</span>. Verify with{' '}
            <span className="font-mono">npm run mcp</span> then paste the JSON-RPC handshake from the README.
          </p>
        </div>
      </SectionCard>

      {/* Git hook */}
      <SectionCard title="Connect your repo — git post-commit hook">
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            One command wires a repository into the brain: every commit becomes a timeline event,
            refreshes Knowledge Graph file nodes, and <span className="font-mono">fix:</span> commits
            auto-resolve matching open bugs. The hook never blocks a commit (5s timeout, errors swallowed).
          </p>
          <div className="rounded-lg border border-border/60 bg-background/50">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                <Terminal className="size-3" /> from the CortexOS repo root
              </span>
              <CopyButton
                text="node scripts/cortex-git-hook.mjs install --repo /path/to/your/repo --slug saas-crm --platform codex"
                label="Copy"
              />
            </div>
            <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed">
{`node scripts/cortex-git-hook.mjs install --repo /path/to/your/repo --slug saas-crm --platform codex
# uninstall:  node scripts/cortex-git-hook.mjs uninstall --repo /path/to/your/repo
# no hook? use the incremental backfill instead:
curl -X POST ${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/api/cortex/git/ingest \\
  -H 'Content-Type: application/json' -d '{"slug":"saas-crm"}'`}
            </pre>
          </div>
        </div>
      </SectionCard>

      {/* Extension */}
      <SectionCard title="Connect your browser — the extension (universal hook #3)">
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            The MV3 extension rewrites any chat input into a Tier-1 prompt and injects sync packets on
            any web AI. Load it unpacked from the <span className="font-mono">extension/</span> folder
            (or the zip in the project downloads), set the daemon URL in its settings, then:
          </p>
          <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <li><span className="font-mono text-foreground">Ctrl/Cmd+Shift+Space</span> — rewrite the focused chat input in place (global hotkey)</li>
            <li><span className="font-mono text-foreground">Ctrl/Cmd+Shift+V</span> — inject the cross-platform sync packet (executes a real handoff)</li>
            <li>Popup — daemon status, project/engine picker, copy packet, capture clipboard as interaction</li>
            <li>Try the live browser E2E of the real extension code: <a className="text-primary underline underline-offset-2" href="/cortex-extension-test.html" target="_blank" rel="noreferrer">/cortex-extension-test.html</a></li>
          </ul>
        </div>
      </SectionCard>

      {/* API reference */}
      <SectionCard
        title="Daemon API reference"
        action={<CopyButton text={API_REFERENCE.map((r) => `${r.method.padEnd(6)} ${r.path}  # ${r.purpose}`).join('\n')} label="Copy reference" />}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Method</th>
                <th className="pb-2 pr-4 font-medium">Endpoint</th>
                <th className="pb-2 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {API_REFERENCE.map((row, i) => (
                <tr key={i} className="border-b border-border/30 last:border-0">
                  <td className="py-2 pr-4">
                    <span
                      className={
                        row.method.startsWith('GET') ? 'font-mono text-[10px] text-emerald-500'
                        : row.method.startsWith('POST') ? 'font-mono text-[10px] text-primary'
                        : row.method.startsWith('DELETE') ? 'font-mono text-[10px] text-rose-400'
                        : row.method.startsWith('PATCH') ? 'font-mono text-[10px] text-amber-500'
                        : row.method.startsWith('PUT') ? 'font-mono text-[10px] text-teal-400'
                        : 'font-mono text-[10px] text-teal-400'
                      }
                    >
                      {row.method}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-[11px]">{row.path}</td>
                  <td className="py-2 text-muted-foreground">{row.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 rounded-lg border border-border/60 bg-background/50 p-3">
          <p className="font-mono text-[11px] text-muted-foreground"># The Phase 2 flagship, in one line:</p>
          <pre className="mt-1.5 overflow-x-auto font-mono text-[11px] leading-relaxed">
{`curl -X POST ${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/api/cortex/sync/saas-crm \\
  -H 'Content-Type: application/json' \\
  -d '{"targetPlatform":"hermes"}'`}
          </pre>
        </div>
      </SectionCard>

      {/* Master prompt */}
      <SectionCard
        title="Master System Prompt — Tier-1 engine (auditable)"
        action={<CopyButton text={MASTER_PROMPT_SNIPPET} label="Copy abridged" />}
      >
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background/50 p-4 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
          {MASTER_PROMPT_SNIPPET}
        </pre>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The full prompt lives in <span className="font-mono">src/lib/cortex/master-prompt.ts</span> and drives
          both the Deep-Path (Ollama) and Cloud (GLM) refinement passes — no hidden instructions.
        </p>
      </SectionCard>

      {/* Roadmap */}
      <SectionCard title="Phased execution roadmap (Core Blueprint v2)">
        <ol className="space-y-3">
          <RoadmapItem
            status="done"
            title="Phase 1 — The Brain & Prompt Interceptor"
            items={[
              'Local daemon API + SQLite Knowledge Graph + Project DNA generator',
              'Tier-1 Prompt Rewriter (Fast-Path deterministic + Deep-Path Ollama + Cloud GLM)',
              'Memory Engine, Development Timeline, Token Savings accounting, Command Center UI',
            ]}
          />
          <RoadmapItem
            status="done"
            title="Phase 2 — Cross-Platform Sync Engine"
            items={[
              'Full CrossPlatformSyncPacket + handoff audit trail + platform flip',
              'MCP server (6 tools) for Codex / OpenCode / Cursor / Windsurf / Claude / Hermes',
              'File watcher (auto-start) + git post-commit hook + git log backfill + bug auto-resolution',
              'Episodic vector store with semantic search; MV3 browser extension with global hotkeys',
            ]}
          />
          <RoadmapItem
            status="done"
            title="Phase 3 — Pre-Execution Local Agent & Token Optimizer (this build)"
            items={[
              'Engine 1 router + Engine 2 Tier-1 composer under Ollama structured outputs, deterministic Fast-Path fallbacks',
              'Local tool runner: AST lookup, Prisma schema inspect, cached SDK docs, git diff, staged scaffolds',
              'Scope-guard-validated staging lifecycle (apply / discard / revert) — the agent never blind-writes',
              'Engine 3 memory extractor with supersede detection, task continuity and bug resolution',
            ]}
          />
          <RoadmapItem
            status="next"
            title="Phase 4 — Visual Command Center & AI CTO Mode"
            items={[
              'Full visual Knowledge Graph explorer, Development Timeline UI, Token Savings Dashboard',
              'AI CTO recommendations from roadmap + codebase + bugs + business goals',
            ]}
          />
        </ol>
      </SectionCard>
    </div>
  )
}

function ArchCard({ icon, title, lines }: { icon: React.ReactNode; title: string; lines: string[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-primary">{icon}</span> {title}
      </p>
      <ul className="mt-2 space-y-1.5">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" /> {line}
          </li>
        ))}
      </ul>
    </div>
  )
}

function RoadmapItem({ status, title, items }: { status: 'done' | 'next'; title: string; items: string[] }) {
  return (
    <li className={`rounded-lg border p-4 ${status === 'done' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/60 bg-background/40'}`}>
      <p className="flex items-center gap-2 text-sm font-semibold">
        <span className={`flex size-5 items-center justify-center rounded-full ${status === 'done' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
          {status === 'done' ? <ScrollText className="size-3" /> : <ArrowRight className="size-3" />}
        </span>
        {title}
      </p>
      <ul className="mt-2 space-y-1 pl-7">
        {items.map((item) => (
          <li key={item} className="text-[11px] leading-snug text-muted-foreground">— {item}</li>
        ))}
      </ul>
    </li>
  )
}
