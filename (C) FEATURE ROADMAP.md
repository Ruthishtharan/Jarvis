# JARVIS Feature Roadmap — V1 vs V2

**Today's Date:** 2026-08-22  
**May 5 Deadline:** ~2 weeks away  
**Goal:** Prioritize what ships in V1 (May 5) vs V2 (post-ship)

---

## 🎯 Your Feature Requests

1. ✅ **Internet access** — Real-time data, web search, current affairs
2. ✅ **Startup automation** — Active on laptop boot (wake-word only)
3. ✅ **Toggle on/off button** — UI control, stays on until shutdown
4. ✅ **Coding knowledge** — Any programming language
5. ✅ **Frontend application** — Customization dashboard
6. ✅ **Customization options** — User preferences UI

---

## 📋 V1 MVP (Ship by May 5) — ~80% of Value

### What's Included
- ✅ Toggle on/off button (macOS menu bar)
- ✅ Startup daemon (launches with macOS)
- ✅ Web search integration (already have duckduckgo-search)
- ✅ Groq context includes coding questions
- ✅ Basic customization via .env file

### What's NOT Included (V2)
- ❌ Full frontend app (too big for 2 weeks)
- ❌ Advanced customization UI (can come after)
- ❌ Real-time news/weather dashboard (V2)
- ❌ Self-learning from internet (V2)

### Estimated Effort
- Toggle button: 3-4 hours
- Startup daemon: 2-3 hours
- Web search integration: 2-3 hours (mostly already done)
- Testing & refinement: 3-4 hours
- **Total: ~10-14 hours** ✅ Doable before May 5

---

## 🚀 V2 Full Edition (Post-May 5) — The Dream Version

### What's Included
- ✅ Full React/PyQt frontend dashboard
- ✅ Real-time news + current affairs integration
- ✅ Advanced customization UI
- ✅ Coding assistant (with GitHub integration)
- ✅ Settings persistence
- ✅ Custom skill creation UI
- ✅ Voice command history
- ✅ Performance analytics
- ✅ Memory management UI

### Estimated Timeline
- Design: 1 week
- Development: 2-3 weeks
- Testing: 1 week
- **Total: 4-5 weeks post-V1**

---

## 🏗️ Architecture Changes Needed

### V1 (Quick Win)
```
┌─────────────────────────────────────┐
│      JARVIS Daemon (Always On)      │
│  ┌─────────────────────────────────┐│
│  │  Core Engine                    ││
│  │  • Audio listener               ││
│  │  • Intent routing               ││
│  │  • Skill execution              ││
│  │  • Web search                   ││
│  │  • Groq LLM access              ││
│  └─────────────────────────────────┘│
│            ▲                         │
│            │ Wake-word only          │
│      Listening (Idle)               │
└─────────────────────────────────────┘
           ▲
           │ Toggle on/off
      Status Bar Button (Tray)
```

### V2 (Full Featured)
```
┌──────────────────────────────────────────────────────┐
│              JARVIS Desktop Application              │
│  ┌──────────────────────────────────────────────────┐│
│  │  • Settings + Customization                      ││
│  │  • Real-time dashboard (news, weather, coding)   ││
│  │  • Command history + analytics                   ││
│  │  • Voice recorder + playback                      ││
│  │  • Skill management                              ││
│  └──────────────────────────────────────────────────┘│
│                      ▼                               │
│  ┌──────────────────────────────────────────────────┐│
│  │      JARVIS Backend Daemon (Always On)           ││
│  │  • Audio listener                                ││
│  │  • Intent routing                                ││
│  │  • Skill execution                               ││
│  │  • Web search + news API                         ││
│  │  • Code execution sandbox                        ││
│  │  • Groq LLM + local models                       ││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
           ▲
           │ Toggle on/off, customize settings
      Background Process (LaunchAgent)
```

---

## 📝 V1 Implementation Plan

### Task 1: macOS Startup Daemon (2-3 hours)
**What:** Register JARVIS to launch on system startup  
**How:** Create macOS LaunchAgent plist file

