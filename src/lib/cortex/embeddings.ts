/**
 * Embedding provider chain for the episodic vector store (blueprint §3,
 * memory Tier 3 — "LanceDB + Ollama" mapped to SQLite-backed vectors).
 *
 * Provider chain (never a hard failure):
 *   1. Ollama /api/embeddings with the configured model (nomic-embed-text
 *      by default) — real neural embeddings when the local runtime is up.
 *   2. Deterministic local hashed embedding — a real feature-hashing
 *      implementation ( hashing-trick embedding): unigrams + bigrams are
 *      hashed into a fixed-width vector and L2-normalised. Works fully
 *      offline, zero dependencies, stable across restarts — so cosine
 *      similarity search remains functional when Ollama is unreachable.
 *
 * Both providers emit L2-normalised vectors, so cosine similarity reduces
 * to a dot product at query time.
 */

const LOCAL_DIMS = 384
const REACHABILITY_TTL_MS = 60_000

type Reachability = { reachable: boolean; checkedAt: number }

// Module-level cache — survives across requests inside the daemon process.
const reachability: Reachability = { reachable: false, checkedAt: 0 }

export interface EmbeddingResult {
  vector: number[]
  provider: string // "ollama:<model>" | "local-hash"
}

export function resetEmbeddingCache(): void {
  reachability.reachable = false
  reachability.checkedAt = 0
}

async function ollamaReachable(baseUrl: string): Promise<boolean> {
  const now = Date.now()
  if (now - reachability.checkedAt < REACHABILITY_TTL_MS) return reachability.reachable
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1_500)
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal })
    clearTimeout(timer)
    reachability.reachable = response.ok
  } catch {
    reachability.reachable = false
  }
  reachability.checkedAt = now
  return reachability.reachable
}

/**
 * Embed text through the provider chain. `ollamaBaseUrl`/`model` come from
 * daemon settings; when Ollama is offline the deterministic local embedder
 * runs instead (documented in the result's `provider` field).
 */
export async function embedText(
  text: string,
  ollamaBaseUrl: string,
  ollamaModel: string,
): Promise<EmbeddingResult> {
  const clean = text.trim()
  if (clean.length === 0) {
    return { vector: new Array(LOCAL_DIMS).fill(0), provider: 'local-hash' }
  }

  if (await ollamaReachable(ollamaBaseUrl)) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8_000)
      const response = await fetch(`${ollamaBaseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: ollamaModel, prompt: clean.slice(0, 8_000) }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (response.ok) {
        const body = (await response.json()) as { embedding?: unknown }
        if (Array.isArray(body.embedding) && body.embedding.length >= 32) {
          const vector = normalize(body.embedding.map((v) => (typeof v === 'number' ? v : 0)))
          return { vector, provider: `ollama:${ollamaModel}` }
        }
      }
      // Malformed response → fall through to the local provider.
      reachability.reachable = false
      reachability.checkedAt = Date.now()
    } catch {
      reachability.reachable = false
      reachability.checkedAt = Date.now()
    }
  }

  return { vector: localHashEmbedding(clean), provider: 'local-hash' }
}

/**
 * Deterministic feature-hashing embedding.
 * Tokens (unigrams + bigrams, lightly stemmed) are hashed with FNV-1a into
 * `LOCAL_DIMS` buckets with alternating sign to reduce collision bias, then
 * the vector is L2-normalised. Same text always maps to the same vector.
 */
export function localHashEmbedding(text: string): number[] {
  const vector = new Array<number>(LOCAL_DIMS).fill(0)
  const tokens = tokenizeForEmbedding(text)

  for (let i = 0; i < tokens.length; i++) {
    const weight = 1 / Math.sqrt(1 + i) // earlier tokens weigh slightly more
    addFeature(vector, tokens[i], weight)
    if (i + 1 < tokens.length) {
      addFeature(vector, `${tokens[i]}_${tokens[i + 1]}`, weight * 0.6)
    }
  }
  return normalize(vector)
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const idx = fnv1a(feature) % LOCAL_DIMS
  const sign = fnv1a(`${feature}#sign`) % 2 === 0 ? 1 : -1
  vector[idx] += sign * weight
}

function tokenizeForEmbedding(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9+#._-]+/)
    .map((t) => (t.length > 5 ? t.slice(0, 5) : t)) // crude stemming
    .filter((t) => t.length >= 2 && !EMBED_STOPWORDS.has(t))
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function normalize(vector: number[]): number[] {
  let sum = 0
  for (const v of vector) sum += v * v
  const norm = Math.sqrt(sum)
  if (norm === 0) return vector
  return vector.map((v) => v / norm)
}

/** Cosine similarity for L2-normalised vectors (dot product). */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < len; i++) dot += a[i] * b[i]
  return dot
}

const EMBED_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'will', 'should', 'must',
  'need', 'still', 'then', 'also', 'from', 'into', 'our', 'are', 'was', 'were',
  'you', 'your', 'when', 'what', 'where', 'does', 'not', 'but', 'add', 'make',
  'they', 'them', 'their', 'there', 'here', 'been', 'being', 'has', 'had',
  'its', 'it\'s', 'about', 'would', 'could', 'some', 'just', 'like', 'over',
])
