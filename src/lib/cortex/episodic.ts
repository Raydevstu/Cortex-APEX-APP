/**
 * Episodic Chat Delta store (blueprint §3, memory Tier 3).
 *
 * Every captured interaction/turn is compacted into a ~60-token extractive
 * summary (blueprint SessionTurnNode.compactOutcomeSummary) and embedded
 * into the local vector store. Switching platforms injects only the compact
 * state header; deeper episodic history stays queryable on demand via
 * semantic search — that is the "Delta, not dump" promise.
 *
 * Vector backend: SQLite column (JSON float[]) + in-memory cosine scan.
 * Correct and dependency-free at Phase 2 scale (thousands of turns); the
 * storage interface is a drop-in for LanceDB/KuzuDB vector indices later.
 */
import { db } from '@/lib/db'
import { cosineSimilarity, embedText } from './embeddings'
import { getSettings } from './settings'
import { estimateTokens } from './tokens'
import type { EpisodeSearchResult, RelevantMemory } from './types'

export interface EpisodeIndex {
  summary: string
  embedding: number[]
  provider: string
  tokensSaved: number // raw tokens − summary tokens
}

/**
 * Extractive turn summary: score sentences by keyword frequency (content
 * words, tech terms, decision markers), keep the best 1–3 sentences within
 * a ~60-token budget. Deterministic — same transcript, same summary.
 */
