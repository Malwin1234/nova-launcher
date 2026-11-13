// Einstellungen einer einzelnen Instanz: umbenennen, Minecraft-Version und Mod-Loader wechseln, Loader-Version festlegen,
// eigener Arbeitsspeicher und zusätzliche JVM-Argumente. Gespeichert wird über instances:update.
const instSettings = { id: null, inst: null, globalMemory: 4, saving: false };

function isFillVersions() {
  const inst = instSettings.inst;
  const sel = $('#is-version');
  const keep = sel.value || inst.version;
  const snaps = $('#is-snapshots').checked;
  const ids = state.versions.filter((v) => snaps || v.type === 'release').map((v) => v.id);
  // Die aktuelle (und die gerade gewählte) Version muss immer wählbar bleiben, auch offline oder bei ausgeblendeten Snapshots.
  for (const must of [inst.version, keep]) if (!ids.includes(must)) ids.unshift(must);
  sel.replaceChildren(...ids.map((id) => el('option', { value: id, textContent: id === inst.version ? `${id} (aktuell)` : id })));
  sel.value = keep;
}
function isUpdateWarning() {
  const inst = instSettings.inst;
  const version = $('#is-version').value;
  const loader = $('#is-loader').value;
  const order = state.versions.map((v) => v.id); // neueste zuerst
  const from = order.indexOf(inst.version);
  const to = order.indexOf(version);
  const downgrade = version !== inst.version && from >= 0 && to > from;
  const parts = [];
  if (downgrade) {
    parts.push(`Achtung, Downgrade von ${inst.version} auf ${version}: Welten, die schon mit der neueren Version gespielt wurden, lassen sich in einer älteren Version meist nicht mehr öffnen oder werden beschädigt. Dupliziere die Instanz vorher als Sicherung.`);
  } else if (version !== inst.version) {
    parts.push(`Versionswechsel von ${inst.version} auf ${version}: Vorhandene Welten werden beim Öffnen umgewandelt und lassen sich danach nicht mehr mit der alten Version spielen.`);
  }
  if (version !== inst.version) parts.push('Installierte Mods, Resource Packs und Shader passen möglicherweise nicht zur neuen Version und müssen ersetzt werden.');
  if (loader !== inst.loader) parts.push(`Loader-Wechsel von ${loaderName(inst.loader)} auf ${loaderName(loader)}: Vorhandene Mods funktionieren mit einem anderen Mod-Loader in der Regel nicht.`);
  const box = $('#is-warning');
  box.replaceChildren(...parts.map((t) => el('span', { textContent: t })));
  box.classList.toggle('hidden', !parts.length);
  box.classList.toggle('danger', downgrade);
  $('#is-loaderversion-row').classList.toggle('hidden', loader === 'vanilla');
  return { downgrade };
}
function isUpdateMemory() {
  const global = $('#is-memory-global').checked;
  $('#is-memory-row').classList.toggle('hidden', global);
  $('#is-memory').required = !global;
}
function isSetLocked(locked) {
  $('#is-running').classList.toggle('hidden', !locked);
  $('#is-fields').disabled = locked;
  $('#is-save').disabled = locked || instSettings.saving;
}
function closeInstanceSettings() {
  $('#is-modal').classList.add('hidden');
  instSettings.id = null;
  instSettings.inst = null;
}

