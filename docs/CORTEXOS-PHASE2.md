# CortexOS — Phase 2 Implementation: Cross-Platform Sync Engine

**Version:** 0.2.0 · **Blueprint:** Cortex Core Blueprint v2 §6 Phase 2 (Weeks 3–4 scope) + Part 1 Blueprint §4/§5
**Status:** ✅ Implemented, 33/33 Phase 2 tests + 32/32 Phase 1 regression passing, browser E2E verified

---

## 1. What Phase 2 delivers (per blueprint)

> Phase 2: Cross-Platform Sync Engine — file watcher + Git hook + Browser DOM
> watcher + MCP server. Any work done in Codex automatically updates the
> Knowledge Graph, and switching to Hermes or OpenCode automatically injects
> the latest project state.

| Blueprint requirement | Implementation | Where |
| --- | --- | --- |
| File watcher ("updates the KG the second a file is saved") | Chokidar 4 watcher inside the daemon: content hashes, line counts, export summaries → `file` graph nodes + module `CONTAINS` edges + timeline events; auto-starts on daemon boot for `watchEnabled` projects | `src/lib/cortex/watcher.ts`, `src/instrumentation.ts`, `POST/GET /api/cortex/watch` |
| Git hook | Post-commit hook installer CLI (`install/uninstall/check`, chains onto existing hooks, never blocks a commit) + webhook ingestion + incremental `git log` backfill via real subprocess, watermarked by `Project.gitLastIngestAt` | `scripts/cortex-git-hook.mjs`, `src/lib/cortex/git.ts`, `POST /api/cortex/hooks/git`, `POST /api/cortex/git/ingest` |
| Bug auto-resolution (deterministic) | `fix(es)/resolve/closes …` commits (with `#id` or ≥2 keyword hits) flip matching open bug memories to resolved, flip graph bug nodes, record `memory.resolved` timeline events | `src/lib/cortex/git.ts` → `resolveBugsFromCommit` |
| MCP server (`cortex_sync`, `cortex_get_dna`, `cortex_log_decision`) | Real stdio MCP server on `@modelcontextprotocol/sdk` with the 3 blueprint tools + `cortex_rewrite`, `cortex_search_history`, `cortex_capture_interaction`; config snippets for Claude Desktop / Codex / Cursor / Windsurf / OpenCode | `mcp-server/index.mjs`, `mcp-server/README.md`, `npm run mcp` |
| Browser DOM watcher (Pillar 12) | Real MV3 extension: global hotkeys `Ctrl/Cmd+Shift+Space` (Tier-1 rewrite in place) and `Ctrl/Cmd+Shift+V` (sync packet injection), context menu, popup (status, project/engine/target pickers, clipboard capture), options page, site adapters (ChatGPT/Claude/Gemini/Qwen + generic) | `extension/**`, zip in `download/cortexos-extension-v0.2.0.zip` |
| Cross-platform state injection (Pillar 3) | Full `CrossPlatformSyncPacket` — header (platform pair + state hash), dnaSnapshot (stack + active constraints), scopedGraphContext (active module: decisions/symbols/open bugs), continuityState (last action, active task, pending) — 287 tokens for the demo project; handoff audit trail + platform flip + `sync.handoff` timeline events | `src/lib/cortex/packet.ts`, `GET/POST /api/cortex/sync/{slug}`, `GET …/handoffs` |
| Episodic memory (§3 Tier-3, deferred from Phase 1) | Every captured turn → ~60-token extractive summary → embedding (Ollama `nomic-embed-text` → deterministic local hashed fallback, offline-safe) → cosine semantic search blended with keyword memory matches | `src/lib/cortex/embeddings.ts`, `src/lib/cortex/episodic.ts`, `POST /api/cortex/search` |
| Zero-token context scoping (§5 scoped query) | Active-module inference: explicit `?module=` → latest file/git timeline signal → latest interaction text → busiest module; scoped context returns pointers, not dumps | `src/lib/cortex/packet.ts` → `inferActiveModule` / `buildScopedContext` |

## 2. Environment mapping (sandbox → blueprint target)

| Blueprint (§5) | This build | Notes |
| --- | --- | --- |
| Tauri daemon + WS extension link (`ws://localhost:11436`) | Next.js daemon; extension talks HTTP to the daemon with service-worker-side fetch (MV3 security posture) | Same contract; WS upgrade is transport-only |
| LanceDB vectors | SQLite column vectors + in-memory cosine scan | Drop-in interface for a native vector index later |
| Tree-sitter code map | Deterministic per-file scanner (hash, lines, regex export summary) | Same pointer output class; watcher-driven, no LLM tokens |
| Rust `notify` watcher | Chokidar 4 (Node) | Same debounce/ignore semantics |

## 3. Architecture

```
Codex / Cursor / Windsurf / Claude / Hermes / OpenCode
   │ MCP stdio (cortex_sync …)            Browser chats (ChatGPT/Claude/Gemini…)
   │                                      │ MV3 extension (global hotkeys)
   ▼                                      ▼
Cortex daemon API (26 routes, zod-validated)
   ├── Sync Engine (packet.ts)      → CrossPlatformSyncPacket + SyncHandoff audit
   ├── Episodic store (embeddings)  → summaries + vectors + semantic search
   ├── File watcher (watcher.ts)    → graph file/module triples + timeline
   ├── Git intelligence (git.ts)    ← post-commit hook webhook + git log backfill
   │       └── bug auto-resolution (fix commits close matching bugs)
   └── Memory Engine / KG / DNA / Rewriter (Phase 1, unchanged contracts)
                │
                ▼
        SQLite (file:./db/custom.db) — 10 models, all local
```

## 4. Test evidence

- **Phase 2 suite:** `node scripts/test-phase2.mjs` → **33/33 passed**
  (health v0.2.0; episodic indexing + semantic ranking + memory blend; full
  packet contract + handoff audit/platform-flip/chaining + explicit module
  scoping; watcher start → save → graph file node with exports/astHash →
  timeline → active-module inference → stop/persist; git webhook ingest +
  dedupe + file nodes + bug auto-resolution + 422/404 envelopes; real `git
  log` backfill with watermark + incremental ingest; hook installer → live
  commit delivery through the real hook; MCP handshake + all 6 tools +
  clean errors; extension core (UMD load, site adapters, live daemon
  calls); metrics sync section; cascade cleanup).
- **Phase 1 regression:** `node scripts/test-phase1.mjs` → **32/32 passed**
  (version assertion updated 0.1.0 → semver pattern; all Phase 1 contracts
  including the ≤350-token state header preserved).
- **Browser E2E (agent-browser):** dashboard Phase 2 stats strip; Sync tab
  blueprint contract + UI handoff execution (codex → hermes recorded);
  Watch tab; History tab semantic search (sample chip → ranked episode);
  extension harness page running the REAL `lib/core.js` + `content.js` —
  rewrite flow injected a Tier-1 prompt into the textarea (verified via DOM
  eval) with toast, sync flow injected the packet and recorded the handoff;
  mobile 390px no-overflow; zero console/page errors.

## 5. Phase 3 hooks already in place

- `continuityState.activeTask.preExecutedByLocalAgent` is a real (empty)
  array in every packet — Phase 3's pre-execution agent fills it.
- `routing.tier === 'local-agent'` decisions are already produced by the
  Phase 1 intent engine; Phase 3 executes them.
- The extension's service-worker architecture (all daemon traffic
  background-side) is ready for the local reverse-proxy hook (#2).

## 6. Manual test checklist

See the chat delivery message for the numbered manual checklist (same steps).
