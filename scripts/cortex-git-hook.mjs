#!/usr/bin/env node
/**
 * cortex-git-hook — install/uninstall the CortexOS post-commit hook.
 *
 * Phase 2 (blueprint §6): "Git hook" integration. The installed hook fires
 * on every `git commit`, gathers the commit (hash, message, author, date,
 * changed files) and POSTs it to the daemon's webhook
 * (POST /api/cortex/hooks/git) — so any work committed on any platform
 * (Codex, Hermes, …) lands in the Knowledge Graph, Timeline and episodic
 * memory automatically.
 *
 * Usage:
 *   node scripts/cortex-git-hook.mjs install --repo /path/to/repo --slug my-project \
 *        [--daemon http://localhost:3000] [--platform codex]
 *   node scripts/cortex-git-hook.mjs uninstall --repo /path/to/repo
 *   node scripts/cortex-git-hook.mjs check --repo /path/to/repo
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const command = args[0] ?? 'help'

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : true
}

const repo = typeof flag('repo', '') === 'string' ? flag('repo', '') : ''
const slug = typeof flag('slug', '') === 'string' ? flag('slug', '') : ''
const daemon = typeof flag('daemon', 'http://localhost:3000') === 'string' ? flag('daemon', 'http://localhost:3000') : 'http://localhost:3000'
const platform = typeof flag('platform', '') === 'string' ? flag('platform', '') : ''

const HOOK_NAME = 'post-commit'
const MARKER = '// >>> cortexos >>>'
const MARKER_END = '// <<< cortexos <<<'

async function main() {
  if (command === 'help' || command === '--help') {
    printUsage()
    return
  }
  if (!repo) {
    fail('--repo <path> is required (the git repository to hook)')
  }
  const gitDir = path.join(path.resolve(repo), '.git')
  try {
    await fs.access(gitDir)
  } catch {
    fail(`${repo} is not a git repository (.git not found)`)
  }

  if (command === 'install') {
    if (!slug) fail('--slug <project-slug> is required (the CortexOS project this repo feeds)')
    await install(repo, gitDir)
  } else if (command === 'uninstall') {
    await uninstall(gitDir, repo)
  } else if (command === 'check') {
    await check(gitDir, repo)
  } else {
    printUsage()
    process.exitCode = 1
  }
}

async function install(repoPath, gitDir) {
  // 1. Daemon config inside the repo (.cortex/daemon.json, single-line for
  //    robust shell-side parsing).
  const cortexDir = path.join(repoPath, '.cortex')
  await fs.mkdir(cortexDir, { recursive: true })
  const config = { daemonUrl: daemon.replace(/\/$/, ''), slug, platform: platform || null, installedAt: new Date().toISOString() }
  await fs.writeFile(path.join(cortexDir, 'daemon.json'), JSON.stringify(config), 'utf8')

  // 2. Keep .cortex/ out of version control if a .gitignore exists.
  const gitignorePath = path.join(repoPath, '.gitignore')
  try {
    const gitignore = await fs.readFile(gitignorePath, 'utf8')
    if (!gitignore.split('\n').some((l) => l.trim() === '.cortex/')) {
      await fs.writeFile(gitignorePath, `${gitignore.replace(/\n*$/, '\n')}.cortex/\n`, 'utf8')
    }
  } catch {
    // No .gitignore — leave the repo untouched.
  }

  // 3. The post-commit hook (Node — proper JSON escaping, never blocks).
  //    Shebang MUST be line 1 for the kernel; the cortexos markers bracket
  //    our block for idempotent install/uninstall.
  const hooksDir = path.join(gitDir, 'hooks')
  await fs.mkdir(hooksDir, { recursive: true })
  const hookPath = path.join(hooksDir, HOOK_NAME)
  let existing = ''
  try {
    existing = await fs.readFile(hookPath, 'utf8')
  } catch {
    existing = ''
  }
  if (existing.includes(MARKER)) {
    console.log(`cortexos: post-commit hook already installed — refreshing config only.`)
  } else if (existing.trim().length > 0) {
    // Chain after an existing hook rather than clobbering it.
    await fs.writeFile(hookPath, `${existing.replace(/\n*$/, '\n')}\n${buildHook(false)}\n`, { mode: 0o755 })
    console.log(`cortexos: chained onto the existing ${HOOK_NAME} hook.`)
  } else {
    await fs.writeFile(hookPath, `${buildHook(true)}\n`, { mode: 0o755 })
  }
  await fs.chmod(hookPath, 0o755)

  console.log(`cortexos: git hook installed ✔`)
  console.log(`  repo     : ${repoPath}`)
  console.log(`  project  : ${slug}`)
  console.log(`  daemon   : ${config.daemonUrl}`)
  console.log(`  webhook  : ${config.daemonUrl}/api/cortex/hooks/git`)
  console.log(`  next     : make a commit — it should appear in the project's Timeline within a second.`)
}

async function uninstall(gitDir, repoPath) {
  const hookPath = path.join(gitDir, 'hooks', HOOK_NAME)
  try {
    const content = await fs.readFile(hookPath, 'utf8')
    if (!content.includes(MARKER)) {
      console.log(`cortexos: no cortexos ${HOOK_NAME} hook found in ${repoPath}.`)
      return
    }
    const lines = content.split('\n')
    const start = lines.findIndex((l) => l.includes(MARKER))
    const end = lines.findIndex((l) => l.includes(MARKER_END))
    const kept = end === -1 ? lines.slice(0, start) : [...lines.slice(0, start), ...lines.slice(end + 1)]
    const remainder = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    const isOnlyShebang = /^(#!.*)?$/s.test(remainder)
    if (remainder.length === 0 || isOnlyShebang) {
      await fs.rm(hookPath)
    } else {
      await fs.writeFile(hookPath, `${remainder}\n`, { mode: 0o755 })
    }
    console.log(`cortexos: ${HOOK_NAME} hook removed from ${repoPath}.`)
  } catch {
    console.log(`cortexos: no ${HOOK_NAME} hook found in ${repoPath}.`)
  }
}

async function check(gitDir, repoPath) {
  const hookPath = path.join(gitDir, 'hooks', HOOK_NAME)
  try {
    const content = await fs.readFile(hookPath, 'utf8')
    const installed = content.includes(MARKER)
    console.log(`cortexos: ${HOOK_NAME} hook ${installed ? 'INSTALLED' : 'not installed'} in ${repoPath}.`)
    if (!installed) process.exitCode = 1
  } catch {
    console.log(`cortexos: no ${HOOK_NAME} hook in ${repoPath}.`)
    process.exitCode = 1
  }
}

/** The hook body — a self-contained Node script. `withShebang` puts the
 *  interpreter line first when we own the whole file (required for exec);
 *  chained installs omit it (the existing hook already owns line 1). */
