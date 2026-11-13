// Modpacks (Modrinth .mrpack): suchen und als Instanz installieren.
// Ein .mrpack ist ein Zip mit modrinth.index.json (Liste der herunterzuladenden Dateien) sowie den Ordnern
// overrides/ und client-overrides/, deren Inhalt in die Instanz kopiert wird.
const { dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const core = require('./core');
const { DATA, send, log, errMsg, getJson, isOffline, instDir, handle } = core;
const instances = require('./instances');
const { MR, PROJECT_RE, CACHE_FILE, checkProjectId, fetchToFile } = require('./content');

// ---------- Grenzen und Regeln ----------
const ALLOWED_HOSTS = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com']; // laut mrpack-Spezifikation
const MAX_PACK_BYTES = 1024 * 1024 * 1024; // die .mrpack-Datei selbst
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 3000; // Einträge im Index
const MAX_FILE_BYTES = 1024 * 1024 * 1024; // einzelne heruntergeladene Datei
const MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024; // alle Downloads zusammen
const MAX_OVERRIDE_ENTRIES = 20000;
const MAX_OVERRIDE_BYTES = 2 * 1024 * 1024 * 1024; // entpackte Overrides zusammen
const PARALLEL = 6;
const LOADER_KEYS = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' };
const LOADER_LABELS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const VERSION_RE = /^[A-Za-z0-9._+ -]{1,64}$/;
const RESERVED = ['instance.json', 'modpack.json', CACHE_FILE.toLowerCase()]; // gehören dem Launcher
const DEVICE_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

function supportedLoaders() {
  let list = null;
  try {
    list = require('./loaders').LOADERS;
  } catch {
    // Modul (noch) nicht ladbar: Standard unten
  }
  if (!Array.isArray(list) || !list.length) list = ['vanilla', 'fabric'];
  return list
    .map((l) => (typeof l === 'string' ? { id: l, label: LOADER_LABELS[l] || l } : { id: String(l.id), label: String(l.label || LOADER_LABELS[l.id] || l.id) }))
    .filter((l) => l.id);
}
function loaderLabel(id) {
  return LOADER_LABELS[id] || id;
}

// Prüft einen Pfad aus dem Pack und liefert seine Teile. Erlaubt sind nur relative Pfade innerhalb der Instanz.
function safeParts(p) {
  const bad = () => new Error(`Das Modpack enthält einen unzulässigen Dateipfad: ${String(p).slice(0, 120)}`);
  if (typeof p !== 'string' || !p || p.length > 400 || p.includes('\0')) throw bad();
  const norm = p.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm) || norm.includes(':')) throw bad(); // absolut, Laufwerk, UNC, alternativer Datenstrom
  const parts = norm.split('/');
  for (const s of parts) {
    if (!s || s === '.' || s === '..' || /[<>"|?*\x00-\x1f]/.test(s) || /[. ]$/.test(s) || DEVICE_RE.test(s)) throw bad();
  }
  if (parts.length === 1 && RESERVED.includes(parts[0].toLowerCase())) throw bad();
  return parts;
}
function resolveInside(root, parts) {
  const full = path.resolve(root, ...parts);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error('Das Modpack enthält einen unzulässigen Dateipfad.');
  return full;
}
function checkDownloadUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw new Error('Das Modpack enthält eine ungültige Download-Adresse.'); }
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.includes(u.hostname) || u.username || u.password || (u.port && u.port !== '443')) {
    throw new Error(`Das Modpack will von einer nicht erlaubten Adresse laden: ${u.protocol}//${u.hostname}`);
  }
  return u.href;
}

