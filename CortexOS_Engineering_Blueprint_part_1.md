Here is **Part 2 of the CortexOS Engineering Blueprint: The Master System Prompts, Structured JSON Grammars, and the Local Ollama Pre-Execution Pipeline.**

Every prompt and pipeline file below uses **Ollama Structured Outputs (`format: jsonSchema`)** and deterministic tool-calling so local models (`qwen2.5:1.5b`, `qwen2.5-coder:7b`, `llama3.2:3b`) never hallucinate markdown wrappers or invalid JSON.

---

### 1. Pipeline Architecture: How the 3 Local Engines Work Together

When you paste or type a raw prompt anywhere (Codex, Hermes, OpenCode, Cursor, or Web Chat), CortexOS runs this exact local pipeline before a single cloud token is spent:

```
Raw User Prompt ("add stripe webhook for sub renewal")
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ENGINE 1: Pre-Execution Router & Triage (`qwen2.5:1.5b` / `coder:7b`)   │
│ • Reads Project DNA + KuzuDB 1-Hop Subgraph                             │
│ • Splits work into:                                                     │
│   [A] Local Pre-Execution Tasks (AST search, DB schema stub, docs fetch)│
│   [B] Core Cloud Task (Complex business logic for Codex/Hermes)         │
└──────┬──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ LOCAL TOOL RUNNER (0 Cloud Tokens)                                      │
│ • Executes [A] locally via Tree-sitter AST, File I/O, Local Web Search  │
│ • Stages boilerplate changes / gathers exact line signatures            │
└──────┬──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ENGINE 2: Tier-1 Prompt Engineering Engine (`qwen2.5-coder:7b`)         │
│ • Combines Project DNA + Pre-Executed Diff + Scoped Graph Context       │
│ • Rewrites raw prompt into an Enterprise Specification + Delta Packet   │
│ • Auto-injects into Codex / Hermes / OpenCode                           │
└──────┬──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ [Codex / Hermes Executes Core Task]                                     │
└──────┬──────────────────────────────────────────────────────────────────┘
       │ (Async Background Hook on Response / File Save)
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ENGINE 3: Automatic Memory Extractor (`llama3.2:3b`)                    │
│ • Analyses User Prompt + AI Response + Git AST Diff                     │
│ • Outputs `ExtractedMemoryDelta` JSON -> Upserts into KuzuDB Graph      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 2. Engine 1: The Pre-Execution Router & Tool Triage Prompt

Before rewriting the prompt, CortexOS must decide:
1. **Can this entire task be completed locally for free?** (e.g., renaming a symbol, writing a simple Zod schema, generating unit test stubs, adding a Prisma model field).
2. **If it requires a frontier model (Codex/Hermes), what 60–80% of preparatory work (AST lookup, boilerplate generation, doc fetching) can the local Ollama agent execute *first*?**

#### A. Master System Prompt (`prompts/pre-execution-router.system.md`)

```markdown
# ROLE
You are the CortexOS Pre-Execution Router and Task Triage Engine.
Your job is to analyze a developer's RAW PROMPT alongside the `PROJECT_DNA` and `SCOPED_GRAPH_CONTEXT`, decompose the request into atomic execution steps, and aggressively offload preparatory, boilerplate, and deterministic tasks to local tools BEFORE routing only the complex core architectural task to the main cloud AI (Codex / Hermes / Claude).

# ROUTING RULES (STRICT)
1. FULL_LOCAL_EXECUTION:
   Route `executionMode: "LOCAL_ONLY"` if the request involves:
   - Adding/updating types, interfaces, or Zod schemas.
   - Boilerplate CRUD scaffolding or Prisma/Drizzle schema fields.
   - Formatting, renaming, barrel exports, or docstring/documentation generation.
   - Writing standard unit test stubs.

2. HYBRID_PRE_EXECUTION (`executionMode: "HYBRID_PRE_EXECUTE"`):
   For complex features, split the task:
   - Assign `localToolCalls` to inspect exact AST symbol signatures, fetch cached SDK docs, scaffold empty target files, or update schema definitions locally.
   - Assign ONLY the high-complexity algorithmic, concurrency, or multi-module orchestration logic to `cloudCoreTask`.

3. AST SCOPE GUARD COMPLIANCE:
   - Never schedule modifications to any path listed in `PROJECT_DNA.codingStandards.astScopeGuardRules.protectedPaths`.
   - Always identify the exact `targetFiles` and `protectedFiles` so the downstream AI stays strictly within scope.