async function openInstanceSettings(id) {
  const inst = state.instances.find((i) => i.id === id);
  if (!inst) return;
  // Versionen, Loader und die globale Speichereinstellung laden; nichts davon darf den Dialog verhindern (z. B. offline).
  if (!state.versions.length) {
    try { state.versions = (await api.call('versions:list')) || []; } catch { state.versions = []; }
  }
  const loaders = [...(await getLoaders())];
  if (!loaders.some((l) => l.id === inst.loader)) loaders.push({ id: inst.loader, label: loaderName(inst.loader) });
  try { instSettings.globalMemory = (await api.call('config:get')).memoryMax || 4; } catch { /* Standardwert bleibt */ }

  instSettings.id = id;
  instSettings.inst = inst;
  instSettings.saving = false;
  $('#is-name').value = inst.name;
  const known = state.versions.find((v) => v.id === inst.version);
  $('#is-snapshots').checked = !!known && known.type !== 'release';
  $('#is-version').replaceChildren();
  isFillVersions();
  fillLoaders($('#is-loader'), loaders, inst.loader);
  $('#is-loaderversion').value = inst.loaderVersion || '';
  const own = Number.isFinite(inst.memoryMax);
  $('#is-memory-global').checked = !own;
  $('#is-memory-globalvalue').textContent = `(derzeit ${instSettings.globalMemory} GB)`;
  $('#is-memory').value = own ? inst.memoryMax : instSettings.globalMemory;
  $('#is-jvmargs').value = inst.jvmArgs || '';
  isUpdateMemory();
  isUpdateWarning();
  isSetLocked(!!inst.running || isCopying(inst) || state.busy.has(id));
  $('#is-running').textContent = inst.running || state.busy.has(id)
    ? 'Die Instanz läuft gerade. Beende Minecraft, um die Einstellungen zu ändern.'
    : 'Die Instanz wird gerade kopiert. Danach kannst du die Einstellungen ändern.';
  $('#is-modal').classList.remove('hidden');
  if (!$('#is-fields').disabled) $('#is-name').focus();
}

$('#is-snapshots').onchange = isFillVersions;
$('#is-version').onchange = isUpdateWarning;
$('#is-loader').onchange = isUpdateWarning;
$('#is-memory-global').onchange = isUpdateMemory;
$('#is-cancel').onclick = closeInstanceSettings;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && instSettings.id && !instSettings.saving) closeInstanceSettings();
});
// Startet oder endet das Spiel, während der Dialog offen ist, wird er gesperrt bzw. wieder freigegeben.
api.on('state', (s) => {
  if (!instSettings.id || !s || s.id !== instSettings.id) return;
  if (typeof s.running === 'boolean') isSetLocked(s.running);
  else if (typeof s.busy === 'boolean') isSetLocked(s.busy);
});

$('#is-form').onsubmit = async (e) => {
  e.preventDefault();
  const inst = instSettings.inst;
  if (!inst || instSettings.saving || $('#is-fields').disabled) return;
  // Nur senden, was sich wirklich geändert hat.
  const patch = {};
  const name = $('#is-name').value.trim();
  if (name !== inst.name) patch.name = name;
  const version = $('#is-version').value;
  if (version !== inst.version) patch.version = version;
  const loader = $('#is-loader').value;
  if (loader !== inst.loader) patch.loader = loader;
  const loaderVersion = loader === 'vanilla' ? '' : $('#is-loaderversion').value.trim();
  if (loaderVersion !== (inst.loaderVersion || '')) patch.loaderVersion = loaderVersion;
  const memory = $('#is-memory-global').checked ? null : Number($('#is-memory').value);
  if (memory !== (Number.isFinite(inst.memoryMax) ? inst.memoryMax : null)) patch.memoryMax = memory;
  const jvmArgs = $('#is-jvmargs').value.trim();
  if (jvmArgs !== (inst.jvmArgs || '')) patch.jvmArgs = jvmArgs;
  if (!Object.keys(patch).length) return closeInstanceSettings();

  if (isUpdateWarning().downgrade
    && !confirm(`Minecraft wirklich von ${inst.version} auf die ältere Version ${version} zurückstufen? Vorhandene Welten können dabei unbrauchbar werden.`)) return;
  instSettings.saving = true;
  $('#is-save').disabled = true;
  const saved = await run(() => api.call('instances:update', inst.id, patch));
  instSettings.saving = false;
  $('#is-save').disabled = $('#is-fields').disabled;
  if (!saved) return; // Fehlermeldung steht im Hinweis, der Dialog bleibt offen
  closeInstanceSettings();
  await refreshInstances();
  toast('Einstellungen gespeichert.', true);
};
