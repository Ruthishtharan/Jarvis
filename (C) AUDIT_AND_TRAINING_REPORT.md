# JARVIS — Audit & Training Report

**Date:** 2026-08-23
**Scope:** 7,625 lines of Python across 12 modules
**Outcome:** 7 bugs found and fixed, 1 trained model shipped, 27 regression tests locked in

---

## Part 1 — Bugs found and fixed

Each one was reproduced first, then fixed, then locked into
`tests/test_regressions.py`. Run the suite any time with:

```bash
python3 tests/test_regressions.py
```

### 1. TTS race condition — truncated speech + self-hearing feedback loop
**Severity: critical.** `voice/text_to_speech.py`

`speak()` began with `self.stop()` executed *outside* the lock, terminating
whatever `say` process was already running. With multiple concurrent
speakers — assistant replies, the conversation skill streaming
sentence-by-sentence, proactive agents on the scheduler thread — this meant:

- An agent firing mid-conversation **killed your reply halfway through a word**.
- The interrupted thread's `finally` cleared `speaking_state` while the *next*
  utterance was still playing, so the wake-word listener opened the mic during
  TTS and transcribed Jarvis's own voice as a command.
- `_current_process` was mutated by every caller thread simultaneously.

Converting everything to `speak_async` earlier in this project made it far
more likely to fire.

**Fix:** a single-consumer queue. One dedicated worker thread owns `say`;
everyone else enqueues. `speaking_state` is now held across the whole drain,
so the mic stays shut *between* sentences of a streamed reply too.
`stop()` became an explicit barge-in rather than an accidental side effect.

### 2. Memory store used UTC for "today"
**Severity: high.** `memory/store.py`

Events were stored with `datetime.utcnow()` but `save_daily_summary` used
local `datetime.now()`. `today_events()` compared against **UTC midnight**.
At UTC+5:30 that treats 05:30 local as the start of the day — so anything
said between midnight and 05:30 was filed under the previous day, silently
corrupting the end-of-day recap.

**Fix:** compute local midnight, convert to the equivalent UTC instant.
On-disk format unchanged, so existing rows still compare correctly.

### 3. Memory recall crashed on uppercase AND / OR / NOT
**Severity: medium.** `memory/store.py`

`recall()` joined query tokens with `" OR "` and passed them raw to FTS5.
A token that *is* an FTS5 operator raised `fts5: syntax error`. Reachable in
practice because the LLM intent classifier returns extracted entities
verbatim, without the lower-casing that STT applies.

**Fix:** every token is quoted as a string literal, with embedded quotes doubled.

### 4. `datetime.utcnow()` deprecated
**Severity: low now, breaking later.** You are on **Python 3.14**, where this
already emits `DeprecationWarning` and is scheduled for removal.

**Fix:** timezone-aware `datetime.now(timezone.utc)`, stripped to naive before
storage so the format stays byte-identical.

### 5. AppleScript had no timeout — worker-pool starvation
**Severity: high.** `integrations/macos/apple_script.py`, `utils/os_utils.py`

~40 `subprocess.run` calls had no timeout. `osascript` blocks on the
Automation permission dialog and hangs outright on unresponsive apps. These
run on a shared **4-worker** thread pool, so one hang permanently burns a
worker and **four hangs deadlock every skill in the assistant**.

This is the same bug class as the `wikipedia` library hang found earlier —
it was systemic, not a one-off.

**Fix:** every subprocess call bounded (12s default, 20-30s for screenshots
and Trash).

### 6. AppleScript injection + quote breakage
**Severity: medium.** `integrations/macos/apple_script.py`

Script text was built by interpolating values from speech transcription and
LLM entity extraction directly into AppleScript string literals. A value
containing a double quote terminated the literal and had the remainder parsed
as **executable AppleScript**. It also broke ordinary use: any notification
whose message contained an apostrophe failed with a syntax error.

**Fix:** `_q()` escapes backslashes then quotes, applied to every interpolated
value.

### 7. Wake word fired on ordinary speech — 15% false-wake rate
**Severity: high (experience).** `utils/helpers.py`

Fuzzy matching ran at 0.75 similarity over 1- and 2-gram fragments. "The java
is hot" collapses to the 2-gram `javais`, which scores **0.83** against
`jarvis`. Measured: **3 false wakes per 20 normal sentences.**

