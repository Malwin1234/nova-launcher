// Mod-Loader: Fabric, Quilt, Forge, NeoForge. Bereitet das Versionsprofil des Loaders vor und merkt es sich in der
// Instanz (loaderProfile), damit ein späterer Start auch offline funktioniert.
// Fabric/Quilt: Profil-JSON von den Meta-Servern. Forge/NeoForge: offizieller Installer, ohne Fenster ausgeführt
// (--installClient in den gemeinsamen meta-Ordner); gestartet wird die installierte Version als eigene Version.
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { META, getJson, request, isOffline, log, readJsonSync, handle } = require('./core');
const { versionJsonPath, checkVersionId, versionJvmArgs, fetchFile, exists } = require('./versions');

const LOADERS = [
  { id: 'vanilla', label: 'Vanilla' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'quilt', label: 'Quilt' },
  { id: 'forge', label: 'Forge' },
  { id: 'neoforge', label: 'NeoForge' },
];
const LABEL = Object.fromEntries(LOADERS.map((l) => [l.id, l.label]));
const LOADER_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const OFFLINE_FIRST = 'Diese Instanz muss einmal mit Internetverbindung gestartet werden, bevor sie offline läuft.';

// ---------- helpers ----------
// Vergleicht Versionsnummern wie 0.29.1, 47.4.10 oder 0.20.0-beta.9 (Vorabversionen zählen weniger).
function cmpVersion(a, b) {
  const split = (v) => String(v).split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = split(a);
  const pb = split(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  const preA = /-/.test(a);
  const preB = /-/.test(b);
  if (preA !== preB) return preA ? -1 : 1;
  return String(a).localeCompare(String(b), 'en', { numeric: true });
}
const isPre = (v) => /alpha|beta|pre|rc|snapshot/i.test(v);
function newestStable(list) {
  const sorted = [...list].sort((a, b) => cmpVersion(b, a));
  return sorted.find((v) => !isPre(v)) || sorted[0] || null;
}
async function getJsonOr404(url) {
  try {
    return await getJson(url);
  } catch (e) {
    if (/\((400|404)\)/.test(e.message)) return null;
    throw e;
  }
}
async function writeProfile(id, json) {
  checkVersionId(id);
  if (!json || json.id !== id || !json.mainClass || !Array.isArray(json.libraries)) throw new Error(`Das Profil für ${id} ist ungültig.`);
  const file = versionJsonPath(id);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(json));
}
function cleanPinned(inst) {
  const v = typeof inst.loaderVersion === 'string' ? inst.loaderVersion.trim() : '';
  if (!v) return '';
  if (!LOADER_VERSION_RE.test(v)) throw new Error('Ungültige Loader-Version in den Instanz-Einstellungen');
  return v;
}

// ---------- fabric / quilt ----------
const fabric = {
  async latest(mc) {
    const list = (await getJsonOr404(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`)) || [];
    if (!list.length) return null;
    const stable = list.find((x) => x.loader && x.loader.stable) || list[0];
    return stable.loader.version;
  },
  async install(mc, version) {
    const id = `fabric-loader-${version}-${mc}`;
    if (!fs.existsSync(versionJsonPath(id))) {
      const profile = await getJsonOr404(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(version)}/profile/json`);
      if (!profile) throw new Error(`Die Fabric-Version ${version} gibt es für Minecraft ${mc} nicht.`);
      await writeProfile(id, profile);
    }
    return id;
  },
};
const quilt = {
  async latest(mc) {
    const list = (await getJsonOr404(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}`)) || [];
    return newestStable(list.map((x) => x && x.loader && x.loader.version).filter(Boolean));
  },
  async install(mc, version) {
    const id = `quilt-loader-${version}-${mc}`;
    if (!fs.existsSync(versionJsonPath(id))) {
      const profile = await getJsonOr404(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(version)}/profile/json`);
      if (!profile) throw new Error(`Die Quilt-Version ${version} gibt es für Minecraft ${mc} nicht.`);
      await writeProfile(id, profile);
    }
    return id;
  },
};

