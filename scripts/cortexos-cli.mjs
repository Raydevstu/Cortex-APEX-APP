#!/usr/bin/env node
/**
 * File: scripts/cortexos-cli.mjs
 * CortexOS Phase 5 — Unified CLI Wrapper (blueprint PHASE_5 §3/§4/§5).
 *
 * Terminal access to the full daemon surface:
 *
 *   cortexos status [--project <slug>] [--xml] [--json]
 *       CLI view of the Visual Command Center state: graph counts by label,
 *       token-savings telemetry, locked symbol FQNs, top CTO recommendations
 *       — and, with --xml, the injectable <cortex_sync_packet>.
 *
 *   cortexos scope [--project <slug>] (--list | --lock <fqn...> [--exact]
 *                  | --unlock <fqn...> | --toggle <fqn> | --reset)
 *       Direct AST Semantic Scope Lock mutations. Locks are enforced by the
 *       daemon's staging sentinel (staged modifications of locked symbols
 *       are rejected with 422).
 *
 *   cortexos cto [--project <slug>] (audit [--force] | plan --goal "<goal>"
 *                [--execute] | dispatch --plan-id <id> | archive --plan-id <id>)
 *       Terminal interface to the AI CTO: workspace audit, Multi-Agent DAG
 *       build / dispatch / archive.
 *
 *   cortexos hooks (install | run-post-commit | flush-spool)
 *       The Git post-commit -> cortex_extract_memory loop: every commit is
 *       synthesized into a turn, ingested as a GitCommit (git.commit
 *       timeline event + Knowledge Graph file refresh + bug auto-resolution)
 *       and extracted through Engine 3 (memories, MODIFIED_SYMBOL graph
 *       context, memory.delta_applied timeline event, episodic index).
 *       Fail-open: when the daemon is unreachable the entry is spooled to
 *       .cortex/spool/pending-git-commits.jsonl and replayed FIFO (deduped
 *       by commit SHA) on the next flush-spool.
 *
 * Resolution order (blueprint §3.1):
 *   daemon  --daemon-url > CORTEX_DAEMON_URL > CORTEX_BASE_URL >
 *           .cortex/daemon.json (repo) > live probe :3000/:4300 >
 *           http://127.0.0.1:3000
 *   project --project > CORTEX_PROJECT > .cortex/daemon.json slug >
 *           .cortex/project-dna.json slug|projectId > cortexos-daemon-self-audit
 *
 * Every subcommand supports --json for deterministic machine-readable output.
 * Run directly:  node scripts/cortexos-cli.mjs <command> …
 * Also exposed as the `cortexos` bin (bin/cortexos.mjs).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const run = promisify(execFile)
const CLI_PATH = fileURLToPath(import.meta.url)

const DEFAULT_PROJECT = 'cortexos-daemon-self-audit'
const PROBE_CANDIDATES = ['http://127.0.0.1:3000', 'http://127.0.0.1:4300']
const HOOK_MARKER_START = '# >>> cortexos >>>'
const HOOK_MARKER_END = '# <<< cortexos <<<'
const LEGACY_P2_MARKER = '// >>> cortexos >>>' // Phase 2 node-flavoured hook

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const VALUE_FLAGS = new Set(['project', 'daemon-url', 'sha', 'dir', 'goal', 'plan-id', 'toggle', 'root', 'slug', 'name', 'platform', 'daemon', 'port', 'upstream-url'])
const VARIADIC_FLAGS = new Set(['lock', 'unlock'])
const BOOLEAN_FLAGS = new Set(['json', 'xml', 'force', 'execute', 'reset', 'list', 'exact', 'help', 'no-wire', 'no-daemon'])

export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const key = token.slice(2)
    if (key.length === 0) throw new Error('empty option "--" is not valid')
    if (VARIADIC_FLAGS.has(key)) {
      const values = []
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        values.push(argv[++i])
      }
      flags[key] = values
    } else if (VALUE_FLAGS.has(key)) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--${key} requires a value`)
      }
      flags[key] = next
      i++
    } else if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = true
    } else {
      throw new Error(`unknown option --${key} (run "cortexos help")`)
    }
  }
  return { positional, flags }
}

// ---------------------------------------------------------------------------
// Daemon + project resolution (blueprint §3.1)
// ---------------------------------------------------------------------------

function trimUrl(url) {
  return String(url).replace(/\/+$/, '')
}

async function probeDaemon(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/cortex/health`, { signal: AbortSignal.timeout(1_500) })
    return response.ok
  } catch {
    return false
  }
}

async function resolveDaemonUrl(explicitFlag, repoDir) {
  if (explicitFlag) return trimUrl(explicitFlag)
  if (process.env.CORTEX_DAEMON_URL) return trimUrl(process.env.CORTEX_DAEMON_URL)
  if (process.env.CORTEX_BASE_URL) return trimUrl(process.env.CORTEX_BASE_URL)
  // Repo-level config recorded by `cortexos hooks install` (Phase 2 layout).
  const repoConfig = await readCortexConfig(repoDir)
  if (repoConfig?.daemonUrl) return trimUrl(repoConfig.daemonUrl)
  for (const candidate of PROBE_CANDIDATES) {
    if (await probeDaemon(candidate)) return candidate
  }
  return PROBE_CANDIDATES[0]
}

async function readCortexConfig(repoDir) {
  if (!repoDir) return null
  try {
    return JSON.parse(await fs.readFile(path.join(repoDir, '.cortex', 'daemon.json'), 'utf8'))
  } catch {
    return null
  }
}

async function resolveDefaultProject(repoDir) {
  if (process.env.CORTEX_PROJECT) return process.env.CORTEX_PROJECT
  const repoConfig = await readCortexConfig(repoDir)
  if (repoConfig?.slug) return repoConfig.slug
  try {
    const dna = JSON.parse(await fs.readFile(path.join(repoDir, '.cortex', 'project-dna.json'), 'utf8'))
    if (dna.slug || dna.projectId) return dna.slug || dna.projectId
  } catch {
    // fall through to the default
  }
  return DEFAULT_PROJECT
}

// ---------------------------------------------------------------------------
// Daemon client
// ---------------------------------------------------------------------------

export class DaemonHttpError extends Error {
  constructor(message, status, payload) {
    super(message)
    this.name = 'DaemonHttpError'
    this.status = status
    this.payload = payload
  }
}

function isNetworkError(error) {
  return !(error instanceof DaemonHttpError)
}

export async function daemonFetch(baseUrl, endpoint, { method = 'GET', body, timeoutMs = 25_000 } = {}) {
  let response
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // Surface fetch/abort failures as-is — callers classify them as
    // "daemon unreachable" (spoolable) rather than HTTP errors.
    throw error
  }
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  if (!response.ok) {
    const message = (json && typeof json === 'object' && json.error) || json?.message || `daemon returned HTTP ${response.status}`
    throw new DaemonHttpError(String(message), response.status, json)
  }
  return json
}

// ---------------------------------------------------------------------------
// Human-readable renderers
// ---------------------------------------------------------------------------

function graphLabelSummary(nodes) {
  const labels = {}
  for (const node of nodes) labels[node.label] = (labels[node.label] ?? 0) + 1
  return Object.entries(labels)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label} ×${count}`)
    .join(', ')
}

function renderRecommendation(r, index) {
  const impact = r.impactedSymbols?.length > 0
    ? `\n      impacted: ${r.impactedSymbols.slice(0, 3).join(', ')}${r.impactedSymbols.length > 3 ? ', …' : ''}`
    : ''
  return `   ${index}. [${r.severity}] ${r.category} — ${r.title}${impact}`
}

function renderStatus(data, { includeXml }) {
  const t = data.telemetry
  const scope = data.scopeLock
  const lines = [
    `CORTEXOS STATUS — ${data.projectName} (${data.projectSlug}) · DNA v${data.projectDnaVersion}`,
    `  Graph:      ${data.graph.nodes.length} nodes / ${data.graph.edges.length} edges — ${graphLabelSummary(data.graph.nodes)}`,
    `  Tokens:     ${t.totalPromptsIntercepted} prompts intercepted · ${t.netTokensSaved.toLocaleString('en-US')} net tokens saved (${t.compressionRatioPct}% compression, $${t.estimatedCostSavingsUsd}) · ${t.localOffloadPct}% local offload`,
    `  Scope lock: ${scope.lockedSymbolFqns.length} locked · ${scope.allowedSymbolFqns.length} allowed · ${scope.forbiddenPaths.length} forbidden path(s)`,
  ]
  for (const fqn of scope.lockedSymbolFqns) lines.push(`    - ${fqn}`)
  lines.push(`  CTO:        ${(data.ctoRecommendations ?? []).length} recommendation(s)`)
  ;(data.ctoRecommendations ?? []).slice(0, 3).forEach((r, i) => lines.push(renderRecommendation(r, i + 1)))
  const latest = data.timeline?.[0]
  if (latest) lines.push(`  Timeline:   latest [${latest.kind}] ${latest.summary.slice(0, 90)}`)
  if (includeXml && data.syncPacketXml) {
    lines.push('', '--- <cortex_sync_packet> (inject into any AI platform) ---', data.syncPacketXml)
  }
  return lines.join('\n')
}

function renderScopeLock(scopeLock, projectName) {
  const lines = [
    `SCOPE LOCK — ${projectName}`,
    `  Locked symbols (${scopeLock.lockedSymbolFqns.length}):`,
  ]
  if (scopeLock.lockedSymbolFqns.length === 0) lines.push('    (none — no symbol is under a hard lock)')
  for (const fqn of scopeLock.lockedSymbolFqns) lines.push(`    - ${fqn}`)
  lines.push(`  Allowed symbols (${scopeLock.allowedSymbolFqns.length}):`)
  for (const fqn of scopeLock.allowedSymbolFqns) lines.push(`    - ${fqn}`)
  lines.push(`  Forbidden paths (${scopeLock.forbiddenPaths.length}):`)
  for (const p of scopeLock.forbiddenPaths) lines.push(`    - ${p}`)
  lines.push(`  source: ${scopeLock.source} · updated ${scopeLock.updatedAt.slice(0, 19).replace('T', ' ')}`)
  return lines.join('\n')
}

function renderAudit(payload) {
  const { audit, plans } = payload
  const lines = [
    `AI CTO AUDIT — ${audit.projectName} (${audit.stats.cache === 'hit' ? 'cache hit' : 'fresh scan'} @ ${audit.scannedAt.slice(0, 19).replace('T', ' ')})`,
    `  Workspace: ${audit.stats.symbolsScanned} symbols / ${audit.stats.filesScanned} files · ${audit.stats.layerViolations} layer violation(s) · ${audit.stats.complexityHotspots} complexity hotspot(s)`,
    '',
    `  RECOMMENDATIONS (${(audit.recommendations ?? []).length}):`,
  ]
  if ((audit.recommendations ?? []).length === 0) lines.push('    (none — workspace is clean for the current scope)')
  ;(audit.recommendations ?? []).forEach((r, i) => {
    lines.push(renderRecommendation(r, i + 1))
    if (r.suggestedAction?.commandPreview) lines.push(`      → ${r.suggestedAction.commandPreview}`)
  })
  lines.push('', `  DAG PLANS (${(plans ?? []).length}):`)
  if ((plans ?? []).length === 0) lines.push('    (none — build one with: cortexos cto plan --goal "<objective>")')
  for (const plan of plans ?? []) {
    lines.push(`    · ${String(plan.id).slice(0, 8)} [${plan.status}] ${plan.goal.slice(0, 70)} — ${plan.subtasks.length} subtask(s), ${plan.waves.length} wave(s)`)
  }
  return lines.join('\n')
}

function renderPlan(plan) {
  const lines = [
    `DAG PLAN ${String(plan.id).slice(0, 8)} — ${plan.goal}`,
    `  Status: ${plan.status} · ${plan.subtasks.length} subtask(s) in ${plan.waves.length} wave(s) · created ${plan.createdAt.slice(0, 19).replace('T', ' ')}`,
  ]
  if (plan.auditMeta?.estimatedTokenSavings) {
    lines.push(`  Estimated cloud-token savings: ~${plan.auditMeta.estimatedTokenSavings.toLocaleString('en-US')}`)
  }
  plan.waves.forEach((wave, waveIndex) => {
    lines.push('', `  Wave ${waveIndex + 1} (parallel):`)
    for (const subtaskId of wave) {
      const task = plan.subtasks.find((s) => s.id === subtaskId)
      if (!task) continue
      const depTitles = (task.dependencies ?? []).map((d) => plan.subtasks.find((s) => s.id === d)?.title ?? d)
      const deps = depTitles.length > 0 ? ` · after "${depTitles.join('" + "')}"` : ''
      lines.push(`    · ${task.title} [${task.status}] — ${task.assignedAgent}${deps}`)
      if (task.resultSummary) lines.push(`        result: ${task.resultSummary}`)
      for (const artifact of task.artifacts ?? []) {
        lines.push(`        ${artifact.ok ? '✓' : '✗'} ${artifact.toolName}: ${artifact.summary}`)
      }
    }
  })
  return lines.join('\n')
}

function renderDispatch(plan) {
  const lines = [renderPlan(plan)]
  const awaiting = (plan.subtasks ?? []).filter((s) => s.agentKind === 'cloud' && s.status === 'dispatched' && s.payload)
  if (awaiting.length === 0) {
    const settled = (plan.subtasks ?? []).every((s) => ['completed', 'failed', 'skipped'].includes(s.status))
    lines.push('', settled
      ? 'The plan is fully settled — no cloud payloads pending.'
      : 'No cloud payloads pending — confirm outcomes or re-dispatch when dependencies complete.')
    return lines.join('\n')
  }
  for (const subtask of awaiting) {
    lines.push('',
      `--- TIER-1 PAYLOAD — "${subtask.title}" → ${subtask.assignedAgent} ---`,
      `(when finished, confirm with: cortexos cto confirm or POST /cto {action:"UPDATE_SUBTASK", planId:"${plan.id}", subtaskId:"${subtask.id}", status:"completed"})`,
      '',
      subtask.payload)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Git plumbing — commit collection + AST symbol detection
// ---------------------------------------------------------------------------

async function git(repoDir, args) {
  const { stdout } = await run('git', ['-C', repoDir, ...args], { maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/
const JS_SYMBOL_PATTERNS = [
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/,
  /^(?:export\s+)?(?:interface|enum)\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[<=]/,
]
const PY_SYMBOL_PATTERNS = [
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^\s*class\s+([A-Za-z_]\w*)/,
]

function matchSymbol(line, filePath) {
  if (!CODE_EXT.test(filePath)) return null
  const patterns = filePath.endsWith('.py') ? PY_SYMBOL_PATTERNS : JS_SYMBOL_PATTERNS
  for (const pattern of patterns) {
    const name = pattern.exec(line)?.[1]
    if (name) return name
  }
  return null
}

/** Parse a unified(-0) patch: per-file added/removed top-level symbols and
 *  the insertion/deletion counts. Deterministic regex AST diff (§5.1). */
