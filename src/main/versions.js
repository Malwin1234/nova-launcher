// Minecraft-Versionen: Manifest (mit Offline-Cache), Versionsinfo und die von Mojang vorgeschriebenen Java-Startparameter.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { META, getJson, readJsonSync, handle } = require('./core');

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
async function versionInfo(id) {
  const m = await getManifest();
  const v = m.versions.find((x) => x.id === id);
  if (!v) throw new Error(`Unbekannte Minecraft-Version: ${id}`);
  const json = await getJson(v.url);
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
  const raw = (json.arguments && json.arguments.jvm) || [];
  const flat = [];
  for (const a of raw) {
    if (typeof a === 'string') flat.push(a);
    else if (ruleAllows(a.rules)) flat.push(...[].concat(a.value));
  }
  // Was die Start-Bibliothek selbst setzt, wird ausgelassen.
  const skip = (a) => a === '-cp' || a === '${classpath}' || a.startsWith('-Djava.library.path') || a.startsWith('-XX:HeapDumpPath');
  return flat.filter((a) => !skip(a));
}
function resolveJvmArgs(args, versionId) {
  const natives = path.join(META, 'natives', versionId);
  const vars = { natives_directory: natives, launcher_name: 'NovaLauncher', launcher_version: app.getVersion() };
  return (args || [])
    .map((a) => a.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)))
    .filter((a) => !a.includes('${'));
}

handle('versions:list', () => listVersions());

module.exports = { getManifest, listVersions, versionInfo, ruleAllows, versionJvmArgs, resolveJvmArgs };
