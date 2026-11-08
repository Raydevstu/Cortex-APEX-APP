/**
 * Token estimation used by the Token Savings Engine (blueprint Pillar 8).
 *
 * Deterministic, dependency-free heuristic calibrated against common
 * BPE tokenizers (GPT-family / Qwen / Llama): roughly 4 characters per
 * token for Latin text, with per-word blending for denser prose and a
 * 1:1 ratio for CJK codepoints which tokenize near one-token-per-char.
 */
const CJK_RANGE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g
const WORD_SPLIT = /\s+/;
const PUNCT = /[.,;:!?()[\]{}"'`~@#$%^&*+=|\\/<>-]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjkChars = (text.match(CJK_RANGE) || []).length
  const latin = text.replace(CJK_RANGE, ' ')
  const words = latin.split(WORD_SPLIT).filter(Boolean).length
  const punct = (latin.match(PUNCT) || []).length

  // Blend: chars/4 base, word-density adjustment, punctuation partials.
  const byChars = text.length / 4
  const byWords = words * 1.35 + punct * 0.25
  const base = Math.max(byChars, byWords)

  return Math.max(1, Math.ceil(base + cjkChars * 0.85))
}

/** Estimate for a whole JSON-serialisable context object (used for the
 *  naive-vs-compact context accounting). */
export function estimateTokensOfObject(value: unknown): number {
  return estimateTokens(safeStringify(value))
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}
