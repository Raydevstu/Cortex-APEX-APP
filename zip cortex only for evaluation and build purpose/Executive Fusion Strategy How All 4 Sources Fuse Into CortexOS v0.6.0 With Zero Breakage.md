# PHASE 6 — REPOSITORY BRAIN, RIPWIRE REFLEXES & HEADROOM COMPRESSION FUSION BLUEPRINT (`v0.6.0`)

> **Target Architecture:** CortexOS `v0.6.0` (Zero-Breakage Additive Fusion over Phase 1–5C `5181243`)
> **Gated Baseline to Preserve:** `224/224` passing checks (P1 `32/32`, P2 `33/33`, P3 `35/35`, P4 `35/35`, P5 `35/35`, P5C `28/28`, Python `26/26`, ESLint clean)
> **Core Fusion Sources:**
> 1. **Ripwire (`0.6.5`):** Blast-Radius Impact (`by_depth`), Static Test-Gate (`TDAD`), Pre-Flight `--edit-check` Contract Verifier, Parallel Lane Collision Detector (`--plan-lanes`), Six-Family Unblended Quality Panel (`--quality-panel` / `--quality-delta`), Lazy-Body Handles (`@symN` / `@fN`), and Tripwire Honesty Markers (`counts_floor="1"`, `unproven_defs`, `declined_calls`, `truncated_rows`).
> 2. **Headroom (`headroom-ai`):** Reversible Context Compression (`CCR`) with on-demand retrieval handles (`@ccr_...`), `SmartCrusher` statistical JSON/log array compression, `CacheAligner` KV-cache prefix protection, Output Verbosity Shaper, and `cortexos learn` failure mining.
> 3. **Repository Brain & 10-Stage Memory Distillation (`Claude-Mem`):** Raw activity $\rightarrow$ Episodic `Investigation` (`problem`, `rootCause`, `solution`) $\rightarrow$ Durable `KnowledgeFact` with weighted Importance Scoring, Duplicate Merging (`occurrences++`), Recency Decay, Domain Consolidation, and a fixed-budget `1500-token ContextPack` + `.cortex/repo-brain.json`.
> 4. **Agent-Browser:** Stable Short Handle Registry (`@f1`, `@sym12`, `@inv4`, `@fact9`, `@ccr3`) replacing verbose paths/FQNs across prompts, CLI, and MCP calls.

---

## 1. Zero-Breakage Compatibility Contract (Hard Invariants)

1. **All 224 Existing Tests Must Pass Unmodified:**
   - Do **not** rename or remove any Phase 1–5C HTTP endpoints, MCP tools (`10` existing tools), CLI subcommands (`init`, `status`, `scope`, `cto`, `hooks`, `sync`, `watch`), or SQLite/Kuzu tables.
2. **Additive Schema Evolution Only:**
   - New tables (`investigations`, `knowledge_facts`, `ccr_store`, `handle_registry`, `failure_lessons`) are created via `CREATE TABLE IF NOT EXISTS` (or additive Prisma/SQLite migration) on daemon startup.
   - `<cortex_sync_packet>` keeps all existing XML tags and gains additive `<repo_brain_pack>`, `<handle_legend>`, and `<tripwire_disclosure>` sections when available.
3. **Tripwire Honesty Contract on Every Structural Response:**
   - Every graph/impact/test-gate response must include a `tripwire` metadata object:
     ```ts
     export interface TripwireDisclosure {
       countsFloor: boolean;          // true when dynamic dispatch / unresolved imports exist
       unprovenDefs: number;          // declarations without resolved body/callers
       declinedCalls: number;         // ambiguous multi-candidate call sites declined
       truncatedRows: number;         // rows omitted due to token/page budget
       droppedLegendAttrs: string[];  // any attributes omitted for budget
       evidenceBasis: "structural-only" | "structural+git-history" | "structural+episodic-memory";
     }
     ```

---

