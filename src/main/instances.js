// Instanzen: auflisten, lesen, speichern, anlegen, ändern, duplizieren, löschen. Hält außerdem die Liste der laufenden Spiele.
const { shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { INSTANCES, readJsonSync, instDir, handle, send } = require('./core');
const { versionInfo } = require('./versions');

const running = new Map(); // instanceId -> child process
const busy = new Set(); // instanceId -> wird gerade kopiert (Quelle einer Duplizierung)

const NAME_MAX = 40;
const JVM_ARGS_MAX = 500;
const FALLBACK_LOADERS = [{ id: 'vanilla', label: 'Vanilla' }, { id: 'fabric', label: 'Fabric' }];
const LOADER_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
// Zeilenumbrüche und Steuerzeichen (inkl. Unicode-Zeilen-/Absatztrenner) sind in Namen und JVM-Argumenten verboten.
function hasControl(str) {
  for (const c of str) {
    const n = c.codePointAt(0);
    if (n < 32 || n === 127 || n === 0x2028 || n === 0x2029) return true;
  }
  return false;
}
// Zwischenspeicher, die beim Wechsel von Version oder Loader ungültig werden (der nächste Start löst sie neu auf).
const CACHE_FIELDS = ['versionInfo', 'fabricProfile', 'quiltProfile', 'forgeProfile', 'neoforgeProfile', 'loaderProfile', 'loaderCache'];

// Liste der Mod-Loader aus loaders.js; solange das Modul sie noch nicht anbietet, gelten Vanilla und Fabric.
function loaderList() {
  try {
    const list = require('./loaders').LOADERS;
    if (Array.isArray(list)) {
      const ok = list.filter((l) => l && typeof l.id === 'string' && /^[a-z]{1,20}$/.test(l.id));
      if (ok.length) return ok.map((l) => ({ id: l.id, label: typeof l.label === 'string' && l.label ? l.label : l.id }));
    }
  } catch { /* Modul fehlt oder ist fehlerhaft */ }
  return FALLBACK_LOADERS;
}

// ---------- validation ----------
function cleanName(name, truncate) {
  if (typeof name !== 'string') throw new Error('Bitte einen Namen angeben');
  name = name.trim();
  if (hasControl(name)) throw new Error('Der Name enthält ungültige Zeichen');
  if (truncate) name = name.slice(0, NAME_MAX).trim();
  if (!name) throw new Error('Bitte einen Namen angeben');
  if (name.length > NAME_MAX) throw new Error(`Der Name darf höchstens ${NAME_MAX} Zeichen lang sein`);
  return name;
}
function cleanLoader(loader) {
  if (typeof loader !== 'string' || !loaderList().some((l) => l.id === loader)) throw new Error('Unbekannter Loader');
  return loader;
}
// Leer (oder null/undefined) bedeutet: immer die neueste Loader-Version.
function cleanLoaderVersion(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new Error('Ungültige Loader-Version');
  v = v.trim();
  if (v && !LOADER_VERSION_RE.test(v)) throw new Error('Ungültige Loader-Version (erlaubt sind Buchstaben, Ziffern, Punkt, Minus, Plus, Unterstrich)');
  return v;
}
function cleanVersion(version) {
  if (typeof version !== 'string' || !version || version.length > 64) throw new Error('Ungültige Minecraft-Version');
  return version;
}
function assertIdle(id) {
  if (running.has(id)) throw new Error('Die Instanz läuft gerade. Beende Minecraft zuerst.');
  if (busy.has(id)) throw new Error('Die Instanz wird gerade kopiert. Bitte warte, bis das fertig ist.');
}
function newId() {
  for (;;) {
    const id = crypto.randomBytes(6).toString('hex');
    if (!fs.existsSync(path.join(INSTANCES, id))) return id;
  }
}

// ---------- read / write ----------
function listInstances() {
  if (!fs.existsSync(INSTANCES)) return [];
  return fs
    .readdirSync(INSTANCES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readJsonSync(path.join(INSTANCES, d.name, 'instance.json'), null))
    .filter(Boolean)
    .map((i) => ({ ...i, running: running.has(i.id), busy: busy.has(i.id) }))
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

// ---------- create ----------
async function createInstance(opts) {
  const { name, version, loader, loaderVersion } = opts && typeof opts === 'object' ? opts : {};
  const cleanedName = cleanName(name, true);
  const cleanedLoader = cleanLoader(loader);
  const pinned = cleanLoaderVersion(loaderVersion);
  await versionInfo(cleanVersion(version)); // validiert die Version
  const inst = { id: newId(), name: cleanedName, version, loader: cleanedLoader, created: Date.now(), lastPlayed: 0 };
  if (pinned && cleanedLoader !== 'vanilla') inst.loaderVersion = pinned; // ohne Loader gibt es nichts festzulegen
  saveInstance(inst);
  return inst;
}

// ---------- update ----------
const PATCH_KEYS = ['name', 'version', 'loader', 'loaderVersion', 'memoryMax', 'jvmArgs'];
async function updateInstance(id, patch) {
  const inst = getInstance(id); // prüft die ID
  if (inst.id !== id) throw new Error('Instanz nicht gefunden');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Ungültige Änderung');
  for (const key of Object.keys(patch)) {
    if (!PATCH_KEYS.includes(key)) throw new Error(`Unbekannte Einstellung: ${String(key).slice(0, 30)}`);
  }
  assertIdle(id);

  // Erst alles prüfen, dann erst schreiben: eine ungültige Angabe darf nichts verändern.
  const next = { ...inst };
  if ('name' in patch) next.name = cleanName(patch.name, false);
  if ('loader' in patch) next.loader = cleanLoader(patch.loader);
  if ('version' in patch) next.version = cleanVersion(patch.version);
  if ('loaderVersion' in patch) {
    const v = cleanLoaderVersion(patch.loaderVersion);
    if (v) next.loaderVersion = v;
    else delete next.loaderVersion;
  }
  if (next.loader === 'vanilla') delete next.loaderVersion; // ohne Loader gibt es nichts festzulegen
  if ('memoryMax' in patch) {
    const m = patch.memoryMax;
    if (m === null) delete next.memoryMax; // globale Einstellung verwenden
    else if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > 32) throw new Error('Der Arbeitsspeicher muss eine ganze Zahl zwischen 1 und 32 GB sein');
    else next.memoryMax = m;
  }
  if ('jvmArgs' in patch) {
    let a = patch.jvmArgs;
    if (a === null) a = '';
    if (typeof a !== 'string') throw new Error('Ungültige JVM-Argumente');
    if (hasControl(a)) throw new Error('JVM-Argumente dürfen keine Zeilenumbrüche oder Steuerzeichen enthalten');
    a = a.trim();
    if (a.length > JVM_ARGS_MAX) throw new Error(`JVM-Argumente dürfen höchstens ${JVM_ARGS_MAX} Zeichen lang sein`);
    if (a) next.jvmArgs = a;
    else delete next.jvmArgs;
  }
  if (next.version !== inst.version) await versionInfo(next.version); // validiert die neue Version
  assertIdle(id); // während der Versionsprüfung könnte das Spiel gestartet worden sein

  const changed = next.version !== inst.version || next.loader !== inst.loader || (next.loaderVersion || '') !== (inst.loaderVersion || '');
  if (changed) for (const f of CACHE_FIELDS) delete next[f];
  saveInstance(next);
  return { ...next, running: false, busy: false };
}

// ---------- duplicate ----------
// Sammelt alle Dateien eines Ordners (ohne Verknüpfungen), damit der Fortschritt in Dateien gezählt werden kann.
async function walk(dir, rel, out) {
  for (const d of await fsp.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, d.name);
    if (d.isDirectory()) {
      out.dirs.push(r);
      await walk(dir, r, out);
    } else if (d.isFile()) {
      out.files.push(r);
    }
  }
  return out;
}
function copyName(name) {
  const suffix = ' (Kopie)';
  return name.slice(0, NAME_MAX - suffix.length).trim() + suffix;
}
async function duplicateInstance(id) {
  const src = getInstance(id); // prüft die ID
  if (src.id !== id) throw new Error('Instanz nicht gefunden');
  assertIdle(id);
  const newInstId = newId();
  const from = instDir(id);
  const to = instDir(newInstId);
  const progress = (done, total) => send('progress', { id, text: `„${src.name}“ wird kopiert`, done, total });
  busy.add(id);
  send('state', { id, busy: true });
  try {
    progress(0, 0);
    await fsp.mkdir(to, { recursive: true });
    const { dirs, files } = await walk(from, '', { dirs: [], files: [] });
    for (const d of dirs) await fsp.mkdir(path.join(to, d), { recursive: true });
    let done = 0;
    let last = 0;
    for (const f of files) {
      // instance.json kommt zuletzt: erst dann taucht die Kopie in der Bibliothek auf.
      if (f !== 'instance.json') {
        try {
          await fsp.copyFile(path.join(from, f), path.join(to, f));
        } catch (e) {
          if (e.code !== 'ENOENT') throw e; // Datei wurde inzwischen entfernt
        }
      }
      done++;
      if (Date.now() - last > 100) {
        last = Date.now();
        progress(done, files.length);
      }
    }
    const copy = { ...getInstance(id), id: newInstId, name: copyName(src.name), created: Date.now(), lastPlayed: 0 };
    saveInstance(copy);
    return { ...copy, running: false, busy: false };
  } catch (e) {
    await fsp.rm(to, { recursive: true, force: true }).catch(() => {});
    throw e;
  } finally {
    busy.delete(id);
    send('progress', { id, text: '', done: 0, total: 0, finished: true });
    send('state', { id, busy: false });
  }
}

// ---------- delete ----------
async function deleteInstance(id) {
  const dir = instDir(id); // prüft die ID
  assertIdle(id);
  await fsp.rm(dir, { recursive: true, force: true });
}

handle('instances:list', () => listInstances());
handle('instances:create', (opts) => createInstance(opts));
handle('instances:update', (id, patch) => updateInstance(id, patch));
handle('instances:duplicate', (id) => duplicateInstance(id));
handle('instances:delete', (id) => deleteInstance(id));
handle('instances:openFolder', (id) => {
  const dir = instDir(id);
  if (!fs.existsSync(path.join(dir, 'instance.json'))) throw new Error('Instanz nicht gefunden');
  return shell.openPath(dir);
});

module.exports = {
  running, busy, listInstances, getInstance, saveInstance, createInstance, updateInstance, duplicateInstance, deleteInstance, loaderList,
};