export function parsePatchSymbols(patch) {
  const added = new Map() // path → Set<name>
  const removed = new Map()
  let currentPath = null
  let insertions = 0
  let deletions = 0
  for (const rawLine of patch.split('\n')) {
    if (rawLine.startsWith('+++ b/')) {
      currentPath = rawLine.slice(6).trim()
      if (!added.has(currentPath)) added.set(currentPath, new Set())
      if (!removed.has(currentPath)) removed.set(currentPath, new Set())
    } else if (rawLine.startsWith('diff --git ') || rawLine.startsWith('--- ')) {
      continue
    } else if (rawLine.startsWith('+')) {
      insertions++
      const name = currentPath && matchSymbol(rawLine.slice(1), currentPath)
      if (name) added.get(currentPath).add(name)
    } else if (rawLine.startsWith('-')) {
      deletions++
      const name = currentPath && matchSymbol(rawLine.slice(1), currentPath)
      if (name) removed.get(currentPath).add(name)
    }
  }
  const files = []
  for (const [filePath, names] of added) {
    const removedNames = removed.get(filePath) ?? new Set()
    const addedSymbols = [...names].filter((n) => !removedNames.has(n)).slice(0, 50)
    const modifiedSymbols = [...names].filter((n) => removedNames.has(n)).slice(0, 50)
    if (addedSymbols.length > 0 || modifiedSymbols.length > 0) {
      files.push({ path: filePath, addedSymbols, modifiedSymbols })
    }
  }
  return { files: files.slice(0, 50), insertions, deletions }
}

