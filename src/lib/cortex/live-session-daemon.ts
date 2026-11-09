// src/lib/cortex/live-session-daemon.ts
//
// Gap #3 — Unattended Live Session Watcher.
//
// Tails Codex CLI / Claude Code / Hermes / OpenCode JSONL transcripts with
// byte-offset cursors, debounces multi-step turns, deduplicates against MCP
// commits via SHA-256 turn fingerprints, computes AST symbol diffs, runs Engine 3
// (extractAndApplyMemoryDelta — local Ollama or deterministic), and writes the
// result to `.cortex/continuity-ledger.json`, `.cortex/project-dna.json` and
// `.cortex/live-deltas.cypher` so any platform can resume instantly.
//
// Adapted to the existing CortexOS Next.js daemon architecture (chokidar 4,
// Prisma + SQLite, no new runtime deps).

import chokidar, { type FSWatcher } from 'chokidar'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { db } from '@/lib/db'
import { extractAndApplyMemoryDelta } from './memory-delta'
import { parseTranscriptLine as normalizeLine } from './transcript-normalizer'
import type { NormalizedTranscriptEvent } from './transcript-normalizer'
import type { ExtractSourcePlatform } from './types'

const execFileAsync = promisify(execFile)

export type { NormalizedTranscriptEvent } from './transcript-normalizer'

interface PendingTurnBuffer {
  platform: ExtractSourcePlatform
  sessionId: string
  lastUserPrompt: string
  accumulatedAssistantText: string[]
  touchedFilesSinceTurnStart: Set<string>
  debounceTimer?: NodeJS.Timeout
}

interface SymbolEntry {
  name: string
  signature: string
  startLine: number
  endLine: number
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.prisma'])
const MAX_FILE_BYTES = 256 * 1024
const DEBOUNCE_DEFAULT_MS = 2500

export class UnattendedLiveSessionDaemon {
  private projectRoot: string
  private projectId: string | null
  private cortexDir: string
  private quietWindowMs: number

  private fileByteOffsets = new Map<string, number>()
  private symbolBaselineCache = new Map<string, Map<string, SymbolEntry>>()
  private processedTurnHashes = new Set<string>()
  private activeTurns = new Map<string, PendingTurnBuffer>()

  private transcriptWatcher?: FSWatcher
  private workspaceWatcher?: FSWatcher

  constructor(projectRoot: string, projectId?: string | null, quietWindowMs = DEBOUNCE_DEFAULT_MS) {
    this.projectRoot = path.resolve(projectRoot)
    this.projectId = projectId ?? null
    this.cortexDir = path.join(this.projectRoot, '.cortex')
    this.quietWindowMs = quietWindowMs
  }

  public async start(): Promise<void> {
    await this.seedSymbolBaseline()
    await this.loadPersistedCursors()
    if (!this.projectId) this.projectId = await this.resolveProjectId()

    const home = os.homedir()
    const transcriptGlobs = [
      path.join(home, '.codex', 'sessions', '**', '*.jsonl'),
      path.join(home, '.claude', 'projects', '**', '*.jsonl'),
      path.join(home, '.hermes', 'sessions', '**', '*.jsonl'),
      path.join(this.cortexDir, 'pty-spool', '*.jsonl'),
    ]

    this.transcriptWatcher = chokidar.watch(transcriptGlobs, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
    })
    this.transcriptWatcher.on('add', (fp) => this.initializeFileCursor(fp))
    this.transcriptWatcher.on('change', (fp) => void this.handleTranscriptAppend(fp))
    this.transcriptWatcher.on('error', (err) => console.error('[cortexd watcher] transcript error:', err))

    this.workspaceWatcher = chokidar.watch(this.projectRoot, {
      persistent: true,
      ignoreInitial: true,
      ignored: [
        /(^|[\\/])\../,
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
      ],
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    })
    this.workspaceWatcher.on('change', (fp) => this.handleWorkspaceFileModified(fp))
    this.workspaceWatcher.on('add', (fp) => this.handleWorkspaceFileModified(fp))
    this.workspaceWatcher.on('error', (err) => console.error('[cortexd watcher] workspace error:', err))
  }

  public async stop(): Promise<void> {
    await this.transcriptWatcher?.close()
    await this.workspaceWatcher?.close()
    await this.persistCursors()
    for (const b of this.activeTurns.values()) if (b.debounceTimer) clearTimeout(b.debounceTimer)
    this.activeTurns.clear()
  }

