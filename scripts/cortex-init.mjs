#!/usr/bin/env node
/**
 * File: scripts/cortex-init.mjs
 * `cortexos init` — Project Bootstrap CLI (blueprint Part 4).
 *
 * One command inside any existing repository:
 *   1. Fingerprints the stack (package.json / pyproject.toml / Cargo.toml / go.mod).
 *   2. Deterministically scans the workspace (AST-ish signatures, imports, line counts).
 *   3. Synthesizes .cortex/project-dna.json + .cortex/continuity-ledger.json +
 *      .cortex/active-scope-lock.json + .cortex/seed-graph.cypher.
 *   4. Auto-wires the sentinel hook + MCP server (.claude/settings.json, .cursor/mcp.json).
 *   5. If the daemon is reachable, registers/updates the project and regenerates DNA
 *      server-side; otherwise prints the manual steps.
 *
 * Usage:
 *   node scripts/cortex-init.mjs [--root /path] [--slug my-app] [--name "My App"]
 *                               [--platform codex] [--daemon-url http://localhost:3000]
 *                               [--no-wire] [--no-daemon]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.cache', 'vendor', '__pycache__', '.venv', 'venv', 'env', 'target', '.zscripts', 'examples', 'mini-services', '.idea', '.vscode', '.cortex', '.vercel'])
const SOURCE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'rb', 'php', 'prisma'])
const COUNTED_EXTS = new Set([...SOURCE_EXTS, 'json', 'md', 'css', 'scss', 'html', 'sql', 'yml', 'yaml', 'toml', 'sh', 'vue', 'svelte'])
const MAX_FILES = 1200
const MAX_DEPTH = 7
const MAX_FILE_BYTES = 384 * 1024
const MAX_CODEMAP = 400

function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) { flags[key] = next; i++ } else { flags[key] = true }
    } else positional.push(a)
  }
  return { flags, positional }
}

async function readJson(p) { try { return JSON.parse(await fs.readFile(p, 'utf-8')) } catch { return null } }
async function exists(p) { try { await fs.stat(p); return true } catch { return false } }

async function fingerprint(root) {
  const pkg = await readJson(path.join(root, 'package.json'))
  const pyproject = await (async () => { try { return await fs.readFile(path.join(root, 'pyproject.toml'), 'utf-8') } catch { return null } })()
  const cargo = await (async () => { try { return await fs.readFile(path.join(root, 'Cargo.toml'), 'utf-8') } catch { return null } })()
  const gomod = await (async () => { try { return await fs.readFile(path.join(root, 'go.mod'), 'utf-8') } catch { return null } })()

  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {}
  const has = (k) => Object.prototype.hasOwnProperty.call(deps, k)

  const stack = {
    frontend: {
      framework: has('next') ? `Next.js ${deps.next}` : has('react') ? `React ${deps.react}` : has('vue') ? 'Vue' : 'TypeScript/Node',
      language: 'TypeScript',
      styling: has('tailwindcss') ? 'Tailwind CSS' : 'CSS',
      stateManagement: has('zustand') ? 'Zustand' : 'React Server Components',
      uiLibrary: has('@radix-ui/react-slot') ? 'Shadcn UI' : 'none',
    },
    backend: {
      runtime: 'Node.js',
      apiStyle: 'Server Actions + REST Route Handlers',
      validation: has('zod') ? 'Zod' : 'TypeScript Strict',
      authProvider: has('@clerk/nextjs') ? 'Clerk' : has('next-auth') ? 'NextAuth' : 'Custom JWT Guard',
    },
    database: {
      primaryDb: 'PostgreSQL',
      orm: has('@prisma/client') ? 'Prisma' : has('drizzle-orm') ? 'Drizzle' : 'SQL',
      vectorOrGraphDb: 'SQLite embedded (.cortex/graph.db)',
    },
    testingAndTooling: {
      unitTest: has('vitest') ? 'Vitest' : has('jest') ? 'Jest' : 'Node Test Runner',
      e2eTest: has('@playwright/test') ? 'Playwright' : 'None',
      packageManager: (await exists(path.join(root, 'bun.lock'))) ? 'bun' : ((await exists(path.join(root, 'pnpm-lock.yaml'))) ? 'pnpm' : 'npm'),
      linter: has('eslint') ? 'ESLint' : 'Biome',
    },
  }

  if (pyproject) {
    stack.backend.runtime = 'Python'
    stack.backend.apiStyle = pyproject.includes('fastapi') ? 'FastAPI' : pyproject.includes('django') ? 'Django' : 'Python'
    stack.frontend.framework = 'n/a (Python project)'
  }
  if (cargo) { stack.backend.runtime = 'Rust'; stack.frontend.framework = 'n/a (Rust project)' }
  if (gomod) { stack.backend.runtime = 'Go'; stack.frontend.framework = 'n/a (Go project)' }

  return { pkg, stack, hasPyproject: !!pyproject, hasCargo: !!cargo, hasGo: !!gomod }
}

async function scanWorkspace(root) {
  const languages = {}
  const dirFiles = new Map()
  const codeMap = []
  let scannedFiles = 0
  let scannedDirs = 0
  let totalLines = 0
  const queue = [{ dir: root, depth: 0 }]

  while (queue.length > 0 && scannedFiles < MAX_FILES) {
    const { dir, depth } = queue.shift()
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
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
      languages[ext] = (languages[ext] || 0) + 1
      const parentRel = rel.split(path.sep).slice(0, -1).join('/') || '.'
      dirFiles.set(parentRel, (dirFiles.get(parentRel) || 0) + 1)
      if (SOURCE_EXTS.has(ext) && codeMap.length < MAX_CODEMAP) {
        try {
          const st = await fs.stat(full)
          if (st.size > MAX_FILE_BYTES) continue
          const content = await fs.readFile(full, 'utf-8')
          const lines = content.split('\n').length
          const isPy = ext === 'py'
          const imports = (content.match(isPy ? /^\s*(?:import|from)\s+\S/gm : /^\s*import\s/gm) || []).length
          const exports = isPy ? (content.match(/^\s*(?:def|class)\s+\w+/gm) || []).length : (content.match(/^\s*export\s+/gm) || []).length
          const functions = isPy ? (content.match(/^\s*def\s+\w+/gm) || []).length : (content.match(/(?:\bfunction\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\()/g) || []).length
          codeMap.push({ path: rel.split(path.sep).join('/'), language: ext, imports, exports, functions, lines, tokens: Math.ceil(content.length / 4) })
          totalLines += lines
        } catch { /* skip unreadable */ }
      }
    }
  }
  const topDirs = [...dirFiles.entries()]
    .filter(([p]) => p !== '.')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([p, files]) => ({ path: p, files }))
  const prismaPath = path.join(root, 'prisma', 'schema.prisma')
  let prismaModels = []
  let prismaProvider = null
  try {
    const pc = await fs.readFile(prismaPath, 'utf-8')
    prismaModels = [...pc.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1])
    const pm = pc.match(/provider\s*=\s*"(\w+)"/)
    prismaProvider = pm ? pm[1] : null
  } catch { /* no prisma */ }
  const envKeys = []
  for (const ef of ['.env.example', '.env.sample', '.env.local.example']) {
    try {
      const c = await fs.readFile(path.join(root, ef), 'utf-8')
      for (const line of c.split('\n')) {
        const m = line.trim().match(/^([A-Z0-9_]+)\s*=/)
        if (m && !envKeys.includes(m[1])) envKeys.push(m[1])
      }
      break
    } catch { /* none */ }
  }
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf-8').catch(() => null)
  const readmeTitle = readme ? (readme.match(/^#\s+(.+)$/m)?.[1] ?? null) : null

  const pkg = await readJson(path.join(root, 'package.json'))
  return {
    rootPath: root,
    scannedFiles, scannedDirs: scannedDirs, totalLines, languages, topDirs,
    codeMap: codeMap.sort((a, b) => b.lines - a.lines).slice(0, 120),
    prismaModels, prismaProvider, envKeys, readmeTitle,
    packageJson: pkg ? { name: pkg.name, dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {}, scripts: pkg.scripts || {} } : null,
  }
}

function inferModule(relPath) {
  const parts = relPath.split('/')
  if (parts[0] === 'src' && parts.length >= 3) {
    return { id: `mod:${parts[1]}-${parts[2]}`, name: `${parts[1]}-${parts[2]}`, rootPath: `src/${parts[1]}/${parts[2]}` }
  }
  const top = parts[0] || 'root'
  return { id: `mod:${top}`, name: top, rootPath: top }
}

function extractSymbols(relPath, content, ext) {
  const symbols = []
  const lines = content.split('\n')
  if (ext === 'py') {
    const re = /^(async\s+def|def|class)\s+([A-Za-z0-9_]+)/
    for (let i = 0; i < lines.length; i++) {
      if (/^\s/.test(lines[i])) continue
      const m = lines[i].trim().match(re)
      if (!m) continue
      let end = i + 1
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() && !/^\s/.test(lines[j])) break
        end = j + 1
      }
      symbols.push({ name: m[2], kind: m[1].includes('class') ? 'class' : 'function', startLine: i + 1, endLine: end, signature: lines[i].trim().replace(/:$/, '') })
    }
  } else {
    const re = /^(export\s+)?(async\s+)?(function|class|interface|type|const)\s+([A-Za-z0-9_]+)/
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].trim().match(re)
      if (!m) continue
      let depth = 0, opened = false, end = i + 1
      for (let k = i; k < lines.length; k++) {
        for (const ch of lines[k]) {
          if (ch === '{') { depth++; opened = true }
          else if (ch === '}') { depth--; if (opened && depth <= 0) { end = k + 1; break } }
        }
        if (opened && depth <= 0) break
        if (!opened && lines[k].trim().endsWith(';')) { end = k + 1; break }
      }
      if (end < i + 1) end = i + 1
      symbols.push({ name: m[4], kind: m[3], startLine: i + 1, endLine: end, signature: lines[i].trim().replace(/\{$/, '').trim(), exported: !!m[1] })
    }
  }
  return symbols
}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16) }

