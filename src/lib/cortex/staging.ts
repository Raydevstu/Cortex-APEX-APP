/**
 * Staging lifecycle — Phase 3 scope-guard-validated workspace writes.
 *
 * The local agent NEVER writes into the developer's workspace directly:
 * `scaffold_boilerplate` output waits in `staged` state until the developer
 * applies it here. Apply enforces the AST Scope Guard filesystem rules:
 * inside the project root, never protected files (.env, migrations…), never
 * node_modules/.git, `create` never clobbers an existing file, `modify`
 * captures the previous content for a one-click revert.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { ApiError } from './api'
import { resolveInsideWorkspace } from './local-tools'
import { fileHasLockedSymbols, getScopeLock } from './scope-lock'
import { toStagedSummary } from './preexec'
import type { StagedArtifactSummary } from './types'

/** Paths no staged artifact may ever touch (AST Scope Guard deny-list).
 *  `.env.example` is intentionally ALLOWED — it documents key names only. */
const PROTECTED_TARGETS: RegExp[] = [
  /^\.env$/, // real secrets — never writable by the agent
  /^\.env\.(?!example$)[\w.-]*$/i, // .env.local, .env.production … but NOT .env.example
  /^prisma\/migrations\//,
  /^node_modules\//,
  /^\.git\//,
  /^\.next\//,
  /^package(-lock)?\.json$/,
  /^bun\.lockb?$/,
  /^src\/middleware\.ts$/,
]

export interface StagedArtifactDetail extends StagedArtifactSummary {
  content: string
  runRawPrompt: string
}

