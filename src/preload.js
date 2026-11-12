const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = [
  'account:get', 'account:login', 'account:logout',
  'config:get', 'config:set',
  'versions:list',
  'instances:list', 'instances:create', 'instances:delete', 'instances:openFolder',
  'game:launch', 'game:stop',
  'skin:save', 'skin:upload',
  'content:search', 'content:install', 'content:list', 'content:remove',
];
const EVENTS = ['log', 'progress', 'state'];

contextBridge.exposeInMainWorld('nova', {
  async call(channel, ...args) {
    if (!CHANNELS.includes(channel)) throw new Error('Unbekannter Kanal');
    const res = await ipcRenderer.invoke(channel, ...args);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  },
  on(event, cb) {
    if (!EVENTS.includes(event)) return;
    ipcRenderer.on(event, (_e, payload) => cb(payload));
  },
});
