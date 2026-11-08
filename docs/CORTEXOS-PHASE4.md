# CortexOS — Phase 4 Implementation: Visual Command Center & AI CTO Mode

**Version:** 0.4.0 · **Blueprint:** PHASE_4_VISUAL_COMMAND_CENTER_BLUEPRINT (§1–§8) ↔ Core Blueprint v2 Phase 4
**Status:** ✅ Implemented — 28/28 Phase 4 Node tests + 9/9 Phase 4 Python TDD tests + 32/32 Phase 1 + 33/33 Phase 2 + 35/35 Phase 3 regressions passing, browser E2E verified on the blueprint port `http://localhost:4300`

---

## 1. What Phase 4 delivers (per blueprint)

> Phase 4 completes the local-first CortexOS Control Plane by exposing an
> interactive **Visual Command Center** and an **AI CTO Recommendation &
> Multi-Agent Orchestration Engine**.

| Blueprint deliverable | Implementation | Where |
| --- | --- | --- |
| **1. Interactive Knowledge Graph Explorer** — live nodes (`Module`, `SourceFile`, `ASTSymbol`, `ArchitecturalDecision`, `Task`, `Bug`, `SessionTurn`) + directed edges, AST scope-lock badges (emerald `IN-SCOPE` / rose `LOCKED`), one-click node inspection, hop-radius ego-network filtering, live scope-lock toggling | `KuzuGraphCanvas` renders the live property graph + the real workspace audit (symbol FQNs, signatures, line spans, cyclomatic complexity). 1-hop / 2-hop ego networks are computed by real BFS over the edge list. Scope toggles hit `POST /api/cortex/state` and re-render with recalculated CTO advisories | `src/components/cortex/command-center/kuzu-graph-canvas.tsx`, `src/lib/cortex/dashboard-state.ts` |
| **2. Session Continuity & Cross-Platform Timeline** — chronological `ExtractedMemoryDelta` stream across platforms with AST symbol diffs and ratified decisions | Merged live stream: session turns (`Interaction`), Tier-1 rewrites (`PromptSession`), pre-exec agent runs (`PreExecRun` incl. target files), handoffs (`SyncHandoff`) and git commits (`GitCommit` with real A/M/D change types) | `continuity-timeline.tsx`, `buildTimeline` in `dashboard-state.ts` |
| **3. Token Savings & Local Routing Telemetry** — real-time compression ratios, local vs paid split, daily history | Live aggregates over `PromptSession` + `PreExecRun`: raw-context baseline vs injected sync-packet tokens, net savings, cost at a documented `$3.00/MTok` rate, local-offload %, 14-day daily history (stacked bars + local-execution line) | `token-savings-dashboard.tsx`, `buildTokenTelemetry` in `src/orchestrator/ai-cto-engine.ts` |
| **4. AI CTO Mode** — drift detector, recommendation engine & DAG orchestrator auditing the graph against Project DNA | 5 grounded audit categories (below) + `MultiAgentOrchestrator` decomposing goals into topological DAGs, dispatching local subtasks through the **real Phase 3 tool runner** and cloud subtasks with scope-locked Tier-1 payloads | `src/orchestrator/ai-cto-engine.ts`, `src/orchestrator/multi-agent-orchestrator.ts`, `ai-cto-panel.tsx` |
| **5. Cross-Platform Handoff Packet Modal** — deterministic copy-ready `<cortex_sync_packet>` | Generated from the real `CrossPlatformSyncPacket` (Phase 2 engine), recorded as a real `SyncHandoff`, target-platform picker, XML copy | `handoff-modal.tsx`, `renderSyncPacketXml` in `dashboard-state.ts` |
| Standalone zero-dependency preview | Interactive HTML preview of the exact component contract (node inspector, scope toggle, filters, token chart, handoff modal) — file-openable and daemon-served | `public/cortexos_command_center_preview.html` |

### AI CTO audit categories — all grounded in live data

| Category | Trigger (real data) | Action |
| --- | --- | --- |
| `SCOPE_LOCK_HAZARD` | Workspace scan: symbol cyclomatic complexity > 12 (blueprint `maxCyclomaticComplexity`) that is not explicitly locked; severity CRITICAL when it sits inside the active write scope | `LOCK_SYMBOLS` → real scope mutation |
| `ARCHITECTURE_DRIFT` | Real `import` statements vs the hexagonal layer policy (`ui→storage`, `ui→orchestrator`, `engine→ui`, storage as leaf) | `RATIFY_ADR` → creates the decision memory |
| `COMPLEXITY_HOTSPOT` | Files > 400 lines (`maxFileLines`) from the live scan or the DNA code map | `REFACTOR_LOCAL` → pre-filled Prompt Studio |
| `TOKEN_OPTIMIZATION` | Live telemetry: local offload < 65% target with real turn counts and per-turn savings | `REFACTOR_LOCAL` → pre-filled Prompt Studio |
| `UNLINKED_REQUIREMENT` | Stale (>14d) active todo/requirement memories with no Knowledge-Graph linkage | `RATIFY_ADR` → triage memory |
| Blueprint fallback (§4 rule 4) | Fewer than 3 findings → `DECOMPOSE_DAG` advisory for the active scope | One-click build + dispatch |

