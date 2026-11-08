/**
 * ENGINE 3 — Automatic Memory Extractor (blueprint Part 2 §4 + Part 1
 * ExtractedMemoryDelta contract).
 *
 * Runs after every AI coding turn: reads the user prompt + AI response +
 * modified-file AST diff, and produces an ExtractedMemoryDelta — new
 * decisions (with supersede detection), requirements, task transitions,
 * discovered/resolved bugs and preference updates — which is then applied to
 * the memory engine, the Knowledge Graph and the episodic store.
 *
 * Dual-mode like every Cortex engine: local Ollama (llama3.2:3b) under the
 * extracted-memory-delta JSON grammar when reachable, deterministic
 * pattern-based extraction otherwise. Zero cloud tokens in both modes.
 */
import { db } from '@/lib/db'
import { z } from 'zod'
import { extractMemories } from './extract'
import { indexEpisode } from './episodic'
import { upsertNode, upsertEdgeByLabel } from './graph'
import { getOllamaStatus, ollamaChatStructured } from './ollama'
import { getSettings } from './settings'
import { loadPrompt, loadJsonSchema } from './assets'
import type {
  AIPlatform,
  ExtractedMemoryDelta,
  FileAstDiff,
  MemoryDeltaApplyReport,
} from './types'

// ---------------------------------------------------------------------------
// Grammar validator (mirrors cortex-assets/schemas/extracted-memory-delta.schema.json)
// ---------------------------------------------------------------------------

const memoryDeltaZod = z.object({
  turnId: z.string().min(1),
  sourcePlatform: z.enum(['codex', 'hermes', 'opencode', 'cursor', 'windsurf', 'claude', 'chatgpt', 'local_ollama']),
  timestamp: z.number().int(),
  compactTurnSummary: z.string().min(3).max(600),
  newDecisions: z.array(
    z.object({
      category: z.enum(['database', 'auth', 'state', 'api', 'ui', 'security']),
      title: z.string().min(1),
      rationale: z.string().min(1),
      constraints: z.string(),
      targetModuleId: z.string(),
      supersedesDecisionId: z.string().optional(),
    }),
  ),
  newRequirements: z.array(
    z.object({
      domain: z.string().min(1),
      rule: z.string().min(3),
      priority: z.enum(['critical', 'high', 'medium']),
    }),
  ),
  taskUpdates: z.array(
    z.object({
      taskId: z.string().optional(),
      title: z.string().min(1),
      status: z.enum(['todo', 'pre_executed_locally', 'in_progress', 'completed', 'blocked']),
      targetFiles: z.array(z.string()),
    }),
  ),
  discoveredBugs: z.array(
    z.object({
      severity: z.enum(['critical', 'high', 'medium', 'low']),
      title: z.string().min(1),
      rootCause: z.string().min(1),
      affectedSymbolId: z.string().optional(),
      status: z.enum(['open', 'resolved']),
    }),
  ),
  userPreferenceUpdates: z.array(
    z.object({
      ruleType: z.enum(['immutableConstraint', 'forbiddenPattern', 'codingStandard']),
      value: z.string().min(3),
    }),
  ).optional(),
})

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function extractAndApplyMemoryDelta(input: {
  projectId: string
  sourcePlatform: AIPlatform
  rawUserPrompt: string
  aiResponseText: string
  modifiedFilesAstDiff?: FileAstDiff[]
  useLlm?: boolean
}): Promise<MemoryDeltaApplyReport> {
  const project = await db.project.findUnique({
    where: { id: input.projectId },
    include: { memories: { where: { status: 'active' } } },
  })
  if (!project) throw new Error('Project not found')

  const rawUserPrompt = input.rawUserPrompt.trim()
  const aiResponseText = input.aiResponseText.trim()
  if (rawUserPrompt.length < 3) throw new Error('rawUserPrompt is empty')
  if (aiResponseText.length < 3) throw new Error('aiResponseText is empty')

  const existingActiveDecisions = project.memories
    .filter((m) => m.type === 'decision' || m.type === 'architecture')
    .map((m) => ({ id: m.id, title: m.key, category: m.type }))
  const activeTasks = project.memories
    .filter((m) => m.type === 'todo')
    .map((m) => ({ id: m.id, title: m.key, status: 'active' }))

  const settings = await getSettings()
  const status = await getOllamaStatus(settings.ollamaBaseUrl)
  const wantLlm = input.useLlm !== false

  let delta: ExtractedMemoryDelta
  let engineUsed = 'deterministic'
  let engineNote: string | undefined

  if (wantLlm && status.reachable) {
    try {
      const raw = await ollamaChatStructured<unknown>(settings.ollamaBaseUrl, {
        model: settings.ollamaExtractorModel,
        systemPrompt: await loadPrompt('memory-extractor.system.md'),
        userPayload: {
          sourcePlatform: input.sourcePlatform,
          rawUserPrompt,
          aiResponseText,
          modifiedFilesAstDiff: input.modifiedFilesAstDiff ?? [],
          existingActiveDecisions,
          activeTasks,
        },
        jsonSchema: await loadJsonSchema('extracted-memory-delta.schema.json'),
        temperature: 0.1,
      })
      const parsed = memoryDeltaZod.safeParse(raw)
      if (!parsed.success) {
        throw new Error(`grammar violation: ${parsed.error.issues[0]?.message ?? 'invalid shape'}`)
      }
      delta = parsed.data
      engineUsed = `ollama:${settings.ollamaExtractorModel}`
      engineNote = `Memory delta extracted by local ${settings.ollamaExtractorModel} under the ExtractedMemoryDelta grammar.`
    } catch (error) {
      delta = deterministicDelta({
        sourcePlatform: input.sourcePlatform,
        rawUserPrompt,
        aiResponseText,
        modifiedFilesAstDiff: input.modifiedFilesAstDiff ?? [],
        existingActiveDecisions,
        activeTasks: activeTasks.map((t) => ({ ...t })),
      })
      engineNote = `Ollama extractor failed (${error instanceof Error ? error.message : 'unknown error'}) — deterministic extraction used.`
    }
  } else {
    delta = deterministicDelta({
      sourcePlatform: input.sourcePlatform,
      rawUserPrompt,
      aiResponseText,
      modifiedFilesAstDiff: input.modifiedFilesAstDiff ?? [],
      existingActiveDecisions,
      activeTasks: activeTasks.map((t) => ({ ...t })),
    })
    if (wantLlm) {
      engineNote = `Ollama at ${settings.ollamaBaseUrl} unreachable (${status.error ?? 'offline'}) — deterministic extraction used.`
    }
  }

  const applied = await applyMemoryDelta(project.id, delta, {
    rawUserPrompt,
    aiResponseText,
  })
  return {
    interactionId: applied.interactionId,
    decisionsCreated: applied.decisionsCreated,
    decisionsSuperseded: applied.decisionsSuperseded,
    requirementsCreated: applied.requirementsCreated,
    tasksUpdated: applied.tasksUpdated,
    tasksCreated: applied.tasksCreated,
    bugsCreated: applied.bugsCreated,
    bugsResolved: applied.bugsResolved,
    preferencesCreated: applied.preferencesCreated,
    engineUsed,
    ...(engineNote ? { engineNote } : {}),
    delta,
  }
}

