# CortexOS — Phase 3 Implementation: Pre-Execution Local Agent & Token Optimizer

**Version:** 0.3.0 · **Blueprint:** Core Blueprint v2 §6 Phase 3 (Weeks 5–6) + Part 2 Blueprint (3 engines, JSON grammars, local Ollama pipeline) + Part 1 §4 (ExtractedMemoryDelta)
**Status:** ✅ Implemented, 35/35 Phase 3 tests + 32/32 Phase 1 + 33/33 Phase 2 regression passing, browser E2E verified

---

## 1. What Phase 3 delivers (per blueprint)

> Phase 3: Pre-Execution Local Agent & Token Optimizer — give the local Ollama
> layer tool-calling capabilities. Implement the Smart Router that completes
> boilerplate/research locally and sends only the core architectural delta
> to Codex.

| Blueprint requirement | Implementation | Where |
| --- | --- | --- |
| Engine 1 — Pre-Execution Router & Triage | Ollama structured outputs (`format: jsonSchema`, `qwen2.5:1.5b` role) under the blueprint `RouterDecisionSchema` grammar, with a deterministic Fast-Path triage (<800ms, blueprint §4) when local models are offline. Emits `intentCategory`, `complexityScore`, `executionMode` (LOCAL_ONLY / HYBRID_PRE_EXECUTE / CLOUD_DIRECT_WITH_DNA), `localPreExecutionPlan`, `cloudCoreTaskSpec`, `estimatedCloudTokensSaved` | `src/lib/cortex/preexec.ts`, `cortex-assets/prompts/pre-execution-router.system.md`, `cortex-assets/schemas/router-decision.schema.json` |
| Engine 2 — Tier-1 Prompt Engineering & Context Injection | Ollama under `Tier1RewrittenPromptSchema` + deterministic blueprint-format assembler producing the exact payload: `[CORTEX-OS SYNC \| … Prev → Target]`, `[PRE-EXECUTED BY CORTEX LOCAL AGENT — DO NOT REGENERATE]`, `[AST SCOPE GUARD & ARCHITECTURE LOCK]` (allowed writes / protected / immutable constraints), `[CORE EXECUTION SPECIFICATION FOR <PLATFORM>]`, `[VERIFICATION CRITERIA]` — plus `decomposedSubtasks` with `handledBy` (COMPLETED_BY_LOCAL_OLLAMA vs ASSIGNED_TO_MAIN_AI) and `scopeLock` | `src/lib/cortex/preexec.ts` → `assembleDeterministicTier1`, `cortex-assets/prompts/tier1-prompt-engineer.system.md` |
| Engine 3 — Automatic Memory Extractor | Background hook per AI turn: prompt + response + `modifiedFilesAstDiff` → `ExtractedMemoryDelta` (Part 1 §4 contract) → applied to the memory engine, Knowledge Graph (`GOVERNED_BY` / `SUPERSEDES` / `HAS_BUG` edges) and episodic store. Deterministic extractor offline, `llama3.2:3b` role online | `src/lib/cortex/memory-delta.ts`, `POST /api/cortex/extract` |
| Local tool: `ast_symbol_lookup` | Real multi-language symbol tables from the workspace: functions / arrow functions / classes / interfaces / types / constants with **line numbers + signatures + imports**; fuzzy file resolution (exact → extension guesses → bounded basename walk) | `src/lib/cortex/local-tools.ts` |
| Local tool: `schema_inspect` | Real Prisma schema parsing: model blocks with fields, types, nullability, list-ness, attributes, block attributes, start line, datasource provider | `src/lib/cortex/local-tools.ts` → `extractPrismaModel` |
| Local tool: `local_docs_search` | Real section-level search over the seeded docs cache (`cortex-assets/docs-cache/*.md`: Stripe webhooks, Prisma schema, Next.js route handlers, Zod) + optional live SearXNG layer (never breaks on failure) | `src/lib/cortex/local-tools.ts`, settings `searxngUrl` |
| Local tool: `scaffold_boilerplate` | Real generators deriving output from the inspected schema: Zod schemas (documented Prisma→Zod mapping incl. relation/nullable/server-managed handling), TypeScript interfaces (+CreateInput), Next.js route stubs with the validation envelope, .env.example key names — all **staged, never blind-written** | `src/lib/cortex/local-tools.ts` |
| Local tool: `git_diff_summary` | Real `git status --porcelain=v1 -b` + `git diff HEAD --numstat` subprocess; branch, clean state, per-file +/- counts | `src/lib/cortex/local-tools.ts` |
| LOCAL_ONLY early return (blueprint rule 1) | 100%-local tasks (types/schemas/boilerplate/docs/test stubs) return `handledCompletelyLocally: true` with artifacts + staged files and **no cloud prompt at all** | `src/lib/cortex/preexec.ts` |
| Staging behind the AST Scope Guard | `StagedArtifact` lifecycle: apply enforces inside-root resolution, protected-path deny-list (`.env`, migrations, node_modules, lockfiles…), `create` never clobbers, `modify` captures `previousContent` for exact-byte revert, `.env.example` merges only missing keys | `src/lib/cortex/staging.ts`, `POST /api/cortex/preexecute/staged/{id}` |
| Token Optimizer | Grounded savings accounting (real artifact tokens + staged boilerplate + context the cloud never re-reads), per-run history, dashboard aggregates (`cloudTokensSaved`, `localOnlyRuns`, `filesStaged`, `avgDurationMs`) | `PreExecRun` model, `GET /api/cortex/metrics` |
| `continuityState.activeTask.preExecutedByLocalAgent` (Phase 2 hook) | Now carries **real** completed work: executed tool summaries + staged/applied files from the latest 24h run | `src/lib/cortex/packet.ts` → `collectPreExecutedWork` |
| MCP tools for CLI/IDE agents | `cortex_preexecute` + `cortex_extract_memory` added to the stdio MCP server (8 tools total), full result formatting | `mcp-server/index.mjs`, `mcp-server/README.md` |
| Browser extension support | `preexec` engine in the popup: runs the agent from any web chat, injects the payload (or a local-completion summary for LOCAL_ONLY), pre-exec toast | `extension/**`, `download/cortexos-extension-v0.3.0.zip` |

