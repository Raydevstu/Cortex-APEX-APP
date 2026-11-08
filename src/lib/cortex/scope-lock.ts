/**
 * Phase 4 — AST Semantic Scope Lock store (blueprint PHASE_4 §1.1, §5.1).
 *
 * Persistent, per-project symbol-level write scope:
 *
 *   allowedSymbolFqns — symbols explicitly unlocked for the ACTIVE task
 *                       (IN_SCOPE, emerald — editable by the next agent turn)
 *   lockedSymbolFqns  — symbols explicitly locked (LOCKED, rose — the
 *                       sentinel blocks any mutation of these symbols)
 *   forbiddenPaths    — path-level protected boundaries (fail-closed)
 *
 * The lock is enforced for real by the Phase 3 staging guard: applying a
 * `modify` artifact whose target file contains explicitly locked symbols is
 * rejected (see src/lib/cortex/staging.ts).
 *
 * Storage: the daemon Setting key/value store (`scopeLock:<projectId>`),
 * the same auditable local-first home as the daemon settings.
 */
import { db } from '@/lib/db'
import { ApiError } from './api'
import type { ScopeLockState } from './types'

const scopeLockKey = (projectId: string) => `scopeLock:${projectId}`

/** Path-level protected boundaries mirrored from the Phase 3 staging
 *  deny-list (display form; the regex enforcement lives in staging.ts). */
export const DEFAULT_FORBIDDEN_PATHS: readonly string[] = [
  '.env',
  'prisma/migrations/',
  'src/middleware.ts',
  'package.json',
  'bun.lock',
]

const MAX_SCOPE_ENTRIES = 200

// ---------------------------------------------------------------------------
// Read / seed
// ---------------------------------------------------------------------------

export async function getScopeLock(projectId: string): Promise<ScopeLockState> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) throw new ApiError('Project not found', 404)

  const record = await db.setting.findUnique({ where: { key: scopeLockKey(projectId) } })
  if (record) {
    try {
      const parsed = JSON.parse(record.value) as Partial<ScopeLockState>
      return normalize(parsed, projectId)
    } catch {
      // fall through to reseed on corrupt payload
    }
  }

  // First use — seed deterministically from the latest pre-execution run's
  // Tier-1 scope lock (real files the local agent already scoped), or from
  // the most recent git commit footprint, else start fail-closed (empty
  // allowed set = nothing is in the active write scope).
  const seeded = await seedFromHistory(projectId)
  const state = normalize(
    {
      allowedSymbolFqns: seeded,
      lockedSymbolFqns: [],
      forbiddenPaths: [...DEFAULT_FORBIDDEN_PATHS],
      updatedAt: new Date().toISOString(),
      source: seeded.length > 0 ? 'seed:latest-preexec-scope' : 'seed:fail-closed',
    },
    projectId,
  )
  await db.setting.upsert({
    where: { key: scopeLockKey(projectId) },
    update: { value: JSON.stringify(state) },
    create: { key: scopeLockKey(projectId), value: JSON.stringify(state) },
  })
  return state
}

async function seedFromHistory(projectId: string): Promise<string[]> {
  const run = await db.preExecRun.findFirst({
    where: { projectId, tier1: { not: null } },
    orderBy: { createdAt: 'desc' },
  })
  if (run?.tier1) {
    try {
      const tier1 = JSON.parse(run.tier1) as { scopeLock?: { allowedWriteFiles?: string[] } }
      const files = tier1.scopeLock?.allowedWriteFiles ?? []
      if (files.length > 0) return files.slice(0, MAX_SCOPE_ENTRIES)
    } catch {
      // unreadable tier1 — fall through to git footprint
    }
  }
  const commit = await db.gitCommit.findFirst({
    where: { projectId },
    orderBy: { committedAt: 'desc' },
  })
  if (commit) {
    try {
      const files = JSON.parse(commit.files) as Array<{ path: string }>
      const paths = files.map((f) => f.path).filter(Boolean)
      if (paths.length > 0) return paths.slice(0, MAX_SCOPE_ENTRIES)
    } catch {
      // ignore
    }
  }
  return []
}

// ---------------------------------------------------------------------------
// Mutations (each records a timeline event for the audit trail)
// ---------------------------------------------------------------------------

export async function setScopeLock(
  projectId: string,
  patch: { allowedSymbolFqns?: string[]; lockedSymbolFqns?: string[]; forbiddenPaths?: string[] },
): Promise<ScopeLockState> {
  const current = await getScopeLock(projectId)
  const next = normalize(
    {
      allowedSymbolFqns: patch.allowedSymbolFqns ?? current.allowedSymbolFqns,
      lockedSymbolFqns: patch.lockedSymbolFqns ?? current.lockedSymbolFqns,
      forbiddenPaths: patch.forbiddenPaths ?? current.forbiddenPaths,
      updatedAt: new Date().toISOString(),
      source: 'manual',
    },
    projectId,
  )
  await persist(projectId, next)
  await logScopeEvent(projectId, 'scope.updated', next, `AST scope lock updated — ${next.allowedSymbolFqns.length} in scope, ${next.lockedSymbolFqns.length} locked`)
  return next
}

