/**
 * Universal AI Memory Engine — deterministic extractor (blueprint Pillar 1).
 *
 * Parses raw interaction text (chat transcripts pasted from Codex, Hermes,
 * Claude…) and extracts typed memories: technical decisions, architecture
 * facts, requirements, TODOs, bugs and user preferences — with zero LLM
 * tokens. Each pattern is anchored to real-world phrasing observed in
 * AI-assisted dev chats.
 */
import type { ExtractedMemory, MemoryType } from './types'

// Known tech entities — used to produce crisp memory keys ("database" →
// "PostgreSQL") and to link memories to Knowledge Graph tech nodes.
export const TECH_ENTITIES: Record<string, string> = {
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  psql: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  mongodb: 'MongoDB',
  mongo: 'MongoDB',
  redis: 'Redis',
  sqlite: 'SQLite',
  supabase: 'Supabase',
  firebase: 'Firebase',
  planetsy: 'PlanetScale',
  prisma: 'Prisma',
  drizzle: 'Drizzle',
  typeorm: 'TypeORM',
  nextjs: 'Next.js',
  'next.js': 'Next.js',
  next: 'Next.js',
  react: 'React',
  vue: 'Vue',
  svelte: 'Svelte',
  angular: 'Angular',
  tailwind: 'Tailwind CSS',
  shadcn: 'shadcn/ui',
  mui: 'MUI',
  clerk: 'Clerk',
  nextauth: 'NextAuth',
  'next-auth': 'NextAuth',
  auth0: 'Auth0',
  supertokens: 'SuperTokens',
  stripe: 'Stripe',
  paddle: 'Paddle',
  lemonsqueezy: 'Lemon Squeezy',
  paypal: 'PayPal',
  express: 'Express',
  fastify: 'Fastify',
  nest: 'NestJS',
  nestjs: 'NestJS',
  hono: 'Hono',
  trpc: 'tRPC',
  graphql: 'GraphQL',
  websocket: 'WebSocket',
  'socket.io': 'Socket.IO',
  docker: 'Docker',
  kubernetes: 'Kubernetes',
  k8s: 'Kubernetes',
  vercel: 'Vercel',
  aws: 'AWS',
  gcp: 'Google Cloud',
  ollama: 'Ollama',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  claude: 'Claude',
  codex: 'Codex',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  rust: 'Rust',
  golang: 'Go',
  zod: 'Zod',
  zustand: 'Zustand',
  redux: 'Redux',
  jest: 'Jest',
  vitest: 'Vitest',
  playwright: 'Playwright',
  cypress: 'Cypress',
  monolith: 'monolithic architecture',
  microservice: 'microservices',
  microservices: 'microservices',
  'serverless': 'serverless architecture',
  'app router': 'App Router',
  typesense: 'Typesense',
  meilisearch: 'Meilisearch',
  algolia: 'Algolia',
  elasticsearch: 'Elasticsearch',
  opensearch: 'OpenSearch',
  kafka: 'Kafka',
  rabbitmq: 'RabbitMQ',
  celery: 'Celery',
  tauri: 'Tauri',
  electron: 'Electron',
  turborepo: 'Turborepo',
  pnpm: 'pnpm',
  bun: 'Bun',
  monorepo: 'monorepo',
}

const CRITICAL = /\b(critical|urgent|production|security|data loss|money|payment)\b/i

interface Pattern {
  type: MemoryType
  regex: RegExp
  keyFrom?: (m: RegExpMatchArray) => string | null
  importance: number
}