export async function runInit(argv = process.argv.slice(2)) {
  const { flags } = parseArgs(argv)
  const root = path.resolve(String(flags.root || process.cwd()))
  let slug = String(flags.slug || path.basename(root).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'cortex-project')
  const name = String(flags.name || (await readJson(path.join(root, 'package.json')))?.name || path.basename(root))
  const platform = String(flags.platform || 'codex')
  const daemonUrl = String(flags['daemon-url'] || flags['daemon'] || process.env.CORTEX_DAEMON_URL || process.env.CORTEX_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
  const doWire = flags['no-wire'] !== true
  const doDaemon = flags['no-daemon'] !== true

  console.log(`⚡ [CortexOS] Bootstrapping project in ${root}`)

  // 1. Fingerprint
  const fp = await fingerprint(root)
  console.log(`✓ Fingerprinted stack: ${fp.stack.backend.runtime} / ${fp.stack.frontend.framework} / ${fp.stack.database.orm}`)

  // 2. Scan workspace
  const scan = await scanWorkspace(root)
  console.log(`✓ Scanned ${scan.scannedFiles} files, ${scan.scannedDirs} dirs, ${scan.totalLines} lines`)

  // Build module map + symbols for seed graph
  const moduleMap = new Map()
  const fileNodes = []
  // Re-walk for modules/symbols (bounded)
  const q = [{ dir: root, depth: 0 }]
  while (q.length) {
    const { dir, depth } = q.shift()
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) q.push({ dir: full, depth: depth + 1 })
        continue
      }
      if (!e.isFile()) continue
      const ext = path.extname(e.name).slice(1).toLowerCase()
      if (!SOURCE_EXTS.has(ext)) continue
      const rel = path.relative(root, full).replace(/\\/g, '/')
      const mod = inferModule(rel)
      moduleMap.set(mod.id, mod)
      let content = ''
      try {
        const st = await fs.stat(full)
        if (st.size <= MAX_FILE_BYTES) content = await fs.readFile(full, 'utf-8')
      } catch { /* skip */ }
      const symbols = content ? extractSymbols(rel, content, ext) : []
      const sha = content ? sha256(content) : ''
      const isProtected = /^prisma\/migrations\//.test(rel) || /auth.*guard/i.test(rel) || /middleware\.(ts|js)$/.test(rel) || /\.env/.test(rel)
      fileNodes.push({ path: rel, moduleId: mod.id, language: ext === 'py' ? 'python' : ext === 'prisma' ? 'prisma' : 'typescript', sha256: sha, lineCount: content ? content.split('\n').length : 0, isProtected, imports: [], symbols })
    }
  }
  const modules = [...moduleMap.values()]
  const totalSymbols = fileNodes.reduce((a, f) => a + f.symbols.length, 0)
  console.log(`✓ Indexed ${fileNodes.length} source files, ${modules.length} modules, ${totalSymbols} symbols`)

  // 3. Write .cortex files
  const cortexDir = path.join(root, '.cortex')
  await fs.mkdir(path.join(cortexDir, 'prompts'), { recursive: true })
  await fs.mkdir(path.join(cortexDir, 'schemas'), { recursive: true })

  const stateHash = 'sha256:' + sha256(fileNodes.map((f) => f.sha256).join(':'))
  const protectedPaths = fileNodes.filter((f) => f.isProtected).map((f) => f.path)
  const allDeps = fp.packageJson ? { ...(fp.packageJson.dependencies || {}), ...(fp.packageJson.devDependencies || {}) } : {}
  const projectDna = {
    $schema: './schemas/project-dna.schema.json',
    projectMeta: { projectId: null, name, version: fp.packageJson?.version || '0.1.0', architecturePattern: 'modular-monolith', stateHash, lastSyncedAt: new Date().toISOString(), lastActivePlatform: platform },
    techStack: fp.stack,
    architectureRules: { directoryMap: Object.fromEntries(modules.map((m) => [m.rootPath, `Module ${m.name}`])), immutableConstraints: ['All database queries must be scoped to the authenticated tenant/organization context.', 'All external inputs and tool payloads must be validated before execution.'], forbiddenPatterns: ['@ts-ignore', 'eslint-disable'] },
    codingStandards: { namingConventions: { files: 'kebab-case', components: 'PascalCase', functions: 'camelCase', databaseTables: 'snake_case' }, errorHandlingPattern: 'Typed Result<T, E> — no silent catch blocks', astScopeGuardRules: { maxFunctionLines: 80, disallowAnyType: true, requireExplicitReturnTypes: true, protectedPaths: protectedPaths.length ? protectedPaths : ['.env', 'prisma/migrations/'] } },
    agentRoutingPolicy: { localOllamaModels: { fastRouter: 'qwen2.5:1.5b', promptEngineer: 'qwen2.5-coder:7b', codePreExecutor: 'qwen2.5-coder:14b', memoryExtractor: 'llama3.2:3b' }, offloadToLocalRules: ['ast_symbol_lookup', 'schema_inspect', 'scaffold_boilerplate', 'unit_test_stub_generation'] },
  }
  await fs.writeFile(path.join(cortexDir, 'project-dna.json'), JSON.stringify(projectDna, null, 2), 'utf-8')

  const continuityLedger = {
    lastPlatform: platform,
    lastCompletedAction: `Initialized CortexOS DNA (${fileNodes.length} files, ${totalSymbols} AST symbols)`,
    activeModule: modules[0]?.id || 'mod:root',
    relevantSymbols: fileNodes.flatMap((f) => f.symbols.slice(0, 2).map((s) => `${f.path}#${s.name} [L${s.startLine}-L${s.endLine}]`)).slice(0, 10),
    recentDecisions: [],
    activeTask: { id: 'TASK-INIT', title: 'Repository Indexed & Ready for Cross-Platform Sync', preExecutedByLocalAgent: ['Full AST Index', 'Project DNA Generation'], remainingCoreWork: 'Ready for developer prompt' },
    nextPendingTasks: [],
  }
  await fs.writeFile(path.join(cortexDir, 'continuity-ledger.json'), JSON.stringify(continuityLedger, null, 2), 'utf-8')

  const scopeLock = { updatedAt: new Date().toISOString(), allowedWriteFiles: [], forbiddenPatterns: protectedPaths.length ? protectedPaths : ['.env', 'prisma/migrations/'] }
  await fs.writeFile(path.join(cortexDir, 'active-scope-lock.json'), JSON.stringify(scopeLock, null, 2), 'utf-8')

  // seed-graph.cypher
  const stmts = []
  for (const m of modules) stmts.push(`MERGE (m:ModuleNode {id: '${m.id}'}) SET m.name = '${m.name}', m.rootPath = '${m.rootPath}';`)
  for (const f of fileNodes) {
    stmts.push(`MERGE (f:FileNode {path: '${f.path}'}) SET f.language = '${f.language}', f.sha256 = '${f.sha256}', f.lineCount = ${f.lineCount}, f.isProtected = ${f.isProtected};`)
    stmts.push(`MATCH (m:ModuleNode {id: '${f.moduleId}'}), (f:FileNode {path: '${f.path}'}) MERGE (m)-[:CONTAINS_FILE]->(f);`)
    for (const s of f.symbols) {
      const sig = s.signature.replace(/'/g, "\\'")
      stmts.push(`MERGE (s:SymbolNode {id: '${f.path}#${s.name}'}) SET s.name = '${s.name}', s.kind = '${s.kind}', s.startLine = ${s.startLine}, s.endLine = ${s.endLine}, s.signature = '${sig}';`)
      stmts.push(`MATCH (f:FileNode {path: '${f.path}'}), (s:SymbolNode {id: '${f.path}#${s.name}'}) MERGE (f)-[:DECLARES_SYMBOL]->(s);`)
    }
  }
  await fs.writeFile(path.join(cortexDir, 'seed-graph.cypher'), stmts.join('\n') + '\n', 'utf-8')

  console.log(`✓ Wrote .cortex/project-dna.json (state ${stateHash})`)
  console.log(`✓ Wrote .cortex/continuity-ledger.json`)
  console.log(`✓ Wrote .cortex/active-scope-lock.json`)
  console.log(`✓ Wrote .cortex/seed-graph.cypher (${stmts.length} statements)`)

  // 4. Auto-wire hooks
  if (!flags['no-wire']) {
    try {
      // reuse cortex-wire-hooks logic by spawning it
      const wireScript = path.join(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')), 'cortex-wire-hooks.mjs')
    execFileSync(process.execPath, [wireScript, '--root', root], { stdio: 'inherit' })
    } catch (e) {
      console.warn('⚠ Auto-wire failed:', e?.message || e)
    }
  }

  // 5. Daemon registration (best-effort)
  if (!flags['no-daemon']) {
    let daemonOk = false
    try {
      const res = await fetch(`${daemonUrl}/api/cortex/health`)
      daemonOk = res.ok
    } catch { daemonOk = false }
    if (daemonOk) {
      console.log(`✓ Daemon reachable at ${daemonUrl}`)
      // create or find project
      let projectId = null
      try {
        const listRes = await fetch(`${daemonUrl}/api/cortex/projects`)
        if (listRes.ok) {
          const data = await listRes.json()
          const projects = Array.isArray(data) ? data : (data.projects || data.data || [])
          const existing = projects.find((p) => p.rootPath === root || p.name === name)
          if (existing) { projectId = existing.id; slug = existing.slug; console.log(`✓ Found existing project ${slug} (${projectId})`) }
        }
      } catch { /* ignore */ }
      if (!projectId) {
        try {
          const createRes = await fetch(`${daemonUrl}/api/cortex/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, rootPath: root, platform }) })
          if (createRes.ok) {
            const data = await createRes.json()
            projectId = data.id || data.project?.id
            if (data.slug) slug = data.slug
            console.log(`✓ Created project ${slug} (${projectId})`)
          } else {
            const errText = await createRes.text().catch(() => '')
            console.warn(`⚠ Project create failed: HTTP ${createRes.status} ${errText.slice(0, 200)}`)
          }
        } catch (e) { console.warn('⚠ Project create error:', e?.message) }
      }
      if (projectId) {
        // set rootPath if missing + regenerate DNA
        try {
          await fetch(`${daemonUrl}/api/cortex/projects/${projectId}/dna`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'scan', rootPath: root }) })
          console.log(`✓ Regenerated Project DNA server-side`)
        } catch (e) { console.warn('⚠ DNA regeneration failed:', e?.message) }
        // sync files
        try {
          // trigger scope lock sync via a toggle? just leave; daemon writes on next scope op
        } catch { /* ignore */ }
      }
    } else {
      console.log(`ℹ Daemon not reachable at ${daemonUrl} — skipped registration. Start the daemon and re-run, or call POST /api/cortex/projects + /dna manually.`)
    }
  }

  console.log(`\n🚀 [CortexOS] Init complete. Slug: ${slug}`)
  console.log(`   Next: cortexos status --project ${slug}   (daemon must be running)`)
  return 0
}

runInit().then((code) => process.exit(code ?? 0)).catch((e) => {
  console.error('cortex-init failed:', e?.stack || e?.message || e)
  process.exit(1)
})
