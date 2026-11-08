/**
 * CortexOS service worker (MV3) — owns daemon traffic (host_permissions),
 * the global hotkeys, the context menu and the badge.
 *
 * Flows:
 *   hotkey Ctrl/Cmd+Shift+Space → "rewrite the focused chat input":
 *     ask content script for input text → POST /rewrite → send the Tier-1
 *     prompt back for injection (+ toast)
 *   hotkey Ctrl/Cmd+Shift+V → "inject the sync packet":
 *     POST /sync/{slug} (records the handoff) → inject markdown (+ toast)
 */
/* global CortexCore, chrome */
importScripts('lib/core.js')

const Core = globalThis.CortexCore

// ---- install: context menu --------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'cortex-rewrite',
      title: 'Rewrite with CortexOS (Tier-1)',
      contexts: ['editable'],
    })
    chrome.contextMenus.create({
      id: 'cortex-inject-sync',
      title: 'Inject CortexOS sync packet',
      contexts: ['editable'],
    })
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'cortex-rewrite') runRewriteFlow(tab)
  if (info.menuItemId === 'cortex-inject-sync') runSyncFlow(tab)
})

// ---- global hotkeys -----------------------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'cortex-rewrite-prompt' && command !== 'cortex-inject-state') return
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (command === 'cortex-rewrite-prompt') runRewriteFlow(tab)
  else runSyncFlow(tab)
})

// ---- flows ---------------------------------------------------------------------

async function runRewriteFlow(tab) {
  try {
    const settings = await Core.loadSettings()
    if (!settings.slug) {
      notifyError(tab, 'No project selected — open the CortexOS popup and pick a project.')
      return
    }

    const harvest = await messageTab(tab, { type: 'cortex-rewrite-request' })
    if (!harvest || !harvest.ok) {
      notifyError(tab, (harvest && harvest.error) || 'No chat input found on this page.')
      return
    }

    setBadge(tab?.id, '…')
    const project = await Core.resolveProject(settings, settings.slug)
    const result = await Core.rewritePrompt(settings, project.id, harvest.text, settings.engine)

    await messageTab(tab, {
      type: 'cortex-rewrite-apply',
      prompt: result.prompt,
      result: { engineUsed: result.engineUsed, metrics: result.metrics },
    })
    setBadge(tab?.id, 'OK', '#34d399')
  } catch (error) {
    console.error('[cortexos]', error)
    await messageTab(tab, { type: 'cortex-error', error: errorMessage(error) }).catch(() => {})
    setBadge(tab?.id, 'ERR', '#f87171')
  }
}

async function runSyncFlow(tab) {
  try {
    const settings = await Core.loadSettings()
    if (!settings.slug) {
      notifyError(tab, 'No project selected — open the CortexOS popup and pick a project.')
      return
    }

    const harvest = await messageTab(tab, { type: 'cortex-inject-sync-request' })
    if (!harvest || !harvest.ok) {
      notifyError(tab, (harvest && harvest.error) || 'No chat input found on this page.')
      return
    }

    setBadge(tab?.id, '…')
    // POST records the handoff — this IS the Codex → <platform> switch.
    const { packet } = await Core.handoffPacket(settings, settings.slug, settings.platform)

    await messageTab(tab, {
      type: 'cortex-inject-sync-apply',
      markdown: packet.markdown,
      packet,
    })
    setBadge(tab?.id, 'SYNC', '#8b5cf6')
  } catch (error) {
    console.error('[cortexos]', error)
    await messageTab(tab, { type: 'cortex-error', error: errorMessage(error) }).catch(() => {})
    setBadge(tab?.id, 'ERR', '#f87171')
  }
}

// ---- helpers ---------------------------------------------------------------------

/** Send a message to the tab's content script, injecting it on demand. */
async function messageTab(tab, message) {
  if (!tab || typeof tab.id !== 'number') return null
  try {
    return await chrome.tabs.sendMessage(tab.id, message)
  } catch {
    // Content script not present yet (e.g. page loaded before install).
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/core.js', 'content.js'] })
      return await chrome.tabs.sendMessage(tab.id, message)
    } catch {
      return null
    }
  }
}

async function notifyError(tab, message) {
  await messageTab(tab, { type: 'cortex-error', error: message }).catch(() => {})
  console.error('[cortexos]', message)
}

function setBadge(tabId, text, color) {
  if (typeof tabId !== 'number') return
  chrome.action.setBadgeText({ tabId, text })
  if (color) chrome.action.setBadgeBackgroundColor({ tabId, color })
  if (text === 'OK' || text === 'SYNC') {
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' })
    }, 2500)
  }
}

function errorMessage(error) {
  if (error && error.name === 'AbortError') return 'Daemon timed out — is cortexd running?'
  return error && error.message ? error.message : String(error)
}

// ---- periodic daemon heartbeat (badge colour on the toolbar icon) ----------

async function heartbeat() {
  try {
    const settings = await Core.loadSettings()
    const health = await Core.health(settings)
    await chrome.action.setBadgeBackgroundColor({ color: health.status === 'online' ? '#34d399' : '#f87171' })
    await chrome.action.setTitle({ title: `CortexOS — daemon ${health.status} (${health.counts?.projects ?? 0} projects)` })
  } catch {
    await chrome.action.setTitle({ title: 'CortexOS — daemon unreachable (start cortexd)' })
  }
}

chrome.runtime.onStartup.addListener(heartbeat)
heartbeat()
chrome.alarms?.create?.('cortex-heartbeat', { periodInMinutes: 2 })
chrome.alarms?.onAlarm?.addListener?.((alarm) => {
  if (alarm.name === 'cortex-heartbeat') heartbeat()
})