/**
 * Blueprint POST contract: toggle a symbol's scope. An in-scope symbol is
 * locked (removed from allowed, added to locked); any other symbol is
 * unlocked into the active write scope.
 */
export async function toggleSymbolScope(projectId: string, fqn: string): Promise<ScopeLockState> {
  const clean = fqn.trim()
  if (!clean) throw new ApiError('fqn must be a non-empty symbol reference', 422)
  const current = await getScopeLock(projectId)

  let allowed: string[]
  let locked: string[]
  let action: string
  if (current.allowedSymbolFqns.includes(clean)) {
    allowed = current.allowedSymbolFqns.filter((s) => s !== clean)
    locked = [...new Set([...current.lockedSymbolFqns, clean])]
    action = 'locked'
  } else {
    allowed = [...new Set([...current.allowedSymbolFqns, clean])]
    locked = current.lockedSymbolFqns.filter((s) => s !== clean)
    action = 'unlocked into the active task scope'
  }

  const next = normalize(
    { ...current, allowedSymbolFqns: allowed, lockedSymbolFqns: locked, updatedAt: new Date().toISOString(), source: 'toggle' },
    projectId,
  )
  await persist(projectId, next)
  await logScopeEvent(projectId, 'scope.toggled', next, `Symbol ${action}: ${clean}`)
  return next
}

/** Explicitly lock symbols (AI CTO `LOCK_SYMBOLS` action). */
export async function lockSymbols(projectId: string, fqns: string[]): Promise<ScopeLockState> {
  const clean = fqns.map((f) => f.trim()).filter(Boolean).slice(0, MAX_SCOPE_ENTRIES)
  if (clean.length === 0) throw new ApiError('fqns must contain at least one symbol reference', 422)
  const current = await getScopeLock(projectId)
  const next = normalize(
    {
      ...current,
      allowedSymbolFqns: current.allowedSymbolFqns.filter((s) => !clean.includes(s)),
      lockedSymbolFqns: [...new Set([...current.lockedSymbolFqns, ...clean])],
      updatedAt: new Date().toISOString(),
      source: 'cto-lock-symbols',
    },
    projectId,
  )
  await persist(projectId, next)
  await logScopeEvent(projectId, 'scope.locked', next, `AI CTO locked ${clean.length} symbol(s): ${clean.slice(0, 3).join(', ')}${clean.length > 3 ? '…' : ''}`)
  return next
}

export async function resetScopeLock(projectId: string): Promise<ScopeLockState> {
  await db.setting.delete({ where: { key: scopeLockKey(projectId) } }).catch(() => undefined)
  const state = await getScopeLock(projectId)
  await logScopeEvent(projectId, 'scope.reset', state, 'AST scope lock reset to the deterministic seed')
  return state
}

// ---------------------------------------------------------------------------
// Guard helper (used by the Phase 3 staging apply flow)
// ---------------------------------------------------------------------------

/** True when the file path has at least one explicitly locked symbol
 *  (locked FQNs are `<path>` for whole files or `<path>#<symbol>`). */
export function fileHasLockedSymbols(state: ScopeLockState, filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  return state.lockedSymbolFqns.filter(
    (fqn) => fqn === normalized || fqn.startsWith(`${normalized}#`) || normalized.startsWith(`${fqn}#`),
  )
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function normalize(raw: Partial<ScopeLockState>, projectId: string): ScopeLockState {
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? [...new Set(value.filter((s): s is string => typeof s === 'string' && s.trim().length > 0))].slice(0, MAX_SCOPE_ENTRIES) : []
  return {
    projectId,
    allowedSymbolFqns: list(raw.allowedSymbolFqns),
    lockedSymbolFqns: list(raw.lockedSymbolFqns),
    forbiddenPaths: list(raw.forbiddenPaths).length > 0 ? list(raw.forbiddenPaths) : [...DEFAULT_FORBIDDEN_PATHS],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    source: typeof raw.source === 'string' ? raw.source : 'unknown',
  }
}

async function persist(projectId: string, state: ScopeLockState): Promise<void> {
  await db.setting.upsert({
    where: { key: scopeLockKey(projectId) },
    update: { value: JSON.stringify(state) },
    create: { key: scopeLockKey(projectId), value: JSON.stringify(state) },
  })
}

async function logScopeEvent(
  projectId: string,
  kind: string,
  state: ScopeLockState,
  message: string,
): Promise<void> {
  await db.timelineEvent.create({
    data: {
      projectId,
      kind,
      message,
      meta: JSON.stringify({
        allowed: state.allowedSymbolFqns.length,
        locked: state.lockedSymbolFqns.length,
        forbiddenPaths: state.forbiddenPaths.length,
        source: state.source,
      }),
    },
  })
}
