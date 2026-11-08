/**
 * PROJECT DNA generator (blueprint "Revolutionary Features → AI Project DNA").
 *
 * Composes the six DNA sections (architecture philosophy, tech stack,
 * coding standards, business rules, preferred libraries, design patterns,
 * deployment strategy) from a deterministic workspace scan, and syncs the
 * detected entities into the Project Knowledge Graph as typed triples.
 */
import { db } from '@/lib/db'
import type {
  CodingStandard,
  DnaDocument,
  PreferredLibrary,
  TechStackEntry,
  WorkspaceScan,
} from './types'
import { upsertEdge, upsertNode } from './graph'

export function composeDna(
  scan: WorkspaceScan,
  projectName: string,
  businessRules: string[] = [],
): DnaDocument {
  const techStack = detectTechStack(scan)
  const codingStandards = detectCodingStandards(scan)
  const preferredLibraries = detectPreferredLibraries(scan)
  const designPatterns = detectDesignPatterns(scan)
  const architecturePhilosophy = composePhilosophy(scan, projectName, techStack, designPatterns)
  const deploymentStrategy = detectDeployment(scan)

  return {
    architecturePhilosophy,
    techStack,
    codingStandards,
    businessRules,
    preferredLibraries,
    designPatterns,
    deploymentStrategy,
    fileStats: scan.fileStats,
  }
}

// ---------------------------------------------------------------------------
// Tech stack detection — every entry carries machine-checkable evidence.
// ---------------------------------------------------------------------------

function detectTechStack(scan: WorkspaceScan): TechStackEntry[] {
  const stack: TechStackEntry[] = []
  const deps = {
    ...(scan.packageJson?.dependencies ?? {}),
    ...(scan.packageJson?.devDependencies ?? {}),
  }
  const has = (name: string): boolean => name in deps
  const version = (name: string): string => deps[name] ?? ''
  const dep = (name: string): string => `declared in package.json (${name}@${version(name)})`
  const dirs = scan.fileStats.topDirs.map((d) => d.path)
  const hasDir = (fragment: string): boolean => dirs.some((d) => d.includes(fragment))

  if (has('next')) {
    const appRouter = hasDir('app') || scan.nextConfigFile !== null
    stack.push({
      layer: 'Framework',
      technology: `Next.js${appRouter ? ' (App Router)' : ''}`,
      evidence: dep('next'),
    })
  }
  if (has('react') && !has('next')) {
    stack.push({ layer: 'Framework', technology: 'React', evidence: dep('react') })
  }
  if (has('vue')) stack.push({ layer: 'Framework', technology: 'Vue', evidence: dep('vue') })
  if (has('svelte')) stack.push({ layer: 'Framework', technology: 'Svelte', evidence: dep('svelte') })
  if (has('express')) stack.push({ layer: 'Server', technology: 'Express', evidence: dep('express') })
  if (has('fastify')) stack.push({ layer: 'Server', technology: 'Fastify', evidence: dep('fastify') })
  if (has('hono')) stack.push({ layer: 'Server', technology: 'Hono', evidence: dep('hono') })
  if (has('nest')) stack.push({ layer: 'Server', technology: 'NestJS', evidence: dep('@nestjs/core') })

  if (scan.tsConfig) {
    const compilerOptions = (scan.tsConfig.compilerOptions ?? {}) as Record<string, unknown>
    stack.push({
      layer: 'Language',
      technology: `TypeScript${compilerOptions.strict === true ? ' (strict)' : ''}`,
      evidence: `tsconfig.json${compilerOptions.strict === true ? ' with strict:true' : ''}`,
    })
  } else if (Object.keys(scan.fileStats.languages).some((l) => l === 'py')) {
    stack.push({ layer: 'Language', technology: 'Python', evidence: '.py source files detected' })
  }

  if (has('tailwindcss') || scan.fileStats.languages['css'] !== undefined) {
    if (has('tailwindcss')) {
      stack.push({ layer: 'Styling', technology: 'Tailwind CSS', evidence: dep('tailwindcss') })
    }
  }
  if (scan.componentsJson) {
    stack.push({ layer: 'UI Kit', technology: 'shadcn/ui', evidence: 'components.json present' })
  }
  if (has('@radix-ui/react-dialog') || has('@radix-ui/react-dropdown-menu')) {
    stack.push({ layer: 'UI Primitives', technology: 'Radix UI', evidence: dep('@radix-ui/react-dialog') })
  }
  if (has('lucide-react')) {
    stack.push({ layer: 'Icons', technology: 'lucide-react', evidence: dep('lucide-react') })
  }

  if (scan.prismaSchemaFile) {
    stack.push({
      layer: 'ORM',
      technology: `Prisma (${scan.prismaModels.length} models)`,
      evidence: scan.prismaSchemaFile,
    })
    if (scan.prismaDatasourceProvider) {
      stack.push({
        layer: 'Database',
        technology: prettifyProvider(scan.prismaDatasourceProvider),
        evidence: `prisma datasource provider = "${scan.prismaDatasourceProvider}"`,
      })
    }
  }
  if (has('drizzle-orm')) stack.push({ layer: 'ORM', technology: 'Drizzle', evidence: dep('drizzle-orm') })

  if (has('@clerk/nextjs')) stack.push({ layer: 'Auth', technology: 'Clerk', evidence: dep('@clerk/nextjs') })
  if (has('next-auth')) stack.push({ layer: 'Auth', technology: 'NextAuth.js', evidence: dep('next-auth') })
  if (has(' stripe')) stack.push({ layer: 'Payments', technology: 'Stripe', evidence: dep('stripe') })
  if (has('stripe')) stack.push({ layer: 'Payments', technology: 'Stripe', evidence: dep('stripe') })

  if (has('zod')) stack.push({ layer: 'Validation', technology: 'Zod', evidence: dep('zod') })
  if (has('zustand')) stack.push({ layer: 'State', technology: 'Zustand', evidence: dep('zustand') })
  if (has('@tanstack/react-query')) {
    stack.push({ layer: 'Server State', technology: 'TanStack Query', evidence: dep('@tanstack/react-query') })
  }
  if (has('socket.io') || has('socket.io-client')) {
    stack.push({ layer: 'Realtime', technology: 'Socket.IO', evidence: dep('socket.io') })
  }
  if (has('recharts')) stack.push({ layer: 'Charts', technology: 'Recharts', evidence: dep('recharts') })
  if (has('framer-motion') || has('motion')) {
    stack.push({ layer: 'Animation', technology: 'Framer Motion', evidence: dep('framer-motion') })
  }
  if (has('@prisma/client') && !scan.prismaSchemaFile) {
    stack.push({ layer: 'ORM', technology: 'Prisma', evidence: dep('@prisma/client') })
  }

  return stack
}

