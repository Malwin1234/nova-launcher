// Automatischer Starttest über den echten Launcher-Code (ohne Microsoft-Anmeldung).
// Aufruf (Git Bash):  NOVA_TEST=1 NOVA_DATA_DIR=<Ordner> electron scripts/test-launch.js 26.3:fabric 1.21.1:quilt 1.20.1:forge 1.21.1:neoforge
// Ziel:   <Minecraft-Version>:<Loader>[@<Loader-Version>]   Loader: vanilla, fabric, quilt, forge, neoforge
// Optionen (gelten für alle Ziele):
//   --patch=<JSON>     Felder für instance.json, z. B. --patch='{"memoryMax":3,"jvmArgs":"-Dnova.test=\"a b\""}'
//   --mod=<Datei.jar>  Datei vor dem Start in den mods-Ordner der Instanz kopieren
//   --expect-crash     Erfolg = Spiel stürzt ab und der Launcher sendet ein "crash"-Ereignis
//   --keep             Instanz nach dem Test nicht löschen (sonst: Instanz und meta/installers/*.jar werden gelöscht)
// Unter NOVA_TEST_MIN_FREE_GB (Standard 1,5) freiem Speicher bricht der Test vor dem nächsten Ziel ab.
// Pro Eintrag: Instanz anlegen, starten, warten bis das Spiel geladen ist, 25 s laufen lassen, beenden.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

if (process.env.NOVA_TEST !== '1' || !process.env.NOVA_DATA_DIR) {
  console.error('NOVA_TEST=1 und NOVA_DATA_DIR müssen gesetzt sein.');
  process.exit(2);
}
require(path.join(__dirname, '..', 'src', 'main.js'));