export function summarizeTurn(text: string, maxTokens = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length === 0) return ''
  const sentences = clean.match(/[^.!?\n]+[.!?]?/g)?.map((s) => s.trim()).filter((s) => s.length > 12) ?? [clean]

  const freq = new Map<string, number>()
  for (const word of clean.toLowerCase().split(/[^a-z0-9+#._-]+/)) {
    if (word.length < 4 || SUMMARY_STOPWORDS.has(word)) continue
    freq.set(word, (freq.get(word) ?? 0) + 1)
  }

  const scored = sentences.map((sentence, i) => {
    const words = sentence.toLowerCase().split(/[^a-z0-9+#._-]+/).filter((w) => w.length >= 4)
    let score = 0
    for (const w of words) score += freq.get(w) ?? 0
    if (/^(we|i)\s+(decided|chose|selected|must|need|still)/i.test(sentence)) score *= 1.5 // decision markers
    if (/\b(bug|fix|issue|error|broken)\b/i.test(sentence)) score *= 1.3 // risk markers
    return { sentence, score: score / Math.sqrt(words.length || 1), i }
  })

  const ranked = [...scored].sort((a, b) => b.score - a.score)
  const picked: typeof ranked = []
  let budget = 0
  for (const candidate of ranked) {
    const cost = estimateTokens(candidate.sentence)
    if (budget + cost > maxTokens) continue
    picked.push(candidate)
    budget += cost
    if (picked.length >= 3) break
  }
  if (picked.length === 0) {
    // No sentence fit the budget — hard-truncate the highest scorer.
    const fallback = ranked[0]?.sentence ?? clean
    return truncateTokens(fallback, maxTokens)
  }
  return picked
    .sort((a, b) => a.i - b.i) // restore original order
    .map((p) => p.sentence)
    .join(' ')
}

/** Index an interaction into the episodic vector store. */
export async function indexEpisode(interactionId: string, rawText: string): Promise<EpisodeIndex | null> {
  const settings = await getSettings()
  const summary = summarizeTurn(rawText)
  const { vector, provider } = await embedText(
    `${summary}\n${rawText.slice(0, 2_000)}`, // summary dominates the embedding
    settings.ollamaBaseUrl,
    settings.ollamaEmbeddingModel,
  )
  const tokensSaved = Math.max(0, estimateTokens(rawText) - estimateTokens(summary))

  await db.interaction.update({
    where: { id: interactionId },
    data: {
      summary,
      embedding: JSON.stringify(vector),
      embeddingProvider: provider,
    },
  })
  return { summary, embedding: vector, provider, tokensSaved }
}

export interface EpisodicSearch {
  query: string
  provider: string
  results: EpisodeSearchResult[]
  memories: Array<RelevantMemory & { createdAt: string }>
}

/**
 * Semantic episodic search: embed the query with the same provider chain,
 * cosine-scan every indexed episode of the project, and blend in keyword
 * matches so un-indexed legacy rows stay discoverable.
 */
export async function searchEpisodes(
  projectId: string,
  query: string,
  k = 5,
): Promise<EpisodicSearch> {
  const settings = await getSettings()
  const { vector, provider } = await embedText(query, settings.ollamaBaseUrl, settings.ollamaEmbeddingModel)

  const interactions = await db.interaction.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const queryTokens = new Set(query.toLowerCase().split(/[^a-z0-9+#._-]+/).filter((t) => t.length >= 3))
  const scored: EpisodeSearchResult[] = []

  for (const interaction of interactions) {
    let score = 0
    if (interaction.embedding) {
      try {
        const stored = JSON.parse(interaction.embedding) as number[]
        if (Array.isArray(stored) && stored.length > 0) {
          score = cosineSimilarity(vector, stored)
        }
      } catch {
        score = 0
      }
    }
    // Keyword blend keeps un-embedded rows discoverable and rewards lexicon hits.
    const text = `${interaction.title ?? ''} ${interaction.rawText}`.toLowerCase()
    let hits = 0
    for (const token of queryTokens) if (text.includes(token)) hits += 1
    const keywordScore = queryTokens.size > 0 ? (hits / queryTokens.size) * 0.4 : 0
    const blended = Math.max(score, keywordScore)
    if (blended <= 0.02) continue

    scored.push({
      interactionId: interaction.id,
      title: interaction.title,
      platform: interaction.platform,
      summary: interaction.summary,
      createdAt: interaction.createdAt.toISOString(),
      score: Math.round(blended * 1_000) / 1_000,
      snippet: interaction.rawText.replace(/\s+/g, ' ').slice(0, 160),
    })
  }

  scored.sort((a, b) => b.score - a.score)

  // Secondary channel: keyword-matched memories (the semantic layer's
  // structured sibling — decisions/bugs/todos are point lookups, not prose).
  const memories = await db.memory.findMany({ where: { projectId }, orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }] })
  const memoryHits = memories
    .filter((m) => {
      const haystack = `${m.key} ${m.value}`.toLowerCase()
      let hits = 0
      for (const token of queryTokens) if (haystack.includes(token)) hits += 1
      return hits >= Math.min(2, queryTokens.size) || (queryTokens.size === 1 && hits >= 1)
    })
    .slice(0, 5)
    .map<RelevantMemory & { createdAt: string }>((m) => ({
      id: m.id,
      type: m.type as RelevantMemory['type'],
      key: m.key,
      value: m.value,
      status: m.status,
      importance: m.importance,
      matched: 'keyword',
      createdAt: m.createdAt.toISOString(),
    }))

  return { query, provider, results: scored.slice(0, k), memories: memoryHits }
}

function truncateTokens(text: string, maxTokens: number): string {
  const words = text.split(' ')
  const out: string[] = []
  let budget = 0
  for (const word of words) {
    budget += Math.max(1, Math.round(word.length / 4))
    if (budget > maxTokens) break
    out.push(word)
  }
  return (out.length > 0 ? out.join(' ') : words.slice(0, 12).join(' ')) + (out.length < words.length ? '…' : '')
}

const SUMMARY_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'will', 'should', 'must',
  'need', 'still', 'then', 'also', 'from', 'into', 'your', 'when', 'what',
  'where', 'does', 'them', 'they', 'their', 'there', 'here', 'been', 'being',
  'would', 'could', 'about', 'just', 'like', 'over', 'some', 'very', 'much',
  'more', 'most', 'less', 'least', 'than', 'then', 'upon', 'after', 'before',
])
