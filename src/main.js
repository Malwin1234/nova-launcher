const { app, BrowserWindow, ipcMain, shell, safeStorage, Menu, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { once } = require('events');
const crypto = require('crypto');
const zlib = require('zlib');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const AdmZip = require('adm-zip');

const UA = `NovaLauncher/${app.getVersion()}`;
// Nur in der Entwicklung (nicht im installierten Launcher): eigener Datenordner und Testanmeldung für automatische Starttests.
const DEV_TEST = !app.isPackaged && process.env.NOVA_TEST === '1';
const DATA = (DEV_TEST && process.env.NOVA_DATA_DIR) || path.join(app.getPath('appData'), 'NovaLauncher');
const META = path.join(DATA, 'meta');
const INSTANCES = path.join(DATA, 'instances');
const JAVA = path.join(DATA, 'java');
const CONFIG_FILE = path.join(DATA, 'config.json');
const ACCOUNT_FILE = path.join(DATA, 'account.bin');

const CONTENT_DIRS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };

let win = null;
const running = new Map(); // instanceId -> child process

// ---------- helpers ----------
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function log(line) {
  send('log', String(line).trimEnd());
}
function errMsg(e) {
  if (!e) return 'Unbekannter Fehler';
  if (typeof e === 'string') return e;
  if (e.message) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}
const NO_NET = 'Keine Internetverbindung. Diese Funktion ist offline nicht verfügbar.';
async function request(url) {
  if (getConfig().offlineMode) throw new Error('Der Offline-Modus ist aktiv. Schalte ihn in den Einstellungen aus, um das zu nutzen.');
  try {
    return await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  } catch {
    throw new Error(NO_NET);
  }
}
function isOffline() {
  return getConfig().offlineMode || !net.isOnline();
}
async function getJson(url) {
  const res = await request(url);
  if (!res.ok) throw new Error(`Anfrage fehlgeschlagen (${res.status}): ${url}`);
  return res.json();
}
async function download(url, dest, onProgress) {
  if (getConfig().offlineMode) throw new Error('Der Offline-Modus ist aktiv. Schalte ihn in den Einstellungen aus, um das zu nutzen.');
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA } });
  } catch {
    throw new Error(NO_NET);
  }
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!out.write(chunk)) await once(out, 'drain');
    if (onProgress) onProgress(got, total);
  }
  out.end();
  await once(out, 'finish');
  await fsp.rename(tmp, dest);
}
function readJsonSync(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function checkId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) throw new Error('Ungültige Instanz-ID');
  return id;
}
function instDir(id) {
  return path.join(INSTANCES, checkId(id));
}

// ---------- config ----------
function getConfig() {
  return { memoryMax: 4, offlineMode: false, ...readJsonSync(CONFIG_FILE, {}) };
}
function setConfig(patch) {
  const cfg = { ...getConfig() };
  if (patch && Number.isFinite(patch.memoryMax)) cfg.memoryMax = Math.min(32, Math.max(1, Math.round(patch.memoryMax)));
  if (patch && typeof patch.offlineMode === 'boolean') cfg.offlineMode = patch.offlineMode;
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  return cfg;
}

// ---------- account (Microsoft) ----------
function loadAccount() {
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(ACCOUNT_FILE)));
  } catch {
    return null;
  }
}
function saveAccount(acc) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Sichere Speicherung ist auf diesem System nicht verfügbar');
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(ACCOUNT_FILE, safeStorage.encryptString(JSON.stringify(acc)));
}
function publicAccount() {
  const acc = loadAccount();
  return acc ? { name: acc.name, uuid: acc.uuid } : null;
}
async function login() {
  const xbox = await new Auth('select_account').launch('electron');
  const mc = await xbox.getMinecraft();
  saveAccount({ refresh: xbox.save(), name: mc.profile.name, uuid: mc.profile.id });
  return publicAccount();
}
function offlineAuth(acc) {
  // Start ohne Anmeldeserver: Einzelspieler und LAN funktionieren, Online-Server nicht.
  return { access_token: '0', client_token: '0', uuid: acc.uuid, name: acc.name, user_properties: '{}', meta: { type: 'mojang' } };
}
async function getLaunchAuth() {
  if (DEV_TEST) return { auth: offlineAuth({ uuid: '00000000000000000000000000000000', name: 'Tester' }), offline: true };
  const acc = loadAccount();
  if (!acc) throw new Error('Bitte einmal mit einem Microsoft-Konto anmelden. Danach kannst du auch offline spielen.');
  if (isOffline()) {
    log('Offline-Modus: Start ohne Anmeldeserver (nur Einzelspieler und LAN).');
    return { auth: offlineAuth(acc), offline: true };
  }
  try {
    const xbox = await new Auth('select_account').refresh(acc.refresh);
    const mc = await xbox.getMinecraft();
    saveAccount({ refresh: xbox.save(), name: mc.profile.name, uuid: mc.profile.id });
    return { auth: mc.mclc(), offline: false };
  } catch (e) {
    // Nur bei fehlender Verbindung offline weitermachen, nicht bei abgelehnter Anmeldung.
    let reachable = true;
    try {
      await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    } catch {
      reachable = false;
    }
    if (reachable) throw e;
    log('Anmeldeserver nicht erreichbar, starte offline (nur Einzelspieler und LAN).');
    return { auth: offlineAuth(acc), offline: true };
  }
}

