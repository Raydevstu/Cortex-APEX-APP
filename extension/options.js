/* CortexOS options page. */
/* global CortexCore */
const Core = globalThis.CortexCore

const els = {
  daemonUrl: document.getElementById('daemonUrl'),
  defaultSlug: document.getElementById('defaultSlug'),
  engine: document.getElementById('engine'),
  platform: document.getElementById('platform'),
  save: document.getElementById('save'),
  saved: document.getElementById('saved'),
}

async function boot() {
  const settings = await Core.loadSettings()
  els.daemonUrl.value = settings.daemonUrl
  els.defaultSlug.value = settings.slug
  els.engine.value = settings.engine
  els.platform.value = settings.platform

  els.save.addEventListener('click', async () => {
    await Core.saveSettings({
      daemonUrl: els.daemonUrl.value.trim() || Core.DEFAULTS.daemonUrl,
      slug: els.defaultSlug.value.trim(),
      engine: els.engine.value,
      platform: els.platform.value,
    })
    els.saved.style.opacity = '1'
    setTimeout(() => (els.saved.style.opacity = '0'), 1600)
  })
}

boot()