## 2. Pillar 1 — The 10-Stage Memory Distillation & Repository Brain Engine

### 2.1 File Location
- `src/memory/distillation-engine.ts` (or `.mjs` matching existing daemon module system)
- `src/memory/context-pack-builder.ts`

### 2.2 Storage Tables (SQLite / Brain Store)
Add the following tables alongside existing Project/Graph storage:

```sql
CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  problem TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  solution TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'MEDIUM', -- LOW | MEDIUM | HIGH | CRITICAL
  files_touched_json TEXT NOT NULL DEFAULT '[]',
  tests_suggested_json TEXT NOT NULL DEFAULT '[]',
  importance_score REAL NOT NULL DEFAULT 50.0,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_facts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  domain_entity TEXT NOT NULL,               -- e.g., "Authentication", "GraphEngine", "Watcher"
  category TEXT NOT NULL,                    -- architecture | workflow | dependency | risk | failure_cause | fix
  content TEXT NOT NULL,
  normalized_hash TEXT NOT NULL,             -- for Stage 6 semantic/lexical duplicate merging
  occurrences INTEGER NOT NULL DEFAULT 1,
  architecture_impact REAL NOT NULL DEFAULT 50.0,
  dependency_impact REAL NOT NULL DEFAULT 50.0,
  task_frequency REAL NOT NULL DEFAULT 50.0,
  confidence REAL NOT NULL DEFAULT 0.9,
  importance_score REAL NOT NULL DEFAULT 50.0,
  effective_score REAL NOT NULL DEFAULT 50.0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, normalized_hash)
);

CREATE TABLE IF NOT EXISTS handle_registry (
  project_id TEXT NOT NULL,
  handle TEXT NOT NULL,                      -- @f1, @sym12, @inv3, @fact7
  kind TEXT NOT NULL,                        -- file | symbol | investigation | fact | ccr
  target_ref TEXT NOT NULL,                  -- path, FQN, or record ID
  signature_preview TEXT NOT NULL DEFAULT '',
  body_hash TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, handle),
  UNIQUE (project_id, kind, target_ref)
);
```

### 2.3 The 10-Stage Distillation Pipeline (`DistillationWorker`)
Whenever `POST /memory/extract` runs (from MCP, Git `post-commit`, or `watcher_daemon.py`), run the extracted turn/diff through the **10-Stage Distillation Pipeline**:

1. **Stage 1 — Event Filtering:** Strip navigation noise (`FILE_VIEWED`, scrolling, raw chatter). Keep `FILE_MODIFIED`, `ERROR_FOUND`, `FIX_APPLIED`, `TEST_RUN`, and architectural decisions.
2. **Stage 2 — Episodic Investigation Builder:** Synthesize raw events into an `Investigation` record (`title`, `problem`, `rootCause`, `solution`, `filesTouched`, `testsSuggested`).
3. **Stage 3 — Durable Fact Extraction:** Extract atomic `KnowledgeFact` items categorized as `architecture`, `workflow`, `dependency`, `risk`, `failure_cause`, or `fix`.
4. **Stage 4 — Entity Recognition:** Bind every fact to a canonical `domain_entity` (e.g., `Authentication`, `ASTSentinel`, `MCPBridge`, or module name).
5. **Stage 5 — Knowledge Graph Linking:** Upsert graph edges (`DEPENDS_ON`, `CAUSES`, `SOLVES`, `USES`) between the `domain_entity`, touched `File` nodes, and `AstSymbol` nodes.
6. **Stage 6 — Duplicate Detection & Reinforcement:** Compute a canonical normalized token fingerprint (`normalized_hash`). If an equivalent fact already exists for `project_id`, do **not** insert a duplicate row—increment `occurrences = occurrences + 1` and update `updated_at`.
7. **Stage 7 — Weighted Importance Scoring:**
   $$\text{importance} = 0.35 \times \text{architectureImpact} + 0.25 \times \text{dependencyImpact} + 0.20 \times \text{taskFrequency} + 0.10 \times \text{recency} + 0.10 \times (\text{confidence} \times 100)$$
   Facts scoring $< 25.0$ are discarded immediately.