// ---------- .mrpack lesen und vollständig prüfen (bevor irgendetwas angelegt oder geladen wird) ----------
function parsePack(file) {
  let size;
  try { size = fs.statSync(file).size; } catch { throw new Error('Die Modpack-Datei wurde nicht gefunden.'); }
  if (size > MAX_PACK_BYTES) throw new Error('Die Modpack-Datei ist zu groß (mehr als 1 GB).');
  let zip, entries;
  try {
    zip = new AdmZip(file);
    entries = zip.getEntries();
  } catch {
    throw new Error('Die Datei ist kein gültiges Modpack (.mrpack).');
  }
  const indexEntry = entries.find((e) => e.entryName === 'modrinth.index.json');
  if (!indexEntry) throw new Error('Die Datei ist kein Modrinth-Modpack (modrinth.index.json fehlt).');
  if (indexEntry.header.size > MAX_INDEX_BYTES) throw new Error('Das Modpack ist ungültig (Index zu groß).');
  let index;
  try { index = JSON.parse(indexEntry.getData().toString('utf8')); } catch { throw new Error('Das Modpack ist beschädigt (Index nicht lesbar).'); }
  if (!index || typeof index !== 'object' || index.formatVersion !== 1) throw new Error('Dieses Modpack-Format wird nicht unterstützt.');
  if (index.game && index.game !== 'minecraft') throw new Error('Dieses Modpack ist nicht für Minecraft.');

  // Abhängigkeiten -> Minecraft-Version, Loader, Loader-Version
  const deps = index.dependencies && typeof index.dependencies === 'object' ? index.dependencies : {};
  const version = deps.minecraft;
  if (typeof version !== 'string' || !VERSION_RE.test(version)) throw new Error('Das Modpack nennt keine gültige Minecraft-Version.');
  let loader = 'vanilla';
  let loaderVersion;
  for (const [key, value] of Object.entries(deps)) {
    if (key === 'minecraft') continue;
    const id = LOADER_KEYS[key];
    if (!id) throw new Error(`Das Modpack benötigt „${String(key).slice(0, 40)}“. Das unterstützt dieser Launcher nicht.`);
    if (loader !== 'vanilla') throw new Error('Das Modpack verlangt mehrere Mod-Loader gleichzeitig. Das wird nicht unterstützt.');
    if (typeof value !== 'string' || !VERSION_RE.test(value)) throw new Error('Das Modpack nennt keine gültige Loader-Version.');
    loader = id;
    loaderVersion = value;
  }
  if (!supportedLoaders().some((l) => l.id === loader)) {
    throw new Error(`Dieses Modpack benötigt den Mod-Loader ${loaderLabel(loader)}. Den unterstützt dieser Launcher (noch) nicht.`);
  }

  // Dateien aus dem Index
  if (!Array.isArray(index.files)) throw new Error('Das Modpack ist beschädigt (Dateiliste fehlt).');
  if (index.files.length > MAX_FILES) throw new Error(`Das Modpack enthält zu viele Dateien (mehr als ${MAX_FILES}).`);
  const files = [];
  const seen = new Set();
  let totalBytes = 0;
  let sizesKnown = true;
  for (const f of index.files) {
    if (!f || typeof f !== 'object') throw new Error('Das Modpack ist beschädigt (ungültiger Dateieintrag).');
    const parts = safeParts(f.path);
    const key = parts.join('/').toLowerCase();
    if (seen.has(key)) throw new Error(`Das Modpack enthält eine Datei doppelt: ${parts.join('/')}`);
    seen.add(key);
    if (f.env && f.env.client === 'unsupported') continue; // nur für Server
    const hashes = f.hashes || {};
    const sha512 = typeof hashes.sha512 === 'string' && /^[0-9a-fA-F]{128}$/.test(hashes.sha512) ? hashes.sha512.toLowerCase() : null;
    const sha1 = typeof hashes.sha1 === 'string' && /^[0-9a-fA-F]{40}$/.test(hashes.sha1) ? hashes.sha1.toLowerCase() : null;
    if (!sha512 && !sha1) throw new Error(`Das Modpack nennt keine Prüfsumme für ${parts.join('/')}.`);
    if (!Array.isArray(f.downloads) || !f.downloads.length || f.downloads.length > 10) {
      throw new Error(`Das Modpack nennt keine Download-Adresse für ${parts.join('/')}.`);
    }
    const urls = f.downloads.map(checkDownloadUrl);
    const fileSize = Number.isSafeInteger(f.fileSize) && f.fileSize > 0 ? f.fileSize : 0;
    if (fileSize > MAX_FILE_BYTES) throw new Error(`Eine Datei des Modpacks ist zu groß: ${parts.join('/')}`);
    if (!fileSize) sizesKnown = false;
    totalBytes += fileSize;
    files.push({ parts, urls, sha512, sha1, fileSize });
  }
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Das Modpack ist zu groß (mehr als 8 GB an Downloads).');

  // Zip-Einträge: nichts darf aus dem Paket herauszeigen; overrides/ und client-overrides/ werden kopiert.
  const overrides = new Map(); // Zielpfad (klein) -> { parts, entry }; client-overrides überschreibt overrides
  let overrideBytes = 0;
  if (entries.length > MAX_OVERRIDE_ENTRIES) throw new Error('Das Modpack enthält zu viele Dateien.');
  for (const folder of ['overrides/', 'client-overrides/']) {
    for (const e of entries) {
      const name = String(e.entryName).replace(/\\/g, '/');
      const trimmed = name.replace(/\/+$/, '');
      if (folder === 'overrides/' && trimmed) {
        // jeder Eintrag im Zip wird geprüft, auch außerhalb der Override-Ordner
        const segs = trimmed.split('/');
        if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || segs.includes('..')) {
          throw new Error(`Das Modpack enthält einen unzulässigen Dateipfad: ${name.slice(0, 120)}`);
        }
      }
      if (!name.startsWith(folder)) continue;
      const rel = trimmed.slice(folder.length);
      if (!rel) continue;
      const parts = safeParts(rel);
      if (e.isDirectory) continue;
      overrideBytes += e.header.size;
      if (overrideBytes > MAX_OVERRIDE_BYTES) throw new Error('Das Modpack ist zu groß (Overrides über 2 GB).');
      overrides.set(parts.join('/').toLowerCase(), { parts, entry: e }); // Overrides werden nach den Downloads geschrieben und gewinnen
    }
  }

  const name = String(index.name || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 40) || 'Modpack';
  return {
    name, version, loader, loaderVersion, files, overrides: [...overrides.values()], totalBytes, sizesKnown,
    versionId: typeof index.versionId === 'string' ? index.versionId.slice(0, 100) : '',
    summary: typeof index.summary === 'string' ? index.summary.slice(0, 500) : '',
  };
}

