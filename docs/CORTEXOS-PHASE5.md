# CortexOS — Phase 5 Implementation: Unified CLI, Git Memory Loop & Fail-Open Spooling

**Version:** 0.5.0 · **Blueprint:** PHASE_5_CLI_GIT_HOOKS_AND_WATCHER_BLUEPRINT (§1–§6, Parts A + B) ↔ Core Blueprint v2 Phase 5
**Status:** ✅ Implemented — 35/35 Phase 5 Node tests + 32/32 Phase 1 + 33/33 Phase 2 + 35/35 Phase 3 + 35/35 Phase 4 regressions + 9/9 Python TDD tests passing

---

## 1. What Phase 5 delivers (per blueprint)

> Phase 5 closes the developer ergonomics and zero-touch automation loop: a
> unified `cortexos` CLI over the whole daemon surface, and a Git
> post-commit → `cortex_extract_memory` loop with fail-open offline spooling.

| Blueprint deliverable | Implementation | Where |
| --- | --- | --- |
| **Part A — Unified `cortexos` CLI** (`status` / `scope` / `cto` / `hooks`, `--json` on every subcommand, daemon + project resolution per §3.1) | `scripts/cortexos-cli.mjs` (+ `bin/cortexos.mjs` bin entry, `package.json` → `"cortexos"`). Smart daemon resolution: `--daemon-url` → `CORTEX_DAEMON_URL` → `CORTEX_BASE_URL` → `.cortex/daemon.json` → live probe of `:3000`/`:4300` → default. Project resolution: `--project` → `CORTEX_PROJECT` → `.cortex/daemon.json` slug → `.cortex/project-dna.json` → `cortexos-daemon-self-audit` | `scripts/cortexos-cli.mjs`, `bin/cortexos.mjs` |
| `cortexos status [--project] [--xml] [--json]` | CLI view of the Visual Command Center: graph counts **by label**, token-savings %, locked symbol FQNs, top CTO recommendations, latest timeline event; `--xml` appends the injectable `<cortex_sync_packet>` | `handleStatus` |
| `cortexos scope (--list \| --lock <fqn...> [--exact] \| --unlock <fqn...> \| --toggle <fqn> \| --reset)` | Full AST Semantic Scope Lock lifecycle over `POST /api/cortex/state` (`SET_SCOPE_LOCK` merge/exact, `TOGGLE_SYMBOL_SCOPE`, `RESET_SCOPE_LOCK`). Locks are enforced for real by the Phase 3 staging sentinel | `handleScope` |
| `cortexos cto (audit [--force] \| plan --goal [--execute] \| dispatch --plan-id \| archive --plan-id)` | Terminal interface to `/api/cortex/cto`; `--execute` chains `DISPATCH_PLAN` (wave-1 local subtasks really run through the Phase 3 tool runner, cloud subtasks get Tier-1 payloads printed for pasting) | `handleCto` |
| **Part B — Git hook → `cortex_extract_memory` loop** | `cortexos hooks install` writes an idempotent, executable `.git/hooks/post-commit` shim (marker-bracketed managed block; supersedes the Phase 2 node hook; chains after foreign sh **and** node hooks) + `.cortex/daemon.json` repo config + `.gitignore` hygiene. Every commit then: ① POST `/api/cortex/hooks/git` (GitCommit row, `git.commit` timeline event, Knowledge-Graph file refresh, deterministic bug auto-resolution — hash-deduped, replay-safe) ② POST `/api/cortex/memory/extract` (Engine 3: synthesized 2-turn transcript + regex-AST symbol diff → memories with dedupe/supersede, `memory.delta_applied` timeline event, episodic index) | `installHook`, `runPostCommit`, `collectCommit`, `parsePatchSymbols`, `buildExtractionBodies` |
| Commit metadata + touched files + modified AST symbols | `git log -1 --pretty=%H%x00%an%x00%aI%x00%s%x00%b`, `git diff-tree --root --name-status -r`, `git show --unified=0 --first-parent` → per-file added/modified top-level symbols (`function`/`class`/`export const`/`interface`/`type`/`enum` for JS-TS, `def`/`class` at any indent for Python) with FQNs in the `<path>#<symbol>` graph convention | `collectCommit` |
| **Fail-open offline spooling** (`.cortex/spool/pending-git-commits.jsonl`) | Daemon unreachable or 5xx → append the structured entry, **exit 0** (`git commit` never fails). `cortexos hooks flush-spool`: FIFO replay, in-file dedupe by `commitSha`, cross-run dedupe via the pinned `sessionId` (`git-commit-<shortSha>` → `Interaction.sessionId`), network failure stops and keeps the remainder, 4xx poison entries are dropped with a warning, atomic spool rewrite (tmp + rename) | `appendSpool`, `readSpool`, `rewriteSpool`, `flushSpool` |

