# CortexOS — Phase 1 Implementation: The Brain & Prompt Interceptor

**Version:** 0.1.0 · **Blueprint:** Cortex Core Blueprint v2 §6 Phase 1 (Weeks 1–2 scope)
**Status:** ✅ Implemented, 32/32 automated tests passing, browser E2E verified

---

## 1. What Phase 1 delivers (per blueprint)

> Phase 1: The Brain & Prompt Interceptor — local daemon + SQLite Knowledge Graph +
> Project DNA generator + Tier-1 Prompt Rewriter powered by local Ollama, turning raw
> one-line prompts into enterprise specifications.

| Blueprint requirement | Implementation | Where |
| --- | --- | --- |
| Local daemon (cortexd) | 14-route REST daemon API + health/metrics/settings | `src/app/api/cortex/**` |
| SQLite Knowledge Graph | Property-graph triple store (`(s) —[RELATION]→ (t)`) with context-matched subgraph retrieval → symbolic pointers | `prisma/schema.prisma`, `src/lib/cortex/graph.ts` |
| Project DNA generator | Deterministic workspace scanner → 6-section DNA (philosophy, stack w/ evidence, standards, rules, libraries, patterns) → auto graph sync | `src/lib/cortex/scan.ts`, `src/lib/cortex/dna.ts` |
| Tier-1 Prompt Rewriter | Fast-Path deterministic (<50ms) + Deep-Path Ollama + Cloud GLM refinement, Master System Prompt, task decomposition, token accounting | `src/lib/cortex/rewrite.ts`, `intent.ts`, `decompose.ts`, `master-prompt.ts` |
| Memory Engine (Pillar 1) | Pattern-based extraction of decisions/architecture/requirements/TODOs/bugs/preferences from raw transcripts, dedupe, graph linking | `src/lib/cortex/extract.ts`, `capture.ts` |
| Zero-token context (§3) | Naive-vs-compact context accounting + Compact State Packet (150–300 tokens) with state hash | `src/lib/cortex/tokens.ts`, `packet.ts`, `/api/cortex/sync/{slug}` |
| Token Savings Engine (Pillar 8) | Per-session accounting + 14-day series + smart routing recommendation | `/api/cortex/metrics`, dashboard |
| Development Timeline (Pillar 11) | Every engine action appends an immutable timeline event | `TimelineEvent` model + Timeline tab |
| Command Center | Single-page UI: Dashboard, Prompt Studio, Projects (DNA/Memories/Graph/Timeline/Sync), Settings, Docs | `src/components/cortex/**` |

## 2. Environment mapping (sandbox → blueprint target)

The blueprint's desktop target is a Tauri shell around a local daemon. This build
implements the **daemon and its brain as a running full-stack application** so every
feature is verifiable in the preview; the engine layer is transport-agnostic and maps
1:1 onto the blueprint stack:

| Blueprint (§5) | This build | Notes |
| --- | --- | --- |
| Tauri v2 daemon shell | Next.js 16 daemon API (App Router, Node runtime) | Same HTTP/JSON contract a Tauri shell would expose |
| KuzuDB graph DB | SQLite-backed triple store (Prisma) | Same (kind, label) keys + typed relations; swap-in ready |
| Ollama + LiteLLM | Real Ollama HTTP client (configurable base URL + model) | Offline → deterministic Fast-Path, never a hard failure |
| Tree-sitter code map | Bounded deterministic scanner (manifests + per-file stats) | No LLM tokens; same signature/index output for Phase 1 scale |
| LanceDB vectors | Phase 2+ (episodic delta store) | Interactions persisted now; vector index lands with sync engine |

## 3. Architecture

```
Browser Command Center (single page, dark/light)
        │  fetch /api/cortex/*
        ▼
Cortex Daemon API ── zod validation ── error envelopes
        │
        ├── Memory Engine (extract.ts · capture.ts)      → Memory, Interaction, GraphNode/Edge
        ├── Knowledge Graph service (graph.ts)            → symbolic pointers, one-hop traversal
        ├── DNA Generator (scan.ts · dna.ts)              → ProjectDna + graph sync
        ├── Tier-1 Rewriter (intent · decompose · rewrite)→ PromptSession + Token accounting
        │       ├── Fast-Path  (deterministic, <50ms)
        │       ├── Deep-Path (Ollama, Master System Prompt, graceful fallback)
        │       └── Cloud     (GLM via z-ai SDK, backend only)
        ├── State Packet (packet.ts)                      → Compact State Header + hash
        └── Settings / Health / Metrics / Seed
                │
                ▼
        SQLite (file:./db/custom.db) — 8 models, all local
```

## 4. Test evidence

- **Automated suite:** `node scripts/test-phase1.mjs` → **32/32 passed**
  (health, seed idempotency, project lifecycle, DNA scan on a real fixture workspace,
  memory extraction/dedupe/graph-linking, graph CRUD + subgraph + traversal, Fast/Deep/Cloud
  rewrites incl. fallback, decomposition, state packet budget, metrics, timeline,
  settings round-trip, Ollama probe, validation errors, cascade delete).
- **Browser E2E (agent-browser):** dashboard stats/chart render with live data;
  Studio golden path (project select → sample prompt → rewrite → Tier-1 output with
  Bug #14 injection + atomic requirements); Analysis/Context tabs; project detail tabs;
  graph canvas (21 nodes/39 edges — matches API exactly) with drag + click inspector
  (Stripe → 3-hop neighbourhood); memories capture dialog (5 typed memories extracted);
  timeline; sync packet; settings probe; docs; mobile 390px (no overflow, 44px targets);
  light/dark toggle; sticky footer on short pages; zero console/page errors.

## 5. Manual test checklist

See the chat delivery message for the numbered manual checklist (same steps).

## 6. Phase 2 hooks already in place

- `GET /api/cortex/sync/{slug}` serves the exact state contract the MCP
  `cortex_sync` tool will serve; hash-based delta detection is implemented.
- `POST /api/cortex/memories` is the write path `cortex_log_decision` will call.
- Interactions persist raw transcripts for the future episodic vector store.
