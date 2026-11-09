/**
 * Tier-1 Prompt Rewriter — the Phase 1 flagship (blueprint Pillar 5).
 *
 * Pipeline (all context retrieval is deterministic — zero LLM tokens
 * spent on gathering):
 *   1. Intent & complexity triage          (intent.ts)
 *   2. Context assembly from DNA + memories + Knowledge Graph pointers
 *   3. Task decomposition when warranted    (decompose.ts)
 *   4. Tier-1 structured prompt assembly    (this file)
 *   5. Optional Deep-Path refinement via Ollama or Cloud (GLM)
 *   6. Token accounting + persistence       (Token Savings Engine)
 */
import { db } from '@/lib/db'
import { classifyIntent, splitRequirements } from './intent'
import { decomposeTask } from './decompose'
import { estimateTokens, estimateTokensOfObject } from './tokens'
import { contextSubgraph } from './graph'
import { getOllamaStatus, ollamaChat } from './ollama'
import { cloudChat } from './cloud'
import { MASTER_SYSTEM_PROMPT, buildDeepPathUserMessage } from './master-prompt'
import type {
  ContextUsed,
  DnaDocument,
  EngineKind,
  GraphContextPointer,
  RelevantMemory,
  RewriteResult,
} from './types'

const INTENT_LABELS: Record<string, string> = {
  feature_build: 'Feature build',
  bugfix: 'Bug fix',
  refactor: 'Refactor',
  research: 'Research',
  config: 'Configuration',
  boilerplate: 'Boilerplate',
  question: 'Question',
  docs: 'Documentation',
  deploy: 'Deployment',
  test: 'Testing',
}

