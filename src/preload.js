// Minimal, explicit bridge between the overlay UI and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('coach', {
  onUpdate: (callback) => ipcRenderer.on('update', (_event, payload) => callback(payload)),
  close: () => ipcRenderer.send('close'),
  setLanguage: (lang) => ipcRenderer.send('set-language', lang),
  resizeStart: () => ipcRenderer.send('resize-start'),
  resizeMove: (dx, dy) => ipcRenderer.send('resize-move', dx, dy),
  resizeEnd: () => ipcRenderer.send('resize-end'),
  resizeBy: (dx, dy) => ipcRenderer.send('resize-by', dx, dy),
  installUpdate: () => ipcRenderer.send('install-update'),
});
