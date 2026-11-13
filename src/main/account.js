// Microsoft-Konten: mehrere Konten verschlüsselt speichern, anmelden, wechseln, entfernen und die
// Startanmeldung (online oder offline) für das aktive Konto liefern.
//
// Speicherformat (Klartext vor der Verschlüsselung mit safeStorage, Datei account.bin):
//   alt (bis 1.3.0): { refresh, name, uuid }
//   neu:             { version: 2, active: "<uuid>", accounts: [{ refresh, name, uuid }, ...] }
// Eine Datei im alten Format wird beim Laden als erstes (aktives) Konto übernommen und erst bei der
// nächsten Änderung im neuen Format geschrieben. Tokens verlassen dieses Modul nie Richtung Oberfläche/Protokoll.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const { DATA, ACCOUNT_FILE, DEV_TEST, isOffline, log, handle } = require('./core');

const BROKEN_FILE = ACCOUNT_FILE + '.defekt';
const NO_ACCOUNT = 'Bitte einmal mit einem Microsoft-Konto anmelden. Danach kannst du auch offline spielen.';

// ---------- reine Speicherlogik (ohne Electron testbar) ----------
const normUuid = (u) => (typeof u === 'string' ? u.replace(/-/g, '').toLowerCase() : '');
function checkUuid(u) {
  const n = normUuid(u);
  if (!/^[0-9a-f]{32}$/.test(n)) throw new Error('Ungültige Konto-ID');
  return n;
}
function validAccount(a) {
  return !!a && typeof a === 'object' && !!a.refresh && typeof a.name === 'string' && a.name !== '' && typeof a.uuid === 'string' && a.uuid !== '';
}
const cleanAccount = (a) => ({ refresh: a.refresh, name: a.name, uuid: a.uuid });
function emptyStore() {
  return { version: 2, active: null, accounts: [] };
}
function findAccount(store, uuid) {
  const n = normUuid(uuid);
  return n ? store.accounts.find((a) => normUuid(a.uuid) === n) || null : null;
}
function activeOf(store) {
  return findAccount(store, store.active) || store.accounts[0] || null;
}
// Beliebiges entschlüsseltes JSON in einen gültigen Speicher umwandeln (inklusive Migration des alten Formats).
function normalizeStore(raw) {
  const store = emptyStore();
  if (!raw || typeof raw !== 'object') return store;
  let list = [];
  if (Array.isArray(raw.accounts)) list = raw.accounts;
  else if (validAccount(raw)) list = [raw]; // altes Einzelkonto-Format
  for (const a of list) {
    if (validAccount(a) && !findAccount(store, a.uuid)) store.accounts.push(cleanAccount(a));
  }
  const act = findAccount(store, raw.active) || store.accounts[0] || null;
  store.active = act ? act.uuid : null;
  return store;
}
function parseStore(text) {
  return normalizeStore(JSON.parse(text));
}
// Konto hinzufügen oder (bei gleicher UUID) aktualisieren.
function upsertAccount(store, acc, makeActive) {
  if (!validAccount(acc)) throw new Error('Ungültige Kontodaten');
  const n = normUuid(acc.uuid);
  let found = false;
  const accounts = store.accounts.map((a) => {
    if (normUuid(a.uuid) !== n) return a;
    found = true;
    return cleanAccount(acc);
  });
  if (!found) accounts.push(cleanAccount(acc));
  const active = makeActive || !findAccount({ accounts }, store.active) ? acc.uuid : store.active;
  return { version: 2, active, accounts };
}
// Token/Name eines vorhandenen Kontos aktualisieren; ein inzwischen entferntes Konto wird nicht wieder angelegt.
function updateAccount(store, uuid, patch) {
  const n = normUuid(uuid);
  return { ...store, accounts: store.accounts.map((a) => (normUuid(a.uuid) === n ? { ...a, ...patch, uuid: a.uuid } : a)) };
}
function switchActive(store, uuid) {
  const acc = findAccount(store, uuid);
  if (!acc) throw new Error('Dieses Konto ist nicht (mehr) angemeldet.');
  return { ...store, active: acc.uuid };
}
function removeAccountFrom(store, uuid) {
  const acc = findAccount(store, uuid);
  if (!acc) throw new Error('Dieses Konto ist nicht (mehr) angemeldet.');
  const accounts = store.accounts.filter((a) => a !== acc);
  const wasActive = activeOf(store) === acc;
  const next = wasActive ? accounts[0] || null : activeOf(store);
  return { version: 2, active: next ? next.uuid : null, accounts };
}
function publicList(store) {
  const act = activeOf(store);
  return store.accounts.map((a) => ({ name: a.name, uuid: a.uuid, active: a === act }));
}
function publicOf(acc) {
  return acc ? { name: acc.name, uuid: acc.uuid } : null;
}

