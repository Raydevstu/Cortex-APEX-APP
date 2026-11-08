/**
 * Idempotent demo seed — the SaaS-CRM walkthrough project straight out of
 * the CortexOS blueprint (Next.js 15 + PostgreSQL + Prisma + Clerk +
 * Stripe, Sprint #4 Payments hardening, Bug #14 checkout race condition).
 * Gives the Command Center immediately meaningful state to explore and
 * provides a deterministic baseline for the Phase 1 test suite.
 */
import { db } from '@/lib/db'
import { upsertEdge, upsertNode } from './graph'

const DEMO_SLUG = 'saas-crm'

interface SeedMemory {
  type: string
  key: string
  value: string
  importance: number
  daysAgo: number
  status?: string
}

const SEED_MEMORIES: SeedMemory[] = [
  { type: 'decision', key: 'PostgreSQL', value: 'We decided to use PostgreSQL as the primary datastore — transactional guarantees required for billing.', importance: 5, daysAgo: 26 },
  { type: 'decision', key: 'Clerk', value: 'We chose Clerk for authentication — managed sessions and org support beat rolling our own.', importance: 4, daysAgo: 24 },
  { type: 'decision', key: 'Prisma', value: 'Prisma selected as ORM; single schema.prisma is the source of truth for the data model.', importance: 4, daysAgo: 24 },
  { type: 'decision', key: 'Stripe', value: 'Stripe chosen for billing; subscription lifecycle handled via webhooks with idempotency keys.', importance: 5, daysAgo: 18 },
  { type: 'decision', key: 'Tailwind CSS', value: 'Team prefers Tailwind CSS with shadcn/ui components only — no other UI libraries allowed.', importance: 3, daysAgo: 22 },
  { type: 'preference', key: 'TypeScript', value: 'Always use TypeScript strict mode; no any, no non-null assertions on external data.', importance: 4, daysAgo: 25 },
  { type: 'preference', key: 'code style', value: 'Never introduce new dependencies without team agreement; stick with the existing stack.', importance: 3, daysAgo: 20 },
  { type: 'requirement', key: 'email verification', value: 'Users must verify their email before accessing paid features.', importance: 4, daysAgo: 16 },
  { type: 'requirement', key: 'role-based access', value: 'Users must have role-based access: owner, admin, member — enforced server-side on every mutation.', importance: 5, daysAgo: 12 },
  { type: 'architecture', key: 'api structure', value: 'Architecture is a Next.js App Router monolith: src/app/api route handlers, service layer in src/lib, no separate backend service yet.', importance: 4, daysAgo: 21 },
  { type: 'todo', key: 'payment retries', value: 'We still need payment retry logic for failed invoice payments (dunning flow, 3 attempts over 7 days).', importance: 4, daysAgo: 3 },
  { type: 'todo', key: 'usage metering', value: 'Still need to add usage-based metering for the Pro plan before the Q1 launch.', importance: 3, daysAgo: 2 },
  { type: 'todo', key: 'audit log', value: 'Plan to add an audit log table for admin actions — compliance asked for it.', importance: 3, daysAgo: 5 },
  { type: 'bug', key: 'checkout race condition', value: 'Bug #14: Checkout has a race condition — two concurrent subscription upgrades can double-charge when webhooks arrive out of order. Critical, blocks launch.', importance: 5, daysAgo: 1 },
  { type: 'bug', key: 'invitation expiry', value: 'Team invitation links don\'t expire after 7 days as required — tokens remain valid indefinitely.', importance: 3, daysAgo: 4, status: 'active' },
]

const SEED_EVENTS: Array<{ kind: string; message: string; daysAgo: number; hoursOffset?: number }> = [
  { kind: 'project.created', message: 'Project bootstrapped — SaaS-CRM initialized on Codex.', daysAgo: 26 },
  { kind: 'dna.generated', message: 'Project DNA generated from workspace scan: Next.js 15 App Router + PostgreSQL + Prisma + Clerk + Stripe.', daysAgo: 25 },
  { kind: 'memory.captured', message: 'Interaction captured from Codex: 4 decisions extracted (PostgreSQL, Clerk, Prisma, Tailwind).', daysAgo: 24 },
  { kind: 'graph.updated', message: 'Knowledge Graph linked (Auth) —[USES]→ (Clerk) and (Payments) —[USES]→ (Stripe).', daysAgo: 18 },
  { kind: 'prompt.rewritten', message: 'Prompt rewritten via fast-path engine — intent: Feature build, complexity 7/10, 3,140 context tokens avoided.', daysAgo: 16 },
  { kind: 'interaction.logged', message: 'Interaction captured from Hermes: billing webhook requirements extracted (2 requirements).', daysAgo: 9 },
  { kind: 'graph.updated', message: 'Bug node created: (Checkout) —[HAS_BUG]→ (Bug: checkout race condition).', daysAgo: 1 },
]

