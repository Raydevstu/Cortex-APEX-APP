/**
 * Next.js instrumentation hook — daemon boot sequence.
 *
 * Starts the Phase 2 file watchers for every project flagged `watchEnabled`
 * so the Knowledge Graph keeps itself current the moment the daemon comes
 * up (blueprint §6: "any work done in Codex automatically updates the
 * Knowledge Graph").
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { bootstrapWatchers } = await import('@/lib/cortex/watcher')
    await bootstrapWatchers()
  } catch (error) {
    // Never block daemon boot on watcher startup — the daemon degrades to
    // on-demand watching via POST /api/cortex/watch.
    console.error('[cortexd] watcher bootstrap failed:', error)
  }
}
