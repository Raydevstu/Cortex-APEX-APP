import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { buildSyncPacket } from '@/lib/cortex/packet'
import { db } from '@/lib/db'

const server = new McpServer({ name: 'cortexos', version: '0.7.0' })

server.tool(
  'cortex_pull_delta_sync',
  'MANDATORY FIRST CALL IN EVERY SESSION: Pulls the compact Cross-Platform Delta Sync Packet, Project DNA constraints, and active AST Scope Lock from previous chats.',
  { projectSlug: z.string().min(1), targetPlatform: z.string().optional(), module: z.string().optional() },
  async ({ projectSlug, targetPlatform, module }) => {
    try {
      const packet = await buildSyncPacket(projectSlug, { targetPlatform, module })
      return { content: [{ type: 'text', text: packet.markdown }] }
    } catch (error) {
      return { content: [{ type: 'text', text: `error: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
    }
  },
)

server.tool(
  'cortex_commit_turn_memory',
  'Commit extracted delta to continuity ledger + project-dna + KuzuDB.',
  {
    projectSlug: z.string().min(1),
    kind: z.enum(['decision', 'todo', 'bug', 'architecture', 'fact']),
    key: z.string().min(1),
    value: z.string().min(1),
    importance: z.number().int().min(1).max(10).optional(),
  },
  async ({ projectSlug, kind, key, value, importance }) => {
    try {
      const project = await db.project.findUnique({ where: { slug: projectSlug } })
      if (!project) throw new Error('project not found')
      const memory = await db.memory.create({
        data: {
          projectId: project.id,
          type: kind,
          key,
          value,
          status: 'active',
          importance: importance ?? 5,
          source: 'mcp',
        },
      })
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, memoryId: memory.id }) }] }
    } catch (error) {
      return { content: [{ type: 'text', text: `error: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
    }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  process.stderr.write(`cortexos mcp server failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