8. **Stage 8 — Episodic Compression:** Compress multi-thousand-token transcripts into compact `<200`-token structured JSON summaries (~90% reduction).
9. **Stage 9 — Memory Aging & Decay:**
   $$\text{effectiveScore} = \text{importance} \times \ln(1 + \text{occurrences}) \times \exp\left(-\frac{\text{ageDays}}{180}\right)$$
   Facts below threshold after decay are marked `archived = 1`.
10. **Stage 10 — Brain Consolidation & `.cortex/repo-brain.json` Export:**
    Aggregate active facts and investigations by `domain_entity` (`keyFacts`, `commonProblems`, `knownSolutions`, `riskAreas`, `importantModules`) and write `.cortex/repo-brain.json` atomically.

### 2.4 Fixed-Budget `ContextPack` Builder (`<= 1500 Tokens`)
Implement `buildContextPack(projectId, taskQuery, maxTokens = 1500)`:
- Hybrid retrieval across:
  1. **Keyword / BM25 subtoken match** on `taskQuery`
  2. **Entity match** (`domain_entity`, symbol names, file paths)
  3. **1-Hop Graph Expansion** (corroborated neighbors reached by $\ge 2$ anchors sort first via `shared=` count)
  4. **Episodic Investigations** matching past bugs/root causes
- Ranks candidates by `relevance * effectiveScore * recency`, selects Top-K (max 15 memories), and guarantees the serialized `ContextPack` never exceeds `maxTokens` (default `1500` tokens), disclosing any cut rows in `tripwire.truncatedRows`.

---

## 3. Pillar 2 — Ripwire Structural Reflexes & Pre-Flight Safety Engine

### 3.1 File Location
- `src/intelligence/ripwire-reflexes.ts` (or `.mjs`)

### 3.2 Reflex 1: Depth-Labelled Impact & Blast Radius (`computeImpactAnalysis`)
Given a target file path, symbol FQN, or short handle (`@sym12` / `@f3`):
- Traverse callers/dependents via BFS up to `maxDepth` (default `4`), sorting **nearest-first** (`d=1`, `d=2`, `d=3`, `d=4`) so any budget cut drops the deepest rows first.
- Keep `reaches` (symbol-level callers) and `importers` (file-level module imports) **strictly separate** (never summed into one unit).
- Compute `corroboratedSharedCount` (`shared=`): how many task anchor symbols connect to each neighbor.
- Compute deterministic `riskScore` (`LOW | MEDIUM | HIGH | CRITICAL`) from transitive dependents, change frequency (git commits), test reachability, and complexity.
- Attach `TripwireDisclosure` (`countsFloor: true`, `unprovenDefs`, `declinedCalls`, `byDepth` breakdown).

### 3.3 Reflex 2: Static Test-Gate (`computeTestGate` — TDAD `arXiv:2603.17973`)
Given modified files or symbol FQNs:
- Trace reverse call/import paths to discover all test files (`*.test.*`, `*.spec.*`, `tests/**`) that directly or transitively reach the modified symbols.
- Combine with historical co-change frequency from `GitCommit` rows and past `Investigation.testsSuggested`.
- Return a deterministic ranked list of `testsToRun` with `reachDepth` (`d=1` direct unit test, `d=2` integration test, `d=3` E2E suite) and coverage gap warnings (`untestedSymbols`).

### 3.4 Reflex 3: Pre-Flight In-Memory `--edit-check` (`verifyProposedEdit`)
Before an agent writes a file or during `/hooks/pre-execute`:
- Accept `{ targetSymbolOrFile, proposedContent }`.
- Re-parse `proposedContent` in memory without modifying disk.
- Compare the before/after symbol table for the target:
  - Did exported function/method **signatures or arity** change?
  - Did removed exports still have active callers in the graph?
  - Did the edit touch a symbol locked via `cortexos scope --lock`?
  - Did the edit introduce placeholder stubs (`TODO`, `FIXME`, empty bodies)?
