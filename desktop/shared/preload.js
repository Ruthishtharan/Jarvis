/* Minimal bridge. The apps talk to the backend over HTTP, so almost nothing
 * needs to cross the isolation boundary — only what the web page cannot
 * discover for itself. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisDesktop', {
  isDesktop: true,
  platform: process.platform,
  openBrain: () => ipcRenderer.send('open-brain'),
  // The renderer cannot see the OS-level grant; only the main process can.
  micStatus: () => ipcRenderer.invoke('mic-status'),
  openMicSettings: () => ipcRenderer.send('open-mic-settings'),
});
