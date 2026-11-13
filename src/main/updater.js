// Auto-Updates des Launchers (electron-updater, GitHub-Releases von Malwin1234/nova-launcher).
// Aktiv nur im installierten Launcher. Es wird nie automatisch heruntergeladen und nie neu gestartet, solange ein Spiel läuft.
// IPC: updater:status, updater:check, updater:download, updater:install, updater:openReleases; Ereignis "updater" mit dem Status.
const { app, shell } = require('electron');
const core = require('./core');

const RELEASES_URL = 'https://github.com/Malwin1234/nova-launcher/releases';
const MSG_DEV = 'Updates sind nur im installierten Launcher verfügbar.';
const MSG_UNREACHABLE = 'Update-Prüfung nicht möglich (Update-Quelle nicht erreichbar).';
const MSG_GAME_RUNNING = 'Minecraft läuft noch. Beende das Spiel – danach kann das Update installiert werden.';

// Nur für automatische Tests in der Entwicklung: NOVA_UPDATE_CONFIG zeigt auf eine eigene Update-Konfiguration (lokaler Testserver).
const TEST_CONFIG = core.DEV_TEST && process.env.NOVA_UPDATE_CONFIG ? process.env.NOVA_UPDATE_CONFIG : null;
const ACTIVE = app.isPackaged || !!TEST_CONFIG;

// state: disabled | idle | checking | none | available | downloading | downloaded | offline | error
const status = {
  state: ACTIVE ? 'idle' : 'disabled',
  active: ACTIVE,
  currentVersion: currentVersion(),
  warn: false,
  version: null,
  percent: 0,
  notes: '',
  message: ACTIVE ? 'Noch nicht nach Updates gesucht.' : MSG_DEV,
};
let updater = null;
// Im installierten Launcher ist app.getVersion() die Version aus package.json; beim Start über ein Testskript wäre es die Electron-Version.
function currentVersion() {
  if (app.isPackaged) return app.getVersion();
  try { return require("../../package.json").version || app.getVersion(); } catch { return app.getVersion(); }
}
let busy = null; // laufende Prüfung bzw. laufender Download

function publish(patch) {
  Object.assign(status, { warn: false }, patch);
  core.send('updater', { ...status });
  return { ...status };
}
function logLine(text) {
  core.log(`[Update] ${String(text).split('\n')[0].slice(0, 400)}`);
}
function gameRunning() {
  try {
    const running = require('./instances').running;
    return !!running && running.size > 0;
  } catch {
    return false;
  }
}
// Versionshinweise kommen von GitHub als HTML; angezeigt wird nur reiner Text.
function plainNotes(notes) {
  if (Array.isArray(notes)) notes = notes.map((n) => (n && n.note) || '').join('\n\n');
  if (typeof notes !== 'string') return '';
  return notes
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|ul|ol|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3000);
}

function getUpdater() {
  if (updater) return updater;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = {
    info: (m) => logLine(m),
    warn: (m) => logLine(`Warnung: ${m}`),
    error: (m) => logLine(`Fehler: ${m}`),
    debug: () => {},
  };
  if (TEST_CONFIG) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.updateConfigPath = TEST_CONFIG;
  }
  autoUpdater.on('download-progress', (p) => {
    if (status.state !== 'downloading') return;
    const percent = Math.max(0, Math.min(100, Math.round(p.percent || 0)));
    publish({ percent, message: `Version ${status.version} wird heruntergeladen … ${percent} %` });
  });
  // Fehler werden an den Aufrufstellen (check/download) behandelt; ohne diesen Listener würde EventEmitter sie werfen.
  autoUpdater.on('error', () => {});
  updater = autoUpdater;
  return updater;
}

