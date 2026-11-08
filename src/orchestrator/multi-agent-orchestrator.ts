/**
 * Phase 4 — Multi-Agent Execution DAG Orchestrator
 * (blueprint PHASE_4 §1.4 + §4 `buildExecutionPlan` / `computeExecutionWaves`).
 *
 * Decomposes a complex feature goal into a topologically ordered DAG of
 * subtasks and splits them across execution tiers exactly as the blueprint
 * prescribes:
 *
 *   - LOCAL (0 cloud tokens): contract/schema validation, AST scope
 *     verification, unit-test scaffolding, docs/memory sync — executed by the
 *     local Ollama agent tier.
 *   - CLOUD: the core cross-module implementation — dispatched to the main
 *     cloud model with a strict `allowedSymbolFqns` scope lock and a Tier-1
 *     execution payload.
 *
 * Wave computation is a pure Kahn topological sort with cycle detection, so
 * it is deterministically unit-testable.
 */
import { classifyIntent, splitRequirements } from '@/lib/cortex/intent'
import { getSettings } from '@/lib/cortex/settings'
import type { DAGSubTask, DAGSubTaskRecord } from '@/lib/cortex/types'

// ---------------------------------------------------------------------------
// Wave computation (pure, deterministic)
// ---------------------------------------------------------------------------

/**
 * Kahn topological sort into execution waves. Every wave contains only
 * subtasks whose dependencies are fully satisfied by all previous waves.
 * Throws on dependency cycles or unknown dependency ids (contract violation).
 */
export function computeExecutionWaves(subtasks: Array<Pick<DAGSubTask, 'id' | 'dependencies'>>): string[][] {
  const ids = new Set(subtasks.map((s) => s.id))
  for (const task of subtasks) {
    for (const dep of task.dependencies) {
      if (!ids.has(dep)) {
        throw new Error(`DAG contract violation: subtask "${task.id}" depends on unknown "${dep}"`)
      }
    }
  }

  const waves: string[][] = []
  const placed = new Set<string>()
  let remaining = [...subtasks]

  while (remaining.length > 0) {
    const wave = remaining
      .filter((task) => task.dependencies.every((dep) => placed.has(dep)))
      .map((task) => task.id)
    if (wave.length === 0) {
      throw new Error(
        `DAG cycle detected among: ${remaining.map((t) => t.id).join(', ')}`,
      )
    }
    for (const id of wave) placed.add(id)
    waves.push(wave.sort())
    remaining = remaining.filter((task) => !placed.has(task.id))
  }

  return waves
}

/** Assign each subtask its wave index (1-based) from the wave list. */
export function waveIndexOf(subtaskId: string, waves: string[][]): number {
  for (let i = 0; i < waves.length; i++) {
    if (waves[i].includes(subtaskId)) return i + 1
  }
  return 1
}

// ---------------------------------------------------------------------------
// Goal decomposition
// ---------------------------------------------------------------------------

export interface DecomposeContext {
  projectId: string
  projectName: string
  /** Known symbol FQNs in the active scope (workspace audit or graph). */
  knownSymbolFqns: string[]
  /** Symbols explicitly unlocked for the active task (scope lock). */
  allowedSymbolFqns: string[]
}

export interface DecomposedPlan {
  subtasks: Array<DAGSubTask & { wave: number }>
  waves: string[][]
  intent: string
  complexity: number
}

