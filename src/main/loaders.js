// Mod-Loader: bereitet das Versionsprofil des Loaders vor (derzeit nur Fabric).
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { META, getJson, isOffline } = require('./core');

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

module.exports = { ensureFabric };