I tried tuning the threshold across 0.75–0.88 and three fragment lengths.
**No cutoff separated the classes** — killing `javais` also killed `darvies`.
Pure edit distance does not carry the signal.

**Fix:** catalogue the known mishearings and match them *exactly*
(`WAKE_WORD_VARIANTS` in `config/constants.py`), then tighten the fuzzy
matcher to 0.84 purely as a backstop. Also handles wake words appearing
mid-utterance. A false wake is worse than a missed one: a miss costs a
repeat, a false wake runs a command you never asked for.

**Result: 0 false wakes / 25, 0 missed / 11.**

### Also fixed
- `take_screenshot()` passed `~/Desktop/...` to a non-shell subprocess, where
  `~` is not expanded — it would have created a literal directory named `~`.
- The LLM routing path returned early **without** logging to memory, so
  LLM-routed commands never reached `recall` or the end-of-day recap.

---

## Part 2 — The trained model

### What you asked for, and what was actually possible

You asked to train the JARVIS model for 100 epochs. **JARVIS has no trainable
model** — reasoning comes from Groq's hosted Llama 3.3 70B, whose weights live
on their servers.

But there *was* a model worth training, and it was the highest-leverage thing
left. The router was sending every ambiguous utterance to Groq **purely to
decide which skill to run** — a 350-500ms network round trip before any work
began. A small local classifier answers that in **0.13ms**.

### The honest result

| Metric | Value |
|---|---|
| Architecture | char n-grams (2-5) + word n-grams (1-2) → TF-IDF → MLP |
| Epochs | 100 |
| Training data | 1,435 utterances, 28 classes |
| Validation accuracy | 89.9% |
| **Holdout accuracy (unseen phrasings)** | **90.2%** |
| **Accuracy above confidence gate** | **97.1% at 56% coverage** |
| Inference | 0.13ms vs ~350ms — **~2,700x faster** |

### How I got there — and the mistake worth knowing about

**First attempt: 344 examples → 97% validation.** Looked excellent.

It was not. I wrote 61 fresh utterances by hand
(`training/holdout_eval.py`) that appear nowhere in the training data. Real
accuracy was **68.9%**, and the model was *confidently wrong*: "bring the
sound down a bit" → mute at **0.96** confidence.

The validation set shared templates with training, so a `play {song}` val
example was trivially close to a `play {other song}` training example. **The
97% was measuring memorisation.**

**Diagnosis:** I had augmented the wrong axis. 36 app names × 8 templates
taught the model many *nouns* and almost no *verbs*. It knew `open {X}` cold
and had no representation for "bring up", "boot up", "pull up".

I confirmed the ceiling was data, not architecture, by testing six unrelated
model families — logistic regression, linear SVM, complement naive Bayes,
random forest, MLP — all plateaued at 77-79%. When six architectures agree,
the model is not the problem.

**Fix:** `ai/intent_paraphrases.py` — a paraphrase bank varying verbs and
sentence shapes, with slot expansion cut back to 6 values per template.
Holdout accuracy went **68.9% → 90.2%**.

### It abstains rather than guesses

The model does not always answer. Below its confidence gate (0.8, chosen at
training time) it returns `None` and the router falls through to Groq
unchanged. Most remaining holdout errors sit at 0.14–0.60 confidence, so they
correctly defer.

That is the key design property: **LLM-grade accuracy on ambiguous input,
local speed on the 56% that is unambiguous.**

### Routing pipeline now

```
1. Regex registry      ~5ms      wins outright at >=0.85
2. Local model         ~0.13ms   answers only above its gate    <-- NEW
3. Groq LLM            ~350ms    highest accuracy, always available
4. conversation skill            catch-all
```

If the model files are missing or torch is unavailable, tier 2 is skipped and
behaviour is exactly what it was before. Nothing depends on it.

---

## Files

**New**
```
ai/intent_dataset.py            handwritten seed data
ai/intent_augment.py            template expansion + noise, class-capped
ai/intent_paraphrases.py        verb/structure diversity (the actual fix)
ai/intent_classifier_local.py   gated inference
training/train_intent_model.py  100-epoch training loop
training/holdout_eval.py        honest evaluation on unseen phrasings
tests/test_regressions.py       27 tests, one per bug
data/models/                    trained artefacts
```

