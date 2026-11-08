/**
 * Pre-Execution Local Agent & Token Optimizer — Phase 3 flagship
 * (blueprint v2 §6 Weeks 5–6 + Part 2 pipeline, adapted to the daemon).
 *
 * Raw prompt
 *   │
 *   ▼
 * ENGINE 1 — Pre-Execution Router & Triage (ollama qwen2.5:1.5b via
 *            `format: jsonSchema`, deterministic Fast-Path fallback)
 *   │  RouterDecision: executionMode + localPreExecutionPlan + cloudCoreTaskSpec
 *   ▼
 * LOCAL TOOL RUNNER (0 cloud tokens)
 *   │  ast_symbol_lookup · schema_inspect · local_docs_search ·
 *   │  scaffold_boilerplate (staged) · git_diff_summary
 *   ▼
 * [LOCAL_ONLY → early return: artifacts + staged files, no cloud prompt]
 *   ▼
 * ENGINE 2 — Tier-1 Prompt Engineering (ollama qwen2.5-coder:7b via strict
 *            grammar, deterministic blueprint-format assembler fallback)
 *   │  finalInjectedMarkdownPrompt + scopeLock + decomposedSubtasks
 *   ▼
 * Codex / Hermes / OpenCode / Cursor / Claude
 *
 * Every run is persisted (PreExecRun + StagedArtifact rows) and feeds the
 * Token Savings Engine, the Development Timeline and — through the sync
 * packet — `continuityState.activeTask.preExecutedByLocalAgent`.
 */
import { db } from '@/lib/db'
import { z } from 'zod'
import { classifyIntent, splitRequirements } from './intent'
import { parseDna } from './rewrite'
import { buildSyncPacket } from './packet'
import { estimateTokens, estimateTokensOfObject } from './tokens'
import { getOllamaStatus, ollamaChatStructured } from './ollama'
import { getSettings } from './settings'
import { loadPrompt, loadJsonSchema } from './assets'
import {
  executeLocalToolStep,
  type LocalToolStep,
  type StagedFileSpec,
  type ToolRunContext,
} from './local-tools'
import type {
  CloudCoreTaskSpec,
  DecomposedSubtask,
  ExecutedArtifact,
  PreExecExecutionMode,
  PreExecIntentCategory,
  PreExecPlanStep,
  PreExecResult,
  RouterDecision,
  Tier1RewrittenPrompt,
} from './types'
import type { DnaDocument } from './types'

// ---------------------------------------------------------------------------
// Blueprint grammar validators (mirror cortex-assets/schemas/*.json)
// ---------------------------------------------------------------------------

const toolNameZod = z.enum([
  'ast_symbol_lookup',
  'schema_inspect',
  'local_docs_search',
  'scaffold_boilerplate',
  'git_diff_summary',
])

const routerDecisionZod = z.object({
  intentCategory: z.enum([
    'feature_build', 'bug_fix', 'refactor', 'schema_change', 'architecture', 'test_gen', 'docs',
  ]),
  complexityScore: z.number().int().min(1).max(10),
  executionMode: z.enum(['LOCAL_ONLY', 'HYBRID_PRE_EXECUTE', 'CLOUD_DIRECT_WITH_DNA']),
  relevantModuleIds: z.array(z.string()),
  localPreExecutionPlan: z
    .array(
      z.object({
        stepId: z.string().min(1),
        toolName: toolNameZod,
        toolArgs: z.record(z.string(), z.string()),
        expectedArtifact: z.string().min(1),
      }),
    )
    .max(8),
  cloudCoreTaskSpec: z.object({
    coreObjective: z.string().min(1),
    targetFiles: z.array(z.string()),
    readOnlyReferenceFiles: z.array(z.string()),
    scopeGuardConstraints: z.array(z.string()),
  }),
  estimatedCloudTokensSaved: z.number().int().min(0),
})

