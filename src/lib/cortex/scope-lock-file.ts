/**
 * Cortex file-sync — keeps `.cortex/active-scope-lock.json` and
 * `.cortex/project-dna.json` on disk in sync with the daemon DB so the
 * external PreToolUse sentinel (`hooks/sentinel_pretooluse.py`) always
 * reads live rules. Best-effort: never throws; skipped when no rootPath.
 */
import { db } from '@/lib/db'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ScopeLockState } from './types'
import { getScopeLock } from './scope-lock'

const DEFAULT_FORBIDDEN_PATHS = ['.env', 'prisma/migrations/', 'src/middleware.ts', 'package.json', 'bun.lock']

export async function syncCortexFiles(projectId: string): Promise<void> {
  try {
    const project = await db.project.findUnique({ where: { id: projectId }, include: { dna: true } })
    if (!project?.rootPath) return
    const root = project.rootPath
    const cortexDir = path.join(root, '.cortex')
    await fs.mkdir(cortexDir, { recursive: true })

    // Scope lock → .cortex/active-scope-lock.json (blueprint shape)
    let scopeState: ScopeLockState | null = null
    try { scopeState = await getScopeLock(projectId) } catch { /* ignore */ }
    const allowedWriteFiles = (scopeState?.allowedSymbolFqns ?? [])
      .map((f) => f.split('#')[0].trim())
      .filter(Boolean)
    const scopeLockPayload = {
      updatedAt: scopeState?.updatedAt ?? new Date().toISOString(),
      allowedWriteFiles: [...new Set(allowedWriteFiles)],
      forbiddenPatterns: scopeState?.forbiddenPaths ?? DEFAULT_FORBIDDEN_PATHS,
    }
    await fs.writeFile(path.join(cortexDir, 'active-scope-lock.json'), JSON.stringify(scopeLockPayload, null, 2), 'utf-8')

    // DNA → .cortex/project-dna.json (blueprint shape)
    if (project.dna) {
      const dna = project.dna
      let codingStandards: Array<{ rule: string; source: string }> = []
      try { codingStandards = JSON.parse(dna.codingStandards) } catch { codingStandards = [] }
      const forbiddenPatterns: string[] = []
      // collect from coding standards rules that mention forbidden libs
      for (const cs of codingStandards) {
        const m = cs.rule.match(/(?:never|forbidden|do not use)\s+([A-Za-z0-9@/_-]+)/i)
        if (m) forbiddenPatterns.push(m[1])
      }
      const dnaPayload = {
        projectMeta: { projectId: project.id, name: project.name, stateHash: 'local' },
        architectureRules: { forbiddenPatterns },
        codingStandards: {
          astScopeGuardRules: {
            protectedPaths: DEFAULT_FORBIDDEN_PATHS,
            disallowAnyType: true,
            maxFunctionLines: 80,
          },
        },
      }
      await fs.writeFile(path.join(cortexDir, 'project-dna.json'), JSON.stringify(dnaPayload, null, 2), 'utf-8')
    }
  } catch {
    // best-effort; never block the caller
  }
}