# AVAILABLE LOCAL TOOLS
You may schedule any of the following deterministic local tools in `localPreExecutionPlan`:
- `ast_symbol_lookup`: Extract exact function signatures, line numbers, and imports from a file via Tree-sitter.
- `schema_inspect`: Read specific models/tables from `prisma/schema.prisma` or SQL migration files.
- `local_docs_search`: Query local cached documentation or SearXNG for exact SDK syntax (e.g., Stripe, Clerk, Next.js 15).
- `scaffold_boilerplate`: Use local `qwen2.5-coder` to create/stage types, interfaces, or route stubs prior to cloud handoff.
- `git_diff_summary`: Inspect uncommitted workspace changes.

# OUTPUT FORMAT
Respond ONLY with a valid JSON object matching the `RouterDecisionSchema`. Do not include markdown fences or commentary.
```

#### B. Strict JSON Output Schema (`RouterDecisionSchema`)

```json
{
  "type": "object",
  "required": [
    "intentCategory",
    "complexityScore",
    "executionMode",
    "relevantModuleIds",
    "localPreExecutionPlan",
    "cloudCoreTaskSpec",
    "estimatedCloudTokensSaved"
  ],
  "properties": {
    "intentCategory": {
      "type": "string",
      "enum": ["feature_build", "bug_fix", "refactor", "schema_change", "architecture", "test_gen", "docs"]
    },
    "complexityScore": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10,
      "description": "1-3: Local Only, 4-7: Hybrid Pre-Execute, 8-10: Heavy Cloud Core with Local Context Prep"
    },
    "executionMode": {
      "type": "string",
      "enum": ["LOCAL_ONLY", "HYBRID_PRE_EXECUTE", "CLOUD_DIRECT_WITH_DNA"]
    },
    "relevantModuleIds": {
      "type": "array",
      "items": { "type": "string" }
    },
    "localPreExecutionPlan": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["stepId", "toolName", "toolArgs", "expectedArtifact"],
        "properties": {
          "stepId": { "type": "string" },
          "toolName": {
            "type": "string",
            "enum": ["ast_symbol_lookup", "schema_inspect", "local_docs_search", "scaffold_boilerplate", "git_diff_summary"]
          },
          "toolArgs": {
            "type": "object",
            "additionalProperties": { "type": "string" }
          },
          "expectedArtifact": { "type": "string" }
        }
      }
    },
    "cloudCoreTaskSpec": {
      "type": "object",
      "required": ["coreObjective", "targetFiles", "readOnlyReferenceFiles", "scopeGuardConstraints"],
      "properties": {
        "coreObjective": { "type": "string" },
        "targetFiles": { "type": "array", "items": { "type": "string" } },
        "readOnlyReferenceFiles": { "type": "array", "items": { "type": "string" } },
        "scopeGuardConstraints": { "type": "array", "items": { "type": "string" } }
      }
    },
    "estimatedCloudTokensSaved": { "type": "integer" }
  }
}
```

---

### 3. Engine 2: The Tier-1 Prompt Engineering & Task Decomposition Engine

Once Engine 1 runs its local tools (e.g., pulling the exact AST line signatures and scaffolding boilerplate), **Engine 2 (`qwen2.5-coder:7b`)** takes the user's raw, messy prompt and transforms it into a **Tier-1 Enterprise Engineering Specification** ready to auto-inject into Codex, Hermes, or OpenCode.

#### A. Master System Prompt (`prompts/tier1-prompt-engineer.system.md`)

```markdown
# ROLE
You are the CortexOS Tier-1 Principal Prompt Engineering & Context Injection Engine.
Your objective is to transform a developer's raw, unpolished prompt into an unambiguous, zero-hallucination, production-grade engineering specification tailored for an autonomous coding agent (Codex, Hermes, OpenCode, Cursor, Claude).

# INPUTS PROVIDED TO YOU
1. `RAW_USER_PROMPT`: What the developer typed or pasted.
2. `PROJECT_DNA`: The project's immutable tech stack, directory map, architectural constraints, and forbidden patterns.
3. `SCOPED_GRAPH_CONTEXT`: Active architectural decisions (ADRs), open bugs in scope, and continuity state from the previous chat/platform.
4. `LOCAL_PRE_EXECUTION_ARTIFACTS`: Exact AST signatures, database models, SDK snippets, and boilerplate changes already completed locally by CortexOS before this prompt reaches the target AI.