- Return `{ contractChanged, signatureDiffs, brokenCallers, placeholderStubsAdded, unprovenDefs,incompatibleCallSites, tripwire }`.
- Note: When `unprovenDefs > 0` alongside `incompatibleCallSites === 0`, explicitly flag `incompleteReadWarning: true` per Ripwire 0.6.1 honesty rules.

### 3.5 Reflex 4: Parallel Multi-Agent Lane Collision Detector (`planExecutionLanes`)
Upgrade `BUILD_DAG_PLAN` in the AI CTO engine (`src/orchestrator/ai-cto-engine.ts`):
- Given $N$ proposed subtask lanes, compute each lane's predicted write-set and 1-hop blast radius **before a single line of code is written**.
- Detect pairwise symbol/file collisions (`collisionSites`: two parallel waves touching the same file or caller-callee contract).
- Automatically re-order colliding subtasks into sequential waves (`landingOrder`) and attach an advisory execution profile:
  ```ts
  executionProfile: {
    recommendedTier: "local-ollama" | "cloud-sonnet" | "cloud-opus",
    reasoningEffort: "low" | "medium" | "high",
    evidenceBasis: "structural-only",
    policyVersion: "v0.6.0"
  }
  ```

### 3.6 Reflex 5: Six-Family Unblended Quality Panel (`computeQualityPanel` & `computeQualityDelta`)
Replace single-number opaque complexity scores in AI CTO audits with Ripwire's **Six Independent Families of Evidence**:
1. `structural`: cyclomatic complexity, symbol body line count, parameter count, nesting depth.
2. `lexical`: identifier naming consistency & readability rules.
3. `confusion`: atoms-of-confusion patterns (nested ternaries, shadowed identifiers, ambiguous mutations).
4. `historical`: git churn frequency per file (`GitCommit` history).
5. `colocation`: external context ratio (outbound cross-file dependencies vs internal cohesion).
6. `nonlocal_state`: mutations of module-global or shared external state.
- **Unblended Ranking Rule:** Rank symbols by the **integer count of distinct families that fire** (`firedFamiliesCount`, e.g., `3 of 4 strict families`, with `families="6" enabled_n="4"` in strict gating mode where `historical` and `colocation` are advisory-only).
- **`qualityDelta` (`11th kind` placeholder check):** Given a diff or modified file, report only what the change **made worse**, plus any newly added `TODO`/`FIXME`/stub placeholders per symbol.

---

## 4. Pillar 3 — Headroom Reversible Context Compression (CCR) & Cache Aligner

### 4.1 File Location
- `src/compression/headroom-ccr.ts` (or `.mjs`)

### 4.2 Storage Table (`ccr_store`)
```sql
CREATE TABLE IF NOT EXISTS ccr_store (
  ccr_id TEXT PRIMARY KEY,                   -- e.g., "@ccr_a1b2c3d4"
  project_id TEXT NOT NULL,
  content_type TEXT NOT NULL,                -- json_array | log_stream | code_ast | transcript
  original_content TEXT NOT NULL,
  compressed_content TEXT NOT NULL,
  original_tokens INTEGER NOT NULL,
  compressed_tokens INTEGER NOT NULL,
  preserved_markers_json TEXT NOT NULL,      -- e.g., ["FATAL", "Error:", "outlier_row_42"]
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
```

