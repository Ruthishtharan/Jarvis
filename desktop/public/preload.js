const { contextBridge, ipcRenderer } = require('electron');

// Expose IPC API to React app
contextBridge.exposeInMainWorld('electronAPI', {
  // JARVIS control
  getJarvisStatus: () => ipcRenderer.invoke('get-jarvis-status'),
  startJarvis: () => ipcRenderer.invoke('start-jarvis'),
  stopJarvis: () => ipcRenderer.invoke('stop-jarvis'),

  // Configuration
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // History and logs
  getHistory: () => ipcRenderer.invoke('get-history'),
  getLogs: () => ipcRenderer.invoke('get-logs'),

  // Metrics
  getMetrics: () => ipcRenderer.invoke('get-metrics'),

  // Live voice state — drives the arc reactor
  getVoiceState: () => ipcRenderer.invoke('get-voice-state'),

  // Voice amplitude 0..1 — drives the particle visualiser
  getAudioLevel: () => ipcRenderer.invoke('get-audio-level'),

  // Listen for events from main process
  onStatusChange: (callback) =>
    ipcRenderer.on('status-changed', (event, data) => callback(data)),
});
