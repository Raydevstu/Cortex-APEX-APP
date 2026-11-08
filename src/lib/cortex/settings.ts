/**
 * Daemon settings service — persisted key/value store for the local
 * Cortex daemon configuration (Ollama endpoint, default engine).
 */
import { db } from '@/lib/db'
import type { DaemonSettings } from './types'

const SETTING_KEY = 'daemon'

export const DEFAULT_SETTINGS: DaemonSettings = {
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5-coder:7b',
  defaultEngine: 'fast',
}

export async function getSettings(): Promise<DaemonSettings> {
  const record = await db.setting.findUnique({ where: { key: SETTING_KEY } })
  if (!record) return DEFAULT_SETTINGS
  try {
    const parsed = JSON.parse(record.value) as Partial<DaemonSettings>
    return {
      ollamaBaseUrl: typeof parsed.ollamaBaseUrl === 'string' && parsed.ollamaBaseUrl ? parsed.ollamaBaseUrl : DEFAULT_SETTINGS.ollamaBaseUrl,
      ollamaModel: typeof parsed.ollamaModel === 'string' && parsed.ollamaModel ? parsed.ollamaModel : DEFAULT_SETTINGS.ollamaModel,
      defaultEngine: parsed.defaultEngine === 'deep' || parsed.defaultEngine === 'cloud' ? parsed.defaultEngine : 'fast',
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(patch: Partial<DaemonSettings>): Promise<DaemonSettings> {
  const current = await getSettings()
  const next: DaemonSettings = {
    ollamaBaseUrl:
      typeof patch.ollamaBaseUrl === 'string' && patch.ollamaBaseUrl.trim().length > 0
        ? patch.ollamaBaseUrl.trim().replace(/\/$/, '')
        : current.ollamaBaseUrl,
    ollamaModel:
      typeof patch.ollamaModel === 'string' && patch.ollamaModel.trim().length > 0
        ? patch.ollamaModel.trim()
        : current.ollamaModel,
    defaultEngine:
      patch.defaultEngine === 'fast' || patch.defaultEngine === 'deep' || patch.defaultEngine === 'cloud'
        ? patch.defaultEngine
        : current.defaultEngine,
  }

  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
  })
  return next
}
