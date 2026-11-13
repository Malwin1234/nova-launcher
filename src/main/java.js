// Java-Laufzeit (Eclipse Temurin): vorhandene JRE finden oder passend zur Minecraft-Version herunterladen.
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const AdmZip = require('adm-zip');
const { JAVA, log, download } = require('./core');

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

module.exports = { findJavaw, ensureJava };
