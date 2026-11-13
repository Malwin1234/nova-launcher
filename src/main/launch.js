// Spielstart: Anmeldung, Java, Spieldateien, Mod-Loader, Bibliotheken, Assets, Start (inkl. Schnellstart in Welt/Server),
// Fortschritt in benannten Phasen, Stoppen und eine verständliche Absturzmeldung.
const { shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');
const { Client } = require('minecraft-launcher-core');
const { META, send, log, errMsg, getConfig, checkId, instDir, handle } = require('./core');
const { getLaunchAuth } = require('./account');
const {
  VERSIONS, versionInfo, versionJson, versionJsonPath, clientJarPath, resolveJvmArgs,
  ensureClientJar, ensureLibraries, ensureAssets,
} = require('./versions');
const { ensureJava } = require('./java');
const { ensureLoader } = require('./loaders');
const { running, getInstance, saveInstance } = require('./instances');
const { SERVER_RE, noteServer, importQuickPlayLog } = require('./recent');

const stopping = new Set(); // vom Benutzer beendet: kein Absturz
const OFFLINE_FIRST = 'Diese Instanz muss einmal mit Internetverbindung gestartet werden, bevor sie offline läuft.';

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

// ---------- per-instance settings ----------
// Zerlegt die JVM-Argumente der Instanz an Leerzeichen; "in Anführungszeichen" bleibt zusammen.
function splitArgs(s) {
  if (typeof s !== 'string') return [];
  const out = [];
  let cur = '';
  let has = false;
  let quoted = false;
  for (const ch of s.slice(0, 2000)) {
    if (ch === '"') { quoted = !quoted; has = true; } else if (/\s/.test(ch) && !quoted) {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else { cur += ch; has = true; }
  }
  if (has) out.push(cur);
  return out.slice(0, 100);
}
function memoryFor(inst) {
  const m = inst.memoryMax;
  if (typeof m === 'number' && Number.isInteger(m) && m >= 1 && m <= 32) return m;
  return getConfig().memoryMax;
}

// ---------- progress ----------
const PHASES = ['Anmeldung', 'Java', 'Spieldateien', 'Mod-Loader', 'Bibliotheken', 'Assets', 'Start'];
const nf = new Intl.NumberFormat('de-DE');
const mb = (b) => (b / 1048576).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function progressText(label, done, total, unit, extra) {
  let t = label;
  if (unit === 'bytes' && (done || total)) t += total ? ` ${mb(done)} / ${mb(total)} MB` : ` ${mb(done)} MB`;
  else if (unit === 'files' && total) t += ` ${nf.format(done)} / ${nf.format(total)}`;
  if (extra) t += ` · ${extra}`;
  return t;
}
// Ereignis "progress": { id, text, done, total, finished, phase, step, steps, unit }; höchstens etwa 10 pro Sekunde.
function progressSender(id) {
  let step = 0;
  let last = 0;
  let pending = null;
  let timer = null;
  let ended = false;
  const flush = () => {
    timer = null;
    if (pending && !ended) send('progress', pending);
    pending = null;
    last = Date.now();
  };
  return {
    phase(name) { step = Math.max(0, PHASES.indexOf(name)); },
    status(label, done = 0, total = 0, unit = null, extra = null) {
      if (ended) return;
      pending = {
        id, text: progressText(label, done, total, unit, extra), done: done || 0, total: total || 0,
        finished: false, phase: PHASES[step], step: step + 1, steps: PHASES.length, unit: unit || null,
      };
      const important = !done || (total && done >= total);
      if (important || Date.now() - last > 100) {
        clearTimeout(timer);
        flush();
      } else if (!timer) {
        timer = setTimeout(flush, 100);
      }
    },
    finish() {
      clearTimeout(timer);
      ended = true;
      send('progress', { id, text: '', done: 0, total: 0, finished: true });
    },
  };
}

// ---------- crash analysis ----------
const NATIVE_CODES = {
  0xc0000005: 'Zugriffsverletzung',
  0xc0000409: 'Stapelüberlauf / Sicherheitsprüfung',
  0xc00000fd: 'Stapelüberlauf',
  0xc0000374: 'beschädigter Speicher',
  0xc000001d: 'ungültiger Prozessorbefehl',
  0xc0000142: 'Initialisierung fehlgeschlagen',
};
function hex(code) {
  return '0x' + (code >>> 0).toString(16).toUpperCase().padStart(8, '0');
}
function readTail(file, max = 256 * 1024) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    try {
      const len = Math.min(max, st.size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}
function newestFile(dir, re, since) {
  try {
    let best = null;
    for (const name of fs.readdirSync(dir)) {
      if (!re.test(name)) continue;
      const st = fs.statSync(path.join(dir, name));
      if (st.isFile() && st.mtimeMs >= since - 2000 && (!best || st.mtimeMs > best.t)) best = { file: path.join(dir, name), t: st.mtimeMs };
    }
    return best && best.file;
  } catch {
    return null;
  }
}
const clean = (l) => String(l).replace(/\s+$/, '').slice(0, 300);
function pick(lines, re, max = 15) {
  return lines.filter((l) => re.test(l)).slice(-max).map(clean);
}
// Liefert { reason, detail } (deutsch) aus Spielausgabe, logs/latest.log, crash-reports/*.txt, hs_err_pid*.log und Exit-Code.
function analyzeCrash({ dir, code, since, output, memory }) {
  const latestFile = path.join(dir, 'logs', 'latest.log');
  let latest = '';
  try { if (fs.statSync(latestFile).mtimeMs >= since - 2000) latest = readTail(latestFile); } catch { /* kein Log */ }
  const crashFile = newestFile(path.join(dir, 'crash-reports'), /^crash-.*\.txt$/i, since);
  const crash = crashFile ? readTail(crashFile, 64 * 1024) : '';
  const hsFile = newestFile(dir, /^hs_err_pid\d+\.log$/i, since);
  const hs = hsFile ? readTail(hsFile, 64 * 1024) : '';
  const out = output.join('\n');
  const lines = `${out}\n${latest}`.split(/\r?\n/).filter((l) => l.trim());
  const all = `${out}\n${latest}\n${crash}`;
  const tail = (n = 20) => lines.filter((l) => !/Launching with arguments|\[MCLC\]/.test(l)).slice(-n).map(clean);
  const u = code == null ? null : code >>> 0;
  const result = (reason, detail, source) => ({ reason, detail: (detail && detail.length ? detail : tail()).slice(-25), file: source || null });

  // 1. Java startet gar nicht (ungültiges JVM-Argument / Speicherangabe)
  if (/Could not reserve enough space for (object|the) heap|Initial heap size set to a larger value/i.test(all)) {
    return result(`Java konnte den eingestellten Arbeitsspeicher (${memory} GB) nicht reservieren. Stelle in den Einstellungen weniger Arbeitsspeicher ein oder schließe andere Programme.`,
      pick(lines, /heap|Could not create|Error:/i));
  }
  if (/Unrecognized (VM )?option|Could not create the Java Virtual Machine|Invalid (initial|maximum) heap size|Improperly specified VM option|Error: Could not find or load main class|Unrecognized option/i.test(all)) {
    return result('Java konnte nicht starten, weil ein JVM-Argument ungültig ist. Prüfe die JVM-Argumente in den Einstellungen der Instanz.',
      pick(lines, /Unrecognized|Could not|Invalid|Improperly|Error:/i));
  }
  // 2. Zu wenig Arbeitsspeicher
  if (/java\.lang\.OutOfMemoryError|There is insufficient memory for the Java Runtime/i.test(all)) {
    return result(`Zu wenig Arbeitsspeicher: Minecraft hat die zugewiesenen ${memory} GB aufgebraucht. Erhöhe den Arbeitsspeicher in den Einstellungen der Instanz oder entferne speicherintensive Mods.`,
      pick(all.split(/\r?\n/), /OutOfMemoryError|insufficient memory|Java heap space|Metaspace/i));
  }
  // 3. Falsche Java-Version (Mod oder Loader verlangt neueres Java)
  if (/UnsupportedClassVersionError|compiled by a more recent version of the Java Runtime|requires (at least )?Java \d+|Java \d+ (or (later|newer|above) )?is required/i.test(all)) {
    return result('Inkompatible Java-Version: Ein Mod oder der Mod-Loader benötigt eine andere Java-Version als die, mit der diese Minecraft-Version startet. Prüfe, ob der Mod zu dieser Minecraft-Version passt.',
      pick(lines, /UnsupportedClassVersionError|class file version|Java \d+|requires/i));
  }
  // 4. Fehlende oder unpassende Mod-Abhängigkeiten (Fabric, Quilt, Forge, NeoForge)
  const depRe = /requires (any|version|a version|\S+ version)|which is missing|is missing|Missing or unsupported mandatory dependencies|Mod ID: '.*Requested by|Actual version: '\[?MISSING|Incompatible mods? (found|set)|incompatible mod set|Install .*, any version|Remove mod|depends on|breaks|Unmet dependency|Mod resolution failed|ModResolutionException|Some of your mods are incompatible/i;
  if (/Incompatible mods? found|incompatible mod set|Missing or unsupported mandatory dependencies|ModResolutionException|Mod resolution (failed|encountered)|Unmet dependency|Some of your mods are incompatible/i.test(all)) {
    return result('Ein Mod benötigt einen anderen Mod, der fehlt oder in der falschen Version installiert ist (oder zwei Mods vertragen sich nicht). Installiere die genannten Abhängigkeiten oder entferne den Mod.',
      pick(all.split(/\r?\n/), depRe, 20));
  }
  // 5. Mixin-Fehler: Mod passt nicht zu dieser Minecraft- oder Loader-Version
  if (/Mixin apply (for mod \S+ )?failed|MixinApplyError|InvalidMixinException|MixinTransformerError|Mixin transformation of .* failed/i.test(all)) {
    return result('Ein Mod ist mit dieser Minecraft- oder Loader-Version nicht kompatibel (Mixin-Fehler). Aktualisiere oder entferne den genannten Mod.',
      pick(all.split(/\r?\n/), /Mixin|mod /i, 15), crashFile);
  }
  // 6. Absturzbericht von Minecraft
  if (crash) {
    const desc = (/^Description: (.*)$/m.exec(crash) || [])[1];
    const crashLines = crash.split(/\r?\n/);
    const i = crashLines.findIndex((l) => /^Description:/.test(l));
    const detail = (i >= 0 ? crashLines.slice(i, i + 14) : crashLines.slice(0, 14)).map(clean);
    const suspects = pick(crashLines, /Suspected Mods?:|^\s+\S.*\(.*\), Version:/i, 4);
    return result(`Minecraft ist abgestürzt${desc ? `: ${desc.trim()}` : ''}. Details stehen im Absturzbericht (${path.basename(crashFile)}).`,
      suspects.concat(detail), crashFile);
  }
  // 7. Nativer Absturz von Java (oft Grafiktreiber)
  if (hs || (u != null && NATIVE_CODES[u])) {
    const what = u != null && NATIVE_CODES[u] ? ` (${hex(u)}, ${NATIVE_CODES[u]})` : u != null ? ` (Code ${code})` : '';
    const detail = hs ? pick(hs.split(/\r?\n/), /EXCEPTION_|Problematic frame|^# [CJjVv] |^# JRE version|^# Java VM/, 12) : null;
    return result(`Java ist mit einem nativen Fehler abgestürzt${what}. Häufige Ursachen: veralteter Grafiktreiber, Overlay-Programme (z. B. Aufnahme- oder FPS-Tools) oder Mods mit eigenen nativen Bibliotheken. Aktualisiere den Grafiktreiber und versuche es erneut.`,
      detail, hsFile);
  }
  // 8. Sonstige Java-Ausnahme in der Ausgabe
  const exc = lines.filter((l) => /Exception|Error:/.test(l) && !/Failed to fetch user properties|401|Realms|YggdrasilAuthentication/i.test(l));
  return result(`Minecraft wurde unerwartet beendet (Code ${code}${u != null && u > 0xffff ? `, ${hex(u)}` : ''}).${exc.length ? ' Die letzte Fehlermeldung steht unten.' : ''}`,
    exc.length ? exc.slice(-8).map(clean).concat(tail(10)) : tail(25));
}

// ---------- launch ----------
async function launch(id, quick) {
  checkId(id);
  if (running.has(id)) throw new Error('Diese Instanz läuft bereits');
  const inst = getInstance(id);
  const p = progressSender(id);
  running.set(id, null);
  send('state', { id, running: true });
  try {
    p.phase('Anmeldung');
    p.status('Anmeldung wird geprüft');
    const { auth: authorization, offline } = await getLaunchAuth();
    let info;
    try {
      info = await versionInfo(inst.version);
      inst.versionInfo = info;
    } catch (e) {
      if (!inst.versionInfo) throw new Error(offline ? OFFLINE_FIRST : errMsg(e));
      info = inst.versionInfo;
    }

    p.phase('Java');
    p.status(`Java ${info.javaMajor} wird geprüft`);
    const javaPath = await ensureJava(info.javaMajor, p.status);

    // Spiel-JAR und Versionsdatei liegen einmal pro Minecraft-Version in meta/versions/<Version>/ (für alle Loader).
    p.phase('Spieldateien');
    p.status('Spieldateien werden geprüft');
    let vjson;
    try {
      vjson = await versionJson(inst.version);
    } catch (e) {
      throw new Error(offline ? OFFLINE_FIRST : errMsg(e));
    }
    const jar = await ensureClientJar(inst.version, vjson, p.status);
    if (jar.downloaded) log(`Spiel-JAR für Minecraft ${inst.version} heruntergeladen.`);
    else log(`Spiel-JAR für Minecraft ${inst.version} ist bereits vorhanden (${path.relative(META, jar.jar)}).`);

    p.phase('Mod-Loader');
    p.status(inst.loader && inst.loader !== 'vanilla' ? 'Mod-Loader wird vorbereitet' : 'Kein Mod-Loader (Vanilla)');
    const loader = await ensureLoader(inst, { status: p.status, javaPath });

    p.phase('Bibliotheken');
    await ensureLibraries(vjson, loader && loader.profile, p.status);

    p.phase('Assets');
    const assets = await ensureAssets(vjson, (loader && loader.custom) || inst.version, p.status);

    p.phase('Start');
    p.status('Minecraft wird gestartet');
    const memory = memoryFor(inst);
    const extraArgs = splitArgs(inst.jvmArgs);
    const customArgs = [
      ...resolveJvmArgs(info.jvmArgs, inst.version),
      ...(loader ? resolveJvmArgs(loader.jvmArgs, inst.version) : []),
      ...extraArgs,
    ];
    const version = { number: inst.version, type: info.type };
    if (loader) version.custom = loader.custom;

    const client = new Client();
    // Launcher-Protokoll zusätzlich in die Instanz schreiben, damit Startprobleme nachvollziehbar bleiben.
    const dir = instDir(id);
    const logDir = path.join(dir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const fileLog = fs.createWriteStream(path.join(logDir, 'launcher.log'));
    const token = authorization && authorization.access_token;
    const mask = (l) => (token && token.length > 8 ? String(l).split(token).join('***') : String(l));
    const output = []; // letzte Zeilen der Spielausgabe für die Absturzanalyse
    const both = (l) => {
      const line = mask(l);
      log(line);
      fileLog.write(line.trimEnd() + '\n');
    };
    fileLog.write(`Nova Launcher: Minecraft ${inst.version}, Loader ${inst.loader || 'vanilla'}${loader ? ` (${loader.custom})` : ''}, Arbeitsspeicher ${memory} GB${inst.memoryMax ? ' (Instanz)' : ' (global)'}, Zusatzargumente: ${extraArgs.length ? JSON.stringify(extraArgs) : 'keine'}\n`);
    client.on('debug', both);
    client.on('data', (d) => {
      both(d);
      for (const l of String(d).split(/\r?\n/)) if (l.trim()) output.push(l);
      if (output.length > 600) output.splice(0, output.length - 600);
    });
    client.on('progress', (e) => {
      if (!e || !e.total) return;
      const label = /^classes/.test(e.type) ? 'Bibliotheken werden geprüft' : e.type === 'natives' ? 'Native Bibliotheken' : e.type === 'assets-copy' ? 'Assets werden kopiert' : 'Dateien werden geprüft';
      p.status(label, e.task, e.total, 'files');
    });
    const startedAt = Date.now();
    let child = null;
    let exited = false;
    client.on('close', (code) => {
      exited = true;
      running.delete(id);
      both(`Minecraft beendet (Code ${code})`);
      fileLog.end();
      importQuickPlayLog(id);
      send('state', { id, running: false });
      const byUser = stopping.delete(id);
      // Nur ein gestartetes Spiel kann abstürzen; Fehler vor dem Start meldet launch() selbst.
      if (child && !byUser && code !== 0 && code != null) {
        let report;
        try {
          report = analyzeCrash({ dir, code, since: startedAt, output, memory });
        } catch (e) {
          report = { reason: `Minecraft wurde unerwartet beendet (Code ${code}).`, detail: [errMsg(e)], file: null };
        }
        log(`Absturz: ${report.reason}`);
        send('crash', { id, name: inst.name, code, reason: report.reason, detail: report.detail.join('\n'), file: report.file ? path.basename(report.file) : null });
      }
    });
    child = await client.launch({
      authorization,
      root: META,
      version,
      javaPath,
      memory: { max: `${memory}G`, min: memory >= 2 ? '1G' : '512M' },
      customArgs,
      customLaunchArgs: quickArgs(inst, info, quick),
      overrides: {
        gameDirectory: dir,
        cwd: dir,
        detached: false,
        // Gemeinsames Spiel-JAR und Versionsdatei (kein zweiter Download je Loader)
        directory: path.join(VERSIONS, inst.version),
        minecraftJar: clientJarPath(inst.version),
        versionJson: versionJsonPath(inst.version),
        assetIndex: assets.index,
        maxSockets: 8,
      },
    });
    if (!child) throw new Error('Minecraft konnte nicht gestartet werden (siehe Protokoll).');
    if (!exited) running.set(id, child);
    inst.lastPlayed = Date.now();
    saveInstance(inst);
    p.finish();
  } catch (e) {
    if (running.get(id) == null) running.delete(id);
    send('state', { id, running: running.has(id) });
    p.finish();
    throw e;
  }
}
// Beendet den ganzen Prozessbaum (Java startet ggf. Unterprozesse); Rückfall auf child.kill().
function stop(id) {
  const child = running.get(checkId(id));
  if (!child) return;
  stopping.add(id);
  const fallback = () => { try { child.kill(); } catch { /* bereits beendet */ } };
  if (process.platform !== 'win32' || !child.pid) return fallback();
  execFile('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true }, (err) => {
    if (err && child.exitCode == null) {
      log(`taskkill fehlgeschlagen (${errMsg(err)}), beende direkt.`);
      fallback();
    }
  });
}
async function openLogs(id) {
  const dir = instDir(id); // prüft die ID
  if (!fs.existsSync(path.join(dir, 'instance.json'))) throw new Error('Instanz nicht gefunden');
  const logs = path.join(dir, 'logs');
  await fsp.mkdir(logs, { recursive: true });
  const err = await shell.openPath(logs);
  if (err) throw new Error(`Der Log-Ordner konnte nicht geöffnet werden: ${err}`);
}

handle('game:launch', (id, quick) => launch(id, quick || null));
handle('game:stop', (id) => stop(id));
handle('game:openLogs', (id) => openLogs(id));

module.exports = { quickArgs, launch, stop, splitArgs, analyzeCrash, memoryFor, PHASES };
