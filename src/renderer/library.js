// Bibliothek: Instanz-Raster mit Schnellaktionen, "Weiterspielen", Spielen/Stoppen und der Dialog "Neue Instanz".
function hue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// ---------- mod loaders ----------
// Die Liste kommt aus dem Hauptprozess (loaders:list); solange es den Kanal nicht gibt oder er fehlschlägt, gelten Vanilla und Fabric.
const FALLBACK_LOADERS = [{ id: 'vanilla', label: 'Vanilla' }, { id: 'fabric', label: 'Fabric' }];
const LOADER_LABELS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
state.loaders = null; // erst nach erfolgreicher Abfrage gesetzt
state.copying = new Set(); // Instanzen, die gerade dupliziert werden
async function getLoaders() {
  if (state.loaders) return state.loaders;
  try {
    const list = await api.call('loaders:list');
    const ok = Array.isArray(list) ? list.filter((l) => l && typeof l.id === 'string' && l.id) : [];
    if (ok.length) {
      state.loaders = ok.map((l) => ({ id: l.id, label: typeof l.label === 'string' && l.label ? l.label : l.id }));
      return state.loaders;
    }
  } catch { /* Kanal fehlt noch oder Fehler: Ersatzliste */ }
  // Die Loader-Module werden nur beim Start geladen: die Ersatzliste gilt für die ganze Sitzung (keine wiederholten Fehlversuche).
  state.loaders = FALLBACK_LOADERS;
  return FALLBACK_LOADERS;
}
function loaderName(l) {
  const known = (state.loaders || []).find((x) => x.id === l);
  return known ? known.label : LOADER_LABELS[l] || String(l || 'Vanilla');
}
function fillLoaders(sel, loaders, selected) {
  sel.replaceChildren(...loaders.map((l) => el('option', { value: l.id, textContent: l.label })));
  if (loaders.some((l) => l.id === selected)) sel.value = selected;
}
const isCopying = (inst) => !!inst.busy || state.copying.has(inst.id);

function playButton(inst, extra = '') {
  const btn = el('button', { className: `btn primary ${extra}` });
  const busy = state.busy.has(inst.id);
  if (isCopying(inst) && !inst.running && !busy) {
    btn.textContent = 'Wird kopiert ...';
    btn.disabled = true;
    btn.onclick = (e) => e.stopPropagation();
  } else if (inst.running && !busy) {
    btn.textContent = 'Stoppen';
    btn.classList.add('stop');
    btn.onclick = (e) => { e.stopPropagation(); run(() => api.call('game:stop', inst.id)); };
  } else {
    btn.textContent = busy ? 'Startet ...' : 'Spielen';
    btn.disabled = busy;
    btn.onclick = (e) => { e.stopPropagation(); play(inst.id); };
  }
  return btn;
}
async function play(id, quick) {
  if (!state.account) return toast('Bitte zuerst mit einem Microsoft-Konto anmelden.');
  state.busy.add(id);
  render();
  await run(() => api.call('game:launch', id, quick || null));
  state.busy.delete(id);
  await refreshInstances();
}

async function refreshInstances() {
  state.instances = (await run(() => api.call('instances:list'))) || [];
  state.recent = (await run(() => api.call('recent:list'))) || [];
  render();
}
function ago(time) {
  if (!time) return 'noch nicht gespielt';
  const min = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  if (min < 60 * 24) return `vor ${Math.round(min / 60)} Std.`;
  const days = Math.round(min / 1440);
  return days === 1 ? 'gestern' : `vor ${days} Tagen`;
}
function lastPlayedText(inst) {
  if (inst.running) return 'Läuft gerade';
  return inst.lastPlayed ? `Zuletzt gespielt: ${ago(inst.lastPlayed)}` : 'Noch nie gespielt';
}
function renderRecent() {
  const box = $('#recent');
  box.replaceChildren();
  $('#recent-empty').classList.toggle('hidden', state.recent.length > 0);
  for (const r of state.recent) {
    const inst = state.instances.find((i) => i.id === r.instanceId);
    const world = r.kind === 'world';
    const icon = r.icon ? el('img', { src: r.icon, alt: '' }) : el('div', { className: 'noicon', textContent: world ? 'Welt' : 'Server' });
    const note = world && !r.direct ? ' · öffnet die Instanz' : '';
    box.append(el('button', {
      className: 'recent',
      disabled: state.busy.has(r.instanceId) || !!(inst && (inst.running || isCopying(inst))),
      title: world ? `Welt „${r.name}“ direkt starten` : `Mit ${r.address} verbinden`,
      onclick: () => play(r.instanceId, { type: r.kind, target: r.id }),
    },
    icon,
    el('div', { className: 'info' },
      el('div', { className: 'title', textContent: r.name }),
      el('div', { className: 'muted', textContent: `${world ? 'Welt' : 'Server'} · ${r.instanceName} (${r.version})` }),
      el('div', { className: 'muted', textContent: ago(r.time) + note })),
    el('span', { className: 'go', textContent: '▶' })));
  }
}
function render() {
  renderRecent();
  const grid = $('#instances');
  grid.replaceChildren();
  if (!state.instances.length) {
    grid.append(el('p', { className: 'empty', textContent: 'Noch keine Instanzen. Erstelle deine erste mit „Neue Instanz“.' }));
  }
  for (const inst of state.instances) {
    const art = el('div', { className: 'art' });
    art.style.setProperty('--hue', hue(inst.id));
    const more = el('button', {
      className: 'inst-more',
      textContent: '⋯',
      title: 'Aktionen',
      onclick: (e) => { e.stopPropagation(); openInstMenu(inst.id, more); },
    });
    more.setAttribute('aria-label', `Aktionen für ${inst.name}`);
    grid.append(el('div', { className: 'inst', onclick: () => openInstance(inst.id) },
      art,
      el('div', { className: 'inst-title' }, el('div', { className: 'name', textContent: inst.name, title: inst.name }), more),
      el('div', { className: 'muted', textContent: `${loaderName(inst.loader)} ${inst.version}` }),
      el('div', { className: 'muted inst-played', textContent: lastPlayedText(inst) }),
      playButton(inst)));
  }
  const cur = state.instances.find((i) => i.id === state.current);
  if (cur) {
    $('#inst-play').replaceWith(Object.assign(playButton(cur, 'big'), { id: 'inst-play' }));
    if (typeof refreshInstanceHeader === 'function') refreshInstanceHeader(cur);
  }
}

