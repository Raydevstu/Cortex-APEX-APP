/**
 * Phase 4 — Workspace Audit Engine (blueprint PHASE_4 §1.4 + §4).
 *
 * Deterministic, dependency-free repository analysis that powers the AI CTO
 * drift detector:
 *
 *   1. Symbol-level cyclomatic complexity — walks the project workspace,
 *      extracts function/class spans (same multi-language extractor family
 *      as the Phase 3 `ast_symbol_lookup` tool) and computes a calibrated
 *      cyclomatic approximation (decision points: if / for / while / case /
 *      catch / && / || / ??) per symbol.
 *   2. Cross-layer boundary drift — parses real import statements of every
 *      scanned source file, maps files to architectural layers and flags
 *      imports that cross the layer policy (e.g. UI importing storage
 *      directly instead of routing through the API/engine layer).
 *
 * Results are cached in-memory with a TTL so the Command Center can poll
 * without rescanning the tree on every request.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface WorkspaceSymbol {
  fqn: string // "<relPath>#<name>"
  filePath: string
  name: string
  kind: 'function' | 'arrow-function' | 'class' | 'python-def' | 'python-class'
  line: number
  endLine: number
  signature: string
  complexity: number
  exported: boolean
}

export interface WorkspaceFile {
  path: string
  language: string
  lines: number
}

export interface WorkspaceImport {
  from: string // importing file (workspace-relative)
  to: string // resolved target: workspace-relative path or external package
  external: boolean
}

export type ArchitectureLayer = 'ui' | 'api' | 'engine' | 'orchestrator' | 'storage' | 'scripts' | 'tests' | 'extension' | 'other'

export interface LayerViolation {
  from: string
  to: string
  fromLayer: ArchitectureLayer
  toLayer: ArchitectureLayer
  rule: string
}

export interface WorkspaceAuditResult {
  rootPath: string
  scannedAt: string
  files: WorkspaceFile[]
  symbols: WorkspaceSymbol[]
  imports: WorkspaceImport[]
  violations: LayerViolation[]
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Bounds & ignore policy (mirror the Phase 3 local-tool walker)
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 384 * 1024
const MAX_WALK_FILES = 1200
const MAX_IMPORT_EDGES = 3000
const WALK_IGNORE = new Set([
  'node_modules', '.next', '.git', '.svn', 'dist', 'build', 'out', 'coverage',
  '.turbo', '.cache', 'vendor', '__pycache__', '.venv', 'venv', 'target',
  '.zscripts', '.idea', '.vscode', 'bun-dist', '.vercel', 'cortex-assets',
  'download', 'upload', 'db', '.prisma',
])

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py'])

// ---------------------------------------------------------------------------
// Layer policy — default hexagonal boundary rules for a Next.js daemon repo.
// A UI file may only reach the API surface / engine contracts; it must never
// import storage (Prisma / raw db) or orchestrator internals directly, and
// storage is a leaf layer that never imports upward.
// ---------------------------------------------------------------------------

const LAYER_RULES: Array<{ from: ArchitectureLayer; to: ArchitectureLayer; rule: string }> = [
  { from: 'ui', to: 'storage', rule: 'ui->storage: route through /api/cortex/* or the engine service layer instead of importing storage directly' },
  { from: 'ui', to: 'orchestrator', rule: 'ui->orchestrator: orchestration belongs behind an API route (e.g. /api/cortex/cto)' },
  { from: 'engine', to: 'ui', rule: 'engine->ui: engine modules must not import UI components' },
  { from: 'storage', to: 'ui', rule: 'storage->ui: storage is a leaf layer and must not import upward' },
  { from: 'storage', to: 'engine', rule: 'storage->engine: storage is a leaf layer and must not import upward' },
]

export function computeLayer(relPath: string): ArchitectureLayer {
  const p = relPath.replace(/\\/g, '/')
  if (p.startsWith('src/lib/db')) return 'storage'
  if (p.startsWith('src/components') || p.startsWith('src/hooks')) return 'ui'
  if (p.startsWith('src/app/') && p.includes('/api/')) return 'api'
  if (p.startsWith('src/app/')) return 'ui'
  if (p.startsWith('src/orchestrator')) return 'orchestrator'
  if (p.startsWith('src/lib') || p.startsWith('src/mcp') || p.startsWith('mcp-server')) return 'engine'
  if (p.startsWith('prisma')) return 'storage'
  if (p.startsWith('scripts')) return 'scripts'
  if (p.startsWith('tests')) return 'tests'
  if (p.startsWith('extension')) return 'extension'
  return 'other'
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 90_000
const cache = new Map<string, { result: WorkspaceAuditResult; at: number }>()

export function invalidateWorkspaceAudit(rootPath?: string): void {
  if (!rootPath) {
    cache.clear()
    return
  }
  cache.delete(path.resolve(rootPath))
}

export async function auditWorkspace(
  rootPath: string,
  options: { force?: boolean } = {},
): Promise<{ result: WorkspaceAuditResult; cache: 'hit' | 'miss' }> {
  const key = path.resolve(rootPath)
  const hit = cache.get(key)
  if (!options.force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { result: hit.result, cache: 'hit' }
  }
  const result = await scanWorkspace(rootPath)
  cache.set(key, { result, at: Date.now() })
  return { result, cache: 'miss' }
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

async function scanWorkspace(rootPath: string): Promise<WorkspaceAuditResult> {
  const root = path.resolve(rootPath)
  const files: WorkspaceFile[] = []
  const symbols: WorkspaceSymbol[] = []
  const imports: WorkspaceImport[] = []
  let truncated = false

  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!
    if (depth > 8 || files.length >= MAX_WALK_FILES) {
      if (files.length >= MAX_WALK_FILES) truncated = true
      continue
    }
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (WALK_IGNORE.has(entry.name) || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        queue.push({ dir: full, depth: depth + 1 })
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        if (files.length >= MAX_WALK_FILES) {
          truncated = true
          continue
        }
        const rel = path.relative(root, full).split(path.sep).join('/')
        const stat = await fs.stat(full).catch(() => null)
        if (!stat || stat.size > MAX_FILE_BYTES) continue
        const source = await fs.readFile(full, 'utf-8').catch(() => null)
        if (source === null) continue
        const lines = source.split('\n')
        const language = path.extname(entry.name).slice(1).toLowerCase()
        files.push({ path: rel, language, lines: lines.length })
        collectSymbols(rel, lines, language, symbols)
        collectImports(rel, lines, imports)
      }
    }
  }

  const violations = detectLayerViolations(imports)
  return { rootPath: root, scannedAt: new Date().toISOString(), files, symbols, imports, violations, truncated }
}

// ---------------------------------------------------------------------------
// Symbol extraction + cyclomatic complexity
// ---------------------------------------------------------------------------

function collectSymbols(rel: string, lines: string[], language: string, out: WorkspaceSymbol[]): void {
  const isPython = language === 'py'

  interface RawSymbol { kind: WorkspaceSymbol['kind']; name: string; line: number; indent: number; signature: string; exported: boolean }
  const raw: RawSymbol[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 400) continue // minified guard

    if (isPython) {
      const indent = line.length - line.trimStart().length
      const def = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/)
      if (def) raw.push({ kind: 'python-def', name: def[1], line: i + 1, indent, signature: line.trim().slice(0, 180), exported: !def[1].startsWith('_') })
      const cls = line.match(/^\s*class\s+([A-Za-z_]\w*)/)
      if (cls) raw.push({ kind: 'python-class', name: cls[1], line: i + 1, indent, signature: line.trim().slice(0, 180), exported: !cls[1].startsWith('_') })
    } else {
      const indent = line.length - line.replace(/^(\s|\t)*/, '').length
      const fn = line.match(/^\s*(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>=]*>)?\s*\(([^)]*)\)/)
      if (fn) raw.push({ kind: 'function', name: fn[4], line: i + 1, indent, signature: line.trim().slice(0, 180), exported: Boolean(fn[1]) })
      const arrow = line.match(/^\s*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?\s*=\s*(?:async\s*)?\(/)
      if (arrow && !raw.some((s) => s.name === arrow[2] && s.line === i + 1)) {
        raw.push({ kind: 'arrow-function', name: arrow[2], line: i + 1, indent, signature: line.trim().slice(0, 180), exported: Boolean(arrow[1]) })
      }
      const cls = line.match(/^\s*(export\s+)?(default\s+)?(abstract\s+)?class\s+([A-Za-z_$][\w$]*)/)
      if (cls) raw.push({ kind: 'class', name: cls[4], line: i + 1, indent, signature: line.trim().slice(0, 180), exported: Boolean(cls[1]) })
    }
  }

  for (let i = 0; i < raw.length; i++) {
    const sym = raw[i]
    // Symbol span: until the next symbol at the same-or-lower nesting level.
    let end = lines.length
    for (let j = i + 1; j < raw.length; j++) {
      if (raw[j].indent <= sym.indent) {
        end = raw[j].line - 1
        break
      }
    }
    if (end < sym.line) end = sym.line
    const body = lines.slice(sym.line - 1, Math.min(end, sym.line + 220)).join('\n')
    out.push({
      fqn: `${rel}#${sym.name}`,
      filePath: rel,
      name: sym.name,
      kind: sym.kind,
      line: sym.line,
      endLine: end,
      signature: sym.signature,
      complexity: cyclomaticComplexity(body),
      exported: sym.exported,
    })
  }
}

