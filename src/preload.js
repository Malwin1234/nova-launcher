const { contextBridge, ipcRenderer } = require('electron');

// Muster statt fester Listen: neue Funktionen brauchen hier keine Änderung.
// Kanäle sehen aus wie "bereich:aktion" (z. B. instances:openFolder), Ereignisse wie "log" oder "update-progress".
const CHANNEL_RE = /^[a-z][a-zA-Z]*:[a-zA-Z]+$/;
const EVENT_RE = /^[a-z][a-zA-Z-]*$/;

contextBridge.exposeInMainWorld('nova', {
  async call(channel, ...args) {
    if (typeof channel !== 'string' || !CHANNEL_RE.test(channel)) throw new Error('Unbekannter Kanal');
    const res = await ipcRenderer.invoke(channel, ...args);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  },
  on(event, cb) {
    if (typeof event !== 'string' || !EVENT_RE.test(event)) return;
    ipcRenderer.on(event, (_e, payload) => cb(payload));
  },
});
