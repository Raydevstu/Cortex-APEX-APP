'use client'

/**
 * Project detail — DNA, Memories, Knowledge Graph, Timeline and Sync tabs.
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Brain, Database, GitBranch, ScrollText, RefreshCcw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cortexApi } from '@/lib/cortex-client'
import { timeAgo } from './shared'
import type { View } from './cortex-app'
import { DnaTab } from './dna-tab'
import { MemoriesTab } from './memories-tab'
import { GraphTab } from './graph-tab'
import { TimelineTab } from './timeline-tab'
import { SyncTab } from './sync-tab'

export function ProjectDetail({
  projectId,
  tab = 'dna',
  navigate,
}: {
  projectId: string
  tab?: 'dna' | 'memories' | 'graph' | 'timeline' | 'sync'
  navigate: (view: View) => void
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => cortexApi.project(projectId),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'projects' })} className="gap-1.5">
          <ArrowLeft className="size-4" /> Back to projects
        </Button>
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Project not found.'}
        </p>
      </div>
    )
  }

  const { project } = data

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-5 sm:p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'projects' })} className="mb-3 -ml-2 gap-1.5 text-muted-foreground">
          <ArrowLeft className="size-3.5" /> Projects
        </Button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight">{project.name}</h2>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              /{project.slug} {project.platform ? `· primary platform: ${project.platform}` : ''}
            </p>
            {project.description ? (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{project.description}</p>
            ) : null}
            {project.rootPath ? (
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">workspace: {project.rootPath}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate({ name: 'studio', projectId })}>
              <Sparkles className="size-3.5" /> Rewrite a prompt
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 sm:grid-cols-5">
          <HeaderStat icon={<Brain className="size-3.5" />} label="Memories" value={project.counts.memories} />
          <HeaderStat icon={<Database className="size-3.5" />} label="Triples" value={`${project.counts.nodes} / ${project.counts.edges}`} sub="nodes / edges" />
          <HeaderStat icon={<ScrollText className="size-3.5" />} label="Interactions" value={project.counts.interactions} />
          <HeaderStat icon={<Sparkles className="size-3.5" />} label="Rewrites" value={project.counts.promptSessions} />
          <HeaderStat
            icon={<GitBranch className="size-3.5" />}
            label="DNA"
            value={project.dna ? timeAgo(project.dna.generatedAt) : 'none'}
            sub={project.dna ? `via ${project.dna.generationSource}` : 'generate from workspace'}
          />
        </div>
      </div>

      <Tabs defaultValue={tab} className="gap-4">
        <TabsList className="h-10 w-full justify-start overflow-x-auto">
          <TabsTrigger value="dna" className="gap-1.5"><Brain className="size-3.5" /> PROJECT DNA</TabsTrigger>
          <TabsTrigger value="memories" className="gap-1.5"><ScrollText className="size-3.5" /> Memories</TabsTrigger>
          <TabsTrigger value="graph" className="gap-1.5"><GitBranch className="size-3.5" /> Knowledge Graph</TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5"><RefreshCcw className="size-3.5" /> Timeline</TabsTrigger>
          <TabsTrigger value="sync" className="gap-1.5"><Database className="size-3.5" /> Sync packet</TabsTrigger>
        </TabsList>
        <TabsContent value="dna">
          <DnaTab projectId={projectId} projectRootPath={project.rootPath} hasDna={Boolean(project.dna)} dna={project.dna} />
        </TabsContent>
        <TabsContent value="memories">
          <MemoriesTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="graph">
          <GraphTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="sync">
          <SyncTab slug={project.slug} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function HeaderStat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg bg-background/50 p-3">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-1 truncate font-mono text-sm font-semibold">{value}</p>
      {sub ? <p className="truncate text-[10px] text-muted-foreground">{sub}</p> : null}
    </div>
  )
}