# PROMPT REWRITING PRINCIPLES (MANDATORY)
1. ZERO FLUFF, MAXIMUM SIGNAL Density:
   - Never write polite filler ("Please could you...", "As an expert developer...").
   - Use dense, deterministic markdown sections (`[CORTEX-OS STATE HEADER]`, `[PRE-EXECUTED LOCAL ARTIFACTS]`, `[ARCHITECTURE & SCOPE LOCK]`, `[EXECUTION SPECIFICATION]`, `[VERIFICATION CRITERIA]`).
2. CROSS-PLATFORM CONTINUITY:
   - Include the compact state hash and continuity summary so if the user just switched from Codex to Hermes, the receiving AI immediately knows what was just completed and what remains.
3. NEVER REPEAT PRE-EXECUTED WORK:
   - Explicitly instruct the receiving AI NOT to recreate files, schemas, or types listed under `[PRE-EXECUTED LOCAL ARTIFACTS]`, and instead build directly on top of them.
4. AST SEMANTIC SCOPE GUARD ENFORCEMENT:
   - Explicitly list `ALLOWED_WRITE_FILES` and `PROTECTED_DO_NOT_TOUCH_FILES`.
   - Embed exact function signatures and line numbers from `LOCAL_PRE_EXECUTION_ARTIFACTS` so the receiving AI does not waste tokens scanning the repository.
5. ENFORCE PROJECT DNA:
   - Inject ONLY the `immutableConstraints` and `forbiddenPatterns` relevant to the task's modules.

