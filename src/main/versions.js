// Minecraft-Versionen: Manifest (mit Offline-Cache), Versionsinfo, die von Mojang vorgeschriebenen Java-Startparameter
// und das Bereitstellen der Spieldateien (Spiel-JAR, Bibliotheken, Assets) mit begrenzter Gleichzeitigkeit und Zählern.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { once } = require('events');
const { META, UA, NO_NET, getJson, getConfig, readJsonSync, handle } = require('./core');

const VERSIONS = path.join(META, 'versions');
const LIBRARIES = path.join(META, 'libraries');
const ASSETS = path.join(META, 'assets');
const VERSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

let manifestCache = null;
const MANIFEST_FILE = path.join(META, 'version_manifest_cache.json');
async function getManifest() {
  if (manifestCache) return manifestCache;
  try {
    manifestCache = await getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    fs.mkdirSync(META, { recursive: true });
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifestCache));
    return manifestCache;
  } catch (e) {
    const cached = readJsonSync(MANIFEST_FILE, null);
    if (!cached) throw e;
    return cached; // nicht im Speicher halten, damit online wieder aktualisiert wird
  }
}
async function listVersions() {
  const m = await getManifest();
  return m.versions
    .filter((v) => v.type === 'release' || v.type === 'snapshot')
    .map((v) => ({ id: v.id, type: v.type }));
}

// Versionsdatei und Spiel-JAR von Mojang liegen genau einmal unter meta/versions/<Version>/ und werden von allen
// Loadern derselben Minecraft-Version gemeinsam benutzt.
function checkVersionId(id) {
  if (typeof id !== 'string' || !VERSION_ID_RE.test(id) || id.includes('..')) throw new Error(`Ungültige Version: ${String(id).slice(0, 40)}`);
  return id;
}
function versionJsonPath(id) {
  checkVersionId(id);
  return path.join(VERSIONS, id, `${id}.json`);
}
function clientJarPath(id) {
  checkVersionId(id);
  return path.join(VERSIONS, id, `${id}.jar`);
}
async function versionJson(id) {
  const file = versionJsonPath(id);
  const local = readJsonSync(file, null);
  if (local && local.id === id && local.downloads && local.libraries) return local;
  const m = await getManifest();
  const v = m.versions.find((x) => x.id === id);
  if (!v) throw new Error(`Unbekannte Minecraft-Version: ${id}`);
  const json = await getJson(v.url);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(json));
  return json;
}
async function versionInfo(id) {
  const m = await getManifest();
  const v = m.versions.find((x) => x.id === id);
  if (!v) throw new Error(`Unbekannte Minecraft-Version: ${id}`);
  const json = await versionJson(id);
  return {
    type: v.type,
    javaMajor: (json.javaVersion && json.javaVersion.majorVersion) || 8,
    jvmArgs: versionJvmArgs(json),
    // Ab 1.20 kann das Spiel direkt in eine Welt oder auf einen Server starten.
    quickPlay: JSON.stringify((json.arguments && json.arguments.game) || '').includes('quickPlaySingleplayer'),
  };
}

// Die Versionsdatei von Mojang schreibt Java-Startparameter vor (z. B. -XX:StackShadowPages=32 ab 26.x).
// Die Start-Bibliothek übernimmt sie nicht, ohne sie stürzt Java beim Laden des Spiels ab.
function ruleAllows(rules) {
  if (!rules) return true;
  let allowed = false;
  for (const r of rules) {
    if (r.features) continue;
    const os = r.os || {};
    const arch = process.arch === 'ia32' ? 'x86' : process.arch;
    let versionOk = true;
    if (os.version) {
      try { versionOk = new RegExp(os.version).test(require('os').release()); } catch { versionOk = false; }
    }
    const match = (!os.name || os.name === 'windows') && (!os.arch || os.arch === arch) && versionOk;
    if (match) allowed = r.action === 'allow';
  }
  return allowed;
}
function versionJvmArgs(json) {
  const raw = (json && json.arguments && json.arguments.jvm) || [];
  const flat = [];
  for (const a of raw) {
    if (typeof a === 'string') flat.push(a);
    else if (a && ruleAllows(a.rules)) flat.push(...[].concat(a.value));
  }
  // Was die Start-Bibliothek selbst setzt, wird ausgelassen.
  const skip = (a) => a === '-cp' || a === '${classpath}' || a.startsWith('-Djava.library.path') || a.startsWith('-XX:HeapDumpPath');
  return flat.filter((a) => typeof a === 'string' && !skip(a));
}
function resolveJvmArgs(args, versionId) {
  const vars = {
    natives_directory: path.join(META, 'natives', versionId),
    launcher_name: 'NovaLauncher',
    launcher_version: app.getVersion(),
    // Für Forge/NeoForge: Bibliotheksordner, Trennzeichen und Name des Spiel-JARs (meta/versions/<Version>/<Version>.jar).
    library_directory: LIBRARIES,
    classpath_separator: path.delimiter,
    version_name: versionId,
  };
  return (args || [])
    .map((a) => a.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)))
    .filter((a) => !a.includes('${'));
}

