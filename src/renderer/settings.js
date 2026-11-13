// Einstellungen: Arbeitsspeicher-Regler, Offline-Modus und das Offline-Abzeichen in der Seitenleiste.
async function initSettings() {
  const cfg = (await run(() => api.call('config:get'))) || { memoryMax: 4 };
  const slider = $('#memory');
  const label = $('#memory-value');
  slider.value = cfg.memoryMax;
  label.textContent = `${cfg.memoryMax} GB`;
  slider.oninput = () => { label.textContent = `${slider.value} GB`; };
  slider.onchange = () => run(() => api.call('config:set', { memoryMax: Number(slider.value) }));
  const offline = $('#offline');
  const badge = $('#offline-badge');
  const showBadge = (manual, online) => {
    badge.textContent = manual ? 'Offline-Modus' : 'Keine Verbindung';
    badge.classList.toggle('hidden', !manual && online);
  };
  offline.checked = !!cfg.offlineMode;
  showBadge(offline.checked, cfg.online !== false);
  offline.onchange = async () => {
    await run(() => api.call('config:set', { offlineMode: offline.checked }));
    showBadge(offline.checked, navigator.onLine);
    if (state.current) search();
  };
  window.addEventListener('online', () => showBadge(offline.checked, true));
  window.addEventListener('offline', () => showBadge(offline.checked, false));
}
