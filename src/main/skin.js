// Skin: PNG aus dem Editor prüfen, als Datei speichern oder auf das Minecraft-Konto hochladen.
const { app, dialog } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const { UA, NO_NET, getWindow, handle } = require('./core');
const { getLaunchAuth } = require('./account');

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
  const res = await dialog.showSaveDialog(getWindow(), {
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

handle('skin:save', (dataUrl) => saveSkin(dataUrl));
handle('skin:upload', (dataUrl) => uploadSkin(dataUrl));

module.exports = { decodeSkin, saveSkin, uploadSkin };