  private async resolveProjectId(): Promise<string | null> {
    try {
      const project = await db.project.findFirst({ where: { rootPath: this.projectRoot } })
      return project?.id ?? null
    } catch {
      return null
    }
  }

  private async initializeFileCursor(filePath: string): Promise<void> {
    if (this.fileByteOffsets.has(filePath)) return
    try {
      const stat = await fs.stat(filePath)
      this.fileByteOffsets.set(filePath, stat.size)
    } catch {
      // transient temp file — ignore
    }
  }

  private async handleTranscriptAppend(filePath: string): Promise<void> {
    try {
      const stat = await fs.stat(filePath)
      const prevOffset = this.fileByteOffsets.get(filePath) ?? 0
      const readStart = stat.size < prevOffset ? 0 : prevOffset
      const byteLength = stat.size - readStart
      if (byteLength <= 0) return

      const handle = await fs.open(filePath, 'r')
      try {
        const buffer = Buffer.alloc(byteLength)
        await handle.read(buffer, 0, byteLength, readStart)
        this.fileByteOffsets.set(filePath, stat.size)
        const chunk = buffer.toString('utf-8')
        const lines = chunk.split('\n').filter((l) => l.trim().length > 0)
        for (const rawLine of lines) {
          const event = this.parseTranscriptLine(filePath, rawLine)
          if (event && this.belongsToCurrentProject(filePath, event)) {
            this.ingestNormalizedEvent(event)
          }
        }
      } finally {
        await handle.close()
      }
    } catch (err) {
      console.error(`[cortexd watcher] error reading transcript ${filePath}:`, err instanceof Error ? err.message : err)
    }
  }

  public parseTranscriptLine(filePath: string, rawJsonLine: string): NormalizedTranscriptEvent | null {
    return normalizeLine(filePath, rawJsonLine)
  }

  private belongsToCurrentProject(filePath: string, event: NormalizedTranscriptEvent): boolean {
    if (event.projectPath) {
      try {
        return path.resolve(event.projectPath) === this.projectRoot
      } catch {
        return false
      }
    }
    const encodedRoot = this.projectRoot.replace(/[\\/:\s]/g, '-')
    if (filePath.replace(/\\/g, '/').includes(encodedRoot)) return true
    // Conservative fallback: attribute to current project when no path is recorded.
    return true
  }

  private ingestNormalizedEvent(event: NormalizedTranscriptEvent): void {
    const key = `${event.platform}:${event.sessionId}`
    let buffer = this.activeTurns.get(key)
    if (!buffer) {
      buffer = {
        platform: event.platform,
        sessionId: event.sessionId,
        lastUserPrompt: '',
        accumulatedAssistantText: [],
        touchedFilesSinceTurnStart: new Set<string>(),
      }
      this.activeTurns.set(key, buffer)
    }

    if (event.role === 'user') {
      if (buffer.lastUserPrompt && buffer.accumulatedAssistantText.length > 0) {
        if (buffer.debounceTimer) clearTimeout(buffer.debounceTimer)
        void this.flushCompletedTurn(key, buffer)
      }
      buffer.lastUserPrompt = event.text
      buffer.accumulatedAssistantText = []
    } else {
      buffer.accumulatedAssistantText.push(event.text)
      if (buffer.debounceTimer) clearTimeout(buffer.debounceTimer)
      buffer.debounceTimer = setTimeout(() => void this.flushCompletedTurn(key, buffer!), this.quietWindowMs)
    }
  }

  private handleWorkspaceFileModified(absFilePath: string): void {
    const ext = path.extname(absFilePath).toLowerCase()
    if (!SOURCE_EXTS.has(ext)) return
    const relPath = path.relative(this.projectRoot, absFilePath).replace(/\\/g, '/')
    if (relPath.startsWith('..')) return

    if (this.activeTurns.size > 0) {
      for (const buffer of this.activeTurns.values()) buffer.touchedFilesSinceTurnStart.add(relPath)
      return
    }
    const fallbackKey = 'cursor:workspace-fs-save'
    let buffer = this.activeTurns.get(fallbackKey)
    if (!buffer) {
      buffer = {
        platform: 'cursor',
        sessionId: 'workspace-fs-save',
        lastUserPrompt: 'Direct workspace code modification / inline AI edit',
        accumulatedAssistantText: ['Modified workspace files'],
        touchedFilesSinceTurnStart: new Set<string>(),
      }
      this.activeTurns.set(fallbackKey, buffer)
    }
    buffer.touchedFilesSinceTurnStart.add(relPath)
    if (buffer.debounceTimer) clearTimeout(buffer.debounceTimer)
    buffer.debounceTimer = setTimeout(() => void this.flushCompletedTurn(fallbackKey, buffer!), this.quietWindowMs)
  }

