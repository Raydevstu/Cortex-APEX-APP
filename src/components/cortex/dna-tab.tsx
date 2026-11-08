'use client'

/**
 * PROJECT DNA tab — the auditable project genome (blueprint "AI Project DNA").
 * Regenerate from a workspace scan; curate business rules manually.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useState } from 'react'
import {
  Brain, RefreshCcw, Layers, ShieldCheck, Wrench, Package, Boxes, Rocket, FileCode2, Plus, X, Pencil,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { cortexApi } from '@/lib/cortex-client'
import { EmptyState, SectionCard, formatNumber } from './shared'
import type { DnaDocument } from '@/lib/cortex/types'

type DnaWithMeta = DnaDocument & { generationSource: string; generatedAt: string }

export function DnaTab({
  projectId,
  projectRootPath,
  hasDna,
  dna,
}: {
  projectId: string
  projectRootPath: string | null
  hasDna: boolean
  dna: DnaWithMeta | null
}) {
  const queryClient = useQueryClient()
  const [scanPath, setScanPath] = useState(projectRootPath ?? '')
  const [scanOpen, setScanOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  const regenerateMutation = useMutation({
    mutationFn: (rootPath?: string) => cortexApi.regenerateDna(projectId, rootPath),
    onSuccess: (result) => {
      toast.success(
        `DNA regenerated — ${result.scan.scannedFiles} files mapped, ${result.scan.graphEdgesSynced} graph edges synced.`,
      )
      setScanOpen(false)
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      queryClient.invalidateQueries({ queryKey: ['graph', projectId] })
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
    },
    onError: (error: Error) => toast.error(`Scan failed: ${error.message}`, { duration: 7000 }),
  })

  const saveRulesMutation = useMutation({
    mutationFn: (businessRules: string[]) => cortexApi.patchDna(projectId, { businessRules }),
    onSuccess: () => {
      toast.success('Business rules updated.')
      setRulesOpen(false)
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
    onError: (error: Error) => toast.error(`Update failed: ${error.message}`),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/60 px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {dna
            ? `Generated ${new Date(dna.generatedAt).toLocaleString()} · source: ${dna.generationSource} · ${formatNumber(dna.fileStats.scannedFiles)} files / ${formatNumber(dna.fileStats.totalLines)} lines mapped`
            : 'No DNA yet — scan a workspace to compose the project genome.'}
        </p>
        <div className="flex gap-2">
          {dna ? (
            <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Pencil className="size-3.5" /> Edit rules
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Business rules</DialogTitle>
                </DialogHeader>
                <RulesEditor
                  initial={dna.businessRules}
                  pending={saveRulesMutation.isPending}
                  onSave={(rules) => saveRulesMutation.mutate(rules)}
                />
              </DialogContent>
            </Dialog>
          ) : null}
          <Dialog open={scanOpen} onOpenChange={setScanOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <RefreshCcw className="size-3.5" /> {hasDna ? 'Regenerate from workspace' : 'Generate from workspace'}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Workspace scan</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="scan-path">Absolute workspace path on this machine</Label>
                  <Input
                    id="scan-path"
                    value={scanPath}
                    onChange={(e) => setScanPath(e.target.value)}
                    placeholder="/home/you/my-app"
                    className="font-mono text-xs"
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  The daemon walks the tree (max 1,200 files, depth 7), parses manifests
                  (package.json, tsconfig, eslint/prettier, prisma schema, .env.example key names only),
                  builds the code map and composes the six DNA sections. Existing tech nodes are merged
                  into the Knowledge Graph.
                </p>
              </div>
              <DialogFooter>
                <Button
                  disabled={regenerateMutation.isPending || scanPath.trim().length === 0}
                  onClick={() => regenerateMutation.mutate(scanPath.trim() || undefined)}
                >
                  {regenerateMutation.isPending ? 'Scanning…' : 'Run scan'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!dna ? (
        <EmptyState
          icon={<Brain className="size-10" />}
          title="No PROJECT DNA yet"
          description="Scan the project workspace to extract the tech stack, coding standards, preferred libraries, design patterns and architecture philosophy. Requirement memories are folded in as business rules."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Architecture philosophy" className="lg:col-span-2">
            <p className="text-sm leading-relaxed">{dna.architecturePhilosophy}</p>
          </SectionCard>

          <SectionCard title="Tech stack — evidence-backed" className="lg:col-span-2">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Layer</th>
                    <th className="pb-2 pr-4 font-medium">Technology</th>
                    <th className="pb-2 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {dna.techStack.map((entry) => (
                    <tr key={`${entry.layer}-${entry.technology}`} className="border-b border-border/30 last:border-0">
                      <td className="py-2 pr-4 font-mono text-[11px] text-muted-foreground">{entry.layer}</td>
                      <td className="py-2 pr-4 font-medium">{entry.technology}</td>
                      <td className="py-2 font-mono text-[10.5px] text-muted-foreground">{entry.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard
            title="Coding standards"
            action={<ShieldCheck className="size-4 text-emerald-500" />}
          >
            <ul className="space-y-2">
              {dna.codingStandards.map((standard, i) => (
                <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500/70" />
                  <span>
                    {standard.rule}{' '}
                    <span className="font-mono text-[10px] text-muted-foreground">({standard.source})</span>
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="Design patterns" action={<Boxes className="size-4 text-violet-400" />}>
            <ul className="space-y-2">
              {dna.designPatterns.map((pattern, i) => (
                <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-violet-400/70" />
                  {pattern}
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="Business rules" action={<Wrench className="size-4 text-amber-500" />}>
            {dna.businessRules.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                None captured yet — log requirement memories or edit rules manually.
              </p>
            ) : (
              <ul className="space-y-2">
                {dna.businessRules.map((rule, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500/70" />
                    {rule}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Preferred libraries" action={<Package className="size-4 text-teal-400" />}>
            {dna.preferredLibraries.length === 0 ? (
              <p className="text-xs text-muted-foreground">No explicit preferences detected in the manifest.</p>
            ) : (
              <ul className="space-y-2">
                {dna.preferredLibraries.map((lib, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">{lib.purpose}</span>
                    <span className="rounded bg-teal-500/10 px-1.5 py-0.5 font-mono text-[10.5px] text-teal-500">{lib.library}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Deployment strategy" action={<Rocket className="size-4 text-rose-400" />}>
            <p className="text-xs leading-relaxed">{dna.deploymentStrategy}</p>
          </SectionCard>

          <SectionCard title="Code map (deterministic, no LLM)" action={<FileCode2 className="size-4 text-primary" />} className="lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="font-mono text-xl font-semibold">{formatNumber(dna.fileStats.scannedFiles)}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">files · {formatNumber(dna.fileStats.totalLines)} lines</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(dna.fileStats.languages)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([ext, count]) => (
                      <span key={ext} className="rounded border border-border/60 bg-background/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {ext} · {count}
                      </span>
                    ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Data model</p>
                {dna.fileStats.prismaModels.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {dna.fileStats.prismaModels.map((model) => (
                      <span key={model} className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">{model}</span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">No ORM models detected.</p>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Top modules</p>
                <ul className="mt-1.5 space-y-0.5">
                  {dna.fileStats.topDirs.slice(0, 5).map((dir) => (
                    <li key={dir.path} className="flex justify-between font-mono text-[10.5px] text-muted-foreground">
                      <span>{dir.path}</span>
                      <span>{dir.files} files</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  )
}

function RulesEditor({ initial, pending, onSave }: { initial: string[]; pending: boolean; onSave: (rules: string[]) => void }) {
  const [rules, setRules] = useState<string[]>(initial.length > 0 ? [...initial] : [''])
  return (
    <div className="space-y-3">
      {rules.map((rule, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={rule}
            onChange={(e) => setRules((current) => current.map((r, i) => (i === index ? e.target.value : r)))}
            placeholder="e.g. Users must verify their email before accessing paid features."
            className="text-xs"
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => setRules((current) => current.filter((_, i) => i !== index))}
            aria-label="Remove rule"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRules((current) => [...current, ''])}>
        <Plus className="size-3.5" /> Add rule
      </Button>
      <DialogFooter>
        <Button disabled={pending} onClick={() => onSave(rules.map((r) => r.trim()).filter(Boolean))}>
          {pending ? 'Saving…' : 'Save rules'}
        </Button>
      </DialogFooter>
    </div>
  )
}