function detectCodingStandards(scan: WorkspaceScan): CodingStandard[] {
  const standards: CodingStandard[] = []
  const ts = scan.tsConfig ? ((scan.tsConfig.compilerOptions ?? {}) as Record<string, unknown>) : null

  if (ts?.strict === true) {
    standards.push({ rule: 'TypeScript strict mode — no implicit any, no unchecked nullable access', source: 'tsconfig.json → compilerOptions.strict' })
  } else if (scan.tsConfig) {
    standards.push({ rule: 'TypeScript with relaxed strictness — prefer explicit types at boundaries', source: 'tsconfig.json' })
  }
  if (typeof ts?.target === 'string') {
    standards.push({ rule: `Compile target ${ts.target}`, source: 'tsconfig.json → compilerOptions.target' })
  }
  const paths = ts?.paths as Record<string, string[]> | undefined
  if (paths && Object.keys(paths).length > 0) {
    const alias = Object.entries(paths).map(([k, v]) => `${k} → ${v[0]}`).join(', ')
    standards.push({ rule: `Path aliases: ${alias}`, source: 'tsconfig.json → compilerOptions.paths' })
  }
  if (scan.eslintConfigFile) {
    standards.push({ rule: 'ESLint enforced at the repo root (CI/dev gate)', source: scan.eslintConfigFile })
  }
  if (scan.prettierConfigFile) {
    standards.push({ rule: 'Prettier formatting (consistent quotes/semicolons)', source: scan.prettierConfigFile })
  }
  if (scan.envExampleKeys.length > 0) {
    standards.push({
      rule: `Secrets via environment variables (${scan.envExampleKeys.slice(0, 4).join(', ')}${scan.envExampleKeys.length > 4 ? ', …' : ''}); never hardcode credentials`,
      source: '.env.example',
    })
  }
  if (scan.componentsJson) {
    standards.push({ rule: 'UI composed from the shadcn/ui component set (New York style)', source: 'components.json' })
  }

  const tsShare = shareOfLanguage(scan, ['ts', 'tsx'])
  if (tsShare > 0.5) {
    standards.push({
      rule: `${Math.round(tsShare * 100)}% of source files are TypeScript — all new code must be TypeScript`,
      source: 'code map language distribution',
    })
  }
  return standards
}