/** Collect the full structured commit record (blueprint §5.1). */
export async function collectCommit(repoDir, shaRef) {
  const fullSha = (await git(repoDir, ['rev-parse', '--verify', `${shaRef}^{commit}`])).trim()
  const metaRaw = await git(repoDir, ['log', '-1', fullSha, '--pretty=format:%H%x00%an%x00%aI%x00%s%x00%b'])
  const [sha, author, timestamp, subject, body = ''] = metaRaw.split('\x00')
  const nameStatus = await git(repoDir, ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', fullSha])
  const files = nameStatus.split('\n').filter((l) => l.trim()).map((line) => {
    const parts = line.split('\t')
    const status = (parts[0] ?? 'M').trim().charAt(0)
    const filePath = status === 'R' || status === 'C' ? parts[parts.length - 1] : parts[1]
    return { status, path: (filePath ?? parts[parts.length - 1] ?? '').trim() }
  })
  const patch = await git(repoDir, ['show', '--no-color', '--unified=0', '--format=', '--first-parent', fullSha]).catch(() => '')
  const { files: detectedSymbols, insertions, deletions } = parsePatchSymbols(patch)
  return {
    sha,
    shortSha: sha.slice(0, 8),
    author,
    timestamp,
    subject,
    body: body.replace(/\n+$/, ''),
    files: files.slice(0, 200),
    stat: { insertions, deletions },
    detectedSymbols,
  }
}

// ---------------------------------------------------------------------------
// Extraction payload builder (shared by the live path and spool replay)
// ---------------------------------------------------------------------------

export function buildExtractionBodies(entry) {
  const commit = entry.commit
  const short = commit.shortSha
  const filesList = commit.files.map((f) => `${f.status} ${f.path}`)
  const fqn = (file, name) => `${file.path}#${name}`
  const addedText = commit.detectedSymbols.flatMap((f) => f.addedSymbols.map((n) => fqn(f, n)))
  const modifiedText = commit.detectedSymbols.flatMap((f) => f.modifiedSymbols.map((n) => fqn(f, n)))

  const rawUserPrompt = [
    `[git commit ${short}] ${commit.subject}`,
    commit.body.trim() ? `\n${commit.body.trim()}` : '',
  ].join('\n')

  const aiResponseText = [
    `Applied commit ${short} (by ${commit.author || 'unknown'}, ${commit.timestamp || 'now'}).`,
    `Files changed (${commit.files.length}): ${filesList.join(', ') || '(none)'}.`,
    `Diffstat: ${commit.stat.insertions} insertion(s), ${commit.stat.deletions} deletion(s).`,
    addedText.length > 0 ? `AST symbols added: ${addedText.join(', ')}.` : null,
    modifiedText.length > 0 ? `AST symbols modified: ${modifiedText.join(', ')}.` : null,
  ].filter(Boolean).join('\n')

  return {
    webhook: {
      slug: entry.project,
      commits: [{
        hash: commit.sha,
        message: [commit.subject, commit.body.trim()].filter(Boolean).join('\n\n').slice(0, 2_000) || commit.subject,
        author: commit.author || undefined,
        timestamp: commit.timestamp || undefined,
        files: commit.files.map((f) => ({ path: f.path, status: f.status })),
      }],
    },
    extract: {
      projectId: entry.project,
      sourcePlatform: 'git-hook',
      sessionId: `git-commit-${short}`,
      rawUserPrompt,
      aiResponseText,
      modifiedFilesAstDiff: commit.detectedSymbols,
    },
  }
}

// ---------------------------------------------------------------------------
// Spool — .cortex/spool/pending-git-commits.jsonl (fail-open offline queue)
// ---------------------------------------------------------------------------

function spoolPathFor(repoDir) {
  return path.join(repoDir, '.cortex', 'spool', 'pending-git-commits.jsonl')
}

async function appendSpool(repoDir, entry) {
  const spoolPath = spoolPathFor(repoDir)
  await fs.mkdir(path.dirname(spoolPath), { recursive: true })
  await fs.appendFile(spoolPath, `${JSON.stringify(entry)}\n`, 'utf8')
  return spoolPath
}

async function readSpool(spoolPath) {
  let raw
  try {
    raw = await fs.readFile(spoolPath, 'utf8')
  } catch {
    return { entries: [], corrupt: 0 }
  }
  const entries = []
  let corrupt = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      corrupt += 1
    }
  }
  return { entries, corrupt }
}

