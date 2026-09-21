/* JARVIS Brain — the control app.
 *
 * The companion to the JARVIS voice app. This is where everything
 * configurable lives: learning state, voice settings, memory, skills,
 * appearance, diagnostics. It shares the same backend, and settings changed
 * here take effect in the JARVIS app immediately.
 */

const { app, ipcMain, shell: _shell, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const { ensureBackend, stopBackend } = require('./shared/backend');
const { ensureMicrophone } = require('./shared/media');

let win = null;
let iStartedBackend = false;

async function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 880,
    minHeight: 620,
    backgroundColor: '#04060a',
    title: 'JARVIS Brain',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 15 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'shared', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  try {
    const { started, url } = await ensureBackend((m) => console.log('[backend]', m));
    iStartedBackend = started;
    await win.loadURL(url + '/brain');
  } catch (err) {
    await win.loadURL(
      'data:text/html,' + encodeURIComponent(`
        <body style="background:#04060a;color:#e8f4ff;font:14px -apple-system;
                     display:grid;place-items:center;height:100vh;margin:0;
                     text-align:center">
          <div>
            <h2 style="font-weight:400">Backend unavailable</h2>
            <p style="opacity:.6">${String(err.message)}</p>
          </div>
        </body>`));
  }
}

// A real menu here, unlike the JARVIS app — this is the app you sit in.
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'Brain',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R',
          click: () => win && win.reload() },
        { label: 'Toggle DevTools', accelerator: 'CmdOrCtrl+Alt+I',
          click: () => win && win.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: 'Open JARVIS window', accelerator: 'CmdOrCtrl+Shift+J',
          click: () => shell.openExternal('http://127.0.0.1:8420/') },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

let micState = { ok: false, reason: 'not checked yet' };

ipcMain.handle('mic-status', () => micState);
ipcMain.on('open-mic-settings', () => {
  // Deep link straight to the Microphone pane. Telling someone to "go to
  // System Settings" and leaving them to find it is how this stays broken.
  _shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
});

app.whenReady().then(async () => {
  micState = await ensureMicrophone((m) => console.log('[mic]', m));
  if (!micState.ok) console.warn('[mic] unavailable —', micState.reason);

  buildMenu();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => { if (iStartedBackend) stopBackend(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