const PATTERNS: Pattern[] = [
  {
    // "we decided to use PostgreSQL" / "let's go with Stripe" / "settled on Clerk"
    type: 'decision',
    importance: 4,
    regex:
      /\b(?:we|i|we'?ve|i'?ve|let'?s|team)?\s*(?:have\s+)?(?:decided|chose|chosen|picked|selected|agreed|settled)\b[^.!?]*?\b(?:to\s+(?:use|adopt|go\s+with|build\s+with|standardi[sz]e\s+on)|on|with|for)\s+([a-z0-9 .+#/-]{2,40})/i,
    keyFrom: (m) => techKey(m[1]),
  },
  {
    type: 'decision',
    importance: 4,
    regex: /\b(?:going\s+with|sticking\s+with|we'?ll\s+use|let'?s\s+use|use)\s+([a-z0-9 .+#/-]{2,40})\s+(?:instead\s+of|over|rather\s+than)\b/i,
    keyFrom: (m) => techKey(m[1]),
  },
  {
    type: 'architecture',
    importance: 4,
    regex: /\b(architecture|structured|organized|layered)\b[^.!?]*?\b(is|as|into|around|with)\b/i,
  },
  {
    type: 'todo',
    importance: 3,
    regex:
      /\b(?:still\s+need(?:\s+to)?|need(?:s)?\s+to|have\s+to|must\s+(?:add|build|implement|create|integrate|write|fix)|todo|to-do|remaining|left\s+to\s+(?:do|build|implement)|plan(?:ning)?\s+to\s+(?:add|build|implement|create|integrate)|should\s+(?:add|build|implement|create|integrate)|next\s+step\s+is)\b/i,
  },
  {
    type: 'bug',
    importance: 4,
    regex:
      /\b(?:bug|broken|breaks|crash(?:es|ing|ed)?|fail(?:s|ing|ed|ure)?|error\s+when|errors?\s+when|doesn'?t\s+work|does\s+not\s+work|not\s+working|exception|regression|race\s+condition|deadlock|500s|failing)\b/i,
  },
  {
    type: 'requirement',
    importance: 4,
    regex: /\b(?:users?\s+(?:must|should|need)|must\s+(?:be|support|allow|have|verify)|shall\s+(?:be|support|allow)|required\s+to|requirements?:)\b/i,
  },
  {
    type: 'preference',
    importance: 3,
    regex:
      /\b(?:always|never|prefer(?:ably)?|make\s+sure\s+(?:to|we|you)|use\s+only|stick\s+(?:to|with)|by\s+default|keep\s+using|don'?t\s+use)\b/i,
  },
]

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"'`(])|\n+/

export function extractMemories(text: string): ExtractedMemory[] {
  const memories: ExtractedMemory[] = []
  const seen = new Set<string>()

  const chunks = text
    .split(SENTENCE_SPLIT)
    .map((s) => s.replace(/^\s*[-*•]\s*/, '').trim())
    .filter((s) => s.length >= 8 && s.length <= 600)

  for (const chunk of chunks) {
    const memory = extractFromChunk(chunk)
    if (!memory) continue
    const dedupeKey = `${memory.type}::${memory.key.toLowerCase()}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    memories.push(memory)
  }

  return memories
}

function extractFromChunk(chunk: string): ExtractedMemory | null {
  // Priority order matters: a sentence like "we decided to fix the bug" is a
  // decision about a bug fix, not a bug report.
  for (const pattern of PATTERNS) {
    const match = chunk.match(pattern.regex)
    if (!match) continue

    const key = pattern.keyFrom ? pattern.keyFrom(match) : null
    const importance = CRITICAL.test(chunk) ? Math.min(5, pattern.importance + 1) : pattern.importance

    return {
      type: pattern.type,
      key: key ?? deriveKey(chunk, pattern.type),
      value: chunk.replace(/\s+/g, ' ').trim().slice(0, 400),
      importance,
    }
  }
  return null
}

/** Produce a crisp key from a captured tech name, else fall back to a
 *  type-specific bucket derived from the sentence. */
function techKey(captured: string | undefined): string | null {
  if (!captured) return null
  // Cut trailing prepositional clauses: "typesense for search" → "Typesense"
  const cleaned = captured
    .trim()
    .toLowerCase()
    .replace(/\s+(?:for|as|in|on|to|with|instead\s+of|over|rather\s+than)\b.*$/, '')
    .replace(/[.,;:]$/, '')
    .trim()
  if (TECH_ENTITIES[cleaned]) return TECH_ENTITIES[cleaned]
  // Partial contains ("the stripe sdk" → "Stripe")
  for (const [needle, label] of Object.entries(TECH_ENTITIES)) {
    if (needle.length >= 4 && cleaned.includes(needle)) return label
  }
  // Non-known but plausible identifier — Title-case it as the key.
  if (/^[a-z0-9 .+#/-]{2,30}$/i.test(cleaned)) {
    return cleaned.replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return null
}

const KEY_HINTS: Array<[MemoryType, RegExp, string]> = [
  ['decision', /\b(database|db|orm|framework|styling|css|auth|authentication|payments?|billing|state|hosting|deploy\w*|runtime|package manager|language)\b/i, ''],
  ['architecture', /\b(frontend|backend|api|data|auth|payments?|realtime|infra)\b/i, 'structure'],
]

// Type-specific subject extraction: "the deals list crashes when…" → "deals list"
const BUG_SUBJECT =
  /([a-z][\w-]*(?:\s+[\w-]+){0,3}?)\s+(?:crash(?:es|ing|ed)?|fail(?:s|ing|ed)?|breaks?|is\s+broken|doesn'?t\s+work|does\s+not\s+work|throws?|error)/i
// Filler tokens stripped from captured bug subjects ("bug where the deals" → "deals").
const SUBJECT_FILLER =
  /^(?:there|here|is|are|was|were|be|being|a|an|the|this|that|bug|issue|where|when|which|if|sometimes|currently|still|again)\s+/gi

function stripSubjectFiller(subject: string): string {
  let out = subject.trim()
  let previous = out
  do {
    previous = out
    out = out.replace(SUBJECT_FILLER, '')
  } while (out !== previous)
  return out.trim()
}
// "we still need to add the search API rate limiting" → "search API rate limiting"
const TODO_SUBJECT =
  /(?:add|build|implement|create|integrate|write|fix|support|handle)\s+(?:the\s+|a\s+|an\s+)?([a-z][\w-]*(?:\s+[\w-]+){0,4})/i
// "users must see search results…" → "search results"
const REQUIREMENT_SUBJECT =
  /(?:must|should|shall|need\s+to|needs\s+to|required\s+to)\s+(?:be\s+|see\s+|have\s+|support\s+|allow\s+|verify\s+)?([a-z][\w-]*(?:\s+[\w-]+){0,3})/i

function deriveKey(chunk: string, type: MemoryType): string {
  if (type === 'bug') {
    const subject = stripSubjectFiller(chunk.match(BUG_SUBJECT)?.[1] ?? '')
    if (subject.length >= 3) return subject.toLowerCase()
  }
  if (type === 'todo') {
    const subject = chunk.match(TODO_SUBJECT)?.[1]?.trim().toLowerCase()
    if (subject && subject.length >= 3) return subject.replace(/\s+(?:before|after|for|when|if)\b.*$/, '')
  }
  if (type === 'requirement') {
    const subject = chunk.match(REQUIREMENT_SUBJECT)?.[1]?.trim().toLowerCase()
    if (subject && subject.length >= 3) return subject
  }

  for (const [hintType, pattern] of KEY_HINTS) {
    if (hintType !== type) continue
    const m = chunk.match(pattern)
    if (m) return `${m[1].toLowerCase()} ${type === 'architecture' ? 'structure' : 'choice'}`.trim()
  }
  // Fallback: first meaningful words of the chunk.
  const words = chunk
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()))
    .slice(0, 3)
    .join(' ')
    .toLowerCase()
  return words || type
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'will', 'should', 'must',
  'need', 'still', 'then', 'also', 'from', 'into', 'our', 'are', 'was', 'were',
  'you', 'your', 'when', 'what', 'where', 'does', 'doesn', 'isn', 'not', 'but',
])

/** Extract every tech entity mentioned anywhere in text (used for graph
 *  linking when memories are captured). */
export function mentionedTech(text: string): string[] {
  const found = new Set<string>()
  const haystack = text.toLowerCase()
  for (const [needle, label] of Object.entries(TECH_ENTITIES)) {
    if (needle.length >= 3 && new RegExp(`\\b${escapeRegex(needle)}\\b`).test(haystack)) {
      found.add(label)
    }
  }
  return [...found]
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
