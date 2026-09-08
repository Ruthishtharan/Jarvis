const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const isDev = require('electron-is-dev');
const path = require('path');
const { ipcMain } = require('electron');
const { spawn, exec } = require('child_process');
const fs = require('fs');

let mainWindow;
let jarvisProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
    },
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../build/index.html')}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC Handlers

/**
 * Get JARVIS status
 */
ipcMain.handle('get-jarvis-status', async (event) => {
  return new Promise((resolve) => {
    exec('pgrep -f "python.*run.py"', (error, stdout) => {
      if (stdout && stdout.trim()) {
        resolve({ status: 'running', pid: stdout.trim() });
      } else {
        resolve({ status: 'stopped' });
      }
    });
  });
});

/**
 * Start JARVIS
 */
ipcMain.handle('start-jarvis', async (event) => {
  return new Promise((resolve) => {
    try {
      // Check if already running
      exec('pgrep -f "python.*run.py"', (error, stdout) => {
        if (stdout && stdout.trim()) {
          resolve({ success: true, message: 'JARVIS already running' });
          return;
        }

        // Get the path to run.py
        const jarvisPath = path.join(__dirname, '../../run.py');

        if (!fs.existsSync(jarvisPath)) {
          resolve({ success: false, message: `run.py not found at ${jarvisPath}` });
          return;
        }

        // Start JARVIS process
        jarvisProcess = spawn('python3', [jarvisPath], {
          detached: true,
          stdio: 'ignore',
          cwd: path.join(__dirname, '../..'),
        });

        jarvisProcess.unref();

        // Wait a bit for process to start
        setTimeout(() => {
          resolve({ success: true, message: 'JARVIS starting...' });
        }, 1000);
      });
    } catch (error) {
      console.error('Error starting JARVIS:', error);
      resolve({ success: false, message: error.message });
    }
  });
});

/**
 * Stop JARVIS
 */
ipcMain.handle('stop-jarvis', async (event) => {
  return new Promise((resolve) => {
    try {
      exec('pkill -f "python.*run.py"', (error) => {
        setTimeout(() => {
          resolve({ success: true, message: 'JARVIS stopped' });
        }, 500);
      });
    } catch (error) {
      resolve({ success: false, message: error.message });
    }
  });
});

/**
 * Get configuration
 */
ipcMain.handle('get-config', async (event) => {
  try {
    const configPath = path.join(process.env.HOME, '.jarvis', 'config.json');

    if (!fs.existsSync(configPath)) {
      // Return default config if file doesn't exist
      return {
        success: true,
        config: {
          voice: 'Samantha',
          tts_rate: 160,
          wake_word: 'jarvis',
          user_name: 'Boss',
          timezone: 'Asia/Kolkata',
          skills: {
            web_search: true,
            coding_assistant: true,
            conversation: true,
          },
        },
      };
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return { success: true, config };
  } catch (error) {
    console.error('Error reading config:', error);
    return { success: false, message: error.message };
  }
});

/**
 * Save configuration
 */
ipcMain.handle('save-config', async (event, config) => {
  try {
    const configDir = path.join(process.env.HOME, '.jarvis');
    const configPath = path.join(configDir, 'config.json');

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true, message: 'Configuration saved' };
  } catch (error) {
    console.error('Error saving config:', error);
    return { success: false, message: error.message };
  }
});

/**
 * Get command history
 */
ipcMain.handle('get-history', async (event) => {
  try {
    const historyPath = path.join(
      __dirname,
      '../../data/memory_store/conversation_history.json'
    );

    if (!fs.existsSync(historyPath)) {
      return { success: true, history: [] };
    }

    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    return { success: true, history: Array.isArray(history) ? history.slice(-20) : [] };
  } catch (error) {
    console.error('Error reading history:', error);
    return { success: false, message: error.message, history: [] };
  }
});

/**
 * Get logs
 */
ipcMain.handle('get-logs', async (event) => {
  try {
    const logsPath = path.join(__dirname, '../../data/logs/jarvis.log');

    if (!fs.existsSync(logsPath)) {
      return { success: true, logs: [] };
    }

    const logs = fs.readFileSync(logsPath, 'utf-8').split('\n').slice(-50);
    return { success: true, logs };
  } catch (error) {
    console.error('Error reading logs:', error);
    return { success: false, message: error.message, logs: [] };
  }
});

/**
 * Get live voice state (idle / listening / thinking / speaking).
 *
 * Written by core/voice_state.py on every pipeline transition. A missing
 * file means the assistant isn't running, which is 'offline' rather than an
 * error — that's the normal state before you press Initialize.
 */
ipcMain.handle('get-voice-state', async () => {
  try {
    const statePath = path.join(__dirname, '../../data/state.json');
    if (!fs.existsSync(statePath)) {
      return { state: 'offline' };
    }
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

    // Guard against a stale file left behind by a crashed process: if
    // nothing has updated it recently, treat the assistant as gone rather
    // than showing a reactor frozen mid-"listening".
    const age = Date.now() / 1000 - (raw.updated_at || 0);
    if (age > 30) {
      return { state: 'offline', stale: true };
    }
    return raw;
  } catch (e) {
    return { state: 'offline', error: String(e) };
  }
});

/**
 * Current voice amplitude, 0..1.
 *
 * Written ~10x/second by voice/audio_level.py from the PCM actually reaching
 * the speaker. Read as plain text rather than JSON: at this rate a torn read
 * is likely, and a bad float is simply ignored, whereas a JSON parse error
 * would need handling on every frame.
 */
ipcMain.handle('get-audio-level', async () => {
  try {
    const levelPath = path.join(__dirname, '../../data/level');
    if (!fs.existsSync(levelPath)) return 0;
    const value = parseFloat(fs.readFileSync(levelPath, 'utf-8'));
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  } catch {
    return 0;
  }
});

/**
 * Get performance metrics
 */
ipcMain.handle('get-metrics', async (event) => {
  try {
    const metricsPath = path.join(__dirname, '../../data/metrics.json');

    if (!fs.existsSync(metricsPath)) {
      return {
        success: true,
        metrics: {
          avgLatency: 0,
          commandsProcessed: 0,
          uptime: 0,
        },
      };
    }

    const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
    return { success: true, metrics };
  } catch (error) {
    return {
      success: false,
      metrics: {
        avgLatency: 0,
        commandsProcessed: 0,
        uptime: 0,
      },
    };
  }
});
