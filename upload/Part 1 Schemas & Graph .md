Here is **Part 1 of the CortexOS Engineering Blueprint: The Exact `PROJECT DNA` JSON Schema, Knowledge Graph Ontology (KuzuDB / Property Graph), and Delta Sync Packet Schema.**

This specification is designed to be **copy-paste ready** into your codebase or fed directly to another coding agent (Codex, Hermes, Cursor, etc.) to initialize the storage and memory layer of CortexOS.

---

### 1. Architectural Overview of the Data Layer

To achieve **zero-token local querying** and **ultra-compact (~150-300 token) cross-platform injection**, CortexOS splits project intelligence into three tightly linked schemas:

1. **`project-dna.json` (Static + Slow-Moving Constitution):** Stored in `.cortex/project-dna.json`. Contains the immutable architectural rules, tech stack, coding conventions, design system tokens, and forbidden patterns.
2. **The Property Knowledge Graph (`KuzuDB` / Cypher Schema):** Stored in `.cortex/graph.db`. Represents live relationships between files, AST symbols, features, architectural decisions (ADRs), tasks, bugs, and chat sessions across platforms.
3. **`delta-sync-packet.json` (The Cross-Platform Handoff Payload):** The ultra-compressed state header generated automatically when you switch from **Codex → Hermes** (or chat-to-chat).

---

### 2. Schema 1: `PROJECT DNA` (`project-dna.json`)

Every project gets a `.cortex/project-dna.json` file. Local Ollama models read this file in `<10ms` to rewrite mediocre prompts into enterprise-grade prompts and prevent any AI from violating your architecture.

