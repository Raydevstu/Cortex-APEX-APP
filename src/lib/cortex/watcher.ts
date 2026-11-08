/**
 * File Watcher — Phase 2 "work done in Codex automatically updates the
 * Knowledge Graph" (blueprint §6, Chokidar per §5).
 *
 * Watches a project's rootPath inside the daemon process and, on every file
 * add/change/unlink:
 *   1. computes a content hash ("astHash") + line count + export summary
 *      with a deterministic parser (no LLM tokens — Tier 1 code map),
 *   2. upserts a `file` graph node under the owning module with
 *      CONTAINS edges, and
 *   3. appends an immutable timeline event (file.added / file.changed /
 *      file.removed) — which the sync packet's active-module inference and
 *      the Development Timeline both consume.
 */
import chokidar, { type FSWatcher } from 'chokidar'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { upsertNode, upsertEdge } from './graph'

const IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.next/**',
  '**/dist/**',
  '**/build/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/.cortex/**',
  '**/*.log',
]

const WATCH_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.prisma', '.css',
  '.scss', '.sql', '.md', '.py', '.go', '.rs', '.java', '.rb', '.php', '.sh',
  '.yaml', '.yml', '.toml', '.vue', '.svelte',
])

const MAX_FILE_BYTES = 512 * 1024
const DEBOUNCE_MS = 400

interface WatcherEntry {
  projectId: string
  rootPath: string
  watcher: FSWatcher
  startedAt: Date
  events: number
  errors: number
  lastEventAt: Date | null
  lastEventPath: string | null
  lastError: string | null
  timers: Map<string, ReturnType<typeof setTimeout>>
}

// Module-level registry — one watcher per project inside the daemon process.
const registry = new Map<string, WatcherEntry>()

const bootstrapped = globalThis as typeof globalThis & { __cortexWatchBootstrapped?: boolean }

export async function startWatcher(projectId: string): Promise<{ started: boolean; reason?: string }> {
  if (registry.has(projectId)) return { started: true, reason: 'already running' }

  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) throw new Error('Project not found')
  if (!project.rootPath) return { started: false, reason: 'project has no rootPath — set the workspace path first' }

  const rootPath = path.resolve(project.rootPath)
  let stat
  try {
    stat = await fs.stat(rootPath)
  } catch {
    return { started: false, reason: `rootPath does not exist: ${rootPath}` }
  }
  if (!stat.isDirectory()) return { started: false, reason: `rootPath is not a directory: ${rootPath}` }

  const entry: WatcherEntry = {
    projectId,
    rootPath,
    watcher: null as unknown as FSWatcher,
    startedAt: new Date(),
    events: 0,
    errors: 0,
    lastEventAt: null,
    lastEventPath: null,
    lastError: null,
    timers: new Map(),
  }

  entry.watcher = chokidar.watch(rootPath, {
    ignored: (testPath) => isIgnored(testPath, rootPath),
    ignoreInitial: false,
    persistent: true,
    depth: 8,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
  })

  entry.watcher
    .on('add', (absPath) => schedule(entry, absPath, 'added'))
    .on('change', (absPath) => schedule(entry, absPath, 'changed'))
    .on('unlink', (absPath) => schedule(entry, absPath, 'removed'))
    .on('error', (error) => {
      entry.errors += 1
      entry.lastError = error instanceof Error ? error.message : String(error)
    })

  registry.set(projectId, entry)
  return { started: true }
}

export async function stopWatcher(projectId: string): Promise<{ stopped: boolean; reason?: string }> {
  const entry = registry.get(projectId)
  if (!entry) return { stopped: false, reason: 'not running' }
  for (const timer of entry.timers.values()) clearTimeout(timer)
  entry.timers.clear()
  await entry.watcher.close()
  registry.delete(projectId)
  return { stopped: true }
}

