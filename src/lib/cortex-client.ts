/**
 * Client-side typed fetch client for the Cortex Daemon API.
 * All requests use relative paths (gateway-safe).
 */
import type {
  CrossPlatformSyncPacket,
  DaemonHealth,
  DaemonSettings,
  DashboardMetrics,
  DnaDocument,
  EngineKind,
  EpisodicSearchResponse,
  GitCommitRecord,
  OllamaStatus,
  ProjectSummary,
  RewriteResult,
  StatePacket,
  SyncHandoffRecord,
  WatcherStatus,
} from '@/lib/cortex/types'

export interface MemoryRecord {
  id: string
  projectId: string
  type: string
  key: string
  value: string
  status: string
  importance: number
  source: string
  createdAt: string
  updatedAt: string
}

export interface InteractionRecord {
  id: string
  projectId: string
  title: string | null
  platform: string | null
  rawText: string
  memoriesExtracted: number
  createdAt: string
}

export interface PromptSessionRecord {
  id: string
  rawPrompt: string
  rewrittenPrompt: string
  engine: string
  intent: string
  complexity: number
  tokensRaw: number
  tokensStructured: number
  tokensContextAvoided: number
  durationMs: number
  createdAt: string
}

export interface ProjectDetail {
  project: {
    id: string
    slug: string
    name: string
    description: string | null
    rootPath: string | null
    platform: string | null
    createdAt: string
    updatedAt: string
    counts: {
      memories: number
      nodes: number
      edges: number
      promptSessions: number
      interactions: number
    }
    dna: (DnaDocument & { generationSource: string; generatedAt: string }) | null
  }
}

export interface GraphData {
  nodes: Array<{
    id: string
    kind: string
    label: string
    props: Record<string, unknown>
  }>
  edges: Array<{
    id: string
    sourceId: string
    targetId: string
    relation: string
    weight: number
  }>
}