// ---------- versions ----------
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

// ---------- java runtime (Eclipse Temurin) ----------
function findJavaw(dir) {
  if (!fs.existsSync(dir)) return null;
  const direct = path.join(dir, 'bin', 'javaw.exe');
  if (fs.existsSync(direct)) return direct;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const p = path.join(dir, entry.name, 'bin', 'javaw.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}
async function ensureJava(major, onStatus) {
  if (major === 16) major = 17; // Temurin bietet keine 16er-JRE an, 17 ist kompatibel
  const dir = path.join(JAVA, String(major));
  let javaw = findJavaw(dir);
  if (javaw) return javaw;
  const zip = path.join(JAVA, `jre-${major}.zip`);
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`;
  log(`Lade Java ${major} herunter ...`);
  await download(url, zip, (got, total) => onStatus(`Java ${major} wird heruntergeladen`, got, total));
  onStatus(`Java ${major} wird entpackt`, 0, 0);
  await fsp.rm(dir, { recursive: true, force: true });
  await new Promise((resolve, reject) => {
    new AdmZip(zip).extractAllToAsync(dir, true, false, (e) => (e ? reject(e) : resolve()));
  });
  await fsp.rm(zip, { force: true });
  javaw = findJavaw(dir);
  if (!javaw) throw new Error(`Java ${major} konnte nicht installiert werden`);
  return javaw;
}

// ---------- fabric ----------
async function ensureFabric(inst) {
  const mcVersion = inst.version;
  const cachedFile = inst.fabricProfile && path.join(META, 'versions', inst.fabricProfile, `${inst.fabricProfile}.json`);
  if (isOffline()) {
    if (cachedFile && fs.existsSync(cachedFile)) return inst.fabricProfile;
    throw new Error('Diese Instanz muss einmal mit Internetverbindung gestartet werden, bevor sie offline läuft.');
  }
  let loaders;
  try {
    loaders = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`);
  } catch {
    loaders = [];
  }
  if (!loaders.length) throw new Error(`Fabric unterstützt Minecraft ${mcVersion} (noch) nicht.`);
  const loader = loaders[0].loader.version;
  const name = `fabric-loader-${loader}-${mcVersion}`;
  const file = path.join(META, 'versions', name, `${name}.json`);
  if (!fs.existsSync(file)) {
    const profile = await getJson(
      `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loader)}/profile/json`
    );
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(profile));
  }
  inst.fabricProfile = name;
  return name;
}

// ---------- instances ----------
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

