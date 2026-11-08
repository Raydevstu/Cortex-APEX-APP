import { db } from '@/lib/db'
import { handleRouteError, ok, parseBody, ApiError } from '@/lib/cortex/api'
import { startWatcher, stopWatcher, watcherStatus } from '@/lib/cortex/watcher'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const watchSchema = z.object({
  projectId: z.string().trim().min(1),
  action: z.enum(['start', 'stop']),
  persist: z.boolean().optional(), // also flip Project.watchEnabled for daemon-boot autostart
})

/**
 * GET /api/cortex/watch — live watcher status for every project.
 * Optional: ?projectId= to scope to one project.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId') ?? undefined
    const status = await watcherStatus(projectId)
    return ok({ watchers: status })
  } catch (error) {
    return handleRouteError(error)
  }
}

/**
 * POST /api/cortex/watch — start/stop the file watcher for a project.
 * With {persist: true} the choice survives daemon restarts via
 * Project.watchEnabled (instrumentation.ts bootstraps on start).
 */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, watchSchema)
    const project = await db.project.findUnique({ where: { id: input.projectId } })
    if (!project) throw new ApiError('Project not found', 404)

    if (input.action === 'stop') {
      const result = await stopWatcher(input.projectId)
      if (input.persist) {
        await db.project.update({ where: { id: input.projectId }, data: { watchEnabled: false } })
      }
      return ok(result)
    }

    if (!project.rootPath) {
      throw new ApiError('Project has no rootPath — set the workspace path before watching', 422)
    }
    const result = await startWatcher(input.projectId)
    if (!result.started) {
      throw new ApiError(result.reason ?? 'Watcher failed to start', 422)
    }
    if (input.persist) {
      await db.project.update({ where: { id: input.projectId }, data: { watchEnabled: true } })
    }

    await db.timelineEvent.create({
      data: {
        projectId: input.projectId,
        kind: 'watcher.started',
        message: `File watcher started for ${project.rootPath}${input.persist ? ' (persists across daemon restarts)' : ''}.`,
      },
    })

    const [status] = await watcherStatus(input.projectId)
    return ok({ started: true, status }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
