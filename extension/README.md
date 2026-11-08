# CortexOS Browser Extension (Manifest V3)

The Browser DOM watcher — blueprint §1 universal hook #3 and Pillar 12 ("AI Browser Extension — works everywhere").

## What it does

- **Tier-1 rewrite in place** — on any AI chat page (ChatGPT, Claude, Gemini, Codex web, Bolt, v0, or any page with a text box), type your raw prompt and press **Ctrl/Cmd+Shift+Space** (global). The extension harvests the input, sends it to the Cortex daemon, and replaces it with the enterprise-grade Tier-1 prompt — with a toast showing engine + tokens avoided.
- **Sync packet injection** — press **Ctrl/Cmd+Shift+V** (global) to inject the compact cross-platform state packet into the input. This executes a real platform handoff (recorded by the daemon).
- **Context menu** — right-click any editable field → "Rewrite with CortexOS (Tier-1)" / "Inject CortexOS sync packet".
- **Popup** — daemon status, project picker, engine picker, handoff target, "Copy sync packet", "Capture clipboard as interaction" (feeds the memory engine + episodic store).

## Install (developer mode)

1. Download/unzip `cortexos-extension-v0.2.0.zip` (or use the `extension/` folder directly).
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** → select the `extension/` folder.
4. Click the CortexOS icon → set the daemon URL (default `http://localhost:3000`) and pick a project.

## Architecture

```
popup.js / options.js ─┐
                       ├─► lib/core.js (shared, zero-dep, UDM-lite) ──► daemon API
background.js (SW) ────┤        ▲                                        /api/cortex/*
content.js ────────────┘────────┘ DOM: find input → inject → toast
```

- **All daemon traffic happens in the service worker** (`host_permissions`), the content script only touches the DOM — the standard MV3 security posture.
- `lib/core.js` is loadable three ways: `<script>`, `importScripts` (service worker), and `require()` (Node) — which is how the automated suite unit-tests it, and why the daemon's E2E harness page (`/cortex-extension-test.html`) can run the **real** extension code in a browser.
- Site adapters ship for ChatGPT, Claude, Gemini and Qwen, with a generic fallback (textarea / contenteditable) — so it works everywhere.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, permissions, global commands |
| `background.js` | Service worker: hotkeys, context menu, daemon calls, badge heartbeat |
| `content.js` | DOM watcher: input harvest, injection, toasts |
| `lib/core.js` | Shared logic (settings, daemon client, site adapters, DOM injection) |
| `popup.html/js/css` | Toolbar popup |
| `options.html/js` | Settings page |
| `icons/` | 16/32/48/128 PNG set |