  private async flushCompletedTurn(key: string, buffer: PendingTurnBuffer): Promise<void> {
    const prompt = buffer.lastUserPrompt.trim()
    const aiResponse = buffer.accumulatedAssistantText.join('\n\n').trim()
    const touchedFiles = Array.from(buffer.touchedFilesSinceTurnStart)

    buffer.accumulatedAssistantText = []
    buffer.touchedFilesSinceTurnStart.clear()
    this.activeTurns.delete(key)
    if (buffer.debounceTimer) clearTimeout(buffer.debounceTimer)

    if (!prompt && touchedFiles.length === 0) return
    if (!this.projectId) return

    const turnFingerprint = createHash('sha256')
      .update(`${buffer.platform}:${prompt}:${aiResponse.slice(0, 300)}:${touchedFiles.join(',')}`)
      .digest('hex')
      .slice(0, 20)
    if (this.processedTurnHashes.has(turnFingerprint)) return
    this.processedTurnHashes.add(turnFingerprint)

    let gitDirtyFiles: string[] = []
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: this.projectRoot })
      gitDirtyFiles = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.slice(3).trim())
        .filter((f) => SOURCE_EXTS.has(path.extname(f).toLowerCase()))
    } catch {
      gitDirtyFiles = []
    }
    const allModifiedFiles = Array.from(new Set([...touchedFiles, ...gitDirtyFiles]))

    const modifiedFilesAstDiff = await this.computeAstSymbolDiffs(allModifiedFiles)

    let memoryReport
    try {
      memoryReport = await extractAndApplyMemoryDelta({
        projectId: this.projectId,
        sourcePlatform: buffer.platform as ExtractSourcePlatform,
        rawUserPrompt: prompt || 'Unattended workspace file update',
        aiResponseText: aiResponse || `Updated symbols in ${allModifiedFiles.join(', ')}`,
        modifiedFilesAstDiff,
        useLlm: true,
      })
    } catch (err) {
      console.error('[cortexd watcher] memory extraction failed:', err instanceof Error ? err.message : err)
      return
    }

    await this.persistFiles(buffer.platform, memoryReport.delta, modifiedFilesAstDiff)
    await this.persistCursors()
  }

  public async computeAstSymbolDiffs(
    relativePaths: string[],
  ): Promise<Array<{ path: string; addedSymbols: string[]; modifiedSymbols: string[] }>> {
    const diffs: Array<{ path: string; addedSymbols: string[]; modifiedSymbols: string[] }> = []
    for (const relPath of relativePaths) {
      const absPath = path.join(this.projectRoot, relPath)
      let content = ''
      try {
        const stat = await fs.stat(absPath)
        if (stat.size > MAX_FILE_BYTES) {
          diffs.push({ path: relPath, addedSymbols: [], modifiedSymbols: ['<file-too-large>'] })
          continue
        }
        content = await fs.readFile(absPath, 'utf-8')
      } catch {
        continue
      }
      const symbols = extractSymbols(relPath, content)
      const prevSymbols = this.symbolBaselineCache.get(relPath) || new Map<string, SymbolEntry>()
      const addedSymbols: string[] = []
      const modifiedSymbols: string[] = []
      const nextSymbols = new Map<string, SymbolEntry>()
      for (const sym of symbols) {
        nextSymbols.set(sym.name, sym)
        const prev = prevSymbols.get(sym.name)
        const formatted = `${sym.name} [L${sym.startLine}-L${sym.endLine}]`
        if (!prev) addedSymbols.push(formatted)
        else if (prev.signature !== sym.signature || prev.endLine - prev.startLine !== sym.endLine - sym.startLine) modifiedSymbols.push(formatted)
      }
      this.symbolBaselineCache.set(relPath, nextSymbols)
      if (addedSymbols.length === 0 && modifiedSymbols.length === 0) {
        diffs.push({ path: relPath, addedSymbols: [], modifiedSymbols: ['<file-body-updated>'] })
      } else {
        diffs.push({ path: relPath, addedSymbols, modifiedSymbols })
      }
    }
    return diffs
  }

  private async persistFiles(
    platform: ExtractSourcePlatform,
    delta: import('./types').ExtractedMemoryDelta,
    astDiffs: Array<{ path: string; addedSymbols: string[]; modifiedSymbols: string[] }>,
  ): Promise<void> {
    const dnaPath = path.join(this.cortexDir, 'project-dna.json')
    const ledgerPath = path.join(this.cortexDir, 'continuity-ledger.json')
    const cypherWalPath = path.join(this.cortexDir, 'live-deltas.cypher')

    const newStateHash = 'sha256:' + createHash('sha256').update(JSON.stringify(delta) + Date.now().toString()).digest('hex').slice(0, 16)

    if (await fileExists(dnaPath)) {
      try {
        const dna = JSON.parse(await fs.readFile(dnaPath, 'utf-8'))
        if (dna.projectMeta) {
          dna.projectMeta.stateHash = newStateHash
          dna.projectMeta.lastActivePlatform = platform
          dna.projectMeta.lastSyncedAt = new Date().toISOString()
        }
        await fs.writeFile(dnaPath, JSON.stringify(dna, null, 2), 'utf-8')
      } catch (err) {
        console.error('[cortexd watcher] dna update failed:', err instanceof Error ? err.message : err)
      }
    }

    let prevLedger: Record<string, unknown> = { recentDecisions: [], relevantSymbols: [] }
    try {
      prevLedger = JSON.parse(await fs.readFile(ledgerPath, 'utf-8'))
    } catch {
      // fresh ledger
    }

    const updatedSymbols = astDiffs.flatMap((d) =>
      [...d.addedSymbols, ...d.modifiedSymbols]
        .filter((s) => s !== '<file-body-updated>' && s !== '<file-too-large>')
        .map((s) => `${d.path}#${s}`),
    )

    const nextLedger = {
      lastPlatform: platform,
      stateHash: newStateHash,
      syncedAtIso: new Date().toISOString(),
      lastCompletedAction: delta.compactTurnSummary,
      activeModule: (prevLedger.activeModule as string) || 'mod:core',
      relevantSymbols: Array.from(new Set([...updatedSymbols, ...((prevLedger.relevantSymbols as string[]) || [])])).slice(0, 15),
      recentDecisions: [
        ...delta.newDecisions.map((d, idx) => ({ id: `ADR-${Date.now().toString(36).toUpperCase()}-${idx}`, title: d.title, constraint: d.constraints, category: d.category })),
        ...(((prevLedger.recentDecisions as unknown[]) || [])),
      ].slice(0, 10),
      activeTask: {
        id: delta.taskUpdates[0]?.taskId || 'TASK-AUTO',
        title: delta.taskUpdates[0]?.title || delta.compactTurnSummary,
        preExecutedByLocalAgent: astDiffs.map((d) => d.path),
        remainingCoreWork: 'Ready for next prompt',
      },
      nextPendingTasks: delta.taskUpdates.filter((t) => t.status === 'todo' || t.status === 'in_progress').map((t) => t.title),
      openBugs: delta.discoveredBugs.filter((b) => b.status === 'open'),
    }

    await fs.mkdir(this.cortexDir, { recursive: true })
    await fs.writeFile(ledgerPath, JSON.stringify(nextLedger, null, 2), 'utf-8')

    const turnId = `TURN-${Date.now()}`
    const safeSummary = delta.compactTurnSummary.replace(/'/g, "\\'")
    const cypherLines: string[] = [
      `CREATE (t:SessionTurnNode {id: '${turnId}', platform: '${platform}', timestamp: '${new Date().toISOString()}', compactSummary: '${safeSummary}', stateHashAfter: '${newStateHash}'});`,
    ]
    for (const dec of delta.newDecisions) {
      const decId = `DEC-${crypto.randomUUID().slice(0, 8)}`
      const safeTitle = dec.title.replace(/'/g, "\\'")
      const safeRat = dec.rationale.replace(/'/g, "\\'")
      cypherLines.push(`MERGE (d:DecisionNode {id: '${decId}'}) SET d.title = '${safeTitle}', d.rationale = '${safeRat}', d.status = 'active', d.createdByPlatform = '${platform}';`)
      if (dec.supersedesDecisionId) {
        cypherLines.push(`MATCH (old:DecisionNode {id: '${dec.supersedesDecisionId}'}), (newDec:DecisionNode {id: '${decId}'}) SET old.status = 'superseded' MERGE (newDec)-[:SUPERSEDES]->(old);`)
      }
    }
    await fs.appendFile(cypherWalPath, cypherLines.join('\n') + '\n', 'utf-8')
  }

  private async seedSymbolBaseline(): Promise<void> {
    const files = await walkSourceFiles(this.projectRoot)
    for (const relPath of files) {
      try {
        const content = await fs.readFile(path.join(this.projectRoot, relPath), 'utf-8')
        const symbols = extractSymbols(relPath, content)
        const symMap = new Map<string, SymbolEntry>()
        for (const s of symbols) symMap.set(s.name, s)
        this.symbolBaselineCache.set(relPath, symMap)
      } catch {
        // ignore unreadable files
      }
    }
  }

  private async loadPersistedCursors(): Promise<void> {
    const cursorFile = path.join(this.cortexDir, 'watcher-cursors.json')
    try {
      const raw = JSON.parse(await fs.readFile(cursorFile, 'utf-8'))
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'number') this.fileByteOffsets.set(k, v)
    } catch {
      // fresh start
    }
  }

  private async persistCursors(): Promise<void> {
    await fs.mkdir(this.cortexDir, { recursive: true })
    const obj = Object.fromEntries(this.fileByteOffsets.entries())
    await fs.writeFile(path.join(this.cortexDir, 'watcher-cursors.json'), JSON.stringify(obj, null, 2), 'utf-8')
  }
}

// --------------------------------------------------------------------------- helpers

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

async function walkSourceFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.cache', 'vendor', '__pycache__', '.venv', 'venv', 'env', 'target', '.zscripts', 'examples', 'mini-services', '.idea', '.vscode', '.cortex', '.vercel'])
  async function walk(dir: string, depth: number) {
    if (depth > 7 || out.length > 2000) return
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!IGNORE.has(e.name) && !e.name.startsWith('.')) await walk(full, depth + 1)
      } else if (e.isFile() && SOURCE_EXTS.has(path.extname(e.name).toLowerCase())) {
        out.push(path.relative(root, full).replace(/\\/g, '/'))
      }
    }
  }
  await walk(root, 0)
  return out
}