function detectPreferredLibraries(scan: WorkspaceScan): PreferredLibrary[] {
  const libs: PreferredLibrary[] = []
  const push = (purpose: string, library: string, source: string) =>
    libs.push({ purpose, library, source })

  const has = (name: string) =>
    name in (scan.packageJson?.dependencies ?? {}) || name in (scan.packageJson?.devDependencies ?? {})

  if (has('zod')) push('Runtime input validation', 'zod', 'package.json')
  if (has('zustand')) push('Client state management', 'zustand', 'package.json')
  if (has('@tanstack/react-query')) push('Server-state & caching', '@tanstack/react-query', 'package.json')
  if (has('lucide-react')) push('Icon set', 'lucide-react', 'package.json')
  if (has('date-fns')) push('Date/time utilities', 'date-fns', 'package.json')
  if (has('clsx') || has('tailwind-merge')) push('Classname composition', 'clsx + tailwind-merge', 'package.json')
  if (has('sonner')) push('Toast notifications', 'sonner', 'package.json')
  if (has('recharts')) push('Data visualisation', 'recharts', 'package.json')
  if (has('prisma')) push('Database access & migrations', 'prisma', 'package.json')
  if (has('vitest')) push('Unit testing', 'vitest', 'package.json')
  if (has('playwright')) push('E2E testing', 'playwright', 'package.json')
  return libs
}

function detectDesignPatterns(scan: WorkspaceScan): string[] {
  const patterns: string[] = []
  const dirs = scan.fileStats.topDirs.map((d) => d.path)
  const hasDir = (fragment: string) => dirs.some((d) => d === fragment || d.startsWith(`${fragment}/`) || d.includes(fragment))
  const hasFilePrefix = (prefix: string) => scan.fileStats.codeMap.some((f) => f.path.startsWith(prefix))

  if (hasDir('app') || hasFilePrefix('src/app')) {
    patterns.push('App Router file-based routing (route segments colocate page/layout/loading/error boundaries)')
  }
  if (hasFilePrefix('src/app/api') || hasFilePrefix('app/api')) {
    patterns.push('API surface as colocated route handlers (serverless-style endpoints under app/api/**)')
  }
  if (hasDir('components') || hasFilePrefix('src/components')) {
    patterns.push('Component-driven UI: reusable presentation components under src/components')
  }
  if (hasDir('lib') || hasFilePrefix('src/lib')) {
    patterns.push('Framework-agnostic core: business engines and data access isolated in src/lib (no React imports)')
  }
  if (hasDir('hooks') || hasFilePrefix('src/hooks')) {
    patterns.push('Custom React hooks encapsulate stateful behaviour (src/hooks)')
  }
  if (scan.prismaSchemaFile) {
    patterns.push('Single Prisma schema as the source of truth for the data model')
  }
  if (scan.fileStats.codeMap.length > 20) {
    patterns.push('Typed module boundaries — explicit interfaces/DTOs between layers')
  }
  return patterns
}

function composePhilosophy(
  scan: WorkspaceScan,
  projectName: string,
  stack: TechStackEntry[],
  patterns: string[],
): string {
  const framework = stack.find((s) => s.layer === 'Framework')?.technology ?? 'application'
  const language = stack.find((s) => s.layer === 'Language')?.technology ?? 'TypeScript'
  const db = stack.find((s) => s.layer === 'Database')?.technology
  const orm = stack.find((s) => s.layer === 'ORM')?.technology
  const styling = stack.find((s) => s.layer === 'Styling')?.technology

  const parts: string[] = [
    `${projectName} is a ${framework} ${language} application`,
  ]
  if (db && orm) parts.push(`backed by ${db} through ${orm}`)
  else if (db) parts.push(`backed by ${db}`)
  if (styling) parts.push(`with ${styling} for the design system`)

  const structure = scan.fileStats.topDirs.slice(0, 4).map((d) => d.path).filter((d) => d !== '.')
  if (structure.length > 0) {
    parts.push(`The workspace is organised around ${structure.join(', ')} (${scan.fileStats.scannedFiles} files scanned, ${scan.fileStats.totalLines.toLocaleString()} source lines mapped)`)
  }
  if (patterns.length > 0) {
    parts.push(`Core patterns: ${patterns.slice(0, 3).map((p) => p.split(':')[0].split('(')[0].trim().toLowerCase()).join('; ')}`)
  }
  parts.push('Every AI working on this codebase must respect these boundaries and extend existing modules instead of inventing parallel structures.')
  return `${parts.join('. ')}.`
}

