// Inhalte von Modrinth (Mods, Resource Packs, Shader): suchen, installieren, auflisten (mit Namen und Icons),
// aktivieren/deaktivieren, auf Updates prüfen, aktualisieren, entfernen.
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { once } = require('events');
const core = require('./core');
const { UA, NO_NET, send, log, errMsg, getJson, getConfig, isOffline, readJsonSync, instDir, handle } = core;
const instances = require('./instances');
const { getInstance } = instances;

const CONTENT_DIRS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const MR = 'https://api.modrinth.com/v2';
const CACHE_FILE = '.nova-content.json'; // Metadaten-Cache im Instanzordner (Hashes, Namen, Icons)
const DISABLED = '.disabled';
const PROJECT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const RECHECK_UNKNOWN = 24 * 3600 * 1000; // Dateien, die Modrinth nicht kennt, höchstens einmal am Tag neu anfragen
const OFFLINE_MSG = 'Der Offline-Modus ist aktiv. Schalte ihn in den Einstellungen aus, um das zu nutzen.';

function checkType(type) {
  if (!Object.prototype.hasOwnProperty.call(CONTENT_DIRS, type)) throw new Error('Unbekannter Inhaltstyp');
  return type;
}
function checkProjectId(id) {
  if (typeof id !== 'string' || !PROJECT_RE.test(id)) throw new Error('Ungültige Projekt-ID');
  return id;
}
function isRunning(id) {
  return !!(instances.running && instances.running.has(id));
}
// Welche "loaders" Modrinth für diesen Inhaltstyp erwartet (Quilt lädt auch Fabric-Mods).
function apiLoaders(type, loader) {
  if (type === 'resourcepack') return ['minecraft'];
  if (type === 'shader') return ['iris', 'optifine', 'canvas', 'vanilla'];
  if (loader === 'quilt') return ['quilt', 'fabric'];
  return [String(loader)];
}