async function rewriteSpool(spoolPath, entries) {
  if (entries.length === 0) {
    await fs.rm(spoolPath, { force: true })
    return
  }
  const tmp = `${spoolPath}.tmp-${process.pid}`
  await fs.writeFile(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  await fs.rename(tmp, spoolPath)
}

/** Deliver one spool-format entry to the daemon (webhook + extraction). */
async function deliverEntry(entry, baseUrl) {
  const bodies = buildExtractionBodies(entry)
  const webhook = await daemonFetch(baseUrl, '/api/cortex/hooks/git', {
    method: 'POST', body: bodies.webhook, timeoutMs: 20_000,
  })
  const extract = await daemonFetch(baseUrl, '/api/cortex/memory/extract', {
    method: 'POST', body: bodies.extract, timeoutMs: 90_000,
  })
  return { webhook, extract }
}

// ---------------------------------------------------------------------------
// hooks install — managed post-commit shim (blueprint §5.1)
// ---------------------------------------------------------------------------

function shEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function shManagedBlock() {
  return [
    `${HOOK_MARKER_START} (managed block — \`cortexos hooks install\`)`,
    `# CortexOS Phase 5 post-commit memory loop. Edit outside the markers freely.`,
    `"${shEscape(process.execPath)}" "${shEscape(CLI_PATH)}" hooks run-post-commit --dir "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" >/dev/null 2>&1 || true`,
    HOOK_MARKER_END,
  ].join('\n')
}

function nodeManagedBlock() {
  return [
    `// >>> cortexos >>> (managed block — \`cortexos hooks install\`)`,
    `// CortexOS Phase 5 post-commit memory loop. Edit outside the markers freely.`,
    `try {`,
    `  const cp = require('node:child_process');`,
    `  const root = cp.execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();`,
    `  cp.execFileSync(process.execPath, [${JSON.stringify(CLI_PATH)}, 'hooks', 'run-post-commit', '--dir', root], { stdio: 'ignore', timeout: 90_000 });`,
    `} catch (e) {}`,
    `// <<< cortexos <<<`,
  ].join('\n')
}

function replaceManagedBlock(content, block, markerStart, markerEnd) {
  const lines = content.split('\n')
  const start = lines.findIndex((l) => l.includes(markerStart))
  const end = lines.findIndex((l) => l.includes(markerEnd))
  if (start === -1 || end === -1 || end < start) return null
  const kept = [...lines.slice(0, start), block, ...lines.slice(end + 1)]
  return kept.join('\n')
}

async function resolveGitDir(repoDir) {
  const dotGit = path.join(repoDir, '.git')
  const stat = await fs.stat(dotGit).catch(() => null)
  if (!stat) throw new Error(`${repoDir} is not a git repository (.git not found)`)
  if (stat.isDirectory()) return dotGit
  // Worktree/submodule: .git is a file containing "gitdir: <path>"
  const content = (await fs.readFile(dotGit, 'utf8')).trim()
  const gitdir = /^gitdir:\s*(.+)$/m.exec(content)?.[1]
  if (!gitdir) throw new Error(`${repoDir}: unsupported .git file (no gitdir pointer)`)
  return path.resolve(repoDir, gitdir)
}

async function installHook({ repoDir, project, baseUrl }) {
  const gitDir = await resolveGitDir(repoDir)
  const hooksDir = path.join(gitDir, 'hooks')
  await fs.mkdir(hooksDir, { recursive: true })
  const hookPath = path.join(hooksDir, 'post-commit')

  // 1. Repo-level daemon config (Phase 2-compatible layout) so the hook
  //    works standalone: no env vars required at commit time.
  const cortexDir = path.join(repoDir, '.cortex')
  await fs.mkdir(cortexDir, { recursive: true })
  const existingConfig = await readCortexConfig(repoDir) ?? {}
  const config = {
    ...existingConfig,
    daemonUrl: baseUrl,
    slug: project,
    platform: existingConfig.platform ?? null,
    installedAt: new Date().toISOString(),
  }
  await fs.writeFile(path.join(cortexDir, 'daemon.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8')

  // 2. Keep .cortex/ out of version control when a .gitignore exists.
  const gitignorePath = path.join(repoDir, '.gitignore')
  try {
    const gitignore = await fs.readFile(gitignorePath, 'utf8')
    if (!gitignore.split('\n').some((l) => l.trim() === '.cortex/')) {
      await fs.writeFile(gitignorePath, `${gitignore.replace(/\n*$/, '\n')}.cortex/\n`, 'utf8')
    }
  } catch {
    // No .gitignore — nothing to do.
  }

  // 3. The post-commit shim.
  let existing = ''
  try {
    existing = await fs.readFile(hookPath, 'utf8')
  } catch {
    existing = ''
  }
  let mode = 'created'
  let content
  if (existing.includes(HOOK_MARKER_START)) {
    // Idempotent refresh of our own managed block.
    content = replaceManagedBlock(existing, shManagedBlock(), HOOK_MARKER_START, HOOK_MARKER_END)
    if (content === null) content = `#!/usr/bin/env sh\n${shManagedBlock()}\n`
    mode = 'refreshed'
  } else if (existing.includes(LEGACY_P2_MARKER)) {
    // Phase 2's node-flavoured hook — superseded: this loop re-posts to the
    // same /hooks/git webhook itself, so nothing is lost. Rewrite as sh.
    content = `#!/usr/bin/env sh\n${shManagedBlock()}\n`
    mode = 'superseded-phase2'
  } else if (existing.trim().length > 0) {
    // Foreign hook — chain after it, matching its interpreter.
    const shebang = (existing.split('\n')[0] ?? '')
    const isNode = /^#!.*node/.test(shebang)
    const block = isNode ? nodeManagedBlock() : shManagedBlock()
    content = `${existing.replace(/\n*$/, '\n')}\n${block}\n`
    mode = isNode ? 'chained-node' : 'chained-sh'
  } else {
    content = `#!/usr/bin/env sh\n${shManagedBlock()}\n`
  }
  await fs.writeFile(hookPath, content, { encoding: 'utf8', mode: 0o755 })
  await fs.chmod(hookPath, 0o755)

  return { ok: true, hookPath, repoDir, configPath: path.join(cortexDir, 'daemon.json'), mode }
}

// ---------------------------------------------------------------------------
// hooks run-post-commit + flush-spool
// ---------------------------------------------------------------------------

async function runPostCommit({ repoDir, project, baseUrl, sha }) {
  const commit = await collectCommit(repoDir, sha)
  const entry = {
    version: 1,
    spooledAt: new Date().toISOString(),
    repo: repoDir,
    project,
    daemonUrl: baseUrl,
    commit,
  }
  try {
    const { webhook, extract } = await deliverEntry(entry, baseUrl)
    const git = webhook ?? {}
    return {
      status: 'extracted',
      project,
      commit: commit.shortSha,
      sessionId: `git-commit-${commit.shortSha}`,
      git: {
        ingested: git.ingested ?? 0,
        duplicates: git.duplicates ?? 0,
        bugsResolved: git.bugsResolved ?? [],
      },
      memory: {
        decisionsCreated: extract.decisionsCreated ?? 0,
        decisionsSuperseded: extract.decisionsSuperseded ?? 0,
        requirementsCreated: extract.requirementsCreated ?? 0,
        tasksUpdated: extract.tasksUpdated ?? 0,
        tasksCreated: extract.tasksCreated ?? 0,
        bugsCreated: extract.bugsCreated ?? 0,
        bugsResolved: extract.bugsResolved ?? 0,
        preferencesCreated: extract.preferencesCreated ?? 0,
        engineUsed: extract.engineUsed ?? 'deterministic',
      },
      timeline: ['git.commit', 'memory.delta_applied'],
    }
  } catch (error) {
    const spoolable = isNetworkError(error) || error.status >= 500
    if (!spoolable) throw error
    const spoolPath = await appendSpool(repoDir, entry)
    const { entries } = await readSpool(spoolPath)
    return {
      status: 'spooled',
      project,
      commit: commit.shortSha,
      sessionId: `git-commit-${commit.shortSha}`,
      spoolPath,
      entriesPending: entries.length,
      reason: isNetworkError(error) ? 'daemon unreachable' : `daemon error (HTTP ${error.status})`,
    }
  }
}

async function flushSpool({ repoDir, baseUrl }) {
  const spoolPath = spoolPathFor(repoDir)
  const { entries: rawEntries, corrupt } = await readSpool(spoolPath)
  if (rawEntries.length === 0 && corrupt === 0) {
    return { flushed: 0, skippedDuplicates: 0, dropped: 0, remaining: 0, corrupt: 0, spoolPath }
  }

  // FIFO with in-file dedupe by commit SHA (keep the first occurrence).
  const seenShas = new Set()
  const entries = rawEntries.filter((entry) => {
    const sha = entry?.commit?.sha
    if (!sha || seenShas.has(sha)) return false
    seenShas.add(sha)
    return true
  })

  // Cross-check against already-extracted interactions (sessionId pinning)
  // so a replay after a crash-between-POST-and-rewrite cannot double-extract.
  const projectIds = new Map() // slug → canonical id
  try {
    const { projects } = await daemonFetch(baseUrl, '/api/cortex/projects', { timeoutMs: 15_000 })
    for (const p of projects ?? []) projectIds.set(p.slug, p.id)
  } catch {
    // Lookup is best-effort — engine-level memory dedupe remains the backstop.
  }
  const extractedSessionIds = new Set()
  for (const slug of new Set(entries.map((e) => e.project))) {
    const projectId = projectIds.get(slug)
    if (!projectId) continue
    try {
      const { interactions } = await daemonFetch(baseUrl, `/api/cortex/interactions?projectId=${encodeURIComponent(projectId)}`, { timeoutMs: 15_000 })
      for (const interaction of interactions ?? []) {
        if (interaction.sessionId) extractedSessionIds.add(interaction.sessionId)
      }
    } catch {
      // best-effort
    }
  }

  let flushed = 0
  let skippedDuplicates = 0
  let dropped = 0
  const remaining = []
  for (const entry of entries) {
    const sessionId = `git-commit-${entry.commit.shortSha}`
    if (extractedSessionIds.has(sessionId)) {
      skippedDuplicates += 1
      continue
    }
    try {
      await deliverEntry(entry, baseUrl)
      flushed += 1
      extractedSessionIds.add(sessionId)
    } catch (error) {
      if (isNetworkError(error)) {
        // Daemon went away mid-flush — keep this entry and everything after it.
        remaining.push(entry, ...entries.slice(entries.indexOf(entry) + 1))
        break
      }
      if (error.status >= 500) {
        remaining.push(entry) // transient — retry on the next flush
        continue
      }
      dropped += 1 // 4xx: permanently invalid payload — do not poison the queue
      process.stderr.write(`cortexos: dropped spooled commit ${entry.commit.shortSha} — daemon rejected it (HTTP ${error.status}: ${error.message})\n`)
    }
  }
  await rewriteSpool(spoolPath, remaining)

  return { flushed, skippedDuplicates, dropped, remaining: remaining.length, corrupt, spoolPath }
}

// ---------------------------------------------------------------------------
// Domain handlers
// ---------------------------------------------------------------------------

function output(json, asJson, humanText) {
  if (asJson) {
    console.log(JSON.stringify(json, null, 2))
  } else {
    console.log(humanText)
  }
}

async function handleStatus({ project, baseUrl, flags }) {
  const state = await daemonFetch(baseUrl, `/api/cortex/state?project=${encodeURIComponent(project)}`)
  if (flags.json) return output(state, true)
  console.log(renderStatus(state, { includeXml: Boolean(flags.xml) }))
}

async function handleScope({ project, baseUrl, flags }) {
  if (flags.reset) {
    const state = await daemonFetch(baseUrl, '/api/cortex/state', {
      method: 'POST', body: { projectId: project, action: 'RESET_SCOPE_LOCK' },
    })
    return output(state, flags.json,
      `Scope lock reset — symbol locks reseeded to the deterministic defaults.\n\n${renderScopeLock(state.scopeLock, project)}`)
  }

  if (flags.toggle) {
    if ((flags.lock?.length ?? 0) > 0 || (flags.unlock?.length ?? 0) > 0) {
      throw new Error('--toggle cannot be combined with --lock/--unlock')
    }
    const state = await daemonFetch(baseUrl, '/api/cortex/state', {
      method: 'POST', body: { projectId: project, action: 'TOGGLE_SYMBOL_SCOPE', fqn: String(flags.toggle) },
    })
    return output(state, flags.json,
      `Toggled "${flags.toggle}".\n\n${renderScopeLock(state.scopeLock, project)}`)
  }

  const toLock = flags.lock ?? []
  const toUnlock = flags.unlock ?? []
  if (toLock.length > 0 || toUnlock.length > 0) {
    let lockedSymbolFqns
    if (flags.exact && toLock.length > 0) {
      lockedSymbolFqns = [...new Set(toLock)]
    } else {
      const current = await daemonFetch(baseUrl, `/api/cortex/state?project=${encodeURIComponent(project)}`)
      const lockedSet = new Set(current.scopeLock?.lockedSymbolFqns ?? [])
      for (const fqn of toLock) lockedSet.add(fqn)
      for (const fqn of toUnlock) lockedSet.delete(fqn)
      lockedSymbolFqns = [...lockedSet]
    }
    const state = await daemonFetch(baseUrl, '/api/cortex/state', {
      method: 'POST',
      body: { projectId: project, action: 'SET_SCOPE_LOCK', lockedSymbolFqns },
    })
    const headline = flags.exact && toLock.length > 0
      ? `Scope lock set to the exact list (${lockedSymbolFqns.length} locked).`
      : `Scope lock updated — ${toLock.length} locked, ${toUnlock.length} unlocked → ${lockedSymbolFqns.length} active lock(s).`
    return output(state, flags.json, `${headline}\n\n${renderScopeLock(state.scopeLock, project)}`)
  }

  // Default (and --list): show the current scope lock.
  const state = await daemonFetch(baseUrl, `/api/cortex/state?project=${encodeURIComponent(project)}`)
  if (flags.json) return output(state.scopeLock, true)
  console.log(renderScopeLock(state.scopeLock, state.projectName))
}

async function handleCto({ project, baseUrl, flags, subcommand }) {
  const action = (subcommand ?? 'audit').toLowerCase()

  if (action === 'audit') {
    if (flags.force) {
      const payload = await daemonFetch(baseUrl, '/api/cortex/cto', {
        method: 'POST', body: { projectId: project, action: 'AUDIT' }, timeoutMs: 120_000,
      })
      return output(payload, flags.json, renderAudit(payload))
    }
    const payload = await daemonFetch(baseUrl, `/api/cortex/cto?project=${encodeURIComponent(project)}`)
    return output(payload, flags.json, renderAudit(payload))
  }

  if (action === 'plan') {
    if (!flags.goal) throw new Error('missing --goal "<objective>"')
    const { plan } = await daemonFetch(baseUrl, '/api/cortex/cto', {
      method: 'POST',
      body: { projectId: project, action: 'BUILD_DAG_PLAN', goal: String(flags.goal), triggeredBy: 'manual' },
      timeoutMs: 60_000,
    })
    if (flags.execute) {
      const dispatched = await daemonFetch(baseUrl, '/api/cortex/cto', {
        method: 'POST', body: { action: 'DISPATCH_PLAN', planId: plan.id }, timeoutMs: 120_000,
      })
      return output({ plan: dispatched.plan }, flags.json,
        `Built and dispatched DAG plan ${plan.id}.\n\n${renderDispatch(dispatched.plan)}`)
    }
    return output({ plan }, flags.json, `Built DAG plan ${plan.id}.\n\n${renderPlan(plan)}\n\nDispatch it with: cortexos cto dispatch --plan-id ${plan.id}`)
  }

  if (action === 'dispatch' || action === 'archive') {
    const planId = flags['plan-id']
    if (!planId) throw new Error(`missing --plan-id <id> (list plans via: cortexos cto audit)`)
    const { plan } = await daemonFetch(baseUrl, '/api/cortex/cto', {
      method: 'POST',
      body: { action: action === 'dispatch' ? 'DISPATCH_PLAN' : 'ARCHIVE_PLAN', planId },
      timeoutMs: 120_000,
    })
    if (action === 'dispatch') {
      return output({ plan }, flags.json, renderDispatch(plan))
    }
    return output({ plan }, flags.json, `Archived DAG plan ${String(plan.id).slice(0, 8)} — it no longer appears in the active plan list.\n\n${renderPlan(plan)}`)
  }

  throw new Error(`unknown cto subcommand "${subcommand}" (audit | plan | dispatch | archive)`)
}

async function handleHooks({ flags, subcommand }) {
  const action = (subcommand ?? 'status').toLowerCase()
  const repoDir = path.resolve(String(flags.dir ?? process.cwd()))

  if (action === 'install') {
    const project = flags.project ?? await resolveDefaultProject(repoDir)
    const baseUrl = await resolveDaemonUrl(flags['daemon-url'], repoDir)
    const result = await installHook({ repoDir, project, baseUrl })
    const human = [
      `CortexOS git hook installed (${result.mode}).`,
      `  hook    : ${result.hookPath}`,
      `  repo    : ${result.repoDir}`,
      `  project : ${project}`,
      `  daemon  : ${baseUrl}`,
      `  next    : make a commit — it lands in the project's memories, Knowledge Graph and timeline automatically.`,
    ].join('\n')
    return output(result, flags.json, human)
  }

  if (action === 'run-post-commit') {
    const project = flags.project ?? await resolveDefaultProject(repoDir)
    const baseUrl = await resolveDaemonUrl(flags['daemon-url'], repoDir)
    const result = await runPostCommit({ repoDir, project, baseUrl, sha: flags.sha ?? 'HEAD' })
    if (flags.json) return output(result, true)
    if (result.status === 'extracted') {
      const m = result.memory
      console.log(`Commit ${result.commit} extracted into "${result.project}" — ${m.decisionsCreated} decision(s), ${m.requirementsCreated} requirement(s), ${m.tasksCreated + m.tasksUpdated} task update(s), ${m.bugsCreated} bug(s) (${m.engineUsed}).`)
      console.log(`Timeline: ${result.timeline.join(', ')} · git webhook: ${result.git.ingested} ingested, ${result.git.duplicates} duplicate(s)`)
      return
    }
    console.log(`Commit ${result.commit} SPOOLED (${result.reason}) — ${result.entriesPending} entr(y/ies) pending at ${result.spoolPath}.`)
    console.log(`Replay with: cortexos hooks flush-spool --dir "${repoDir}"`)
    return
  }

  if (action === 'flush-spool') {
    const baseUrl = await resolveDaemonUrl(flags['daemon-url'], repoDir)
    const result = await flushSpool({ repoDir, baseUrl })
    if (flags.json) return output(result, true)
    console.log(`Spool flushed — ${result.flushed} replayed, ${result.skippedDuplicates} duplicate(s) skipped, ${result.dropped} dropped, ${result.remaining} remaining.`)
    if (result.corrupt > 0) console.log(`  (${result.corrupt} corrupt line(s) removed)`)
    return
  }

  throw new Error(`unknown hooks subcommand "${subcommand}" (install | run-post-commit | flush-spool)`)
}

// ---------------------------------------------------------------------------
// Help + entrypoint
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`cortexos — CortexOS unified CLI (Phase 5)

USAGE
  cortexos status  [--project <slug>] [--xml] [--json]
      Visual Command Center state: graph counts by label, token savings,
      locked symbol FQNs, top CTO recommendations; --xml appends the
      injectable <cortex_sync_packet>.

  cortexos scope   [--project <slug>] (--list | --lock <fqn...> [--exact]
                   | --unlock <fqn...> | --toggle <fqn> | --reset)
      AST Semantic Scope Lock mutations. Locked symbols are enforced by the
      daemon: staged modifications of them are rejected with 422.

  cortexos cto     [--project <slug>] (audit [--force]
                   | plan --goal "<goal>" [--execute]
                   | dispatch --plan-id <id> | archive --plan-id <id>)
      AI CTO workspace audit and Multi-Agent DAG lifecycle.

  cortexos hooks   (install [--dir <repo>] [--project <slug>]
                   | run-post-commit [--dir <repo>] [--sha <rev>]
                   | flush-spool [--dir <repo>])
      Git post-commit -> cortex_extract_memory loop. Fail-open offline
      spooling to .cortex/spool/pending-git-commits.jsonl with FIFO replay.

  cortexos init    [--root <dir>] [--slug <slug>] [--name <name>]
                   [--platform codex|hermes|...] [--daemon-url <url>]
                   [--no-wire] [--no-daemon]
      Bootstrap a repository: fingerprint stack, scan AST, write .cortex/
      (project-dna, continuity-ledger, active-scope-lock, seed-graph),
      auto-wire sentinel hook + MCP server, register with the daemon.

OPTIONS
  --project <slug>       CortexOS project (default: CORTEX_PROJECT,
                         .cortex/daemon.json, .cortex/project-dna.json,
                         or "${DEFAULT_PROJECT}")
  --daemon-url <url>     Daemon base URL (default: CORTEX_DAEMON_URL,
                         CORTEX_BASE_URL, .cortex/daemon.json, live probe
                         of 127.0.0.1:3000 / :4300)
  --json                 Machine-readable output (all subcommands)

EXAMPLES
  cortexos status --xml
  cortexos scope --lock src/lib/packet.ts#buildSyncPacket
  cortexos cto audit --force
  cortexos cto plan --goal "add Stripe billing with webhooks" --execute
  cortexos hooks install --dir . --project my-project
  cortexos hooks flush-spool --dir .`)
}

