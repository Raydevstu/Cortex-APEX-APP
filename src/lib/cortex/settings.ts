/**
 * Daemon settings service — persisted key/value store for the local
 * Cortex daemon configuration (Ollama endpoints, engine defaults and the
 * Phase 3 local-agent model roles from the blueprint's
 * `agentRoutingPolicy.localOllamaModels`).
 */
import { db } from '@/lib/db'
import type { DaemonSettings } from './types'

const SETTING_KEY = 'daemon'

export const DEFAULT_SETTINGS: DaemonSettings = {
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5-coder:7b',
  ollamaEmbeddingModel: 'nomic-embed-text',
  defaultEngine: 'fast',
  // Phase 3 — blueprint agentRoutingPolicy.localOllamaModels roles:
  ollamaRouterModel: 'qwen2.5:1.5b', // Engine 1 fastRouter
  ollamaExtractorModel: 'llama3.2:3b', // Engine 3 memoryExtractor
  cloudEscalationModel: 'claude-sonnet-class', // Phase 4 DAG orchestrator cloud tier label
  searxngUrl: '', // optional SearXNG endpoint for local_docs_search web layer
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export async function getSettings(): Promise<DaemonSettings> {
  const record = await db.setting.findUnique({ where: { key: SETTING_KEY } })
  if (!record) return DEFAULT_SETTINGS
  try {
    const parsed = JSON.parse(record.value) as Partial<DaemonSettings>
    return {
      ollamaBaseUrl: isNonEmptyString(parsed.ollamaBaseUrl) ? parsed.ollamaBaseUrl : DEFAULT_SETTINGS.ollamaBaseUrl,
      ollamaModel: isNonEmptyString(parsed.ollamaModel) ? parsed.ollamaModel : DEFAULT_SETTINGS.ollamaModel,
      ollamaEmbeddingModel: isNonEmptyString(parsed.ollamaEmbeddingModel)
        ? parsed.ollamaEmbeddingModel
        : DEFAULT_SETTINGS.ollamaEmbeddingModel,
      defaultEngine:
        parsed.defaultEngine === 'deep' || parsed.defaultEngine === 'cloud' ? parsed.defaultEngine : 'fast',
      ollamaRouterModel: isNonEmptyString(parsed.ollamaRouterModel)
        ? parsed.ollamaRouterModel
        : DEFAULT_SETTINGS.ollamaRouterModel,
      ollamaExtractorModel: isNonEmptyString(parsed.ollamaExtractorModel)
        ? parsed.ollamaExtractorModel
        : DEFAULT_SETTINGS.ollamaExtractorModel,
      cloudEscalationModel: isNonEmptyString(parsed.cloudEscalationModel)
        ? parsed.cloudEscalationModel
        : DEFAULT_SETTINGS.cloudEscalationModel,
      searxngUrl: typeof parsed.searxngUrl === 'string' ? parsed.searxngUrl.trim().replace(/\/$/, '') : '',
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(patch: Partial<DaemonSettings>): Promise<DaemonSettings> {
  const current = await getSettings()
  const next: DaemonSettings = {
    ollamaBaseUrl: isNonEmptyString(patch.ollamaBaseUrl)
      ? patch.ollamaBaseUrl.trim().replace(/\/$/, '')
      : current.ollamaBaseUrl,
    ollamaModel: isNonEmptyString(patch.ollamaModel) ? patch.ollamaModel.trim() : current.ollamaModel,
    ollamaEmbeddingModel: isNonEmptyString(patch.ollamaEmbeddingModel)
      ? patch.ollamaEmbeddingModel.trim()
      : current.ollamaEmbeddingModel,
    defaultEngine:
      patch.defaultEngine === 'fast' || patch.defaultEngine === 'deep' || patch.defaultEngine === 'cloud'
        ? patch.defaultEngine
        : current.defaultEngine,
    ollamaRouterModel: isNonEmptyString(patch.ollamaRouterModel)
      ? patch.ollamaRouterModel.trim()
      : current.ollamaRouterModel,
    ollamaExtractorModel: isNonEmptyString(patch.ollamaExtractorModel)
      ? patch.ollamaExtractorModel.trim()
      : current.ollamaExtractorModel,
    cloudEscalationModel: isNonEmptyString(patch.cloudEscalationModel)
      ? patch.cloudEscalationModel.trim()
      : current.cloudEscalationModel,
    searxngUrl:
      typeof patch.searxngUrl === 'string'
        ? patch.searxngUrl.trim().replace(/\/$/, '')
        : current.searxngUrl,
  }

  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
  })
  return next
}
