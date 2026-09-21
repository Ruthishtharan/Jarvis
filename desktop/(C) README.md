# (C) JARVIS Desktop

Two separate macOS apps that share one brain.

| App | What it is | Run |
|---|---|---|
| **JARVIS** | The star. Voice only. No settings, no chrome. | `npm run jarvis` |
| **JARVIS Brain** | The cortex. Every control there is. | `npm run brain` |

```bash
cd "/Users/ruthish/Projects/Jarvis.ai/desktop"
npm run jarvis     # the voice app
npm run brain      # the control app
npm run both       # both at once
```

---

## Why two apps and not two tabs

The voice app should be something you talk *at* — glanceable, no reading, no
buttons to hunt for. The control app is something you sit *in*. Those are
opposite designs, and cramming both into one window made the voice app worse.

They share state through the backend and through `localStorage`, so a setting
changed in Brain takes effect in JARVIS immediately — no restart, no reload.

---

## The backend is shared, not owned

Whichever app launches first starts the Python server. The second finds it
already listening and attaches:

```
[backend] starting backend with /usr/local/bin/python3   ← first app
[backend] backend already running — attaching            ← second app
```

Only the app that *started* the backend shuts it down. Quitting Brain does not
take JARVIS's brain away with it.

Verified: both apps running, exactly one `web/server.py` process.

---

## JARVIS app

- Frameless, `hiddenInset` title bar — the star runs edge to edge
- **⌘⇧J from anywhere** summons or hides it. The point of a voice assistant is
  not having to go find it
- External links open in the real browser, never inside the app
- No menu bar. There is nothing to configure here on purpose

## JARVIS Brain app

Six tabs, everything JARVIS has:

| Tab | Contents |
|---|---|
| **Mind** | Learning accuracy, training samples, pending conversations, cycle history, and a button to run a learning cycle |
| **Voice** | Continuous listening, speak-aloud, rate, voice picker, engine status |
| **Memory** | Facts (add/forget) and full searchable conversation history |
| **Skills** | All 28 skills and what each one does |
| **Appearance** | Switch star ↔ cortical, plus every simulation slider for both |
| **System** | Status, model config, a live command test, session export |

The brain renders behind the panel rather than as a full backdrop, so dense
text stays readable over it.

---

## Building distributable `.app` bundles

```bash
npm run build:jarvis
npm run build:brain
```

Note: `electron-builder` needs to download platform binaries the first time,
which is slow on a poor connection. Running from source (`npm run jarvis`)
needs no download at all.

---

## Requirements

- Node 18+ and Electron (already in `node_modules`)
- Python 3 with the project's deps — the supervisor looks for
  `$JARVIS_PYTHON`, then `venv/`, `.venv/`, Homebrew, then plain `python3`
- Voice input needs Chromium's speech API, which Electron provides. This is
  one reason the desktop app is better than Safari for this