export async function runCli(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv)
  const [domain, subcommand] = positional

  if (!domain || domain === 'help' || flags.help) {
    printHelp()
    return 0
  }

  if (domain === 'status' || domain === 'state') {
    const repoDir = path.resolve(String(flags.dir ?? process.cwd()))
    const project = flags.project ?? await resolveDefaultProject(repoDir)
    const baseUrl = await resolveDaemonUrl(flags['daemon-url'], repoDir)
    await handleStatus({ project, baseUrl, flags })
    return 0
  }

  if (domain === 'scope') {
    const repoDir = path.resolve(String(flags.dir ?? process.cwd()))
    const project = flags.project ?? await resolveDefaultProject(repoDir)
    const baseUrl = await resolveDaemonUrl(flags['daemon-url'], repoDir)
    await handleScope({ project, baseUrl, flags })
    return 0
  }

  if (domain === 'cto') {
    const repoDir = path.resolve(String(flags.dir ?? process.cwd()))
    const project = flags.project ?? await resolveDefaultProject(repoDir)
    const baseUrl = await resolveDaemonUrl(flags['daemon-url'], repoDir)
    await handleCto({ project, baseUrl, flags, subcommand })
    return 0
  }

  if (domain === 'hooks') {
    await handleHooks({ flags, subcommand })
    return 0
  }

  if (domain === 'init') {
    const { runInit } = await import('./cortex-init.mjs')
    return await runInit(process.argv.slice(2))
  }

  if (domain === 'wrap') {
    let runAgentWithPtySpool
    try {
      ;({ runAgentWithPtySpool } = await import('./cortexos-pty-wrap.mjs'))
    } catch {
      try {
        ;({ runAgentWithPtySpool } = await import('../src/cli/cortexos-pty-wrap.js'))
      } catch {
        runAgentWithPtySpool = null
      }
    }
    if (!runAgentWithPtySpool) {
      console.error('cortexos wrap requires compiled src/cli/cortexos-pty-wrap.js')
      return 1
    }
    const agentName = subcommand || positional[1] || 'hermes'
    const agentArgs = positional.slice(2)
    const repoDir = path.resolve(String(flags.dir ?? process.cwd()))
    runAgentWithPtySpool(agentName as 'hermes' | 'opencode' | 'codex' | 'claude', agentArgs, repoDir)
    return 0
  }

  if (domain === 'proxy') {
    const baseUrl = await resolveDaemonUrl(flags['daemon-url'], process.cwd())
    const action = subcommand || 'status'
    const port = Number(flags.port ?? 11435)
    const body: Record<string, unknown> = { action, port }
    if (flags['upstream-url']) body.upstreamBaseUrl = flags['upstream-url']
    if (flags.project) body.projectId = flags.project
    if (flags.platform) body.platform = flags.platform
    const res = await fetch(`${baseUrl}/api/cortex/proxy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    console.log(JSON.stringify(data, null, 2))
    return res.ok ? 0 : 1
  }
}

// ---------------------------------------------------------------------------
// Direct execution (node scripts/cortexos-cli.mjs …) — bin/cortexos.mjs
// imports runCli() instead.
// ---------------------------------------------------------------------------

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  runCli(process.argv.slice(2))
    .then((code) => process.exit(code ?? 0))
    .catch((error) => {
      const detail = error instanceof DaemonHttpError
        ? `${error.message} (HTTP ${error.status})`
        : isNetworkError(error)
          ? `${error.message}\n  Is the CortexOS daemon running? Set CORTEX_DAEMON_URL or pass --daemon-url.`
          : error.message
      console.error(`cortexos: ${detail}`)
      process.exit(1)
    })
}
