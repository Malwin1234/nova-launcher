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
api.on('progress', (p) => {
  const bar = $('#status');
  if (p.finished) return bar.classList.add('hidden');
  bar.classList.remove('hidden');
  $('#status-text').textContent = p.total ? `${p.text} (${Math.round((p.done / p.total) * 100)} %)` : p.text;
  $('#status-bar').style.width = p.total ? `${Math.min(100, (p.done / p.total) * 100)}%` : '100%';
});
api.on('state', () => refreshInstances());
