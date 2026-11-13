// Instanz-Detailansicht: Kopfbereich (öffnen, zurück, Ordner öffnen, löschen). Die Inhalte darunter stehen in content-ui.js.
function openInstance(id) {
  state.current = id;
  const inst = state.instances.find((i) => i.id === id);
  $('#inst-name').textContent = inst.name;
  $('#inst-meta').textContent = `${loaderName(inst.loader)} · Minecraft ${inst.version}`;
  $('#search').value = '';
  show('instance');
  render();
  setType('mod');
}
$('#back').onclick = () => { state.current = null; show('library'); refreshInstances(); };
$('#inst-folder').onclick = () => run(() => api.call('instances:openFolder', state.current));
$('#inst-delete').onclick = async () => {
  const inst = state.instances.find((i) => i.id === state.current);
  if (!confirm(`Instanz „${inst.name}“ mit allen Welten und Mods wirklich löschen?`)) return;
  await run(async () => {
    await api.call('instances:delete', inst.id);
    state.current = null;
    show('library');
  });
  refreshInstances();
};
