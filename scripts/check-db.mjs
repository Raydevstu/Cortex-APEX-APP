import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const projects = await db.project.findMany({ include: { _count: { select: { memories: true, graphNodes: true, graphEdges: true, interactions: true, promptSessions: true, preExecRuns: true, handoffs: true, commits: true, stagedArtifacts: true } } } })
for (const p of projects) {
  console.log(JSON.stringify({ id: p.id, slug: p.slug, name: p.name, rootPath: p.rootPath, platform: p.platform, watch: p.watchEnabled, counts: p._count }))
}
console.log('timelineEvents:', await db.timelineEvent.count())
console.log('settings keys:', (await db.setting.findMany()).map(s => s.key).join(','))
await db.$disconnect()