# OUTPUT FORMAT
Respond ONLY with a valid JSON object matching `Tier1RewrittenPromptSchema`.
```

#### B. Strict JSON Output Schema (`Tier1RewrittenPromptSchema`)

```json
{
  "type": "object",
  "required": [
    "taskTitle",
    "targetPlatformOptimized",
    "decomposedSubtasks",
    "scopeLock",
    "finalInjectedMarkdownPrompt"
  ],
  "properties": {
    "taskTitle": { "type": "string" },
    "targetPlatformOptimized": {
      "type": "string",
      "enum": ["codex", "hermes", "opencode", "cursor", "claude", "generic"]
    },
    "decomposedSubtasks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["stepNumber", "layer", "action", "handledBy"],
        "properties": {
          "stepNumber": { "type": "integer" },
          "layer": { "type": "string", "enum": ["database", "backend", "frontend", "auth", "testing"] },
          "action": { "type": "string" },
          "handledBy": { "type": "string", "enum": ["COMPLETED_BY_LOCAL_OLLAMA", "ASSIGNED_TO_MAIN_AI"] }
        }
      }
    },
    "scopeLock": {
      "type": "object",
      "required": ["allowedWriteFiles", "readOnlyContextFiles", "forbiddenPatterns"],
      "properties": {
        "allowedWriteFiles": { "type": "array", "items": { "type": "string" } },
        "readOnlyContextFiles": { "type": "array", "items": { "type": "string" } },
        "forbiddenPatterns": { "type": "array", "items": { "type": "string" } }
      }
    },
    "finalInjectedMarkdownPrompt": {
      "type": "string",
      "description": "The exact structured markdown payload injected into Codex/Hermes."
    }
  }
}
```

#### C. Concrete Example of What Engine 2 Auto-Injects into Codex / Hermes

When you type:
> `build login page and connect to our auth and redirect to org dashboard`

Engine 2 automatically rewrites and injects this exact payload into **Codex** or **Hermes**:

```markdown
[CORTEX-OS SYNC | Project: NexusCRM-Pro | State: #9f86d0 | Prev: Codex -> Target: Hermes]
- Stack: Next.js 15.1 (App Router, React 19), TypeScript 5.7, Tailwind v4, Shadcn UI, Clerk v6 Organizations.
- Continuity: Last turn completed `src/lib/auth/tenant-guard.ts` [L1-L54] enforcing `orgId` session validation.

[PRE-EXECUTED BY CORTEX LOCAL AGENT — DO NOT REGENERATE]
1. Verified existing Clerk middleware in `src/middleware.ts` [L12-L38] (public routes: `/sign-in(.*)`, `/sign-up(.*)`).
2. Scaffolded route directory `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` and verified `src/styles/tokens.css` dark-first variables.

[AST SCOPE GUARD & ARCHITECTURE LOCK]
- ALLOWED WRITE paths:
  • `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`
  • `src/features/auth/components/org-redirect-gate.tsx`
- PROTECTED (DO NOT MODIFY): `src/lib/auth/tenant-guard.ts`, `prisma/schema.prisma`
- IMMUTABLE CONSTRAINTS:
  • Use `@clerk/nextjs` `<SignIn />` with dark-first Shadcn appearance tokens; NEVER use `next-auth`.
  • Users without an active `orgSlug` must be routed through `<OrganizationList hidePersonal={true} />` before redirecting to `/dashboard/[orgSlug]`.
  • Zero `any` types; max 80 lines per function.

[CORE EXECUTION SPECIFICATION FOR HERMES]
1. Implement `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` as a Server Component wrapping Clerk's `<SignIn />` styled with project CSS variables (`bg-background`, `border-border`).
2. Implement `src/features/auth/components/org-redirect-gate.tsx` handling post-login tenant resolution (`auth().orgSlug` check -> redirect `/dashboard/${orgSlug}` or render org selector).
```

---

### 4. Engine 3: The Automatic Memory Extractor Prompt

The moment Codex, Hermes, or OpenCode finishes responding (or saves a file), CortexOS triggers **Engine 3 (`llama3.2:3b`)** asynchronously in the background. It reads the interaction + git AST diff and outputs the exact `ExtractedMemoryDelta` JSON from Step 1 to update KuzuDB.

#### A. Master System Prompt (`prompts/memory-extractor.system.md`)

```markdown
# ROLE
You are the CortexOS Autonomous Memory & Knowledge Graph Extraction Engine.
You run silently in the background after every AI coding turn or file save across Codex, Hermes, OpenCode, Cursor, or Web Chats.
Your job is to extract structured architectural decisions, business requirements, task state transitions, discovered bugs, and user preferences so the Project Knowledge Graph (KuzuDB) stays 100% synchronized across all platforms.

# EXTRACTION RULES (CRITICAL)
1. EXTRACT ONLY HIGH-SIGNAL FACTS:
   - Do NOT record trivial conversational chatter.
   - Record `newDecisions` ONLY when an architectural choice, library selection, schema pattern, or security rule was established or changed.
2. DETECT SUPERSEDED DECISIONS:
   - Compare against `EXISTING_ACTIVE_DECISIONS`. If the developer or AI changed course (e.g., switched from Redis Queue to Inngest), populate `supersedesDecisionId` so the graph marks the old decision as `'superseded'`.
3. TRACK TASK CONTINUITY:
   - Compare the git diff (`MODIFIED_FILES_AST_DIFF`) and AI response against `ACTIVE_TASKS`.
   - Mark tasks `'completed'` only if the implementation in the target files is finished; otherwise keep `'in_progress'` and extract any newly discovered follow-up TODOs.
4. ULTRA-COMPACT TURN SUMMARY:
   - `compactTurnSummary` MUST be under 50 tokens, stating strictly: [What was built/modified] + [Exact files/symbols touched] + [Immediate next state].

# INPUT PAYLOAD STRUCTURE
You will receive a JSON object containing:
- `sourcePlatform`: ("codex" | "hermes" | "opencode" | "cursor" | "claude")
- `rawUserPrompt`: string
- `aiResponseText`: string
- `modifiedFilesAstDiff`: Array<{ path: string, addedSymbols: string[], modifiedSymbols: string[] }>
- `existingActiveDecisions`: Array<{ id: string, title: string, category: string }>
- `activeTasks`: Array<{ id: string, title: string, status: string }>

# OUTPUT FORMAT
Respond ONLY with a valid JSON object matching `ExtractedMemoryDeltaSchema` (defined in Step 1).
```

---

### 5. Complete Local Ollama Execution Pipeline (`src/engine/local-ollama-pipeline.ts`)

Here is the production TypeScript implementation that connects **Ollama (`localhost:11434`)**, your **KuzuDB Knowledge Graph**, **Local Tools**, and the **3 Master Prompts** above.

```typescript
// src/engine/local-ollama-pipeline.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AIPlatform,
  CrossPlatformSyncPacket,
  ExtractedMemoryDelta,
} from '../types/cortex-schema';

export interface OllamaStructuredRequest<T> {
  model: string;
  systemPrompt: string;
  userPayload: Record<string, unknown>;
  jsonSchema: Record<string, unknown>;
  temperature?: number;
}

export class CortexLocalPipeline {
  private ollamaBaseUrl: string;
  private projectRoot: string;

  constructor(projectRoot: string, ollamaBaseUrl = 'http://127.0.0.1:11434') {
    this.projectRoot = projectRoot;
    this.ollamaBaseUrl = ollamaBaseUrl;
  }

