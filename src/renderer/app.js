const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const api = window.nova;

const state = { recent: [], instances: [], current: null, type: 'mod', versions: [], account: null, busy: new Set() };

// ---------- toast ----------
let toastTimer;
function toast(msg, ok = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('ok', ok);
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 5000);
}
async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message || String(e));
  }
}

// ---------- navigation ----------
function show(view) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('hidden', v.id !== `view-${view}`);
  for (const n of document.querySelectorAll('.nav')) {
    n.classList.toggle('active', n.dataset.view === view || (view === 'instance' && n.dataset.view === 'library'));
  }
}
for (const n of document.querySelectorAll('.nav')) {
  n.onclick = () => {
    show(n.dataset.view);
    if (n.dataset.view === 'library') refreshInstances();
  };
}

// ---------- account ----------
async function refreshAccount() {
  state.account = await run(() => api.call('account:get'));
  const box = $('#account');
  box.replaceChildren();
  if (state.account) {
    box.append(
      el('div', { className: 'who' },
        el('div', { className: 'avatar', textContent: state.account.name[0].toUpperCase() }),
        el('span', { textContent: state.account.name })),
      el('button', {
        className: 'btn small',
        textContent: 'Abmelden',
        onclick: async () => { await run(() => api.call('account:logout')); refreshAccount(); },
      })
    );
  } else {
    box.append(el('button', {
      className: 'btn primary',
      textContent: 'Mit Microsoft anmelden',
      onclick: async (e) => {
        e.target.disabled = true;
        await run(() => api.call('account:login'));
        refreshAccount();
      },
    }));
  }
}

// ---------- library ----------
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

// ---------- instance detail ----------
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

// ---------- settings ----------
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

// ---------- events from main ----------
const logLines = [];
api.on('log', (line) => {
  logLines.push(line);
  if (logLines.length > 800) logLines.splice(0, logLines.length - 800);
  const pre = $('#log');
  const stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
  pre.textContent = logLines.join('\n');
  if (stick) pre.scrollTop = pre.scrollHeight;
});
api.on('progress', (p) => {
  const bar = $('#status');
  if (p.finished) return bar.classList.add('hidden');
  bar.classList.remove('hidden');
  $('#status-text').textContent = p.total ? `${p.text} (${Math.round((p.done / p.total) * 100)} %)` : p.text;
  $('#status-bar').style.width = p.total ? `${Math.min(100, (p.done / p.total) * 100)}%` : '100%';
});
api.on('state', () => refreshInstances());

refreshAccount();
refreshInstances();
initSettings();
