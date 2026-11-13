// Inhalte von Modrinth (Mods, Resource Packs, Shader): suchen, installieren, auflisten, entfernen.
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { log, errMsg, getJson, download, instDir, handle } = require('./core');
const { getInstance } = require('./instances');

const CONTENT_DIRS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const MR = 'https://api.modrinth.com/v2';

function checkType(type) {
  if (!CONTENT_DIRS[type]) throw new Error('Unbekannter Inhaltstyp');
  return type;
}
async function searchContent({ id, type, query, offset }) {
  const inst = getInstance(id);
  checkType(type);
  const facets = [[`project_type:${type}`], [`versions:${inst.version}`]];
  if (type === 'mod') facets.push([`categories:${inst.loader}`]);
  const params = new URLSearchParams({
    query: String(query || '').slice(0, 100),
    limit: '20',
    offset: String(Math.max(0, Number(offset) || 0)),
    facets: JSON.stringify(facets),
  });
  const res = await getJson(`${MR}/search?${params}`);
  return {
    total: res.total_hits,
    hits: res.hits.map((h) => ({
      id: h.project_id,
      title: h.title,
      description: h.description,
      icon: h.icon_url,
      downloads: h.downloads,
      author: h.author,
    })),
  };
}
async function installContent(inst, type, projectId, seen) {
  if (seen.has(projectId)) return;
  seen.add(projectId);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) throw new Error('Ungültige Projekt-ID');
  const params = new URLSearchParams({ game_versions: JSON.stringify([inst.version]) });
  if (type === 'mod') params.set('loaders', JSON.stringify([inst.loader]));
  const versions = await getJson(`${MR}/project/${projectId}/version?${params}`);
  if (!versions.length) throw new Error(`Keine passende Version für Minecraft ${inst.version} gefunden`);
  const v = versions[0];
  const file = v.files.find((f) => f.primary) || v.files[0];
  const dest = path.join(instDir(inst.id), CONTENT_DIRS[type], path.basename(file.filename));
  if (!fs.existsSync(dest)) {
    log(`Installiere ${file.filename}`);
    await download(file.url, dest);
  }
  if (type === 'mod') {
    for (const dep of v.dependencies || []) {
      if (dep.dependency_type === 'required' && dep.project_id) {
        try {
          await installContent(inst, type, dep.project_id, seen);
        } catch (e) {
          log(`Abhängigkeit ${dep.project_id} konnte nicht installiert werden: ${errMsg(e)}`);
        }
      }
    }
  }
}
function listContent(id, type) {
  const dir = path.join(instDir(id), CONTENT_DIRS[checkType(type)]);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => f.name)
    .sort((a, b) => a.localeCompare(b));
}
async function removeContent(id, type, file) {
  await fsp.rm(path.join(instDir(id), CONTENT_DIRS[checkType(type)], path.basename(String(file))), { force: true });
}

handle('content:search', (opts) => searchContent(opts || {}));
handle('content:install', ({ id, type, projectId }) => installContent(getInstance(id), checkType(type), String(projectId), new Set()));
handle('content:list', ({ id, type }) => listContent(id, type));
handle('content:remove', ({ id, type, file }) => removeContent(id, type, file));

module.exports = { CONTENT_DIRS, checkType, searchContent, installContent, listContent, removeContent };