**Modified**
```
voice/text_to_speech.py             queue-based, single-owner
memory/store.py                     timezone + FTS5 fixes
utils/helpers.py                    wake word matching
config/constants.py                 WAKE_WORD_VARIANTS
integrations/macos/apple_script.py  timeouts + escaping
utils/os_utils.py                   AppleScript timeout
core/command_router.py              local model tier + logging fix
core/assistant.py                   TTS lifecycle
```

---

## Commands

```bash
# Run JARVIS
python3 run.py

# Verify everything still works
python3 tests/test_regressions.py

# Retrain the classifier
python3 training/train_intent_model.py --epochs 100

# Honest evaluation
python3 training/holdout_eval.py
```

---

## What I would do next

1. **Grow the dataset from real usage.** Every routed command is already
   logged to memory. Feeding your actual phrasings back into training is worth
   more than any amount of synthetic augmentation — it learns *your* speech.
2. **Calibrate confidence** with temperature scaling, so the gate can be
   lowered and coverage raised above 56% without losing accuracy.
3. **Wire the HUD to live voice state**, so the arc reactor flips to
   listening/speaking as you talk rather than idling while online.

---

## Part 3 — Feedback loop (added 2026-08-25)

The classifier's weakness was phrasings it had never seen. No amount of
invented paraphrase fixes that, because I can't guess how *you* speak. Your
own logged commands can.

### Where trustworthy labels come from

Every handled command now records **which tier routed it**:

| source | trustworthy? | why |
|---|---|---|
| `regex` ≥0.85 | **yes** | explicit pattern match — effectively free ground truth |
| `local` | no | the model's own prediction |
| `llm` | no | also a prediction |

Training on tiers 2 or 3 would be self-confirmation — the model would relabel
its own mistakes as correct and drift further with every retrain. Only regex
rows are used.

It's fair to ask what use it is to learn utterances the regex already
handles. The value isn't the utterance — it's the **vocabulary**. Learning
that you say "chuck on some music" teaches the model your register, which
generalises to nearby phrasings the regex does *not* catch.

### Schema migration

`events` gained `source` and `confidence`. Because the schema uses
`CREATE TABLE IF NOT EXISTS`, existing databases would never have picked up
new columns — so there's an explicit `_migrate()` using `PRAGMA table_info`.
Verified against a legacy database: columns added, existing rows preserved.

### Usage

```bash
python3 training/collect_feedback.py           # report only
python3 training/collect_feedback.py --write   # save to feedback_data.json
python3 training/train_intent_model.py --epochs 100
python3 training/holdout_eval.py               # confirm it actually improved
```

The collector also **audits the current model against your real utterances**
and prints the ones it gets wrong today — the highest-value examples in the
set. Feedback examples are exempt from per-class capping, since real data
outranks anything synthetic.

Verified end to end: 12 commands routed, 7 deduped as already-known, 4 novel
captured, merged into training (1435 → 1439 examples).

---

## Part 4 — Live voice state in the HUD (added 2026-08-25)

The arc reactor previously only knew whether the process was alive, so it sat
in the same idle animation whether you were mid-sentence or nothing was
happening. It now reflects the real pipeline:

```
offline -> idle -> listening -> thinking -> speaking -> idle
```

- **listening** — wake word confirmed, capturing your command
- **thinking** — routing and executing; the caption shows what you said
- **speaking** — TTS playing

Each state already had its own colour and spin-rate in `ArcReactor.css`, so
they light up as-is: cyan and spun-up while listening, amber while speaking.

### Why a file rather than a socket

`core/voice_state.py` writes one small JSON file that Electron polls at
250ms. Deliberately not a socket or HTTP server: the assistant must never
fail to start, or hang on shutdown, because a UI that may not even be running
couldn't be reached. A file has no connection lifecycle and no port
conflicts.

Two details that matter:

- **Atomic writes** (temp file + `os.replace`) so the UI can never read a
  half-written file and crash its JSON parse.
- **Staleness guard** — if nothing has updated the file for 30s the UI shows
  `offline` rather than a reactor frozen mid-"listening" after a crash.

Publishing is best-effort and swallows every error. Nothing in the voice
pipeline breaks because a status file couldn't be written.

---

## Test suite

**38 tests, all passing.**

```bash
python3 tests/test_regressions.py
```

---

## Part 5 — Conversation window (added 2026-08-25)

