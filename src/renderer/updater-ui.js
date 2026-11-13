// Oberfläche für Launcher-Updates: Karte "Über & Updates" in den Einstellungen.
// Der Hauptprozess (src/main/updater.js) meldet jeden Statuswechsel über das Ereignis "updater".
(() => {
  const status = $('#update-status');
  if (!status || !api) return;
  const version = $('#app-version');
  const progress = $('#update-progress');
  const bar = $('#update-progress-bar');
  const notes = $('#update-notes');
  const btnCheck = $('#update-check');
  const btnDownload = $('#update-download');
  const btnInstall = $('#update-install');
  const btnReleases = $('#update-releases');
  const navSettings = document.querySelector('.nav[data-view="settings"]');
  let announced = null; // Version, auf die schon per Hinweis aufmerksam gemacht wurde

  function render(s) {
    if (!s) return;
    if (s.currentVersion) version.textContent = s.currentVersion;
    status.textContent = s.message || '';
    const warn = s.state === 'error' || !!s.warn;
    status.classList.toggle('info', !warn && (s.state === 'available' || s.state === 'downloading' || s.state === 'downloaded'));
    status.classList.toggle('warn', warn);
    progress.classList.toggle('hidden', s.state !== 'downloading');
    bar.style.width = `${s.state === 'downloading' ? s.percent || 0 : 0}%`;
    const showNotes = !!s.notes && (s.state === 'available' || s.state === 'downloading' || s.state === 'downloaded');
    notes.classList.toggle('hidden', !showNotes);
    notes.textContent = showNotes ? s.notes : '';
    btnCheck.disabled = s.state === 'disabled' || s.state === 'checking' || s.state === 'downloading';
    btnCheck.classList.toggle('hidden', s.state === 'downloaded');
    btnDownload.classList.toggle('hidden', s.state !== 'available');
    btnInstall.classList.toggle('hidden', s.state !== 'downloaded');
    const pending = s.state === 'available' || s.state === 'downloading' || s.state === 'downloaded';
    if (navSettings) navSettings.classList.toggle('has-update', pending);
    if (s.state === 'available' && s.version && announced !== s.version) {
      announced = s.version;
      const settingsOpen = !$('#view-settings').classList.contains('hidden');
      if (!settingsOpen) toast(`Version ${s.version} ist verfügbar – Details unter „Einstellungen“.`, true);
    }
  }
  const call = async (channel) => {
    try {
      render(await api.call(channel));
    } catch (e) {
      status.textContent = e.message || String(e);
      status.classList.add('warn');
    }
  };

  btnCheck.onclick = () => call('updater:check');
  btnDownload.onclick = () => call('updater:download');
  btnInstall.onclick = () => call('updater:install');
  btnReleases.onclick = () => run(() => api.call('updater:openReleases'));
  api.on('updater', render);
  call('updater:status');
})();
