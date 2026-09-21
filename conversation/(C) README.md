# (C) Conversation

A real-time, multilingual, interruptible voice loop.

```bash
python3 -m conversation.loop                 # auto-detect language
python3 -m conversation.loop --lang ta-IN    # start pinned to Tamil
python3 -m conversation.loop --no-wake       # respond to everything
```

---

## Modules

| File | Responsibility |
|---|---|
| `languages.py` | Language registry, switch-phrase detection, voice lookup |
| `state.py` | **Conversation state manager** — language, turn, interruption |
| `vad.py` | WebRTC VAD (energy fallback) + utterance segmenter |
| `audio_io.py` | Continuous mic capture, WAV packing |
| `stt.py` | Multilingual STT — Groq whisper, local Whisper fallback |
| `tts.py` | Cancellable, language-aware synthesis |
| `llm.py` | Language-steered generation with sentence streaming |
| `loop.py` | The orchestrator |

---

## The three things that make it feel real

### 1. The mic never closes

A loop that stops listening in order to speak **cannot be interrupted** — not
as a bug, but by definition. So capture runs on its own thread for the entire
session, including during playback.

```
capture thread   frames → VAD → Segmenter → utterance queue
main loop        utterance → STT → route → LLM → TTS
TTS              sentence by sentence, polling should_stop()
```

### 2. Interruption is measured, not guessed

While JARVIS speaks, the mic hears JARVIS. A fixed threshold cannot work —
the right level depends on speaker volume, mic gain, and whether headphones
are in.

So the loop **measures its own leakage** during playback and requires the user
to clearly exceed it:

```python
bar = max(leak * 2.0, 0.030)     # 2x its own voice, floor for quiet rooms
```

**Measured lag: 30ms** from interrupt to silence — the poll interval.

### 3. Language is state, not a setting

```
detected   → follows whatever you speak
pinned     → "speak in Tamil" locks it until you change it
```

Pinning matters: without it, a single mis-detected utterance throws the
conversation back to English right after you asked for Tamil.

```python
st.observe_detected("Tamil")     # English → Tamil
st.set_language(hindi, pin=True) # → Hindi, pinned
st.observe_detected("Japanese")  # ignored — pinned
st.unpin()                       # follows you again
```

Switch phrases work in several languages: *"speak in Tamil"*, *"now speak in
Hindi"*, *"can you reply in French"*, *"switch to Japanese"* — while
*"tell me about Japanese history"* correctly does **not** switch.

---

## Details that took a second attempt

**Whisper is never given a language** unless you have pinned one. Pinning
forces the decoder to interpret everything as that language, and Tamil
decoded as English returns phonetic gibberish. Detection is the feature.

**The LLM is told it is writing, not speaking.** Asked to "reply in Tamil,
spoken-sounding", the model concluded it was being asked to synthesise audio
and refused: *"I can't generate spoken Tamil audio directly."* True statement,
wrong task. The prompt now says explicitly that a separate system reads it
aloud.

**Sentence splitting has a tail rule.** Merging leftovers into the previous
chunk unconditionally turned *"Hello. How are you? I am well."* into ONE
chunk — the whole reply as a single uninterruptible block, defeating both
streaming and barge-in. Only genuine fragments merge now.

**The segmenter keeps a pre-roll.** Speech is confirmed only after several
voiced frames, by which point the first syllable is gone. A ring buffer of
preceding frames is prepended, so "open chrome" does not arrive as
"pen chrome".

**The mic is drained after playback**, or JARVIS's own trailing audio becomes
your next utterance.

---

## Voices

macOS ships per-locale voices. Present on this machine:

| Language | Voice |
|---|---|
| English | Albert |
| Tamil | Vani |
| Hindi | Lekha |
| Japanese | Eddy |

A language with **no** installed voice is reported rather than substituted —
Tamil read by an American English voice is worse than silence. Add more in
System Settings → Accessibility → Spoken Content → Manage Voices.

---

## Known limitation

If you interrupt mid-sentence, the whole sentence is reported as unspoken.
`say` gives no progress feedback, so resuming repeats that one sentence
rather than risking skipped content.