### Multi-Agent DAG Orchestrator

- **Decomposition** (`decomposeGoal`): intent classification + requirement
  splitting (Phase 1 engines, reused) → canonical 4-subtask DAG —
  ① contract validation (local) → ② core implementation (cloud) →
  ③ TDD verification (local) + ④ continuity sync (local).
- **Waves** (`computeExecutionWaves`): pure Kahn topological sort with
  cycle + unknown-dependency detection; unit-testable determinism.
- **Dispatch** (`dispatchPlan`): local subtasks execute via
  `executeLocalToolStep` (ast_symbol_lookup / schema_inspect /
  local_docs_search / git_diff_summary — 0 cloud tokens); cloud subtasks get
  the deterministic Tier-1 payload (blueprint section markers, allowed
  symbols, protected paths, DNA constraints, verification criteria) for
  copy-paste into the target agent. Operator confirms cloud outcomes via
  `UPDATE_SUBTASK`; the next `DISPATCH_PLAN` pass picks up newly unblocked
  waves (skipped dependencies no longer block, failed ones do).
- **Persistence**: `DagPlan` model (goal, status draft→dispatched→completed/
  archived, subtask records with real artifacts, waves, audit meta) + full
  timeline events (`dag.plan_created`, `dag.dispatched`, `dag.completed`).

### AST Semantic Scope Locks — real enforcement, not just UI state

- **Store** (`src/lib/cortex/scope-lock.ts`): per-project persisted
  `allowedSymbolFqns` (unlocked into the active write scope),
  `lockedSymbolFqns` (sentinel-protected) and `forbiddenPaths` (fail-closed:
  `.env`, `prisma/migrations/`, `src/middleware.ts`, `package.json`,
  `bun.lock`). First use seeds deterministically from the latest pre-exec
  run's Tier-1 scope lock, else the latest git footprint, else fail-closed.
- **Enforcement**: the Phase 3 staging guard now blocks any `modify` of a
  file containing explicitly locked symbols (422 with the locked FQN list)
  until they are unlocked — verified end-to-end by the test suite.
- **Write-scope semantics** (graph badges mirror the guard exactly): locking
  any symbol marks its whole file (and every symbol in it) `LOCKED`, because
  whole-file modifies are what the sentinel blocks. Every mutation writes a
  timeline audit trail (`scope.toggled` / `scope.locked` / `scope.updated` /
  `scope.reset`).

## 2. Environment mapping (blueprint → this build)

| Blueprint path (PHASE_4 §2) | This build | Notes |
| --- | --- | --- |
| `src/dashboard/app/page.tsx` (port 4300) | `CommandCenterView` — the default view of the daemon SPA | `npm run dev:cc` serves the full daemon (UI + API) on **4300**; `npm run dev` remains on 3000 |
| `src/dashboard/app/api/cortex/state/route.ts` | `src/app/api/cortex/state/route.ts` | Same URL contract `GET/POST /api/cortex/state` |
| `src/dashboard/app/api/cortex/cto/route.ts` | `src/app/api/cortex/cto/route.ts` | Same URL contract |
| `src/dashboard/components/*.tsx` | `src/components/cortex/command-center/*.tsx` | Same component names + contracts |
| `src/orchestrator/ai-cto-engine.ts`, `multi-agent-orchestrator.ts` | same paths | Exact blueprint locations |
| `src/types/cortex-contracts.ts` | `src/lib/cortex/types.ts` (Phase 4 section) | Blueprint DTOs preserved as a superset: live-graph kinds (`Tech`, `Feature`, `External`, `Root`) and relations (`USES`, `HAS_BUG`, …) are surfaced verbatim instead of being mislabeled |
| `.cortex/telemetry.jsonl` append-only ledger | SQLite telemetry (`PromptSession` + `PreExecRun` rows) | Same accounting, already transactional and queryable; no duplicate file ledger |
| KuzuDB graph.db | SQLite property-graph triple store (Phase 1) | Functionally equivalent storage for daemon scale; graph DTOs match the blueprint node/edge labels |
| `runtimeAllowedSymbols` (in-memory) | Persistent `Setting` key `scopeLock:<projectId>` | Survives daemon restarts; auditable |

**Policy constants** (documented defaults): `maxCyclomaticComplexity = 12`,
`maxFileLines = 400`, local-offload target `65%`, cost baseline
`$3.00 / 1M tokens` (Sonnet-class input pricing), ~1,400 tokens of context
re-read avoided per locally-executed DAG step (Phase 3 accounting baseline).

## 3. Architecture

