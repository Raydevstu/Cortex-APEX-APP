import { promises as fs } from 'node:fs'
import path from 'node:path'
import { handleRouteError, ApiError } from '@/lib/cortex/api'

export const dynamic = 'force-dynamic'

/** Allowlist of extension sources the E2E harness page may load. */
const ALLOWED = new Map<string, { file: string; type: string }>([
  ['core.js', { file: 'lib/core.js', type: 'application/javascript; charset=utf-8' }],
  ['content.js', { file: 'content.js', type: 'application/javascript; charset=utf-8' }],
])

/**
 * GET /api/cortex/extension/file/[name] — serves the REAL extension sources
 * (extension/ directory) to the browser E2E harness page, so the harness
 * always exercises the exact shipped code (zero drift).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await ctx.params
    const entry = ALLOWED.get(name)
    if (!entry) throw new ApiError('Unknown extension file', 404)

    const filePath = path.join(process.cwd(), 'extension', entry.file)
    const content = await fs.readFile(filePath, 'utf8')
    return new Response(content, {
      headers: { 'Content-Type': entry.type, 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return handleRouteError(error)
  }
}
