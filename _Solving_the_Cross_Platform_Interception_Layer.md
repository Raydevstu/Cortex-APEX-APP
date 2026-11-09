Your **First Proposed Plan for CortexOS** is an exceptional product vision. You have accurately identified the single biggest bottleneck in modern AI engineering: **stateless, fragmented intelligence**. 

However, moving from this high-level vision to a **working, buildable system** requires solving four hard engineering gaps that aren't yet addressed in the draft:

1. **The Interception Problem:** A browser extension alone can inject into web chats (ChatGPT, Claude Web), but CLI/IDE tools (Codex CLI, OpenCode, Hermes, Cursor, Windsurf) don't run inside a browser DOM.
2. **Local Model Tool Execution:** How local Ollama models actually execute file reads, web searches, and bash scripts *before* handing the final payload to the main platform.
3. **Zero-Token Context Injection:** Injecting memory into Codex or Hermes *still uses tokens on the target platform* unless you use **Delta-Sync + Symbolic Pointers + Pre-completed Artifacts**.
4. **Latency Bottlenecks:** If 7 local agents run sequentially before rewriting a prompt, the user waits 45 seconds just to paste a prompt.

Below is the **Refined Engineering Blueprint (v2.0)** that bridges your vision into an actual, buildable architecture.

---

### 1. Solving the Cross-Platform Interception Layer (How it *Actually* Connects Everywhere)

To work across **Codex, Hermes, OpenCode, Cursor, Claude, and Web UIs** simultaneously without manual copy-pasting, CortexOS cannot just be a browser extension. It must be a **Local Background Daemon (`cortexd`)** with **three universal hooks**:

```
                     ┌──────────────────────────────────────┐
                     │     CortexOS Local Daemon (Rust/Go)  │
                     │   + Local Ollama + Knowledge Graph   │
                     └──────┬───────────┬────────────┬──────┘
                            │           │            │
         ┌──────────────────┘           │            └──────────────────┐
         ▼                              ▼                               ▼
┌─────────────────────┐      ┌──────────────────────┐       ┌──────────────────────┐
│  1. MCP Server      │      │ 2. Local LLM Proxy   │       │ 3. Browser + OS Hook │
│  (stdio / SSE)      │      │ (http://127.0.0.1)   │       │ (DOM + OS Clipboard) │
└────────┬────────────┘      └──────────┬───────────┘       └───────────┬──────────┘
         │                              │                               │
   Auto-syncs with:              Intercepts API calls:           Injects into Web UIs:
   • Codex / OpenCode            • Custom base_url               • ChatGPT / Claude Web
   • Hermes / Claude Code        • Transparent middleman         • Bolt / v0 / Lovable
   • Cursor / Windsurf           • Zero config changes           • Global Hotkey (Cmd+Shift+V)
```

1. **Universal MCP (Model Context Protocol) Server:** Codex, OpenCode, Cursor, Windsurf, and Claude all support MCP. CortexOS exposes a single local MCP toolset (`cortex_sync`, `cortex_get_dna`, `cortex_log_decision`). Whenever any IDE/CLI agent boots up, it automatically pulls the current project state from CortexOS.
2. **Local Reverse Proxy (`localhost:11435/v1`):** For tools where you configure an API key/endpoint, you point them to CortexOS's local proxy. CortexOS intercepts the raw prompt, runs local Ollama pre-processing, compresses the history, and forwards only the optimized payload to the real API.
3. **Browser Extension + OS Global Interceptor:** For web apps (ChatGPT, Claude Web, Bolt, v0) or closed UIs, the Browser Extension watches the chat input box (and an OS-level hotkey `Ctrl/Cmd + Shift + Space` hooks into any desktop app) to intercept your raw prompt, rewrite it, and auto-paste the Tier-1 structured payload.

---

### 2. The "Pre-Execution" Pipeline (How Local Models Complete 80% of the Work First)

