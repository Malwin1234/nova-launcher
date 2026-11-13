// Start des Hauptprozesses: Einzelinstanz-Sperre, Fenster, Laden der Funktionsmodule.
// Die eigentliche Logik liegt in src/main/*.js; jedes Modul registriert beim Laden seine eigenen IPC-Handler.
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

// Jedes Modul einzeln laden: ein fehlerhaftes Modul darf den Start des Launchers nicht verhindern.
const MODULES = ['core', 'account', 'versions', 'java', 'loaders', 'instances', 'recent', 'launch', 'content', 'skin', 'modpacks', 'updater'];
const loaded = {};
for (const name of MODULES) {
  try {
    loaded[name] = require(`./main/${name}`);
  } catch (e) {
    console.error(`Modul "${name}" konnte nicht geladen werden:`, e);
  }
}
const core = loaded.core;
const DEV_TEST = core ? core.DEV_TEST : !app.isPackaged && process.env.NOVA_TEST === '1';

// ---------- window ----------
let win = null;
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
  if (core) core.setWindow(win);
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