### Daemon-side contract additions (all backward compatible)

| Change | Why |
| --- | --- |
| `ExtractSourcePlatform = AIPlatform \| 'git-hook'` (+ `EXTRACT_SOURCE_PLATFORMS`) | commits are first-class extraction sources; sync `targetPlatform` enum untouched |
| `POST /api/cortex/memory/extract` | Blueprint §3.2 canonical URL — alias of the Phase 3 Engine 3 route (`/api/cortex/extract`) |
| `/extract` + Engine 3 accept optional `sessionId` → pins `turnId` | SHA-stable dedupe for spool replay (`Interaction.sessionId = git-commit-<shortSha>`) |
| `/cto` POST accepts `action: "AUDIT"` (alias of `RUN_AUDIT`) | Blueprint §3.2 action name for `cortexos cto audit --force` |
| Health → `0.5.0`, `Phase 5 — Unified CLI & Git Memory Loop`, capabilities `phase5-unified-cli`, `phase5-git-memory-loop` | Phase 5 heartbeat (Phase 4 test assertions made forward-compatible, the convention Phase 3 established) |

## 2. Verification

- **Phase 5 Node suite** (`npm run test:p5`, default `http://localhost:3000`):
  **35/35** — health v0.5.0 + capabilities; CLI help/error envelopes (unknown
  command/flag exit 1, unreachable daemon hint, unknown project 404); bin
  entry; `status` human/`--xml`/`--json` (≥ 40 real graph nodes on the
  self-audit project); fixture workspace with genuine complexity hotspot +
  ui→storage drift; the full `scope` lifecycle (list, multi-FQN merge,
  additivity, `--exact` replace, toggle into the allowed set, unlock, reset to
  the deterministic seed — every step verified against the persisted daemon
  state); **AST Sentinel enforcement through the CLI** (staged env-example
  modify → 422 while locked via `cortexos scope --lock` → applies after
  `--unlock`, merged keys verified on disk); `cto` audit (real
  `parseInlineFormatting` finding, `--force` fresh scan, `--json` contract),
  plan → dispatch (wave-1 local tools really execute) → archive, and
  `plan --execute` chaining; `hooks install` (executable shim, daemon.json,
  `.gitignore`, idempotent refresh, foreign sh + node hook chaining with both
  halves proven to run); **real-commit round-trip** (interaction
  `git-commit-<shortSha>` on platform `git-hook`, detected AST symbols in the
  transcript, ≥ 2 extracted memories — todo + bug, `git.commit` timeline
  event, GitCommit counter); **offline spooling** (`git commit` succeeds with
  the daemon down, direct spool with exit 0, FIFO flush replay, duplicate SHA
  skip, empty-queue no-op, spool file removed); MCP 10-tool regression;
  cascade cleanup.
- **Regressions:** Phase 1 **32/32** · Phase 2 **33/33** · Phase 3 **35/35**
  · Phase 4 **35/35** (health assertion forward-compatible) · Python TDD
  **9/9** · ESLint clean (including two pre-existing `no-assign-module-variable`
  errors in `memory-delta.ts` fixed).

## 3. Manual usage

```sh
npm run dev                                  # daemon on :3000
cortexos status --xml                        # or: node bin/cortexos.mjs status --xml
cortexos scope --lock "src/lib/packet.ts#buildSyncPacket"
cortexos cto audit --force
cortexos cto plan --goal "add Stripe billing" --execute
cortexos hooks install --dir . --project my-project
git commit -m "feat: ..."                    # → memories + graph + timeline, automatically
cortexos hooks flush-spool                   # after any offline period
```

The `cortexos` bin is live via `package.json` (`npm link` / `npm exec`), and
every subcommand supports `--json` for scripting.