/** Calibrated cyclomatic approximation: 1 + decision points. */
export function cyclomaticComplexity(body: string): number {
  const count = (re: RegExp) => (body.match(re) || []).length
  let decisions = 0
  decisions += count(/\bif\b/g)
  decisions += count(/\bfor\b/g)
  decisions += count(/\bwhile\b/g)
  decisions += count(/\bcase\b/g)
  decisions += count(/\bcatch\b/g)
  decisions += count(/&&/g)
  decisions += count(/\|\|/g)
  decisions += count(/\?\?/g)
  return 1 + decisions
}

// ---------------------------------------------------------------------------
// Import extraction + layer violations
// ---------------------------------------------------------------------------

function collectImports(rel: string, lines: string[], out: WorkspaceImport[]): void {
  for (const line of lines) {
    if (line.length > 400 || out.length >= MAX_IMPORT_EDGES) continue
    if (/^\s*\/\//.test(line)) continue
    const esm = line.match(/^\s*import\s+[^'";]*['"]([^'"]+)['"]/)
    if (esm) {
      pushImport(rel, esm[1], out)
      continue
    }
    const sideEffect = line.match(/^\s*import\s+['"]([^'"]+)['"]/)
    if (sideEffect) {
      pushImport(rel, sideEffect[1], out)
      continue
    }
    const req = line.match(/(?:^|\s)require\(\s*['"]([^'"]+)['"]\s*\)/)
    if (req) {
      pushImport(rel, req[1], out)
      continue
    }
    const py = line.match(/^\s*from\s+([\w.]+)\s+import\b/)
    if (py && py[1].includes('.')) {
      pushImport(rel, py[1], out)
    }
  }
}

function pushImport(from: string, target: string, out: WorkspaceImport[]): void {
  const external = !target.startsWith('.') && !target.startsWith('/') && !target.startsWith('@/')
  out.push({ from, to: target, external })
}

function detectLayerViolations(imports: WorkspaceImport[]): LayerViolation[] {
  const violations: LayerViolation[] = []
  const seen = new Set<string>()
  for (const imp of imports) {
    if (imp.external) continue
    const fromLayer = computeLayer(imp.from)
    // Only flag imports that resolve inside the workspace layers we govern.
    const toLayer = computeLayer(imp.to.replace(/^@\//, 'src/'))
    const key = `${imp.from}|${imp.to}`
    if (seen.has(key)) continue
    for (const rule of LAYER_RULES) {
      if (fromLayer === rule.from && toLayer === rule.to) {
        seen.add(key)
        violations.push({ from: imp.from, to: imp.to, fromLayer, toLayer, rule: rule.rule })
        break
      }
    }
  }
  return violations
}
