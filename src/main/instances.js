// Instanzen: auflisten, lesen, speichern, anlegen, löschen. Hält außerdem die Liste der laufenden Spiele.
const { shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { INSTANCES, readJsonSync, instDir, handle } = require('./core');
const { versionInfo } = require('./versions');

const running = new Map(); // instanceId -> child process

function listInstances() {
  if (!fs.existsSync(INSTANCES)) return [];
  return fs
    .readdirSync(INSTANCES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readJsonSync(path.join(INSTANCES, d.name, 'instance.json'), null))
    .filter(Boolean)
    .map((i) => ({ ...i, running: running.has(i.id) }))
    .sort((a, b) => (b.lastPlayed || b.created) - (a.lastPlayed || a.created));
}
function getInstance(id) {
  const inst = readJsonSync(path.join(instDir(id), 'instance.json'), null);
  if (!inst) throw new Error('Instanz nicht gefunden');
  return inst;
}
function saveInstance(inst) {
  const dir = instDir(inst.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'instance.json'), JSON.stringify(inst, null, 2));
}
async function createInstance({ name, version, loader }) {
  name = String(name || '').trim().slice(0, 40);
  if (!name) throw new Error('Bitte einen Namen angeben');
  if (!['vanilla', 'fabric'].includes(loader)) throw new Error('Unbekannter Loader');
  await versionInfo(version); // validiert die Version
  const inst = { id: crypto.randomBytes(6).toString('hex'), name, version, loader, created: Date.now(), lastPlayed: 0 };
  saveInstance(inst);
  return inst;
}
async function deleteInstance(id) {
  if (running.has(id)) throw new Error('Die Instanz läuft gerade');
  await fsp.rm(instDir(id), { recursive: true, force: true });
}

handle('instances:list', () => listInstances());
handle('instances:create', (opts) => createInstance(opts || {}));
handle('instances:delete', (id) => deleteInstance(id));
handle('instances:openFolder', (id) => {
  const dir = instDir(id);
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

module.exports = { running, listInstances, getInstance, saveInstance, createInstance, deleteInstance };