// ---------- Fortschritt und Sperre ----------
let job = null; // es läuft höchstens eine Modpack-Installation; { controller }
let lastSent = 0;
function progress(text, done, total, force) {
  const now = Date.now();
  if (!force && now - lastSent < 100) return;
  lastSent = now;
  send('modpackProgress', { text, done, total, finished: false });
}
async function exclusive(fn) {
  if (job) throw new Error('Es wird bereits ein Modpack installiert.');
  job = { controller: new AbortController() };
  try {
    return await fn(job.controller.signal);
  } finally {
    job = null;
    send('modpackProgress', { text: '', done: 0, total: 0, finished: true });
  }
}
function checkAbort(signal) {
  if (signal.aborted) throw new Error('Abgebrochen');
}

// ---------- Installation ----------
async function downloadPackFile(root, f, signal, onBytes) {
  const dest = resolveInside(root, f.parts);
  let lastError;
  for (const url of f.urls) {
    let counted = 0;
    try {
      await fetchToFile(url, dest, {
        sha512: f.sha512,
        sha1: f.sha512 ? null : f.sha1,
        maxBytes: f.fileSize || MAX_FILE_BYTES,
        signal,
        onBytes: (n) => { counted += n; onBytes(n); },
      });
      return;
    } catch (e) {
      onBytes(-counted); // Fortschritt des fehlgeschlagenen Versuchs zurücknehmen
      lastError = e;
      if (signal.aborted) throw e;
    }
  }
  const name = f.parts[f.parts.length - 1];
  const msg = errMsg(lastError);
  throw new Error(msg.includes(name) ? msg : `${name}: ${msg}`);
}
async function installMrpack(file, signal) {
  progress('Modpack wird geprüft', 0, 0, true);
  const pack = parsePack(file);
  if (pack.files.length && isOffline()) throw new Error('Ohne Internetverbindung kann dieses Modpack nicht installiert werden.');
  checkAbort(signal);

  let inst;
  try {
    inst = await instances.createInstance({ name: pack.name, version: pack.version, loader: pack.loader, loaderVersion: pack.loaderVersion });
  } catch (e) {
    throw new Error(`Die Instanz für das Modpack konnte nicht angelegt werden: ${errMsg(e)}`);
  }
  const root = instDir(inst.id);
  try {
    if (inst.loader !== pack.loader || inst.version !== pack.version) throw new Error('Die Instanz wurde nicht wie vom Modpack verlangt angelegt.');
    if (pack.loaderVersion && inst.loaderVersion !== pack.loaderVersion) {
      log(`Hinweis: Das Modpack verlangt ${loaderLabel(pack.loader)} ${pack.loaderVersion}; die Instanz nutzt die Standardversion des Loaders.`);
    }
    // Downloads (parallel), Fortschritt in Bytes, falls das Pack die Größen nennt, sonst in Dateien
    const byBytes = pack.sizesKnown && pack.totalBytes > 0;
    const total = byBytes ? pack.totalBytes : pack.files.length;
    let doneBytes = 0;
    let doneFiles = 0;
    const report = (force) => progress(`Lade Dateien (${doneFiles}/${pack.files.length})`, byBytes ? Math.min(doneBytes, total) : doneFiles, total, force);
    const inner = new AbortController();
    const onAbort = () => inner.abort();
    signal.addEventListener('abort', onAbort);
    let firstError = null;
    let next = 0;
    const worker = async () => {
      while (!firstError && next < pack.files.length) {
        const f = pack.files[next++];
        try {
          await downloadPackFile(root, f, inner.signal, (n) => { doneBytes += n; report(false); });
          doneFiles++;
          report(false);
        } catch (e) {
          if (!firstError) firstError = e;
          inner.abort();
        }
      }
    };
    report(true);
    try {
      await Promise.all(Array.from({ length: Math.min(PARALLEL, pack.files.length) }, worker));
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    checkAbort(signal);
    if (firstError) throw firstError;

    // Overrides kopieren
    let n = 0;
    for (const o of pack.overrides) {
      if (n % 25 === 0) {
        checkAbort(signal);
        progress(`Kopiere Dateien des Modpacks (${n}/${pack.overrides.length})`, n, pack.overrides.length, n === 0);
        await new Promise((r) => setImmediate(r));
      }
      n++;
      const dest = resolveInside(root, o.parts);
      const data = o.entry.getData();
      if (data.length !== o.entry.header.size) throw new Error('Das Modpack ist beschädigt (Datei nicht lesbar).');
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, data);
    }
    await fsp.writeFile(path.join(root, 'modpack.json'), JSON.stringify({ name: pack.name, versionId: pack.versionId, summary: pack.summary, installed: Date.now() }, null, 2));
    log(`Modpack „${pack.name}“ installiert (${pack.files.length} Dateien, ${pack.overrides.length} Overrides).`);
    return { id: inst.id, name: inst.name, version: inst.version, loader: inst.loader, files: pack.files.length, overrides: pack.overrides.length };
  } catch (e) {
    // halb angelegte Instanz wieder entfernen
    try {
      await instances.deleteInstance(inst.id);
    } catch {
      await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
    }
    throw e;
  }
}

