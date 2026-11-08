/**
 * CortexOS Extension Core — shared logic for the content script, the
 * service worker, the popup and the Node test suite.
 *
 * Loaded three ways (UMD-lite pattern, zero dependencies):
 *   1. <script src="lib/core.js">            → globalThis.CortexCore
 *   2. importScripts('lib/core.js') in SW    → globalThis.CortexCore
 *   3. require('./lib/core.js') in Node      → module.exports
 *
 * All daemon traffic goes through here so every surface shares the exact
 * same request builders and injection behaviour.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  } else {
    root.CortexCore = api
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict'

  const DEFAULTS = {
    daemonUrl: 'http://localhost:3000',
    slug: '',
    engine: 'fast',
    platform: 'codex',
  }

  const ENGINES = ['fast', 'deep', 'cloud']

  // ---- Settings (chrome.storage.sync when present; localStorage fallback
  //      so the harness page and Node can exercise the same code paths) ----

  function loadSettings() {
    const area = getStorage()
    if (area && typeof area.get === 'function') {
      return new Promise((resolve) => {
        area.get(DEFAULTS, (stored) => resolve({ ...DEFAULTS, ...stored }))
      })
    }
    try {
      const raw = root.localStorage.getItem('cortexos-settings')
      return Promise.resolve({ ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) })
    } catch {
      return Promise.resolve({ ...DEFAULTS })
    }
  }

  function saveSettings(patch) {
    const area = getStorage()
    if (area && typeof area.set === 'function') {
      return new Promise((resolve) => {
        area.set(patch, () => resolve({ ...DEFAULTS, ...patch }))
      })
    }
    try {
      const merged = { ...DEFAULTS, ...(JSON.parse(root.localStorage.getItem('cortexos-settings') || '{}') || {}), ...patch }
      root.localStorage.setItem('cortexos-settings', JSON.stringify(merged))
      return Promise.resolve(merged)
    } catch {
      return Promise.resolve({ ...DEFAULTS, ...patch })
    }
  }

  function getStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) return chrome.storage.sync
    return null
  }

  // ---- Daemon client -------------------------------------------------------

  async function daemonFetch(settings, method, path, body) {
    const base = (settings.daemonUrl || DEFAULTS.daemonUrl).replace(/\/$/, '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetch(`${base}/api/cortex${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      let json = null
      try {
        json = await response.json()
      } catch {
        json = null
      }
      if (!response.ok) {
        const message = json && typeof json === 'object' && 'error' in json ? String(json.error) : `daemon returned ${response.status}`
        throw new Error(message)
      }
      return json
    } finally {
      clearTimeout(timer)
    }
  }

  const health = (settings) => daemonFetch(settings, 'GET', '/health')

  const listProjects = (settings) => daemonFetch(settings, 'GET', '/projects')

  async function resolveProject(settings, slug) {
    const { projects } = await listProjects(settings)
    const project = (projects || []).find((p) => p.slug === slug)
    if (!project) {
      const known = (projects || []).map((p) => p.slug).join(', ') || 'none'
      throw new Error(`Unknown project "${slug}" (known: ${known})`)
    }
    return project
  }

  const rewritePrompt = (settings, projectId, prompt, engine) =>
    daemonFetch(settings, 'POST', '/rewrite', { projectId, prompt, engine: engine || 'fast' })

  const statePacket = (settings, slug, targetPlatform) =>
    daemonFetch(settings, 'GET', `/sync/${encodeURIComponent(slug)}${targetPlatform ? `?target=${encodeURIComponent(targetPlatform)}` : ''}`)

  const handoffPacket = (settings, slug, targetPlatform, module) =>
    daemonFetch(settings, 'POST', `/sync/${encodeURIComponent(slug)}`, {
      targetPlatform: targetPlatform || 'codex',
      ...(module ? { module } : {}),
    })

  const captureInteraction = (settings, projectId, text, platform, title) =>
    daemonFetch(settings, 'POST', '/interactions', {
      projectId,
      text,
      ...(platform ? { platform } : {}),
      ...(title ? { title } : {}),
    })

  // ---- Site adapters (Pillar 12 — works everywhere) -------------------------

  const SITE_ADAPTERS = [
    {
      id: 'chatgpt',
      match: (url) => /(^|\.)chatgpt\.com$/.test(hostOf(url)) || /(^|\.)chat\.openai\.com$/.test(hostOf(url)),
      inputSelectors: ['#prompt-textarea', 'textarea[data-id="root"]', 'div[contenteditable="true"]#prompt-textarea', 'textarea'],
    },
    {
      id: 'claude',
      match: (url) => /(^|\.)claude\.ai$/.test(hostOf(url)),
      inputSelectors: ['div[contenteditable="true"].ProseMirror', 'fieldset div[contenteditable="true"]', 'div[contenteditable="true"]'],
    },
    {
      id: 'gemini',
      match: (url) => /(^|\.)gemini\.google\.com$/.test(hostOf(url)),
      inputSelectors: ['rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"]', 'textarea'],
    },
    {
      id: 'qwen',
      match: (url) => /(^|\.)chat\.qwenlm\.ai$/.test(hostOf(url)) || /(^|\.)tongyi\.aliyun\.com$/.test(hostOf(url)),
      inputSelectors: ['textarea#chat-input', 'div[contenteditable="true"]', 'textarea'],
    },
    {
      id: 'generic',
      match: () => true,
      inputSelectors: ['textarea', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]'],
    },
  ]

  function adapterFor(url) {
    return SITE_ADAPTERS.find((a) => a.match(url)) || SITE_ADAPTERS[SITE_ADAPTERS.length - 1]
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname
    } catch {
      return ''
    }
  }

  // ---- DOM: find the chat input & inject ------------------------------------

  function findChatInput(doc) {
    const adapter = adapterFor(doc.location ? doc.location.href : '')
    for (const selector of adapter.inputSelectors) {
      for (const el of doc.querySelectorAll(selector)) {
        if (!isVisible(el, doc)) continue
        // Prefer empty-ish, writable inputs near the bottom of the page.
        return { el, kind: inputKind(el), adapter: adapter.id }
      }
    }
    return null
  }

  function inputKind(el) {
    const tag = (el.tagName || '').toLowerCase()
    if (tag === 'textarea' || tag === 'input') return 'editable'
    if (el.isContentEditable) return 'contenteditable'
    return null
  }

  function isVisible(el, doc) {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) return false
    const style = (doc.defaultView || root).getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }

  function getInputValue(el) {
    const kind = inputKind(el)
    if (kind === 'editable') return el.value || ''
    if (kind === 'contenteditable') return (el.innerText || el.textContent || '').trim()
    return ''
  }

  /**
   * Replace the input's content with the rewritten prompt and fire the
   * events modern frameworks (React 19, ProseMirror, …) listen for.
   */
  function injectText(doc, el, text) {
    const kind = inputKind(el)
    if (kind === 'editable') {
      el.focus()
      const descriptor = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')
      if (descriptor && descriptor.set) descriptor.set.call(el, text)
      else el.value = text
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    if (kind === 'contenteditable') {
      el.focus()
      // select all then replace — works for ProseMirror/Quill/Draft.
      const selection = doc.getSelection()
      const range = doc.createRange()
      range.selectNodeContents(el)
      selection.removeAllRanges()
      selection.addRange(range)
      let inserted = false
      try {
        inserted = doc.execCommand('insertText', false, text)
      } catch {
        inserted = false
      }
      if (!inserted) {
        el.textContent = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return true
    }
    return false
  }

  // ---- Toast ------------------------------------------------------------------

  function showToast(doc, message, ok = true) {
    const host = doc.createElement('div')
    host.setAttribute('data-cortexos-toast', '')
    host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;'
    const shadow = host.attachShadow({ mode: 'open' })
    const style = doc.createElement('style')
    style.textContent = `
      .toast{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;display:flex;align-items:center;gap:10px;
        background:rgba(15,15,20,.94);color:#e4e4ef;border:1px solid rgba(139,92,246,.45);border-radius:12px;
        padding:10px 14px;font-size:12.5px;max-width:340px;box-shadow:0 8px 28px rgba(0,0,0,.45);
        animation:in .18s ease-out}
      .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${ok ? '#34d399' : '#f87171'}}
      .title{font-weight:600}
      .sub{color:#a1a1b5;margin-top:2px}
      @keyframes in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
    `
    const toast = doc.createElement('div')
    toast.className = 'toast'
    const dot = doc.createElement('span')
    dot.className = 'dot'
    const body = doc.createElement('div')
    const [title, ...subs] = String(message).split('\n')
    const titleEl = doc.createElement('div')
    titleEl.className = 'title'
    titleEl.textContent = title
    body.appendChild(titleEl)
    if (subs.length > 0) {
      const sub = doc.createElement('div')
      sub.className = 'sub'
      sub.textContent = subs.join(' ')
      body.appendChild(sub)
    }
    toast.appendChild(dot)
    toast.appendChild(body)
    shadow.appendChild(style)
    shadow.appendChild(toast)
    doc.documentElement.appendChild(host)
    setTimeout(() => host.remove(), 4200)
    return host
  }

  // ---- Formatting helpers ------------------------------------------------------

  function rewriteToastMessage(result) {
    const avoided = result && result.metrics ? result.metrics.tokensContextAvoided : 0
    const engine = result && result.engineUsed ? result.engineUsed : 'fast'
    return `CortexOS injected a Tier-1 prompt\nengine: ${engine} · ~${avoided} context tokens avoided`
  }

  function syncToastMessage(packet) {
    return `CortexOS injected the sync packet\nstate #${packet.stateHash} · ${packet.tokens} tokens · ${packet.header ? `${packet.header.previousPlatform} → ${packet.header.targetPlatform}` : ''}`
  }

  return {
    DEFAULTS,
    ENGINES,
    loadSettings,
    saveSettings,
    daemonFetch,
    health,
    listProjects,
    resolveProject,
    rewritePrompt,
    statePacket,
    handoffPacket,
    captureInteraction,
    SITE_ADAPTERS,
    adapterFor,
    findChatInput,
    getInputValue,
    injectText,
    showToast,
    rewriteToastMessage,
    syncToastMessage,
  }
})
