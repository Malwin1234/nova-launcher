// Gemeinsame Grundlage der Oberfläche. Alle Skripte teilen sich den globalen Namensraum (klassische <script>-Tags,
// Reihenfolge siehe index.html); Funktionen aus später geladenen Dateien werden erst bei Klicks/Ereignissen aufgerufen.
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
// Fortschritt je Instanz; angezeigt wird der zuletzt aktualisierte Start.
const progressById = new Map();
function renderProgress() {
  const footer = $('#status');
  const last = [...progressById.values()].pop();
  if (!last) return footer.classList.add('hidden');
  footer.classList.remove('hidden');
  const step = $('#status-step');
  if (step) step.textContent = last.step && last.steps ? `Schritt ${last.step}/${last.steps} · ${last.phase || ''}` : '';
  $('#status-text').textContent = last.text || last.phase || '';
  const bar = $('#status-bar');
  const pct = $('#status-pct');
  if (last.total > 0) {
    const v = Math.min(100, (last.done / last.total) * 100);
    bar.classList.remove('indeterminate');
    bar.style.width = `${v}%`;
    if (pct) pct.textContent = `${Math.floor(v)} %`;
  } else {
    bar.classList.add('indeterminate');
    bar.style.width = '';
    if (pct) pct.textContent = '';
  }
}
api.on('progress', (p) => {
  const key = p.id || '_';
  progressById.delete(key);
  if (!p.finished) progressById.set(key, p);
  renderProgress();
});

// ---------- crash dialog ----------
let crashId = null;
function closeCrash() {
  $('#crash').classList.add('hidden');
  crashId = null;
}
function showCrash(c) {
  const box = $('#crash');
  if (!box) return;
  crashId = c.id;
  $('#crash-title').textContent = c.name ? `${c.name} ist abgestürzt` : 'Minecraft ist abgestürzt';
  $('#crash-reason').textContent = c.reason || `Minecraft wurde unerwartet beendet (Code ${c.code}).`;
  const detail = String(c.detail || '').trim();
  $('#crash-hint').textContent = c.file ? `Absturzbericht: ${c.file}` : 'Letzte relevante Zeilen aus dem Protokoll:';
  $('#crash-hint').classList.toggle('hidden', !detail && !c.file);
  $('#crash-detail').textContent = detail;
  $('#crash-detail').classList.toggle('hidden', !detail);
  box.classList.remove('hidden');
  $('#crash-close').focus();
}
if ($('#crash')) {
  $('#crash-close').onclick = closeCrash;
  $('#crash-logs').onclick = () => crashId && run(() => api.call('game:openLogs', crashId));
  $('#crash').addEventListener('click', (e) => { if (e.target.id === 'crash') closeCrash(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#crash').classList.contains('hidden')) closeCrash();
  });
}
api.on('crash', showCrash);
api.on('state', () => refreshInstances());