const argv = process.argv.slice(2);
const opt = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const PATCH = opt('patch') ? JSON.parse(opt('patch')) : null;
const MOD = opt('mod');
const EXPECT_CRASH = argv.includes('--expect-crash');
const KEEP = argv.includes('--keep'); // Instanz nach dem Test behalten (Standard: löschen)
const MIN_FREE_GB = Number(process.env.NOVA_TEST_MIN_FREE_GB || 1.5);
const targets = argv.filter((a) => /^[\w.\-]+:(vanilla|fabric|quilt|forge|neoforge)(@[\w.+\-]+)?$/.test(a));
const LOAD_TIMEOUT = Number(process.env.NOVA_TEST_TIMEOUT || 1500) * 1000; // inkl. Downloads und Loader-Installation
const READY = /Sound engine started|Created: \d+x\d+.*atlas|OpenAL initialized/;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await wait(2500);
  const w = BrowserWindow.getAllWindows()[0];
  const js = (code) => w.webContents.executeJavaScript(code);
  await js(`window.__t = { log: [], running: {}, crash: {}, progress: [] };
    nova.on('log', (l) => { __t.log.push(l); });
    nova.on('state', (s) => { if ('running' in s) __t.running[s.id] = s.running; });
    nova.on('crash', (c) => { __t.crash[c.id] = c; });
    nova.on('progress', (p) => { if (!p.finished) __t.progress.push(p.text); });`);
  const results = [];
  for (const t of targets) {
    const m = /^([^:]+):(\w+)(?:@(.+))?$/.exec(t);
    const [, version, loader, loaderVersion] = m;
    const r = { target: t, ok: false };
    const t0 = Date.now();
    try {
      const s = fs.statfsSync(process.env.NOVA_DATA_DIR);
      const freeGB = (s.bavail * s.bsize) / 1024 ** 3;
      if (freeGB < MIN_FREE_GB) {
        r.error = `Abgebrochen: nur ${freeGB.toFixed(2)} GB frei (Minimum ${MIN_FREE_GB} GB)`;
        results.push(r);
        console.log('RESULT ' + JSON.stringify(r));
        break;
      }
      r.freeGBBefore = Number(freeGB.toFixed(2));
    } catch { /* statfs nicht verfügbar */ }
    try {
      await js(`__t.log.length = 0; __t.progress.length = 0`);
      const opts = { name: 'Test ' + t, version, loader };
      if (loaderVersion) opts.loaderVersion = loaderVersion;
      const inst = await js(`nova.call('instances:create', ${JSON.stringify(opts)})`);
      r.id = inst.id;
      const dir = path.join(process.env.NOVA_DATA_DIR, 'instances', inst.id);
      if (PATCH || loaderVersion) {
        const file = path.join(dir, 'instance.json');
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        Object.assign(data, PATCH || {}, loaderVersion ? { loaderVersion } : {});
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
      }
      if (MOD) {
        fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
        fs.copyFileSync(MOD, path.join(dir, 'mods', path.basename(MOD)));
      }
      const launchErr = await js(`nova.call('game:launch', '${inst.id}').then(() => null, (e) => e.message)`);
      if (launchErr) throw new Error('Start fehlgeschlagen: ' + launchErr);
      r.launchedAfterS = Math.round((Date.now() - t0) / 1000);
      // warten bis geladen oder beendet
      let ready = false;
      const start = Date.now();
      while (Date.now() - start < LOAD_TIMEOUT) {
        const st = await js(`({ running: __t.running['${inst.id}'], ready: __t.log.some((l) => ${READY}.test(l)) })`);
        if (st.ready) { ready = true; break; }
        if (st.running === false) break;
        await wait(1000);
      }
      if (EXPECT_CRASH) {
        await wait(3000);
        const crash = await js(`__t.crash['${inst.id}'] || null`);
        r.crash = crash && { code: crash.code, reason: crash.reason, detail: String(crash.detail).split('\n').slice(0, 8) };
        r.ok = !!crash;
        if (!crash) r.error = ready ? 'Spiel lief normal, kein Absturz' : 'Kein crash-Ereignis empfangen';
      } else if (ready) {
        await wait(25000); // muss nach dem Laden stabil weiterlaufen
        const alive = await js(`__t.running['${inst.id}'] !== false`);
        r.ok = alive;
        if (!alive) r.error = 'Spiel ist nach dem Laden abgestürzt';
      } else {
        r.error = 'Spiel wurde beendet oder nicht fertig geladen';
      }
      await js(`nova.call('game:stop', '${inst.id}')`);
      await wait(3000);
      if (!EXPECT_CRASH) {
        const crash = await js(`__t.crash['${inst.id}'] || null`);
        if (crash) r.unexpectedCrash = crash.reason; // auch "Stoppen" darf keinen Absturz melden
      }
    } catch (e) {
      r.error = String(e.message || e);
    }
    r.seconds = Math.round((Date.now() - t0) / 1000);
    const log = await js(`__t.log.slice()`);
    r.exitLine = log.filter((l) => /Minecraft beendet/.test(l)).pop() || null;
    r.jar = (log.find((l) => /^Spiel-JAR für Minecraft/.test(l)) || '').replace(/^Spiel-JAR für Minecraft \S+ /, '');
    const prog = await js(`__t.progress.slice()`);
    r.progressSample = prog.filter((x, i) => i % Math.max(1, Math.floor(prog.length / 12)) === 0).slice(0, 14);
    if (!r.ok) r.logTail = log.filter((l) => !/Launching with arguments/.test(l)).slice(-40).map((l) => l.slice(0, 400));
    if (r.id) {
      const instDir = path.join(process.env.NOVA_DATA_DIR, 'instances', r.id);
      r.logInInstance = fs.existsSync(path.join(instDir, 'logs', 'latest.log'));
      try {
        const ll = fs.readFileSync(path.join(instDir, 'logs', 'launcher.log'), 'utf8');
        const args = (/Launching with arguments (.*)/.exec(ll) || [])[1] || '';
        r.xmx = (/-Xmx\S+/.exec(args) || [])[0] || null;
        r.launcherHeader = ll.split('\n')[0].slice(0, 300);
      } catch { /* kein launcher.log */ }
      if (!KEEP) {
        // Speicher sparen: Instanz und Installer-JARs wieder löschen
        r.deleted = await js(`nova.call('instances:delete', '${r.id}').then(() => true, (e) => e.message)`);
        const inst = path.join(process.env.NOVA_DATA_DIR, 'meta', 'installers');
        for (const f of fs.existsSync(inst) ? fs.readdirSync(inst) : []) {
          if (/\.jar(\.\w+\.part|\.log)?$/.test(f)) try { fs.unlinkSync(path.join(inst, f)); } catch { /* in Benutzung */ }
        }
      }
    }
    results.push(r);
    console.log('RESULT ' + JSON.stringify(r));
  }
  console.log('SUMMARY ' + results.map((r) => `${r.target}=${r.ok ? 'OK' : 'FAIL'}`).join(' '));
  app.exit(results.every((r) => r.ok) ? 0 : 1);
});
