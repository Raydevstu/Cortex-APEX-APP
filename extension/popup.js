/* CortexOS popup — daemon status, project/engine/target pickers, actions. */
/* global CortexCore, chrome */
const Core = globalThis.CortexCore

const els = {
  status: document.getElementById('status'),
  project: document.getElementById('project'),
  engine: document.getElementById('engine'),
  platform: document.getElementById('platform'),
  rewrite: document.getElementById('rewrite'),
  copyPacket: document.getElementById('copyPacket'),
  captureClipboard: document.getElementById('captureClipboard'),
  openDaemon: document.getElementById('openDaemon'),
  openOptions: document.getElementById('openOptions'),
}

let settings = null

async function boot() {
  settings = await Core.loadSettings()

  els.openDaemon.addEventListener('click', (e) => {
    e.preventDefault()
    chrome.tabs.create({ url: settings.daemonUrl })
  })
  els.openOptions.addEventListener('click', (e) => {
    e.preventDefault()
    chrome.runtime.openOptionsPage()
  })

  // Status + project list
  try {
    const health = await Core.health(settings)
    els.status.textContent = `daemon online · ${health.counts?.projects ?? 0} projects · v${health.version}`
    els.status.className = 'online'
  } catch (error) {
    els.status.textContent = `daemon offline — ${error.message}`
    els.status.className = 'offline'
  }

  try {
    const { projects } = await Core.listProjects(settings)
    els.project.innerHTML = ''
    if (projects.length === 0) {
      els.project.innerHTML = '<option value="">no projects — create one first</option>'
    } else {
      for (const project of projects) {
        const option = document.createElement('option')
        option.value = project.slug
        option.textContent = `${project.name} (/${project.slug})`
        els.project.appendChild(option)
      }
      els.project.value = projects.some((p) => p.slug === settings.slug) ? settings.slug : projects[0].slug
      await Core.saveSettings({ slug: els.project.value })
    }
  } catch {
    els.project.innerHTML = '<option value="">daemon unreachable</option>'
  }

  els.engine.value = settings.engine || 'fast'
  els.platform.value = settings.platform || 'codex'

  els.project.disabled = false
  els.engine.disabled = false
  els.platform.disabled = false
  els.rewrite.disabled = false
  els.copyPacket.disabled = false
  els.captureClipboard.disabled = false

  els.project.addEventListener('change', () => Core.saveSettings({ slug: els.project.value }))
  els.engine.addEventListener('change', () => Core.saveSettings({ engine: els.engine.value }))
  els.platform.addEventListener('change', () => Core.saveSettings({ platform: els.platform.value }))

  els.rewrite.addEventListener('click', () => withTab(runRewrite))
  els.copyPacket.addEventListener('click', copyPacket)
  els.captureClipboard.addEventListener('click', captureClipboard)
}

async function withTab(fn) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  await fn(tab)
}

async function runRewrite(tab) {
  note('')
  try {
    const harvest = await chrome.tabs.sendMessage(tab.id, { type: 'cortex-rewrite-request' }).catch(() => null)
    if (!harvest || !harvest.ok) {
      note((harvest && harvest.error) || 'No chat input found on the focused page.', false)
      return
    }
    const project = await Core.resolveProject(settings, settings.slug)
    const result = await Core.rewritePrompt(settings, project.id, harvest.text, els.engine.value)
    await chrome.tabs.sendMessage(tab.id, {
      type: 'cortex-rewrite-apply',
      prompt: result.prompt,
      result: { engineUsed: result.engineUsed, metrics: result.metrics, preExec: result.preExec },
    })
    note(
      els.engine.value === 'preexec'
        ? `Local agent done · ~${result.metrics.tokensSavedCloud ?? 0} cloud tokens saved`
        : `Tier-1 prompt injected · ${result.metrics.tokensContextAvoided} tokens avoided`,
    )
  } catch (error) {
    note(error.message, false)
  }
}

async function copyPacket() {
  note('')
  try {
    const packet = await Core.statePacket(settings, settings.slug, els.platform.value)
    await navigator.clipboard.writeText(packet.markdown)
    note(`Sync packet copied · state #${packet.stateHash} · ${packet.tokens} tokens`)
  } catch (error) {
    note(error.message, false)
  }
}

async function captureClipboard() {
  note('')
  try {
    const text = await navigator.clipboard.readText()
    if (!text || text.trim().length < 5) {
      note('Clipboard is empty or too short.', false)
      return
    }
    const project = await Core.resolveProject(settings, settings.slug)
    const result = await Core.captureInteraction(settings, project.id, text, 'web', 'Clipboard capture')
    note(`Captured: ${result.extracted.filter((m) => !m.deduped).length} new memories · episode indexed`)
  } catch (error) {
    note(error.message, false)
  }
}

function note(message, ok = true) {
  const existing = document.querySelector('.result-note')
  if (existing) existing.remove()
  if (!message) return
  const el = document.createElement('button')
  el.className = 'result-note'
  el.disabled = true
  el.textContent = message
  el.style.color = ok ? '#34d399' : '#f87171'
  document.querySelector('.panel:last-of-type').appendChild(el)
}

boot()