## 2. Environment mapping (sandbox → blueprint target)

| Blueprint (Part 2) | This build | Notes |
| --- | --- | --- |
| `.cortex/prompts` + `.cortex/schemas` in the target project | `cortex-assets/` in the daemon repo, loaded from disk at runtime | Same file-driven contract, one auditable home for a multi-project daemon; served via `GET /api/cortex/assets` |
| Tree-sitter AST | Deterministic regex symbol extractor (TS/JS/Python) | Same output class (name, kind, line, signature, imports); swap-in ready |
| Local Ollama models qwen2.5:1.5b / coder:7b / llama3.2:3b | Same defaults via settings roles (`ollamaRouterModel`, `ollamaModel`, `ollamaExtractorModel`) | Structured calls use the exact blueprint request shape (`format` grammar, temperature 0.1, num_ctx 8192) |
| SearXNG web search | Optional `searxngUrl` setting + docs-cache primary | Offline-safe by design |

## 3. Architecture

```
Raw prompt ("add stripe webhook for subscription renewal and update user db")
   │
   ▼
ENGINE 1 · Pre-Execution Router (ollama qwen2.5:1.5b ⇄ deterministic Fast-Path)
   │  RouterDecisionSchema: executionMode + localPreExecutionPlan + cloudCoreTaskSpec
   ▼
LOCAL TOOL RUNNER — 0 cloud tokens (real workspace I/O)
   │  git_diff_summary → schema_inspect → ast_symbol_lookup
   │  → local_docs_search → scaffold_boilerplate (STAGED)
   ▼
[LOCAL_ONLY → early return: artifacts + staged files, no cloud prompt]
   ▼
ENGINE 2 · Tier-1 Prompt Engineering (ollama coder:7b ⇄ deterministic assembler)
   │  [CORTEX-OS SYNC] · [PRE-EXECUTED — DO NOT REGENERATE]
   │  · [AST SCOPE GUARD] · [CORE EXECUTION SPECIFICATION] · [VERIFICATION]
   ▼
Codex / Hermes / OpenCode / Cursor / Claude  ──(after the turn)──▶
   │                                                              │
   │                                              ENGINE 3 · Memory Extractor
   │                              ExtractedMemoryDelta (supersedes, tasks, bugs)
   ▼                                              ▼
Staging Area (apply / discard / revert)          Memory engine + KG + episodic store
```

