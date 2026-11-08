/**
 * CortexOS content script — the Browser DOM watcher (blueprint §1 hook 3,
 * Pillar 12). Passive by design: it only acts when the service worker (or
 * the global hotkey via the service worker) sends a message. All daemon
 * traffic stays in the background worker; this script owns the DOM.
 */
(function () {
  'use strict'
  const Core = globalThis.CortexCore
  if (!Core) return

  globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return

    // Step 1 of the rewrite flow: harvest the current input text.
    if (message.type === 'cortex-rewrite-request' || message.type === 'cortex-inject-sync-request') {
      const found = Core.findChatInput(document)
      if (!found) {
        sendResponse({ ok: false, error: 'No chat input found on this page.' })
        return
      }
      const text = Core.getInputValue(found.el)
      if (message.type === 'cortex-inject-sync-request') {
        sendResponse({ ok: true, kind: found.kind, empty: text.length === 0 })
        return
      }
      if (!text || text.trim().length < 3) {
        sendResponse({ ok: false, error: 'Type your raw prompt first — CortexOS rewrites what is in the input box.' })
        return
      }
      sendResponse({ ok: true, text, kind: found.kind })
      return
    }

    // Step 2 of the rewrite flow: replace the input with the Tier-1 prompt.
    if (message.type === 'cortex-rewrite-apply') {
      const found = Core.findChatInput(document)
      if (!found) {
        sendResponse({ ok: false, error: 'Input vanished.' })
        return
      }
      Core.injectText(document, found.el, message.prompt)
      Core.showToast(document, Core.rewriteToastMessage(message.result), true)
      sendResponse({ ok: true })
      return
    }

    // Step 2 of the sync flow: inject the compact state packet.
    if (message.type === 'cortex-inject-sync-apply') {
      const found = Core.findChatInput(document)
      if (!found) {
        sendResponse({ ok: false, error: 'Input vanished.' })
        return
      }
      const current = Core.getInputValue(found.el)
      const merged = current && current.trim().length > 0
        ? `${message.markdown}\n\n---\n${current}`
        : message.markdown
      Core.injectText(document, found.el, merged)
      Core.showToast(document, Core.syncToastMessage(message.packet), true)
      sendResponse({ ok: true })
      return
    }

    if (message.type === 'cortex-error') {
      Core.showToast(document, `CortexOS: ${message.error}`, false)
      sendResponse({ ok: true })
    }
  })
})()