export async function listStagedArtifacts(
  projectId: string,
  status?: string,
): Promise<StagedArtifactDetail[]> {
  const rows = await db.stagedArtifact.findMany({
    where: {
      projectId,
      ...(status && ['staged', 'applied', 'discarded'].includes(status) ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { run: { select: { rawPrompt: true } } },
  })
  return rows.map((row) => ({
    ...toStagedSummary(row),
    content: row.content,
    runRawPrompt: row.run.rawPrompt,
  }))
}

export async function applyStagedArtifact(id: string): Promise<{
  artifact: StagedArtifactSummary
  writtenPath: string
  merged: boolean
  previousContent: string | null
}> {
  const row = await db.stagedArtifact.findUnique({ where: { id }, include: { project: true } })
  if (!row) throw new ApiError('Staged artifact not found', 404)
  if (row.status !== 'staged') {
    throw new ApiError(`Artifact is already ${row.status} — only staged artifacts can be applied`, 409)
  }
  const project = row.project
  if (!project.rootPath) {
    throw new ApiError('Project has no workspace rootPath — set it before applying staged files', 422)
  }

  // --- AST Scope Guard (filesystem side) -----------------------------------
  const normalized = row.targetPath.replace(/\\/g, '/').replace(/^\.\//, '')
  for (const pattern of PROTECTED_TARGETS) {
    if (pattern.test(normalized)) {
      throw new ApiError(`Scope guard: "${normalized}" is a protected path and can never be applied`, 422)
    }
  }
  const abs = resolveInsideWorkspace(project.rootPath, normalized) // throws on escape

  // --- Phase 4: symbol-level AST Semantic Scope Lock -------------------------
  // A `modify` of a file containing explicitly locked symbols is blocked with
  // the locked FQN list so the agent (or developer) can self-correct.
  if (row.action === 'modify') {
    const scopeLock = await getScopeLock(row.projectId)
    const lockedInFile = fileHasLockedSymbols(scopeLock, normalized)
    if (lockedInFile.length > 0) {
      throw new ApiError(
        `Scope guard: "${normalized}" contains explicitly locked symbol(s): ${lockedInFile.join(', ')}. ` +
        `Unlock them in the Command Center (or via POST /api/cortex/state) before applying a modify.`,
        422,
      )
    }
  }

  let previousContent: string | null = null
  let merged = false

  if (row.action === 'create') {
    if (await fileExists(abs)) {
      throw new ApiError(
        `Scope guard: "${normalized}" already exists in the workspace — stage a modify or review the file first`,
        409,
      )
    }
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, row.content, 'utf-8')
  } else {
    // action === 'modify'
    if (!(await fileExists(abs))) {
      if (row.kind === 'env-example') {
        // .env.example often does not exist yet — create it with the staged keys.
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, row.content, 'utf-8')
      } else {
        throw new ApiError(`Scope guard: "${normalized}" does not exist — cannot modify a missing file`, 409)
      }
    } else if (row.kind === 'env-example' && normalized === '.env.example') {
      // Merge: append only the keys that are missing (never overwrite values).
      const existing = await fs.readFile(abs, 'utf-8')
      const stagedKeys = row.content
        .split('\n')
        .map((l) => l.match(/^([A-Z0-9_]+)=/)?.[1])
        .filter(Boolean) as string[]
      const existingKeys = new Set(
        existing
          .split('\n')
          .map((l) => l.match(/^\s*([A-Z0-9_]+)=/)?.[1])
          .filter(Boolean) as string[],
      )
      const missing = stagedKeys.filter((k) => !existingKeys.has(k))
      if (missing.length === 0) {
        merged = true // nothing to do — every key already present
      } else {
        previousContent = existing
        const addition = `${existing.endsWith('\n') || existing.length === 0 ? '' : '\n'}# --- added by CortexOS local agent ---\n${missing.map((k) => `${k}=`).join('\n')}\n`
        await fs.writeFile(abs, existing + addition, 'utf-8')
        merged = true
      }
    } else {
      previousContent = await fs.readFile(abs, 'utf-8')
      await fs.writeFile(abs, row.content, 'utf-8')
    }
  }

  const updated = await db.stagedArtifact.update({
    where: { id },
    data: { status: 'applied', appliedAt: new Date(), previousContent },
  })

  await db.timelineEvent.create({
    data: {
      projectId: row.projectId,
      kind: 'staging.applied',
      message: `Staged ${row.kind} applied to ${normalized}${merged && row.kind === 'env-example' ? ' (missing keys merged into the existing file)' : ''}.`,
      meta: JSON.stringify({ artifactId: id, runId: row.runId, path: normalized }),
    },
  })

  return {
    artifact: toStagedSummary(updated),
    writtenPath: normalized,
    merged,
    previousContent,
  }
}

export async function discardStagedArtifact(id: string): Promise<StagedArtifactSummary> {
  const row = await db.stagedArtifact.findUnique({ where: { id } })
  if (!row) throw new ApiError('Staged artifact not found', 404)
  if (row.status !== 'staged') {
    throw new ApiError(`Artifact is ${row.status} — only staged artifacts can be discarded (applied ones are reverted)`, 409)
  }

  const updated = await db.stagedArtifact.update({ where: { id }, data: { status: 'discarded' } })
  await db.timelineEvent.create({
    data: {
      projectId: row.projectId,
      kind: 'staging.discarded',
      message: `Staged ${row.kind} for ${row.targetPath} discarded — the workspace was never touched.`,
      meta: JSON.stringify({ artifactId: id, runId: row.runId }),
    },
  })
  return toStagedSummary(updated)
}

export async function revertStagedArtifact(id: string): Promise<{
  artifact: StagedArtifactSummary
  restored: 'deleted' | 'restored' | 'already-clean'
}> {
  const row = await db.stagedArtifact.findUnique({ where: { id }, include: { project: true } })
  if (!row) throw new ApiError('Staged artifact not found', 404)
  if (row.status !== 'applied') {
    throw new ApiError('Only applied artifacts can be reverted', 409)
  }
  const project = row.project
  if (!project.rootPath) throw new ApiError('Project has no workspace rootPath', 422)

  const normalized = row.targetPath.replace(/\\/g, '/').replace(/^\.\//, '')
  const abs = resolveInsideWorkspace(project.rootPath, normalized)

  let restored: 'deleted' | 'restored' | 'already-clean'
  if (row.action === 'create') {
    if (await fileExists(abs)) {
      await fs.unlink(abs)
      restored = 'deleted'
    } else {
      restored = 'already-clean'
    }
  } else {
    // modify: restore previousContent when captured; env-example merges are
    // content-additive and recorded, so the restore is exact.
    if (row.previousContent !== null) {
      await fs.writeFile(abs, row.previousContent, 'utf-8')
      restored = 'restored'
    } else if (await fileExists(abs)) {
      // Applied merge that added nothing — nothing to restore.
      restored = 'already-clean'
    } else {
      restored = 'already-clean'
    }
  }

  const updated = await db.stagedArtifact.update({
    where: { id },
    data: { status: 'staged', appliedAt: null, previousContent: null },
  })
  await db.timelineEvent.create({
    data: {
      projectId: row.projectId,
      kind: 'staging.reverted',
      message: `Applied ${row.kind} at ${normalized} reverted (${restored}).`,
      meta: JSON.stringify({ artifactId: id, runId: row.runId, path: normalized }),
    },
  })
  return { artifact: toStagedSummary(updated), restored }
}

async function fileExists(abs: string): Promise<boolean> {
  try {
    const stat = await fs.stat(abs)
    return stat.isFile()
  } catch {
    return false
  }
}
