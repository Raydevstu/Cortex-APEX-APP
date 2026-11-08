import { handleRouteError, ok, parseBody } from '@/lib/cortex/api'
import { getSettings, saveSettings } from '@/lib/cortex/settings'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const putSchema = z.object({
  ollamaBaseUrl: z.string().trim().url('must be a valid URL, e.g. http://127.0.0.1:11434').optional(),
  ollamaModel: z.string().trim().min(1).max(120).optional(),
  defaultEngine: z.enum(['fast', 'deep', 'cloud']).optional(),
  // Phase 3 — local-agent model roles + optional SearXNG docs layer:
  ollamaRouterModel: z.string().trim().min(1).max(120).optional(),
  ollamaExtractorModel: z.string().trim().min(1).max(120).optional(),
  searxngUrl: z
    .union([z.string().trim().url('must be a valid URL, e.g. http://127.0.0.1:8888'), z.literal('')])
    .optional(),
})

/** GET /api/cortex/settings — daemon configuration. */
export async function GET() {
  try {
    const settings = await getSettings()
    return ok({ settings })
  } catch (error) {
    return handleRouteError(error)
  }
}

/** PUT /api/cortex/settings — update daemon configuration. */
export async function PUT(request: Request) {
  try {
    const input = await parseBody(request, putSchema)
    const settings = await saveSettings(input)
    return ok({ settings })
  } catch (error) {
    return handleRouteError(error)
  }
}