// ---------- Modrinth ----------
function checkGameVersion(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || !VERSION_RE.test(v)) throw new Error('Ungültige Minecraft-Version');
  return v;
}
function checkLoaderFilter(l) {
  if (l === undefined || l === null || l === '') return '';
  if (typeof l !== 'string' || !Object.values(LOADER_KEYS).includes(l)) throw new Error('Unbekannter Loader');
  return l;
}
async function searchPacks({ query, version, loader, offset } = {}) {
  const facets = [['project_type:modpack']];
  if (checkGameVersion(version)) facets.push([`versions:${version}`]);
  if (checkLoaderFilter(loader)) facets.push([`categories:${loader}`]);
  const params = new URLSearchParams({
    query: String(query || '').slice(0, 100),
    limit: '20',
    offset: String(Math.max(0, Math.min(10000, Number(offset) || 0))),
    facets: JSON.stringify(facets),
  });
  const res = await getJson(`${MR}/search?${params}`);
  return {
    total: res.total_hits,
    hits: res.hits.map((h) => ({
      id: h.project_id,
      title: h.title,
      description: h.description,
      icon: h.icon_url,
      downloads: h.downloads,
      author: h.author,
    })),
  };
}
async function fetchVersions(projectId, version, loader) {
  checkProjectId(projectId);
  const params = new URLSearchParams();
  if (checkGameVersion(version)) params.set('game_versions', JSON.stringify([version]));
  if (checkLoaderFilter(loader)) params.set('loaders', JSON.stringify([loader]));
  return getJson(`${MR}/project/${projectId}/version?${params}`);
}
async function listPackVersions({ projectId, version, loader } = {}) {
  const versions = await fetchVersions(projectId, version, loader);
  const known = supportedLoaders().map((l) => l.id);
  return versions.slice(0, 60).map((v) => ({
    id: v.id,
    name: v.name,
    number: v.version_number,
    gameVersions: v.game_versions || [],
    loaders: (v.loaders || []).filter((l) => l !== 'mrpack'),
    supported: (v.loaders || []).some((l) => known.includes(l)),
    date: v.date_published,
  }));
}
async function installFromModrinth({ projectId, versionId, version, loader } = {}) {
  checkProjectId(projectId);
  return exclusive(async (signal) => {
    progress('Modpack wird gesucht', 0, 0, true);
    let v;
    if (versionId) {
      if (typeof versionId !== 'string' || !PROJECT_RE.test(versionId)) throw new Error('Ungültige Versions-ID');
      v = await getJson(`${MR}/version/${versionId}`);
      if (!v || v.project_id !== projectId) throw new Error('Diese Version gehört nicht zu dem Modpack.');
    } else {
      const versions = await fetchVersions(projectId, version, loader);
      if (!versions.length) throw new Error('Für diese Auswahl gibt es keine Version des Modpacks.');
      v = versions[0];
    }
    // Loader schon vor dem Download prüfen
    const known = supportedLoaders().map((l) => l.id);
    const packLoaders = (v.loaders || []).filter((l) => Object.values(LOADER_KEYS).includes(l));
    if (packLoaders.length && !packLoaders.some((l) => known.includes(l))) {
      throw new Error(`Dieses Modpack benötigt den Mod-Loader ${packLoaders.map(loaderLabel).join(' / ')}. Den unterstützt dieser Launcher (noch) nicht.`);
    }
    const files = Array.isArray(v.files) ? v.files : [];
    const f = files.find((x) => x.primary && /\.mrpack$/i.test(x.filename)) || files.find((x) => /\.mrpack$/i.test(x.filename));
    if (!f) throw new Error('Diese Version enthält keine .mrpack-Datei.');
    const url = checkDownloadUrl(f.url);
    if (new URL(url).hostname !== 'cdn.modrinth.com') throw new Error('Ungültige Download-Adresse');
    if (f.size > MAX_PACK_BYTES) throw new Error('Die Modpack-Datei ist zu groß (mehr als 1 GB).');
    const tmpDir = path.join(DATA, 'tmp');
    const tmp = path.join(tmpDir, `${crypto.randomBytes(6).toString('hex')}.mrpack`);
    try {
      let got = 0;
      await fetchToFile(url, tmp, {
        sha512: f.hashes && f.hashes.sha512,
        sha1: f.hashes && f.hashes.sha1,
        maxBytes: MAX_PACK_BYTES,
        signal,
        onBytes: (n) => { got += n; progress('Lade Modpack', got, f.size || 0, false); },
      });
      return await installMrpack(tmp, signal);
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => {});
    }
  });
}
async function importFile() {
  if (job) throw new Error('Es wird bereits ein Modpack installiert.');
  const res = await dialog.showOpenDialog(core.getWindow(), {
    title: 'Modpack importieren',
    filters: [{ name: 'Modrinth-Modpack', extensions: ['mrpack'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return null;
  return exclusive((signal) => installMrpack(res.filePaths[0], signal));
}
function cancel() {
  if (job) job.controller.abort();
}

handle('modpacks:search', (opts) => searchPacks(opts || {}));
handle('modpacks:versions', (opts) => listPackVersions(opts || {}));
handle('modpacks:loaders', () => supportedLoaders().filter((l) => l.id !== 'vanilla'));
handle('modpacks:install', (opts) => installFromModrinth(opts || {}));
handle('modpacks:import', () => importFile());
handle('modpacks:cancel', () => cancel());

module.exports = { ALLOWED_HOSTS, supportedLoaders, safeParts, checkDownloadUrl, parsePack, installMrpack, searchPacks, listPackVersions, installFromModrinth, importFile, cancel };
