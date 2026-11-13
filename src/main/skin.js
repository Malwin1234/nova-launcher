// Skin: PNG aus dem Editor prüfen, als Datei speichern oder auf das Minecraft-Konto hochladen,
// Skin-Dateien importieren und den aktuellen Skin eines Kontos von Mojang laden.
const { app, dialog } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const { UA, NO_NET, getWindow, handle, request, isOffline } = require('./core');

const MAX_BYTES = 200000;
const VARIANTS = ['classic', 'slim'];
// Das Konto-Modul erst beim Aufruf laden: so funktioniert der Skin-Editor auch, wenn es gerade nicht geladen werden kann.
function account() {
  try {
    return require('./account');
  } catch {
    throw new Error('Die Kontoverwaltung ist gerade nicht verfügbar.');
  }
}

// ---------- PNG prüfen ----------
// Liest Breite/Höhe aus dem IHDR-Block; wirft bei allem, was kein PNG ist.
function pngSize(buf) {
  const ok = Buffer.isBuffer(buf) && buf.length > 32 &&
    buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a && buf.toString('latin1', 12, 16) === 'IHDR';
  if (!ok) throw new Error('Das ist keine PNG-Datei. Skins müssen als PNG vorliegen.');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
// Skin zum Bearbeiten: 64×64 oder das alte Format 64×32 (wird im Editor auf 64×64 umgerechnet).
function checkImport(buf) {
  if (buf.length > MAX_BYTES) throw new Error('Die Datei ist zu groß für einen Minecraft-Skin.');
  const { width, height } = pngSize(buf);
  if (width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error(`Der Skin muss 64×64 oder 64×32 Pixel groß sein (diese Datei hat ${width}×${height}).`);
  }
  return { dataUrl: `data:image/png;base64,${buf.toString('base64')}`, width, height };
}
function decodeSkin(dataUrl) {
  const m = typeof dataUrl === 'string' && dataUrl.length < MAX_BYTES * 1.4 && /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  const buf = m && Buffer.from(m[1], 'base64');
  let valid = false;
  try {
    const size = buf && buf.length < MAX_BYTES && pngSize(buf);
    valid = !!size && size.width === 64 && size.height === 64;
  } catch { /* ungültig */ }
  if (!valid) throw new Error('Ungültige Skin-Datei');
  return buf;
}
function checkVariant(variant) {
  if (!VARIANTS.includes(variant)) throw new Error('Ungültiges Skin-Modell (erlaubt: classic, slim).');
  return variant;
}

// ---------- Speichern / Hochladen ----------
async function saveSkin(dataUrl, filePath) {
  const png = decodeSkin(dataUrl);
  if (!filePath) {
    const res = await dialog.showSaveDialog(getWindow(), {
      title: 'Skin speichern',
      defaultPath: path.join(app.getPath('pictures'), 'nova-skin.png'),
      filters: [{ name: 'PNG-Bild', extensions: ['png'] }],
    });
    if (res.canceled || !res.filePath) return null;
    filePath = res.filePath;
  }
  await fsp.writeFile(filePath, png);
  return filePath;
}
async function uploadSkin(dataUrl, variant) {
  const png = decodeSkin(dataUrl);
  checkVariant(variant);
  const { auth, offline } = await account().getLaunchAuth();
  if (offline) throw new Error('Zum Hochladen wird eine Internetverbindung benötigt (Offline-Modus ausschalten).');
  const form = new FormData();
  form.append('variant', variant);
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

// ---------- Importieren ----------
// Liefert { dataUrl, width, height, name } oder null (Dialog abgebrochen). Mit filePath ohne Dialog (für Tests).
async function importSkinFile(filePath) {
  if (!filePath) {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Skin-Datei importieren',
      defaultPath: app.getPath('pictures'),
      filters: [{ name: 'PNG-Bild', extensions: ['png'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    filePath = res.filePaths[0];
  }
  let buf;
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('keine Datei');
    if (stat.size > MAX_BYTES) throw Object.assign(new Error('Die Datei ist zu groß für einen Minecraft-Skin.'), { shown: true });
    buf = await fsp.readFile(filePath);
  } catch (e) {
    if (e.shown) throw e;
    throw new Error('Die Datei konnte nicht gelesen werden.');
  }
  return { ...checkImport(buf), name: path.basename(filePath) };
}

// Aktuellen Skin eines Kontos laden: Profil vom Session-Server → "textures"-Eigenschaft → PNG von textures.minecraft.net.
async function fetchAccountSkin(uuid) {
  const id = String(uuid || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('Ungültige Konto-ID.');
  const res = await request(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`);
  if (res.status === 429) throw new Error('Zu viele Anfragen an den Skin-Server. Bitte in einer Minute noch einmal versuchen.');
  if (res.status === 204 || res.status === 400 || res.status === 404) throw new Error('Für dieses Konto wurde kein Minecraft-Profil gefunden.');
  if (!res.ok) throw new Error(`Der Skin konnte nicht abgerufen werden (Status ${res.status}).`);
  let skin;
  let name = '';
  try {
    const profile = await res.json();
    name = typeof profile.name === 'string' ? profile.name : '';
    const prop = (profile.properties || []).find((p) => p && p.name === 'textures');
    skin = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures.SKIN;
  } catch {
    throw new Error('Die Antwort des Skin-Servers konnte nicht gelesen werden.');
  }
  if (!skin || typeof skin.url !== 'string') {
    throw new Error('Dieses Konto verwendet den Standard-Skin. Es gibt keinen eigenen Skin zum Laden.');
  }
  let url;
  try { url = new URL(skin.url); } catch { url = null; }
  if (!url || url.hostname !== 'textures.minecraft.net' || !/^https?:$/.test(url.protocol)) {
    throw new Error('Der Skin-Server hat eine unerwartete Adresse geliefert.');
  }
  url.protocol = 'https:';
  const img = await request(url.href);
  if (!img.ok) throw new Error(`Der Skin konnte nicht heruntergeladen werden (Status ${img.status}).`);
  const buf = Buffer.from(await img.arrayBuffer());
  const model = skin.metadata && skin.metadata.model === 'slim' ? 'slim' : 'classic';
  return { ...checkImport(buf), model, name };
}
async function fetchActiveAccountSkin() {
  const acc = account().publicAccount();
  if (!acc || !acc.uuid) throw new Error('Du bist nicht angemeldet. Melde dich mit deinem Microsoft-Konto an, um deinen Skin zu laden.');
  if (isOffline()) throw new Error('Ohne Internetverbindung (oder im Offline-Modus) kann der Konto-Skin nicht geladen werden.');
  return fetchAccountSkin(acc.uuid);
}

// Die Handler reichen nur die erwarteten Argumente weiter (kein Dateipfad aus der Oberfläche).
handle('skin:save', (dataUrl) => saveSkin(dataUrl));
handle('skin:upload', (dataUrl, variant) => uploadSkin(dataUrl, variant));
handle('skin:import', () => importSkinFile());
handle('skin:fetchAccount', () => fetchActiveAccountSkin());

module.exports = { decodeSkin, saveSkin, uploadSkin, importSkinFile, fetchAccountSkin, fetchActiveAccountSkin, checkVariant };