// ---------- Netzwerk ----------
async function postJson(url, body) {
  if (getConfig().offlineMode) throw new Error(OFFLINE_MSG);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error(NO_NET);
  }
  if (!res.ok) throw new Error(`Anfrage fehlgeschlagen (${res.status}): ${url}`);
  return res.json();
}
// Lädt eine Datei, prüft dabei Größe und Prüfsumme (SHA-512 bevorzugt, sonst SHA-1) und legt sie erst danach am Ziel ab.
async function fetchToFile(url, dest, { sha1, sha512, maxBytes, signal, onBytes } = {}) {
  if (getConfig().offlineMode) throw new Error(OFFLINE_MSG);
  const algo = sha512 ? 'sha512' : sha1 ? 'sha1' : null;
  const want = String(sha512 || sha1 || '').toLowerCase();
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA }, signal });
  } catch (e) {
    if (signal && signal.aborted) throw new Error('Abgebrochen');
    throw new Error(NO_NET);
  }
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`);
  const name = path.basename(dest);
  const declared = Number(res.headers.get('content-length')) || 0;
  if (maxBytes && declared > maxBytes) throw new Error(`Datei ist größer als erlaubt: ${name}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${crypto.randomBytes(4).toString('hex')}.part`;
  const out = fs.createWriteStream(tmp);
  const hash = algo && crypto.createHash(algo);
  let got = 0;
  try {
    for await (const chunk of res.body) {
      got += chunk.length;
      if (maxBytes && got > maxBytes) throw new Error(`Datei ist größer als erlaubt: ${name}`);
      if (hash) hash.update(chunk);
      if (!out.write(chunk)) await once(out, 'drain');
      if (onBytes) onBytes(chunk.length);
    }
    out.end();
    await once(out, 'finish');
    if (hash && hash.digest('hex') !== want) throw new Error(`Prüfsumme stimmt nicht: ${name}`);
    await fsp.rename(tmp, dest);
  } catch (e) {
    out.destroy();
    await fsp.rm(tmp, { force: true }).catch(() => {});
    if (signal && signal.aborted) throw new Error('Abgebrochen');
    throw e;
  }
  return got;
}
function modrinthCdnUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw new Error('Ungültige Download-Adresse'); }
  if (u.protocol !== 'https:' || u.hostname !== 'cdn.modrinth.com') throw new Error('Ungültige Download-Adresse');
  return u.href;
}

// ---------- Suche und Installation ----------
async function searchContent({ id, type, query, offset }) {
  const inst = getInstance(id);
  checkType(type);
  const facets = [[`project_type:${type}`], [`versions:${inst.version}`]];
  if (type === 'mod') facets.push(apiLoaders(type, inst.loader).map((l) => `categories:${l}`));
  const params = new URLSearchParams({
    query: String(query || '').slice(0, 100),
    limit: '20',
    offset: String(Math.max(0, Number(offset) || 0)),
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
async function installContent(inst, type, projectId, seen) {
  if (seen.has(projectId)) return;
  seen.add(projectId);
  checkProjectId(projectId);
  const params = new URLSearchParams({ game_versions: JSON.stringify([inst.version]) });
  if (type === 'mod') params.set('loaders', JSON.stringify(apiLoaders(type, inst.loader)));
  const versions = await getJson(`${MR}/project/${projectId}/version?${params}`);
  if (!versions.length) throw new Error(`Keine passende Version für Minecraft ${inst.version} gefunden`);
  const v = versions[0];
  const file = v.files.find((f) => f.primary) || v.files[0];
  const dest = path.join(instDir(inst.id), CONTENT_DIRS[type], path.basename(file.filename));
  if (!fs.existsSync(dest) && !fs.existsSync(dest + DISABLED)) {
    log(`Installiere ${file.filename}`);
    await fetchToFile(modrinthCdnUrl(file.url), dest, { sha1: file.hashes && file.hashes.sha1, sha512: file.hashes && file.hashes.sha512 });
  }
  if (type === 'mod') {
    for (const dep of v.dependencies || []) {
      if (dep.dependency_type === 'required' && dep.project_id) {
        try {
          await installContent(inst, type, dep.project_id, seen);
        } catch (e) {
          log(`Abhängigkeit ${dep.project_id} konnte nicht installiert werden: ${errMsg(e)}`);
        }
      }
    }
  }
}

// ---------- installierte Dateien ----------
function contentDir(id, type) {
  return path.join(instDir(id), CONTENT_DIRS[checkType(type)]);
}
function checkFile(file) {
  const name = path.basename(String(file || ''));
  if (!name || name !== file || name === '.' || name === '..') throw new Error('Ungültiger Dateiname');
  return name;
}
function readCache(id) {
  const c = readJsonSync(path.join(instDir(id), CACHE_FILE), null);
  return { hashes: (c && c.hashes) || {}, meta: (c && c.meta) || {} };
}
function writeCache(id, cache) {
  try {
    fs.writeFileSync(path.join(instDir(id), CACHE_FILE), JSON.stringify(cache));
  } catch (e) {
    log(`Inhalts-Cache konnte nicht gespeichert werden: ${errMsg(e)}`);
  }
}
function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
// Liest den Ordner und liefert je Datei den SHA-1 (aus dem Cache, solange Größe und Änderungszeit gleich sind).
async function scan(id, type, cache) {
  const dir = contentDir(id, type);
  if (!fs.existsSync(dir)) return [];
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && !f.name.endsWith('.part'))
    .map((f) => f.name);
  const prefix = `${type}/`;
  for (const key of Object.keys(cache.hashes)) {
    if (key.startsWith(prefix) && !names.includes(key.slice(prefix.length))) delete cache.hashes[key];
  }
  const entries = [];
  for (const file of names) {
    const full = path.join(dir, file);
    let sha1 = null;
    try {
      const st = fs.statSync(full);
      const known = cache.hashes[prefix + file];
      if (known && known.size === st.size && known.mtime === st.mtimeMs) {
        sha1 = known.sha1;
      } else {
        sha1 = await sha1File(full);
        cache.hashes[prefix + file] = { size: st.size, mtime: st.mtimeMs, sha1 };
      }
    } catch {
      // Datei gerade gesperrt oder verschwunden: ohne Hash anzeigen
    }
    const enabled = !(type === 'mod' && file.endsWith(DISABLED));
    entries.push({ file, enabled, sha1 });
  }
  return entries;
}
// Fragt Modrinth nach allen noch unbekannten Hashes (eine Anfrage) und den zugehörigen Projekten (eine Anfrage).
async function lookupMeta(entries, cache) {
  const now = Date.now();
  const hashes = [...new Set(entries.map((e) => e.sha1).filter(Boolean))].filter((h) => {
    const m = cache.meta[h];
    return !m || (m.unknown && now - (m.checked || 0) > RECHECK_UNKNOWN);
  });
  if (!hashes.length) return false;
  const versions = await postJson(`${MR}/version_files`, { hashes, algorithm: 'sha1' });
  const projectIds = [...new Set(Object.values(versions).map((v) => v.project_id).filter((p) => PROJECT_RE.test(String(p))))];
  let projects = [];
  if (projectIds.length) {
    projects = await getJson(`${MR}/projects?ids=${encodeURIComponent(JSON.stringify(projectIds))}`);
  }
  const byId = new Map(projects.map((p) => [p.id, p]));
  for (const h of hashes) {
    const v = versions[h];
    if (!v) {
      cache.meta[h] = { unknown: true, checked: now };
      continue;
    }
    const p = byId.get(v.project_id) || {};
    cache.meta[h] = metaFrom(v, p.title, p.icon_url);
  }
  return true;
}
function metaFrom(version, title, icon) {
  return {
    projectId: String(version.project_id),
    versionId: String(version.id),
    versionNumber: String(version.version_number || ''),
    published: String(version.date_published || ''),
    title: String(title || version.name || ''),
    icon: typeof icon === 'string' && icon.startsWith('https://') ? icon : null,
  };
}
function pruneMeta(id, cache) {
  // Metadaten nur für Hashes behalten, die noch in irgendeinem Inhaltsordner liegen.
  const used = new Set(Object.values(cache.hashes).map((h) => h.sha1));
  for (const h of Object.keys(cache.meta)) if (!used.has(h)) delete cache.meta[h];
}
function displayName(file) {
  return file.endsWith(DISABLED) ? file.slice(0, -DISABLED.length) : file;
}
async function listContent(id, type) {
  checkType(type);
  getInstance(id);
  const cache = readCache(id);
  const before = JSON.stringify(cache);
  const entries = await scan(id, type, cache);
  if (!isOffline()) {
    try {
      await lookupMeta(entries, cache);
    } catch (e) {
      log(`Namen der installierten Inhalte konnten nicht abgerufen werden: ${errMsg(e)}`);
    }
  }
  pruneMeta(id, cache);
  if (JSON.stringify(cache) !== before) writeCache(id, cache);
  return entries
    .map((e) => {
      const m = (e.sha1 && cache.meta[e.sha1]) || {};
      const known = !!m.projectId;
      return {
        file: e.file,
        enabled: e.enabled,
        known,
        title: known && m.title ? m.title : displayName(e.file),
        version: known ? m.versionNumber : '',
        icon: known ? m.icon : null,
        projectId: known ? m.projectId : null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }));
}
async function removeContent(id, type, file) {
  if (type === 'mod' && isRunning(id)) throw new Error('Solange die Instanz läuft, können keine Mods entfernt werden.');
  await fsp.rm(path.join(contentDir(id, type), checkFile(file)), { force: true });
}
// Mods aktivieren/deaktivieren: *.jar <-> *.jar.disabled (der Loader ignoriert die umbenannte Datei).
async function toggleContent(id, type, file, enabled) {
  if (checkType(type) !== 'mod') throw new Error('Nur Mods können deaktiviert werden.');
  getInstance(id);
  if (isRunning(id)) throw new Error('Solange die Instanz läuft, können Mods nicht aktiviert oder deaktiviert werden.');
  const name = checkFile(file);
  const dir = contentDir(id, type);
  const isDisabled = name.endsWith(DISABLED);
  if (enabled === !isDisabled) return name;
  const target = isDisabled ? name.slice(0, -DISABLED.length) : name + DISABLED;
  if (!fs.existsSync(path.join(dir, name))) throw new Error('Diese Datei gibt es nicht mehr.');
  if (fs.existsSync(path.join(dir, target))) throw new Error(`Es gibt bereits eine Datei „${target}“.`);
  await fsp.rename(path.join(dir, name), path.join(dir, target));
  return target;
}

// ---------- Updates ----------
// Liefert zu jeder installierten Modrinth-Datei die neueste passende Version, falls sie neuer ist als die installierte.
async function findUpdates(id, type, onlyFiles) {
  checkType(type);
  const inst = getInstance(id);
  if (isOffline()) throw new Error('Ohne Internetverbindung kann nicht nach Updates gesucht werden.');
  if (type === 'mod' && inst.loader === 'vanilla') return { inst, cache: readCache(id), found: [], checked: 0 };
  const cache = readCache(id);
  let entries = await scan(id, type, cache);
  await lookupMeta(entries, cache);
  if (onlyFiles) entries = entries.filter((e) => onlyFiles.includes(e.file));
  entries = entries.filter((e) => e.sha1 && cache.meta[e.sha1] && cache.meta[e.sha1].projectId);
  const found = [];
  if (entries.length) {
    const latest = await postJson(`${MR}/version_files/update`, {
      hashes: [...new Set(entries.map((e) => e.sha1))],
      algorithm: 'sha1',
      loaders: apiLoaders(type, inst.loader),
      game_versions: [inst.version],
    });
    for (const e of entries) {
      const v = latest[e.sha1];
      const m = cache.meta[e.sha1];
      if (!v || !Array.isArray(v.files) || v.id === m.versionId) continue;
      const f = v.files.find((x) => x.primary) || v.files[0];
      if (!f || !f.hashes || f.hashes.sha1 === e.sha1) continue;
      // Nur anbieten, wenn die gefundene Version wirklich jünger ist (sonst wäre es ein Downgrade).
      if (m.published && v.date_published && Date.parse(v.date_published) <= Date.parse(m.published)) continue;
      found.push({ entry: e, meta: m, version: v, fileInfo: f });
    }
  }
  writeCache(id, cache);
  return { inst, cache, found, checked: entries.length };
}
async function checkUpdates(id, type) {
  const { found, checked } = await findUpdates(id, type, null);
  return {
    checked,
    updates: found.map((u) => ({
      file: u.entry.file,
      title: u.meta.title || displayName(u.entry.file),
      current: u.meta.versionNumber,
      latest: String(u.version.version_number || ''),
    })),
  };
}
async function updateContent(id, type, files) {
  checkType(type);
  if (isRunning(id)) throw new Error('Solange die Instanz läuft, kann nichts aktualisiert werden.');
  const only = Array.isArray(files) ? files.map(checkFile) : null;
  const { cache, found } = await findUpdates(id, type, only);
  const dir = contentDir(id, type);
  const updated = [];
  const failed = [];
  let n = 0;
  try {
    for (const u of found) {
      const title = u.meta.title || displayName(u.entry.file);
      send('progress', { id, text: `Aktualisiere ${title}`, done: n++, total: found.length });
      try {
        if (isRunning(id)) throw new Error('Die Instanz wurde gestartet.');
        const newName = checkFile(path.basename(String(u.fileInfo.filename))) + (u.entry.enabled ? '' : DISABLED);
        const dest = path.join(dir, newName);
        await fetchToFile(modrinthCdnUrl(u.fileInfo.url), dest, { sha1: u.fileInfo.hashes.sha1, sha512: u.fileInfo.hashes.sha512 });
        if (newName !== u.entry.file) await fsp.rm(path.join(dir, u.entry.file), { force: true });
        cache.meta[u.fileInfo.hashes.sha1] = metaFrom(u.version, u.meta.title, u.meta.icon);
        log(`Aktualisiert: ${title} ${u.meta.versionNumber} → ${u.version.version_number}`);
        updated.push({ file: newName, oldFile: u.entry.file, title, version: String(u.version.version_number || '') });
      } catch (e) {
        log(`Aktualisierung von ${title} fehlgeschlagen: ${errMsg(e)}`);
        failed.push({ file: u.entry.file, title, error: errMsg(e) });
      }
    }
  } finally {
    send('progress', { id, text: '', done: 0, total: 0, finished: true });
  }
  writeCache(id, cache);
  if (only && only.length === 1 && failed.length) throw new Error(failed[0].error);
  return { updated, failed };
}

handle('content:search', (opts) => searchContent(opts || {}));
handle('content:install', ({ id, type, projectId } = {}) => installContent(getInstance(id), checkType(type), String(projectId), new Set()));
handle('content:list', ({ id, type } = {}) => listContent(id, type));
handle('content:remove', ({ id, type, file } = {}) => removeContent(id, type, file));
handle('content:toggle', ({ id, type, file, enabled } = {}) => toggleContent(id, type, file, !!enabled));
handle('content:checkUpdates', ({ id, type } = {}) => checkUpdates(id, type));
handle('content:update', ({ id, type, files } = {}) => updateContent(id, type, files));

module.exports = {
  CONTENT_DIRS, CACHE_FILE, MR, PROJECT_RE,
  checkType, checkProjectId, apiLoaders, postJson, fetchToFile,
  searchContent, installContent, listContent, removeContent, toggleContent, checkUpdates, updateContent,
};