#### A. JSON Schema Definition (`project-dna.schema.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://cortexos.dev/schemas/project-dna.v1.json",
  "title": "CortexOS Project DNA Schema",
  "type": "object",
  "required": [
    "schemaVersion",
    "projectMeta",
    "techStack",
    "architectureRules",
    "codingStandards",
    "designSystem",
    "agentRoutingPolicy"
  ],
  "properties": {
    "schemaVersion": { "type": "string", "const": "1.0.0" },
    "projectMeta": {
      "type": "object",
      "required": ["projectId", "name", "domain", "rootPath", "stateHash"],
      "properties": {
        "projectId": { "type": "string", "format": "uuid" },
        "name": { "type": "string" },
        "domain": { "type": "string", "description": "e.g., B2B SaaS CRM, Fintech API, AI Notepad" },
        "summary": { "type": "string", "maxLength": 350 },
        "rootPath": { "type": "string" },
        "stateHash": { "type": "string", "description": "Merkle hash of current DNA + Graph state" },
        "lastSyncedAt": { "type": "string", "format": "date-time" },
        "lastActivePlatform": {
          "type": "string",
          "enum": ["codex", "hermes", "opencode", "cursor", "claude", "windsurf", "chatgpt"]
        }
      }
    },
    "techStack": {
      "type": "object",
      "required": ["frontend", "backend", "database", "infrastructure"],
      "properties": {
        "frontend": {
          "type": "object",
          "properties": {
            "framework": { "type": "string" },
            "language": { "type": "string" },
            "stateManagement": { "type": "string" },
            "styling": { "type": "string" },
            "uiLibrary": { "type": "string" }
          }
        },
        "backend": {
          "type": "object",
          "properties": {
            "runtime": { "type": "string" },
            "framework": { "type": "string" },
            "apiPattern": { "type": "string", "enum": ["REST", "tRPC", "GraphQL", "gRPC", "ServerActions"] },
            "authProvider": { "type": "string" }
          }
        },
        "database": {
          "type": "object",
          "properties": {
            "primaryDb": { "type": "string" },
            "orm": { "type": "string" },
            "vectorDb": { "type": "string" },
            "graphDb": { "type": "string" },
            "cache": { "type": "string" }
          }
        },
        "infrastructure": {
          "type": "object",
          "properties": {
            "packageManager": { "type": "string", "enum": ["pnpm", "bun", "npm", "yarn", "cargo"] },
            "monorepoTool": { "type": "string" },
            "deployment": { "type": "string" }
          }
        }
      }
    },
    "architectureRules": {
      "type": "object",
      "required": ["pattern", "directoryMap", "immutableConstraints", "forbiddenPatterns"],
      "properties": {
        "pattern": { "type": "string", "description": "e.g., Feature-Sliced Design, Hexagonal, Clean Architecture" },
        "directoryMap": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        },
        "immutableConstraints": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Hard rules every AI must obey"
        },
        "forbiddenPatterns": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Anti-patterns or deprecated libraries that must never be generated"
        }
      }
    },
    "codingStandards": {
      "type": "object",
      "properties": {
        "namingConventions": {
          "type": "object",
          "properties": {
            "files": { "type": "string" },
            "components": { "type": "string" },
            "functions": { "type": "string" },
            "databaseTables": { "type": "string" }
          }
        },
        "errorHandling": { "type": "string" },
        "validationLibrary": { "type": "string" },
        "testingRequirements": { "type": "string" },
        "astScopeGuardRules": {
          "type": "object",
          "properties": {
            "enforceStrictImports": { "type": "boolean" },
            "disallowAnyType": { "type": "boolean" },
            "maxFunctionLines": { "type": "integer" },
            "protectedPaths": { "type": "array", "items": { "type": "string" } }
          }
        }
      }
    },
    "designSystem": {
      "type": "object",
      "properties": {
        "themeMode": { "type": "string", "enum": ["dark-first", "light-first", "system"] },
        "designTokensPath": { "type": "string" },
        "iconLibrary": { "type": "string" },
        "componentPrimitives": { "type": "string" },
        "uxPrinciples": { "type": "array", "items": { "type": "string" } }
      }
    },
    "agentRoutingPolicy": {
      "type": "object",
      "properties": {
        "localOllamaModels": {
          "type": "object",
          "properties": {
            "fastRouter": { "type": "string", "default": "qwen2.5:1.5b" },
            "promptEngineer": { "type": "string", "default": "qwen2.5-coder:7b" },
            "codePreExecutor": { "type": "string", "default": "qwen2.5-coder:14b" },
            "memoryExtractor": { "type": "string", "default": "llama3.2:3b" },
            "embeddingModel": { "type": "string", "default": "nomic-embed-text" }
          }
        },
        "preExecutionCapabilities": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["ast_lookup", "boilerplate_gen", "schema_diff", "web_docs_fetch", "unit_test_stub"]
          }
        }
      }
    }
  }
}
```

#### B. Concrete Production Instance (`.cortex/project-dna.json`)
Here is how a real live `project-dna.json` looks in practice:

```json
{
  "schemaVersion": "1.0.0",
  "projectMeta": {
    "projectId": "a8098c1a-f86e-11da-bd1a-00112444be1e",
    "name": "NexusCRM-Pro",
    "domain": "Multi-tenant B2B SaaS CRM with AI Workflow Automation",
    "summary": "Next.js 15 App Router SaaS with Clerk Organization Auth, Prisma + PostgreSQL, Stripe Billing, and real-time WebSockets.",
    "rootPath": "/Users/dev/projects/nexus-crm",
    "stateHash": "sha256:9f86d081884c7d659a2feaa0c55ad015",
    "lastSyncedAt": "2026-11-07T22:40:00Z",
    "lastActivePlatform": "codex"
  },
  "techStack": {
    "frontend": {
      "framework": "Next.js 15.1 (App Router, React 19)",
      "language": "TypeScript 5.7 (strict mode)",
      "stateManagement": "Zustand + TanStack Query v5",
      "styling": "Tailwind CSS v4",
      "uiLibrary": "Shadcn UI + Radix Primitives"
    },
    "backend": {
      "runtime": "Node.js 22 LTS",
      "framework": "Next.js Route Handlers + Server Actions",
      "apiPattern": "ServerActions",
      "authProvider": "Clerk v6 (Multi-tenant Organizations)"
    },
    "database": {
      "primaryDb": "PostgreSQL 16 (Supabase)",
      "orm": "Prisma 6.0",
      "vectorDb": "pgvector",
      "graphDb": "KuzuDB (local dev intelligence)",
      "cache": "Upstash Redis"
    },
    "infrastructure": {
      "packageManager": "pnpm",
      "monorepoTool": "Turborepo",
      "deployment": "Vercel + Docker Worker"
    }
  },
  "architectureRules": {
    "pattern": "Feature-Sliced Modular Architecture",
    "directoryMap": {
      "src/app": "App Router pages, layouts, and thin webhook route handlers ONLY",
      "src/features": "Domain modules (auth, billing, contacts, deals) containing actions, hooks, components",
      "src/lib/db": "Prisma client singleton and database transaction helpers",
      "src/components/ui": "Pure stateless Shadcn UI primitives"
    },
    "immutableConstraints": [
      "All database queries MUST filter by orgId from Clerk auth() session for tenant isolation.",
      "Never write raw SQL or Prisma calls inside React Server Components; always call a service in src/features/*/services.ts.",
      "All Server Actions MUST validate inputs using Zod and return a typed ActionState<T>Result.",
      "Webhook routes must verify cryptographic signatures before parsing JSON body."
    ],
    "forbiddenPatterns": [
      "Pages Router (src/pages/*)",
      "next-auth (use Clerk exclusively)",
      "axios (use native fetch or TanStack Query)",
      "Using 'any' or '@ts-ignore'",
      "Direct mutation of prisma/schema.prisma without running local schema check"
    ]
  },
  "codingStandards": {
    "namingConventions": {
      "files": "kebab-case.ts / kebab-case.tsx",
      "components": "PascalCase",
      "functions": "camelCase",
      "databaseTables": "snake_case (mapped via @@map in Prisma)"
    },
    "errorHandling": "Never throw unhandled errors in Server Actions; return { success: false, error: { code, message } }",
    "validationLibrary": "Zod",
    "testingRequirements": "Vitest for unit tests, Playwright for E2E critical flows",
    "astScopeGuardRules": {
      "enforceStrictImports": true,
      "disallowAnyType": true,
      "maxFunctionLines": 80,
      "protectedPaths": ["prisma/migrations/", "src/lib/auth/tenant-guard.ts"]
    }
  },
  "designSystem": {
    "themeMode": "dark-first",
    "designTokensPath": "src/styles/tokens.css",
    "iconLibrary": "lucide-react",
    "componentPrimitives": "Shadcn UI",
    "uxPrinciples": [
      "Optimistic UI updates on all mutations",
      "Skeleton loaders matching exact layout geometry",
      "Keyboard-first navigation (Cmd+K command palette integration)"
    ]
  },
  "agentRoutingPolicy": {
    "localOllamaModels": {
      "fastRouter": "qwen2.5:1.5b",
      "promptEngineer": "qwen2.5-coder:7b",
      "codePreExecutor": "qwen2.5-coder:14b",
      "memoryExtractor": "llama3.2:3b",
      "embeddingModel": "nomic-embed-text"
    },
    "preExecutionCapabilities": [
      "ast_lookup",
      "boilerplate_gen",
      "schema_diff",
      "web_docs_fetch",
      "unit_test_stub"
    ]
  }
}
```

---

### 3. Schema 2: The Project Knowledge Graph (KuzuDB / Cypher DDL)

Traditional memory stores flat text snippets (`Memory 1`, `Memory 2`). That fails when switching from Codex to Hermes because flat text doesn't know **what depends on what** or **which decision invalidated an older decision**.

CortexOS uses an embedded property graph (**KuzuDB**—serverless, C++ speed, stores in a single local directory, supports both Cypher and Vector indices).

#### A. Node & Edge Ontology Map

```
                         ┌────────────────────┐
                         │    ProjectNode     │
                         └─────────┬──────────┘
                                   │ [:HAS_MODULE]
                                   ▼