/** Split a goal into the blueprint's canonical local/cloud DAG shape. */
export async function decomposeGoal(goal: string, ctx: DecomposeContext): Promise<DecomposedPlan> {
  const settings = await getSettings()
  const intent = classifyIntent(goal)
  const requirements = splitRequirements(goal)

  const scope = ctx.allowedSymbolFqns.length > 0 ? ctx.allowedSymbolFqns : ctx.knownSymbolFqns
  const contractSymbols = pickSymbols(scope, /(schema|contract|types?|dto|zod)/i, 4)
  const coreSymbols = scope.slice(0, 8)
  const testSymbols = pickSymbols(scope, /(test|spec)/i, 3).length > 0
    ? pickSymbols(scope, /(test|spec)/i, 3)
    : coreSymbols.slice(0, 4)

  const requirementLines = requirements.length > 0
    ? requirements.map((r, i) => `  ${i + 1}. ${r}`).join('\n')
    : `  1. ${goal}`

  const localAgent = `local-ollama:${settings.ollamaRouterModel}`
  const cloudAgent = `cloud:${settings.cloudEscalationModel}`

  const subtasks: DAGSubTask[] = [
    {
      id: 'subtask-1-contract-validation',
      title: 'Validate TypeScript contracts & schema invariants',
      assignedAgent: localAgent,
      agentKind: 'local',
      dependencies: [],
      allowedSymbolFqns: contractSymbols.length > 0 ? contractSymbols : coreSymbols.slice(0, 2),
      prompt:
        `Verify strict contract alignment for the goal below against the live workspace ` +
        `(ast_symbol_lookup + schema_inspect). Confirm the schema/type contracts referenced ` +
        `by the task exist and are coherent before any implementation starts.\nGoal: ${goal}\nRequirements:\n${requirementLines}`,
    },
    {
      id: 'subtask-2-core-implementation',
      title: 'Execute scoped core implementation within AST guardrails',
      assignedAgent: cloudAgent,
      agentKind: 'cloud',
      dependencies: ['subtask-1-contract-validation'],
      allowedSymbolFqns: coreSymbols,
      prompt:
        `Implement the core logic for the goal below strictly within the allowed AST symbols ` +
        `(${coreSymbols.join(', ') || 'scope defined by the Tier-1 payload'}). Do not modify any symbol ` +
        `outside the scope lock; pre-executed local artifacts are provided and must not be regenerated.\nGoal: ${goal}`,
    },
    {
      id: 'subtask-3-tdd-verification',
      title: 'Synthesize & run deterministic unit tests',
      assignedAgent: localAgent,
      agentKind: 'local',
      dependencies: ['subtask-2-core-implementation'],
      allowedSymbolFqns: testSymbols,
      prompt:
        `Generate and execute unit-test coverage for the symbols modified by "${goal}". ` +
        `Stage test scaffolds behind the AST Scope Guard (never blind-write).`,
    },
    {
      id: 'subtask-4-continuity-sync',
      title: 'Commit turn memory & update Knowledge Graph',
      assignedAgent: localAgent,
      agentKind: 'local',
      dependencies: ['subtask-2-core-implementation'],
      allowedSymbolFqns: [],
      prompt:
        `Run the memory extractor over the completed turn for "${goal}" ` +
        `(cortex_log_decision contract): ratify decisions, update tasks, index the episode. ` +
        `This keeps every platform (Codex / Hermes / Cursor / Claude) synced without re-explaining the repo.`,
    },
  ]

  const waves = computeExecutionWaves(subtasks)
  const withWaves: Array<DAGSubTask & { wave: number }> = subtasks.map((task) => ({
    ...task,
    wave: waveIndexOf(task.id, waves),
  }))

  return { subtasks: withWaves, waves, intent: intent.intent, complexity: intent.complexity }
}

/** Turn stored subtask records into fresh dispatch records (status reset). */
export function toDispatchRecords(
  subtasks: Array<DAGSubTask & { wave?: number }>,
  waves: string[][],
): DAGSubTaskRecord[] {
  return subtasks.map((task) => ({
    ...task,
    wave: task.wave ?? waveIndexOf(task.id, waves),
    status: 'pending' as const,
  }))
}

/**
 * Grounded token-savings estimate for a plan: local subtasks run at 0 cloud
 * tokens; each local step also avoids re-reading repo context (~1.4k tokens
 * per the Phase 3 accounting baseline).
 */
export function estimatePlanTokenSavings(subtasks: Array<{ agentKind: 'local' | 'cloud' }>): number {
  const local = subtasks.filter((s) => s.agentKind === 'local').length
  return local * 1400
}

function pickSymbols(scope: string[], pattern: RegExp, max: number): string[] {
  const hits = scope.filter((fqn) => pattern.test(fqn))
  return hits.slice(0, max)
}
