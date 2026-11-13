// Bibliothek: Instanz-Raster, "Weiterspielen", Spielen/Stoppen und der Dialog "Neue Instanz".
function hue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
const loaderName = (l) => (l === 'fabric' ? 'Fabric' : 'Vanilla');

function playButton(inst, extra = '') {
  const btn = el('button', { className: `btn primary ${extra}` });
  const busy = state.busy.has(inst.id);
  if (inst.running && !busy) {
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
      disabled: state.busy.has(r.instanceId) || !!(inst && inst.running),
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
    grid.append(el('div', { className: 'inst', onclick: () => openInstance(inst.id) },
      art,
      el('div', { className: 'name', textContent: inst.name }),
      el('div', { className: 'muted', textContent: `${loaderName(inst.loader)} ${inst.version}` }),
      playButton(inst)));
  }
  const cur = state.instances.find((i) => i.id === state.current);
  if (cur) $('#inst-play').replaceWith(Object.assign(playButton(cur, 'big'), { id: 'inst-play' }));
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