async function check() {
  if (!ACTIVE) return publish({ state: 'disabled', message: MSG_DEV });
  if (busy) return busy;
  if (status.state === 'downloaded') return { ...status };
  if (core.getConfig().offlineMode) {
    return publish({ state: 'offline', version: null, notes: '', message: 'Offline-Modus aktiv – es wird nicht nach Updates gesucht.' });
  }
  if (core.isOffline()) {
    return publish({ state: 'offline', version: null, notes: '', message: 'Keine Internetverbindung – Update-Prüfung übersprungen.' });
  }
  busy = (async () => {
    publish({ state: 'checking', percent: 0, message: 'Suche nach Updates …' });
    try {
      const result = await getUpdater().checkForUpdates();
      const info = result && result.updateInfo;
      if (result && result.isUpdateAvailable && info) {
        return publish({
          state: 'available',
          version: info.version,
          notes: plainNotes(info.releaseNotes),
          message: `Version ${info.version} ist verfügbar.`,
        });
      }
      return publish({ state: 'none', version: null, notes: '', message: `Nova Launcher ist aktuell (Version ${status.currentVersion}).` });
    } catch (e) {
      logLine(`Update-Prüfung fehlgeschlagen: ${core.errMsg(e)}`);
      return publish({ state: 'error', version: null, notes: '', message: MSG_UNREACHABLE });
    }
  })();
  try {
    return await busy;
  } finally {
    busy = null;
  }
}

async function download() {
  if (!ACTIVE) return publish({ state: 'disabled', message: MSG_DEV });
  if (busy) return busy;
  if (status.state !== 'available') return { ...status };
  if (core.isOffline()) {
    return publish({ message: `Version ${status.version} ist verfügbar. Zum Herunterladen wird eine Internetverbindung benötigt (Offline-Modus aus).` });
  }
  const version = status.version;
  busy = (async () => {
    publish({ state: 'downloading', percent: 0, message: `Version ${version} wird heruntergeladen …` });
    try {
      await getUpdater().downloadUpdate();
      return publish({
        state: 'downloaded',
        percent: 100,
        message: `Version ${version} ist bereit. Sie wird beim nächsten Beenden des Launchers installiert – oder sofort per Neustart.`,
      });
    } catch (e) {
      logLine(`Download des Updates fehlgeschlagen: ${core.errMsg(e)}`);
      return publish({ state: 'available', percent: 0, message: `Version ${version} ist verfügbar. Der Download ist fehlgeschlagen – bitte später erneut versuchen.` });
    }
  })();
  try {
    return await busy;
  } finally {
    busy = null;
  }
}

function install() {
  if (!ACTIVE) return publish({ state: 'disabled', message: MSG_DEV });
  if (status.state !== 'downloaded') return { ...status };
  if (gameRunning()) return { ...publish({ message: MSG_GAME_RUNNING, warn: true }), blocked: true };
  // Im Testmodus (lokaler Testserver, Platzhalter-Installer) wird nichts ausgeführt.
  if (TEST_CONFIG) return { ...status, wouldInstall: true };
  logLine(`Neustart zur Installation von Version ${status.version}`);
  // Kurz verzögert, damit die Antwort noch bei der Oberfläche ankommt. Still installieren, danach den Launcher wieder starten.
  setTimeout(() => {
    try {
      if (gameRunning()) {
        publish({ message: MSG_GAME_RUNNING, warn: true });
        return;
      }
      getUpdater().quitAndInstall(true, true);
    } catch (e) {
      logLine(`Installation konnte nicht gestartet werden: ${core.errMsg(e)}`);
      publish({ warn: true, message: 'Die Installation konnte nicht gestartet werden. Das Update wird beim nächsten Beenden installiert.' });
    }
  }, 300);
  return { ...status };
}

core.handle('updater:status', () => ({ ...status, releasesUrl: RELEASES_URL }));
core.handle('updater:check', () => check());
core.handle('updater:download', () => download());
core.handle('updater:install', () => install());
core.handle('updater:openReleases', async () => {
  if (!core.DEV_TEST) await shell.openExternal(RELEASES_URL);
  return RELEASES_URL;
});

if (ACTIVE) {
  // Läuft beim Beenden noch ein Spiel, wird das Update nicht jetzt installiert (der Installer würde stören),
  // sondern bleibt heruntergeladen und wird beim nächsten Start erneut angeboten.
  app.on('before-quit', () => {
    if (updater && status.state === 'downloaded' && gameRunning()) updater.autoInstallOnAppQuit = false;
  });
  // Stille Prüfung kurz nach dem Start.
  const delay = TEST_CONFIG ? Number(process.env.NOVA_UPDATE_DELAY || 600000) : 6000;
  app.whenReady().then(() => {
    const timer = setTimeout(() => { check().catch(() => {}); }, delay);
    if (timer.unref) timer.unref();
  });
}

module.exports = { check, download, install, getStatus: () => ({ ...status }), RELEASES_URL };
