// Gemeinsame Grundlage für alle Module des Hauptprozesses: Pfade, Fenster, Protokoll, Netzwerk, Konfiguration, IPC-Wrapper.
const { app, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { once } = require('events');

const UA = `NovaLauncher/${app.getVersion()}`;
// Nur in der Entwicklung (nicht im installierten Launcher): eigener Datenordner und Testanmeldung für automatische Starttests.
const DEV_TEST = !app.isPackaged && process.env.NOVA_TEST === '1';
const DATA = (DEV_TEST && process.env.NOVA_DATA_DIR) || path.join(app.getPath('appData'), 'NovaLauncher');
const META = path.join(DATA, 'meta');
const INSTANCES = path.join(DATA, 'instances');
const JAVA = path.join(DATA, 'java');
const CONFIG_FILE = path.join(DATA, 'config.json');
const ACCOUNT_FILE = path.join(DATA, 'account.bin');

// ---------- window ----------
let win = null;
function setWindow(w) {
  win = w;
}
function getWindow() {
  return win;
}

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

// ---------- ipc ----------
// Jeder Handler antwortet mit { ok: true, data } oder { ok: false, error }; das Preload-Skript packt das wieder aus.
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
handle('config:get', () => ({ ...getConfig(), online: net.isOnline() }));
handle('config:set', (patch) => setConfig(patch));

module.exports = {
  UA, DEV_TEST, DATA, META, INSTANCES, JAVA, CONFIG_FILE, ACCOUNT_FILE, NO_NET,
  setWindow, getWindow, send, log, errMsg,
  request, getJson, download, readJsonSync,
  getConfig, setConfig, isOffline, checkId, instDir,
  handle,
};
