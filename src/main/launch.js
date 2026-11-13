// Spielstart: Anmeldung, Java, Loader, Startparameter (inkl. Schnellstart in Welt/Server), Stoppen.
const path = require('path');
const fs = require('fs');
const { Client } = require('minecraft-launcher-core');
const { META, send, log, errMsg, getConfig, checkId, instDir, handle } = require('./core');
const { getLaunchAuth } = require('./account');
const { versionInfo, resolveJvmArgs } = require('./versions');
const { ensureJava } = require('./java');
const { ensureFabric } = require('./loaders');
const { running, getInstance, saveInstance } = require('./instances');
const { SERVER_RE, noteServer, importQuickPlayLog } = require('./recent');

function quickArgs(inst, info, quick) {
  const args = info.quickPlay ? ['--quickPlayPath', 'quickPlay/log.json'] : [];
  if (!quick) return args;
  const target = String(quick.target || '');
  if (quick.type === 'world') {
    if (target !== path.basename(target) || !fs.existsSync(path.join(instDir(inst.id), 'saves', target, 'level.dat'))) {
      throw new Error('Diese Welt gibt es nicht mehr.');
    }
    if (info.quickPlay) args.push('--quickPlaySingleplayer', target);
    else log('Diese Minecraft-Version kann nicht direkt in eine Welt starten, die Instanz wird normal geöffnet.');
  } else if (quick.type === 'server') {
    if (!SERVER_RE.test(target)) throw new Error('Ungültige Serveradresse');
    if (info.quickPlay) {
      args.push('--quickPlayMultiplayer', target);
    } else {
      const m = /^(.*?)(?::(\d+))?$/.exec(target);
      args.push('--server', m[1], '--port', m[2] || '25565');
    }
    noteServer(inst.id, target);
  } else {
    throw new Error('Unbekanntes Schnellstart-Ziel');
  }
  return args;
}

async function launch(id, quick) {
  if (running.has(id)) throw new Error('Diese Instanz läuft bereits');
  const inst = getInstance(id);
  const status = (text, done, total) => send('progress', { id, text, done, total });
  running.set(id, null);
  send('state', { id, running: true });
  try {
    status('Anmeldung wird geprüft', 0, 0);
    const { auth: authorization, offline } = await getLaunchAuth();
    let info;
    try {
      info = await versionInfo(inst.version);
      inst.versionInfo = info;
    } catch (e) {
      if (!inst.versionInfo) {
        throw new Error(offline ? 'Diese Instanz muss einmal mit Internetverbindung gestartet werden, bevor sie offline läuft.' : errMsg(e));
      }
      info = inst.versionInfo;
    }
    const javaPath = await ensureJava(info.javaMajor, status);
    const version = { number: inst.version, type: info.type };
    if (inst.loader === 'fabric') {
      status('Fabric wird vorbereitet', 0, 0);
      version.custom = await ensureFabric(inst);
    }
    const cfg = getConfig();
    const client = new Client();
    // Launcher-Protokoll zusätzlich in die Instanz schreiben, damit Startprobleme nachvollziehbar bleiben.
    const logDir = path.join(instDir(id), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const fileLog = fs.createWriteStream(path.join(logDir, 'launcher.log'));
    const both = (l) => { log(l); fileLog.write(String(l).trimEnd() + '\n'); };
    client.on('debug', both);
    client.on('data', both);
    client.on('progress', (p) => status(`Lade ${p.type}`, p.task, p.total));
    client.on('close', (code) => {
      running.delete(id);
      both(`Minecraft beendet (Code ${code})`);
      fileLog.end();
      importQuickPlayLog(id);
      send('state', { id, running: false });
    });
    status('Spieldateien werden geprüft', 0, 0);
    const child = await client.launch({
      authorization,
      root: META,
      version,
      javaPath,
      memory: { max: `${cfg.memoryMax}G`, min: '1G' },
      customArgs: resolveJvmArgs(info.jvmArgs, inst.version),
      customLaunchArgs: quickArgs(inst, info, quick),
      overrides: { gameDirectory: instDir(id), cwd: instDir(id), detached: false },
    });
    if (!child) throw new Error('Minecraft konnte nicht gestartet werden (siehe Protokoll).');
    running.set(id, child);
    inst.lastPlayed = Date.now();
    saveInstance(inst);
    send('progress', { id, text: '', done: 0, total: 0, finished: true });
  } catch (e) {
    running.delete(id);
    send('state', { id, running: false });
    send('progress', { id, text: '', done: 0, total: 0, finished: true });
    throw e;
  }
}
function stop(id) {
  const child = running.get(checkId(id));
  if (child) child.kill();
}

handle('game:launch', (id, quick) => launch(id, quick || null));
handle('game:stop', (id) => stop(id));

module.exports = { quickArgs, launch, stop };
