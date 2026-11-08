'use client'

/**
 * Integration Docs — the auditable contract of the Phase 1 daemon:
 * architecture mapping to the blueprint, full API reference, the Master
 * System Prompt and the phase roadmap.
 */
import { Brain, GitBranch, Sparkles, Database, Server, ArrowRight, ScrollText } from 'lucide-react'
import { SectionCard, CopyButton } from './shared'

const API_REFERENCE: Array<{ method: string; path: string; purpose: string }> = [
  { method: 'GET', path: '/api/cortex/health', purpose: 'Daemon heartbeat — database, Ollama status, entity counts' },
  { method: 'GET', path: '/api/cortex/metrics', purpose: 'Dashboard aggregates + 14-day token savings series' },
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
  { method: 'POST', path: '/api/cortex/memories', purpose: 'Write a typed memory (manual / API / future MCP)' },
  { method: 'PATCH', path: '/api/cortex/memories/{id}', purpose: 'Resolve/reopen, re-weight a memory' },
  { method: 'DELETE', path: '/api/cortex/memories/{id}', purpose: 'Delete a memory' },
  { method: 'GET', path: '/api/cortex/interactions?projectId=', purpose: 'Episodic interaction log' },
  { method: 'POST', path: '/api/cortex/interactions', purpose: 'Capture a raw chat transcript → memory extraction + graph linking' },
  { method: 'GET', path: '/api/cortex/graph?projectId=[&nodeId=|&context=]', purpose: 'Full graph, node neighbourhood, or prompt-matched subgraph' },
  { method: 'POST', path: '/api/cortex/graph', purpose: 'Add a node or a triple {op:"add_node"|"add_edge"}' },
  { method: 'DELETE', path: '/api/cortex/graph?projectId=&nodeId=', purpose: 'Remove a node (edges cascade)' },
  { method: 'POST', path: '/api/cortex/rewrite', purpose: 'THE FLAGSHIP — Tier-1 prompt rewrite {projectId, prompt, engine}' },
  { method: 'GET', path: '/api/cortex/rewrite?projectId=', purpose: 'Prompt session history' },
  { method: 'GET', path: '/api/cortex/sync/{slug}', purpose: 'Compact State Packet (cross-platform sync contract)' },
  { method: 'GET/PUT', path: '/api/cortex/settings', purpose: 'Daemon settings (Ollama endpoint, default engine)' },
  { method: 'POST', path: '/api/cortex/settings/test', purpose: 'Probe the Ollama endpoint' },
  { method: 'POST', path: '/api/cortex/seed', purpose: 'Idempotent SaaS-CRM demo seed' },
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

export function DocsView() {
  return (
    <div className="space-y-6">
      {/* Architecture */}
      <SectionCard title="Phase 1 architecture — how the blueprint maps to this build">
        <div className="grid gap-3 md:grid-cols-3">
          <ArchCard
            icon={<Brain className="size-4" />}
            title="Memory Engine (Pillar 1)"
            lines={[
              'Deterministic extraction of decisions / requirements / TODOs / bugs / preferences',
              'Dedupe against the project memory store',
              'Raw transcripts persisted as episodic interactions',
            ]}
          />
          <ArchCard
            icon={<GitBranch className="size-4" />}
            title="Knowledge Graph (Pillar 2)"
            lines={[
              'SQLite-backed property graph: (source) —[RELATION]→ (target)',
              'DNA scans and memory captures write triples automatically',
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
            icon={<Database className="size-4" />}
            title="PROJECT DNA"
            lines={[
              'Workspace scan → tech stack with evidence, standards, patterns',
              'Deterministic code map: imports / exports / functions per file',
              'Requirement memories fold in as business rules (hybrid DNA)',
            ]}
          />
          <ArchCard
            icon={<Server className="size-4" />}
            title="cortexd daemon API"
            lines={[
              '14 REST endpoints (see reference below) on the local server',
              'Compact State Packet endpoint is the Phase 2 sync contract',
              'MCP server (cortex_sync, cortex_get_dna, cortex_log_decision) lands in Phase 2',
            ]}
          />
          <ArchCard
            icon={<ScrollText className="size-4" />}
            title="Token Savings (Pillar 8)"
            lines={[
              'Naive-context vs compact-context accounting per rewrite',
              'Smart routing recommendation: fast-path / local-agent / main-model',
              '14-day savings series on the dashboard',
            ]}
          />
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
          <p className="font-mono text-[11px] text-muted-foreground"># The flagship, in one line:</p>
          <pre className="mt-1.5 overflow-x-auto font-mono text-[11px] leading-relaxed">
{`curl -X POST ${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/api/cortex/rewrite \\
  -H 'Content-Type: application/json' \\
  -d '{"projectId":"<id>","prompt":"add stripe webhook for subscription renewal and update user db","engine":"fast"}'`}
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
            title="Phase 1 — The Brain & Prompt Interceptor (this build)"
            items={[
              'Local daemon API + SQLite Knowledge Graph + Project DNA generator',
              'Tier-1 Prompt Rewriter (Fast-Path deterministic + Deep-Path Ollama + Cloud GLM)',
              'Memory Engine, Development Timeline, Token Savings accounting, Command Center UI',
            ]}
          />
          <RoadmapItem
            status="next"
            title="Phase 2 — Cross-Platform Sync Engine"
            items={[
              'MCP server (cortex_sync, cortex_get_dna, cortex_log_decision) for Codex / OpenCode / Cursor / Claude',
              'File watcher + Git hooks: work done in any tool auto-updates the Knowledge Graph',
              'State packet auto-injection when switching platforms (delta-sync on the hash shown in the Sync tab)',
            ]}
          />
          <RoadmapItem
            status="next"
            title="Phase 3 — Pre-Execution Local Agent & Token Optimizer"
            items={[
              'Local Ollama agents with tool execution (file read/write, web search, terminal)',
              'Smart Router completes boilerplate/research locally, sends only the core delta to the main model',
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