const tier1Zod = z.object({
  taskTitle: z.string().min(1),
  targetPlatformOptimized: z.enum(['codex', 'hermes', 'opencode', 'cursor', 'claude', 'generic']),
  decomposedSubtasks: z.array(
    z.object({
      stepNumber: z.number().int().min(1),
      layer: z.enum(['database', 'backend', 'frontend', 'auth', 'testing']),
      action: z.string().min(1),
      handledBy: z.enum(['COMPLETED_BY_LOCAL_OLLAMA', 'ASSIGNED_TO_MAIN_AI']),
    }),
  ),
  scopeLock: z.object({
    allowedWriteFiles: z.array(z.string()),
    readOnlyContextFiles: z.array(z.string()),
    forbiddenPatterns: z.array(z.string()),
  }),
  finalInjectedMarkdownPrompt: z.string().min(80),
})

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function runPreExecution(input: {
  projectId: string
  prompt: string
  targetPlatform?: string
  module?: string
  useLlm?: boolean
}): Promise<PreExecResult> {
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
  const settings = await getSettings()
  const targetPlatform = (input.targetPlatform || project.platform || 'codex').trim()

  // Scoped graph context + continuity (same contract as the sync packet,
  // without recording a handoff — the pre-exec run is the audit record).
  const packet = await buildSyncPacket(project.id, {
    targetPlatform,
    ...(input.module ? { module: input.module } : {}),
  })

  const ctx: ToolRunContext = { projectId: project.id, rootPath: project.rootPath, dna }

  // ---- ENGINE 1: Pre-Execution Router -------------------------------------
  let router: RouterDecision
  let routerEngine = 'deterministic'
  let routerNote: string | undefined

  const status = await getOllamaStatus(settings.ollamaBaseUrl)
  const wantLlm = input.useLlm !== false

  if (wantLlm && status.reachable) {
    try {
      const raw = await ollamaChatStructured<unknown>(settings.ollamaBaseUrl, {
        model: settings.ollamaRouterModel,
        systemPrompt: await loadPrompt('pre-execution-router.system.md'),
        userPayload: {
          RAW_USER_PROMPT: prompt,
          PROJECT_DNA: compactDna(dna),
          SCOPED_GRAPH_CONTEXT: {
            activeModule: packet.scopedGraphContext.activeModule,
            relevantDecisions: packet.scopedGraphContext.relevantDecisions,
            openBugsInScope: packet.scopedGraphContext.openBugsInScope,
          },
        },
        jsonSchema: await loadJsonSchema('router-decision.schema.json'),
      })
      const parsed = routerDecisionZod.safeParse(raw)
      if (!parsed.success) {
        throw new Error(`grammar violation: ${parsed.error.issues[0]?.message ?? 'invalid shape'}`)
      }
      router = sanitizePlan(parsed.data)
      routerEngine = `ollama:${settings.ollamaRouterModel}`
      routerNote = `Engine 1 triaged by local ${settings.ollamaRouterModel} with the RouterDecisionSchema grammar.`
    } catch (error) {
      router = deterministicRouter(prompt, dna, packet.scopedGraphContext.activeModule, project.rootPath)
      routerNote = `Ollama router failed (${error instanceof Error ? error.message : 'unknown error'}) — deterministic Fast-Path triage used.`
    }
  } else {
    router = deterministicRouter(prompt, dna, packet.scopedGraphContext.activeModule, project.rootPath)
    if (wantLlm) {
      routerNote = `Ollama at ${settings.ollamaBaseUrl} unreachable (${status.error ?? 'offline'}) — deterministic Fast-Path triage used (blueprint §4 Fast-Path, <800ms).`
    }
  }

  // ---- LOCAL TOOL RUNNER (0 cloud tokens) ---------------------------------
  const planStart = Date.now()
  const artifacts: ExecutedArtifact[] = []
  const stagedSpecs: StagedFileSpec[] = []

  for (const step of router.localPreExecutionPlan) {
    const artifact = await executeLocalToolStep(step, ctx)
    artifacts.push({
      stepId: artifact.stepId,
      toolName: artifact.toolName,
      ok: artifact.ok,
      durationMs: artifact.durationMs,
      summary: artifact.summary,
      data: artifact.data,
      stagedFileCount: artifact.staged.length,
      ...(artifact.error ? { error: artifact.error } : {}),
    })
    stagedSpecs.push(...artifact.staged)
  }
  const localToolMs = Date.now() - planStart

  // ---- Token accounting (grounded in real artifact sizes) ------------------
  const artifactTokens = artifacts.reduce((sum, a) => sum + estimateTokensOfObject(a.data), 0)
  const stagedTokens = stagedSpecs.reduce((sum, s) => sum + estimateTokens(s.content), 0)
  const naiveContextTokens = estimateTokensOfObject({
    dna: dna ?? 'none',
    memories: project.memories.map((m) => ({ type: m.type, key: m.key, value: m.value })),
    codeMap: dna?.fileStats.codeMap ?? [],
  })

  // ---- LOCAL_ONLY early return (blueprint: 100% solvable locally) ----------
  if (router.executionMode === 'LOCAL_ONLY') {
    const compactContextTokens = artifactTokens + stagedTokens
    const tokensSavedCloud =
      router.complexityScore * 350 + // the whole implementation the cloud never writes
      stagedTokens * 1.2 +
      Math.max(0, naiveContextTokens - compactContextTokens)

    const run = await persistRun({
      projectId: project.id,
      rawPrompt: prompt,
      targetPlatform,
      router,
      routerEngine,
      artifacts,
      tier1: null,
      injectedPrompt: null,
      handledLocally: true,
      tokensSavedCloud: Math.round(tokensSavedCloud),
      tokensContextAvoided: Math.max(0, naiveContextTokens - compactContextTokens),
      durationMs: Date.now() - started,
      stagedSpecs,
    })

    return {
      runId: run.id,
      handledCompletelyLocally: true,
      router,
      routerEngine,
      ...(routerNote ? { routerNote } : {}),
      tier1Engine: 'deterministic',
      artifacts,
      tier1: null,
      injectedPrompt: null,
      staged: run.staged,
      metrics: {
        tokensRaw: estimateTokens(prompt),
        tokensSavedCloud: Math.round(tokensSavedCloud),
        tokensContextAvoided: Math.max(0, naiveContextTokens - compactContextTokens),
        localToolMs,
        durationMs: Date.now() - started,
        scaffoldedFiles: stagedSpecs.length,
      },
    }
  }

  // ---- ENGINE 2: Tier-1 Prompt Engineering ---------------------------------
  let tier1: Tier1RewrittenPrompt
  let tier1Engine = 'deterministic'
  let tier1Note: string | undefined

  const localArtifactsPayload = artifacts.map((a) => ({
    tool: a.toolName,
    summary: a.summary,
    data: a.data,
  }))

  if (wantLlm && status.reachable) {
    try {
      const raw = await ollamaChatStructured<unknown>(settings.ollamaBaseUrl, {
        model: settings.ollamaModel,
        systemPrompt: await loadPrompt('tier1-prompt-engineer.system.md'),
        userPayload: {
          RAW_USER_PROMPT: prompt,
          TARGET_PLATFORM: targetPlatform,
          PROJECT_DNA: compactDna(dna),
          SCOPED_GRAPH_CONTEXT: packet.scopedGraphContext,
          CONTINUITY_STATE: packet.continuityState,
          LOCAL_PRE_EXECUTION_ARTIFACTS: localArtifactsPayload,
          STAGED_FILES: stagedSpecs.map((s) => ({ path: s.targetPath, kind: s.kind, action: s.action })),
          ROUTER_CORE_SPEC: router.cloudCoreTaskSpec,
        },
        jsonSchema: await loadJsonSchema('tier1-rewritten-prompt.schema.json'),
      })
      const parsed = tier1Zod.safeParse(raw)
      if (!parsed.success) {
        throw new Error(`grammar violation: ${parsed.error.issues[0]?.message ?? 'invalid shape'}`)
      }
      tier1 = parsed.data
      tier1Engine = `ollama:${settings.ollamaModel}`
      tier1Note = `Engine 2 specification composed by local ${settings.ollamaModel} under the Tier1RewrittenPromptSchema grammar.`
    } catch (error) {
      tier1 = assembleDeterministicTier1({
        projectName: project.name,
        prevPlatform: packet.header.previousPlatform,
        targetPlatform,
        prompt,
        router,
        artifacts,
        stagedSpecs,
        dna,
        packetMarkdownStack: packet.dnaSnapshot.stackSummary,
        continuity: packet.continuityState.lastCompletedAction,
        scopedSymbols: packet.scopedGraphContext.relevantSymbols,
      })
      tier1Note = `Ollama prompt-engineer failed (${error instanceof Error ? error.message : 'unknown error'}) — deterministic blueprint-format assembler used.`
    }
  } else {
    tier1 = assembleDeterministicTier1({
      projectName: project.name,
      prevPlatform: packet.header.previousPlatform,
      targetPlatform,
      prompt,
      router,
      artifacts,
      stagedSpecs,
      dna,
      packetMarkdownStack: packet.dnaSnapshot.stackSummary,
      continuity: packet.continuityState.lastCompletedAction,
      scopedSymbols: packet.scopedGraphContext.relevantSymbols,
    })
    if (wantLlm) {
      tier1Note = `Ollama unreachable — deterministic blueprint-format assembler used (Fast-Path).`
    }
  }

  const tokensContextAvoided = Math.max(
    0,
    naiveContextTokens - estimateTokens(tier1.finalInjectedMarkdownPrompt),
  )
  // Grounded estimate: the inspections/boilerplate the cloud no longer performs
  // (artifact + staged tokens) plus the context it no longer has to re-read.
  const tokensSavedCloud = artifactTokens + stagedTokens * 1.2 + tokensContextAvoided

  const run = await persistRun({
    projectId: project.id,
    rawPrompt: prompt,
    targetPlatform,
    router,
    routerEngine,
    artifacts,
    tier1,
    injectedPrompt: tier1.finalInjectedMarkdownPrompt,
    handledLocally: false,
    tokensSavedCloud: Math.round(tokensSavedCloud),
    tokensContextAvoided,
    durationMs: Date.now() - started,
    stagedSpecs,
  })

  return {
    runId: run.id,
    handledCompletelyLocally: false,
    router,
    routerEngine,
    ...(routerNote ? { routerNote } : {}),
    tier1Engine,
    ...(tier1Note ? { tier1Note } : {}),
    artifacts,
    tier1,
    injectedPrompt: tier1.finalInjectedMarkdownPrompt,
    staged: run.staged,
    metrics: {
      tokensRaw: estimateTokens(prompt),
      tokensSavedCloud: Math.round(tokensSavedCloud),
      tokensContextAvoided,
      localToolMs,
      durationMs: Date.now() - started,
      scaffoldedFiles: stagedSpecs.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Deterministic Engine 1 — the Fast-Path triage (blueprint §4, <800ms)
// ---------------------------------------------------------------------------

const INTENT_TO_CATEGORY: Record<string, PreExecIntentCategory> = {
  feature_build: 'feature_build',
  bugfix: 'bug_fix',
  refactor: 'refactor',
  research: 'architecture',
  config: 'schema_change',
  boilerplate: 'schema_change',
  question: 'architecture',
  docs: 'docs',
  deploy: 'architecture',
  test: 'test_gen',
}

const LOCAL_ONLY_HINT =
  /\b(zod|schema|type|types|interface|scaffold|boilerplate|stub|skeleton|rename|barrel|docstring|documentation|comments?|test stubs?)\b/i

const DOCS_TOPICS: Array<{ re: RegExp; query: string }> = [
  { re: /\bstripe|webhook|subscription|billing|invoice|payment/i, query: 'stripe webhook signature verification subscription events idempotency' },
  { re: /\bprisma|schema|migration|model\b|database|\bdb\b/i, query: 'prisma schema model fields relations index' },
  { re: /\broute|endpoint|handler|api\b|next\.?js/i, query: 'nextjs app router route handler validation envelope' },
  { re: /\bzod|validation/i, query: 'zod schema validation safeParse types' },
]

const ENV_KEYS_BY_TOPIC: Array<{ re: RegExp; keys: string[] }> = [
  { re: /\bstripe|webhook|subscription|billing|invoice|payment/i, keys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  { re: /\bclerk|auth|login|sign[- ]?in|session/i, keys: ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] },
]

function deterministicRouter(
  prompt: string,
  dna: DnaDocument | null,
  activeModule: string,
  rootPath: string | null,
): RouterDecision {
  const intent = classifyIntent(prompt)
  const category = INTENT_TO_CATEGORY[intent.intent] ?? 'feature_build'
  const complexity = intent.complexity
  const domains = intent.domains

  // --- execution mode (blueprint routing rules, rule 1 + complexity bands)
  let executionMode: PreExecExecutionMode
  if ((LOCAL_ONLY_HINT.test(prompt) || category === 'docs' || category === 'schema_change') && complexity <= 4) {
    executionMode = 'LOCAL_ONLY'
  } else if (complexity <= 3) {
    executionMode = 'LOCAL_ONLY'
  } else if (complexity <= 7 || domains.length <= 2) {
    executionMode = 'HYBRID_PRE_EXECUTE'
  } else {
    executionMode = 'CLOUD_DIRECT_WITH_DNA'
  }
  if (category === 'test_gen' && complexity <= 4) executionMode = 'LOCAL_ONLY'

  // --- workspace facts
  const prismaModels = dna?.fileStats.prismaModels ?? []
  const codeMap = dna?.fileStats.codeMap ?? []
  const mentionedModel = findMentionedModel(prompt, prismaModels)
  const targetRoute = inferTargetRoute(prompt)
  const similarFiles = matchCodeMap(codeMap, prompt)

  // --- plan construction (always cheap-first: git state, then inspections)
  const plan: PreExecPlanStep[] = []
  if (rootPath) {
    plan.push({
      stepId: 'git-state',
      toolName: 'git_diff_summary',
      toolArgs: {},
      expectedArtifact: 'Uncommitted workspace changes to keep the scope guard honest',
    })
  }
  if (mentionedModel || domains.includes('database') || /schema|model|migration|\bdb\b/i.test(prompt)) {
    plan.push({
      stepId: 'schema-inspect',
      toolName: 'schema_inspect',
      toolArgs: mentionedModel ? { modelName: mentionedModel } : {},
      expectedArtifact: mentionedModel
        ? `Exact ${mentionedModel} model fields, types and attributes`
        : 'Available Prisma models for scope selection',
    })
  }
  const astTarget =
    similarFiles[0] ?? targetRoute ?? (mentionedModel ? `prisma/schema.prisma` : null)
  if (astTarget) {
    plan.push({
      stepId: 'ast-lookup',
      toolName: 'ast_symbol_lookup',
      toolArgs: { filePath: astTarget },
      expectedArtifact: `Exact symbol signatures and line numbers in ${astTarget}`,
    })
  }
  const docsTopic = DOCS_TOPICS.find((t) => t.re.test(prompt))
  if (docsTopic) {
    plan.push({
      stepId: 'docs-search',
      toolName: 'local_docs_search',
      toolArgs: { query: docsTopic.query },
      expectedArtifact: `Cached SDK syntax for: ${docsTopic.query}`,
    })
  }

  // --- scaffolds (only when they carry real signal)
  if (mentionedModel && (executionMode === 'LOCAL_ONLY' || executionMode === 'HYBRID_PRE_EXECUTE')) {
    plan.push({
      stepId: 'scaffold-zod',
      toolName: 'scaffold_boilerplate',
      toolArgs: { kind: 'zod-schema', modelName: mentionedModel },
      expectedArtifact: `Staged Zod validation schema for ${mentionedModel}`,
    })
    if (executionMode === 'LOCAL_ONLY') {
      plan.push({
        stepId: 'scaffold-types',
        toolName: 'scaffold_boilerplate',
        toolArgs: { kind: 'ts-types', modelName: mentionedModel },
        expectedArtifact: `Staged TypeScript interface for ${mentionedModel}`,
      })
    }
  }
  if (targetRoute && (executionMode === 'HYBRID_PRE_EXECUTE' || category === 'feature_build') && complexity >= 4) {
    plan.push({
      stepId: 'scaffold-route',
      toolName: 'scaffold_boilerplate',
      toolArgs: { kind: 'route-stub', name: routeName(prompt) ?? 'resource', targetFile: targetRoute },
      expectedArtifact: `Staged ${targetRoute} handler skeleton with the validation envelope`,
    })
  }
  const envKeys = ENV_KEYS_BY_TOPIC.find((t) => t.re.test(prompt))?.keys
  if (envKeys && executionMode !== 'CLOUD_DIRECT_WITH_DNA') {
    plan.push({
      stepId: 'scaffold-env',
      toolName: 'scaffold_boilerplate',
      toolArgs: { kind: 'env-example', keys: envKeys.join(' ') },
      expectedArtifact: `Staged .env.example key names: ${envKeys.join(', ')}`,
    })
  }

  // --- cloud core task spec
  const targetFiles = [...new Set([targetRoute, ...similarFiles.slice(0, 1)].filter(Boolean) as string[])]
  const readOnlyReferenceFiles = [
    ...new Set([
      ...(mentionedModel || domains.includes('database') ? ['prisma/schema.prisma'] : []),
      ...similarFiles.slice(0, 3),
    ]),
  ]
  const coreObjective = sentenceCase(prompt.replace(/\s+/g, ' ').trim())

  const scopeGuardConstraints: string[] = []
  if (dna) {
    dna.codingStandards.slice(0, 4).forEach((s) => scopeGuardConstraints.push(`${s.rule} (${s.source})`))
    if (dna.designPatterns.length > 0) {
      scopeGuardConstraints.push(`Follow established patterns: ${dna.designPatterns.slice(0, 3).join('; ')}`)
    }
  }
  scopeGuardConstraints.push('Zero `any` types; production error handling on every new path; no stubs or TODO comments.')
  if (executionMode === 'HYBRID_PRE_EXECUTE') {
    scopeGuardConstraints.push('Build on the staged artifacts — do not regenerate files already staged by the local agent.')
  }

  const relevantModuleIds = [...new Set([activeModule, ...domains.map(sentenceCase)])].filter(Boolean)

  // --- grounded token estimate (what the main AI no longer has to do)
  const estimatedCloudTokensSaved =
    executionMode === 'LOCAL_ONLY'
      ? complexity * 350
      : Math.round(
          (plan.length * 180 + // inspections the cloud skips
            (mentionedModel ? 320 : 0) +
            (targetRoute ? 420 : 0) + // boilerplate it must not write
            (envKeys ? 60 : 0)) as number,
        )

  return {
    intentCategory: category,
    complexityScore: complexity,
    executionMode,
    relevantModuleIds,
    localPreExecutionPlan: plan,
    cloudCoreTaskSpec: {
      coreObjective,
      targetFiles: targetFiles.length > 0 ? targetFiles : ['(inferred during execution)'],
      readOnlyReferenceFiles,
      scopeGuardConstraints,
    },
    estimatedCloudTokensSaved,
  }
}

/** LLM-produced plans are trimmed to safe size and always get the cheap git
 * state step prepended when missing (AST Scope Guard rule 3 hygiene). */
function sanitizePlan(decision: RouterDecision): RouterDecision {
  const plan = decision.localPreExecutionPlan.slice(0, 8)
  if (!plan.some((s) => s.toolName === 'git_diff_summary')) {
    plan.unshift({
      stepId: 'git-state',
      toolName: 'git_diff_summary',
      toolArgs: {},
      expectedArtifact: 'Uncommitted workspace changes to keep the scope guard honest',
    })
  }
  return { ...decision, localPreExecutionPlan: plan.slice(0, 8) }
}

// ---------------------------------------------------------------------------
// Deterministic Engine 2 — blueprint-format Tier-1 assembler
// ---------------------------------------------------------------------------

function assembleDeterministicTier1(args: {
  projectName: string
  prevPlatform: string
  targetPlatform: string
  prompt: string
  router: RouterDecision
  artifacts: ExecutedArtifact[]
  stagedSpecs: StagedFileSpec[]
  dna: DnaDocument | null
  packetMarkdownStack: string
  continuity: string
  scopedSymbols: Array<{ symbolId: string; signature: string }>
}): Tier1RewrittenPrompt {
  const { router, artifacts, stagedSpecs, dna } = args
  const stateHash = hashString(`${args.projectName}|${Date.now()}`).slice(0, 6)
  const out: string[] = []

  // -- [CORTEX-OS SYNC] header (blueprint example, exact markers)
  out.push(
    `[CORTEX-OS SYNC | Project: ${args.projectName} | State: #${stateHash} | Prev: ${args.prevPlatform} -> Target: ${args.targetPlatform}]`,
  )
  out.push(`- Stack: ${args.packetMarkdownStack}.`)
  out.push(`- Continuity: ${shorten(args.continuity, 150)}`)
  out.push(
    `- Triage: ${router.intentCategory}, complexity ${router.complexityScore}/10 → execution mode ${router.executionMode}.`,
  )
  out.push('')

  // -- [PRE-EXECUTED BY CORTEX LOCAL AGENT — DO NOT REGENERATE]
  out.push('[PRE-EXECUTED BY CORTEX LOCAL AGENT — DO NOT REGENERATE]')
  let index = 0
  for (const artifact of artifacts.filter((a) => a.ok && a.toolName !== 'scaffold_boilerplate')) {
    index += 1
    switch (artifact.toolName) {
      case 'ast_symbol_lookup': {
        const symbols = (artifact.data.symbols as Array<{ name: string; line: number; signature: string }> | undefined) ?? []
        out.push(
          `${index}. ${artifact.data.file} [~${artifact.data.lines}L]: ${symbols
            .slice(0, 4)
            .map((s) => `${s.name} (L${s.line})`)
            .join(', ') || 'no symbols'} verified via AST lookup.`,
        )
        break
      }
      case 'schema_inspect': {
        const fields = (artifact.data.fields as Array<{ name: string; type: string }> | undefined) ?? []
        out.push(
          `${index}. Prisma ${artifact.data.modelName ?? 'schema'} inspected (${artifact.data.schemaPath}): ${fields
            .slice(0, 8)
            .map((f) => `${f.name}: ${f.type}`)
            .join(', ')}${fields.length > 8 ? '…' : ''}.`,
        )
        break
      }
      case 'local_docs_search': {
        const results = (artifact.data.results as Array<{ file: string; heading: string }> | undefined) ?? []
        out.push(
          `${index}. SDK reference pulled from the local docs cache: ${results
            .slice(0, 2)
            .map((r) => `${r.file}#${r.heading}`)
            .join('; ') || artifact.summary}.`,
        )
        break
      }
      case 'git_diff_summary': {
        out.push(`${index}. Workspace state: ${artifact.summary}.`)
        break
      }
      default:
        out.push(`${index}. ${artifact.summary}.`)
    }
  }
  for (const spec of stagedSpecs) {
    index += 1
    out.push(
      `${index}. STAGED ${spec.action === 'create' ? 'new file' : 'update'} ${spec.targetPath} (${spec.kind}) — review & apply from the Cortex staging area before/after this task.`,
    )
  }
  if (artifacts.some((a) => !a.ok)) {
    index += 1
    out.push(
      `${index}. Note: ${artifacts.filter((a) => !a.ok).length} local step(s) could not complete (${artifacts
        .filter((a) => !a.ok)
        .map((a) => `${a.toolName}: ${a.error ?? 'failed'}`)
        .join('; ')}) — treat those facts as unverified.`,
    )
  }
  out.push('')

  // -- [AST SCOPE GUARD & ARCHITECTURE LOCK]
  out.push('[AST SCOPE GUARD & ARCHITECTURE LOCK]')
  const allowed = [
    ...new Set([
      ...router.cloudCoreTaskSpec.targetFiles,
      ...stagedSpecs.map((s) => s.targetPath),
    ]),
  ].filter((p) => p && p !== '(inferred during execution)')
  out.push('- ALLOWED WRITE paths:')
  for (const p of allowed) out.push(`  • ${p}`)
  if (allowed.length === 0) out.push('  • (files inferred by the executing agent — keep the change surface minimal)')
  const protectedPaths = [
    ...new Set([
      'prisma/schema.prisma',
      '.env',
      '.env.local',
      'src/middleware.ts',
      ...(dna ? dna.fileStats.codeMap.slice(0, 2).map((c) => c.path) : []),
    ]),
  ].filter((p) => !allowed.includes(p))
  out.push(`- PROTECTED (DO NOT MODIFY): ${protectedPaths.join(', ')}`)
  out.push('- IMMUTABLE CONSTRAINTS:')
  for (const constraint of router.cloudCoreTaskSpec.scopeGuardConstraints) out.push(`  • ${constraint}`)
  if (args.scopedSymbols.length > 0) {
    out.push('- Scoped symbols (Knowledge Graph, active module):')
    for (const symbol of args.scopedSymbols.slice(0, 5)) {
      out.push(`  • ${symbol.symbolId} — ${shorten(symbol.signature, 90)}`)
    }
  }
  out.push('')

  // -- [CORE EXECUTION SPECIFICATION FOR <PLATFORM>]
  out.push(`[CORE EXECUTION SPECIFICATION FOR ${args.targetPlatform.toUpperCase()}]`)
  const requirements = splitRequirements(args.prompt)
  requirements.forEach((requirement, i) => {
    out.push(`${i + 1}. ${sentenceCase(requirement)}.`)
  })
  out.push(
    `${requirements.length + 1}. Core objective (from the router): ${router.cloudCoreTaskSpec.coreObjective}.`,
  )
  if (router.cloudCoreTaskSpec.readOnlyReferenceFiles.length > 0) {
    out.push(
      `- Read-only references (do not re-scan the tree): ${router.cloudCoreTaskSpec.readOnlyReferenceFiles.join(', ')}.`,
    )
  }
  out.push('')

  // -- [VERIFICATION CRITERIA]
  out.push('[VERIFICATION CRITERIA]')
  out.push('- Every requirement above is implemented and demonstrably working (no placeholders, no stubs).')
  out.push('- No file outside ALLOWED WRITE paths is modified.')
  out.push('- Error paths return the project error envelope; new public input is schema-validated.')
  out.push('- List every file created/modified with a one-line rationale.')

  // -- decomposed subtasks (blueprint Tier1RewrittenPromptSchema)
  const layerFor = (domain: string): DecomposedSubtask['layer'] => {
    if (domain === 'database') return 'database'
    if (domain === 'auth') return 'auth'
    if (domain === 'frontend') return 'frontend'
    if (domain === 'testing') return 'testing'
    return 'backend'
  }
  const domains = router.relevantModuleIds.map((m) => m.toLowerCase())
  const subtasks: DecomposedSubtask[] = []
  let stepNumber = 1
  for (const artifact of artifacts.filter((a) => a.ok)) {
    subtasks.push({
      stepNumber: stepNumber++,
      layer: artifact.toolName === 'schema_inspect' ? 'database' : 'backend',
      action: `${artifact.toolName}: ${artifact.summary}`,
      handledBy: 'COMPLETED_BY_LOCAL_OLLAMA',
    })
  }
  for (const spec of stagedSpecs) {
    subtasks.push({
      stepNumber: stepNumber++,
      layer: spec.kind === 'zod-schema' || spec.kind === 'ts-types' ? 'backend' : 'backend',
      action: `Staged ${spec.kind} at ${spec.targetPath} (apply from the Cortex staging area)`,
      handledBy: 'COMPLETED_BY_LOCAL_OLLAMA',
    })
  }
  requirements.slice(0, 6).forEach((requirement) => {
    subtasks.push({
      stepNumber: stepNumber++,
      layer: layerFor(domains.find(() => true) ?? 'backend'),
      action: sentenceCase(requirement),
      handledBy: 'ASSIGNED_TO_MAIN_AI',
    })
  })

  return {
    taskTitle: shorten(router.cloudCoreTaskSpec.coreObjective, 90),
    targetPlatformOptimized: mapPlatform(args.targetPlatform),
    decomposedSubtasks: subtasks,
    scopeLock: {
      allowedWriteFiles: allowed,
      readOnlyContextFiles: router.cloudCoreTaskSpec.readOnlyReferenceFiles,
      forbiddenPatterns: router.cloudCoreTaskSpec.scopeGuardConstraints,
    },
    finalInjectedMarkdownPrompt: out.join('\n'),
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function persistRun(input: {
  projectId: string
  rawPrompt: string
  targetPlatform: string
  router: RouterDecision
  routerEngine: string
  artifacts: ExecutedArtifact[]
  tier1: Tier1RewrittenPrompt | null
  injectedPrompt: string | null
  handledLocally: boolean
  tokensSavedCloud: number
  tokensContextAvoided: number
  durationMs: number
  stagedSpecs: StagedFileSpec[]
}): Promise<{ id: string; staged: PreExecResult['staged'] }> {
  const run = await db.preExecRun.create({
    data: {
      projectId: input.projectId,
      rawPrompt: input.rawPrompt.slice(0, 8000),
      targetPlatform: input.targetPlatform,
      intentCategory: input.router.intentCategory,
      complexityScore: input.router.complexityScore,
      executionMode: input.router.executionMode,
      routerEngine: input.routerEngine,
      routerDecision: JSON.stringify(input.router),
      artifacts: JSON.stringify(input.artifacts.map((a) => ({ ...a, data: boundArtifactData(a.data) }))),
      cloudCoreTaskSpec: JSON.stringify(input.router.cloudCoreTaskSpec),
      tier1: input.tier1 ? JSON.stringify(input.tier1) : null,
      injectedPrompt: input.injectedPrompt,
      handledLocally: input.handledLocally,
      tokensSavedCloud: Math.max(0, Math.round(input.tokensSavedCloud)),
      tokensContextAvoided: Math.max(0, Math.round(input.tokensContextAvoided)),
      durationMs: input.durationMs,
      stagedCount: input.stagedSpecs.length,
    },
  })

  const stagedRows: PreExecResult['staged'] = []
  const seenTargets = new Set<string>()
  for (const spec of input.stagedSpecs) {
    if (seenTargets.has(spec.targetPath)) continue
    seenTargets.add(spec.targetPath)
    const row = await db.stagedArtifact.create({
      data: {
        projectId: input.projectId,
        runId: run.id,
        toolName: 'scaffold_boilerplate',
        kind: spec.kind,
        action: spec.action,
        targetPath: spec.targetPath,
        content: spec.content,
        rationale: spec.rationale,
        language: spec.language,
        status: 'staged',
      },
    })
    stagedRows.push(toStagedSummary(row))
  }

  const okCount = input.artifacts.filter((a) => a.ok).length
  await db.timelineEvent.create({
    data: {
      projectId: input.projectId,
      kind: input.handledLocally ? 'preexec.local_only' : 'preexec.run',
      message: input.handledLocally
        ? `Pre-execution agent completed the task entirely locally: ${input.artifacts.length} tool step(s), ${input.stagedSpecs.length} file(s) staged, ~${Math.round(input.tokensSavedCloud)} cloud tokens saved.`
        : `Pre-execution agent finished ${okCount}/${input.artifacts.length} local step(s) (${input.router.executionMode}) and composed the Tier-1 ${input.targetPlatform} specification — ~${Math.round(input.tokensSavedCloud)} cloud tokens saved.`,
      meta: JSON.stringify({
        runId: run.id,
        executionMode: input.router.executionMode,
        intentCategory: input.router.intentCategory,
        routerEngine: input.routerEngine,
      }),
    },
  })

  return { id: run.id, staged: stagedRows }
}

function toStagedSummary(row: {
  id: string
  runId: string
  kind: string
  action: string
  targetPath: string
  rationale: string
  language: string
  status: string
  content: string
  appliedAt: Date | null
  createdAt: Date
}): PreExecResult['staged'][number] {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind,
    action: row.action,
    targetPath: row.targetPath,
    rationale: row.rationale,
    language: row.language,
    status: (['staged', 'applied', 'discarded'].includes(row.status) ? row.status : 'staged') as
      | 'staged'
      | 'applied'
      | 'discarded',
    contentLength: row.content.length,
    appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compactDna(dna: DnaDocument | null): Record<string, unknown> {
  if (!dna) return { note: 'no DNA generated yet' }
  return {
    architecturePhilosophy: dna.architecturePhilosophy,
    techStack: dna.techStack,
    codingStandards: dna.codingStandards.slice(0, 8),
    businessRules: dna.businessRules.slice(0, 6),
    designPatterns: dna.designPatterns.slice(0, 5),
    prismaModels: dna.fileStats.prismaModels,
    codeMapTop: dna.fileStats.codeMap.slice(0, 25).map((c) => ({ path: c.path, lines: c.lines, exports: c.exports })),
    astScopeGuardRules: {
      protectedPaths: ['prisma/schema.prisma', '.env', '.env.local', 'src/middleware.ts'],
    },
  }
}

function boundArtifactData(data: Record<string, unknown>): Record<string, unknown> {
  const bounded: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    const serialized = JSON.stringify(value) ?? 'null'
    bounded[key] = serialized.length > 4000 ? `${serialized.slice(0, 4000)}…(truncated)` : value
  }
  return bounded
}

function findMentionedModel(prompt: string, models: string[]): string | null {
  const lower = prompt.toLowerCase()
  for (const model of models) {
    const lowered = model.toLowerCase()
    if (lower.includes(lowered)) return model
    if (lowered.endsWith('y') && lower.includes(`${lowered.slice(0, -1)}ies`)) return model
    if (lower.includes(`${lowered}s`)) return model
  }
  if (/\buser db\b|\busers? (table|model|record|account)\b/i.test(prompt)) {
    const user = models.find((m) => m.toLowerCase() === 'user')
    if (user) return user
  }
  return null
}

function routeName(prompt: string): string | null {
  const webhook = prompt.match(/\b(\w[\w-]*)\s+webhook/i)
  if (webhook) return webhook[1] // "stripe webhook" → "stripe" (path already has webhooks/)
  const page = prompt.match(/\b(\w[\w-]*)\s+(?:page|screen|dashboard)\b/i)
  if (page) return page[1]
  const api = prompt.match(/\b(?:api|endpoint|route)\s+(?:for\s+)?(\w[\w-]*)/i)
  if (api) return api[1]
  return null
}

function inferTargetRoute(prompt: string): string | null {
  const name = routeName(prompt)
  if (!name) return null
  const kebab = kebabCase(name)
  if (/webhook/i.test(prompt)) return `src/app/api/webhooks/${kebab}/route.ts`
  if (/\bapi|endpoint|route\b/i.test(prompt)) return `src/app/api/${kebab}/route.ts`
  if (/\bpage|screen|dashboard\b/i.test(prompt)) return `src/app/${kebab}/page.tsx`
  return null
}

function matchCodeMap(codeMap: Array<{ path: string; lines: number }>, prompt: string): string[] {
  const words = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
  if (words.length === 0) return []
  const scored = codeMap
    .map((entry) => {
      const pathLower = entry.path.toLowerCase()
      let score = 0
      for (const word of words) if (pathLower.includes(word)) score += 1
      return { path: entry.path, lines: entry.lines, score }
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || b.lines - a.lines)
  return scored.slice(0, 3).map((e) => e.path)
}

function mapPlatform(platform: string): Tier1RewrittenPrompt['targetPlatformOptimized'] {
  const allowed = ['codex', 'hermes', 'opencode', 'cursor', 'claude', 'generic'] as const
  return (allowed as readonly string[]).includes(platform) ? (platform as Tier1RewrittenPrompt['targetPlatformOptimized']) : 'generic'
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
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max)}…`
}

function kebabCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export { toStagedSummary }
