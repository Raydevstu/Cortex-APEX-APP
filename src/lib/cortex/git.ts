/**
 * Git Intelligence — Phase 2 (blueprint §6: "file watcher + Git hook …").
 *
 * Two ingestion paths feed the same pipeline:
 *   1. post-commit hook → POST /api/cortex/hooks/git (real-time, per commit)
 *   2. `git log` backfill → POST /api/cortex/git/ingest (real subprocess,
 *      watermarked by Project.gitLastIngestAt)
 *
 * Every ingested commit: GitCommit record (deduped by hash), immutable
 * timeline event, file-node refresh in the Knowledge Graph with a
 * `lastModifiedBy` platform hint, and deterministic bug auto-resolution —
 * a "fix(es) … <bug keywords|#id>" commit resolves the matching open bug
 * memory and flips its graph node to resolved.
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { db } from '@/lib/db'
import { upsertNode, upsertEdge } from './graph'

const exec = promisify(execFile)

export interface GitCommitInput {
  hash: string
  message: string
  author?: string
  timestamp?: string
  files: Array<{ path: string; status: string }>
  platform?: string
}

export interface IngestResult {
  ingested: number
  duplicates: number
  bugsResolved: Array<{ memoryId: string; key: string; commit: string }>
  filesTouched: number
}

// ---------------------------------------------------------------------------
// git log parsing (real subprocess)
// ---------------------------------------------------------------------------

export async function parseGitLog(
  rootPath: string,
  since?: Date,
  maxCommits = 200,
): Promise<GitCommitInput[]> {
  const args = [
    'log',
    `--pretty=format:%H\x1f%an\x1f%aI\x1f%s\x1e`,
    '--name-status',
    '--no-merges',
    `-n`, `${maxCommits}`,
  ]
  if (since) args.push(`--since=${since.toISOString()}`)

  const { stdout } = await exec('git', ['-C', rootPath, ...args], { maxBuffer: 8 * 1024 * 1024 })
  return parseGitLogOutput(stdout)
}

export function parseGitLogOutput(stdout: string): GitCommitInput[] {
  // Output shape (with %x1e as the record separator, newest first):
  //   H2…subject \x1e \n A\tb.ts \n \n H1…subject \x1e \n A\ta.ts \n
  // So every \x1e-delimited chunk AFTER the first carries the previous
  // commit's file lines followed by the next commit's header — parse the
  // header from the chunk's LAST line and attribute the preceding lines to
  // the commit before it.
  const commits: GitCommitInput[] = []
  let current: GitCommitInput | null = null

  for (const chunk of stdout.split('\x1e')) {
    const lines = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (lines.length === 0) continue

    const lastLine = lines[lines.length - 1]
    // Header fields are %x1f-separated: hash \x1f author \x1f date \x1f subject
    const parts = lastLine.split('\x1f')
    const isHeader = parts.length >= 4 && /^[0-9a-f]{7,40}$/i.test(parts[0])

    if (!isHeader) {
      // Final chunk: file lines belonging to the oldest commit.
      if (current) current.files.push(...parseFileLines(lines))
      continue
    }

    // Lines before the header are the previous commit's files.
    if (current) current.files.push(...parseFileLines(lines.slice(0, -1)))
    current = {
      hash: parts[0],
      message: parts.slice(3).join('\t'),
      author: parts[1] || undefined,
      timestamp: parts[2] || undefined,
      files: [],
    }
    if (current.message.length > 0) commits.push(current)
    else current = commits[commits.length - 1] ?? null
  }
  return commits
}

function parseFileLines(lines: string[]): Array<{ path: string; status: string }> {
  const files: Array<{ path: string; status: string }> = []
  for (const line of lines) {
    const parts = line.split('\t')
    if (parts.length < 2) continue
    // R100/C075-style statuses collapse to their letter; renames keep both
    // paths ("R\told\tnew") — path joins back with a tab.
    files.push({
      status: parts[0].trim().charAt(0),
      path: parts.slice(1).join('\t').trim(),
    })
  }
  return files
}

// ---------------------------------------------------------------------------
// Shared ingestion pipeline
// ---------------------------------------------------------------------------

export async function ingestCommits(
  projectId: string,
  commits: GitCommitInput[],
  source: 'webhook' | 'git',
): Promise<IngestResult> {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) throw new Error('Project not found')

  const result: IngestResult = { ingested: 0, duplicates: 0, bugsResolved: [], filesTouched: 0 }

  // Oldest first so watermark logic sees the latest commit last.
  const ordered = [...commits].sort((a, b) => {
    const ta = Date.parse(a.timestamp ?? '') || 0
    const tb = Date.parse(b.timestamp ?? '') || 0
    return ta - tb
  })

  for (const commit of ordered) {
    const existing = await db.gitCommit.findUnique({
      where: { projectId_hash: { projectId, hash: commit.hash } },
    })
    if (existing) {
      result.duplicates += 1
      continue
    }

    const committedAt = commit.timestamp ? safeDate(commit.timestamp) : new Date()
    await db.gitCommit.create({
      data: {
        projectId,
        hash: commit.hash,
        message: commit.message.slice(0, 2_000),
        author: commit.author?.slice(0, 200) ?? null,
        platform: commit.platform ?? null,
        filesCount: commit.files.length,
        files: JSON.stringify(commit.files.slice(0, 100)),
        committedAt,
      },
    })
    result.ingested += 1
    result.filesTouched += commit.files.length

    // Knowledge Graph: refresh file nodes touched by this commit.
    for (const file of commit.files.slice(0, 50)) {
      if (file.status === 'D') continue
      await upsertGitFileNode(projectId, project.name, file.path, {
        lastModifiedBy: commit.platform ?? 'git',
        gitHash: commit.hash.slice(0, 10),
      })
    }

    // Deterministic bug auto-resolution: fix commits close matching bugs.
    const resolved = await resolveBugsFromCommit(projectId, commit)
    result.bugsResolved.push(...resolved)

    await db.timelineEvent.create({
      data: {
        projectId,
        kind: 'git.commit',
        message: `Commit ingested (${source}): ${commit.hash.slice(0, 8)} — ${shorten(commit.message.split('\n')[0], 90)}${commit.files.length > 0 ? ` · ${commit.files.length} file(s)` : ''}${resolved.length > 0 ? ` · resolved ${resolved.length} bug(s)` : ''}`,
        meta: JSON.stringify({
          hash: commit.hash,
          module: commit.files[0] ? await moduleForPath(projectId, commit.files[0].path) : undefined,
          platform: commit.platform ?? undefined,
        }),
      },
    })

    // Advance the git watermark (ingest path relies on it; webhook keeps it fresh too).
    await db.project.update({
      where: { id: projectId },
      data: { gitLastIngestAt: committedAt },
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

async function upsertGitFileNode(
  projectId: string,
  projectName: string,
  relativePath: string,
  props: { lastModifiedBy: string; gitHash: string },
): Promise<void> {
  const rootId = await upsertNode(projectId, 'root', projectName, { role: 'project-root' })
  const moduleLabel = await moduleForPath(projectId, relativePath)
  const moduleId = await upsertNode(projectId, 'module', moduleLabel, { source: 'git' })
  await upsertEdge(projectId, rootId, moduleId, 'CONTAINS')
  const fileId = await upsertNode(projectId, 'file', relativePath, props)
  await upsertEdge(projectId, moduleId, fileId, 'CONTAINS')
}

async function moduleForPath(projectId: string, relativePath: string): Promise<string> {
  const modules = await db.graphNode.findMany({ where: { projectId, kind: 'module' } })
  let best: { label: string; dir: string } | null = null
  for (const mod of modules) {
    let dir: unknown = null
    try {
      dir = (JSON.parse(mod.props) as Record<string, unknown>).dir
    } catch {
      dir = null
    }
    if (typeof dir === 'string' && dir.length > 0 && relativePath.startsWith(dir)) {
      if (!best || dir.length > best.dir.length) best = { label: mod.label, dir }
    }
  }
  if (best) return best.label
  const topDir = relativePath.split('/')[0]
  if (!topDir || topDir === relativePath) return 'Root'
  return topDir.charAt(0).toUpperCase() + topDir.slice(1)
}

// ---------------------------------------------------------------------------
// Deterministic bug auto-resolution
// ---------------------------------------------------------------------------

const FIX_PATTERN = /^(fix|fixes|fixed|bugfix|resolve|resolves|resolved|close|closes|closed)\b/i

async function resolveBugsFromCommit(
  projectId: string,
  commit: GitCommitInput,
): Promise<Array<{ memoryId: string; key: string; commit: string }>> {
  const subject = commit.message.split('\n')[0]
  if (!FIX_PATTERN.test(subject)) return []

  // Explicit "#14" style references win.
  const idRefs = [...subject.matchAll(/#(\d{1,5})/g)].map((m) => m[1])
  // Otherwise extract candidate keywords from the fix subject.
  const keywords = subject
    .replace(FIX_PATTERN, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !GIT_STOPWORDS.has(w))
    .slice(0, 6)

  const openBugs = await db.memory.findMany({
    where: { projectId, type: 'bug', status: 'active' },
  })

  const resolved: Array<{ memoryId: string; key: string; commit: string }> = []
  for (const bug of openBugs) {
    const haystack = `${bug.key} ${bug.value}`.toLowerCase()
    let matched = false
    if (idRefs.length > 0) {
      matched = idRefs.some((ref) => haystack.includes(`#${ref}`))
    }
    if (!matched && keywords.length >= 2) {
      const hits = keywords.filter((k) => haystack.includes(k)).length
      matched = hits >= Math.min(2, keywords.length)
    }
    if (!matched) continue

    await db.memory.update({ where: { id: bug.id }, data: { status: 'resolved' } })
    await flipGraphBugNode(projectId, bug)
    await db.timelineEvent.create({
      data: {
        projectId,
        kind: 'memory.resolved',
        message: `Bug auto-resolved by commit ${commit.hash.slice(0, 8)}: "${bug.key}" — status active → resolved.`,
        meta: JSON.stringify({ memoryId: bug.id, commit: commit.hash }),
      },
    })
    resolved.push({ memoryId: bug.id, key: bug.key, commit: commit.hash.slice(0, 8) })
  }
  return resolved
}

async function flipGraphBugNode(projectId: string, bug: { key: string }): Promise<void> {
  const candidates = await db.graphNode.findMany({ where: { projectId, kind: 'bug' } })
  for (const node of candidates) {
    const labelMatch =
      node.label.toLowerCase().includes(bug.key.toLowerCase().slice(0, 30)) ||
      bug.key.toLowerCase().includes(node.label.replace(/^bug:\s*/i, '').toLowerCase().slice(0, 30))
    if (!labelMatch) continue
    let props: Record<string, unknown> = {}
    try {
      props = JSON.parse(node.props) as Record<string, unknown>
    } catch {
      props = {}
    }
    await db.graphNode.update({
      where: { id: node.id },
      data: { props: JSON.stringify({ ...props, status: 'resolved' }) },
    })
  }
}

// ---------------------------------------------------------------------------

export async function assertGitRepo(rootPath: string): Promise<void> {
  const gitDir = path.join(rootPath, '.git')
  try {
    const stat = await fs.stat(gitDir)
    if (!stat.isDirectory() && !stat.isFile()) throw new Error('not a repo')
  } catch {
    throw new Error(`rootPath is not a git repository: ${rootPath}`)
  }
}

function safeDate(value: string): Date {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`
}

const GIT_STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'into', 'when', 'what', 'issue', 'error',
  'there', 'here', 'some', 'have', 'been', 'also', 'more', 'less', 'than',
])
