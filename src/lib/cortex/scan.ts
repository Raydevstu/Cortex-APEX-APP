/**
 * Deterministic Code Map — workspace scanner (blueprint §3, memory Tier 1).
 *
 * Parses the project tree into signatures & imports WITHOUT any LLM:
 * key manifest files (package.json, tsconfig, eslint/prettier, prisma
 * schema, .env.example keys only), per-file code statistics (imports,
 * exports, functions, lines) and directory structure. Bounded by strict
 * limits so a pathological repo can never stall the daemon.
 */
import { promises as fs } from 'fs'
import path from 'path'
import type { CodeMapEntry, DirEntry, FileStats, WorkspaceScan } from './types'
import { estimateTokens } from './tokens'

const IGNORE_DIRS = new Set([
  'node_modules', '.next', '.git', '.svn', 'dist', 'build', 'out',
  'coverage', '.turbo', '.cache', 'vendor', '__pycache__', '.venv',
  'venv', 'env', 'target', '.zscripts', 'examples', 'mini-services',
  '.idea', '.vscode', 'bun-dist', '.vercel',
])

const SOURCE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'rb', 'php'])
const COUNTED_EXTS = new Set([
  ...SOURCE_EXTS, 'json', 'md', 'css', 'scss', 'html', 'sql', 'yml',
  'yaml', 'toml', 'prisma', 'sh', 'vue', 'svelte',
])

const MAX_FILES = 1200
const MAX_DEPTH = 7
const MAX_FILE_BYTES = 384 * 1024
const MAX_CODEMAP_ENTRIES = 400