// ---------- quick actions ----------
// Ein einziges schwebendes Menü für alle Karten; es hängt am <body>, damit es ein Neuzeichnen der Bibliothek übersteht.
const instMenu = el('div', { className: 'inst-menu hidden' });
instMenu.setAttribute('role', 'menu');
document.body.append(instMenu);
function closeInstMenu() {
  instMenu.classList.add('hidden');
}
function openInstMenu(id, anchor) {
  const inst = state.instances.find((i) => i.id === id);
  if (!inst) return;
  const locked = inst.running || isCopying(inst) || state.busy.has(id);
  const item = (text, fn, opts = {}) => {
    const b = el('button', {
      className: `inst-menu-item${opts.danger ? ' danger' : ''}`,
      textContent: text,
      disabled: !!opts.disabled,
      title: opts.disabled ? 'Nicht möglich, solange die Instanz läuft oder kopiert wird' : '',
      onclick: () => { closeInstMenu(); fn(); },
    });
    b.setAttribute('role', 'menuitem');
    return b;
  };
  instMenu.replaceChildren(
    item('Einstellungen', () => openInstanceSettings(id)),
    item('Duplizieren', () => instDuplicate(id), { disabled: locked }),
    item('Ordner öffnen', () => run(() => api.call('instances:openFolder', id))),
    item('Löschen', () => instDelete(id), { danger: true, disabled: locked }));
  instMenu.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const w = instMenu.offsetWidth;
  const h = instMenu.offsetHeight;
  instMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  const top = r.bottom + h + 12 > window.innerHeight ? r.top - h - 4 : r.bottom + 4;
  instMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, top))}px`;
  const first = instMenu.querySelector('button:not(:disabled)');
  if (first) first.focus({ preventScroll: true });
}
document.addEventListener('click', (e) => {
  if (!instMenu.contains(e.target)) closeInstMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeInstMenu();
});
window.addEventListener('resize', closeInstMenu);
document.addEventListener('scroll', closeInstMenu, true);

// ---------- duplicate / delete (Bibliothek und Instanzansicht) ----------
async function instDuplicate(id) {
  const inst = state.instances.find((i) => i.id === id);
  if (!inst || state.copying.has(id)) return;
  if (inst.running || state.busy.has(id)) return toast('Die Instanz läuft gerade. Beende Minecraft zuerst.');
  state.copying.add(id);
  render();
  const copy = await run(() => api.call('instances:duplicate', id));
  state.copying.delete(id);
  await refreshInstances();
  if (copy) toast(`„${inst.name}“ wurde dupliziert als „${copy.name}“.`, true);
}
async function instDelete(id) {
  const inst = state.instances.find((i) => i.id === id);
  if (!inst) return;
  if (inst.running || state.busy.has(id)) return toast('Die Instanz läuft gerade. Beende Minecraft zuerst.');
  if (isCopying(inst)) return toast('Die Instanz wird gerade kopiert. Bitte warte, bis das fertig ist.');
  if (!confirm(`Instanz „${inst.name}“ mit allen Welten und Mods wirklich löschen?`)) return;
  await run(async () => {
    await api.call('instances:delete', id);
    if (state.current === id) {
      state.current = null;
      show('library');
    }
  });
  refreshInstances();
}

// ---------- create instance ----------
function fillVersions() {
  const snaps = $('#f-snapshots').checked;
  const sel = $('#f-version');
  sel.replaceChildren(...state.versions
    .filter((v) => snaps || v.type === 'release')
    .map((v) => el('option', { value: v.id, textContent: v.id })));
}
$('#f-snapshots').onchange = fillVersions;
$('#new-instance').onclick = async () => {
  if (!state.versions.length) state.versions = (await run(() => api.call('versions:list'))) || [];
  if (!state.versions.length) return;
  fillVersions();
  const loaders = await getLoaders();
  fillLoaders($('#f-loader'), loaders, loaders.some((l) => l.id === 'fabric') ? 'fabric' : loaders[0].id);
  $('#f-name').value = '';
  $('#modal').classList.remove('hidden');
  $('#f-name').focus();
};
$('#f-cancel').onclick = () => $('#modal').classList.add('hidden');
$('#create-form').onsubmit = async (e) => {
  e.preventDefault();
  const ok = await run(async () => {
    await api.call('instances:create', {
      name: $('#f-name').value,
      version: $('#f-version').value,
      loader: $('#f-loader').value,
    });
    return true;
  });
  if (ok) {
    $('#modal').classList.add('hidden');
    refreshInstances();
  }
};