export async function rewritePrompt(input: {
  projectId: string
  prompt: string
  engine: EngineKind
  ollamaBaseUrl: string
  ollamaModel: string
}): Promise<RewriteResult> {
  const started = Date.now()
  const project = await db.project.findUnique({
    where: { id: input.projectId },
    include: {
      dna: true,
      memories: { orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }] },
    },
  })
  if (!project) throw new Error('Project not found')

  const prompt = input.prompt.trim()
  if (prompt.length < 3) throw new Error('Prompt is empty')

  const dna = project.dna ? parseDna(project.dna) : null

  // --- 1. Triage ----------------------------------------------------------
  const intent = classifyIntent(prompt)

  // --- 2. Context assembly (deterministic retrieval) -----------------------
  const tokens = tokenize(prompt)
  const memoryRecords = project.memories

  const scored: Array<{ memory: (typeof memoryRecords)[number]; score: number; matched: RelevantMemory['matched'] }> = []
  for (const memory of memoryRecords) {
    const overlap = overlapScore(`${memory.key} ${memory.value}`, tokens)
    const isOpenItem = (memory.type === 'todo' || memory.type === 'bug') && memory.status === 'active'
    const isOpenCritical = isOpenItem && memory.importance >= 4
    if (overlap >= 2 || isOpenCritical || (overlap >= 1 && memory.importance >= 4)) {
      scored.push({
        memory,
        score: overlap + memory.importance * 0.4 + (isOpenCritical ? 3 : 0),
        matched: overlap >= 1 ? 'keyword' : 'open-item',
      })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  const selectedMemories = scored.slice(0, 10)

  const graphPointers: GraphContextPointer[] = await contextSubgraph(project.id, prompt, 8)

  const relevantMemories: RelevantMemory[] = selectedMemories.map(({ memory, matched }) => ({
    id: memory.id,
    type: memory.type as RelevantMemory['type'],
    key: memory.key,
    value: memory.value,
    status: memory.status,
    importance: memory.importance,
    matched,
  }))

  const stackLines = dna ? dna.techStack.map((t) => `${t.layer}: ${t.technology}`) : []

  const context: ContextUsed = {
    dnaSections: dna
      ? [
          'architecturePhilosophy',
          'techStack',
          'codingStandards',
          'designPatterns',
          ...(dna.businessRules.length > 0 ? ['businessRules'] : []),
        ]
      : [],
    stackLines,
    memories: relevantMemories,
    graphPointers,
    codeMapSummary: {
      files: dna?.fileStats.scannedFiles ?? 0,
      totalLines: dna?.fileStats.totalLines ?? 0,
      languages: dna?.fileStats.languages ?? {},
      prismaModels: dna?.fileStats.prismaModels ?? [],
    },
    tokensNaiveContext: 0,
    tokensCompactContext: 0,
  }

  // Token accounting: naive = dump DNA + ALL memories + full code map;
  // compact = only what we actually inject.
  context.tokensNaiveContext = estimateTokensOfObject({
    dna: dna ?? 'none',
    memories: memoryRecords.map((m) => ({ type: m.type, key: m.key, value: m.value })),
    codeMap: dna?.fileStats.codeMap ?? [],
  })
  context.tokensCompactContext = estimateTokensOfObject({
    stack: stackLines,
    standards: dna?.codingStandards ?? [],
    patterns: dna?.designPatterns ?? [],
    memories: relevantMemories,
    pointers: graphPointers,
  })

  // --- 3. Decomposition ----------------------------------------------------
  const decomposition = decomposeTask(prompt, intent)

  // --- 4. Fast-Path assembly ----------------------------------------------
  let finalPrompt = assembleTier1Prompt({
    projectName: project.name,
    projectDescription: project.description,
    platform: project.platform,
    rawPrompt: prompt,
    intent,
    dna,
    relevantMemories,
    graphPointers,
    decomposition,
  })

  let engineUsed: EngineKind = 'fast'
  let engineNote: string | undefined

  // --- 5. Deep-Path refinement --------------------------------------------
  if (input.engine === 'deep') {
    const status = await getOllamaStatus(input.ollamaBaseUrl)
    if (status.reachable) {
      try {
        finalPrompt = await ollamaChat(
          input.ollamaBaseUrl,
          input.ollamaModel,
          [
            { role: 'system', content: MASTER_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildDeepPathUserMessage({
                rawPrompt: prompt,
                projectName: project.name,
                projectDescription: project.description,
                stackLines,
                graphPointers: graphPointers.map((p) => `(${p.source}) —[${p.relation}]→ (${p.target})`),
                memories: relevantMemories.map((m) => `[${m.type.toUpperCase()}] ${m.key}: ${m.value}`),
                codeMapSummary: `${context.codeMapSummary.files} files / ${context.codeMapSummary.totalLines} lines mapped; models: ${context.codeMapSummary.prismaModels.join(', ') || 'none'}`,
                draftPrompt: finalPrompt,
              }),
            },
          ],
          { temperature: 0.15 },
        )
        engineUsed = 'deep'
        engineNote = `Refined by local Ollama model ${input.ollamaModel} (${status.latencyMs ?? 0}ms handshake).`
      } catch (error) {
        engineUsed = 'fast'
        engineNote = `Ollama at ${input.ollamaBaseUrl} unreachable — generation failed (${error instanceof Error ? error.message : 'unknown error'}) — deterministic Fast-Path output kept.`
      }
    } else {
      engineUsed = 'fast'
      engineNote = `Ollama at ${input.ollamaBaseUrl} unreachable (${status.error ?? 'offline'}) — deterministic Fast-Path engine used. Configure a reachable Ollama endpoint in Settings for Deep-Path refinement.`
    }
  } else if (input.engine === 'cloud') {
    try {
      finalPrompt = await cloudChat([
        { role: 'system', content: MASTER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildDeepPathUserMessage({
            rawPrompt: prompt,
            projectName: project.name,
            projectDescription: project.description,
            stackLines,
            graphPointers: graphPointers.map((p) => `(${p.source}) —[${p.relation}]→ (${p.target})`),
            memories: relevantMemories.map((m) => `[${m.type.toUpperCase()}] ${m.key}: ${m.value}`),
            codeMapSummary: `${context.codeMapSummary.files} files / ${context.codeMapSummary.totalLines} lines mapped; models: ${context.codeMapSummary.prismaModels.join(', ') || 'none'}`,
            draftPrompt: finalPrompt,
          }),
        },
      ])
      engineUsed = 'cloud'
      engineNote = 'Refined by the Cloud (GLM) engine.'
    } catch (error) {
      engineUsed = 'fast'
      engineNote = `Cloud engine failed (${error instanceof Error ? error.message : 'unknown error'}) — deterministic Fast-Path output kept.`
    }
  }

  // Normalise: deep/cloud engines wrap output in a code block — unwrap it.
  finalPrompt = unwrapCodeBlock(finalPrompt)

  // --- 6. Metrics & persistence --------------------------------------------
  const metrics = {
    tokensRaw: estimateTokens(prompt),
    tokensStructured: estimateTokens(finalPrompt),
    tokensContextAvoided: Math.max(0, context.tokensNaiveContext - context.tokensCompactContext),
    savingsPct: 0,
    durationMs: Date.now() - started,
  }
  metrics.savingsPct =
    context.tokensNaiveContext > 0
      ? Math.round((metrics.tokensContextAvoided / context.tokensNaiveContext) * 100)
      : 0

  const session = await db.promptSession.create({
    data: {
      projectId: project.id,
      rawPrompt: prompt,
      rewrittenPrompt: finalPrompt,
      engine: engineUsed,
      intent: intent.intent,
      complexity: intent.complexity,
      routing: JSON.stringify(intent.routing),
      decomposition: JSON.stringify(decomposition),
      contextUsed: JSON.stringify({
        memories: relevantMemories.length,
        graphPointers: graphPointers.length,
        stackLines: stackLines.length,
        tokensNaiveContext: context.tokensNaiveContext,
        tokensCompactContext: context.tokensCompactContext,
      }),
      tokensRaw: metrics.tokensRaw,
      tokensStructured: metrics.tokensStructured,
      tokensContextAvoided: metrics.tokensContextAvoided,
      durationMs: metrics.durationMs,
    },
  })

  await db.timelineEvent.create({
    data: {
      projectId: project.id,
      kind: 'prompt.rewritten',
      message: `Prompt rewritten via ${engineUsed}-path engine — intent: ${INTENT_LABELS[intent.intent] ?? intent.intent}, complexity ${intent.complexity}/10, ${metrics.tokensContextAvoided} context tokens avoided.`,
      meta: JSON.stringify({ sessionId: session.id, intent: intent.intent }),
    },
  })

  return {
    sessionId: session.id,
    prompt: finalPrompt,
    engineUsed,
    engineNote,
    intent,
    decomposition,
    context,
    metrics,
  }
}

// ---------------------------------------------------------------------------
// Tier-1 prompt assembly
// ---------------------------------------------------------------------------

function assembleTier1Prompt(args: {
  projectName: string
  projectDescription: string | null
  platform: string | null
  rawPrompt: string
  intent: ReturnType<typeof classifyIntent>
  dna: DnaDocument | null
  relevantMemories: RelevantMemory[]
  graphPointers: GraphContextPointer[]
  decomposition: ReturnType<typeof decomposeTask>
}): string {
  const { intent, dna, relevantMemories, graphPointers, decomposition } = args
  const out: string[] = []

  const stateHash = hashString(`${args.projectName}|${Date.now()}`).slice(0, 6)
  out.push(
    `[CORTEX-OS SYNC | Project: ${args.projectName}${args.platform ? ` | Platform: ${args.platform}` : ''} | Delta State: #${stateHash}]`,
  )
  out.push('')

  // -- Context
  out.push('## Context')
  const contextLines: string[] = []
  if (args.projectDescription) contextLines.push(args.projectDescription)
  if (dna) contextLines.push(dna.architecturePhilosophy)
  contextLines.push(
    `Task classified as: ${INTENT_LABELS[intent.intent] ?? intent.intent} (complexity ${intent.complexity}/10${
      intent.domains.length > 0 ? `, domains: ${intent.domains.join(', ')}` : ''
    }).`,
  )
  out.push(...contextLines.map((l) => l.replace(/\s+/g, ' ').trim()))
  out.push('')

  // -- Tech Stack
  if (dna && dna.techStack.length > 0) {
    out.push('## Tech Stack')
    dna.techStack.forEach((t) => out.push(`- ${t.layer}: ${t.technology}`))
    out.push('')
  } else {
    out.push('## Tech Stack')
    out.push('- Not yet profiled — generate the Project DNA from the workspace before continuing (Cortex daemon: POST /api/cortex/projects/{id}/dna).')
    out.push('')
  }

  // -- Known State (symbolic pointers, never raw dumps)
  if (graphPointers.length > 0) {
    out.push('## Known State (Knowledge Graph pointers)')
    graphPointers.forEach((p) => out.push(`- (${p.source}) —[${p.relation}]→ (${p.target})`))
    if (dna && dna.fileStats.prismaModels.length > 0) {
      out.push(`- Data model entities: ${dna.fileStats.prismaModels.join(', ')}`)
    }
    if (dna && dna.fileStats.scannedFiles > 0) {
      out.push(
        `- Code map: ${dna.fileStats.scannedFiles} files / ${dna.fileStats.totalLines.toLocaleString()} lines indexed — request specific file paths instead of re-reading the tree.`,
      )
    }
    out.push('')
  }

  // -- Open items & relevant memories
  if (relevantMemories.length > 0) {
    out.push('## Open Items & Project Memory')
    const open = relevantMemories.filter((m) => m.status === 'active' && (m.type === 'todo' || m.type === 'bug'))
    const others = relevantMemories.filter((m) => !open.includes(m))
    open.forEach((m) => out.push(`- [${m.type === 'bug' ? 'BUG' : 'TODO'}] ${m.key}: ${m.value}`))
    others.forEach((m) => out.push(`- [${m.type.toUpperCase()}] ${m.key}: ${m.value}`))
    out.push('')
  }

  // -- Requirements (atomic, from raw prompt segments)
  out.push('## Requirements')
  const segments = splitRequirements(args.rawPrompt)
  segments.forEach((segment, i) => {
    out.push(`${i + 1}. ${sentenceCase(segment)}.`)
  })

  // -- Constraints (from DNA — quoted, not paraphrased)
  out.push('')
  out.push('## Constraints')
  const constraints: string[] = []
  if (dna) {
    dna.codingStandards.slice(0, 6).forEach((s) => constraints.push(`${s.rule} (${s.source})`))
    if (dna.designPatterns.length > 0) {
      constraints.push(`Follow established patterns: ${dna.designPatterns.slice(0, 3).join('; ')}`)
    }
    dna.businessRules.slice(0, 5).forEach((r) => constraints.push(`Business rule: ${r}`))
  }
  constraints.push('Mobile-responsive, accessible (ARIA labels, 44px touch targets) UI where a UI is touched.')
  constraints.push('Production-ready only: complete error handling, no placeholders, no stubs, no TODO comments left in code.')
  constraints.forEach((c) => out.push(`- ${c}`))
  out.push('')

  // -- Decomposition (when warranted)
  if (decomposition.needed && decomposition.subtasks.length > 0) {
    out.push('## Execution Plan (pre-decomposed by CortexOS)')
    decomposition.subtasks.forEach((t) => {
      const deps = t.dependsOn.length > 0 ? ` (after ${t.dependsOn.join(', ')})` : ''
      out.push(`- ${t.id}. ${t.title}${deps}`)
    })
    out.push('')
  }

  // -- Deliverables
  out.push('## Deliverables')
  out.push(`- Complete, production-ready implementation of: ${sentenceCase(shorten(args.rawPrompt, 120))}.`)
  out.push('- List of every file created or modified, with a one-line rationale per file.')
  if (intent.intent === 'bugfix') {
    out.push('- Root-cause explanation of the defect and proof the fix eliminates it.')
  }
  if (intent.domains.includes('database') || intent.domains.includes('payments')) {
    out.push('- Migration files (if the data model changes) and .env.example additions (key names only).')
  }
  out.push('')

  // -- Out of scope
  out.push('## Out of Scope')
  out.push('- Anything not listed in Requirements — in particular, no refactors of untouched modules, no dependency upgrades, no formatting churn.')

  return out.join('\n')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDna(record: {
  techStack: string
  codingStandards: string
  businessRules: string
  preferredLibraries: string
  designPatterns: string
  fileStats: string
  architecturePhilosophy: string
  deploymentStrategy: string
}): DnaDocument {
  return {
    architecturePhilosophy: record.architecturePhilosophy,
    techStack: safeParseArray<TechStackEntryLike>(record.techStack),
    codingStandards: safeParseArray<CodingStandardLike>(record.codingStandards),
    businessRules: safeParseArray<string>(record.businessRules),
    preferredLibraries: safeParseArray<PreferredLibraryLike>(record.preferredLibraries),
    designPatterns: safeParseArray<string>(record.designPatterns),
    deploymentStrategy: record.deploymentStrategy,
    fileStats: safeParse(record.fileStats) as DnaDocument['fileStats'],
  }
}

type TechStackEntryLike = { layer: string; technology: string; evidence: string }
type CodingStandardLike = { rule: string; source: string }
type PreferredLibraryLike = { purpose: string; library: string; source: string }

function safeParseArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9#+._-]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  )
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'will', 'should', 'must',
  'need', 'still', 'then', 'also', 'from', 'into', 'our', 'are', 'was', 'were',
  'you', 'your', 'when', 'what', 'where', 'does', 'not', 'but', 'add', 'make',
  'build', 'create', 'update', 'using', 'please', 'can', 'get', 'set', 'new',
  'page', 'screen', 'app', 'application', 'want', 'like',
])

function overlapScore(text: string, tokens: Set<string>): number {
  const words = text.toLowerCase().split(/[^a-z0-9#+._-]+/).filter((w) => w.length >= 3)
  let score = 0
  for (const word of words) {
    if (tokens.has(word)) score += 1
  }
  return score
}

function sentenceCase(text: string): string {
  const clean = text.trim()
  if (!clean) return clean
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max)
}

function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function unwrapCodeBlock(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```$/)
  if (match) return match[1].trim()
  return trimmed
}

export { parseDna, INTENT_LABELS }
