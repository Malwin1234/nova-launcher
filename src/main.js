const { app, BrowserWindow, ipcMain, shell, safeStorage, Menu, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { once } = require('events');
const crypto = require('crypto');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const AdmZip = require('adm-zip');

const UA = `NovaLauncher/${app.getVersion()}`;
const DATA = path.join(app.getPath('appData'), 'NovaLauncher');
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
  return { type: v.type, javaMajor: (json.javaVersion && json.javaVersion.majorVersion) || 8 };
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

// ---------- launch ----------
async function launch(id) {
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
    client.on('debug', (l) => log(l));
    client.on('data', (l) => log(l));
    client.on('progress', (p) => status(`Lade ${p.type}`, p.task, p.total));
    client.on('close', (code) => {
      running.delete(id);
      log(`Minecraft beendet (Code ${code})`);
      send('state', { id, running: false });
    });
    status('Spieldateien werden geprüft', 0, 0);
    const child = await client.launch({
      authorization,
      root: META,
      version,
      javaPath,
      memory: { max: `${cfg.memoryMax}G`, min: '1G' },
      overrides: { gameDirectory: instDir(id), detached: false },
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
handle('game:launch', (id) => launch(id));
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

if (!app.requestSingleInstanceLock()) {
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