┌──────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│   DecisionNode   │────▶│     ModuleNode     │◀────│   RequirementNode  │
│ (ADR / Tech Choice)│     │ (Frontend/Auth/DB) │     │ (Business Logic)   │
└────────┬─────────┘     └─────────┬──────────┘     └─────────┬──────────┘
         │ [:GOVERNED_BY]          │ [:CONTAINS_FILE]         │ [:IMPLEMENTED_BY]
         ▼                         ▼                          ▼
┌──────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│   SymbolNode     │◀────│      FileNode      │◀────│      TaskNode      │
│ (AST Fn/Class/DB)│     │ (src/features/...) │     │ (TODO / InProgress)│
└────────┬─────────┘     └─────────┬──────────┘     └─────────┬──────────┘
         │ [:AFFECTS_SYMBOL]       │ [:HAS_BUG]               │ [:MODIFIED_IN]
         ▼                         ▼                          ▼
┌──────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│   DependencyNode │     │      BugNode       │     │  SessionTurnNode   │
│ (Stripe/Clerk)   │     │ (Open / Resolved)  │     │ (Codex / Hermes)   │
└──────────────────┘     └────────────────────┘     └────────────────────┘
```

#### B. Exact KuzuDB Cypher Schema Definition (`schema.cypher`)

You can run this directly in KuzuDB (via Rust, Node.js, or Python bindings) to initialize the CortexOS Knowledge Graph:

```cypher
// ============================================================================
// 1. NODE TABLES (ENTITIES)
// ============================================================================

