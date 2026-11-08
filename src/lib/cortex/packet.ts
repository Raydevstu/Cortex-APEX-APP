/**
 * Compact State Packet — the "Zero-Token" cross-platform sync foundation
 * (blueprint §3). Instead of dumping a 5,000-word project summary into the
 * next platform (Hermes, OpenCode…), CortexOS emits a ~150–300 token
 * header plus on-demand query hooks. The full auto-injection (MCP server,
 * file watchers) lands in Phase 2 on top of this exact contract.
 */
import { db } from '@/lib/db'
import { estimateTokens } from './tokens'
import { parseDna } from './rewrite'
import type { StatePacket } from './types'

export async function buildStatePacket(projectIdOrSlug: string): Promise<StatePacket> {
  const include = {
    dna: true,
    memories: { orderBy: [{ createdAt: 'desc' as const }] },
    graphNodes: { where: { kind: { in: ['module', 'root'] } } },
  }
  const project =
    (await db.project.findUnique({ where: { id: projectIdOrSlug }, include })) ??
    (await db.project.findUnique({ where: { slug: projectIdOrSlug }, include }))
  if (!project) throw new Error('Project not found')

  const dna = project.dna ? parseDna(project.dna) : null
  const stack = dna ? dna.techStack.map((t) => t.technology) : []

  const decisions = project.memories
    .filter((m) => m.type === 'decision' || m.type === 'architecture')
    .slice(0, 3)
    .map((m) => `${m.key}: ${shorten(m.value, 56)}`)

  const openItems = project.memories
    .filter((m) => (m.type === 'todo' || m.type === 'bug') && m.status === 'active')
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 4)
    .map((m) => `[${m.type === 'bug' ? 'BUG' : 'TODO'}] ${shorten(m.value, 64)}`)

  const graphRoots = project.graphNodes
    .filter((n) => n.kind === 'module')
    .slice(0, 6)
    .map((n) => n.label)

  const stateHash = hashState({
    updatedAt: project.updatedAt.toISOString(),
    memories: project.memories.length,
    nodes: project.graphNodes.length,
  })

  const lines: string[] = []
  lines.push(
    `[CORTEX-OS SYNC | Project: ${project.name}${project.platform ? ` | Platform: ${project.platform}` : ''} | State: #${stateHash} | Updated: ${project.updatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC]`,
  )
  if (project.description) lines.push(`Mission: ${shorten(project.description, 110).replace(/\.+$/, '')}.`)
  lines.push(`Stack: ${stack.length > 0 ? stack.join(', ') : 'not yet profiled (generate Project DNA)'}.`)
  if (decisions.length > 0) {
    lines.push(`Decisions: ${decisions.join(' · ')}.`)
  }
  if (openItems.length > 0) {
    const bugCount = project.memories.filter((m) => m.type === 'bug' && m.status === 'active').length
    const todoCount = project.memories.filter((m) => m.type === 'todo' && m.status === 'active').length
    lines.push(`Open (${todoCount} TODOs, ${bugCount} bugs): ${openItems.join(' · ')}.`)
  }
  if (graphRoots.length > 0) {
    lines.push(`Modules: ${graphRoots.join(', ')}.`)
  }
  if (dna && dna.codingStandards.length > 0) {
    lines.push(`Standards: ${shorten(dna.codingStandards[0].rule, 70)}.`)
  }
  lines.push(
    'Deeper context on demand: query the Cortex daemon (GET /api/cortex/sync/{slug}) instead of re-reading the codebase.',
  )

  const markdown = lines.join('\n')

  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      platform: project.platform,
    },
    stateHash,
    updatedAt: project.updatedAt.toISOString(),
    stack,
    latestDecisions: decisions,
    openItems,
    graphRoots,
    markdown,
    tokens: estimateTokens(markdown),
  }
}

function hashState(input: Record<string, unknown>): string {
  const raw = JSON.stringify(input)
  let hash = 0x811c9dc5
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 6)
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max)}…`
}