function buildHook(withShebang) {
  const shebang = withShebang ? '#!/usr/bin/env node\n' : ''
  return `${shebang}${MARKER}
(async () => {
  try {
    const { readFile } = require('node:fs/promises');
    const { execFile } = require('node:child_process');
    const { promisify } = require('node:util');
    const run = promisify(execFile);
    const path = require('node:path');

    const root = (await run('git', ['rev-parse', '--show-toplevel'])).stdout.trim();
    let cfg;
    try {
      cfg = JSON.parse(await readFile(path.join(root, '.cortex', 'daemon.json'), 'utf8'));
    } catch { process.exit(0); }

    const hash = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim();
    const message = (await run('git', ['log', '-1', '--pretty=%B'])).stdout;
    const author = (await run('git', ['log', '-1', '--pretty=%an'])).stdout.trim();
    const date = (await run('git', ['log', '-1', '--pretty=%aI'])).stdout.trim();
    let files = [];
    try {
      const out = (await run('git', ['diff-tree', '--no-commit-id', '--name-status', '-r', 'HEAD'])).stdout;
      files = out.split('\\n').filter((l) => l.trim()).map((line) => {
        const parts = line.split('\\t');
        return { status: parts[0].trim().charAt(0), path: (parts[1] || parts[parts.length - 1] || '').trim() };
      });
    } catch {}

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(cfg.daemonUrl + '/api/cortex/hooks/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: cfg.slug, platform: cfg.platform || undefined, commits: [{ hash, message, author, timestamp: date, files }] }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {}
})();
${MARKER_END}`
}

function printUsage() {
  console.log(`cortex-git-hook — CortexOS git integration (Phase 2)

USAGE
  install     node cortex-git-hook.mjs install --repo <path> --slug <slug> [--daemon <url>] [--platform <name>]
  uninstall   node cortex-git-hook.mjs uninstall --repo <path>
  check       node cortex-git-hook.mjs check --repo <path>

OPTIONS
  --repo      Path to the git repository to hook (required)
  --slug      CortexOS project slug the repo feeds (install only)
  --daemon    Daemon base URL (default http://localhost:3000)
  --platform  Platform hint stamped on commits (codex | hermes | opencode | …)

WHAT IT DOES
  Writes .cortex/daemon.json into the repo and a post-commit hook that
  POSTs every commit to POST /api/cortex/hooks/git — commits become
  Timeline events, Knowledge Graph file updates and bug auto-resolution.`)
}

function fail(message) {
  console.error(`cortexos: ${message}`)
  printUsage()
  process.exit(1)
}

main().catch((error) => {
  console.error('cortexos: unexpected error —', error)
  process.exit(1)
})