// 1.1 Architectural Modules (e.g., Auth, Billing, Dashboard, Database)
CREATE NODE TABLE ModuleNode (
    id STRING,
    name STRING,
    layer STRING,          // 'frontend' | 'backend' | 'database' | 'infra' | 'shared'
    status STRING,         // 'planned' | 'in_progress' | 'production' | 'deprecated'
    summary STRING,
    updatedAt INT64,
    PRIMARY KEY (id)
);

// 1.2 Source Code Files (Auto-populated by Tree-sitter File Watcher)
CREATE NODE TABLE FileNode (
    path STRING,           // Relative path: 'src/features/billing/webhook.ts'
    language STRING,       // 'typescript' | 'prisma' | 'sql' | 'rust' | 'python'
    astHash STRING,        // SHA-256 of AST structure (ignores whitespace comments)
    exportsSummary STRING, // Compact list of exported symbols
    lineCount INT32,
    isProtected BOOLEAN,   // AST Scope Guard lock
    lastModifiedBy STRING, // 'user' | 'codex' | 'hermes' | 'local_ollama'
    updatedAt INT64,
    PRIMARY KEY (path)
);

// 1.3 AST Symbols (Functions, Classes, Interfaces, DB Models, API Routes)
CREATE NODE TABLE SymbolNode (
    id STRING,             // e.g., 'src/features/billing/webhook.ts#handleStripeWebhook'
    name STRING,           // 'handleStripeWebhook'
    kind STRING,           // 'function' | 'component' | 'db_model' | 'api_route' | 'type'
    signature STRING,      // 'async (req: NextRequest) => Promise<NextResponse>'
    startLine INT32,
    endLine INT32,
    docstring STRING,
    embedding FLOAT[768],  // Vector embedding (nomic-embed-text) for hybrid GraphRAG
    PRIMARY KEY (id)
);

// 1.4 Architectural Decisions (ADRs extracted automatically from chats)
CREATE NODE TABLE DecisionNode (
    id STRING,             // 'ADR-004'
    category STRING,       // 'database' | 'auth' | 'state' | 'api' | 'ui' | 'security'
    title STRING,          // 'Use Clerk Webhooks with Svix verification for User Sync'
    rationale STRING,      // Why this choice was made
    constraints STRING,    // Strict rules resulting from this decision
    status STRING,         // 'active' | 'superseded'
    sourcePlatform STRING, // 'codex' | 'hermes' | 'claude' | 'user_manual'
    createdAt INT64,
    embedding FLOAT[768],
    PRIMARY KEY (id)
);

// 1.5 Business Requirements & Domain Rules
CREATE NODE TABLE RequirementNode (
    id STRING,             // 'REQ-012'
    domain STRING,         // 'billing' | 'onboarding' | 'permissions'
    rule STRING,           // 'Users must verify email and belong to an active Org before creating deals'
    priority STRING,       // 'critical' | 'high' | 'medium'
    verificationStatus STRING, // 'untested' | 'tested' | 'verified'
    PRIMARY KEY (id)
);

// 1.6 Tasks / Sprint Items (Auto-decomposed & tracked across chats)
CREATE NODE TABLE TaskNode (
    id STRING,             // 'TASK-108'
    title STRING,
    description STRING,
    status STRING,         // 'todo' | 'pre_executed_locally' | 'in_progress' | 'completed' | 'blocked'
    assignedAgent STRING,  // 'local_ollama' | 'codex' | 'hermes' | 'opencode'
    priority INT32,        // 1 (Highest) to 5 (Lowest)
    preExecutedDiff STRING,// Path to local patch/staged boilerplate completed by Ollama
    createdAt INT64,
    completedAt INT64,
    PRIMARY KEY (id)
);

// 1.7 Bugs & Security Findings
CREATE NODE TABLE BugNode (
    id STRING,             // 'BUG-019'
    severity STRING,       // 'critical' | 'high' | 'medium' | 'low'
    title STRING,
    rootCause STRING,
    reproductionSteps STRING,
    status STRING,         // 'open' | 'investigating' | 'resolved'
    detectedBy STRING,     // 'security_agent' | 'tester_agent' | 'user' | 'codex'
    createdAt INT64,
    PRIMARY KEY (id)
);