export async function scanWorkspace(rootInput: string): Promise<WorkspaceScan> {
  const root = path.resolve(rootInput)
  const stat = await fs.stat(root).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Workspace path is not an accessible directory: ${root}`)
  }

  const languages: Record<string, number> = {}
  const dirFiles = new Map<string, number>()
  const codeMap: CodeMapEntry[] = []
  let scannedFiles = 0
  let scannedDirs = 0
  let totalLines = 0

  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]

  while (queue.length > 0 && scannedFiles < MAX_FILES) {
    const { dir, depth } = queue.shift()!
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    scannedDirs += 1

    for (const entry of entries) {
      if (scannedFiles >= MAX_FILES) break
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full)

      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push({ dir: full, depth: depth + 1 })
        }
        continue
      }
      if (!entry.isFile()) continue

      const ext = path.extname(entry.name).slice(1).toLowerCase()
      if (!COUNTED_EXTS.has(ext)) continue

      scannedFiles += 1
      languages[ext] = (languages[ext] ?? 0) + 1

      const parentRel = rel.split(path.sep).slice(0, -1).join('/') || '.'
      dirFiles.set(parentRel, (dirFiles.get(parentRel) ?? 0) + 1)

      if (SOURCE_EXTS.has(ext) && codeMap.length < MAX_CODEMAP_ENTRIES) {
        const entryStats = await scanSourceFile(full, rel, ext)
        if (entryStats) {
          codeMap.push(entryStats)
          totalLines += entryStats.lines
        }
      }
    }
  }

  const topDirs: DirEntry[] = [...dirFiles.entries()]
    .filter(([p]) => p !== '.')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([p, files]) => ({ path: p, files }))

  const fileStats: FileStats = {
    scannedFiles,
    scannedDirs,
    totalLines,
    languages,
    topDirs,
    codeMap: codeMap.sort((a, b) => b.lines - a.lines).slice(0, 120),
    prismaModels: [], // filled below
    envKeys: [], // filled below
    packageDeps: [], // filled below
    scannedAt: new Date().toISOString(),
  }

  const scan: WorkspaceScan = {
    rootPath: root,
    packageJson: null,
    tsConfig: null,
    eslintConfigFile: null,
    prettierConfigFile: null,
    nextConfigFile: null,
    componentsJson: false,
    prismaSchemaFile: null,
    prismaModels: [],
    prismaDatasourceProvider: null,
    envExampleKeys: [],
    readmeTitle: null,
    fileStats,
  }

  await readManifests(root, scan)
  scan.fileStats.prismaModels = scan.prismaModels
  scan.fileStats.envKeys = scan.envExampleKeys
  scan.fileStats.packageDeps = scan.packageJson
    ? [...Object.keys(scan.packageJson.dependencies), ...Object.keys(scan.packageJson.devDependencies)]
    : []

  return scan
}

async function scanSourceFile(full: string, rel: string, ext: string): Promise<CodeMapEntry | null> {
  let content: string
  try {
    const st = await fs.stat(full)
    if (st.size > MAX_FILE_BYTES) return null
    content = await fs.readFile(full, 'utf-8')
  } catch {
    return null
  }

  const lines = content.split('\n').length
  const isPython = ext === 'py'
  const isRust = ext === 'rs'
  const isGo = ext === 'go'

  const imports = countMatches(
    content,
    isPython ? /^\s*(?:import|from)\s+\S/gm : isRust ? /^\s*use\s+\S/gm : isGo ? /^\s*import\s/gm : /^\s*import\s[\s\S]?/gm,
  )
  const exports = isPython
    ? countMatches(content, /^\s*(?:def|class)\s+\w+/gm)
    : countMatches(content, /^\s*export\s+(?:default\s+)?/gm)
  const functions = isPython
    ? countMatches(content, /^\s*def\s+\w+/gm)
    : countMatches(content, /(?:\bfunction\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(|^\s*(?:async\s+)?def\s+\w+)/gm)

  return {
    path: rel.split(path.sep).join('/'),
    language: ext,
    imports,
    exports,
    functions,
    lines,
    tokens: estimateTokens(content),
  }
}

function countMatches(content: string, pattern: RegExp): number {
  const matches = content.match(new RegExp(pattern.source, pattern.flags))
  return matches ? matches.length : 0
}

async function readManifests(root: string, scan: WorkspaceScan): Promise<void> {
  const readJson = async (p: string): Promise<Record<string, unknown> | null> => {
    try {
      const raw = await fs.readFile(p, 'utf-8')
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return null
    }
  }

  const pkg = await readJson(path.join(root, 'package.json'))
  if (pkg) {
    scan.packageJson = {
      name: typeof pkg.name === 'string' ? pkg.name : undefined,
      dependencies: (pkg.dependencies as Record<string, string>) ?? {},
      devDependencies: (pkg.devDependencies as Record<string, string>) ?? {},
      scripts: (pkg.scripts as Record<string, string>) ?? {},
    }
  }

  scan.tsConfig = await readJson(path.join(root, 'tsconfig.json'))

  const configCandidates: Array<[keyof WorkspaceScan, string[]]> = [
    ['eslintConfigFile', ['.eslintrc.js', '.eslintrc.json', '.eslintrc', 'eslint.config.mjs', 'eslint.config.js']],
    ['prettierConfigFile', ['.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js']],
    ['nextConfigFile', ['next.config.js', 'next.config.mjs', 'next.config.ts']],
  ]
  for (const [key, candidates] of configCandidates) {
    for (const candidate of candidates) {
      const exists = await fs
        .stat(path.join(root, candidate))
        .then((s) => s.isFile())
        .catch(() => false)
      if (exists) {
        ;(scan[key] as string | null) = candidate
        break
      }
    }
  }

  scan.componentsJson = await fs
    .stat(path.join(root, 'components.json'))
    .then((s) => s.isFile())
    .catch(() => false)

  // Prisma schema — parse models + datasource provider (no secrets read).
  const prismaPath = path.join(root, 'prisma', 'schema.prisma')
  const prismaContent = await fs.readFile(prismaPath, 'utf-8').catch(() => null)
  if (prismaContent) {
    scan.prismaSchemaFile = 'prisma/schema.prisma'
    scan.prismaModels = [...prismaContent.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1])
    const provider = prismaContent.match(/provider\s*=\s*"(\w+)"/)
    scan.prismaDatasourceProvider = provider ? provider[1] : null
  }

  // .env.example — key NAMES only, never values.
  for (const envFile of ['.env.example', '.env.sample', '.env.local.example']) {
    const content = await fs.readFile(path.join(root, envFile), 'utf-8').catch(() => null)
    if (content) {
      scan.envExampleKeys = [
        ...new Set(
          content
            .split('\n')
            .map((line) => line.trim().match(/^([A-Z0-9_]+)\s*=/)?.[1])
            .filter((k): k is string => Boolean(k)),
        ),
      ]
      break
    }
  }

  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf-8').catch(() => null)
  if (readme) {
    scan.readmeTitle = readme.match(/^#\s+(.+)$/m)?.[1] ?? null
  }
}
