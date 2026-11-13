// Instanz-Detailansicht: Kopfbereich (öffnen, zurück, Einstellungen, duplizieren, Ordner öffnen, löschen).
// Die Inhalte darunter stehen in content-ui.js.
function refreshInstanceHeader(inst) {
  $('#inst-name').textContent = inst.name;
  $('#inst-meta').textContent = `${loaderName(inst.loader)} · Minecraft ${inst.version} · ${lastPlayedText(inst)}`;
  const locked = !!inst.running || isCopying(inst) || state.busy.has(inst.id);
  $('#inst-duplicate').disabled = locked;
  $('#inst-delete').disabled = locked;
}
function openInstance(id) {
  const inst = state.instances.find((i) => i.id === id);
  if (!inst) return;
  state.current = id;
  refreshInstanceHeader(inst);
  $('#search').value = '';
  show('instance');
  render();
  setType('mod');
}
$('#back').onclick = () => { state.current = null; show('library'); refreshInstances(); };
$('#inst-settings').onclick = () => openInstanceSettings(state.current);
$('#inst-duplicate').onclick = () => instDuplicate(state.current);
$('#inst-folder').onclick = () => run(() => api.call('instances:openFolder', state.current));
$('#inst-delete').onclick = () => instDelete(state.current);