JARVIS previously needed the wake word before every single sentence. Now, for
8 seconds after it finishes speaking, you can just keep talking.

```
"jarvis, what's the weather"    <- wake word
   ...reply...
"what about tomorrow"           <- no wake word needed
   ...reply...
"thanks"                        <- still no wake word
   ...window expires quietly...
```

### The timing detail that matters

The window opens when **TTS finishes**, not when the reply is generated.
Arming it at generation time would let a long spoken reply consume most of
the window — a six-second answer would leave you two seconds to respond.
`arm_followup()` only sets a flag; the audio thread opens the real window
when `speaking_state` clears.

### Guarding against false triggers

An open window means any speech becomes a command, so:

- **Disfluencies are ignored** — "um", "uh", "hmm", lone articles, single
  characters. Filler does *not* extend the window either: extending on noise
  would keep the mic hot indefinitely in a room with background chatter.
- **Short real answers are accepted.** My first filler list included "no",
  "yeah", "sure" and a `len <= 2` rule that also swallowed "no". Both were
  wrong: inside a conversation window those are genuine answers to what
  Jarvis just asked, and eating them breaks the exact back-and-forth the
  feature exists to enable. The list is now only true disfluencies, and the
  length bound is 1 character.
- **The listen frame widens** during the window. The idle frame is 4s, sized
  to catch a wake word cheaply; a follow-up is a full command and gets the
  8s frame, so longer sentences aren't clipped.
- **An explicit wake word supersedes the window**, and one follow-up consumes
  it — so it can't chain indefinitely off a single reply.

### Configuration

```json
// ~/.jarvis/config.json
{ "followup_window_sec": 8 }   // 0 disables the feature entirely
```

---

## Test suite

**47 tests, all passing.**

```bash
python3 tests/test_regressions.py
```

---

## Part 6 — Barge-in (added 2026-08-25)

You can now cut Jarvis off mid-sentence instead of waiting for it to finish.

### Why this is the hard one

Barge-in requires listening **while the speakers are playing** — precisely the
condition `speaking_state` exists to prevent. Get it wrong and the first thing
Jarvis hears is itself, which it treats as a command, which produces a reply,
which it hears again. A runaway feedback loop.

### Why not acoustic echo cancellation

Proper AEC needs the reference signal and an adaptive filter (speexdsp,
webrtc-audio-processing) — heavy native dependencies. Neither is necessary
here, because we have something an ordinary AEC does not: **the exact text
being spoken.**

`voice/echo_filter.py` compares any transcription against the utterance
currently playing. Substantial overlap means self-hearing. It's deliberately
biased toward false negatives: missing a barge-in costs you one repeat, while
mistaking echo for your voice starts the loop.

Measured on the test set: 5/5 echo variants rejected, 7/7 real barge-ins
passed.

### Three layers of defence

1. **Energy gate** — the threshold is raised 2.5x while listening during
   playback, and dynamic adjustment is pinned off. Left on, the recogniser
   would calibrate itself to Jarvis's own voice and then trip on it.
2. **Echo filter** — the text comparison above.
3. **Runaway guard** — if barge-in fires 5 times in 10 seconds, the filter is
   clearly not holding in this room, so it disables itself for the session and
   logs why rather than looping.

### Modes

```json
// ~/.jarvis/config.json
{ "bargein_mode": "wake" }
```

| mode | behaviour |
|---|---|
| `off` | never listen during playback (original behaviour) |
| `wake` | interrupt on the wake word or a stop phrase — **default** |
| `any` | any non-echo speech interrupts — closest to the films |

Default is `wake` because it is conservative and the failure mode of `any` is
a feedback loop. Try `wake` first; move to `any` once you've confirmed your
speakers don't bleed into your mic.

Saying "stop" / "shut up" / "wait" silences Jarvis **without** running a
command. Anything else stops it and runs as a command.

### What still needs your hardware

The echo filter and runaway guard are unit-tested. The **energy multiplier
cannot be tuned without your actual room** — speaker volume, mic placement and
distance all matter. If Jarvis interrupts itself, raise
`BARGEIN_ENERGY_MULTIPLIER` in `voice/wake_word.py`. If it can't hear you over
itself, lower it.

---

## Test suite

**55 tests, all passing.**

```bash
python3 tests/test_regressions.py
```
