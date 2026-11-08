'use client'

/**
 * Phase 4 — Cross-Platform Handoff Packet Modal
 * (blueprint PHASE_4 §1.5 + §7 `HandoffModal.tsx`).
 *
 * Generates the deterministic, copy-ready <cortex_sync_packet> XML payload
 * for the selected target platform (recorded as a real SyncHandoff through
 * the Phase 2 engine) so an active task moves between AI tools in <2s
 * without re-explaining the repository.
 */
import { useState } from 'react'
import { ArrowLeftRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cortexApi } from '@/lib/cortex-client'
import { CopyButton } from '../shared'

const PLATFORMS = [
  { value: 'codex', label: 'Codex CLI' },
  { value: 'hermes', label: 'Hermes' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'chatgpt', label: 'ChatGPT Web' },
]

export interface HandoffModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectSlug: string
  initialXml: string
  onHandoffRecorded?: () => void
}

export function HandoffModal({ open, onOpenChange, projectSlug, initialXml, onHandoffRecorded }: HandoffModalProps) {
  const [platform, setPlatform] = useState('codex')
  const [xml, setXml] = useState(initialXml)
  const [generating, setGenerating] = useState(false)
  const [lastHandoff, setLastHandoff] = useState<string | null>(null)

  async function generateForPlatform(target: string) {
    setGenerating(true)
    try {
      const { packet } = await cortexApi.syncHandoff(projectSlug, target)
      // Re-render the packet XML from the fresh handoff — the daemon is the
      // single source of truth; the modal only displays it.
      const state = await cortexApi.commandCenterState(projectSlug)
      setXml(state.syncPacketXml || initialXml)
      setLastHandoff(packet.header.syncedAtIso)
      onHandoffRecorded?.()
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="size-4 text-primary" />
            Cross-Platform &lt;cortex_sync_packet&gt; Handoff
          </DialogTitle>
          <DialogDescription>
            Paste this compact XML packet into Claude Code, Codex, Cursor or any web chat to transfer full project
            continuity — state hash, scope lock, DNA constraints and the latest continuity delta — without
            re-explaining the repo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={platform}
            onValueChange={(value) => {
              setPlatform(value)
              void generateForPlatform(value)
            }}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Target platform" />
            </SelectTrigger>
            <SelectContent>
              {PLATFORMS.map((p) => (
                <SelectItem key={p.value} value={p.value} className="text-xs">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => generateForPlatform(platform)}
            disabled={generating}
          >
            {generating ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowLeftRight className="size-3.5" />}
            Regenerate & record handoff
          </Button>
          <CopyButton text={xml} label="Copy packet XML" className="ml-auto" />
        </div>

        {lastHandoff ? (
          <p className="font-mono text-[10px] text-emerald-500">
            ✓ handoff recorded · {new Date(lastHandoff).toLocaleTimeString()} · target: {platform}
          </p>
        ) : null}

        <ScrollArea className="max-h-80 rounded-lg border border-border/60">
          <pre className="whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-emerald-600 dark:text-emerald-400">
            {xml}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
