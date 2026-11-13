// Zuletzt gespielt (Welten und Server) für "Weiterspielen".
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { readJsonSync, instDir, handle } = require('./core');
const { listInstances } = require('./instances');

// Minimaler NBT-Leser für level.dat (gzip) und servers.dat.
function readNbt(buf) {
  let o = 0;
  const str = () => { const l = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + l); o += l; return s; };
  const payload = (t) => {
    switch (t) {
      case 1: o += 1; return buf.readInt8(o - 1);
      case 2: o += 2; return buf.readInt16BE(o - 2);
      case 3: o += 4; return buf.readInt32BE(o - 4);
      case 4: o += 8; return Number(buf.readBigInt64BE(o - 8));
      case 5: o += 4; return buf.readFloatBE(o - 4);
      case 6: o += 8; return buf.readDoubleBE(o - 8);
      case 7: { const l = buf.readInt32BE(o); o += 4 + l; return null; }
      case 8: return str();
      case 9: { const et = buf.readUInt8(o); const l = buf.readInt32BE(o + 1); o += 5; const a = []; for (let i = 0; i < l; i++) a.push(payload(et)); return a; }
      case 10: { const c = {}; for (;;) { const tt = buf.readUInt8(o); o += 1; if (tt === 0) break; const n = str(); c[n] = payload(tt); } return c; }
      case 11: { const l = buf.readInt32BE(o); o += 4 + l * 4; return null; }
      case 12: { const l = buf.readInt32BE(o); o += 4 + l * 8; return null; }
      default: throw new Error('NBT');
    }
  };
  if (buf.readUInt8(o) !== 10) throw new Error('NBT');
  o += 1; str();
  return payload(10);
}
function pngDataUrl(file) {
  try {
    const st = fs.statSync(file);
    if (st.size > 0 && st.size < 300000) return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  } catch { /* kein Bild */ }
  return null;
}
const SERVER_RE = /^[A-Za-z0-9._\-\[\]:]{1,255}$/;
function recentFile(id) {
  return path.join(instDir(id), 'nova-recent.json');
}
function readRecent(id) {
  const r = readJsonSync(recentFile(id), null);
  return r && r.servers ? r : { servers: {} };
}
function noteServer(id, address, name, time) {
  if (!SERVER_RE.test(address)) return;
  const r = readRecent(id);
  const old = r.servers[address] || {};
  r.servers[address] = { name: name || old.name || address, time: Math.max(time || Date.now(), old.time || 0) };
  fs.writeFileSync(recentFile(id), JSON.stringify(r));
}
// Das Spiel schreibt (ab 1.20) in quickPlay/log.json, was zuletzt gespielt wurde.
function importQuickPlayLog(id) {
  try {
    const entries = JSON.parse(fs.readFileSync(path.join(instDir(id), 'quickPlay', 'log.json'), 'utf8'));
    for (const e of [].concat(entries)) {
      const w = e.quickPlayWorld || e;
      if (w && w.type === 'multiplayer' && w.id) noteServer(id, String(w.id), w.name, Date.parse(e.lastPlayedTime) || Date.now());
    }
  } catch { /* kein Protokoll vorhanden */ }
}
function listRecent() {
  const items = [];
  for (const inst of listInstances()) {
    const dir = instDir(inst.id);
    const base = { instanceId: inst.id, instanceName: inst.name, version: inst.version, loader: inst.loader };
    // Unbekannt (noch nie mit dieser Version gestartet) zählt als möglich; beim Start wird es geprüft.
    const canQuick = !(inst.versionInfo && inst.versionInfo.quickPlay === false);
    // Welten
    const saves = path.join(dir, 'saves');
    let folders = [];
    try { folders = fs.readdirSync(saves, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* keine Welten */ }
    for (const folder of folders) {
      const level = path.join(saves, folder, 'level.dat');
      let st;
      try { st = fs.statSync(level); } catch { continue; }
      let name = folder;
      let time = st.mtimeMs;
      try {
        const data = readNbt(zlib.gunzipSync(fs.readFileSync(level))).Data || {};
        if (typeof data.LevelName === 'string' && data.LevelName) name = data.LevelName;
        if (data.LastPlayed > 0) time = data.LastPlayed;
      } catch { /* Ordnername und Änderungszeit genügen */ }
      items.push({ ...base, kind: 'world', id: folder, name, time, direct: canQuick, icon: pngDataUrl(path.join(saves, folder, 'icon.png')) });
    }
    // Server: Liste aus dem Spiel plus eigene Zeitstempel
    importQuickPlayLog(inst.id);
    const hist = readRecent(inst.id).servers;
    const servers = new Map();
    try {
      const list = readNbt(fs.readFileSync(path.join(dir, 'servers.dat'))).servers || [];
      for (const s of list) {
        if (!s || typeof s.ip !== 'string' || !SERVER_RE.test(s.ip)) continue;
        const icon = typeof s.icon === 'string' && s.icon.length < 200000 && /^[A-Za-z0-9+/=]+$/.test(s.icon) ? 'data:image/png;base64,' + s.icon : null;
        servers.set(s.ip, { name: s.name || s.ip, time: 0, icon });
      }
    } catch { /* keine Serverliste */ }
    for (const [address, h] of Object.entries(hist)) {
      if (!SERVER_RE.test(address)) continue;
      const cur = servers.get(address) || { name: h.name || address, icon: null };
      servers.set(address, { ...cur, time: h.time || 0 });
    }
    for (const [address, s] of servers) {
      items.push({ ...base, kind: 'server', id: address, name: s.name, address, time: s.time, direct: true, icon: s.icon });
    }
  }
  return items.sort((a, b) => b.time - a.time).slice(0, 10);
}

handle('recent:list', () => listRecent());

module.exports = { SERVER_RE, readNbt, pngDataUrl, readRecent, noteServer, importQuickPlayLog, listRecent };
