// Automatischer Starttest über den echten Launcher-Code (ohne Microsoft-Anmeldung).
// Aufruf:  set NOVA_TEST=1 && set NOVA_DATA_DIR=<leerer Ordner> && electron scripts/test-launch.js 26.3:fabric 1.21.1:vanilla
// Pro Eintrag: Instanz anlegen, starten, warten bis das Spiel geladen ist, 25 s laufen lassen, beenden.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

if (process.env.NOVA_TEST !== '1' || !process.env.NOVA_DATA_DIR) {
  console.error('NOVA_TEST=1 und NOVA_DATA_DIR müssen gesetzt sein.');
  process.exit(2);
}
require(path.join(__dirname, '..', 'src', 'main.js'));

const targets = process.argv.slice(2).filter((a) => /^[\w.\-]+:(vanilla|fabric)$/.test(a));
const LOAD_TIMEOUT = Number(process.env.NOVA_TEST_TIMEOUT || 900) * 1000; // inkl. Downloads
const READY = /Sound engine started|Created: \d+x\d+.*atlas|OpenAL initialized/;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await wait(2500);
  const w = BrowserWindow.getAllWindows()[0];
  const js = (code) => w.webContents.executeJavaScript(code);
  await js(`window.__t = { log: [], running: {} };
    nova.on('log', (l) => { __t.log.push(l); });
    nova.on('state', (s) => { __t.running[s.id] = s.running; });`);
  const results = [];
  for (const t of targets) {
    const [version, loader] = t.split(':');
    const r = { target: t, ok: false };
    const t0 = Date.now();
    try {
      await js(`__t.log.length = 0`);
      const inst = await js(`nova.call('instances:create', ${JSON.stringify({ name: 'Test ' + t, version, loader })})`);
      r.id = inst.id;
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
      if (ready) {
        await wait(25000); // muss nach dem Laden stabil weiterlaufen
        const alive = await js(`__t.running['${inst.id}'] !== false`);
        r.ok = alive;
        if (!alive) r.error = 'Spiel ist nach dem Laden abgestürzt';
      } else {
        r.error = 'Spiel wurde beendet oder nicht fertig geladen';
      }
      await js(`nova.call('game:stop', '${inst.id}')`);
      await wait(3000);
    } catch (e) {
      r.error = String(e.message || e);
    }
    r.seconds = Math.round((Date.now() - t0) / 1000);
    const log = await js(`__t.log.slice()`);
    r.exitLine = log.filter((l) => /Minecraft beendet/.test(l)).pop() || null;
    if (!r.ok) r.logTail = log.filter((l) => !/Launching with arguments/.test(l)).slice(-40).map((l) => l.slice(0, 400));
    // Protokoll liegt im Instanzordner (logs/latest.log) – prüfen, ob es dort ankommt
    if (r.id) r.logInInstance = fs.existsSync(path.join(process.env.NOVA_DATA_DIR, 'instances', r.id, 'logs', 'latest.log'));
    results.push(r);
    console.log('RESULT ' + JSON.stringify(r));
  }
  console.log('SUMMARY ' + results.map((r) => `${r.target}=${r.ok ? 'OK' : 'FAIL'}`).join(' '));
  app.exit(results.every((r) => r.ok) ? 0 : 1);
});
