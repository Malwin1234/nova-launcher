// Inhalte einer Instanz: Tabs (Mods, Resource Packs, Shader), installierte Dateien (Namen, Icons, an/aus, Updates),
// Modrinth-Suche und Installation.
const contentTabs = document.querySelectorAll('#content-tabs .tab');
function setType(type) {
  state.type = type;
  for (const t of contentTabs) t.classList.toggle('active', t.dataset.type === type);
  refreshInstalled();
  search();
}
for (const t of contentTabs) t.onclick = () => setType(t.dataset.type);

// ---------- installierte Inhalte ----------
// Gefundene Updates gelten für genau eine Instanz und einen Inhaltstyp.
const contentUpdates = { key: '', map: new Map() };
let contentBusy = false; // Update-Suche oder Aktualisierung läuft
let installedSeq = 0;
const contentKey = () => `${state.current}/${state.type}`;
const currentInst = () => state.instances.find((i) => i.id === state.current);

function setInstalledHint(text) {
  const hint = $('#installed-hint');
  hint.textContent = text || '';
  hint.classList.toggle('hidden', !text);
}
function contentIcon(item) {
  const blank = () => el('div', { className: 'noicon' });
  if (!item.icon) return blank();
  const img = el('img', { src: item.icon, alt: '', loading: 'lazy' });
  img.onerror = () => img.replaceWith(blank()); // z. B. offline
  return img;
}
function renderInstalled(items) {
  const id = state.current;
  const type = state.type;
  const list = $('#installed');
  list.replaceChildren();
  if (contentUpdates.key !== contentKey()) { contentUpdates.key = contentKey(); contentUpdates.map.clear(); }
  for (const file of [...contentUpdates.map.keys()]) {
    if (!items.some((i) => i.file === file)) contentUpdates.map.delete(file);
  }
  if (!items.length) list.append(el('li', { className: 'muted', textContent: 'Nichts installiert' }));
  for (const item of items) {
    const upd = contentUpdates.map.get(item.file);
    const sub = item.known ? [item.version, item.file].filter(Boolean).join(' · ') : 'Nicht von Modrinth';
    const info = el('div', { className: 'info' },
      el('div', { className: 'title', textContent: item.title, title: item.title }),
      el('div', { className: 'sub muted', textContent: item.enabled ? sub : `Deaktiviert · ${sub}`, title: item.file }));
    if (upd) info.append(el('div', { className: 'upd', textContent: `Neu: ${upd.latest}`, title: `Update verfügbar: ${upd.current} → ${upd.latest}` }));
    const actions = el('div', { className: 'actions' });
    if (upd) {
      actions.append(el('button', {
        className: 'btn small primary',
        textContent: 'Aktualisieren',
        disabled: contentBusy,
        onclick: () => updateInstalled([item.file]),
      }));
    }
    if (type === 'mod') {
      actions.append(el('button', {
        className: `switch${item.enabled ? ' on' : ''}`,
        title: item.enabled ? 'Aktiv – klicken zum Deaktivieren' : 'Deaktiviert – klicken zum Aktivieren',
        ariaPressed: String(item.enabled),
        disabled: contentBusy,
        onclick: async () => {
          await run(() => api.call('content:toggle', { id, type, file: item.file, enabled: !item.enabled }));
          refreshInstalled();
        },
      }));
    }
    actions.append(el('button', {
      className: 'btn small danger',
      textContent: '✕',
      title: 'Entfernen',
      disabled: contentBusy,
      onclick: async () => { await run(() => api.call('content:remove', { id, type, file: item.file })); refreshInstalled(); },
    }));
    list.append(el('li', { className: item.enabled ? 'cfile' : 'cfile off' }, contentIcon(item), info, actions));
  }
  const n = contentUpdates.map.size;
  $('#update-all').classList.toggle('hidden', n < 2);
  $('#update-all').disabled = contentBusy;
  $('#check-updates').disabled = contentBusy;
}
async function refreshInstalled() {
  const seq = ++installedSeq;
  const id = state.current;
  const type = state.type;
  if (!id) return;
  if (contentUpdates.key !== contentKey()) setInstalledHint('');
  const items = (await run(() => api.call('content:list', { id, type }))) || [];
  if (seq !== installedSeq || id !== state.current || type !== state.type) return;
  renderInstalled(items);
}
function runningHint() {
  const inst = currentInst();
  if (inst && inst.running) {
    toast('Solange die Instanz läuft, kann nichts aktualisiert werden.');
    return true;
  }
  return false;
}
async function checkUpdates() {
  if (contentBusy || !state.current) return;
  const id = state.current;
  const type = state.type;
  const key = contentKey();
  contentBusy = true;
  $('#check-updates').disabled = true;
  $('#check-updates').textContent = 'Suche ...';
  let res = null;
  try {
    res = await api.call('content:checkUpdates', { id, type });
  } catch (e) {
    toast(e.message || String(e));
  }
  contentBusy = false;
  $('#check-updates').textContent = 'Nach Updates suchen';
  if (key !== contentKey()) return refreshInstalled();
  if (res) {
    contentUpdates.key = key;
    contentUpdates.map = new Map(res.updates.map((u) => [u.file, u]));
    const n = res.updates.length;
    setInstalledHint(!res.checked ? 'Keine Modrinth-Inhalte gefunden, die geprüft werden können.'
      : n ? `${n} ${n === 1 ? 'Update' : 'Updates'} verfügbar.` : 'Alles ist aktuell.');
  }
  refreshInstalled();
}
async function updateInstalled(files) {
  if (contentBusy || !state.current || runningHint()) return;
  const id = state.current;
  const type = state.type;
  const key = contentKey();
  contentBusy = true;
  await refreshInstalled();
  let res = null;
  try {
    res = await api.call('content:update', files ? { id, type, files } : { id, type });
  } catch (e) {
    toast(e.message || String(e));
  }
  contentBusy = false;
  if (res && key === contentUpdates.key) {
    for (const u of res.updated) contentUpdates.map.delete(u.oldFile);
    if (res.failed.length) {
      toast(`${res.failed.length} ${res.failed.length === 1 ? 'Update ist' : 'Updates sind'} fehlgeschlagen: ${res.failed[0].title} – ${res.failed[0].error}`);
    } else if (res.updated.length) {
      toast(res.updated.length === 1 ? `${res.updated[0].title} wurde aktualisiert.` : `${res.updated.length} Inhalte wurden aktualisiert.`, true);
    }
    if (key === contentKey()) {
      const left = contentUpdates.map.size;
      setInstalledHint(left ? `${left} ${left === 1 ? 'Update' : 'Updates'} verfügbar.` : 'Alles ist aktuell.');
    }
  }
  refreshInstalled();
}
$('#check-updates').onclick = () => checkUpdates();
$('#update-all').onclick = () => updateInstalled(null);

