# (C) JARVIS Web

A browser front end for JARVIS — particle-sun voice visualiser, live command
console, and full access to the memory database.

```bash
python3 web/server.py
# → http://127.0.0.1:8420
```

No build step. No npm. Vanilla JS, served by FastAPI.

---

## Why this exists

JARVIS had **no HTTP surface at all**. The Electron app talks to it over IPC by
spawning the Python process, which works for exactly one desktop app and
nothing else. This exposes the same brain over HTTP + WebSocket, so any
browser — including your phone on the same wifi — can drive it.

---

## The interface

**Voice-first.** The star is the interface; everything else stays out of the
way until you ask for it.

```
   ● online · say something              transcript   settings
                                                      
                  ✦ the star ✦
                                                      
              what you just said            ← small, grey, italic while interim
        What JARVIS said back               ← large, the thing you read
                                                      
              ▁▃▅▇▅▃▁  waveform             ← real mic amplitude
                  ( ● )                     ← hold Space, or click
                 or type…                   ← fallback
```

| Control | Action |
|---|---|
| **Hold `Space`** | push-to-talk — release to send |
| Click the orb | toggle listening |
| `/` | focus the text input |
| `H` | transcript drawer |
| `,` | settings drawer |
| `Esc` | close drawers, stop listening, stop speaking |

**Settings** holds: speak-replies toggle, continuous listening, speaking rate,
voice picker, live system status, and the star sliders (collapsed — this is a
voice tool first).

**Continuous mode** re-arms the mic only *after* speech finishes. Re-arming
earlier makes JARVIS transcribe its own reply and talk to itself.

The waveform samples the low 45% of the spectrum. That's where speech lives;
the top half is mostly empty air and would flatline the display.

## The visualiser

A **volumetric star** — 20,000 tetrahedra as a three.js `InstancedMesh`,
rendered with WebGL and `UnrealBloomPass`. Ported from the AI Particle
Simulator "THE SUN" export.

Layers, addressed by normalised particle index `t = i / count`:

| `t` range | Layer |
|---|---|
| < 0.12 | fusing core — cbrt-uniform sphere with fusion-burst flicker |
| < 0.32 | radiative diffusion zone |
| < 0.55 | convective cells — three-wave granulation flow |
| < 0.68 | photosphere — granules plus sunspot darkening |
| < 0.78 | chromosphere — spicules |
| < 0.90 | coronal loops, or near solar wind |
| < 0.97 | erupting prominences |
| else | far solar wind |

**Bloom is what sells it.** `UnrealBloomPass` at strength 1.8 with threshold 0
means every lit instance blooms, so the core reads as plasma rather than
20,000 discrete triangles.

The star sits in the upper two-thirds (`controls.target.y = -26`) so the lower
third stays clear for the transcript and mic.

### JARVIS states bias the simulation

Each state pushes `heat / churn / wind / flare / spin / bloom` multipliers, so
the star stays the same object while it reacts.

| State | Look |
|---|---|
| `idle` | slow gold rotation |
| `listening` | brighter, faster; **real mic amplitude** lifts every layer |
| `thinking` | hot, fast churn, 3× spin |
| `speaking` | brightest bloom, heavy solar wind |
| `error` | cooled, collapsed, slow |

### Two optimisations over the source

1. **Precomputed hashes.** `h1..h6` are constant per particle, but the source
   recomputed them every frame — 6 × `sin`+`abs`+`mod` × 20,000 × 60fps is
   ~7.2M wasted `sin()` calls per second. Now `Float32Array`s built once.
2. **Hoisted control reads.** The six `addControl()` calls sat *inside* the
   per-particle loop: 120,000 function calls per frame returning the same six
   numbers. Moved above the loop.

### Camera framing

The source sits at `z=100`, but its far solar wind reaches ~4× the sun radius,
so at that distance the outflow fills the frame and the disc is lost. This
sits at `z=145` — found by screenshotting, looking, and adjusting.

### JARVIS states bias the simulation

Each state pushes `heat / churn / wind / flare / spin / bloom` multipliers, so
the star stays the same object while it reacts.

| State | Look |
|---|---|
| `idle` | slow gold rotation |
| `listening` | brighter, faster; **real mic amplitude** lifts every layer |
| `thinking` | hot, fast churn, 3× spin, stronger flares |
| `speaking` | brightest bloom, heavy solar wind |
| `error` | cooled, collapsed, slow |

### Vendored, not CDN

`three@0.160.0` and five addons are vendored to `static/vendor/three/`
(2.1 MB, 10 files) behind an import map. The page works with **no network** —
which matters on a flaky connection.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | health, models, DB counts, fallback tiers |
| GET | `/api/skills` | all 28 registered skills |
| POST | `/api/command` | run a command → reply, skill, confidence, latency |
| GET | `/api/events` | recent conversation history |
| GET | `/api/facts` | remembered facts |
| POST | `/api/facts` | remember something |
| DELETE | `/api/facts/{id}` | forget a fact |
| GET | `/api/search?q=` | full-text search across facts + events |
| WS | `/ws` | live state stream |

### Verified working

```
/api/status    → 28 skills, 96 events, fallback tiers reported
/api/command   → "what time is it" → time_date, 0.95 conf, 1ms
/api/facts     → POST/GET/DELETE round trip
/api/search    → "gradu" → matches "graduates" (prefix)
/ws            → thinking → speaking → reply frames pushed live
```

---

## Two bugs found while wiring this up

**`recent_events()` drops columns.** It selects five fields, so every event
reported `source=''` and `confidence=0.0` even though SQLite stores both
correctly. The web history view reads the DB directly (read-only) to get the
real routing tier and score. `memory/store.py` was left untouched.

**FTS5 prefix search was impossible through `recall()`.** `_fts_query()`
strips every non-alphanumeric character while sanitising, which removes the
`*` that FTS5 needs for prefix matching. So searching "graduate" missed
"graduates". `_prefix_search_facts()` queries the index directly as a fallback
when the exact match returns nothing.

---

## Speech

Speech recognition and synthesis both run **in the browser** (Web Speech API),
not through the desktop TTS. Two processes fighting over the speakers is worse
than either alone, and it keeps the server headless — it can run over SSH or
on another machine entirely.

Voice input needs **Chrome or Edge**. Safari and Firefox get a disabled mic
button and text input still works.

---

## Keyboard

| Key | Action |
|---|---|
| `Space` | toggle mic (when not typing) |
| `/` | focus the input |
| `Enter` | send |

---

## Files

```
web/
├── (C) README.md
├── server.py          FastAPI — REST + WebSocket
└── static/
    ├── index.html
    ├── style.css      dark HUD
    ├── particles.js   the sun (no dependencies)
    └── app.js         WS client, speech, API calls
```

## Caveats

- Binds to `127.0.0.1` by default. Use `--host 0.0.0.0` to reach it from your
  phone — but there is **no authentication**, so only do that on a network you
  trust.
- CORS is wide open for the same reason: it's a local tool.
- The LLM path is only as healthy as your Groq key. If `/api/status` shows
  `"has_key": true` but conversation replies say "having trouble reaching
  Groq", the key is being rejected — rotate it at console.groq.com.