export async function watcherStatus(projectId?: string) {
  const projects = projectId
    ? await db.project.findMany({ where: { id: projectId } })
    : await db.project.findMany({ orderBy: { updatedAt: 'desc' } })

  return projects.map((project) => {
    const entry = registry.get(project.id)
    let watchedFiles = 0
    if (entry) {
      const watched = entry.watcher.getWatched()
      for (const files of Object.values(watched)) {
        watchedFiles += Array.isArray(files) ? files.length : 0
      }
    }
    return {
      projectId: project.id,
      slug: project.slug,
      projectName: project.name,
      running: Boolean(entry),
      rootPath: project.rootPath,
      watchEnabled: project.watchEnabled,
      watchedFiles,
      events: entry?.events ?? 0,
      errors: entry?.errors ?? 0,
      startedAt: entry?.startedAt.toISOString() ?? null,
      lastEventAt: entry?.lastEventAt?.toISOString() ?? null,
      lastEventPath: entry?.lastEventPath ?? null,
      lastError: entry?.lastError ?? null,
    }
  })
}

/**
 * Daemon boot hook (instrumentation.ts): start watchers for every project
 * flagged watchEnabled, so "Codex saves a file → graph updates" needs zero
 * manual action after a restart.
 */
export async function bootstrapWatchers(): Promise<{ started: string[]; skipped: string[] }> {
  if (bootstrapped.__cortexWatchBootstrapped) return { started: [], skipped: [] }
  bootstrapped.__cortexWatchBootstrapped = true

  const enabled = await db.project.findMany({ where: { watchEnabled: true } })
  const started: string[] = []
  const skipped: string[] = []
  for (const project of enabled) {
    try {
      const result = await startWatcher(project.id)
      if (result.started) started.push(project.slug)
      else skipped.push(`${project.slug}: ${result.reason}`)
    } catch (error) {
      skipped.push(`${project.slug}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (started.length > 0 || skipped.length > 0) {
    console.log(`[cortexd] file watchers bootstrapped — started: ${started.join(', ') || 'none'}${skipped.length ? ` · skipped: ${skipped.join('; ')}` : ''}`)
  }
  return { started, skipped }
}

/** Test helper — stop everything (used by the automated suite). */
export async function stopAllWatchers(): Promise<void> {
  for (const projectId of [...registry.keys()]) {
    await stopWatcher(projectId)
  }
}

// ---------------------------------------------------------------------------
// Event pipeline
// ---------------------------------------------------------------------------

function schedule(entry: WatcherEntry, absPath: string, action: 'added' | 'changed' | 'removed'): void {
  const existing = entry.timers.get(absPath)
  if (existing) clearTimeout(existing)
  entry.timers.set(
    absPath,
    setTimeout(() => {
      entry.timers.delete(absPath)
      void handleFileEvent(entry, absPath, action)
    }, DEBOUNCE_MS),
  )
}

async function handleFileEvent(entry: WatcherEntry, absPath: string, action: 'added' | 'changed' | 'removed'): Promise<void> {
  const relativePath = path.relative(entry.rootPath, absPath).split(path.sep).join('/')
  try {
    entry.events += 1
    entry.lastEventAt = new Date()
    entry.lastEventPath = relativePath

    if (action === 'removed') {
      await removeFileNode(entry.projectId, relativePath)
      await recordEvent(entry.projectId, 'file.removed', relativePath, null)
      return
    }

    const stat = await fs.stat(absPath)
    if (stat.size > MAX_FILE_BYTES) {
      await recordEvent(entry.projectId, 'file.skipped', relativePath, { reason: 'size' })
      return
    }
    const content = await fs.readFile(absPath, 'utf8')
    const language = languageFor(relativePath)
    const astHash = createHash('sha256').update(content).digest('hex').slice(0, 16)
    const lines = content.split('\n').length
    const exportsSummary = summarizeExports(content)

    const moduleLabel = await upsertFileNode(entry.projectId, relativePath, {
      astHash,
      lines,
      language,
      exportsSummary,
      lastModifiedBy: 'watcher',
    })

    await recordEvent(entry.projectId, action === 'added' ? 'file.added' : 'file.changed', relativePath, {
      astHash,
      lines,
      module: moduleLabel,
    })
  } catch (error) {
    entry.errors += 1
    entry.lastError = error instanceof Error ? error.message : String(error)
  }
}

async function upsertFileNode(
  projectId: string,
  relativePath: string,
  props: { astHash: string; lines: number; language: string; exportsSummary: string; lastModifiedBy: string },
): Promise<string> {
  const rootId = await ensureRoot(projectId)
  const moduleLabel = await ensureModuleForPath(projectId, relativePath, rootId)

  const moduleId = await upsertNode(projectId, 'module', moduleLabel, { source: 'watcher' })
  await upsertEdge(projectId, rootId, moduleId, 'CONTAINS')
  const fileId = await upsertNode(projectId, 'file', relativePath, props)
  await upsertEdge(projectId, moduleId, fileId, 'CONTAINS')
  return moduleLabel
}

async function removeFileNode(projectId: string, relativePath: string): Promise<void> {
  const existing = await db.graphNode.findUnique({
    where: { projectId_kind_label: { projectId, kind: 'file', label: relativePath } },
  })
  if (existing) {
    await db.graphNode.delete({ where: { id: existing.id } }) // cascades edges
  }
}

async function ensureRoot(projectId: string): Promise<string> {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) throw new Error('Project vanished while watching')
  return upsertNode(projectId, 'root', project.name, { role: 'project-root' })
}

/** Map a file path to its owning module: longest matching module dir wins,
 *  else the top-level directory, else the project root. */
async function ensureModuleForPath(projectId: string, relativePath: string, rootId: string): Promise<string> {
  const modules = await db.graphNode.findMany({ where: { projectId, kind: 'module' } })
  let best: { label: string; dir: string } | null = null
  for (const module of modules) {
    const dir = safeParse(module.props).dir
    if (typeof dir === 'string' && dir.length > 0 && relativePath.startsWith(dir)) {
      if (!best || dir.length > best.dir.length) best = { label: module.label, dir }
    }
  }
  if (best) return best.label

  const topDir = relativePath.split('/')[0]
  if (!topDir || topDir === relativePath) {
    const root = await db.graphNode.findUnique({ where: { id: rootId } })
    return root?.label ?? 'Root'
  }
  return topDir.charAt(0).toUpperCase() + topDir.slice(1)
}

async function recordEvent(
  projectId: string,
  kind: string,
  relativePath: string,
  meta: Record<string, unknown> | null,
): Promise<void> {
  await db.timelineEvent.create({
    data: {
      projectId,
      kind,
      message: `${kind === 'file.changed' ? 'File changed' : kind === 'file.added' ? 'File added' : kind === 'file.removed' ? 'File removed' : 'File skipped'}: ${relativePath}`,
      meta: meta ? JSON.stringify({ path: relativePath, ...meta }) : JSON.stringify({ path: relativePath }),
    },
  })
}

// ---------------------------------------------------------------------------
// Deterministic code-map helpers (Tier 1 memory — no LLM tokens)
// ---------------------------------------------------------------------------

function isIgnored(testPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, testPath).split(path.sep).join('/')
  if (relative === '' || relative.startsWith('..')) return false // root itself
  for (const glob of IGNORE_GLOBS) {
    const dir = glob.replace('**/', '').replace('/**', '')
    if (relative === dir || relative.startsWith(`${dir}/`)) return true
  }
  const ext = path.extname(testPath).toLowerCase()
  if (ext && !WATCH_EXTENSIONS.has(ext)) return true
  return false
}

function languageFor(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase()
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.mjs': 'javascript', '.cjs': 'javascript', '.json': 'json', '.prisma': 'prisma',
    '.css': 'css', '.scss': 'scss', '.sql': 'sql', '.md': 'markdown', '.py': 'python',
    '.go': 'go', '.rs': 'rust', '.java': 'java', '.rb': 'ruby', '.php': 'php',
    '.sh': 'shell', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.vue': 'vue', '.svelte': 'svelte',
  }
  return map[ext] ?? 'text'
}

/** Compact export summary — the deterministic stand-in for a Tree-sitter
 *  symbol table at Phase 2 scale (same signature/index output class). */
function summarizeExports(content: string): string {
  if (content.length === 0) return ''
  const names = new Set<string>()
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+default\s+function\s+([A-Za-z_$][\w$]*)/g,
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      names.add(match[1])
      if (names.size >= 12) break
    }
    if (names.size >= 12) break
  }
  const list = [...names]
  if (list.length === 0) return ''
  const shown = list.slice(0, 6).join(', ')
  return list.length > 6 ? `${shown} +${list.length - 6} more` : shown
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}
