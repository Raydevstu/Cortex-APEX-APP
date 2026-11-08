'use client'

/**
 * Memories tab — the Universal AI Memory Engine surface: capture raw chat
 * transcripts (from Codex/Hermes/any platform), watch typed memories get
 * extracted, and curate the memory store.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useState } from 'react'
import {
  ScrollText, Plus, Trash2, CheckCircle2, RotateCcw, Search, MessageSquarePlus, Sparkles, Link2,
} from 'lucide-react'
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
import { cortexApi, type InteractionRecord } from '@/lib/cortex-client'
import { EmptyState, ImportanceStars, TypeBadge, timeAgo } from './shared'
import { cn } from '@/lib/utils'

const TYPE_FILTERS = ['all', 'decision', 'architecture', 'requirement', 'todo', 'bug', 'preference'] as const

export function MemoriesTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [captureOpen, setCaptureOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['memories', projectId, typeFilter, search],
    queryFn: () =>
      cortexApi.memories(projectId, {
        type: typeFilter === 'all' ? undefined : typeFilter,
        q: search.trim() || undefined,
      }),
  })

  const { data: interactionsData } = useQuery({
    queryKey: ['interactions', projectId],
    queryFn: () => cortexApi.interactions(projectId),
  })

  const captureMutation = useMutation({
    mutationFn: cortexApi.captureInteraction,
    onSuccess: (result) => {
      const fresh = result.extracted.filter((m) => !m.deduped)
      toast.success(
        `${fresh.length} new memor${fresh.length === 1 ? 'y' : 'ies'} extracted${
          result.techLinked.length > 0 ? ` · tech linked: ${result.techLinked.join(', ')}` : ''
        }`,
        { description: fresh.slice(0, 3).map((m) => `[${m.type}] ${m.key}`).join('\n') || 'Everything was already known.' },
      )
      setCaptureOpen(false)
      queryClient.invalidateQueries({ queryKey: ['memories', projectId] })
      queryClient.invalidateQueries({ queryKey: ['interactions', projectId] })
      queryClient.invalidateQueries({ queryKey: ['graph', projectId] })
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
    },
    onError: (error: Error) => toast.error(`Capture failed: ${error.message}`),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { status?: string } }) => cortexApi.updateMemory(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memories', projectId] })
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
    },
    onError: (error: Error) => toast.error(`Update failed: ${error.message}`),
  })

  const deleteMutation = useMutation({
    mutationFn: cortexApi.deleteMemory,
    onSuccess: () => {
      toast.success('Memory deleted.')
      queryClient.invalidateQueries({ queryKey: ['memories', projectId] })
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
    },
    onError: (error: Error) => toast.error(`Delete failed: ${error.message}`),
  })

  const memories = data?.memories ?? []
  const interactions = interactionsData?.interactions ?? []

  return (
    <div className="space-y-4">
      {/* Capture + manual add */}
      <div className="flex flex-wrap items-center gap-2">
        <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <MessageSquarePlus className="size-3.5" /> Capture interaction
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Capture an interaction</DialogTitle>
              <DialogDescription>
                Paste a raw chat transcript from any platform. The deterministic memory engine extracts
                decisions, requirements, TODOs, bugs and preferences — zero LLM tokens — and links any
                mentioned tech into the Knowledge Graph.
              </DialogDescription>
            </DialogHeader>
            <CaptureForm
              pending={captureMutation.isPending}
              onSubmit={(input) => captureMutation.mutate({ projectId, ...input })}
            />
          </DialogContent>
        </Dialog>

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="size-3.5" /> Log memory
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Log a memory manually</DialogTitle>
              <DialogDescription>Write a typed memory directly into the project brain.</DialogDescription>
            </DialogHeader>
            <AddMemoryForm
              pending={false}
              onSubmit={async (input) => {
                try {
                  await cortexApi.createMemory({ projectId, ...input })
                  toast.success('Memory logged.')
                  setAddOpen(false)
                  queryClient.invalidateQueries({ queryKey: ['memories', projectId] })
                  queryClient.invalidateQueries({ queryKey: ['metrics'] })
                } catch (error) {
                  toast.error(`Failed: ${error instanceof Error ? error.message : 'unknown'}`)
                }
              }}
            />
          </DialogContent>
        </Dialog>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search memory…"
              className="h-8 w-44 pl-8 text-xs"
              aria-label="Search memories"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 w-36 text-xs" aria-label="Filter by type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_FILTERS.map((type) => (
                <SelectItem key={type} value={type} className="text-xs capitalize">
                  {type === 'all' ? 'All types' : type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Memory list */}
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-lg" />
              ))}
            </div>
          ) : memories.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="size-10" />}
              title="No memories match"
              description="Capture an interaction from Codex or Hermes, or log a memory manually. The memory engine fills this store automatically."
            />
          ) : (
            <ul className="space-y-2">
              {memories.map((memory) => (
                <li
                  key={memory.id}
                  className={cn(
                    'rounded-lg border border-border/60 bg-card/60 p-3.5 transition-colors',
                    memory.status === 'resolved' && 'opacity-55',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <TypeBadge type={memory.type} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{memory.key}</span>
                    <ImportanceStars value={memory.importance} />
                    <span className="font-mono text-[10px] text-muted-foreground">{timeAgo(memory.createdAt)}</span>
                  </div>
                  <p className={cn('mt-1.5 text-xs leading-relaxed text-muted-foreground', memory.status === 'resolved' && 'line-through')}>
                    {memory.value}
                  </p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
                      via {memory.source}
                    </span>
                    {memory.status === 'active' && (memory.type === 'todo' || memory.type === 'bug') ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-2 text-[11px] text-emerald-500 hover:text-emerald-400"
                        onClick={() => updateMutation.mutate({ id: memory.id, patch: { status: 'resolved' } })}
                      >
                        <CheckCircle2 className="size-3" /> Resolve
                      </Button>
                    ) : memory.status === 'resolved' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-2 text-[11px]"
                        onClick={() => updateMutation.mutate({ id: memory.id, patch: { status: 'active' } })}
                      >
                        <RotateCcw className="size-3" /> Reopen
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate(memory.id)}
                      aria-label={`Delete memory ${memory.key}`}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Interaction log */}
        <div className="rounded-xl border border-border/60 bg-card/60">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <Sparkles className="size-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Captured interactions</h3>
          </div>
          <div className="max-h-96 overflow-y-auto p-3">
            {interactions.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                No raw interactions logged yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {interactions.map((interaction) => (
                  <li key={interaction.id} className="rounded-lg border border-border/50 bg-background/40 p-3">
                    <div className="flex items-center gap-2">
                      {interaction.platform ? (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase text-primary">
                          {interaction.platform}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {interaction.title ?? 'Untitled interaction'}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {timeAgo(interaction.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 font-mono text-[10.5px] leading-snug text-muted-foreground">
                      {interaction.rawText}
                    </p>
                    <p className="mt-1.5 flex items-center gap-1 font-mono text-[9.5px] text-emerald-500">
                      <Link2 className="size-3" /> {interaction.memoriesExtracted} memories extracted
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CaptureForm({
  pending,
  onSubmit,
}: {
  pending: boolean
  onSubmit: (input: { text: string; title?: string; platform?: string }) => void
}) {
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState('codex')

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (text.trim().length < 5) return
        onSubmit({ text: text.trim(), title: title.trim() || undefined, platform })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="space-y-1.5">
          <Label htmlFor="capture-title">Title (optional)</Label>
          <Input id="capture-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Billing session on Hermes" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="capture-platform">Platform</Label>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger id="capture-platform">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['codex', 'hermes', 'opencode', 'claude', 'cursor', 'windsurf', 'web', 'other'].map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="capture-text">Raw transcript</Label>
        <Textarea
          id="capture-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'e.g. We decided to use Typesense for search. Users must see results in under 200ms. There is a bug where the deals list crashes when sorting. We still need to add rate limiting.'}
          className="min-h-40 resize-y font-mono text-xs leading-relaxed"
        />
        <p className="text-[11px] text-muted-foreground">
          Tip: paste exactly what you and the AI said — decisions, TODOs and bugs are recognised by pattern.
        </p>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending || text.trim().length < 5}>
          {pending ? 'Extracting…' : 'Run memory engine'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function AddMemoryForm({
  pending,
  onSubmit,
}: {
  pending: boolean
  onSubmit: (input: { type: string; key: string; value: string; importance?: number }) => void
}) {
  const [type, setType] = useState('decision')
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [importance, setImportance] = useState('3')

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!key.trim() || value.trim().length < 3) return
        onSubmit({ type, key: key.trim(), value: value.trim(), importance: Number(importance) })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="memory-type">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="memory-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['decision', 'architecture', 'requirement', 'todo', 'bug', 'preference'].map((t) => (
                <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="memory-importance">Importance (1–5)</Label>
          <Select value={importance} onValueChange={setImportance}>
            <SelectTrigger id="memory-importance">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="memory-key">Key</Label>
        <Input id="memory-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="database" className="font-mono text-xs" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="memory-value">Value</Label>
        <Textarea id="memory-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder="PostgreSQL chosen as the primary datastore." className="min-h-20 resize-y text-xs" />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending || !key.trim() || value.trim().length < 3}>
          Log memory
        </Button>
      </DialogFooter>
    </form>
  )
}

export type { InteractionRecord }