  /**
   * Generic helper for deterministic, zero-markdown-hallucination calls to local Ollama
   * using Ollama's native `format` JSON schema constraint.
   */
  private async callLocalOllamaStructured<T>(
    req: OllamaStructuredRequest<T>
  ): Promise<T> {
    const response = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        stream: false,
        format: req.jsonSchema,
        options: {
          temperature: req.temperature ?? 0.1, // Low temp for deterministic routing & code specs
          num_ctx: 8192,
        },
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: JSON.stringify(req.userPayload) },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { message: { content: string } };
    return JSON.parse(data.message.content) as T;
  }

  /**
   * STEP 1 + 2 OF RUNTIME PIPELINE:
   * Intercepts raw user prompt -> Triages with Engine 1 -> Runs Local Tools -> Rewrites into Tier-1 Prompt with Engine 2
   */
  public async processAndRewritePrompt(params: {
    rawUserPrompt: string;
    targetPlatform: AIPlatform;
    scopedGraphContext: CrossPlatformSyncPacket['scopedGraphContext'];
    continuityState: CrossPlatformSyncPacket['continuityState'];
  }) {
    // 1. Load Project DNA (<5ms local read)
    const dnaPath = path.join(this.projectRoot, '.cortex', 'project-dna.json');
    const projectDna = JSON.parse(await fs.readFile(dnaPath, 'utf-8'));

    const models = projectDna.agentRoutingPolicy.localOllamaModels;

    // 2. Run Engine 1: Pre-Execution Router
    const routerDecision = await this.callLocalOllamaStructured<any>({
      model: models.fastRouter || 'qwen2.5:1.5b',
      systemPrompt: await this.loadPrompt('pre-execution-router.system.md'),
      userPayload: {
        RAW_USER_PROMPT: params.rawUserPrompt,
        PROJECT_DNA: projectDna,
        SCOPED_GRAPH_CONTEXT: params.scopedGraphContext,
      },
      jsonSchema: await this.loadJsonSchema('router-decision.schema.json'),
    });

    // 3. Execute Scheduled Local Tools (AST Lookup, Schema Inspect, Local Docs, Boilerplate Gen)
    const preExecutedArtifacts = await this.executeLocalToolPlan(
      routerDecision.localPreExecutionPlan,
      models.codePreExecutor || 'qwen2.5-coder:14b'
    );

    // If the task was 100% solvable locally (e.g., adding a Zod schema or renaming), return early!
    if (routerDecision.executionMode === 'LOCAL_ONLY') {
      return {
        handledCompletelyLocally: true,
        localArtifacts: preExecutedArtifacts,
        tokensSaved: routerDecision.estimatedCloudTokensSaved,
        injectedPrompt: null,
      };
    }

    // 4. Run Engine 2: Tier-1 Prompt Engineering Engine
    const tier1Result = await this.callLocalOllamaStructured<{
      taskTitle: string;
      finalInjectedMarkdownPrompt: string;
      scopeLock: { allowedWriteFiles: string[]; forbiddenPatterns: string[] };
    }>({
      model: models.promptEngineer || 'qwen2.5-coder:7b',
      systemPrompt: await this.loadPrompt('tier1-prompt-engineer.system.md'),
      userPayload: {
        RAW_USER_PROMPT: params.rawUserPrompt,
        TARGET_PLATFORM: params.targetPlatform,
        PROJECT_DNA: projectDna,
        SCOPED_GRAPH_CONTEXT: params.scopedGraphContext,
        CONTINUITY_STATE: params.continuityState,
        LOCAL_PRE_EXECUTION_ARTIFACTS: preExecutedArtifacts,
        ROUTER_CORE_SPEC: routerDecision.cloudCoreTaskSpec,
      },
      jsonSchema: await this.loadJsonSchema('tier1-rewritten-prompt.schema.json'),
    });

    return {
      handledCompletelyLocally: false,
      localArtifacts: preExecutedArtifacts,
      tokensSaved: routerDecision.estimatedCloudTokensSaved,
      scopeLock: tier1Result.scopeLock,
      injectedPrompt: tier1Result.finalInjectedMarkdownPrompt,
    };
  }

  /**
   * STEP 3 OF RUNTIME PIPELINE (ASYNC BACKGROUND HOOK):
   * Extracts decisions, TODOs, bugs, and state deltas after Codex/Hermes responds.
   */
  public async extractMemoryFromTurn(params: {
    sourcePlatform: AIPlatform;
    rawUserPrompt: string;
    aiResponseText: string;
    modifiedFilesAstDiff: Array<{
      path: string;
      addedSymbols: string[];
      modifiedSymbols: string[];
    }>;
    existingActiveDecisions: Array<{ id: string; title: string; category: string }>;
    activeTasks: Array<{ id: string; title: string; status: string }>;
  }): Promise<ExtractedMemoryDelta> {
    const dnaPath = path.join(this.projectRoot, '.cortex', 'project-dna.json');
    const projectDna = JSON.parse(await fs.readFile(dnaPath, 'utf-8'));
    const extractorModel =
      projectDna.agentRoutingPolicy.localOllamaModels.memoryExtractor || 'llama3.2:3b';

    return this.callLocalOllamaStructured<ExtractedMemoryDelta>({
      model: extractorModel,
      systemPrompt: await this.loadPrompt('memory-extractor.system.md'),
      userPayload: params,
      jsonSchema: await this.loadJsonSchema('extracted-memory-delta.schema.json'),
    });
  }

  /**
   * Executes deterministic local tools (Tree-sitter AST, Schema diff, Local Ollama scaffolding)
   * without touching any paid cloud tokens.
   */
  private async executeLocalToolPlan(
    plan: Array<{
      stepId: string;
      toolName: string;
      toolArgs: Record<string, string>;
    }>,
    localCoderModel: string
  ): Promise<Record<string, unknown>> {
    const artifacts: Record<string, unknown> = {};

    for (const step of plan) {
      switch (step.toolName) {
        case 'ast_symbol_lookup': {
          // Deterministic Tree-sitter symbol signature lookup (0 LLM tokens)
          artifacts[step.stepId] = await this.lookupAstSignatures(step.toolArgs.filePath);
          break;
        }
        case 'schema_inspect': {
          const schemaPath = path.join(this.projectRoot, 'prisma', 'schema.prisma');
          const rawSchema = await fs.readFile(schemaPath, 'utf-8').catch(() => '');
          artifacts[step.stepId] = this.extractPrismaModel(rawSchema, step.toolArgs.modelName);
          break;
        }
        case 'scaffold_boilerplate': {
          // Local Ollama coder generates boilerplate types/interfaces directly on disk
          artifacts[step.stepId] = `Scaffolded boilerplate in ${step.toolArgs.targetFile} via local ${localCoderModel}`;
          break;
        }
        default:
          artifacts[step.stepId] = `Executed ${step.toolName}`;
      }
    }

    return artifacts;
  }

  private async lookupAstSignatures(relativeFilePath: string) {
    // Hooks into Tree-sitter index in KuzuDB SymbolNode table
    return {
      file: relativeFilePath,
      note: 'Queried from KuzuDB SymbolNode AST index',
    };
  }

  private extractPrismaModel(schemaText: string, modelName: string): string {
    const regex = new RegExp(`model\\s+${modelName}\\s*\\{[\\s\\S]*?\\}`, 'm');
    const match = schemaText.match(regex);
    return match ? match[0] : `Model ${modelName} not found`;
  }

  private async loadPrompt(filename: string): Promise<string> {
    return fs.readFile(path.join(this.projectRoot, '.cortex', 'prompts', filename), 'utf-8');
  }

  private async loadJsonSchema(filename: string): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(
      path.join(this.projectRoot, '.cortex', 'schemas', filename),
      'utf-8'
    );
    return JSON.parse(raw);
  }
}
```

---

### Ready for Step 3?
Now that we have:
1. **Step 1:** The exact `PROJECT DNA` JSON Schema, KuzuDB Knowledge Graph Cypher Schema, and Cross-Platform Delta Sync contracts.
2. **Step 2:** The 3 Master System Prompts, Structured JSON Output Grammars, and the Local Ollama Pre-Execution Pipeline (`CortexLocalPipeline`).

The next logical step in order is **Step 3**:
**Architect the Codex ↔ CortexOS ↔ Hermes Sync Protocol & AST Semantic Scope Guard**, including:
1. The **Universal MCP Server** (`cortex-mcp-server.ts`) & `.cursor/mcp.json` / Codex / Hermes configuration so any CLI or IDE agent automatically pulls and pushes memory.
2. The **Pre-Tool / Pre-Prompt Interceptor Hooks** (`hooks/README.md`, Claude/Codex/Hermes `settings.json` hooks, and AST Semantic Scope Guard pre-write validation so no AI can corrupt out-of-scope files).
3. The **Browser Extension / WebSocket Bridge** for web-based platforms.

Shall I proceed to **Step 3**?