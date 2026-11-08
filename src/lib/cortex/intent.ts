/**
 * Intent & complexity triage — the Fast-Path classifier (blueprint §4).
 *
 * Runs in <1ms with zero LLM tokens: weighted keyword/pattern scoring
 * across intent categories, engineering-domain detection, and a
 * complexity model that feeds the Smart Routing recommendation
 * (blueprint Pillar 8: Simple → local model, Complex → main model).
 */
import type { IntentResult, IntentType, RoutingDecision } from './types'

interface IntentRule {
  intent: IntentType
  patterns: RegExp[]
  weight: number
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'bugfix',
    weight: 1.4,
    patterns: [
      /\bfix\b/i, /\bbug\b/i, /\bbroken\b/i, /\bcrash(es|ing|ed)?\b/i,
      /\bfail(s|ing|ed|ure)?\b/i, /\berror\b/i, /doesn'?t work/i,
      /does not work/i, /not working/i, /\bregression\b/i,
      /\brace condition\b/i, /\bdeadlock\b/i, /\bexception\b/i,
    ],
  },
  {
    intent: 'refactor',
    weight: 1.1,
    patterns: [
      /\brefactor\b/i, /\bclean up\b/i, /\brestructure\b/i,
      /\boptimi[sz]e\b/i, /\bimprove\b/i, /\bsimplify\b/i,
      /\bsplit\b/i, /\bextract\b/i, /\brename\b/i, /\bdeduplicate\b/i,
    ],
  },
  {
    intent: 'feature_build',
    weight: 1.3,
    patterns: [
      /\b(add|build|create|implement|integrate|make|generate|develop|write)\b/i,
      /\bi want\b/i, /\bwe need\b/i, /\bsupport for\b/i,
      /\bclone\b/i, /\bpage\b/i, /\bscreen\b/i, /\bfeature\b/i,
    ],
  },
  {
    intent: 'research',
    weight: 0.9,
    patterns: [
      /\b(what|why|how|when|which)\b.*\?/i, /\bresearch\b/i,
      /\bcompare\b/i, /\bexplain\b/i, /\binvestigate\b/i,
      /\bpros and cons\b/i, /\bshould (we|i) (use|pick|choose)\b/i,
    ],
  },
  {
    intent: 'config',
    weight: 0.8,
    patterns: [
      /\bconfig(ure|uration)?\b/i, /\benv(ironment)? vars?\b/i, /\.env\b/i,
      /\bset ?up\b/i, /\bsettings\b/i, /\bmiddleware\b/i, /\bcors\b/i,
    ],
  },
  {
    intent: 'boilerplate',
    weight: 0.8,
    patterns: [
      /\bscaffold\b/i, /\bboilerplate\b/i, /\bstub\b/i, /\bskeleton\b/i,
      /\btemplate\b/i, /\binitialize\b/i, /\bcli\b/i,
    ],
  },
  {
    intent: 'question',
    weight: 0.7,
    patterns: [/\?$/, /\bhow does\b/i, /\bwhere is\b/i, /\bis it\b/i, /\bcan (we|i)\b/i],
  },
  {
    intent: 'docs',
    weight: 0.7,
    patterns: [/\bdocument(ation|ation)?\b/i, /\breadme\b/i, /\bcomments?\b/i, /\bchangelog\b/i],
  },
  {
    intent: 'deploy',
    weight: 0.9,
    patterns: [/\bdeploy\b/i, /\bdocker\b/i, /\bci\/cd\b/i, /\bpipeline\b/i, /\bvercel\b/i, /\bproduction release\b/i],
  },
  {
    intent: 'test',
    weight: 0.9,
    patterns: [/\btest(s|ing)?\b/i, /\bunit test/i, /\be2e\b/i, /\bspec\b/i, /\bcoverage\b/i],
  },
]

const DOMAIN_KEYWORDS: Record<string, RegExp> = {
  frontend: /\b(ui|page|component|button|form|modal|nav|header|footer|css|tailwind|responsive|layout|dashboard|screen|frontend|front-end)\b/i,
  backend: /\b(api|endpoint|route|server|controller|service|backend|back-end|rest|graphql|middleware)\b/i,
  database: /\b(db|database|schema|migration|prisma|sql|table|model|query|index|postgres|mysql|mongo)\b/i,
  auth: /\b(auth|login|logout|signup|session|jwt|token|clerk|oauth|password|permission|role)\b/i,
  payments: /\b(stripe|payment|billing|subscription|invoice|checkout|refund|webhook)\b/i,
  testing: /\b(test|tests|testing|spec|vitest|jest|playwright|coverage|e2e)\b/i,
  deployment: /\b(deploy|docker|ci|cd|pipeline|vercel|kubernetes|production)\b/i,
  realtime: /\b(websocket|socket|real-?time|live|stream|sse)\b/i,
  integration: /\b(integrat\w+|webhook|third-?party|api key|oauth|sync)\b/i,
  performance: /\b(perf\w*|slow|latency|cache|caching|optimi[sz]e|benchmark)\b/i,
  security: /\b(security|vulnerab\w+|encrypt\w*|sanitize|xss|csrf|rate.?limit)\b/i,
}