### 4.3 `ContentRouter` & `SmartCrusher`
Implement `compressContextPayload({ projectId, content, contentType, model })`:
1. **`SmartCrusher` (for JSON Arrays & Logs):**
   - For repeated JSON arrays or long test/build logs:
   - Always preserve **first and last boundary items**, **100% of items containing error/fatal/exception markers** (`FATAL`, `ERROR`, `FAIL`, `422`, stack frames), and **statistical outliers** (numeric fields $> 2\sigma$ from mean).
   - Collapse repetitive middle items into a schema summary + count, storing the full original text in `ccr_store` under handle `@ccr_<hash8>`.
   - Append retrieval footer: `[CCR @ccr_<hash8>: compressed 4,800 -> 420 tokens (91.2% saved). Call cortex_ccr_retrieve("@ccr_<hash8>") for exact original bytes.]`
2. **`CodeCompressor` (Lazy-Body Handle Mode):**
   - Strip function bodies from non-anchor files (`bundle=compact bodies=0`), emitting only signatures + stable handle `@sym<N>` so agents pay for bodies only when calling `--expand=@sym<N>`.
3. **`CacheAligner` (KV-Cache Prefix Protection):**
   - Split outgoing prompt context into:
     - `frozenPrefix`: deterministic Project DNA + stable Architecture Facts + Handle Legend (never mutated mid-session so Anthropic/OpenAI prompt caches achieve 100% prefix hits).
     - `liveZoneTail`: volatile timestamps, dynamic turn counters, and latest compressed tool outputs.
   - Flag any volatile pattern detected inside the prefix (`volatilePrefixWarnings`).
4. **Output Shaper & Failure Learning (`cortexos learn`):**
   - `outputShaper`: optional terse system-prompt suffix (`"Be terse. Do not restate unchanged code or preamble ceremony."`) appended to the tail.
   - `learnFromFailures(projectId)`: mines rejected PreToolUse 422 events, failed test gates, and recurring bug investigations to synthesize actionable guardrails into `.cortex/LEARNED_GUARDRAILS.md` (and optionally `CLAUDE.local.md` / `AGENTS.md`).

---

## 5. Pillar 4 — Agent-Browser Stable Short Handle System (`@f`, `@sym`, `@inv`, `@fact`, `@ccr`)

### 5.1 Handle Resolution Everywhere
- Every file indexed in a project receives a deterministic short handle `@f1`, `@f2`, … sorted by path/PageRank.
- Every AST symbol receives `@sym1`, `@sym2`, …
- Every episodic investigation receives `@inv1`, `@inv2`, …
- Every distilled knowledge fact receives `@fact1`, `@fact2`, …
- Every reversible compression blob receives `@ccr_<hash8>`.
- **Universal Handle Resolver (`resolveHandleOrRef(projectId, ref)`):**
  - Any API endpoint, CLI flag (`cortexos scope --lock @sym12`, `cortexos impact @f3`), or MCP tool (`cortex_impact`, `cortex_state`, `cortex_ccr`) accepts either a short handle (`@sym12`) or full FQN/path (`src/auth/AuthService.ts#refreshToken`).

---

## 6. Daemon HTTP API, MCP Server & CLI Surface Additions

### 6.1 New Daemon HTTP Endpoints (Mirrored on `:3000` and `/api/cortex/*`)
1. `POST /brain/distill` & `GET /brain/pack?project=<slug>&task=<query>&budget=1500`
   - Runs or queries the 10-Stage Distillation Engine, returns the fixed-budget `ContextPack`, `.cortex/repo-brain.json` summary, and `handleLegend`.
2. `POST /reflex/impact`
   - Input: `{ project, target, maxDepth }` $\rightarrow$ Returns depth-labelled `byDepth` callers, separate `importers`, `corroboratedSharedCount`, `riskScore`, and `tripwire`.
3. `POST /reflex/test-gate`
   - Input: `{ project, targets }` $\rightarrow$ Returns ranked `testsToRun` (`d=1..3`), co-change tests, and `untestedSymbols`.
4. `POST /reflex/edit-check`
   - Input: `{ project, target, proposedContent }` $\rightarrow$ In-memory AST re-parse, signature/arity diff, broken callers, scope-lock check, placeholder stub check, and `tripwire`.