// ---------- zuletzt gespielt (Welten und Server) ----------
// Minimaler NBT-Leser für level.dat (gzip) und servers.dat.
function readNbt(buf) {
  let o = 0;
  const str = () => { const l = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + l); o += l; return s; };
  const payload = (t) => {
    switch (t) {
      case 1: o += 1; return buf.readInt8(o - 1);
      case 2: o += 2; return buf.readInt16BE(o - 2);
      case 3: o += 4; return buf.readInt32BE(o - 4);
      case 4: o += 8; return Number(buf.readBigInt64BE(o - 8));
      case 5: o += 4; return buf.readFloatBE(o - 4);
      case 6: o += 8; return buf.readDoubleBE(o - 8);
      case 7: { const l = buf.readInt32BE(o); o += 4 + l; return null; }
      case 8: return str();
      case 9: { const et = buf.readUInt8(o); const l = buf.readInt32BE(o + 1); o += 5; const a = []; for (let i = 0; i < l; i++) a.push(payload(et)); return a; }
      case 10: { const c = {}; for (;;) { const tt = buf.readUInt8(o); o += 1; if (tt === 0) break; const n = str(); c[n] = payload(tt); } return c; }
      case 11: { const l = buf.readInt32BE(o); o += 4 + l * 4; return null; }
      case 12: { const l = buf.readInt32BE(o); o += 4 + l * 8; return null; }
      default: throw new Error('NBT');
    }
  };
  if (buf.readUInt8(o) !== 10) throw new Error('NBT');
  o += 1; str();
  return payload(10);
}
function pngDataUrl(file) {
  try {
    const st = fs.statSync(file);
    if (st.size > 0 && st.size < 300000) return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  } catch { /* kein Bild */ }
  return null;
}
const SERVER_RE = /^[A-Za-z0-9._\-\[\]:]{1,255}$/;
function recentFile(id) {
  return path.join(instDir(id), 'nova-recent.json');
}
function readRecent(id) {
  const r = readJsonSync(recentFile(id), null);
  return r && r.servers ? r : { servers: {} };
}
function noteServer(id, address, name, time) {
  if (!SERVER_RE.test(address)) return;
  const r = readRecent(id);
  const old = r.servers[address] || {};
  r.servers[address] = { name: name || old.name || address, time: Math.max(time || Date.now(), old.time || 0) };
  fs.writeFileSync(recentFile(id), JSON.stringify(r));
}
// Das Spiel schreibt (ab 1.20) in quickPlay/log.json, was zuletzt gespielt wurde.
function importQuickPlayLog(id) {
  try {
    const entries = JSON.parse(fs.readFileSync(path.join(instDir(id), 'quickPlay', 'log.json'), 'utf8'));
    for (const e of [].concat(entries)) {
      const w = e.quickPlayWorld || e;
      if (w && w.type === 'multiplayer' && w.id) noteServer(id, String(w.id), w.name, Date.parse(e.lastPlayedTime) || Date.now());
    }
  } catch { /* kein Protokoll vorhanden */ }
}
function listRecent() {
  const items = [];
  for (const inst of listInstances()) {
    const dir = instDir(inst.id);
    const base = { instanceId: inst.id, instanceName: inst.name, version: inst.version, loader: inst.loader };
    // Unbekannt (noch nie mit dieser Version gestartet) zählt als möglich; beim Start wird es geprüft.
    const canQuick = !(inst.versionInfo && inst.versionInfo.quickPlay === false);
    // Welten
    const saves = path.join(dir, 'saves');
    let folders = [];
    try { folders = fs.readdirSync(saves, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* keine Welten */ }
    for (const folder of folders) {
      const level = path.join(saves, folder, 'level.dat');
      let st;
      try { st = fs.statSync(level); } catch { continue; }
      let name = folder;
      let time = st.mtimeMs;
      try {
        const data = readNbt(zlib.gunzipSync(fs.readFileSync(level))).Data || {};
        if (typeof data.LevelName === 'string' && data.LevelName) name = data.LevelName;
        if (data.LastPlayed > 0) time = data.LastPlayed;
      } catch { /* Ordnername und Änderungszeit genügen */ }
      items.push({ ...base, kind: 'world', id: folder, name, time, direct: canQuick, icon: pngDataUrl(path.join(saves, folder, 'icon.png')) });
    }
    // Server: Liste aus dem Spiel plus eigene Zeitstempel
    importQuickPlayLog(inst.id);
    const hist = readRecent(inst.id).servers;
    const servers = new Map();
    try {
      const list = readNbt(fs.readFileSync(path.join(dir, 'servers.dat'))).servers || [];
      for (const s of list) {
        if (!s || typeof s.ip !== 'string' || !SERVER_RE.test(s.ip)) continue;
        const icon = typeof s.icon === 'string' && s.icon.length < 200000 && /^[A-Za-z0-9+/=]+$/.test(s.icon) ? 'data:image/png;base64,' + s.icon : null;
        servers.set(s.ip, { name: s.name || s.ip, time: 0, icon });
      }
    } catch { /* keine Serverliste */ }
    for (const [address, h] of Object.entries(hist)) {
      if (!SERVER_RE.test(address)) continue;
      const cur = servers.get(address) || { name: h.name || address, icon: null };
      servers.set(address, { ...cur, time: h.time || 0 });
    }
    for (const [address, s] of servers) {
      items.push({ ...base, kind: 'server', id: address, name: s.name, address, time: s.time, direct: true, icon: s.icon });
    }
  }
  return items.sort((a, b) => b.time - a.time).slice(0, 10);
}
function quickArgs(inst, info, quick) {
  const args = info.quickPlay ? ['--quickPlayPath', 'quickPlay/log.json'] : [];
  if (!quick) return args;
  const target = String(quick.target || '');
  if (quick.type === 'world') {
    if (target !== path.basename(target) || !fs.existsSync(path.join(instDir(inst.id), 'saves', target, 'level.dat'))) {
      throw new Error('Diese Welt gibt es nicht mehr.');
    }
    if (info.quickPlay) args.push('--quickPlaySingleplayer', target);
    else log('Diese Minecraft-Version kann nicht direkt in eine Welt starten, die Instanz wird normal geöffnet.');
  } else if (quick.type === 'server') {
    if (!SERVER_RE.test(target)) throw new Error('Ungültige Serveradresse');
    if (info.quickPlay) {
      args.push('--quickPlayMultiplayer', target);
    } else {
      const m = /^(.*?)(?::(\d+))?$/.exec(target);
      args.push('--server', m[1], '--port', m[2] || '25565');
    }
    noteServer(inst.id, target);
  } else {
    throw new Error('Unbekanntes Schnellstart-Ziel');
  }
  return args;
}

// ---------- launch ----------
async function launch(id, quick) {
  if (running.has(id)) throw new Error('Diese Instanz läuft bereits');
  const inst = getInstance(id);
  const status = (text, done, total) => send('progress', { id, text, done, total });
  running.set(id, null);
  send('state', { id, running: true });
  try {
    status('Anmeldung wird geprüft', 0, 0);
    const { auth: authorization, offline } = await getLaunchAuth();
    let info;
    try {
      info = await versionInfo(inst.version);
      inst.versionInfo = info;
    } catch (e) {
      if (!inst.versionInfo) {
        throw new Error(offline ? 'Diese Instanz muss einmal mit Internetverbindung gestartet werden, bevor sie offline läuft.' : errMsg(e));
      }
      info = inst.versionInfo;
    }
    const javaPath = await ensureJava(info.javaMajor, status);
    const version = { number: inst.version, type: info.type };
    if (inst.loader === 'fabric') {
      status('Fabric wird vorbereitet', 0, 0);
      version.custom = await ensureFabric(inst);
    }
    const cfg = getConfig();
    const client = new Client();
    // Launcher-Protokoll zusätzlich in die Instanz schreiben, damit Startprobleme nachvollziehbar bleiben.
    const logDir = path.join(instDir(id), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const fileLog = fs.createWriteStream(path.join(logDir, 'launcher.log'));
    const both = (l) => { log(l); fileLog.write(String(l).trimEnd() + '\n'); };
    client.on('debug', both);
    client.on('data', both);
    client.on('progress', (p) => status(`Lade ${p.type}`, p.task, p.total));
    client.on('close', (code) => {
      running.delete(id);
      both(`Minecraft beendet (Code ${code})`);
      fileLog.end();
      importQuickPlayLog(id);
      send('state', { id, running: false });
    });
    status('Spieldateien werden geprüft', 0, 0);
    const child = await client.launch({
      authorization,
      root: META,
      version,
      javaPath,
      memory: { max: `${cfg.memoryMax}G`, min: '1G' },
      customArgs: resolveJvmArgs(info.jvmArgs, inst.version),
      customLaunchArgs: quickArgs(inst, info, quick),
      overrides: { gameDirectory: instDir(id), cwd: instDir(id), detached: false },
    });
    if (!child) throw new Error('Minecraft konnte nicht gestartet werden (siehe Protokoll).');
    running.set(id, child);
    inst.lastPlayed = Date.now();
    saveInstance(inst);
    send('progress', { id, text: '', done: 0, total: 0, finished: true });
  } catch (e) {
    running.delete(id);
    send('state', { id, running: false });
    send('progress', { id, text: '', done: 0, total: 0, finished: true });
    throw e;
  }
}
function stop(id) {
  const child = running.get(checkId(id));
  if (child) child.kill();
}

// ---------- modrinth ----------
const MR = 'https://api.modrinth.com/v2';
function checkType(type) {
  if (!CONTENT_DIRS[type]) throw new Error('Unbekannter Inhaltstyp');
  return type;
}
async function searchContent({ id, type, query, offset }) {
  const inst = getInstance(id);
  checkType(type);
  const facets = [[`project_type:${type}`], [`versions:${inst.version}`]];
  if (type === 'mod') facets.push([`categories:${inst.loader}`]);
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
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) throw new Error('Ungültige Projekt-ID');
  const params = new URLSearchParams({ game_versions: JSON.stringify([inst.version]) });
  if (type === 'mod') params.set('loaders', JSON.stringify([inst.loader]));
  const versions = await getJson(`${MR}/project/${projectId}/version?${params}`);
  if (!versions.length) throw new Error(`Keine passende Version für Minecraft ${inst.version} gefunden`);
  const v = versions[0];
  const file = v.files.find((f) => f.primary) || v.files[0];
  const dest = path.join(instDir(inst.id), CONTENT_DIRS[type], path.basename(file.filename));
  if (!fs.existsSync(dest)) {
    log(`Installiere ${file.filename}`);
    await download(file.url, dest);
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
function listContent(id, type) {
  const dir = path.join(instDir(id), CONTENT_DIRS[checkType(type)]);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => f.name)
    .sort((a, b) => a.localeCompare(b));
}
async function removeContent(id, type, file) {
  await fsp.rm(path.join(instDir(id), CONTENT_DIRS[checkType(type)], path.basename(String(file))), { force: true });
}

// ---------- skin ----------
function decodeSkin(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  const buf = m && Buffer.from(m[1], 'base64');
  const valid = buf && buf.length > 24 && buf.length < 200000 && buf.readUInt32BE(0) === 0x89504e47 &&
    buf.readUInt32BE(16) === 64 && buf.readUInt32BE(20) === 64;
  if (!valid) throw new Error('Ungültige Skin-Datei');
  return buf;
}
async function saveSkin(dataUrl) {
  const png = decodeSkin(dataUrl);
  const res = await dialog.showSaveDialog(win, {
    title: 'Skin speichern',
    defaultPath: path.join(app.getPath('pictures'), 'nova-skin.png'),
    filters: [{ name: 'PNG-Bild', extensions: ['png'] }],
  });
  if (res.canceled || !res.filePath) return null;
  await fsp.writeFile(res.filePath, png);
  return res.filePath;
}
async function uploadSkin(dataUrl) {
  const png = decodeSkin(dataUrl);
  const { auth, offline } = await getLaunchAuth();
  if (offline) throw new Error('Zum Hochladen wird eine Internetverbindung benötigt (Offline-Modus ausschalten).');
  const form = new FormData();
  form.append('variant', 'classic');
  form.append('file', new Blob([png], { type: 'image/png' }), 'skin.png');
  let res;
  try {
    res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.access_token}`, 'User-Agent': UA },
      body: form,
    });
  } catch {
    throw new Error(NO_NET);
  }
  if (!res.ok) throw new Error(`Skin-Upload fehlgeschlagen (Status ${res.status})`);
}

// ---------- ipc ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      log(`Fehler: ${errMsg(e)}`);
      return { ok: false, error: errMsg(e) };
    }
  });
}
handle('skin:save', (dataUrl) => saveSkin(dataUrl));
handle('skin:upload', (dataUrl) => uploadSkin(dataUrl));
handle('account:get', () => publicAccount());
handle('account:login', () => login());
handle('account:logout', () => fsp.rm(ACCOUNT_FILE, { force: true }));
handle('config:get', () => ({ ...getConfig(), online: net.isOnline() }));
handle('config:set', (patch) => setConfig(patch));
handle('versions:list', () => listVersions());
handle('instances:list', () => listInstances());
handle('instances:create', (opts) => createInstance(opts || {}));
handle('instances:delete', (id) => deleteInstance(id));
handle('instances:openFolder', (id) => {
  const dir = instDir(id);
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
handle('game:launch', (id, quick) => launch(id, quick || null));
handle('recent:list', () => listRecent());
handle('game:stop', (id) => stop(id));
handle('content:search', (opts) => searchContent(opts || {}));
handle('content:install', ({ id, type, projectId }) => installContent(getInstance(id), checkType(type), String(projectId), new Set()));
handle('content:list', ({ id, type }) => listContent(id, type));
handle('content:remove', ({ id, type, file }) => removeContent(id, type, file));

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1117',
    title: 'Nova Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

if (!DEV_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