// ---------- verschlüsselte Datei ----------
let cache = null; // geladener Speicher; null, solange noch nicht geladen
let unreadable = false; // Datei vorhanden, aber nicht lesbar: vor dem ersten Überschreiben sichern
let queue = Promise.resolve(); // Schreibzugriffe nacheinander

async function decrypt(buf) {
  try {
    let res = await safeStorage.decryptStringAsync(buf);
    if (res && res.shouldReEncrypt) res = await safeStorage.decryptStringAsync(buf);
    return { text: res.result, reEncrypt: !!res.shouldReEncrypt };
  } catch {
    // Rückfall auf die alte synchrone Schnittstelle, damit ein bestehendes Konto in keinem Fall verloren geht.
    return { text: safeStorage.decryptString(buf), reEncrypt: false };
  }
}
async function readStoreFile() {
  let buf;
  try {
    buf = await fsp.readFile(ACCOUNT_FILE);
  } catch (e) {
    if (e && e.code !== 'ENOENT') unreadable = true;
    return emptyStore();
  }
  try {
    const { text } = await decrypt(buf);
    unreadable = false;
    return parseStore(text);
  } catch {
    unreadable = true;
    console.error('Kontospeicher (account.bin) ist nicht lesbar und wird ignoriert.');
    return emptyStore();
  }
}
async function writeStoreFile(store) {
  if (!store.accounts.length) {
    await fsp.rm(ACCOUNT_FILE, { force: true });
    await fsp.rm(BROKEN_FILE, { force: true });
    unreadable = false;
    return;
  }
  let available = false;
  try { available = await safeStorage.isAsyncEncryptionAvailable(); } catch { /* unten gemeldet */ }
  if (!available) throw new Error('Sichere Speicherung ist auf diesem System nicht verfügbar');
  const data = await safeStorage.encryptStringAsync(JSON.stringify(store));
  await fsp.mkdir(DATA, { recursive: true });
  if (unreadable) {
    // Unlesbare Datei nicht stillschweigend vernichten (sie bleibt verschlüsselt bzw. unlesbar).
    try { await fsp.copyFile(ACCOUNT_FILE, BROKEN_FILE); } catch { /* nichts zu sichern */ }
  }
  const tmp = ACCOUNT_FILE + '.tmp';
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, ACCOUNT_FILE);
  unreadable = false;
}

// Einmal beim Start laden (safeStorage braucht "ready"); danach beantwortet der Zwischenspeicher alle Lesezugriffe synchron.
const ready = app.whenReady().then(async () => {
  try {
    cache = await readStoreFile();
  } catch {
    cache = emptyStore();
  }
});
ready.catch(() => {});

// Nur für den seltenen Fall, dass jemand synchron liest, bevor das Laden fertig ist.
function readStoreSyncFallback() {
  try {
    if (!app.isReady()) return emptyStore();
    return parseStore(safeStorage.decryptString(fs.readFileSync(ACCOUNT_FILE)));
  } catch {
    return emptyStore();
  }
}
function currentStore() {
  return cache || readStoreSyncFallback();
}
// Änderung anwenden: erst speichern, dann den Zwischenspeicher umstellen. fn bekommt den aktuellen Speicher.
function mutate(fn) {
  const job = queue.then(async () => {
    await ready;
    const next = normalizeStore(fn(cache || emptyStore()));
    await writeStoreFile(next);
    cache = next;
    return next;
  });
  queue = job.catch(() => {});
  return job;
}