function daysAgoDate(days: number, hoursOffset = 0): Date {
  return new Date(Date.now() - days * 86_400_000 - hoursOffset * 3_600_000)
}

export async function seedDemoProject(): Promise<{ created: boolean; projectId: string }> {
  const existing = await db.project.findUnique({ where: { slug: DEMO_SLUG } })
  if (existing) return { created: false, projectId: existing.id }

  const project = await db.project.create({
    data: {
      slug: DEMO_SLUG,
      name: 'SaaS-CRM',
      description:
        'B2B customer relationship platform — contacts, pipeline, and subscription billing. Blueprint walkthrough project.',
      platform: 'codex',
      createdAt: daysAgoDate(26),
    },
  })

  // --- Memories ------------------------------------------------------------
  for (const memory of SEED_MEMORIES) {
    await db.memory.create({
      data: {
        projectId: project.id,
        type: memory.type,
        key: memory.key,
        value: memory.value,
        importance: memory.importance,
        status: memory.status ?? 'active',
        source: 'seed',
        createdAt: daysAgoDate(memory.daysAgo),
      },
    })
  }

  // --- PROJECT DNA (manual mode — mirrors the blueprint example project) ---
  await db.projectDna.create({
    data: {
      projectId: project.id,
      architecturePhilosophy:
        'SaaS-CRM is a Next.js 15 (App Router) TypeScript application backed by PostgreSQL through Prisma, with Tailwind CSS and shadcn/ui for the design system. The workspace is organised around app routes (pages + API handlers), a components library and a service layer in lib. Clerk owns identity; Stripe owns money. Every AI working on this codebase must respect these boundaries and extend existing modules instead of inventing parallel structures.',
      techStack: JSON.stringify([
        { layer: 'Framework', technology: 'Next.js 15 (App Router)', evidence: 'package.json (next@15)' },
        { layer: 'Language', technology: 'TypeScript (strict)', evidence: 'tsconfig.json → strict:true' },
        { layer: 'Styling', technology: 'Tailwind CSS', evidence: 'package.json (tailwindcss)' },
        { layer: 'UI Kit', technology: 'shadcn/ui', evidence: 'components.json' },
        { layer: 'Database', technology: 'PostgreSQL', evidence: 'prisma datasource provider = "postgresql"' },
        { layer: 'ORM', technology: 'Prisma (11 models)', evidence: 'prisma/schema.prisma' },
        { layer: 'Auth', technology: 'Clerk', evidence: 'package.json (@clerk/nextjs)' },
        { layer: 'Payments', technology: 'Stripe', evidence: 'package.json (stripe)' },
        { layer: 'Validation', technology: 'Zod', evidence: 'package.json (zod)' },
      ]),
      codingStandards: JSON.stringify([
        { rule: 'TypeScript strict mode — no implicit any, no unchecked nullable access', source: 'tsconfig.json' },
        { rule: 'UI composed exclusively from the shadcn/ui component set', source: 'components.json' },
        { rule: 'Secrets via environment variables; never hardcode credentials', source: '.env.example' },
        { rule: 'All API handlers validate input with Zod before touching the database', source: 'team convention' },
      ]),
      businessRules: JSON.stringify([
        'Users must verify their email before accessing paid features.',
        'Role-based access (owner/admin/member) enforced server-side on every mutation.',
        'Subscription state changes only via idempotent Stripe webhooks.',
      ]),
      preferredLibraries: JSON.stringify([
        { purpose: 'Runtime input validation', library: 'zod', source: 'package.json' },
        { purpose: 'Database access & migrations', library: 'prisma', source: 'package.json' },
        { purpose: 'Icons', library: 'lucide-react', source: 'package.json' },
        { purpose: 'Date/time utilities', library: 'date-fns', source: 'package.json' },
      ]),
      designPatterns: JSON.stringify([
        'App Router file-based routing (route segments colocate page/layout/loading/error boundaries)',
        'API surface as colocated route handlers under app/api/**',
        'Service layer in src/lib — framework-agnostic business logic',
        'Single Prisma schema as the source of truth for the data model',
      ]),
      deploymentStrategy:
        'Vercel deployment from main branch. Prisma migrations run in the release pipeline; Stripe webhook secrets rotated quarterly.',
      fileStats: JSON.stringify({
        scannedFiles: 184,
        scannedDirs: 41,
        totalLines: 21_450,
        languages: { ts: 96, tsx: 61, css: 9, json: 12, prisma: 1, sql: 5 },
        topDirs: [
          { path: 'app', files: 74 },
          { path: 'components', files: 43 },
          { path: 'lib', files: 31 },
          { path: 'hooks', files: 12 },
        ],
        codeMap: [],
        prismaModels: ['User', 'Organization', 'Membership', 'Contact', 'Deal', 'Stage', 'Subscription', 'Invoice', 'WebhookEvent', 'AuditLog', 'Invitation'],
        envKeys: ['DATABASE_URL', 'CLERK_SECRET_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXT_PUBLIC_APP_URL'],
        packageDeps: ['next', 'react', '@clerk/nextjs', 'stripe', 'prisma', '@prisma/client', 'zod', 'tailwindcss', 'lucide-react', 'date-fns'],
        scannedAt: daysAgoDate(25).toISOString(),
      }),
      generationSource: 'seed',
      generatedAt: daysAgoDate(25),
    },
  })

  // --- Knowledge Graph ------------------------------------------------------
  const root = await upsertNode(project.id, 'root', 'SaaS-CRM', { role: 'project-root' })

  const modules: Array<[string, Record<string, unknown>]> = [
    ['Frontend', { dir: 'app/(dashboard)' }],
    ['Backend', { dir: 'app/api' }],
    ['Auth', { dir: 'app/api/auth' }],
    ['Payments', { dir: 'app/api/webhooks/stripe' }],
    ['Checkout', { dir: 'app/checkout' }],
    ['Data Layer', { dir: 'lib/db' }],
  ]
  const moduleIds = new Map<string, string>()
  for (const [label, props] of modules) {
    const id = await upsertNode(project.id, 'module', label, props)
    moduleIds.set(label, id)
    await upsertEdge(project.id, root, id, 'CONTAINS')
  }

  const techs: Array<[string, string, string]> = [
    ['Next.js 15', 'Framework', 'package.json'],
    ['TypeScript', 'Language', 'tsconfig.json'],
    ['Tailwind CSS', 'Styling', 'package.json'],
    ['shadcn/ui', 'UI Kit', 'components.json'],
    ['PostgreSQL', 'Database', 'prisma datasource'],
    ['Prisma', 'ORM', 'schema.prisma'],
    ['Clerk', 'Auth', 'package.json'],
    ['Stripe', 'Payments', 'package.json'],
    ['Zod', 'Validation', 'package.json'],
  ]
  const techIds = new Map<string, string>()
  for (const [label, layer, evidence] of techs) {
    const id = await upsertNode(project.id, 'tech', label, { layer, evidence })
    techIds.set(label, id)
    await upsertEdge(project.id, root, id, 'USES')
  }

  // Domain wiring: modules USES tech
  const wiring: Array<[string, string[]]> = [
    ['Frontend', ['Next.js 15', 'TypeScript', 'Tailwind CSS', 'shadcn/ui']],
    ['Backend', ['Next.js 15', 'TypeScript', 'Zod', 'Prisma']],
    ['Auth', ['Clerk', 'TypeScript']],
    ['Payments', ['Stripe', 'TypeScript', 'Prisma']],
    ['Checkout', ['Stripe', 'Tailwind CSS', 'shadcn/ui']],
    ['Data Layer', ['PostgreSQL', 'Prisma']],
  ]
  for (const [moduleLabel, techLabels] of wiring) {
    for (const techLabel of techLabels) {
      const moduleId = moduleIds.get(moduleLabel)
      const techId = techIds.get(techLabel)
      if (moduleId && techId) await upsertEdge(project.id, moduleId, techId, 'USES')
    }
  }

  // Features & the critical bug triple from the blueprint
  const checkoutFeature = await upsertNode(project.id, 'feature', 'Checkout flow', { status: 'blocked' })
  if (moduleIds.get('Checkout')) {
    await upsertEdge(project.id, moduleIds.get('Checkout')!, checkoutFeature, 'IMPLEMENTS')
  }
  const bugNode = await upsertNode(project.id, 'bug', 'Bug #14: checkout race condition', {
    severity: 5,
    detail: 'Two concurrent subscription upgrades can double-charge when webhooks arrive out of order.',
  })
  await upsertEdge(project.id, checkoutFeature, bugNode, 'BLOCKED_BY')
  if (moduleIds.get('Payments')) {
    await upsertEdge(project.id, moduleIds.get('Payments')!, bugNode, 'HAS_BUG')
  }

  const dashboardFeature = await upsertNode(project.id, 'feature', 'Pipeline dashboard', { status: 'shipped' })
  if (moduleIds.get('Frontend')) {
    await upsertEdge(project.id, moduleIds.get('Frontend')!, dashboardFeature, 'IMPLEMENTS')
  }

  // Cross-platform sync edge (Codex ↔ Hermes) — the Phase 2 promise, visible now
  const codexNode = await upsertNode(project.id, 'external', 'Codex', { kind: 'ai-platform' })
  const hermesNode = await upsertNode(project.id, 'external', 'Hermes', { kind: 'ai-platform' })
  await upsertEdge(project.id, codexNode, hermesNode, 'SYNCED_WITH', 1)
  await upsertEdge(project.id, root, codexNode, 'SYNCED_WITH')

  // --- Timeline -------------------------------------------------------------
  for (const event of SEED_EVENTS) {
    await db.timelineEvent.create({
      data: {
        projectId: project.id,
        kind: event.kind,
        message: event.message,
        createdAt: daysAgoDate(event.daysAgo, event.hoursOffset ?? 0),
      },
    })
  }

  // --- A representative prompt session (fast-path, from the blueprint ex.) --
  await db.promptSession.create({
    data: {
      projectId: project.id,
      rawPrompt: 'add stripe webhook for subscription renewal and update user db',
      rewrittenPrompt:
        '[CORTEX-OS SYNC | Project: SaaS-CRM | Platform: codex | Delta State: #9f8a2c]\n\n## Context\nB2B customer relationship platform — contacts, pipeline, and subscription billing.\n\n## Tech Stack\n- Framework: Next.js 15 (App Router)\n- Database: PostgreSQL\n- ORM: Prisma\n- Auth: Clerk\n- Payments: Stripe\n\n## Known State (Knowledge Graph pointers)\n- (Payments) —[USES]→ (Stripe)\n- (Checkout) —[BLOCKED_BY]→ (Bug #14: checkout race condition)\n\n## Open Items & Project Memory\n- [TODO] payment retries: dunning flow, 3 attempts over 7 days\n- [DECISION] Stripe: subscription lifecycle via idempotent webhooks\n\n## Requirements\n1. Add a Stripe webhook handler for subscription renewal events.\n2. Update the user database to reflect renewal state.\n\n## Constraints\n- TypeScript strict mode — no implicit any.\n- All API handlers validate input with Zod before touching the database.\n- Subscription state changes only via idempotent Stripe webhooks.\n\n## Deliverables\n- Complete, production-ready implementation with race-condition safety.',
      engine: 'fast',
      intent: 'feature_build',
      complexity: 6,
      routing: JSON.stringify({ tier: 'local-agent', target: 'local agent with tools (Phase 3) → main model for core logic', reason: 'Medium complexity — local agent pre-completes boilerplate/research, main model handles core logic.' }),
      decomposition: JSON.stringify({ needed: false, rationale: 'Complexity 6/10 with 2 domains — single-pass execution.', subtasks: [] }),
      contextUsed: JSON.stringify({ memories: 4, graphPointers: 2, stackLines: 9, tokensNaiveContext: 4210, tokensCompactContext: 1070 }),
      tokensRaw: 12,
      tokensStructured: 246,
      tokensContextAvoided: 3140,
      durationMs: 38,
      createdAt: daysAgoDate(16),
    },
  })

  await db.interaction.create({
    data: {
      projectId: project.id,
      title: 'Billing requirements session',
      platform: 'hermes',
      rawText:
        'We decided to use Stripe for billing. Users must verify their email before accessing paid features. We still need payment retry logic for failed invoice payments. Team prefers Tailwind CSS with shadcn/ui components only.',
      memoriesExtracted: 4,
      createdAt: daysAgoDate(9),
    },
  })

  return { created: true, projectId: project.id }
}
