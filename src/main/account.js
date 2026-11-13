// Microsoft-Konto: verschlüsselt speichern, anmelden, Startanmeldung (online oder offline) liefern.
const { safeStorage } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const { Auth } = require('msmc');
const { DATA, ACCOUNT_FILE, DEV_TEST, isOffline, log, handle } = require('./core');

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

handle('account:get', () => publicAccount());
handle('account:login', () => login());
handle('account:logout', () => fsp.rm(ACCOUNT_FILE, { force: true }));

module.exports = { loadAccount, saveAccount, publicAccount, login, offlineAuth, getLaunchAuth };
