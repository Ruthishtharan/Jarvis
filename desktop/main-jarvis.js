/* JARVIS — the voice app.
 *
 * A frameless, always-available window showing the star. This app is
 * deliberately minimal: no menus, no chrome, no settings. Everything
 * configurable lives in the JARVIS Brain app.
 */

const { app, ipcMain, shell: _shell, BrowserWindow, globalShortcut, shell } = require('electron');
const path = require('path');
const { ensureBackend, stopBackend } = require('./shared/backend');
const { ensureMicrophone } = require('./shared/media');

// Must run before app 'ready' — macOS reads the menu-bar name at launch.
app.setName('Neutron');

let win = null;
let iStartedBackend = false;

async function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#000000',
    title: 'Neutron',
    titleBarStyle: 'hiddenInset',   // keeps traffic lights, drops the bar
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'shared', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Don't flash an empty window while the backend warms up.
  win.once('ready-to-show', () => win.show());

  // External links open in the real browser, not inside JARVIS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  try {
    const { started, url } = await ensureBackend((m) => console.log('[backend]', m));
    iStartedBackend = started;
    await win.loadURL(url);
  } catch (err) {
    await win.loadURL(
      'data:text/html,' + encodeURIComponent(`
        <body style="background:#000;color:#e8f4ff;font:14px -apple-system;
                     display:grid;place-items:center;height:100vh;margin:0;
                     text-align:center">
          <div>
            <h2 style="font-weight:400">JARVIS could not start its backend</h2>
            <p style="opacity:.6">${String(err.message)}</p>
            <p style="opacity:.6;font-family:monospace;font-size:12px">
              cd "${path.resolve(__dirname, '..')}" &amp;&amp; python3 web/server.py
            </p>
          </div>
        </body>`));
  }
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

  await createWindow();

  // Summon JARVIS from anywhere. The whole point is not having to go find it.
  globalShortcut.register('CommandOrControl+Shift+J', () => {
    if (!win) return;
    if (win.isVisible() && win.isFocused()) win.hide();
    else { win.show(); win.focus(); }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (win) win.show();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  // Only tear down the backend if this app started it — the Brain app may
  // still be using it.
  if (iStartedBackend) stopBackend();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
