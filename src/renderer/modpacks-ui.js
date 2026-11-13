// Ansicht "Modpacks": Modrinth-Modpacks suchen, Version wählen, als neue Instanz installieren, .mrpack importieren.
const mp = { seq: 0, offset: 0, total: 0, installing: false, filtersLoaded: false, timer: null };

async function mpLoadFilters() {
  if (mp.filtersLoaded) return;
  mp.filtersLoaded = true;
  const loaders = (await run(() => api.call('modpacks:loaders'))) || [];
  $('#mp-loader').append(...loaders.map((l) => el('option', { value: l.id, textContent: l.label })));
  if (!state.versions || !state.versions.length) {
    try { state.versions = (await api.call('versions:list')) || []; } catch { state.versions = []; }
  }
  $('#mp-version').append(...state.versions
    .filter((v) => v.type === 'release')
    .map((v) => el('option', { value: v.id, textContent: v.id })));
}
function mpFilters() {
  return { query: $('#mp-search').value, version: $('#mp-version').value, loader: $('#mp-loader').value };
}
function mpSetInstalling(on) {
  mp.installing = on;
  $('#mp-import').disabled = on;
  for (const b of document.querySelectorAll('#mp-results .mp-install')) b.disabled = on;
}
async function mpSearch(more) {
  const seq = ++mp.seq;
  const list = $('#mp-results');
  const hint = $('#mp-hint');
  if (!more) {
    mp.offset = 0;
    list.replaceChildren();
    hint.textContent = 'Suche ...';
  }
  $('#mp-more').classList.add('hidden');
  const res = await run(() => api.call('modpacks:search', { ...mpFilters(), offset: mp.offset }));
  if (seq !== mp.seq) return;
  if (!res) { hint.textContent = ''; return; }
  mp.total = res.total;
  mp.offset += res.hits.length;
  hint.textContent = res.total ? `${res.total.toLocaleString('de-DE')} Modpacks gefunden` : 'Keine Modpacks gefunden.';
  for (const hit of res.hits) list.append(mpItem(hit));
  $('#mp-more').classList.toggle('hidden', mp.offset >= mp.total || !res.hits.length);
}
function mpItem(hit) {
  const sel = el('select', { className: 'mp-ver', title: 'Version des Modpacks' }, el('option', { value: '', textContent: 'Neueste Version' }));
  const btn = el('button', { className: 'btn small primary mp-install', textContent: 'Installieren', disabled: mp.installing });
  let versionsLoaded = false;
  sel.onfocus = sel.onmousedown = async () => {
    if (versionsLoaded) return;
    versionsLoaded = true;
    const f = mpFilters();
    const versions = (await run(() => api.call('modpacks:versions', { projectId: hit.id, version: f.version, loader: f.loader }))) || [];
    sel.append(...versions.map((v) => el('option', {
      value: v.id,
      textContent: `${v.number} · MC ${v.gameVersions.join(', ')} · ${v.loaders.map(loaderName).join(', ')}${v.supported ? '' : ' (nicht unterstützt)'}`,
    })));
  };
  btn.onclick = async () => {
    if (mp.installing) return;
    const f = mpFilters();
    mpSetInstalling(true);
    btn.textContent = 'Installiere ...';
    mpShowProgress({ text: 'Modpack wird vorbereitet', done: 0, total: 0 });
    try {
      const inst = await api.call('modpacks:install', { projectId: hit.id, versionId: sel.value || undefined, version: f.version, loader: f.loader });
      btn.textContent = 'Installiert';
      await mpDone(inst);
    } catch (e) {
      toast(e.message || String(e));
      btn.textContent = 'Installieren';
    }
    mpSetInstalling(false);
  };
  const icon = hit.icon ? el('img', { src: hit.icon, alt: '', loading: 'lazy' }) : el('div', { className: 'noicon' });
  return el('li', {},
    icon,
    el('div', { className: 'info' },
      el('div', { className: 'title', textContent: hit.title }),
      el('div', { className: 'desc', textContent: hit.description, title: hit.description }),
      el('div', { className: 'muted', textContent: `${hit.author} · ${hit.downloads.toLocaleString('de-DE')} Downloads` })),
    el('div', { className: 'mp-actions' }, sel, btn));
}
async function mpDone(inst) {
  toast(`Modpack „${inst.name}“ wurde installiert.`, true);
  await refreshInstances();
  if (state.instances.some((i) => i.id === inst.id)) openInstance(inst.id);
}
function mpShowProgress(p) {
  const box = $('#mp-progress');
  if (p.finished) return box.classList.add('hidden');
  box.classList.remove('hidden');
  const pct = p.total ? Math.min(100, (p.done / p.total) * 100) : 0;
  $('#mp-progress-text').textContent = p.total ? `${p.text} – ${Math.round(pct)} %` : p.text;
  const bar = $('#mp-progress-bar');
  bar.classList.toggle('busy', !p.total);
  bar.style.width = p.total ? `${pct}%` : '100%';
}
api.on('modpackProgress', (p) => { if (p && typeof p === 'object') mpShowProgress(p); });

$('#mp-search').oninput = () => { clearTimeout(mp.timer); mp.timer = setTimeout(() => mpSearch(false), 350); };
$('#mp-version').onchange = () => mpSearch(false);
$('#mp-loader').onchange = () => mpSearch(false);
$('#mp-more').onclick = () => mpSearch(true);
$('#mp-cancel').onclick = () => run(() => api.call('modpacks:cancel'));
$('#mp-import').onclick = async () => {
  if (mp.installing) return;
  mpSetInstalling(true);
  try {
    const inst = await api.call('modpacks:import');
    if (inst) await mpDone(inst);
  } catch (e) {
    toast(e.message || String(e));
  }
  mpSetInstalling(false);
};
// Beim ersten Öffnen der Ansicht Filter laden und suchen (zusätzlich zur Navigation aus core.js).
document.querySelector('.nav[data-view="modpacks"]').addEventListener('click', async () => {
  const first = !mp.filtersLoaded;
  await mpLoadFilters();
  if (first) mpSearch(false);
});
