'use client'

/**
 * CortexOS Command Center — single-page application shell.
 * View routing is client-side (sandbox exposes only "/").
 */
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useState, useCallback, useMemo } from 'react'
import { useTheme } from 'next-themes'
import {
  BrainCircuit, LayoutDashboard, Sparkles, FolderKanban, Settings, BookOpen,
  Moon, Sun, Menu, X, Github, Zap, ShieldCheck, Gauge,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cortexApi } from '@/lib/cortex-client'
import { StatusPill } from './shared'
import { CommandCenterView } from './command-center/command-center-view'
import { DashboardView } from './dashboard-view'
import { StudioView } from './studio-view'
import { ProjectsView } from './projects-view'
import { ProjectDetail } from './project-detail'
import { SettingsView } from './settings-view'
import { DocsView } from './docs-view'
import { cn } from '@/lib/utils'

export type View =
  | { name: 'command-center' }
  | { name: 'dashboard' }
  | { name: 'studio'; projectId?: string; prompt?: string }
  | { name: 'projects' }
  | { name: 'project'; projectId: string; tab?: 'dna' | 'memories' | 'graph' | 'timeline' | 'sync' | 'watch' | 'history' }
  | { name: 'settings' }
  | { name: 'docs' }

export interface CortexAppProps {
  initialProjectId?: string
}

export function CortexApp({ initialProjectId }: CortexAppProps) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  )
  const [view, setView] = useState<View>({ name: 'command-center' })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const navigate = useCallback((next: View) => {
    setView(next)
    setMobileNavOpen(false)
  }, [])

  return (
    <QueryClientProvider client={client}>
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <div className="flex flex-1">
          {/* ---- Sidebar (desktop) ---- */}
          <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border/60 bg-sidebar lg:flex">
            <SidebarContent view={view} navigate={navigate} />
          </aside>

          {/* ---- Sidebar (mobile drawer) ---- */}
          {mobileNavOpen ? (
            <div className="fixed inset-0 z-50 lg:hidden">
              <button
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
              />
              <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-border/60 bg-sidebar shadow-2xl">
                <div className="absolute right-3 top-4">
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => setMobileNavOpen(false)} aria-label="Close menu">
                    <X className="size-4" />
                  </Button>
                </div>
                <SidebarContent view={view} navigate={navigate} />
              </aside>
            </div>
          ) : null}

          {/* ---- Main column ---- */}
          <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
            <Header view={view} onOpenMobileNav={() => setMobileNavOpen(true)} />
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-6 sm:px-6">
              {view.name === 'command-center' ? <CommandCenterView initialProjectId={initialProjectId} navigate={navigate} /> : null}
              {view.name === 'dashboard' ? <DashboardView navigate={navigate} /> : null}
              {view.name === 'studio' ? <StudioView initialProjectId={view.projectId} initialPrompt={view.prompt} navigate={navigate} /> : null}
              {view.name === 'projects' ? <ProjectsView navigate={navigate} /> : null}
              {view.name === 'project' ? (
                <ProjectDetail projectId={view.projectId} tab={view.tab} navigate={navigate} />
              ) : null}
              {view.name === 'settings' ? <SettingsView /> : null}
              {view.name === 'docs' ? <DocsView /> : null}
            </main>
            <footer className="mt-auto border-t border-border/60 px-6 py-4">
              <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-mono">CortexOS v0.4.0 — Phase 4 · Visual Command Center &amp; AI CTO Mode</span>
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5" /> Local-first: all memory, graph and DNA data stays on this daemon
                </span>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </QueryClientProvider>
  )
}

function SidebarContent({ view, navigate }: { view: View; navigate: (v: View) => void }) {
  const items = useMemo(
    () => [
      { key: 'command-center', label: 'Command Center', icon: Gauge, active: view.name === 'command-center' },
      { key: 'dashboard', label: 'Overview', icon: LayoutDashboard, active: view.name === 'dashboard' },
      { key: 'studio', label: 'Prompt Studio', icon: Sparkles, active: view.name === 'studio' },
      { key: 'projects', label: 'Projects', icon: FolderKanban, active: view.name === 'projects' || view.name === 'project' },
      { key: 'settings', label: 'Daemon Settings', icon: Settings, active: view.name === 'settings' },
      { key: 'docs', label: 'Integration Docs', icon: BookOpen, active: view.name === 'docs' },
    ],
    [view.name],
  )

  return (
    <>
      <div className="flex items-center gap-3 px-5 pb-6 pt-6">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
          <BrainCircuit className="size-5.5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">CortexOS</p>
          <p className="truncate text-[11px] text-muted-foreground">Persistent AI Brain</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3" aria-label="Main navigation">
        {items.map((item) => (
          <button
            key={item.key}
            onClick={() =>
              navigate(
                item.key === 'command-center' ? { name: 'command-center' }
                : item.key === 'dashboard' ? { name: 'dashboard' }
                : item.key === 'studio' ? { name: 'studio' }
                : item.key === 'projects' ? { name: 'projects' }
                : item.key === 'settings' ? { name: 'settings' }
                : { name: 'docs' },
              )
            }
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              item.active
                ? 'bg-primary/12 text-primary ring-1 ring-primary/25'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <item.icon className="size-4 shrink-0" />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="space-y-3 px-5 pb-6">
        <div className="rounded-lg border border-border/60 bg-card/50 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Zap className="size-3 text-amber-500" /> Roadmap
          </p>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-snug text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Phase 1 · Brain &amp; Rewriter — live
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Phase 2 · Cross-Platform Sync — live
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Phase 3 · Pre-Execution Agents — live
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Phase 4 · Command Center &amp; AI CTO — live
            </li>
          </ul>
        </div>
      </div>
    </>
  )
}

function Header({ view, onOpenMobileNav }: { view: View; onOpenMobileNav: () => void }) {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: cortexApi.health,
    refetchInterval: 30_000,
  })
  const { theme, setTheme } = useTheme()

  const title =
    view.name === 'command-center' ? 'Visual Command Center'
    : view.name === 'dashboard' ? 'Overview'
    : view.name === 'studio' ? 'Prompt Studio'
    : view.name === 'projects' ? 'Projects'
    : view.name === 'project' ? 'Project'
    : view.name === 'settings' ? 'Daemon Settings'
    : 'Integration Docs'

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="size-11 lg:hidden"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </Button>
        <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">{title}</h1>
        <Badge variant="outline" className="hidden border-primary/30 bg-primary/10 font-mono text-[10px] text-primary sm:inline-flex">
          cortexd · v0.4.0
        </Badge>

        <div className="ml-auto flex items-center gap-2">
          {health ? (
            <div className="hidden items-center gap-2 md:flex">
              <StatusPill ok={health.database === 'ok'} label={health.database === 'ok' ? 'Daemon online' : 'DB error'} detail="SQLite storage engine" />
              <StatusPill
                ok={health.ollama.reachable}
                label={health.ollama.reachable ? `Ollama · ${health.ollama.models.length} models` : 'Ollama offline · Fast-Path'}
                detail={health.ollama.reachable ? health.ollama.baseUrl : `${health.ollama.baseUrl} unreachable — deterministic engine active`}
              />
            </div>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
          >
            <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:block"
            aria-label="Repository"
          >
            <Button variant="ghost" size="icon" className="size-9">
              <Github className="size-4" />
            </Button>
          </a>
        </div>
      </div>
    </header>
  )
}
