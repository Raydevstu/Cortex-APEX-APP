'use client'

/**
 * Projects — list of project brains + creation dialog.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useState } from 'react'
import { Plus, FolderKanban, Brain, GitBranch, Coins, Trash2, ArrowRight, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cortexApi } from '@/lib/cortex-client'
import { EmptyState, formatNumber, timeAgo } from './shared'
import type { View } from './cortex-app'

const PLATFORMS = ['codex', 'hermes', 'opencode', 'claude', 'cursor', 'windsurf', 'web', 'other'] as const

export function ProjectsView({ navigate }: { navigate: (view: View) => void }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['projects'], queryFn: cortexApi.projects })
  const [open, setOpen] = useState(false)

  const createMutation = useMutation({
    mutationFn: cortexApi.createProject,
    onSuccess: (project) => {
      toast.success(`Project "${project.name}" created — generate its DNA next.`)
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
      navigate({ name: 'project', projectId: project.id, tab: 'dna' })
    },
    onError: (error: Error) => toast.error(`Create failed: ${error.message}`),
  })

  const deleteMutation = useMutation({
    mutationFn: cortexApi.deleteProject,
    onSuccess: () => {
      toast.success('Project deleted with all memories, graph state and history.')
      queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast.error(`Delete failed: ${error.message}`),
  })

  const seedMutation = useMutation({
    mutationFn: cortexApi.seed,
    onSuccess: (result) => {
      toast.success(result.message)
      queryClient.invalidateQueries()
    },
    onError: (error: Error) => toast.error(`Seed failed: ${error.message}`),
  })

  const projects = data?.projects ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Project brains</h2>
          <p className="text-sm text-muted-foreground">
            Each project carries its own DNA, Knowledge Graph, memory and timeline.
          </p>
        </div>
        <div className="flex gap-2">
          {projects.length === 0 ? (
            <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              <FlaskConical className="size-4" /> Seed demo
            </Button>
          ) : null}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="size-4" /> New project
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>New project brain</DialogTitle>
                <DialogDescription>
                  Register the project, then generate its PROJECT DNA from a workspace path on this machine.
                </DialogDescription>
              </DialogHeader>
              <CreateProjectForm onSubmit={(input) => createMutation.mutate(input)} pending={createMutation.isPending} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="size-10" />}
          title="No project brains yet"
          description="Create your first project and point the daemon at a local workspace path — the scanner will map the codebase, compose the PROJECT DNA and seed the Knowledge Graph automatically."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="group flex flex-col rounded-xl border border-border/60 bg-card/60 p-5 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  className="min-w-0 text-left"
                  onClick={() => navigate({ name: 'project', projectId: project.id })}
                >
                  <h3 className="truncate text-base font-semibold tracking-tight group-hover:text-primary">
                    {project.name}
                  </h3>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    /{project.slug} {project.platform ? `· ${project.platform}` : ''}
                  </p>
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7 opacity-0 transition-opacity group-hover:opacity-100" aria-label={`Delete ${project.name}`}>
                      <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes the project with all memories, Knowledge Graph triples, DNA,
                        prompt history and timeline events. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => deleteMutation.mutate(project.id)}
                      >
                        Delete permanently
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <p className="mt-2 line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">
                {project.description ?? 'No description set.'}
              </p>

              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-4 text-center">
                <div>
                  <p className="flex items-center justify-center gap-1 font-mono text-sm font-semibold">
                    <Brain className="size-3 text-primary/70" /> {project.counts.memories}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">memories</p>
                </div>
                <div>
                  <p className="flex items-center justify-center gap-1 font-mono text-sm font-semibold">
                    <GitBranch className="size-3 text-primary/70" /> {project.counts.nodes}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">nodes</p>
                </div>
                <div>
                  <p className="flex items-center justify-center gap-1 font-mono text-sm font-semibold">
                    <Coins className="size-3 text-primary/70" /> {formatNumber(project.counts.promptSessions)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">rewrites</p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {project.counts.openItems > 0 ? (
                    <span className="text-amber-500">{project.counts.openItems} open items</span>
                  ) : (
                    'no open items'
                  )}
                  {' · '}
                  {project.dnaGeneratedAt ? `DNA ${timeAgo(project.dnaGeneratedAt)}` : 'no DNA yet'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => navigate({ name: 'project', projectId: project.id })}
                >
                  Open <ArrowRight className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateProjectForm({ onSubmit, pending }: { onSubmit: (input: { name: string; description?: string; rootPath?: string; platform?: string }) => void; pending: boolean }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [platform, setPlatform] = useState<string>('codex')

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim().length < 2) return
        onSubmit({
          name: name.trim(),
          description: description.trim() || undefined,
          rootPath: rootPath.trim() || undefined,
          platform,
        })
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="new-project-name">Project name</Label>
        <Input id="new-project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="SaaS-CRM" required minLength={2} maxLength={80} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-project-desc">Description</Label>
        <Textarea id="new-project-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this product? One or two sentences." className="min-h-16 resize-y" maxLength={500} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-project-path">Workspace path</Label>
          <Input
            id="new-project-path"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder="/home/you/my-app"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-project-platform">Primary platform</Label>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger id="new-project-platform">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORMS.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The workspace path is scanned server-side by the daemon (node_modules, .git and build output are
        ignored). Leave empty to add it later from the DNA tab.
      </p>
      <DialogFooter>
        <Button type="submit" disabled={pending || name.trim().length < 2}>
          {pending ? 'Creating…' : 'Create project brain'}
        </Button>
      </DialogFooter>
    </form>
  )
}
