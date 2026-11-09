import { handleRouteError, ok } from '@/lib/cortex/api'
import { getSettings } from '@/lib/cortex/settings'

export const dynamic = 'force-dynamic'

/** POST /api/cortex/settings/test — probe an Ollama endpoint (Phase 1 §10). */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { ollamaBaseUrl?: string }
    const { getOllamaStatus, invalidateOllamaCache } = await import('@/lib/cortex/ollama')
    const baseUrl = typeof body.ollamaBaseUrl === 'string' && body.ollamaBaseUrl.trim()
      ? body.ollamaBaseUrl.trim()
      : (await getSettings()).ollamaBaseUrl
    invalidateOllamaCache(baseUrl)
    const status = await getOllamaStatus(baseUrl)
    return ok({ status })
  } catch (error) {
    return handleRouteError(error)
  }
}