**File to create:** `~/Library/LaunchAgents/com.jarvis.ai.plist`
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jarvis.ai</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/Users/ruthish/Projects/Jarvis.ai/run.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/ruthish/Projects/Jarvis.ai/data/logs/startup.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/ruthish/Projects/Jarvis.ai/data/logs/error.log</string>
</dict>
</plist>
```

**Script to register:**
```bash
launchctl load ~/Library/LaunchAgents/com.jarvis.ai.plist
```

**Implementation time:** ~1 hour

---

### Task 2: Menu Bar Toggle Button (3-4 hours)
**What:** Status bar app to turn JARVIS on/off

**Tech:** PyObjC (native macOS, lightweight)  
**File:** `cli/menu_bar.py` (NEW)

**Features:**
- Status bar icon (shows on/off status)
- Click → toggle JARVIS on/off
- Left-click: toggle
- Right-click: open menu (quit, settings, restart)
- Shows status: "🟢 JARVIS On" or "🔴 JARVIS Off"

**Implementation time:** ~2-3 hours

---

### Task 3: Web Search Integration (2-3 hours)
**What:** JARVIS can search internet for current info

**Already have:** `duckduckgo-search` library (see AI Web Scraper project)  
**New:** Add web search skill

**File:** `skills/web_search.py` (NEW)

**Examples:**
- "what's trending on twitter" → searches, returns results
- "latest news about AI" → web search
- "what's the weather in london" → weather API
- "how to write python async code" → tutorial search

**Implementation time:** ~1-2 hours

---

### Task 4: Coding Assistant (Built-in) (1-2 hours)
**What:** JARVIS already has Groq access (Llama 3.3 70B = excellent coding)

**Just add:** Coding-specific skill with system prompt

**File:** `skills/coding_assistant.py` (NEW)

**Examples:**
- "how do i write a python async function"
- "write me a react component for a todo list"
- "debug this javascript error: [code]"
- "explain async await in javascript"
- "what's the best way to handle errors in golang"

**Implementation time:** ~1 hour (Groq already handles the coding)

---

### Task 5: Basic Customization via Config (1-2 hours)
**What:** User can customize JARVIS without code changes

**File:** `config/user_settings.json` (NEW)

```json
{
  "voice": "Samantha",
  "tts_rate": 160,
  "wake_word": "jarvis",
  "auto_start": true,
  "web_search_enabled": true,
  "coding_assistant_enabled": true,
  "max_search_results": 5,
  "timezone": "Asia/Kolkata",
  "user_name": "Ruthish",
  "theme": "dark"
}
```

**Implementation time:** ~1 hour

---

## 🎯 V1 Feature Summary

| Feature | V1 | How | Time |
|---------|----|----|------|
| Startup daemon | ✅ | LaunchAgent plist | 1-2h |
| Toggle button | ✅ | PyObjC menu bar app | 2-3h |
| Web search | ✅ | Web skill + duckduckgo | 1-2h |
| Coding assistant | ✅ | Groq system prompt | 1h |
| Config file | ✅ | JSON settings | 1h |
| **Total** | — | — | **7-9 hours** |

---

## 📊 Impact per Time Investment

| Feature | Value | Effort | ROI |
|---------|-------|--------|-----|
| Startup daemon | High (always on) | 1-2h | ⭐⭐⭐⭐⭐ |
| Toggle button | High (easy control) | 2-3h | ⭐⭐⭐⭐⭐ |
| Web search | High (real data) | 1-2h | ⭐⭐⭐⭐ |
| Coding assistant | High (useful) | 1h | ⭐⭐⭐⭐ |
| Config file | Medium (nice-to-have) | 1h | ⭐⭐⭐ |

---

## 🎬 V1 Shipping Timeline

```
TODAY (2026-08-22)
├─ Finalize responsiveness fixes ✅ (done)
└─ Start V1 features

TOMORROW-WED (2026-08-23-24)
├─ Build startup daemon
├─ Build toggle button
└─ Integrate web search

THU-FRI (2026-08-25-26)
├─ Add coding assistant
├─ Test all features
└─ Polish

SAT-SUN (2026-08-27-28)
├─ Final testing
├─ Write documentation
└─ Commit to GitHub

MON-APR 28 (2026-04-28 — May 5)
├─ Buffer for bug fixes
├─ Record demo video
└─ SHIP! 🚀
```

---

## 💾 V2 Roadmap (Post-May 5)

After you ship V1, plan V2:

### Phase 1: Frontend Dashboard (Weeks 2-3)
- React or PyQt desktop app
- Real-time dashboard (CPU, memory, JARVIS status)
- Settings/customization UI
- Voice command history

### Phase 2: Advanced Integrations (Weeks 4-5)
- News API (NewsAPI, Guardian)
- Weather API (OpenWeatherMap)
- Stock prices (if interested)
- GitHub integration (for code)

### Phase 3: Self-Learning (Weeks 6+)
- JARVIS learns from your commands
- Personalized responses
- Custom workflows
- Skill marketplace

---

## 🚨 Key Decisions Before We Start

### Decision 1: Frontend Technology
**For V2, which do you prefer?**
- [ ] **React Desktop** (Electron) — Modern, web-based, easiest to deploy
- [ ] **PyQt** — Native, lightweight, integrated with Python backend
- [ ] **Tkinter** — Simple, built-in, minimal setup

**Recommendation:** React (Electron) for V2 — looks modern, easy to ship

### Decision 2: Code Location
**Where should skills live?**
- [ ] Current: `skills/` folder (each skill is a Python class)
- [ ] Recommendation: Keep same pattern, add new skills as needed

### Decision 3: Data Storage
**Where should settings/data live?**
- [ ] `~/.jarvis/` (hidden folder in home)
- [ ] `~/Projects/Jarvis.ai/data/` (project folder)

**Recommendation:** `~/.jarvis/` (cleaner, standard Unix pattern)

---

## ✅ Recommendation: Start V1 Now

**You have time.** 7-9 hours of work, spread over 5 days = totally doable before May 5.

**Impact:** JARVIS becomes a "real" assistant:
- Always on ✅
- Easy to control ✅
- Web-aware ✅
- Coding-capable ✅

**Plan:**
1. Today: Merge responsiveness fixes + plan V1
2. Tomorrow: Start V1 features (daemon + toggle button)
3. Next 3 days: Finish web search + coding assistant
4. Final week: Testing + polish
5. May 5: Ship! 🚀

---

**Ready to build V1? I'll start with startup daemon + toggle button.** Let's gooo! 💪
