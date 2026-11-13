// Java-Laufzeit (Eclipse Temurin): vorhandene JRE finden oder passend zur Minecraft-Version herunterladen.
// Das heruntergeladene Archiv wird gegen die SHA-256-Prüfsumme aus der Adoptium-API geprüft.
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const AdmZip = require('adm-zip');
const { JAVA, log, getJson } = require('./core');
const { fetchFile } = require('./versions');

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
// Welche Datei mit welcher Prüfsumme: aus der Adoptium-API (nicht aus der Weiterleitung der Binär-Adresse).
async function temurinPackage(major) {
  const list = await getJson(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?os=windows&architecture=x64&image_type=jre`);
  const pkg = Array.isArray(list) && list.map((x) => x && x.binary && x.binary.package).find((p) => p && p.link && p.checksum);
  if (!pkg) throw new Error(`Für Java ${major} wurde keine passende Windows-Version gefunden.`);
  if (!/^https:\/\//.test(pkg.link) || !/\.zip$/i.test(pkg.link)) throw new Error(`Unerwartete Download-Adresse für Java ${major}.`);
  if (!/^[0-9a-f]{64}$/i.test(pkg.checksum)) throw new Error(`Die Prüfsumme für Java ${major} ist ungültig.`);
  return pkg;
}
// onStatus(text, done, total, unit)
async function ensureJava(major, onStatus) {
  major = Number(major) || 8;
  if (major === 16) major = 17; // Temurin bietet keine 16er-JRE an, 17 ist kompatibel
  const dir = path.join(JAVA, String(major));
  let javaw = findJavaw(dir);
  if (javaw) return javaw;
  const label = `Java ${major}`;
  onStatus(label, 0, 0);
  const pkg = await temurinPackage(major);
  const zip = path.join(JAVA, `jre-${major}.zip`);
  log(`Lade Java ${major} herunter (${path.basename(pkg.link)}) ...`);
  let got = 0;
  const total = Number(pkg.size) || 0;
  try {
    await fetchFile(pkg.link, zip, { sha256: pkg.checksum, onBytes: (n) => { got += n; onStatus(label, got, total, 'bytes'); } });
  } catch (e) {
    await fsp.rm(zip, { force: true }).catch(() => {});
    if (e.checksum) {
      throw new Error(`Die heruntergeladene Java-Datei ist beschädigt oder wurde verändert (SHA-256-Prüfsumme stimmt nicht) und wurde gelöscht. Bitte starte noch einmal.`);
    }
    throw e;
  }
  log(`Java ${major}: SHA-256-Prüfsumme stimmt.`);
  onStatus(`${label} wird entpackt`, 0, 0);
  await fsp.rm(dir, { recursive: true, force: true });
  try {
    await new Promise((resolve, reject) => {
      new AdmZip(zip).extractAllToAsync(dir, true, false, (e) => (e ? reject(e) : resolve()));
    });
  } finally {
    await fsp.rm(zip, { force: true }).catch(() => {});
  }
  javaw = findJavaw(dir);
  if (!javaw) throw new Error(`Java ${major} konnte nicht installiert werden`);
  return javaw;
}

module.exports = { findJavaw, ensureJava, temurinPackage };