5. `POST /reflex/quality-panel`
   - Input: `{ project, preset: "strict" | "default" | "lenient", diffTargets? }` $\rightarrow$ 6-family unblended counts + `qualityDelta` placeholder check.
6. `POST /reflex/plan-lanes`
   - Input: `{ project, lanes: [{ id, title, targets }] }` $\rightarrow$ Pairwise collision sites, safe `landingOrder` waves, and `executionProfile`.
7. `POST /ccr/compress` & `GET /ccr/retrieve?id=@ccr_...`
   - Reversible `SmartCrusher` / `CodeCompressor` + `CacheAligner` split + exact original byte retrieval.
8. `POST /brain/learn`
   - Mines failed sentinel/session events and writes `.cortex/LEARNED_GUARDRAILS.md` (or `--target CLAUDE.local.md`).
9. `GET /reflex/html-map?project=<slug>&colorBy=lang|community|cx|churn|tested`
   - Generates a single self-contained, zero-CDN HTML interactive force-directed call graph (`--html --color-by`) with a live 5-lens selector using a colorblind-safe 5-stop blue-to-orange scale.

### 6.2 New MCP Tools (Bringing Total MCP Stdio Tools from `10` $\rightarrow$ `13`, with `--mcp-tools=core` Profile Support)
Add 3 high-leverage composite MCP tools over stdio:
1. `cortex_reflex` — Unified Ripwire Reflexes over stdio:
   - Actions: `IMPACT` | `TEST_GATE` | `EDIT_CHECK` | `QUALITY_PANEL` | `PLAN_LANES` | `EXPAND_HANDLE`
2. `cortex_brain` — Repository Brain & 10-Stage Distillation over stdio:
   - Actions: `CONTEXT_PACK` | `DISTILL_SESSION` | `LIST_INVESTIGATIONS` | `LIST_FACTS` | `LEARN_GUARDRAILS`
3. `cortex_ccr` — Headroom Reversible Compression & Cache Aligner over stdio:
   - Actions: `COMPRESS` | `RETRIEVE` | `ALIGN_CACHE` | `STATS`
- Also support `--mcp-tools=core|<comma-list>` on the MCP server entrypoint so users can expose either the full `13`-tool suite (default, preserving 100% backward compatibility) or a lean `core` profile.

### 6.3 New Unified CLI Subcommands (`scripts/cortexos-cli.mjs` / `bin/cortexos.mjs`)
All subcommands must support `--json` and `--project <slug>`:
- `cortexos pack --for "<task>" [--budget 1500] [--compact]` $\rightarrow$ Prints the fixed-budget `ContextPack` with `@f`/`@sym` handles, distilled facts, relevant past investigations, and `tripwire` footer.
- `cortexos impact <targetOrHandle> [--depth 4]` $\rightarrow$ Depth-labelled blast radius (`d=1..4`), separate `importers=`, risk level, and `tripwire` honesty markers.
- `cortexos test-gate <targetOrHandle...>` $\rightarrow$ Exact tests to run before commit (`d=1` unit, `d=2` integration, `d=3` E2E).
- `cortexos edit-check <targetOrHandle> --file <proposedFile>` $\rightarrow$ Pre-flight contract/arity/caller breakage check in milliseconds.
- `cortexos quality [--preset strict|default|lenient] [--delta]` $\rightarrow$ 6-family unblended quality panel + placeholder stub detector.
- `cortexos ccr (compress --input <file> | retrieve <@ccr_id> | stats)` $\rightarrow$ Reversible compression & lossless recall.
- `cortexos learn [--apply] [--target .cortex/LEARNED_GUARDRAILS.md]` $\rightarrow$ Mines session failures and sentinel rejections into persistent agent guardrails.
- `cortexos wrap <agent> [--unwrap] [--dry-run]` $\rightarrow$ Probes and emits/installs ready-to-run MCP + guardrail wiring for `claude`, `codex`, `cursor`, `opencode`, `hermes`, `aider`, or `gemini`.
- `cortexos map-html [--color-by lang|community|cx|churn|tested] [--out .cortex/call-graph.html]` $\rightarrow$ Self-contained zero-CDN interactive HTML call graph with live 5-lens switcher.