function extractSymbols(filePath: string, content: string): SymbolEntry[] {
  const lines = content.split('\n')
  const out: SymbolEntry[] = []
  const push = (name: string, startLine: number, endLine: number, signature: string) => {
    if (!name || out.length >= 200) return
    out.push({ name, startLine, endLine, signature })
  }
  // functions
  const fnRe = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g
  let m
  while ((m = fnRe.exec(content)) !== null) {
    const idx = content.slice(0, m.index).split('\n').length
    push(m[1], idx, idx, `function ${m[1]}(${m[2]})`)
  }
  // arrow const
  const arrowRe = /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g
  while ((m = arrowRe.exec(content)) !== null) {
    const idx = content.slice(0, m.index).split('\n').length
    push(m[1], idx, idx, `const ${m[1]} = (...) =>`)
  }
  // classes
  const classRe = /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g
  while ((m = classRe.exec(content)) !== null) {
    const idx = content.slice(0, m.index).split('\n').length
    push(m[1], idx, idx, `class ${m[1]}`)
  }
  // python def
  const pyRe = /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/gm
  while ((m = pyRe.exec(content)) !== null) {
    const idx = content.slice(0, m.index).split('\n').length
    push(m[1], idx, idx, `def ${m[1]}(${m[2]})`)
  }
  // augment endLine by scanning braces (best-effort): keep startLine if no close found
  for (const s of out) {
    // find matching closing brace by counting from startLine
    let depth = 0
    let started = false
    let end = s.startLine
    for (let i = s.startLine - 1; i < lines.length; i++) {
      const line = lines[i]
      for (const ch of line) {
        if (ch === '{') { depth++; started = true }
        else if (ch === '}') { depth--; if (started && depth === 0) { end = i + 1; break } }
      }
      if (started && depth === 0 && end > s.startLine) break
    }
    s.endLine = end
    s.signature = `${s.name} [L${s.startLine}-L${s.endLine}]`
  }
  // dedupe by name (keep first)
  const seen = new Set<string>()
  const uniq: SymbolEntry[] = []
  for (const s of out) {
    if (seen.has(s.name)) continue
    seen.add(s.name)
    uniq.push(s)
  }
  // filePath unused param retained for future use
  void filePath
  return uniq
}