// ---------------------------------------------------------------------------
// Deterministic extractor (Fast-Path)
// ---------------------------------------------------------------------------

const CATEGORY_PATTERNS: Array<[ExtractedMemoryDelta['newDecisions'][number]['category'], RegExp]> = [
  ['database', /\bdatabase|\bdb\b|postgres|prisma|schema|sql|storage|redis|queue|mongo|sqlite/i],
  ['auth', /\bauth|login|clerk|session|jwt|oauth|sign-?in|token|email verif|verif\w* email/i],
  ['security', /security|encrypt|sanitize|rate.?limit|xss|csrf|permission|vulnerab/i],
  ['state', /\bstate\b|zustand|redux|store|cache|context provider/i],
  ['api', /\bapi\b|route|endpoint|rest|graphql|webhook|middleware/i],
  ['ui', /\bui\b|component|design|css|tailwind|theme|layout|page/i],
]

const CRITICAL = /\b(critical|urgent|production|security|data loss|money|payment|outage)\b/i

const SUPERSEDE_PHRASES =
  /\b(?:instead of|switch(?:ing|ed)? (?:to )?from|migrat(?:e|ing) from|replac(?:e|ing)|moving away from|no longer using|rather than)\b/i

const COMPLETION_VERBS =
  /\b(done|complete[d]?|implemented|finished|shipped|deployed|integrated|added|created|wrote|written|fixed|resolved)\b/i

const MODULE_HINTS = [
  'checkout', 'auth', 'payments', 'billing', 'dashboard', 'api', 'frontend',
  'backend', 'database', 'webhooks', 'profile', 'settings', 'search', 'notifications',
]