---

## 7. Gated Verification & Test Suite Requirements (`npm run test:p6`)

Create `tests/phase6-fusion.test.mjs` (or equivalent runner) plus Python contract tests covering at least **38 deterministic checks**:

1. **10-Stage Distillation & Deduplication (8 checks):**
   - Raw noisy events (`FILE_VIEWED`) filtered out; `Investigation` (`problem`, `rootCause`, `solution`) created.
   - Repeated equivalent facts merge via `normalized_hash` (`occurrences: 2`) instead of duplicating rows.
   - Importance scoring discards low-value trivia (`score < 25`) and retains high-impact architectural facts.
   - `.cortex/repo-brain.json` generated atomically; `buildContextPack` respects `<= 1500` token ceiling and sets `tripwire.truncatedRows` when capped.
2. **Short Handle Registry (`@f`, `@sym`, `@inv`, `@fact`, `@ccr`) (5 checks):**
   - Handles assigned deterministically; `cortexos scope --lock @sym1` locks the underlying FQN and triggers the 422 PreToolUse sentinel on staged modification.
   - `EXPAND_HANDLE` returns exact symbol body on demand while default compact packs ship `bodies=0`.
3. **Ripwire Structural Reflexes & Tripwire Honesty (12 checks):**
   - `IMPACT`: nearest-first `byDepth` (`d=1`, `d=2`), `importers` never summed into `reaches`, `countsFloor: true` disclosed.
   - `TEST_GATE`: maps modified symbol to direct/transitive test files (`*.test.*` / `*.spec.*`).
   - `EDIT_CHECK`: detects breaking signature/arity change in memory without touching disk; sets `incompleteReadWarning: true` if `unprovenDefs > 0` beside `incompatibleCallSites === 0`.
   - `QUALITY_PANEL`: scores 6 families unblended (`firedFamiliesCount`), strict preset gates on `4 of 6` (`enabled_n: 4`), and `qualityDelta` flags newly added `TODO`/`FIXME` stubs.
   - `PLAN_LANES`: detects pairwise multi-agent lane write/blast-radius collisions and computes safe `landingOrder` waves with `evidenceBasis: "structural-only"`.
4. **Headroom CCR, SmartCrusher & CacheAligner (7 checks):**
   - `SmartCrusher` compresses a 100-item repetitive JSON/log payload by $>75\%$ while preserving 100% of `FATAL`/`ERROR` lines, statistical outliers, and first/last items.
   - `cortex_ccr` (`RETRIEVE`) restores the exact byte-for-byte original from `@ccr_<hash8>`.
   - `CacheAligner` keeps `frozenPrefix` byte-identical across turns while isolating dynamic data in `liveZoneTail`.
5. **CLI, Self-Contained HTML Map, `cortexos learn`, `cortexos wrap`, & MCP Stdio Round-Trips (6 checks):**
   - All new CLI subcommands (`pack`, `impact`, `test-gate`, `edit-check`, `quality`, `ccr`, `learn`, `wrap --dry-run`, `map-html`) exit `0` with valid `--json` output.
   - Stdio MCP server lists `13` tools by default (and `8` under `--mcp-tools=core`) and executes functional round-trips for `cortex_reflex`, `cortex_brain`, and `cortex_ccr`.
   - Full regression sweep: Phase 1 (`32/32`), Phase 2 (`33/33`), Phase 3 (`35/35`), Phase 4 (`35/35`), Phase 5 (`35/35`), Phase 5C (`28/28`), Python TDD (`26/26+`), and ESLint clean.