// 1.8 External Dependencies / SDKs
CREATE NODE TABLE DependencyNode (
    name STRING,           // 'stripe' | '@clerk/nextjs' | 'prisma'
    version STRING,        // '^17.2.0'
    docsCachePath STRING,  // Local cached docs path so AI never hallucinates outdated APIs
    PRIMARY KEY (name)
);

// 1.9 Cross-Platform Chat Session Turns (Episodic Timeline Memory)
CREATE NODE TABLE SessionTurnNode (
    id STRING,             // 'TURN-20261107-004'
    platform STRING,       // 'codex' | 'hermes' | 'cursor' | 'claude_web'
    sessionId STRING,
    rawUserPrompt STRING,
    rewrittenTier1Prompt STRING,
    compactOutcomeSummary STRING, // 50-token compressed summary generated by local 3B model
    tokensSaved INT32,
    timestamp INT64,
    embedding FLOAT[768],
    PRIMARY KEY (id)
);

// ============================================================================
// 2. RELATIONSHIP TABLES (EDGES)
// ============================================================================

// Structural & Codebase Edges (Maintained deterministically by Tree-sitter)
CREATE REL TABLE CONTAINS_FILE (FROM ModuleNode TO FileNode);
CREATE REL TABLE DEFINES_SYMBOL (FROM FileNode TO SymbolNode);
CREATE REL TABLE IMPORTS_FILE (FROM FileNode TO FileNode, importSpecifiers STRING[]);
CREATE REL TABLE CALLS_SYMBOL (FROM SymbolNode TO SymbolNode);
CREATE REL TABLE USES_DEPENDENCY (FROM FileNode TO DependencyNode);

// Architectural & Governance Edges (Maintained by Memory Extractor Agent)
CREATE REL TABLE GOVERNED_BY (FROM ModuleNode TO DecisionNode);
CREATE REL TABLE SUPERSEDES_DECISION (FROM DecisionNode TO DecisionNode, reason STRING);
CREATE REL TABLE ENFORCES_REQUIREMENT (FROM SymbolNode TO RequirementNode);

// Execution, Task & Bug Tracking Edges
CREATE REL TABLE DEPENDS_ON_TASK (FROM TaskNode TO TaskNode);
CREATE REL TABLE TARGETS_FILE (FROM TaskNode TO FileNode, actionType STRING);
CREATE REL TABLE BLOCKED_BY_BUG (FROM TaskNode TO BugNode);
CREATE REL TABLE LOCATED_IN_SYMBOL (FROM BugNode TO SymbolNode);

// Cross-Platform Episodic History Edges
CREATE REL TABLE PRODUCED_DECISION (FROM SessionTurnNode TO DecisionNode);
CREATE REL TABLE MODIFIED_FILE (FROM SessionTurnNode TO FileNode, diffSummary STRING);
CREATE REL TABLE PROGRESSED_TASK (FROM SessionTurnNode TO TaskNode, fromStatus STRING, toStatus STRING);
```

---

### 4. Schema 3: TypeScript Interfaces for the CortexOS Engine (`src/types/cortex-schema.ts`)

If you are building the CortexOS daemon or MCP server in TypeScript/Node/Rust, here are the strict TypeScript contracts that unify the **Memory Extractor**, **Knowledge Graph**, and **Cross-Platform Delta Sync Packet**:

```typescript
// src/types/cortex-schema.ts

export type AIPlatform =
  | 'codex'
  | 'hermes'
  | 'opencode'
  | 'cursor'
  | 'windsurf'
  | 'claude'
  | 'chatgpt'
  | 'local_ollama';

/**
 * 1. AUTOMATIC MEMORY EXTRACTION PAYLOAD
 * Output produced by the local Ollama 3B Memory Extractor after every chat turn or git diff.
 */
export interface ExtractedMemoryDelta {
  turnId: string;
  sourcePlatform: AIPlatform;
  timestamp: number;
  compactTurnSummary: string; // Max 60 tokens
  newDecisions: Array<{
    category: 'database' | 'auth' | 'state' | 'api' | 'ui' | 'security';
    title: string;
    rationale: string;
    constraints: string;
    targetModuleId: string;
    supersedesDecisionId?: string;
  }>;
  newRequirements: Array<{
    domain: string;
    rule: string;
    priority: 'critical' | 'high' | 'medium';
  }>;
  taskUpdates: Array<{
    taskId?: string; // Omit if creating a brand new discovered TODO
    title: string;
    status: 'todo' | 'pre_executed_locally' | 'in_progress' | 'completed' | 'blocked';
    targetFiles: string[];
  }>;
  discoveredBugs: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    rootCause: string;
    affectedSymbolId?: string;
    status: 'open' | 'resolved';
  }>;
  userPreferenceUpdates?: Array<{
    ruleType: 'immutableConstraint' | 'forbiddenPattern' | 'codingStandard';
    value: string;
  }>;
}