```
                    VISUAL COMMAND CENTER (http://localhost:4300)
┌─────────────────────────────────────────────────────────────────────────────┐
│ ① Token Telemetry KPIs + daily chart   ② KuzuGraphCanvas (scope + ego-net) │
│ ③ AI CTO Panel (advisories + DAGs)     ④ Continuity Timeline + Handoff     │
└──────────────┬──────────────────────────────────────────────┬───────────────┘
               │ GET/POST /api/cortex/state                   │ GET/POST /api/cortex/cto
               ▼                                              ▼
   dashboard-state.ts (assembly)                    AICtoEngine.auditProject
   ├─ graph DTO + workspace audit (TTL cache)       ├─ workspace-audit.ts (complexity + imports)
   ├─ buildTokenTelemetry (live aggregates)         ├─ scope-lock.ts (persisted locks)
   ├─ buildTimeline (5 live sources)                ├─ telemetry-driven advisories
   └─ renderSyncPacketXml (Phase 2 packet)          └─ buildExecutionPlan / dispatchPlan
               ▼                                              ▼
        SQLite (Prisma: 13 models incl. DagPlan)    MultiAgentOrchestrator (Kahn waves)
                                                   └─ Phase 3 local tool runner (0 cloud tokens)
```

## 4. Test evidence

- **Phase 4 Node suite** (`node scripts/test-phase4.mjs [baseUrl]`): **28/28**
  — health v0.4.0 + capabilities + dagPlans counter; cloud-escalation-model
  settings round-trip; full state contract on the live demo project (graph
  labels, telemetry arithmetic incl. `local + cloud = intercepted` and the
  documented cost rate, timeline, advisories, XML envelope + tag balance);
  fixture workspace with a **genuine** complexity-15+ symbol and a **real**
  ui→storage import → both audit categories fire; ASTSymbol nodes carry real
  complexity/line spans; toggle round-trip + persistence + timeline trail +
  deterministic reseed; **scope-lock enforcement** (staged env-example modify
  → 422 while locked → applies after unlock, merged keys on disk verified);
  DAG lifecycle (waves validated, wave-1 local execution with real
  `schema_inspect` artifacts, Tier-1 cloud payload markers, dependency
  blocking, operator confirmation, re-dispatch settles the plan, archive);
  validation envelopes; MCP 8-tool regression; cascade cleanup.
- **Phase 4 Python TDD suite** (`python3 -m unittest discover -s tests -p
  "test_*.py"` with `CORTEX_URL`): **9/9** — same state contract incl. a real
  XML parser over `syncPacketXml`, scope-lock round-trip + timeline audit,
  audit contract, DAG lifecycle on a rootPath-less project (exercising the
  skip-dependency path), validation envelopes.
- **Regressions:** Phase 1 **32/32** · Phase 2 **33/33** · Phase 3 **35/35**
  (health assertion made forward-compatible, same convention Phase 3 applied
  to Phase 2).
- **Browser E2E (agent-browser, port 4300):** Command Center renders live
  self-audit data (18 ASTSymbol nodes incl. complexity-100 findings); node
  inspector shows FQN/signature/complexity/edges; scope toggle flips badges
  CTX→IN-SCOPE→LOCKED with toasts; CTO "Lock now" locks a real symbol; DAG
  built + dispatched from the browser with real artifacts ("5046 lines, 913
  symbols" AST scan, "14 models" schema inspect); handoff modal records a
  real SyncHandoff and renders the full XML; standalone preview HTML fully
  interactive; **zero page errors, zero console errors**; 390px viewport has
  no horizontal page overflow (`scrollWidth == 390`).

## 5. API additions

| Method & path | Purpose |
| --- | --- |
| `GET /api/cortex/state?project=` | Full `CortexDashboardStateResponse`: graph DTO, scope lock, active task, telemetry, timeline, CTO recommendations, `<cortex_sync_packet>` XML, audit stats |
| `POST /api/cortex/state` | `TOGGLE_SYMBOL_SCOPE {fqn}` · `SET_SCOPE_LOCK {allowed/locked/forbidden}` · `RESET_SCOPE_LOCK` — returns the recalculated state |
| `GET /api/cortex/cto?project=&force=` | Live audit (recommendations + stats) + DAG plan list |
| `POST /api/cortex/cto` | `RUN_AUDIT` · `BUILD_DAG_PLAN {goal}` · `DISPATCH_PLAN {planId}` · `UPDATE_SUBTASK {planId, subtaskId, status}` · `ARCHIVE_PLAN {planId}` |

Health now reports `0.4.0`, the four `phase4-*` capabilities and
`counts.dagPlans`. Settings gained `cloudEscalationModel`.

## 6. Live demo data

- **SaaS-CRM** (seeded Phase 1–2 demo): 15 memories, 21 nodes, 17 rewrites,
  3 handoffs — telemetry, timeline and advisories render from these real rows.
- **CortexOS Daemon (self-audit)**: dogfood project rooted at the daemon repo
  itself — 344 files scanned into DNA, live audit of 207 source files /
  1,169 symbols, real findings (e.g. `parseInlineFormatting` complexity 100,
  `html2pptx1.js` 5,046 lines, 0 layer violations — the daemon's own
  architecture is clean). Delete it any time via `DELETE /api/cortex/projects/{id}`.

## 7. Manual test checklist

See the chat delivery message for the numbered manual checklist (same steps).