In your core problem (#4), you stated: *The tool should analyze the prompt, complete common tasks with local/free/Ollama models using tool execution and web search, and ONLY inject the main core task into Codex.*

Here is the exact **Pre-Execution Pipeline** to make that happen fast:

#### Example Scenario:
* **Your Raw Prompt:** *"add stripe webhook for subscription renewal and update user db"*

#### What CortexOS Does Locally (0 Cloud Tokens Used):
1. **Intent & AST Triage (Local Qwen-2.5-Coder-7B / Llama-3.2-3B):**
   * Scans your local codebase via **Tree-sitter AST** (Abstract Syntax Tree—instant, zero LLM tokens needed).
   * Locates your existing Prisma/Drizzle schema (`schema.prisma`) and existing auth/payment routes.
2. **Local Tool & Web Execution (Local Agent):**
   * Runs a local web search scraper to pull the latest Stripe API webhook signature syntax if not cached.
   * Generates the boilerplate types, `.env.example` updates, and database migration SQL locally using Ollama.
   * Writes those boilerplate changes directly to a staging branch or temporary patch.
3. **Tier-1 Prompt Synthesis & Delta Injection:**
   * Instead of asking Codex to figure out your whole project and write boilerplate, CortexOS injects **only the high-complexity core task** into Codex along with the pre-completed work:

```markdown
[CORTEX-OS SYNC | Project: SaaS-CRM | Sprint #4 | Delta State: Hash #9f8a]
- Existing Stack: Next.js 15 (App Router), PostgreSQL, Prisma, Clerk Auth.
- Pre-Executed by Cortex Local Agent:
  1. Added `stripeSubscriptionId` and `currentPeriodEnd` to `prisma/schema.prisma` (already applied).
  2. Verified webhook route target: `src/app/api/webhooks/stripe/route.ts`.
- YOUR CORE TASK (Codex):
  Write ONLY the idempotent webhook handler logic in `src/app/api/webhooks/stripe/route.ts` handling `invoice.payment_succeeded` and `customer.subscription.deleted`, ensuring race-condition safety with Clerk user metadata.
```

**Result:** Codex doesn't waste 15,000 tokens reading files, guessing your schema, or writing boilerplate. It spends **400 tokens** solving only the hardest architectural logic.

---

### 3. True "Zero-Token" Cross-Platform Memory Sync (Delta State Packets)

If you switch from **Codex** to **Hermes**, dumping a 5,000-word project summary into Hermes will still burn your Hermes context window. 

To solve this, CortexOS should use **3-Tier Hybrid Memory**:

| Memory Tier | Technology | How It Saves Tokens |
| :--- | :--- | :--- |
| **1. Deterministic Code Map** | **Tree-sitter + SQLite** | Parses files into function signatures & imports without using an LLM. Gives any AI exact file/line pointers instead of raw code dumps. |
| **2. Project Knowledge Graph** | **KuzuDB / FalkorDB (Embedded Graph DB)** | Stores strict triples: `(AuthModule) --[USES]--> (Clerk)` and `(Checkout) --[BLOCKED_BY]--> (Bug #14)`. Only queries nodes touched by the current prompt! |
| **3. Episodic Chat Delta** | **LanceDB (Local Vectors) + Ollama** | Every chat turn in Codex is summarized in the background by a local 3B model into a **State Diff** (what changed in the last 5 minutes). |

When you switch from **Codex → Hermes**, CortexOS only injects the **Compact State Header (~150–300 tokens)** plus an MCP tool hook so Hermes can query deeper history on demand rather than stuffing everything into the prompt upfront.

---

### 4.Fixing the Multi-Agent Latency Trap (Fast-Path vs. Deep-Path)

In Pillar 7 & 9, having 7 agents (Planner, Architect, Research, Security, Refactor, Tester, Docs) is powerful, but if they run on every prompt, your workflow will feel slow.

**Solution: Speculative 2-Speed Routing**
* **Fast-Path (< 800ms):** When you type a prompt, a lightweight local classifier (`Qwen2.5-1.5B` or `SmolLM2`) instantly pulls the relevant nodes from the Knowledge Graph and rewrites your prompt into the **Tier-1 Structured Prompt** using your `PROJECT DNA`.
* **Deep-Path (Async / Background):** The 7 specialized agents don't block your typing!
  * While you are chatting, the **Memory Agent** and **Knowledge Graph Agent** silently extract decisions in the background.
  * When a commit or file save happens, the **Security Agent** and **Tester Agent** run locally in the background via Ollama and append findings to the Knowledge Graph ("Warning: New route missing rate-limit").
  * Only when you trigger a massive task (e.g., *"Build Dashboard"*) does the **Planner + Pre-Execution Agent** step in before routing to Codex.

---

### 5. Recommended Tech Stack to Build CortexOS

To keep CortexOS fast, local-first, and cross-platform:

* **Core Desktop Daemon & UI Overlay:** **Tauri v2 (Rust + React/TypeScript)** — Uses 10x less RAM than Electron, gives native OS clipboard/shortcut hooks, and runs silently in the system tray.
* **Local AI Runtime:** **Ollama** + **LiteLLM** (for unified routing between local models like `qwen2.5-coder:7b` / `deepseek-r1:8b` and cloud APIs).
* **Storage Engine (100% Local Single-Folder):**
  * **Graph DB:** `KuzuDB` (embedded, serverless graph database—like SQLite for Knowledge Graphs).
  * **Vector DB:** `LanceDB` (embedded, zero-config vector search).
  * **Relational / Timeline:** `SQLite` (stores the Development Timeline, token savings metrics, and raw chat logs).
* **Codebase Intelligence:** `Tree-sitter` (instant multi-language AST parsing) + `Chokidar` / Rust `notify` (real-time file system watcher that updates the Knowledge Graph the second a file is saved by Codex or Hermes).
* **Browser Extension:** **WXT Framework (Manifest V3)** — Connects to the local Tauri daemon via WebSockets (`ws://localhost:11436`) to inject enhanced prompts and scrape chat responses from ChatGPT, Claude, etc.

---

### 6. Phased MVP Execution Roadmap (How to Build It Without Getting Overwhelmed)

If you try to build all 12 Pillars at once, the project will stall. Build it in **4 Modular Phases**:

* **Phase 1: The Brain & Prompt Interceptor (Weeks 1–2)**
  * Build the local daemon + SQLite/KuzuDB Knowledge Graph + Project DNA generator.
  * Build the **Tier-1 Prompt Rewriter** powered by local Ollama (`qwen2.5-coder:7b`) that reads your Project DNA and turns raw 1-line prompts into enterprise specifications via a global hotkey or browser extension.
* **Phase 2: Cross-Platform Sync Engine (Weeks 3–4)**
  * Add the file watcher + Git hook + Browser DOM watcher + MCP server.
  * Now, any work done in **Codex** automatically updates the Knowledge Graph, and switching to **Hermes** or **OpenCode** automatically injects the latest project state.
* **Phase 3: Pre-Execution Local Agent & Token Optimizer (Weeks 5–6)**
  * Give the local Ollama layer tool-calling capabilities (File Read/Write, Web Search via local SearXNG/DuckDuckGo, Terminal execution).
  * Implement the **Smart Router** that completes boilerplate/research locally and sends only the core architectural delta to Codex.
* **Phase 4: Visual Command Center & AI CTO Mode (Weeks 7–8)**
  * Build the visual Knowledge Graph explorer, Development Timeline UI, and Token Savings Dashboard.

---

### Where would you like to go next?
We can dive straight into building any piece of **CortexOS**:
1. **Design the exact JSON/Graph Schema** for the `PROJECT DNA` and Knowledge Graph nodes.
2. **Write the Master System Prompt** for the **Tier-1 Prompt Engineering & Task Decomposition Engine** (so you can test it on your local Ollama right now).
3. **Architect the Codex ↔ CortexOS ↔ Hermes Sync Protocol** (MCP + Local Daemon code structure).