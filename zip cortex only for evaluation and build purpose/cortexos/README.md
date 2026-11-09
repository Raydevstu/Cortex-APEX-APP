# CortexOS — Full-Stack Reference Codebase (Steps 1–6)

Local-First AI Software Engineering Operating System that preserves project memory across **Codex, Claude Code, Hermes, Cursor, OpenCode, and Web AI Chats**, upgrades raw prompts via local **Ollama SLMs**, enforces **AST & File Scope Locks**, and cuts paid cloud token usage by 80–90%.

## Quick Start

```bash
# 1. Run the zero-dependency Python AST Scope Guard TDD Suite
python3 -m unittest discover -s tests -p "test_*.py" -v

# 2. Install Node/TypeScript packages
pnpm install

# 3. Bootstrap the repository AST snapshot (.cortex/graph-snapshot.json)
pnpm run init
```
