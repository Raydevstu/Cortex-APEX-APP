/**
 * Intelligent Task Decomposition (blueprint Pillar 6).
 *
 * Deterministic decomposition of complex prompts into an ordered,
 * dependency-aware subtask graph across engineering domains, executed
 * BEFORE the prompt is sent to the main AI. Simple prompts pass through
 * untouched (blueprint §4: Fast-Path must stay fast).
 */
import type { Decomposition, IntentResult, Subtask } from './types'
import { splitRequirements } from './intent'

interface DomainPlan {
  domain: string
  title: (subject: string) => string
  description: (subject: string) => string
}

const DOMAIN_ORDER = [
  'database',
  'config',
  'backend',
  'auth',
  'payments',
  'integration',
  'realtime',
  'frontend',
  'performance',
  'security',
  'testing',
  'deployment',
]

const DOMAIN_PLANS: Record<string, DomainPlan> = {
  database: {
    domain: 'database',
    title: (s) => `Data model & migration — ${s}`,
    description: (s) => `Update the schema and generate migrations required by ${s}. Keep changes backward-compatible; include .env.example additions if new credentials are introduced.`,
  },
  config: {
    domain: 'config',
    title: (s) => `Configuration & environment — ${s}`,
    description: (s) => `Add/adjust configuration, environment variables and wiring needed for ${s}. Never commit secrets; update .env.example with key names only.`,
  },
  backend: {
    domain: 'backend',
    title: (s) => `Server logic & API — ${s}`,
    description: (s) => `Implement the server-side logic, API routes/handlers and service layer for ${s}, including input validation and error handling.`,
  },
  auth: {
    domain: 'auth',
    title: (s) => `Authentication & access — ${s}`,
    description: (s) => `Wire authentication/authorization boundaries for ${s}: session checks, role gates and protected resources.`,
  },
  payments: {
    domain: 'payments',
    title: (s) => `Billing integration — ${s}`,
    description: (s) => `Implement the billing logic for ${s}: provider SDK calls, idempotent webhooks, and subscription state transitions.`,
  },
  integration: {
    domain: 'integration',
    title: (s) => `Third-party integration — ${s}`,
    description: (s) => `Integrate external services/APIs required by ${s}: client wrappers, retry policy and failure modes.`,
  },
  realtime: {
    domain: 'realtime',
    title: (s) => `Real-time layer — ${s}`,
    description: (s) => `Add the real-time transport (WebSocket/SSE) and event payloads for ${s}, including reconnection handling.`,
  },
  frontend: {
    domain: 'frontend',
    title: (s) => `UI implementation — ${s}`,
    description: (s) => `Build the responsive UI for ${s} with the project's component library, loading/empty/error states and accessibility (44px touch targets, ARIA).`,
  },
  performance: {
    domain: 'performance',
    title: (s) => `Performance pass — ${s}`,
    description: (s) => `Profile and optimise hot paths affected by ${s}: caching, query reduction and render cost.`,
  },
  security: {
    domain: 'security',
    title: (s) => `Security hardening — ${s}`,
    description: (s) => `Threat-model ${s}: input sanitisation, rate limiting, secret handling and least-privilege access.`,
  },
  testing: {
    domain: 'testing',
    title: (s) => `Test coverage — ${s}`,
    description: (s) => `Write unit and integration tests for ${s}, covering the happy path, edge cases and failure modes.`,
  },
  deployment: {
    domain: 'deployment',
    title: (s) => `Ship it — ${s}`,
    description: (s) => `Prepare the release for ${s}: build validation, migration plan and rollback strategy.`,
  },
}

const GENERIC_PLANS: DomainPlan[] = [
  {
    domain: 'analysis',
    title: (s) => `Recon & design — ${s}`,
    description: (s) => `Inspect the current codebase surface relevant to ${s} and settle the design before writing code.`,
  },
  DOMAIN_PLANS.backend,
  DOMAIN_PLANS.frontend,
  DOMAIN_PLANS.testing,
]

export function decomposeTask(prompt: string, intent: IntentResult): Decomposition {
  const segments = splitRequirements(prompt)
  const subject = shorten(prompt, 70)
  const requirements = segments.map((s) => shorten(s, 90))

  const needed =
    intent.complexity >= 5 ||
    intent.domains.length >= 3 ||
    segments.length >= 3 ||
    /\bclone\b|full-?stack|end-?to-?end|complete app/i.test(prompt)

  if (!needed) {
    return {
      needed: false,
      rationale: `Complexity ${intent.complexity}/10 with ${intent.domains.length} domain(s) — single-pass execution, no decomposition required.`,
      subtasks: [],
    }
  }

  const rationale = `Complexity ${intent.complexity}/10 across ${intent.domains.length} domain(s) (${intent.domains.join(', ') || 'none detected'}) — decomposed into an ordered subtask graph before main-model execution.`

  // Choose the domain pipeline: detected domains, or the generic ladder.
  const orderedDomains =
    intent.domains.length > 0
      ? [...intent.domains].sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b))
      : GENERIC_PLANS.map((p) => p.domain)

  const subtasks: Subtask[] = []
  const completed: string[] = []

  orderedDomains.forEach((domainKey, index) => {
    const plan = DOMAIN_PLANS[domainKey] ?? GENERIC_PLANS[index % GENERIC_PLANS.length]
    const id = `t${index + 1}`
    // Each domain task depends on the previous infra/domain task (linear
    // backbone) — frontend depends on backend, tests depend on all before.
    const dependsOn = index === 0 ? [] : [completed[completed.length - 1]]

    subtasks.push({
      id,
      domain: plan.domain,
      title: plan.title(requirements[index % requirements.length] || subject),
      description: plan.description(subject),
      dependsOn,
    })
    completed.push(id)
  })

  // When we decomposed, always append a synthesis task.
  if (subtasks.length > 0) {
    const last = subtasks[subtasks.length - 1]
    subtasks.push({
      id: `t${subtasks.length + 1}`,
      domain: 'synthesis',
      title: `Integration & final pass — ${subject}`,
      description:
        'Verify all subtasks compose correctly: contracts line up, no regressions, error paths handled, then produce the final deliverable.',
      dependsOn: last ? [last.id] : [],
    })
  }

  return { needed: true, rationale, subtasks }
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  // Cut at word boundary.
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max)}…`
}
