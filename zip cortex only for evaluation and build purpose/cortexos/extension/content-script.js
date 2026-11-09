// CortexOS Browser Content Script (Alt+Shift+C to inject compact sync header & rewrite prompt)
(function () {
  const BRIDGE_URL = 'http://127.0.0.1:11436/api/sync';

  window.addEventListener('keydown', async (event) => {
    if (event.altKey && event.shiftKey && event.code === 'KeyC') {
      event.preventDefault();
      try {
        const res = await fetch(BRIDGE_URL);
        const packet = await res.json();
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
          const existing = activeEl.value || activeEl.innerText || '';
          const enriched = `${packet.compactContextHeader}\n\n---\n${existing}`;
          if (activeEl.tagName === 'TEXTAREA') {
            activeEl.value = enriched;
          } else {
            activeEl.innerText = enriched;
          }
        }
      } catch (err) {
        console.error('[CortexOS Extension] Failed to reach local daemon:', err);
      }
    }
  });
})();
