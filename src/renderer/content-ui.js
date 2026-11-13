// Inhalte einer Instanz: Tabs (Mods, Resource Packs, Shader), installierte Dateien, Modrinth-Suche und Installation.
function setType(type) {
  state.type = type;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.type === type);
  refreshInstalled();
  search();
}
for (const t of document.querySelectorAll('.tab')) t.onclick = () => setType(t.dataset.type);

async function refreshInstalled() {
  const id = state.current;
  const type = state.type;
  const files = (await run(() => api.call('content:list', { id, type }))) || [];
  const list = $('#installed');
  list.replaceChildren();
  if (!files.length) list.append(el('li', { className: 'muted', textContent: 'Nichts installiert' }));
  for (const file of files) {
    list.append(el('li', {},
      el('span', { textContent: file, title: file }),
      el('button', {
        className: 'btn small danger',
        textContent: '✕',
        title: 'Entfernen',
        onclick: async () => { await run(() => api.call('content:remove', { id, type, file })); refreshInstalled(); },
      })));
  }
}

let searchSeq = 0;
async function search() {
  const seq = ++searchSeq;
  const inst = state.instances.find((i) => i.id === state.current);
  const list = $('#results');
  const hint = $('#search-hint');
  list.replaceChildren();
  if (state.type === 'mod' && inst.loader === 'vanilla') {
    hint.textContent = 'Mods benötigen einen Mod-Loader. Erstelle dafür eine Fabric-Instanz.';
    return;
  }
  hint.textContent = 'Suche ...';
  const res = await run(() => api.call('content:search', { id: inst.id, type: state.type, query: $('#search').value }));
  if (seq !== searchSeq) return;
  if (!res) { hint.textContent = ''; return; }
  hint.textContent = `${res.total.toLocaleString('de-DE')} Treffer für Minecraft ${inst.version}`;
  for (const hit of res.hits) {
    const btn = el('button', { className: 'btn small primary', textContent: 'Installieren' });
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Lädt ...';
      try {
        await api.call('content:install', { id: inst.id, type: state.type, projectId: hit.id });
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