// ---------- öffentliche Funktionen ----------
function loadAccount() {
  return activeOf(currentStore());
}
function publicAccount() {
  return publicOf(loadAccount());
}
function listAccounts() {
  return publicList(currentStore());
}
async function saveAccount(acc, makeActive = true) {
  await mutate((s) => upsertAccount(s, acc, makeActive));
}
async function switchAccount(uuid) {
  const id = checkUuid(uuid);
  await mutate((s) => switchActive(s, id));
  return publicAccount();
}
async function removeAccount(uuid) {
  const id = checkUuid(uuid);
  await mutate((s) => removeAccountFrom(s, id));
  return publicAccount();
}
async function logout() {
  await ready;
  const acc = loadAccount();
  if (!acc) {
    // Kein lesbares Konto: Reste (auch eine unlesbare Datei) wegräumen, wie es "Abmelden" bisher tat.
    await mutate(() => emptyStore());
    return null;
  }
  await mutate((s) => (findAccount(s, acc.uuid) ? removeAccountFrom(s, acc.uuid) : s));
  return publicAccount();
}

// ---------- Anmeldung ----------
// msmc wirft Zeichenketten ("error.gui.closed") oder { response, ts }. Daraus eine deutsche Meldung machen;
// die Objekte selbst werden nie ausgegeben.
function msmcCode(e) {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && typeof e.ts === 'string') return e.ts;
  return '';
}
function msmcStatus(e) {
  const s = e && typeof e === 'object' && e.response && e.response.status;
  return Number.isInteger(s) ? s : 0;
}
function authErrorText(e) {
  const code = msmcCode(e);
  const status = msmcStatus(e);
  if (code.startsWith('error.gui.closed')) return 'Die Anmeldung wurde abgebrochen.';
  if (code === 'error.auth.xsts.userNotFound') return 'Dieses Microsoft-Konto hat kein Xbox-Profil. Bitte zuerst auf xbox.com ein Profil anlegen.';
  if (code === 'error.auth.xsts.bannedCountry') return 'Xbox Live ist im Land dieses Microsoft-Kontos nicht verfügbar.';
  if (code.startsWith('error.auth.xsts.child')) return 'Dieses Konto ist ein Kinderkonto und muss zuerst von einem Erwachsenen einer Microsoft-Familie hinzugefügt werden.';
  if (code === 'error.auth.minecraft.profile') return 'Für dieses Microsoft-Konto wurde kein Minecraft-Profil gefunden. Besitzt das Konto Minecraft: Java Edition?';
  if (status >= 500) return `Der Anmeldedienst ist gerade gestört (Fehler ${status}). Bitte später noch einmal versuchen.`;
  if (code === 'error.auth.microsoft') return 'Die Anmeldung bei Microsoft ist fehlgeschlagen.';
  if (code === 'error.auth.xboxLive' || code.startsWith('error.auth.xsts')) return 'Die Anmeldung bei Xbox Live ist fehlgeschlagen.';
  if (code.startsWith('error.auth.minecraft')) return 'Die Anmeldung bei Minecraft ist fehlgeschlagen.';
  if (code) return 'Die Anmeldung ist fehlgeschlagen.';
  return '';
}
// Abgelaufene oder widerrufene Anmeldung: Microsoft lehnt das gespeicherte Token ab (HTTP 400/401).
function isExpiredLogin(e) {
  const status = msmcStatus(e);
  return msmcCode(e) === 'error.auth.microsoft' && status >= 400 && status < 500;
}
function expiredText(acc) {
  return `Die Anmeldung für das Konto „${acc.name}“ ist abgelaufen. Bitte melde dich mit diesem Konto erneut an (Konto-Menü unten links → „Konto hinzufügen“).`;
}

let loginRunning = null;
function login() {
  if (!loginRunning) {
    loginRunning = (async () => {
      const { Auth } = require('msmc');
      let acc;
      try {
        const xbox = await new Auth('select_account').launch('electron');
        const mc = await xbox.getMinecraft();
        acc = { refresh: xbox.save(), name: mc.profile.name, uuid: mc.profile.id };
      } catch (e) {
        const text = authErrorText(e);
        if (text) throw new Error(text);
        throw e instanceof Error ? e : new Error('Die Anmeldung ist fehlgeschlagen.');
      }
      await saveAccount(acc, true);
      return publicAccount();
    })().finally(() => { loginRunning = null; });
  }
  return loginRunning;
}