// ---------- forge / neoforge (Installer) ----------
const installing = new Map(); // Profil-ID -> laufende Installation
async function fetchSha1(url) {
  try {
    const res = await request(url);
    if (!res.ok) return null;
    const m = /^[0-9a-f]{40}/i.exec((await res.text()).trim());
    return m ? m[0].toLowerCase() : null;
  } catch {
    return null;
  }
}
function profileComplete(id) {
  const json = readJsonSync(versionJsonPath(id), null);
  return !!(json && json.mainClass && fs.existsSync(path.join(path.dirname(versionJsonPath(id)), '.nova-installed')));
}
function runInstaller(javaPath, installer, label, status) {
  // Der Installer braucht eine Konsole-Java (java.exe) und eine launcher_profiles.json im Zielordner.
  const java = path.join(path.dirname(javaPath), 'java.exe');
  const exe = fs.existsSync(java) ? java : javaPath;
  const profiles = path.join(META, 'launcher_profiles.json');
  if (!fs.existsSync(profiles)) fs.writeFileSync(profiles, JSON.stringify({ profiles: {} }));
  return new Promise((resolve, reject) => {
    const tail = [];
    let lines = 0;
    const child = spawn(exe, ['-jar', installer, '--installClient', META], { cwd: path.dirname(installer), windowsHide: true });
    const timer = setTimeout(() => child.kill(), 20 * 60 * 1000);
    const onData = (buf) => {
      for (const line of String(buf).split(/\r?\n/)) {
        if (!line.trim()) continue;
        lines++;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        log(`[${label}-Installer] ${line}`);
        status(`${label} wird installiert`, 0, 0, null, `${lines} Schritte`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`${label}-Installer konnte nicht gestartet werden: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const why = tail.filter((l) => /error|exception|failed|fehler/i.test(l)).slice(-3).join(' | ') || tail.slice(-3).join(' | ');
      reject(new Error(`Die Installation von ${label} ist fehlgeschlagen (Code ${code}). ${why}`.trim()));
    });
  });
}
async function installViaInstaller(label, url, mc, version, ctx) {
  const cacheDir = path.join(META, 'installers');
  const installer = path.join(cacheDir, path.basename(new URL(url).pathname));
  // Die Profil-ID steht in der version.json im Installer; zuerst den Installer holen (klein, ~5 MB).
  if (!(await exists(installer))) {
    ctx.status(`${label}-Installer wird heruntergeladen`, 0, 0);
    const sha1 = await fetchSha1(`${url}.sha1`);
    let got = 0;
    await fetchFile(url, installer, { sha1, onBytes: (n) => { got += n; ctx.status(`${label}-Installer wird heruntergeladen`, got, 0, 'bytes'); } }).catch((e) => {
      if (/\(Server antwortet mit 404\)/.test(e.message)) throw new Error(`Die ${label}-Version ${version} gibt es für Minecraft ${mc} nicht.`);
      throw e;
    });
  }
  let id;
  let inherits;
  try {
    const zip = new AdmZip(installer);
    const vj = JSON.parse(zip.readAsText('version.json'));
    id = vj.id;
    inherits = vj.inheritsFrom;
  } catch {
    await fsp.rm(installer, { force: true });
    throw new Error(`Der ${label}-Installer ist beschädigt oder zu alt (nur Installer ab Forge 1.12.2 werden unterstützt).`);
  }
  checkVersionId(id);
  if (inherits && inherits !== mc) throw new Error(`Die ${label}-Version ${version} gehört zu Minecraft ${inherits}, nicht zu ${mc}.`);
  if (profileComplete(id)) {
    await fsp.rm(installer, { force: true }).catch(() => {});
    return id;
  }
  if (installing.has(id)) {
    await installing.get(id);
    return id;
  }
  const job = (async () => {
    ctx.status(`${label} wird installiert`, 0, 0);
    log(`${label} ${version} wird installiert (das kann beim ersten Mal einige Minuten dauern) ...`);
    await runInstaller(ctx.javaPath, installer, label, ctx.status);
    const json = readJsonSync(versionJsonPath(id), null);
    if (!json || !json.mainClass) throw new Error(`${label} wurde installiert, aber das Versionsprofil ${id} fehlt.`);
    fs.writeFileSync(path.join(path.dirname(versionJsonPath(id)), '.nova-installed'), new Date().toISOString());
    // Installer und dessen Protokoll werden nicht mehr gebraucht (Speicher sparen)
    await Promise.all([installer, `${installer}.log`].map((f) => fsp.rm(f, { force: true }).catch(() => {})));
  })();
  installing.set(id, job);
  try {
    await job;
  } finally {
    installing.delete(id);
  }
  return id;
}
const forge = {
  async latest(mc) {
    const promos = (await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos || {};
    return promos[`${mc}-recommended`] || promos[`${mc}-latest`] || null;
  },
  normalize(mc, v) {
    return v.startsWith(`${mc}-`) ? v.slice(mc.length + 1) : v;
  },
  install(mc, version, ctx) {
    const full = `${mc}-${version}`;
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
    return installViaInstaller('Forge', url, mc, version, ctx);
  },
};
// NeoForge-Versionen tragen die Minecraft-Version im Namen: 1.21.1 -> 21.1.x, 26.3 -> 26.3.0.x, 26.1.2 -> 26.1.2.x
function neoPrefix(mc) {
  let m = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc);
  if (m) return Number(m[1]) > 20 || (Number(m[1]) === 20 && Number(m[2] || 0) >= 2) ? `${m[1]}.${m[2] || 0}.` : null;
  m = /^(\d{2,})\.(\d+)(?:\.(\d+))?$/.exec(mc);
  if (m) return `${m[1]}.${m[2]}.${m[3] || 0}.`;
  return null;
}
const neoforge = {
  async latest(mc) {
    const prefix = neoPrefix(mc);
    if (!prefix) return null;
    const data = await getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    return newestStable((data.versions || []).filter((v) => typeof v === 'string' && v.startsWith(prefix)));
  },
  check(mc, v) {
    const prefix = neoPrefix(mc);
    if (!prefix) throw new Error(`NeoForge unterstützt Minecraft ${mc} nicht (erst ab 1.20.2).`);
    if (!v.startsWith(prefix)) throw new Error(`Die NeoForge-Version ${v} passt nicht zu Minecraft ${mc} (erwartet ${prefix}x).`);
  },
  install(mc, version, ctx) {
    const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
    return installViaInstaller('NeoForge', url, mc, version, ctx);
  },
};
const IMPL = { fabric, quilt, forge, neoforge };

// ---------- entry point ----------
// Was die Start-Bibliothek braucht: Name der eigenen Version (version.custom), deren Profil (für den
// Bibliotheks-Download) und die Java-Startparameter des Profils (Forge/NeoForge brauchen Modulpfad usw.).
function result(id, loader, loaderVersion) {
  const profile = readJsonSync(versionJsonPath(id), null);
  if (!profile || !profile.mainClass) throw new Error(`Das Profil von ${LABEL[loader]} (${id}) ist beschädigt. Bitte einmal online starten.`);
  return { custom: id, profile, jvmArgs: versionJvmArgs(profile), loader, loaderVersion };
}
function cachedProfile(inst, pinned) {
  const c = inst.loaderProfile;
  if (c && typeof c === 'object' && c.loader === inst.loader && c.mcVersion === inst.version && typeof c.id === 'string') {
    if (!pinned || c.loaderVersion === pinned) {
      try { if (fs.existsSync(versionJsonPath(c.id))) return c; } catch { /* ungültige ID */ }
    }
  }
  // Instanzen aus früheren Launcher-Versionen (nur Fabric)
  if (inst.loader === 'fabric' && typeof inst.fabricProfile === 'string' && !pinned) {
    try {
      if (fs.existsSync(versionJsonPath(inst.fabricProfile))) return { loader: 'fabric', mcVersion: inst.version, id: inst.fabricProfile, loaderVersion: '' };
    } catch { /* ungültige ID */ }
  }
  return null;
}
// ctx: { status(text, done, total, unit, extra), javaPath }
// Ergebnis: null für Vanilla, sonst { custom, profile, jvmArgs, loader, loaderVersion }. Ändert inst.loaderProfile.
async function ensureLoader(inst, ctx) {
  const loader = inst.loader || 'vanilla';
  if (loader === 'vanilla') return null;
  const impl = IMPL[loader];
  if (!impl || !LOADERS.some((l) => l.id === loader)) throw new Error(`Unbekannter Mod-Loader: ${String(loader).slice(0, 20)}`);
  const label = LABEL[loader];
  const mc = inst.version;
  let pinned = cleanPinned(inst);
  if (pinned && impl.normalize) pinned = impl.normalize(mc, pinned);
  const cache = cachedProfile(inst, pinned);
  if (isOffline()) {
    if (cache) return result(cache.id, loader, cache.loaderVersion);
    throw new Error(OFFLINE_FIRST);
  }
  ctx.status(`${label} wird vorbereitet`, 0, 0);
  let version = pinned;
  if (!version) {
    try {
      version = await impl.latest(mc);
    } catch (e) {
      if (cache) {
        log(`${label}: Versionsliste nicht erreichbar (${e.message}), verwende die zuletzt genutzte Version.`);
        return result(cache.id, loader, cache.loaderVersion);
      }
      throw e;
    }
    if (!version) throw new Error(`${label} unterstützt Minecraft ${mc} (noch) nicht.`);
  }
  if (impl.check) impl.check(mc, version);
  if (cache && cache.loaderVersion === version) return result(cache.id, loader, version);
  const id = await impl.install(mc, version, ctx);
  inst.loaderProfile = { loader, mcVersion: mc, loaderVersion: version, id };
  if (loader === 'fabric') inst.fabricProfile = id;
  log(`${label} ${version} für Minecraft ${mc}`);
  return result(id, loader, version);
}
// Verfügbare Versionen eines Loaders für eine Minecraft-Version (neueste zuerst), z. B. für eine Auswahl in den Einstellungen.
async function listLoaderVersions(loader, mc) {
  if (!IMPL[loader]) throw new Error('Unbekannter Mod-Loader');
  checkVersionId(mc);
  if (loader === 'fabric') {
    const list = (await getJsonOr404(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`)) || [];
    return list.map((x) => x.loader.version);
  }
  if (loader === 'quilt') {
    const list = (await getJsonOr404(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}`)) || [];
    return list.map((x) => x.loader.version).sort((a, b) => cmpVersion(b, a));
  }
  if (loader === 'neoforge') {
    const prefix = neoPrefix(mc);
    if (!prefix) return [];
    const data = await getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    return (data.versions || []).filter((v) => v.startsWith(prefix)).sort((a, b) => cmpVersion(b, a));
  }
  const meta = await getJsonOr404('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json');
  return ((meta && meta[mc]) || []).map((v) => v.slice(mc.length + 1)).sort((a, b) => cmpVersion(b, a));
}

handle('loaders:list', () => LOADERS.map((l) => ({ ...l })));
handle('loaders:versions', (loader, mc) => listLoaderVersions(String(loader || ''), String(mc || '')));

module.exports = { LOADERS, ensureLoader, listLoaderVersions, cmpVersion, neoPrefix };
