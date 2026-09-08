# JARVIS Desktop App — Setup & Launch Guide

**Status:** ✅ Complete & Ready to Launch  
**Technology:** React + Electron  
**UI Theme:** Dark professional theme with green/cyan accent  
**Platform:** macOS  

---

## 🎯 What's Included

The desktop app provides:
- **Dashboard** — Real-time metrics, status monitoring, quick actions
- **Command History** — View all commands + responses with stats
- **Logs Viewer** — Live logs with color-coded levels (Error, Warning, Info, Debug)
- **Settings Panel** — Customize voice, TTS speed, wake word, enable/disable skills
- **Status Indicator** — 🟢 Online / 🔴 Offline status badge
- **Toggle Control** — Start/Stop JARVIS with one click

---

## 📁 Project Structure

```
desktop/
├── package.json              ← Dependencies & scripts
├── public/
│   ├── electron.js          ← Electron main process
│   └── preload.js           ← IPC security layer
├── src/
│   ├── App.js               ← Main app component
│   ├── App.css              ← Main styling
│   ├── index.js             ← React entry point
│   ├── index.css            ← Global styles
│   ├── components/
│   │   ├── Dashboard.js     ← Metrics & status
│   │   ├── Settings.js      ← Configuration panel
│   │   ├── CommandHistory.js ← Command log viewer
│   │   └── Logs.js          ← Real-time logs
│   └── styles/
│       ├── Dashboard.css
│       ├── Settings.css
│       ├── CommandHistory.css
│       └── Logs.css
```

---

## 🚀 Installation & Setup (5 minutes)

### Step 1: Navigate to Desktop Folder
```bash
cd /Users/ruthish/Projects/Jarvis.ai/desktop
```

### Step 2: Install Node Dependencies
```bash
npm install
```

**What it installs:**
- React 18.2.0
- Electron 26.0.0
- Recharts (charting)
- Axios (HTTP)
- Build tools

### Step 3: Start Development Mode
```bash
npm start
```

**What happens:**
1. React dev server starts on http://localhost:3000
2. Electron window opens automatically
3. React app loads inside Electron
4. Hot-reload enabled (changes auto-refresh)

**Wait for:** "Compiled successfully" message in terminal

---

## 📊 Desktop App Features

### Dashboard Tab
- **Status Card** — Shows 🟢 Online, 🔴 Offline, ⚠️ Error
- **Metrics Cards** — Avg latency, commands processed, uptime
- **Latency Chart** — Real-time graph of response times
- **Quick Actions** — Test voice, open logs, restart, record demo
- **Features List** — Highlights available skills (web search, coding, etc.)

**When to use:** Check JARVIS health, see performance metrics

### Command History Tab
- **Recent Commands** — Last 20 commands with full I/O
- **Color-coded** — Easy to scan
- **Statistics** — Total commands, avg words, skills used
- **Auto-refresh** — Updates every 3 seconds

**When to use:** Review what JARVIS has been doing, debug issues

### Logs Tab
- **Real-time Logs** — Color-coded by level (Error, Warning, Info, Debug)
- **Auto-refresh Toggle** — Turn on/off live updates
- **Last 50 Lines** — Recent activity
- **Log Legend** — Color meaning reference

**When to use:** Troubleshoot problems, see detailed activity

### Settings Tab
- **Voice Selection** — Samantha, Alex, Alice, Victoria, Daniel, Moira, Fiona
- **Speech Speed** — 100 (slow/natural) to 200 (fast)
- **Wake Word** — Change from "jarvis" to custom word
- **Personal Info** — Your name, timezone
- **Skills Toggle** — Enable/disable web search, coding, conversation
- **Save Button** — Persists to ~/.jarvis/config.json

**When to use:** Personalize JARVIS to your preferences

---

## 🎮 How to Use

### Starting JARVIS from Desktop App
1. Click **"Start"** button in top-right
2. Wait for status to change to **🟢 Online**
3. Check **Dashboard** tab for metrics

### Stopping JARVIS
1. Click **"Stop"** button in top-right
2. Status changes to **🔴 Offline**
3. All processes stop

### Viewing Command History
1. Click **"Command History"** tab
2. See all commands you've given
3. See JARVIS's responses
4. Check which skill was used

### Checking Logs
1. Click **"Logs"** tab
2. Watch for errors (red) or warnings (orange)
3. Toggle **"Auto-refresh"** to pause/resume
4. Use legend to understand log levels

### Customizing JARVIS
1. Click **"Settings"** tab
2. Change voice, speed, wake word
3. Enable/disable skills
4. Click **"Save Settings"**
5. Restart JARVIS for changes to take effect

---

## ⚙️ Development Commands