/**
 * 2. CROSS-PLATFORM DELTA SYNC PACKET
 * Injected automatically when switching chats or platforms (e.g., Codex -> Hermes).
 * Designed to fit inside 150 - 350 tokens while carrying 100% of relevant project context.
 */
export interface CrossPlatformSyncPacket {
  header: {
    projectId: string;
    projectName: string;
    stateHash: string;
    previousPlatform: AIPlatform;
    targetPlatform: AIPlatform;
    syncedAtIso: string;
  };
  /** Core tech stack & non-negotiable rules pulled from Project DNA */
  dnaSnapshot: {
    stackSummary: string; // e.g., "Next.js 15 App Router, TS 5.7, Prisma/Postgres, Clerk v6, Tailwind v4"
    activeConstraints: string[]; // Top 3-5 constraints relevant to the active module
  };
  /** Graph-queried context specifically scoped to the user's current prompt */
  scopedGraphContext: {
    activeModule: string;
    relevantDecisions: Array<{ id: string; title: string; constraint: string }>;
    relevantSymbols: Array<{
      symbolId: string; // e.g. "src/features/billing/webhook.ts#handleStripeWebhook [L14-L68]"
      signature: string;
    }>;
    openBugsInScope: Array<{ id: string; title: string; rootCause: string }>;
  };
  /** Continuity state from the previous chat/platform */
  continuityState: {
    lastCompletedAction: string;
    activeTask: {
      id: string;
      title: string;
      preExecutedByLocalAgent: string[]; // Work already done locally by Ollama before injection!
      remainingCoreWork: string;         // What the main AI (Codex/Hermes) needs to finish
    };
    nextPendingTasks: string[];
  };
}
```

---

### 5. How the Subgraph Query Works at Runtime (Zero-Token Context Scoping)

When you type a prompt in **Hermes** (after working in **Codex** for 3 hours), CortexOS does **NOT** dump the entire Knowledge Graph into Hermes.

Instead, the local daemon runs a **1-hop Scoped Cypher Query** in `<5ms` to fetch *only* the nodes connected to your current task:

```cypher
// Fetch ONLY the active task, its target files, their AST symbols, governing ADRs, and open bugs
MATCH (t:TaskNode {status: 'in_progress'})-[:TARGETS_FILE]->(f:FileNode)
OPTIONAL MATCH (m:ModuleNode)-[:CONTAINS_FILE]->(f)
OPTIONAL MATCH (m)-[:GOVERNED_BY]->(d:DecisionNode {status: 'active'})
OPTIONAL MATCH (f)-[:DEFINES_SYMBOL]->(s:SymbolNode)
OPTIONAL MATCH (t)-[:BLOCKED_BY_BUG]->(b:BugNode {status: 'open'})
RETURN t, f.path, f.exportsSummary, collect(DISTINCT d.title), collect(DISTINCT s.signature), collect(DISTINCT b.title);
```

This single query pulls:
1. The exact files worked on in **Codex** minutes ago.
2. Their current function signatures (from Tree-sitter AST).
3. Only the Architectural Decisions (`DecisionNode`) governing that specific module.
4. Any unresolved bugs (`BugNode`) blocking that file.

---

### Ready for Step 2?
Now that the **exact JSON Schema (`project-dna.json`), Knowledge Graph Ontology (`schema.cypher`), and TypeScript Sync Contracts** are locked in, the next step in order is:

**Step 2: Write the Master System Prompts & Local Ollama Pipeline for:**
1. **The Tier-1 Prompt Engineering & Task Decomposition Engine** (rewriting raw user prompts using the `Project DNA` + `ScopedGraphContext`).
2. **The Automatic Memory Extractor** (converting raw chat turns into `ExtractedMemoryDelta` JSON to update KuzuDB).
3. **The Pre-Execution Router** (deciding what local Ollama executes with tools vs. what gets injected into Codex/Hermes).

Shall I proceed directly to **Step 2**

---

## Sources

1. **https://json-schema.org/draft/2020-12/schema"**
   https://json-schema.org/draft/2020-12/schema"

2. **https://cortexos.dev/schemas/project-dna.v1.json"**
   https://cortexos.dev/schemas/project-dna.v1.json"

