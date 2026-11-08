/**
 * Blueprint asset loader — the Phase 3 master system prompts, strict JSON
 * grammars and local documentation cache (blueprint Part 2: "Every prompt and
 * pipeline file below uses Ollama Structured Outputs (`format: jsonSchema`)").
 *
 * The blueprint stores these under `<projectRoot>/.cortex/prompts` and
 * `<projectRoot>/.cortex/schemas`. This daemon is multi-project, so the assets
 * live in the daemon's own source tree (`cortex-assets/`) and are loaded from
 * disk at runtime — the exact same file-driven contract, one auditable home.
 * They are also served through `GET /api/cortex/assets` so the behaviour of
 * every engine is fully inspectable (no hidden instructions).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const ASSETS_ROOT = path.join(process.cwd(), 'cortex-assets')

const PROMPTS = [
  'pre-execution-router.system.md',
  'tier1-prompt-engineer.system.md',
  'memory-extractor.system.md',
] as const

const SCHEMAS = [
  'router-decision.schema.json',
  'tier1-rewritten-prompt.schema.json',
  'extracted-memory-delta.schema.json',
] as const

export type PromptName = (typeof PROMPTS)[number]
export type SchemaName = (typeof SCHEMAS)[number]

const promptCache = new Map<string, string>()
const schemaCache = new Map<string, Record<string, unknown>>()
const docsCache: { loaded: boolean; docs: Array<{ file: string; content: string }> } = {
  loaded: false,
  docs: [],
}

/** Load a master system prompt from cortex-assets/prompts (cached). */
export async function loadPrompt(name: PromptName): Promise<string> {
  const cached = promptCache.get(name)
  if (cached) return cached
  const content = await fs.readFile(path.join(ASSETS_ROOT, 'prompts', name), 'utf-8')
  promptCache.set(name, content)
  return content
}

/** Load a strict JSON grammar from cortex-assets/schemas (cached). */
export async function loadJsonSchema(name: SchemaName): Promise<Record<string, unknown>> {
  const cached = schemaCache.get(name)
  if (cached) return cached
  const raw = await fs.readFile(path.join(ASSETS_ROOT, 'schemas', name), 'utf-8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  schemaCache.set(name, parsed)
  return parsed
}

/** Load the local documentation cache (cortex-assets/docs-cache/*.md).
 * Used by the `local_docs_search` tool for zero-network SDK syntax lookups. */
export async function loadDocsCache(): Promise<Array<{ file: string; content: string }>> {
  if (docsCache.loaded) return docsCache.docs
  const dir = path.join(ASSETS_ROOT, 'docs-cache')
  const files = await fs.readdir(dir).catch(() => [] as string[])
  const docs: Array<{ file: string; content: string }> = []
  for (const file of files.filter((f) => f.endsWith('.md')).sort()) {
    const content = await fs.readFile(path.join(dir, file), 'utf-8').catch(() => '')
    if (content) docs.push({ file, content })
  }
  docsCache.docs = docs
  docsCache.loaded = true
  return docs
}

/** Invalidate caches (used by tests to pick up edited assets). */
export function resetAssetCaches(): void {
  promptCache.clear()
  schemaCache.clear()
  docsCache.loaded = false
  docsCache.docs = []
}

/** Inventory of every asset (served by GET /api/cortex/assets). */
export async function assetsInventory() {
  const [prompts, schemas, docs] = await Promise.all([
    Promise.all(
      PROMPTS.map(async (name) => ({
        name,
        bytes: (await loadPrompt(name)).length,
      })),
    ),
    Promise.all(
      SCHEMAS.map(async (name) => {
        const schema = await loadJsonSchema(name)
        return { name, bytes: JSON.stringify(schema).length, required: schema.required ?? [] }
      }),
    ),
    (await loadDocsCache()).map((d) => ({ name: d.file, bytes: d.content.length })),
  ])
  return { root: 'cortex-assets', prompts, schemas, docs }
}