function offlineAuth(acc) {
  // Start ohne Anmeldeserver: Einzelspieler und LAN funktionieren, Online-Server nicht.
  return { access_token: '0', client_token: '0', uuid: acc.uuid, name: acc.name, user_properties: '{}', meta: { type: 'mojang' } };
}
async function refreshOnline(refreshToken) {
  const { Auth } = require('msmc');
  const xbox = await new Auth('select_account').refresh(refreshToken);
  const mc = await xbox.getMinecraft();
  return { refresh: xbox.save(), name: mc.profile.name, auth: mc.mclc() };
}
async function netReachable() {
  try {
    await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}
// Startanmeldung für das aktive Konto. Die Abhängigkeiten sind austauschbar, damit die Logik ohne Netz testbar ist.
async function resolveLaunchAuth(deps = {}) {
  const refresh = deps.refresh || refreshOnline;
  const offline = deps.offline || isOffline;
  const reachable = deps.reachable || netReachable;
  await ready;
  const acc = loadAccount();
  if (!acc) throw new Error(NO_ACCOUNT);
  if (offline()) {
    log('Offline-Modus: Start ohne Anmeldeserver (nur Einzelspieler und LAN).');
    return { auth: offlineAuth(acc), offline: true };
  }
  let fresh;
  try {
    fresh = await refresh(acc.refresh);
  } catch (e) {
    if (isExpiredLogin(e)) throw new Error(expiredText(acc));
    // Nur bei fehlender Verbindung offline weitermachen, nicht bei abgelehnter Anmeldung.
    if (!msmcStatus(e) && !(await reachable())) {
      log('Anmeldeserver nicht erreichbar, starte offline (nur Einzelspieler und LAN).');
      return { auth: offlineAuth(acc), offline: true };
    }
    const text = authErrorText(e);
    if (text) throw new Error(`${text} (Konto „${acc.name}“)`);
    throw e instanceof Error ? e : new Error(`Die Anmeldung für das Konto „${acc.name}“ ist fehlgeschlagen.`);
  }
  try {
    const patch = { refresh: fresh.refresh || acc.refresh };
    if (typeof fresh.name === 'string' && fresh.name) patch.name = fresh.name;
    await mutate((s) => updateAccount(s, acc.uuid, patch));
  } catch {
    log('Hinweis: Die erneuerte Anmeldung konnte nicht gespeichert werden.');
  }
  return { auth: fresh.auth, offline: false };
}
async function getLaunchAuth() {
  if (DEV_TEST) return { auth: offlineAuth({ uuid: '00000000000000000000000000000000', name: 'Tester' }), offline: true };
  return resolveLaunchAuth();
}

// ---------- ipc ----------
handle('account:get', async () => { await ready; return publicAccount(); });
handle('account:list', async () => { await ready; return listAccounts(); });
handle('account:login', () => login());
handle('account:logout', () => logout());
handle('account:switch', (uuid) => switchAccount(uuid));
handle('account:remove', (uuid) => removeAccount(uuid));

module.exports = {
  loadAccount, saveAccount, publicAccount, listAccounts, switchAccount, removeAccount, logout, login, offlineAuth, getLaunchAuth,
  ready,
  // Für Tests: reine Speicherlogik und die Startanmeldung mit austauschbaren Abhängigkeiten.
  _test: {
    normalizeStore, parseStore, upsertAccount, updateAccount, switchActive, removeAccountFrom, publicList, checkUuid,
    authErrorText, isExpiredLogin, resolveLaunchAuth,
    reload: () => mutateReload(),
  },
};
// Speicherdatei neu einlesen (nur Tests: nachdem ein Test die Datei von außen ersetzt hat).
function mutateReload() {
  const job = queue.then(async () => {
    await ready;
    cache = await readStoreFile();
  });
  queue = job.catch(() => {});
  return job;
}