| Command | What It Does |
|---------|-------------|
| `npm start` | Start dev mode (React + Electron) |
| `npm run react-start` | React dev server only (http://localhost:3000) |
| `npm run electron-start` | Electron only (wait for React first) |
| `npm run build` | Build production app + Electron installer |
| `npm run react-build` | Build React production bundle |
| `npm run dev` | Development mode with verbose logging |

---

## 🔧 Troubleshooting

### "Port 3000 already in use"
```bash
# Kill the process
lsof -ti:3000 | xargs kill -9

# Then restart
npm start
```

### "Electron fails to start"
```bash
# Reinstall Electron
npm install --save-dev electron@latest

# Try again
npm start
```

### "JARVIS won't start from desktop app"
- Check that `run.py` exists at `/Users/ruthish/Projects/Jarvis.ai/run.py`
- Check that Python 3 is installed: `python3 --version`
- Check terminal logs for errors

### "Settings won't save"
- Check that `~/.jarvis/` directory exists
- Check folder permissions: `ls -la ~/.jarvis/`
- Try creating it manually: `mkdir -p ~/.jarvis`

### "Logs not showing"
- Restart JARVIS from the desktop app
- Check file exists: `cat /Users/ruthish/Projects/Jarvis.ai/data/logs/jarvis.log`
- Enable auto-refresh in Logs tab

---

## 🎨 UI Theme

**Color Scheme:**
- Primary: Dark blue/purple (`#0a0e27`, `#1a1f3a`)
- Accent: Neon green (`#00ff88`) + Cyan (`#00ccff`)
- Text: Light (`#e0e6ff`)
- Muted: Gray (`#a0aec0`)

**Animations:**
- Smooth transitions (0.3s)
- Pulse effect on status dot
- Hover effects on cards
- Fade-in/out on notifications

**Responsive:**
- Works on 1200px+ (laptop)
- Adapts to smaller screens
- Touch-friendly buttons

---

## 📦 Building for Production

### Create DMG Installer (macOS)
```bash
npm run build
```

**Output:**
- `dist/JARVIS-1.0.0.dmg` — Drag-and-drop installer
- `dist/JARVIS-1.0.0.zip` — Portable version

### Sign App (Optional, for distribution)
```bash
# Requires developer certificate from Apple
# Skip for personal use
```

---

## 🔌 IPC Communication

The desktop app communicates with JARVIS backend via Electron IPC:

```javascript
// Get JARVIS status
const status = await window.electronAPI.getJarvisStatus();

// Start/stop JARVIS
await window.electronAPI.startJarvis();
await window.electronAPI.stopJarvis();

// Load/save config
const config = await window.electronAPI.getConfig();
await window.electronAPI.saveConfig(config);

// Get history and logs
const history = await window.electronAPI.getHistory();
const logs = await window.electronAPI.getLogs();
const metrics = await window.electronAPI.getMetrics();
```

All IPC calls are **secure** — preload.js only exposes what's needed.

---

## 📱 Features Roadmap (V2+)

**Coming Soon:**
- [ ] Voice command recording button
- [ ] Custom keyboard shortcuts
- [ ] Dark/light theme toggle
- [ ] Export logs/history to CSV
- [ ] System tray integration
- [ ] Auto-update checker
- [ ] Performance profiler UI
- [ ] Skill enable/disable from UI (no config edit)
- [ ] Custom wake-word trainer
- [ ] Voice demo player

---

## 💡 Tips & Tricks

### Maximize Performance
1. Disable skills you don't use in Settings
2. Lower TTS rate (150-160) for natural speech
3. Close other apps to free up CPU
4. Check Logs for any errors/warnings

### Customize Appearance
1. Edit `src/App.css` for global styles
2. Edit `src/styles/*.css` for component styles
3. Change colors in CSS variables
4. Rebuild: `npm run build`

### Debug Issues
1. Check Logs tab for errors
2. Open DevTools: `Ctrl+Shift+I` (Windows) or `Cmd+Option+I` (Mac)
3. Look at Command History for what went wrong
4. Check latency in Dashboard

### Share with Others
1. Build production app: `npm run build`
2. Share the DMG file: `dist/JARVIS-1.0.0.dmg`
3. Others can drag-and-drop to install
4. Works on any macOS (10.11+)

---

## 🎯 Next Actions

### Right Now
```bash
cd /Users/ruthish/Projects/Jarvis.ai/desktop
npm install
npm start
```

### After Startup
1. Click **"Start"** button
2. Check **Dashboard** for status
3. Try **Settings** to customize
4. Review **Command History** (if you have prior commands)

### To Ship
```bash
npm run build
# Creates /dist/JARVIS-1.0.0.dmg for distribution
```

---

## 📞 Support

**Issue:** Desktop app won't start  
**Fix:** Run `npm install` again, then `npm start`

**Issue:** Electron crashes  
**Fix:** Check Node version (`node -v`, should be 14+)

**Issue:** Styles look broken  
**Fix:** Clear browser cache (Cmd+Shift+Delete in DevTools)

**Issue:** JARVIS won't start from app  
**Fix:** Run `python run.py` from terminal first to test

---

## ✨ You're All Set!

Your JARVIS desktop control panel is ready. Launch it with:

```bash
cd /Users/ruthish/Projects/Jarvis.ai/desktop
npm install
npm start
```

Then enjoy managing JARVIS from a beautiful, professional UI! 🚀

---

**Built with ❤️ using React + Electron**