// ---------- downloads ----------
const OFFLINE_MSG = 'Der Offline-Modus ist aktiv. Schalte ihn in den Einstellungen aus, um das zu nutzen.';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function hashFile(file, algo = 'sha1') {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
async function exists(file, size) {
  try {
    const st = await fsp.stat(file);
    return st.isFile() && (size ? st.size === size : st.size > 0);
  } catch {
    return false;
  }
}
// Lädt eine Datei mit bis zu drei Versuchen, prüft (falls bekannt) die Prüfsumme und legt sie erst danach am Ziel ab.
// opts: { sha1, sha256, onBytes(delta) }
async function fetchFile(url, dest, opts = {}) {
  if (getConfig().offlineMode) throw new Error(OFFLINE_MSG);
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error(`Ungültige Download-Adresse für ${path.basename(dest)}`);
  let last = null;
  let network = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tmp = `${dest}.${crypto.randomBytes(4).toString('hex')}.part`;
    const ctrl = new AbortController();
    let timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), 45000); };
    let got = 0;
    try {
      arm();
      let res;
      try {
        res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      } catch (e) {
        network = true;
        throw e;
      }
      network = false;
      if (!res.ok) {
        const err = new Error(`Server antwortet mit ${res.status}`);
        err.permanent = res.status === 404 || res.status === 403;
        throw err;
      }
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      const h1 = crypto.createHash('sha1');
      const h256 = opts.sha256 ? crypto.createHash('sha256') : null;
      const out = fs.createWriteStream(tmp);
      try {
        for await (const chunk of res.body) {
          arm();
          got += chunk.length;
          h1.update(chunk);
          if (h256) h256.update(chunk);
          if (!out.write(chunk)) await once(out, 'drain');
          if (opts.onBytes) opts.onBytes(chunk.length);
        }
      } finally {
        out.end();
        await once(out, 'close').catch(() => {});
      }
      if (opts.sha1 && h1.digest('hex') !== String(opts.sha1).toLowerCase()) throw Object.assign(new Error('Prüfsumme stimmt nicht'), { checksum: true });
      if (h256 && h256.digest('hex') !== String(opts.sha256).toLowerCase()) throw Object.assign(new Error('Prüfsumme stimmt nicht'), { checksum: true });
      await fsp.rename(tmp, dest);
      clearTimeout(timer);
      return;
    } catch (e) {
      last = e;
      clearTimeout(timer);
      await fsp.rm(tmp, { force: true }).catch(() => {});
      if (opts.onBytes && got) opts.onBytes(-got); // Fortschritt des fehlgeschlagenen Versuchs zurücknehmen
      if (e && e.permanent) break;
      if (attempt < 3) await wait(800 * attempt);
    }
  }
  if (network) throw new Error(`${path.basename(dest)} konnte nicht heruntergeladen werden. ${NO_NET}`);
  const err = new Error(`${path.basename(dest)} konnte nicht heruntergeladen werden (${(last && last.message) || 'unbekannter Fehler'}).`);
  if (last && last.checksum) err.checksum = true;
  throw err;
}
// Arbeitet eine Liste mit begrenzter Gleichzeitigkeit ab (statt wie die Start-Bibliothek alles auf einmal zu öffnen).
async function pool(items, limit, fn) {
  let next = 0;
  let failed = null;
  const worker = async () => {
    while (next < items.length && !failed) {
      const item = items[next++];
      try { await fn(item); } catch (e) { failed = failed || e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw failed;
}

// ---------- game files ----------
// Spiel-JAR: genau eine Kopie pro Minecraft-Version, egal mit welchem Loader gestartet wird.
// status(text, done, total, unit) mit unit 'bytes' oder 'files'.
async function ensureClientJar(id, json, status) {
  const jar = clientJarPath(id);
  const client = json.downloads && json.downloads.client;
  if (!client || !client.url) throw new Error(`Für Minecraft ${id} gibt es kein Spiel-JAR zum Herunterladen.`);
  if (await exists(jar, client.size)) return { jar, downloaded: false };
  // Frühere Launcher-Versionen haben das JAR im Ordner des Fabric-Profils abgelegt: wiederverwenden statt neu laden.
  try {
    for (const d of await fsp.readdir(VERSIONS, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name === id || !d.name.endsWith(`-${id}`)) continue;
      const old = path.join(VERSIONS, d.name, `${d.name}.jar`);
      if ((await exists(old, client.size)) && (!client.sha1 || (await hashFile(old)) === client.sha1)) {
        await fsp.mkdir(path.dirname(jar), { recursive: true });
        await fsp.link(old, jar).catch(() => fsp.copyFile(old, jar));
        return { jar, downloaded: false };
      }
    }
  } catch { /* noch kein Versionsordner */ }
  let got = 0;
  const total = client.size || 0;
  status('Spieldateien', 0, total, 'bytes');
  await fetchFile(client.url, jar, { sha1: client.sha1, onBytes: (n) => { got += n; status('Spieldateien', got, total, 'bytes'); } });
  return { jar, downloaded: true };
}

function mavenPath(name) {
  let ext = 'jar';
  const at = name.indexOf('@');
  if (at > 0) { ext = name.slice(at + 1); name = name.slice(0, at); }
  const p = name.split(':');
  if (p.length < 3) return null;
  return `${p[0].replace(/\./g, '/')}/${p[1]}/${p[2]}/${p[1]}-${p[2]}${p[3] ? '-' + p[3] : ''}.${ext}`;
}
// Dieselbe (eigenwillige) Regelauswertung wie die Start-Bibliothek, damit genau die Dateien bereitliegen, die sie erwartet.
function mclcSkips(lib) {
  if (!lib.rules) return false;
  if (lib.rules.length > 1) {
    const [a, b] = lib.rules;
    return !(a.action === 'allow' && b.action === 'disallow' && b.os && b.os.name === 'osx');
  }
  return lib.rules[0].action === 'allow' && lib.rules[0].os ? lib.rules[0].os.name !== 'windows' : false;
}
function libraryFile(lib) {
  if (!lib || typeof lib.name !== 'string' || mclcSkips(lib)) return null;
  const art = lib.downloads && lib.downloads.artifact;
  let rel;
  let url;
  let sha1;
  let size;
  if (art) {
    rel = art.path || mavenPath(lib.name);
    url = art.url;
    sha1 = art.sha1;
    size = art.size;
  } else if (lib.downloads) {
    return null; // nur Natives (alte Versionen), die lädt und entpackt die Start-Bibliothek selbst
  } else {
    rel = mavenPath(lib.name);
    if (rel) url = `${(lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/')}${rel}`;
    sha1 = typeof lib.sha1 === 'string' ? lib.sha1 : undefined;
  }
  if (!rel) return null;
  const file = path.resolve(LIBRARIES, rel);
  if (!file.startsWith(LIBRARIES + path.sep)) return null; // kein Schreiben außerhalb des Bibliotheksordners
  return { file, url, sha1, size, name: lib.name };
}
// Lädt alle Bibliotheken der Minecraft-Version und (falls vorhanden) des Loader-Profils.
async function ensureLibraries(json, profile, status) {
  const wanted = new Map();
  const add = (lib) => {
    const f = libraryFile(lib);
    if (f && !wanted.has(f.file)) wanted.set(f.file, f);
  };
  const custom = profile ? [].concat(profile.libraries || []).filter(Boolean) : [];
  custom.forEach(add);
  if (profile) [].concat(profile.mavenFiles || []).filter(Boolean).forEach(add);
  const taken = new Set(custom.map((l) => String(l.name).split(':')[1]));
  for (const lib of json.libraries || []) {
    if (lib.downloads && lib.downloads.artifact && !taken.has(String(lib.name).split(':')[1])) add(lib);
  }
  const all = [...wanted.values()];
  let done = 0;
  let fetched = 0;
  status('Bibliotheken', 0, all.length, 'files');
  await pool(all, 8, async (f) => {
    if (!(await exists(f.file, f.size)) && f.url) {
      // Ohne Adresse erzeugt der Installer des Loaders die Datei selbst.
      await fetchFile(f.url, f.file, { sha1: f.sha1 });
      fetched++;
    }
    status('Bibliotheken', ++done, all.length, 'files');
  });
  return fetched;
}
// Assets: echter Index unter assets/indexes/<id>.json. Die Start-Bibliothek würde danach alle Dateien noch einmal
// einzeln per Prüfsumme kontrollieren (bei jedem Start); stattdessen bekommt sie einen leeren Index unter ihrem Namen.
// Zurück kommt der Name des echten Index für das Spiel (overrides.assetIndex).
async function ensureAssets(json, mclcIndexName, status) {
  const ai = json.assetIndex;
  if (!ai || !ai.id || !ai.url) return { index: mclcIndexName, fetched: 0 };
  checkVersionId(ai.id);
  const indexDir = path.join(ASSETS, 'indexes');
  const indexFile = path.join(indexDir, `${ai.id}.json`);
  let index = readJsonSync(indexFile, null);
  if (!index || !index.objects || !Object.keys(index.objects).length || (ai.size && !(await exists(indexFile, ai.size)))) {
    status('Assets', 0, 0, 'files');
    await fetchFile(ai.url, indexFile, { sha1: ai.sha1 });
    index = readJsonSync(indexFile, null);
    if (!index || !index.objects) throw new Error('Der Asset-Index ist beschädigt. Bitte noch einmal starten.');
  }
  const legacy = json.assets === 'legacy' || json.assets === 'pre-1.6';
  if (mclcIndexName && mclcIndexName !== ai.id) {
    // Alte Versionen kopiert die Start-Bibliothek in den Ordner "resources", dafür braucht sie den echten Index.
    const want = legacy ? await fsp.readFile(indexFile, 'utf8') : '{"objects":{}}';
    const alias = path.join(indexDir, `${checkVersionId(mclcIndexName)}.json`);
    const cur = await fsp.readFile(alias, 'utf8').catch(() => null);
    if (cur !== want) await fsp.writeFile(alias, want);
  }
  const unique = new Map();
  for (const o of Object.values(index.objects)) {
    if (o && /^[0-9a-f]{40}$/.test(o.hash)) unique.set(o.hash, o.size);
  }
  const all = [...unique.entries()];
  let done = 0;
  status('Assets', 0, all.length, 'files');
  const missing = [];
  await pool(all, 32, async ([hash, size]) => {
    if (await exists(path.join(ASSETS, 'objects', hash.slice(0, 2), hash), size)) status('Assets', ++done, all.length, 'files');
    else missing.push(hash);
  });
  await pool(missing, 12, async (hash) => {
    await fetchFile(`https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`, path.join(ASSETS, 'objects', hash.slice(0, 2), hash), { sha1: hash });
    status('Assets', ++done, all.length, 'files');
  });
  return { index: ai.id, fetched: missing.length };
}

handle('versions:list', () => listVersions());

module.exports = {
  VERSIONS, LIBRARIES, ASSETS,
  getManifest, listVersions, versionInfo, versionJson, versionJsonPath, clientJarPath, checkVersionId,
  ruleAllows, versionJvmArgs, resolveJvmArgs,
  fetchFile, pool, exists, hashFile,
  ensureClientJar, ensureLibraries, ensureAssets,
};
