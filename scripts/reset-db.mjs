/**
 * CortexOS — wipe all daemon data (used to reset to a pristine state before
 * delivery / between test runs). Keeps the schema; deletes all rows.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  await db.promptSession.deleteMany()
  await db.interaction.deleteMany()
  await db.timelineEvent.deleteMany()
  await db.graphEdge.deleteMany()
  await db.graphNode.deleteMany()
  await db.memory.deleteMany()
  await db.projectDna.deleteMany()
  await db.project.deleteMany()
  await db.setting.deleteMany()
  const [projects, memories, nodes, edges] = await Promise.all([
    db.project.count(),
    db.memory.count(),
    db.graphNode.count(),
    db.graphEdge.count(),
  ])
  console.log(`Reset complete — projects: ${projects}, memories: ${memories}, nodes: ${nodes}, edges: ${edges}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