const CRITICAL_SIGNALS =
  /\b(production|critical|urgent|data loss|security|payment|money|race condition|outage)\b/i

// Conjunctions that separate distinct requirements. Plain " and " only
// counts when followed by an imperative verb ("add X and update Y") so
// noun phrases ("login and signup page") stay intact.
const CONJUNCTION_SPLIT =
  /\b(?:and then|then also|plus|as well as|along with|, and|;)\b|\s+and\s+(?=(?:add|update|create|build|fix|make|write|implement|remove|delete|change|generate|support|integrate|handle|configure|refactor|test|deploy|migrate|update)\b)/i

export function classifyIntent(prompt: string): IntentResult {
  const text = prompt.trim()
  const signals: string[] = []

  // --- Intent scoring -----------------------------------------------------
  const scores = new Map<IntentType, number>()
  for (const rule of INTENT_RULES) {
    let hits = 0
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) hits += 1
    }
    if (hits > 0) {
      scores.set(rule.intent, (scores.get(rule.intent) ?? 0) + hits * rule.weight)
    }
  }

  let intent: IntentType = 'feature_build'
  let best = 0
  for (const [candidate, score] of scores) {
    if (score > best) {
      best = score
      intent = candidate
    }
  }
  if (best === 0) {
    // No lexical signal at all — treat as an open-ended build request.
    intent = 'feature_build'
    signals.push('no lexical signal — defaulted to feature_build')
  } else {
    signals.push(`matched ${intent} patterns (score ${best.toFixed(1)})`)
  }

  // --- Domain detection ---------------------------------------------------
  const domains: string[] = []
  for (const [domain, pattern] of Object.entries(DOMAIN_KEYWORDS)) {
    if (pattern.test(text)) domains.push(domain)
  }
  if (domains.length > 0) signals.push(`domains: ${domains.join(', ')}`)

  // --- Complexity model (1..10) -------------------------------------------
  const words = text.split(/\s+/).filter(Boolean).length
  const segments = splitRequirements(text)
  let complexity = 2
  complexity += Math.min(2, Math.floor(words / 40)) // length factor
  complexity += Math.min(3, domains.length) // multi-domain factor
  complexity += Math.min(2, Math.max(0, segments.length - 1)) // multi-requirement factor
  if (CONJUNCTION_SPLIT.test(text)) complexity += 1
  if (CRITICAL_SIGNALS.test(text)) complexity += 1
  if (intent === 'bugfix' && CRITICAL_SIGNALS.test(text)) complexity += 1
  if (intent === 'research' || intent === 'question') complexity = Math.min(complexity, 4)
  complexity = Math.max(1, Math.min(10, Math.round(complexity)))
  signals.push(`complexity ${complexity}/10 (${segments.length} requirement segment(s), ${domains.length} domain(s))`)

  // --- Smart routing recommendation (blueprint Pillar 8) -------------------
  const routing = route(intent, complexity, domains)

  const confidence = best === 0 ? 0.3 : Math.min(0.95, 0.45 + best * 0.12)

  return { intent, confidence, complexity, domains, routing, signals }
}

function route(intent: IntentType, complexity: number, domains: string[]): RoutingDecision {
  if (intent === 'research' || intent === 'question') {
    return {
      tier: 'fast-path',
      target: 'local model (Ollama)',
      reason: 'Informational request — answerable by local model, no main-model tokens needed.',
    }
  }
  if (complexity <= 3) {
    return {
      tier: 'fast-path',
      target: 'local model (Ollama)',
      reason: 'Simple task — pre-execute locally, forward only the result to the main model.',
    }
  }
  if (complexity <= 6 || domains.length <= 2) {
    return {
      tier: 'local-agent',
      target: 'local agent with tools (Phase 3) → main model for core logic',
      reason: 'Medium complexity — local agent pre-completes boilerplate/research, main model handles core logic.',
    }
  }
  return {
    tier: 'main-model',
    target: 'Codex / main model directly',
    reason: 'High complexity, multi-domain architectural task — route to the main model with Tier-1 context injected.',
  }
}

/** Split a raw prompt into atomic requirement segments. Shared by the
 *  classifier (complexity) and the Tier-1 rewriter (Requirements section). */
export function splitRequirements(prompt: string): string[] {
  const normalized = prompt.replace(/\r/g, '').trim()
  const segments: string[] = []

  // Explicit lists / lines take priority.
  const lines = normalized
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 2)

  const candidates =
    lines.length > 1 ? lines : normalized.split(CONJUNCTION_SPLIT).map((s) => s.trim())

  for (const segment of candidates) {
    const cleaned = segment.replace(/^(?:and|also|then|plus)\s+/i, '').replace(/[.;]+$/, '').trim()
    if (cleaned.length > 2 && !segments.includes(cleaned)) {
      segments.push(cleaned)
    }
  }
  return segments.length > 0 ? segments : [normalized]
}