// ---------- Modrinth-Suche ----------
let searchSeq = 0;
async function search() {
  const seq = ++searchSeq;
  const inst = currentInst();
  const list = $('#results');
  const hint = $('#search-hint');
  list.replaceChildren();
  if (!inst) return;
  if (state.type === 'mod' && inst.loader === 'vanilla') {
    hint.textContent = 'Mods benötigen einen Mod-Loader. Erstelle dafür eine Instanz mit Mod-Loader (z. B. Fabric).';
    return;
  }
  hint.textContent = 'Suche ...';
  const res = await run(() => api.call('content:search', { id: inst.id, type: state.type, query: $('#search').value }));
  if (seq !== searchSeq) return;
  if (!res) { hint.textContent = ''; return; }
  hint.textContent = `${res.total.toLocaleString('de-DE')} Treffer für Minecraft ${inst.version}`;
  const type = state.type;
  for (const hit of res.hits) {
    const btn = el('button', { className: 'btn small primary', textContent: 'Installieren' });
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Lädt ...';
      try {
        await api.call('content:install', { id: inst.id, type, projectId: hit.id });
        btn.textContent = 'Installiert';
        refreshInstalled();
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
        btn.textContent = 'Installieren';
      }
    };
    list.append(el('li', {},
      hit.icon ? el('img', { src: hit.icon, alt: '', loading: 'lazy' }) : el('div', { className: 'noicon' }),
      el('div', { className: 'info' },
        el('div', { className: 'title', textContent: hit.title }),
        el('div', { className: 'desc', textContent: hit.description, title: hit.description }),
        el('div', { className: 'muted', textContent: `${hit.author} · ${hit.downloads.toLocaleString('de-DE')} Downloads` })),
      btn));
  }
}
let searchTimer;
$('#search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 350); };