function detectDeployment(scan: WorkspaceScan): string {
  const scripts = scan.packageJson?.scripts ?? {}
  if ('docker' in scripts || scan.fileStats.languages['dockerfile'] !== undefined) {
    return 'Containerised deployment (Docker). Build the image, run migrations, then start the server.'
  }
  if (scan.nextConfigFile && scripts.build?.includes('next build')) {
    return 'Next.js production build (standalone-capable). Deploy the built server with `next start` or the platform adapter (Vercel-compatible).'
  }
  if (scripts.build) {
    return `Production build via \`npm run build\` (${scripts.build}).`
  }
  return 'Not yet defined — no build/deploy pipeline detected in the manifest.'
}

function shareOfLanguage(scan: WorkspaceScan, exts: string[]): number {
  const sourceTotal = Object.entries(scan.fileStats.languages)
    .filter(([ext]) => ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs'].includes(ext))
    .reduce((sum, [, count]) => sum + count, 0)
  if (sourceTotal === 0) return 0
  const target = Object.entries(scan.fileStats.languages)
    .filter(([ext]) => exts.includes(ext))
    .reduce((sum, [, count]) => sum + count, 0)
  return target / sourceTotal
}

const PROVIDER_LABELS: Record<string, string> = {
  sqlite: 'SQLite',
  postgresql: 'PostgreSQL',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  mongodb: 'MongoDB',
  cockroachdb: 'CockroachDB',
  sqlserver: 'SQL Server',
}

function prettifyProvider(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}

// ---------------------------------------------------------------------------
// Graph sync — DNA entities become Knowledge Graph triples
// ---------------------------------------------------------------------------

/** Layer → module-name heuristics for wiring USES edges. */
const LAYER_MODULE_HINTS: Array<{ layers: string[]; fragments: string[] }> = [
  { layers: ['Framework', 'Styling', 'UI Kit', 'UI Primitives', 'Icons', 'Language', 'Animation', 'State', 'Server State'], fragments: ['app', 'components', 'frontend', 'ui', 'web'] },
  { layers: ['Server', 'ORM', 'Database', 'Validation', 'Realtime'], fragments: ['api', 'lib', 'server', 'backend', 'db', 'prisma'] },
  { layers: ['Auth'], fragments: ['auth', 'api', 'middleware', 'lib'] },
  { layers: ['Payments'], fragments: ['payments', 'billing', 'api', 'checkout', 'webhooks'] },
]

export async function syncGraphFromDna(projectId: string, projectName: string, dna: DnaDocument): Promise<number> {
  const rootKey = await upsertNode(projectId, 'root', projectName, { role: 'project-root' })

  const moduleLabels = new Set<string>()
  for (const dir of dna.fileStats.topDirs.slice(0, 8)) {
    const label = dir.path.split('/')[0]
    if (!label || label === '.' || IGNORE_LABELS.has(label)) continue
    moduleLabels.add(label)
  }

  const moduleIds = new Map<string, string>()
  for (const label of moduleLabels) {
    const pretty = prettifyModule(label)
    moduleIds.set(label, await upsertNode(projectId, 'module', pretty, { source: 'dna-scan', dir: label }))
    await upsertEdge(projectId, rootKey, moduleIds.get(label)!, 'CONTAINS')
  }

  let techEdges = 0
  for (const entry of dna.techStack) {
    const techId = await upsertNode(projectId, 'tech', entry.technology, {
      layer: entry.layer,
      evidence: entry.evidence,
    })
    await upsertEdge(projectId, rootKey, techId, 'USES')
    techEdges += 1

    const hint = LAYER_MODULE_HINTS.find((h) => h.layers.includes(entry.layer))
    if (hint) {
      for (const [dir, moduleId] of moduleIds) {
        if (hint.fragments.some((f) => dir.includes(f))) {
          await upsertEdge(projectId, moduleId, techId, 'USES')
          techEdges += 1
        }
      }
    }
  }

  return techEdges
}

const IGNORE_LABELS = new Set(['public', 'docs', 'scripts', 'tests', 'db', 'node_modules'])
const MODULE_PRETTY: Record<string, string> = {
  app: 'App Router',
  components: 'Components',
  lib: 'Core Library',
  hooks: 'Hooks',
  api: 'API Layer',
  prisma: 'Data Layer',
  pages: 'Pages',
  styles: 'Styles',
  cortex: 'Cortex Engines',
}

function prettifyModule(label: string): string {
  return MODULE_PRETTY[label] ?? label.charAt(0).toUpperCase() + label.slice(1)
}
