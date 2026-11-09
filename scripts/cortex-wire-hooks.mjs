#!/usr/bin/env node
/**
 * cortex-wire-hooks — auto-wire CortexOS sentinel hook + MCP server into a repo.
 *
 * Generates:
 *   <root>/.claude/settings.json   (PreToolUse hook → hooks/sentinel_pretooluse.py)
 *   <root>/.cursor/mcp.json        (cortexos-brain MCP server)
 *
 * Usage:
 *   node scripts/cortex-wire-hooks.mjs [--root /path/to/repo] [--daemon http://localhost:3000]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = args[i + 1]
  return v && !v.startsWith('--') ? v : fallback
}

const root = path.resolve(flag('root', process.cwd()))
const daemon = flag('daemon', process.env.CORTEX_DAEMON_URL || 'http://localhost:3000')

async function writeJson(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf-8')
  console.log(`✓ wrote ${path.relative(root, filePath)}`)
}

async function main() {
  // .claude/settings.json — PreToolUse sentinel
  await writeJson(path.join(root, '.claude', 'settings.json'), {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write|Edit|MultiEdit|Bash',
          hooks: [
            {
              type: 'command',
              command: 'python3 "$CLAUDE_PROJECT_DIR/hooks/sentinel_pretooluse.py"',
            },
          ],
        },
      ],
    },
  })

  // .cursor/mcp.json — universal MCP server
  await writeJson(path.join(root, '.cursor', 'mcp.json'), {
    mcpServers: {
      'cortexos-brain': {
        command: 'node',
        args: ['./mcp-server/index.mjs'],
        env: {
          CORTEX_DAEMON_URL: daemon,
          CORTEX_PROJECT_ROOT: root,
        },
      },
    },
  })

  console.log(`\nCortexOS wired for: ${root}`)
  console.log(`  sentinel: hooks/sentinel_pretooluse.py`)
  console.log(`  mcp:      mcp-server/index.mjs  (daemon ${daemon})`)
}

main().catch((e) => {
  console.error('wire-hooks failed:', e?.message || e)
  process.exit(1)
})
