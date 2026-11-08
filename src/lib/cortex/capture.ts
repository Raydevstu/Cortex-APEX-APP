/**
 * Memory capture service — wires the Universal AI Memory Engine into the
 * daemon: logs the raw interaction, extracts typed memories (deduped),
 * links mentioned tech into the Knowledge Graph, and records a timeline
 * event. This is the write path of "User → CortexOS → <any AI platform>".
 */
import { db } from '@/lib/db'
import { extractMemories, mentionedTech } from './extract'
import { upsertNode, upsertEdge } from './graph'
import type { ExtractedMemory } from './types'

export interface CaptureResult {
  interactionId: string
  extracted: Array<ExtractedMemory & { id: string; deduped: boolean }>
  techLinked: string[]
}

export async function captureInteraction(input: {
  projectId: string
  text: string
  title?: string
  platform?: string
}): Promise<CaptureResult> {
  const project = await db.project.findUnique({ where: { id: input.projectId } })
  if (!project) throw new Error('Project not found')

  const text = input.text.trim()
  if (text.length < 5) throw new Error('Interaction text is empty')

  // 1. Deterministic extraction
  const candidates = extractMemories(text)

  // 2. Dedupe against existing memories for this project
  const existing = await db.memory.findMany({ where: { projectId: project.id } })
  const existingKeys = new Set(existing.map((m) => `${m.type}::${m.key.toLowerCase()}`))

  const fresh: Array<ExtractedMemory & { deduped: boolean }> = []
  const created: Array<ExtractedMemory & { id: string; deduped: boolean }> = []

  for (const candidate of candidates) {
    const key = `${candidate.type}::${candidate.key.toLowerCase()}`
    if (existingKeys.has(key) || fresh.some((f) => `${f.type}::${f.key.toLowerCase()}` === key)) {
      fresh.push({ ...candidate, deduped: true })
      continue
    }
    const record = await db.memory.create({
      data: {
        projectId: project.id,
        type: candidate.type,
        key: candidate.key,
        value: candidate.value,
        importance: candidate.importance,
        source: 'interaction',
      },
    })
    fresh.push({ ...candidate, deduped: false })
    created.push({ ...candidate, id: record.id, deduped: false })
  }

  // 3. Persist the raw interaction (episodic memory source)
  const interaction = await db.interaction.create({
    data: {
      projectId: project.id,
      title: input.title ?? null,
      platform: input.platform ?? null,
      rawText: text.slice(0, 20_000),
      memoriesExtracted: created.length,
    },
  })

  // 4. Link mentioned tech into the Knowledge Graph
  const techLinked: string[] = []
  const rootId = await upsertNode(project.id, 'root', project.name, { role: 'project-root' })
  for (const tech of mentionedTech(text)) {
    const techId = await upsertNode(project.id, 'tech', tech, { source: 'interaction' })
    await upsertEdge(project.id, rootId, techId, 'USES')
    techLinked.push(tech)
  }

  // 5. Bug memories become graph bug nodes blocking their module when the
  //    module is inferable from the memory text.
  for (const memory of created.filter((m) => m.type === 'bug')) {
    const bugLabel = `Bug: ${memory.key}`.slice(0, 60)
    const bugId = await upsertNode(project.id, 'bug', bugLabel, {
      memoryId: memory.id,
      severity: memory.importance,
    })
    const moduleMatch = matchModule(memory.value)
    if (moduleMatch) {
      const moduleId = await upsertNode(project.id, 'module', moduleMatch, { source: 'interaction' })
      await upsertEdge(project.id, moduleId, bugId, 'HAS_BUG')
    }
  }

  // 6. Timeline
  await db.timelineEvent.create({
    data: {
      projectId: project.id,
      kind: 'interaction.logged',
      message: `Interaction captured${input.platform ? ` from ${input.platform}` : ''}: ${created.length} new memor${created.length === 1 ? 'y' : 'ies'} extracted, ${techLinked.length} tech linked.`,
      meta: JSON.stringify({ interactionId: interaction.id }),
    },
  })

  return { interactionId: interaction.id, extracted: fresh, techLinked }
}

const MODULE_HINTS = [
  'checkout', 'auth', 'payments', 'billing', 'dashboard', 'api', 'frontend',
  'backend', 'database', 'webhooks', 'profile', 'settings', 'search', 'notifications',
]

function matchModule(text: string): string | null {
  const lower = text.toLowerCase()
  for (const hint of MODULE_HINTS) {
    if (lower.includes(hint)) {
      return hint.charAt(0).toUpperCase() + hint.slice(1)
    }
  }
  return null
}