export interface TimelineEventRecord {
  id: string
  kind: string
  message: string
  meta: string | null
  createdAt: string
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/cortex${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Daemon request failed (${response.status})`
    throw new Error(message)
  }
  return body as T
}

// Typed endpoint wrappers ----------------------------------------------------

export const cortexApi = {
  health: () => api<DaemonHealth>('/health'),
  metrics: () => api<DashboardMetrics>('/metrics'),
  projects: () => api<{ projects: ProjectSummary[] }>('/projects'),
  project: (id: string) => api<ProjectDetail>(`/projects/${id}`),
  createProject: (input: { name: string; description?: string; rootPath?: string; platform?: string }) =>
    api<{ id: string; slug: string; name: string }>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  deleteProject: (id: string) => api<{ deleted: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
  regenerateDna: (id: string, rootPath?: string) =>
    api<{ dna: DnaDocument & { generatedAt: string }; scan: { scannedFiles: number; totalLines: number; graphEdgesSynced: number } }>(
      `/projects/${id}/dna`,
      { method: 'POST', body: JSON.stringify({ mode: 'scan', ...(rootPath ? { rootPath } : {}) }) },
    ),
  patchDna: (id: string, patch: { businessRules?: string[]; designPatterns?: string[]; deploymentStrategy?: string }) =>
    api<{ updated: boolean }>(`/projects/${id}/dna`, { method: 'PATCH', body: JSON.stringify(patch) }),
  memories: (projectId: string, params?: { type?: string; status?: string; q?: string }) => {
    const search = new URLSearchParams({ projectId })
    if (params?.type) search.set('type', params.type)
    if (params?.status) search.set('status', params.status)
    if (params?.q) search.set('q', params.q)
    return api<{ memories: MemoryRecord[] }>(`/memories?${search.toString()}`)
  },
  createMemory: (input: { projectId: string; type: string; key: string; value: string; importance?: number }) =>
    api<{ memory: MemoryRecord }>('/memories', { method: 'POST', body: JSON.stringify(input) }),
  updateMemory: (id: string, patch: { status?: string; importance?: number }) =>
    api<{ memory: MemoryRecord }>(`/memories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteMemory: (id: string) => api<{ deleted: boolean }>(`/memories/${id}`, { method: 'DELETE' }),
  interactions: (projectId: string) =>
    api<{ interactions: InteractionRecord[] }>(`/interactions?projectId=${projectId}`),
  captureInteraction: (input: { projectId: string; text: string; title?: string; platform?: string }) =>
    api<{
      interactionId: string
      extracted: Array<{ type: string; key: string; value: string; importance: number; deduped: boolean }>
      techLinked: string[]
    }>('/interactions', { method: 'POST', body: JSON.stringify(input) }),
  graph: (projectId: string) => api<GraphData>(`/graph?projectId=${projectId}`),
  addGraphNode: (projectId: string, kind: string, label: string) =>
    api<{ nodeId: string }>('/graph', { method: 'POST', body: JSON.stringify({ op: 'add_node', projectId, kind, label }) }),
  addGraphEdge: (projectId: string, sourceLabel: string, relation: string, targetLabel: string) =>
    api<{ edge: string }>('/graph', { method: 'POST', body: JSON.stringify({ op: 'add_edge', projectId, sourceLabel, relation, targetLabel }) }),
  deleteGraphNode: (projectId: string, nodeId: string) =>
    api<{ deleted: boolean }>(`/graph?projectId=${projectId}&nodeId=${nodeId}`, { method: 'DELETE' }),
  rewrite: (projectId: string, prompt: string, engine: EngineKind) =>
    api<RewriteResult>('/rewrite', { method: 'POST', body: JSON.stringify({ projectId, prompt, engine }) }),
  rewriteHistory: (projectId: string) =>
    api<{ sessions: PromptSessionRecord[] }>(`/rewrite?projectId=${projectId}`),
  statePacket: (slug: string) => api<StatePacket>(`/sync/${slug}`),
  syncHandoff: (slug: string, targetPlatform: string, module?: string) =>
    api<{ handoffId: string; packet: CrossPlatformSyncPacket }>(`/sync/${slug}`, {
      method: 'POST',
      body: JSON.stringify({ targetPlatform, ...(module ? { module } : {}) }),
    }),
  handoffs: (slug: string) => api<{ handoffs: SyncHandoffRecord[] }>(`/sync/${slug}/handoffs`),
  watchStatus: (projectId?: string) =>
    api<{ watchers: WatcherStatus[] }>(`/watch${projectId ? `?projectId=${projectId}` : ''}`),
  watchAction: (projectId: string, action: 'start' | 'stop', persist = true) =>
    api<{ started?: boolean; stopped?: boolean; reason?: string; status?: WatcherStatus }>('/watch', {
      method: 'POST',
      body: JSON.stringify({ projectId, action, persist }),
    }),
  gitCommits: (projectId: string) => api<{ commits: GitCommitRecord[] }>(`/git?projectId=${projectId}`),
  gitIngest: (projectId: string) =>
    api<{ ingested: number; duplicates: number; filesTouched: number; note?: string }>('/git/ingest', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  episodicSearch: (input: { projectId?: string; slug?: string; query: string; k?: number }) =>
    api<EpisodicSearchResponse>('/search', { method: 'POST', body: JSON.stringify(input) }),
  settings: () => api<{ settings: DaemonSettings }>('/settings'),
  saveSettings: (patch: Partial<DaemonSettings>) =>
    api<{ settings: DaemonSettings }>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  testOllama: (baseUrl?: string) =>
    api<{ status: OllamaStatus }>('/settings/test', { method: 'POST', body: JSON.stringify(baseUrl ? { ollamaBaseUrl: baseUrl } : {}) }),
  timeline: (projectId: string) =>
    api<{ events: TimelineEventRecord[] }>(`/projects/${id2path(projectId)}/timeline`),
  seed: () => api<{ seeded: boolean; message: string }>('/seed', { method: 'POST' }),
}

// The timeline is served from the project detail; kept simple here.
function id2path(id: string): string {
  return encodeURIComponent(id)
}

// Timeline loader (dedicated small fetch to keep the wrapper table clean).
export function fetchTimeline(projectId: string): Promise<{ events: TimelineEventRecord[] }> {
  return api(`/projects/${encodeURIComponent(projectId)}/timeline`)
}