Storage: SQLite — 12 models (Project, ProjectDna, Memory, GraphNode, GraphEdge, PromptSession, Interaction, SyncHandoff, GitCommit, **PreExecRun**, **StagedArtifact**, TimelineEvent, Setting).

## 4. Test evidence

- **Phase 3 suite:** `node scripts/test-phase3.mjs` → **35/35 passed**
  (health v0.3.0 + capabilities; settings roles round-trip; asset inventory;
  HYBRID run against a real git workspace — full RouterDecision contract, all
  5 tools executing for real, staged Zod/types/routes/env verified against the
  actual Prisma model, blueprint section markers asserted verbatim, scope
  lock + handledBy subtasks, run history + timeline; LOCAL_ONLY early return;
  staging lifecycle — apply→file-on-disk byte-exact, 409 double-apply,
  env-merge only-missing-keys + exact-byte revert, discard isolation,
  404/422 envelopes; Engine 3 — supersedes (memory status + SUPERSEDES edge),
  task completion proven by diff, bug resolution, episodic indexing, graph
  nodes; sync-packet `preExecutedByLocalAgent`; **mock Ollama** proving the
  real `format: jsonSchema` LLM paths end-to-end for all 3 engines plus the
  invalid-output fallback; validation envelopes; MCP 8 tools with
  `cortex_preexecute` + `cortex_extract_memory`; extension core preexec
  mapping; metrics preExec section; cascade cleanup).
- **Phase 1 regression:** 32/32 passed · **Phase 2 regression:** 33/33 passed
  (the Phase 2 health assertion moved from a pinned version to the
  forward-compatible `capabilities` check).
- **Browser E2E (agent-browser):** dashboard Phase 3 strip with live numbers;
  Studio Pre-Exec engine → full agent run in the browser (router card with
  offline note, per-tool timeline with durations, expandable artifact JSON,
  injected payload with all blueprint markers, subtasks with local/main-AI
  badges, staging manager with Apply/Discard/Revert); all five views at 390px
  with zero horizontal overflow (a grid-item `min-w-0` fix was applied and
  verified); zero console/page errors.

## 5. API additions

| Method & path | Purpose |
| --- | --- |
| `POST /api/cortex/preexecute` | Run the agent: Engine 1 → tools → Engine 2 (or LOCAL_ONLY early return) |
| `GET /api/cortex/preexecute?projectId=` | Agent run history |
| `GET /api/cortex/preexecute/staged?projectId=&status=` | Staged queue (content included) |
| `GET /api/cortex/preexecute/staged/{id}` | One staged artifact |
| `POST /api/cortex/preexecute/staged/{id}` | `{action: apply\|discard\|revert}` — scope-guard validated |
| `POST /api/cortex/extract` | Engine 3 turn analysis → ExtractedMemoryDelta applied |
| `GET /api/cortex/assets` | Blueprint asset inventory (auditable prompts/grammars/docs) |

## 6. Phase 4 hooks already in place

- `PreExecRun` + `StagedArtifact` give Phase 4's visual Command Center a full
  audit trail to chart (agent runs over time, cloud tokens saved per module).
- The deterministic router/tier-1 pair is a drop-in Fast-Path for Phase 4's
  AI CTO recommendations (same scoped-context contract).
- `cortex-assets/docs-cache` is the substrate for Phase 4's live codebase
  intelligence (add per-project docs as cached sections).

## 7. Manual test checklist

See the chat delivery message for the numbered manual checklist (same steps).