function deterministicDelta(args: {
  sourcePlatform: AIPlatform
  rawUserPrompt: string
  aiResponseText: string
  modifiedFilesAstDiff: FileAstDiff[]
  existingActiveDecisions: Array<{ id: string; title: string; category: string }>
  activeTasks: Array<{ id: string; title: string; status: string }>
}): ExtractedMemoryDelta {
  const combined = `${args.rawUserPrompt}\n${args.aiResponseText}`
  const diffText = args.modifiedFilesAstDiff
    .map((d) => `${d.path} ${d.addedSymbols.join(' ')} ${d.modifiedSymbols.join(' ')}`)
    .join('\n')
  const evidence = `${args.aiResponseText}\n${diffText}`

  // --- compact turn summary (<50 tokens): built + files + next state
  const filesTouched = extractPaths(combined).slice(0, 3)
  const builtSentence =
    firstSentence(args.aiResponseText).replace(/\s+/g, ' ').trim().slice(0, 180) || 'Turn completed'
  const compactTurnSummary = [
    `Built: ${builtSentence}`,
    filesTouched.length > 0 ? `Files: ${filesTouched.join(', ')}` : null,
    nextStepOf(args.aiResponseText),
  ]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 320)

  // --- new decisions (with supersede detection)
  const newDecisions: ExtractedMemoryDelta['newDecisions'] = []
  for (const memory of extractMemories(combined)) {
    if (memory.type !== 'decision' && memory.type !== 'architecture') continue
    const category = categorize(`${memory.key} ${memory.value}`)
    const module = matchModule(`${memory.key} ${memory.value}`) ?? 'General'
    const supersedes = detectSupersede(memory.key, memory.value, args.existingActiveDecisions)
    newDecisions.push({
      category,
      title: memory.key,
      rationale: memory.value.slice(0, 300),
      constraints: CRITICAL.test(memory.value) ? 'Critical-path decision — treat as immutable.' : '',
      targetModuleId: module,
      ...(supersedes ? { supersedesDecisionId: supersedes } : {}),
    })
  }

  // --- new requirements
  const newRequirements: ExtractedMemoryDelta['newRequirements'] = []
  for (const memory of extractMemories(args.rawUserPrompt)) {
    if (memory.type !== 'requirement') continue
    newRequirements.push({
      domain: categorize(`${memory.key} ${memory.value}`),
      rule: memory.value.slice(0, 300),
      priority: CRITICAL.test(memory.value) ? 'critical' : memory.importance >= 4 ? 'high' : 'medium',
    })
  }
  // Direct sentence scan: a requirement glued to a decision sentence in the
  // same chunk would otherwise be swallowed by the one-memory-per-chunk rule.
  const REQUIREMENT_SENTENCE =
    /\b(?:users?\s+(?:must|should|need)\s+[^.!?]{4,140}|must\s+(?:be|support|allow|have|verify)\s+[^.!?]{4,140}|shall\s+(?:be|support|allow)\s+[^.!?]{4,140})/gi
  for (const match of args.rawUserPrompt.matchAll(REQUIREMENT_SENTENCE)) {
    const rule = match[0].replace(/\s+/g, ' ').trim()
    if (rule.length < 8) continue
    if (newRequirements.some((r) => r.rule.includes(rule))) continue
    newRequirements.push({
      domain: categorize(rule),
      rule,
      priority: CRITICAL.test(rule) ? 'critical' : 'high',
    })
  }

  // --- task continuity (blueprint rule 3: completed only if implemented)
  const taskUpdates: ExtractedMemoryDelta['taskUpdates'] = []
  const existingTodoTitles = new Set(args.activeTasks.map((t) => t.title.toLowerCase()))
  for (const task of args.activeTasks) {
    const taskWords = task.title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)
    const mentioned = taskWords.some((w) => evidence.toLowerCase().includes(w))
    if (!mentioned) continue
    if (COMPLETION_VERBS.test(evidence) && taskWords.some((w) => diffText.toLowerCase().includes(w) || evidence.toLowerCase().includes(w))) {
      taskUpdates.push({
        taskId: task.id,
        title: task.title,
        status: 'completed',
        targetFiles: extractPaths(evidence).slice(0, 4),
      })
    } else {
      taskUpdates.push({
        taskId: task.id,
        title: task.title,
        status: 'in_progress',
        targetFiles: extractPaths(evidence).slice(0, 4),
      })
    }
  }
  // newly discovered TODOs
  for (const memory of extractMemories(combined)) {
    if (memory.type !== 'todo') continue
    if (existingTodoTitles.has(memory.key.toLowerCase())) continue
    if (taskUpdates.some((t) => t.title.toLowerCase() === memory.key.toLowerCase())) continue
    taskUpdates.push({
      title: memory.key,
      status: COMPLETION_VERBS.test(memory.value) ? 'in_progress' : 'todo',
      targetFiles: extractPaths(memory.value).slice(0, 3),
    })
  }

  // --- discovered bugs (open) + resolutions (existing bugs marked fixed)
  const discoveredBugs: ExtractedMemoryDelta['discoveredBugs'] = []
  for (const memory of extractMemories(args.rawUserPrompt)) {
    if (memory.type !== 'bug') continue
    discoveredBugs.push({
      severity: CRITICAL.test(memory.value) ? 'critical' : memory.importance >= 4 ? 'high' : 'medium',
      title: memory.key,
      rootCause: memory.value.slice(0, 300),
      status: 'open',
    })
  }
  // "fixed the X" in the response → resolved bug entries
  const fixedMatches = [...args.aiResponseText.matchAll(/\bfixed\s+(?:the\s+|a\s+)?([a-z][\w-]*(?:\s+[\w-]+){0,3})/gi)]
  for (const match of fixedMatches) {
    const subject = match[1].trim().toLowerCase()
    if (subject.length < 3) continue
    if (discoveredBugs.some((b) => subject.includes(b.title.toLowerCase()) || b.title.toLowerCase().includes(subject))) {
      // The bug was both reported earlier and fixed in this same turn.
      continue
    }
    discoveredBugs.push({
      severity: 'medium',
      title: subject,
      rootCause: `Marked fixed in this turn: "${match[0].trim()}"`,
      status: 'resolved',
    })
  }

  // --- preference updates
  const userPreferenceUpdates: ExtractedMemoryDelta['userPreferenceUpdates'] = []
  for (const memory of extractMemories(args.rawUserPrompt)) {
    if (memory.type !== 'preference') continue
    userPreferenceUpdates.push({
      ruleType: /\bnever|only|don'?t\b/i.test(memory.value) ? 'forbiddenPattern' : 'codingStandard',
      value: memory.value.slice(0, 300),
    })
  }

  return {
    turnId: `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    sourcePlatform: args.sourcePlatform,
    timestamp: Date.now(),
    compactTurnSummary,
    newDecisions,
    newRequirements,
    taskUpdates,
    discoveredBugs,
    ...(userPreferenceUpdates.length > 0 ? { userPreferenceUpdates } : {}),
  }
}

// ---------------------------------------------------------------------------
// Delta application (memory engine + Knowledge Graph + episodic store)
// ---------------------------------------------------------------------------

async function applyMemoryDelta(
  projectId: string,
  delta: ExtractedMemoryDelta,
  raw: { rawUserPrompt: string; aiResponseText: string },
): Promise<{
  interactionId: string | null
  decisionsCreated: number
  decisionsSuperseded: number
  requirementsCreated: number
  tasksUpdated: number
  tasksCreated: number
  bugsCreated: number
  bugsResolved: number
  preferencesCreated: number
}> {
  const existing = await db.memory.findMany({ where: { projectId } })
  const existingKeys = new Set(existing.map((m) => `${m.type}::${m.key.toLowerCase()}`))
  const report = {
    interactionId: null as string | null,
    decisionsCreated: 0,
    decisionsSuperseded: 0,
    requirementsCreated: 0,
    tasksUpdated: 0,
    tasksCreated: 0,
    bugsCreated: 0,
    bugsResolved: 0,
    preferencesCreated: 0,
  }

  // --- decisions (create + supersede)
  for (const decision of delta.newDecisions) {
    // Mark superseded decisions first so the graph edge can link old → new.
    let supersededId: string | null = null
    if (decision.supersedesDecisionId) {
      const target = existing.find((m) => m.id === decision.supersedesDecisionId && m.status === 'active')
      if (target) {
        await db.memory.update({ where: { id: target.id }, data: { status: 'superseded' } })
        supersededId = target.id
        report.decisionsSuperseded += 1
      }
    }

    const key = `decision::${decision.title.toLowerCase()}`
    if (existingKeys.has(key)) continue // unchanged decision — dedupe
    const created = await db.memory.create({
      data: {
        projectId,
        type: 'decision',
        key: decision.title,
        value: [decision.rationale, decision.constraints].filter(Boolean).join(' — ').slice(0, 500),
        importance: decision.category === 'security' || decision.category === 'database' ? 5 : 4,
        source: 'interaction',
      },
    })
    existingKeys.add(key)
    report.decisionsCreated += 1

    // Graph: decision node governed by its module + SUPERSEDES edge when the
    // course changed (blueprint GOVERNED_BY / SUPERSEDES_DECISION relations).
    const decisionLabel = `Decision: ${decision.title}`.slice(0, 60)
    await upsertNode(projectId, 'module', decision.targetModuleId, { source: 'memory-delta' })
    await upsertNode(projectId, 'feature', decisionLabel, {
      memoryId: created.id,
      category: decision.category,
    })
    await upsertEdgeByLabel(projectId, 'module', decision.targetModuleId, 'GOVERNED_BY', 'feature', decisionLabel)
    if (supersededId) {
      const old = existing.find((m) => m.id === supersededId)
      if (old) {
        const oldLabel = `Decision: ${old.key}`.slice(0, 60)
        await upsertNode(projectId, 'feature', oldLabel, { memoryId: old.id, superseded: true })
        await upsertEdgeByLabel(projectId, 'feature', oldLabel, 'SUPERSEDES', 'feature', decisionLabel)
      }
    }
  }

  // --- requirements
  for (const requirement of delta.newRequirements) {
    const key = `requirement::${requirement.rule.slice(0, 60).toLowerCase()}`
    if (existingKeys.has(key)) continue
    await db.memory.create({
      data: {
        projectId,
        type: 'requirement',
        key: requirement.domain,
        value: requirement.rule.slice(0, 500),
        importance: requirement.priority === 'critical' ? 5 : requirement.priority === 'high' ? 4 : 3,
        source: 'interaction',
      },
    })
    existingKeys.add(key)
    report.requirementsCreated += 1
  }

  // --- task continuity
  for (const task of delta.taskUpdates) {
    if (task.taskId) {
      const target = existing.find((m) => m.id === task.taskId)
      if (!target) continue
      if (task.status === 'completed') {
        await db.memory.update({ where: { id: target.id }, data: { status: 'resolved' } })
      } else if (task.status === 'blocked') {
        await db.memory.update({
          where: { id: target.id },
          data: { importance: Math.min(5, target.importance + 1) },
        })
      } else if (task.status === 'in_progress' && !/^\[in progress\]/i.test(target.value)) {
        await db.memory.update({
          where: { id: target.id },
          data: { value: `[in progress] ${target.value}`.slice(0, 500) },
        })
      }
      report.tasksUpdated += 1
    } else {
      const key = `todo::${task.title.toLowerCase()}`
      if (existingKeys.has(key)) continue
      await db.memory.create({
        data: {
          projectId,
          type: 'todo',
          key: task.title,
          value: `${task.title}${task.targetFiles.length > 0 ? ` — target files: ${task.targetFiles.join(', ')}` : ''}`.slice(0, 500),
          importance: 3,
          source: 'interaction',
        },
      })
      existingKeys.add(key)
      report.tasksCreated += 1
    }
  }

  // --- bugs (create open ones; resolve matching ones)
  const openBugs = existing.filter((m) => m.type === 'bug')
  for (const bug of delta.discoveredBugs) {
    const match = openBugs.find(
      (m) =>
        m.key.toLowerCase() === bug.title.toLowerCase() ||
        m.key.toLowerCase().includes(bug.title.toLowerCase()) ||
        bug.title.toLowerCase().includes(m.key.toLowerCase()),
    )
    if (bug.status === 'resolved') {
      if (match && match.status === 'active') {
        await db.memory.update({ where: { id: match.id }, data: { status: 'resolved' } })
        report.bugsResolved += 1
      }
      continue
    }
    if (match) continue // already tracked
    const key = `bug::${bug.title.toLowerCase()}`
    if (existingKeys.has(key)) continue
    const created = await db.memory.create({
      data: {
        projectId,
        type: 'bug',
        key: bug.title,
        value: bug.rootCause.slice(0, 500),
        importance: bug.severity === 'critical' ? 5 : bug.severity === 'high' ? 4 : 3,
        source: 'interaction',
      },
    })
    existingKeys.add(key)
    report.bugsCreated += 1
    const bugLabel = `Bug: ${bug.title}`.slice(0, 60)
    await upsertNode(projectId, 'bug', bugLabel, {
      memoryId: created.id,
      severity: bug.severity,
      detail: bug.rootCause.slice(0, 200),
    })
    const module = matchModule(`${bug.title} ${bug.rootCause}`)
    if (module) {
      await upsertNode(projectId, 'module', module, { source: 'memory-delta' })
      await upsertEdgeByLabel(projectId, 'module', module, 'HAS_BUG', 'bug', bugLabel)
    }
  }

  // --- preferences
  for (const preference of delta.userPreferenceUpdates ?? []) {
    const key = `preference::${preference.value.slice(0, 50).toLowerCase()}`
    if (existingKeys.has(key)) continue
    await db.memory.create({
      data: {
        projectId,
        type: 'preference',
        key: preference.ruleType,
        value: preference.value.slice(0, 500),
        importance: preference.ruleType === 'forbiddenPattern' ? 4 : 3,
        source: 'interaction',
      },
    })
    existingKeys.add(key)
    report.preferencesCreated += 1
  }

  // --- persist the interaction + episodic index (the raw transcript)
  const transcript = `USER PROMPT:\n${raw.rawUserPrompt}\n\nAI RESPONSE:\n${raw.aiResponseText}`.slice(0, 20_000)
  const interaction = await db.interaction.create({
    data: {
      projectId,
      title: delta.compactTurnSummary.slice(0, 180),
      platform: delta.sourcePlatform,
      rawText: transcript,
      memoriesExtracted:
        report.decisionsCreated +
        report.requirementsCreated +
        report.tasksCreated +
        report.bugsCreated +
        report.preferencesCreated,
      sessionId: delta.turnId,
    },
  })
  report.interactionId = interaction.id

  try {
    await indexEpisode(interaction.id, transcript)
  } catch (error) {
    console.error('[cortexd] episodic indexing of memory delta failed:', error)
  }

  await db.timelineEvent.create({
    data: {
      projectId,
      kind: 'memory.delta_applied',
      message: `Memory delta applied (${delta.sourcePlatform} turn): ${report.decisionsCreated} decision(s)${report.decisionsSuperseded > 0 ? `, ${report.decisionsSuperseded} superseded` : ''}, ${report.requirementsCreated} requirement(s), ${report.tasksUpdated} task update(s)${report.tasksCreated > 0 ? ` +${report.tasksCreated} new` : ''}, ${report.bugsCreated} bug(s)${report.bugsResolved > 0 ? `, ${report.bugsResolved} resolved` : ''}. Summary: ${delta.compactTurnSummary.slice(0, 140)}`,
      meta: JSON.stringify({ interactionId: interaction.id, turnId: delta.turnId }),
    },
  })

  return report
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

function categorize(text: string): ExtractedMemoryDelta['newDecisions'][number]['category'] {
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category
  }
  return 'api'
}

function detectSupersede(
  newTitle: string,
  newValue: string,
  existing: Array<{ id: string; title: string; category: string }>,
): string | undefined {
  const haystack = `${newTitle} ${newValue}`.toLowerCase()
  const changedCourse = SUPERSEDE_PHRASES.test(newValue)
  for (const candidate of existing) {
    const title = candidate.title.toLowerCase()
    if (title.length < 3) continue
    // Same key re-decided, or an explicit "instead of <existing>" phrasing.
    if (title === newTitle.toLowerCase()) return candidate.id
    if (changedCourse && haystack.includes(title)) return candidate.id
  }
  return undefined
}

function matchModule(text: string): string | null {
  const lower = text.toLowerCase()
  for (const hint of MODULE_HINTS) {
    if (lower.includes(hint)) return hint.charAt(0).toUpperCase() + hint.slice(1)
  }
  return null
}

function extractPaths(text: string): string[] {
  const matches = text.match(/(?:src|app|lib|components|prisma|pages|api|scripts|extension|mcp-server)\/[\w./-]+\.[a-z]{2,4}/g)
  return [...new Set(matches ?? [])].slice(0, 6)
}

function firstSentence(text: string): string {
  const match = text.match(/^[^.!?\n]{10,180}[.!?]/)
  return match ? match[0] : text.slice(0, 160)
}

function nextStepOf(text: string): string | null {
  const match = text.match(/(?:next|then|remaining|still need|follow-?up)[^.!?\n]{0,140}[.!?]?/i)
  return match ? `Next: ${match[0].trim()}` : null
}
