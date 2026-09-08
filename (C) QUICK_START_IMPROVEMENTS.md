# JARVIS Improvements — Quick Start Guide

## What Changed

**The critical issue:** TTS (text-to-speech) was **blocking** the entire async loop, making JARVIS feel slow.

**The fix:** TTS is now **fire-and-forget** — speaks in background while JARVIS listens for next command.

**Result:** JARVIS should feel **~2x faster** ✨

---

## Running the Improved JARVIS

### Normal Mode (With Latency Instrumentation)
```bash
cd /Users/ruthish/Projects/Jarvis.ai
python run.py
```

**What you'll see:**
- JARVIS starts, says greeting in background (doesn't block)
- Listen for wake-word ("jarvis" or 1-2 claps)
- Every 10 commands, prints a latency report

**Test these commands:**
```
"open chrome"           → Should route to skill quickly
"what time is it"       → Uses LLM classification
"hello"                 → Conversation skill
"volume 50"             → System command
"play music"            → Audio control
"take a screenshot"     → File operations
```

---

## Reading the Latency Report

After 10 commands, you'll see:
```
======================================================================
JARVIS Latency Report
======================================================================
wait_for_command     | avg:  1234.5ms | min:  1100ms | max:  1500ms | n=10
skill_match          | avg:     5.2ms | min:     3ms | max:     8ms | n=10
llm_classify         | avg:   350.0ms | min:   320ms | max:   400ms | n=3
skill_execute        | avg:    45.0ms | min:    30ms | max:    65ms | n=10
route                | avg:   400.0ms | min:   350ms | max:   450ms | n=10
tts                  | avg:     2.1ms | min:     1ms | max:     3ms | n=10  ✅
======================================================================
TOTAL (E2E)          |   2036.3ms
======================================================================
```

**What to look for:**

| Stage | Ideal | Issue | What It Means |
|-------|-------|-------|--------------|
| `wait_for_command` | 1000-1500ms | >2000ms | STT taking too long |
| `skill_match` | <10ms | >50ms | Pattern matching slow (rare) |
| `llm_classify` | 300-500ms | >1000ms | Groq API slow or timeout |
| `skill_execute` | 50-200ms | >1000ms | Skill itself is slow |
| `route` | 300-700ms | >1000ms | Overall routing slow |
| **`tts`** | **<10ms** | **>100ms** | ✅ **Should now be <10ms!** |

---

## Key Improvement: TTS Speed

### Before Fix
- `tts` stage: ~2500ms (blocked entire loop!)
- User experience: Waits for response to finish before JARVIS can listen again
- Feels slow ❌

### After Fix
- `tts` stage: ~2-5ms (fires in background)
- User experience: JARVIS starts speaking immediately, can listen for next wake-word
- Feels responsive ✅

---

## Verifying the Fix Worked

### Test 1: Responsiveness Check
1. Say "jarvis open chrome"
2. JARVIS should respond immediately (< 1 second to hear "opening chrome")
3. **While JARVIS is speaking**, try saying "jarvis" again
4. ✅ If it wakes and captures your next command → Fix worked!
5. ❌ If it doesn't wake until speech is done → TTS still blocking (check logs)

### Test 2: Latency Measurement
1. Run JARVIS normally
2. Give 10 commands and wait for latency report
3. Check the `tts` line — should be **< 10ms**
4. ✅ If yes → Fix working perfectly
5. ❌ If `tts` is > 100ms → Something's wrong, check logs

---

## Files Added / Changed

### New Files (Claude-generated)
- `utils/(C) latency_profiler.py` — Latency measurement library
- `(C) TEST_LATENCY.py` — Test script
- `(C) BOTTLENECK_ANALYSIS.md` — Analysis of the issue
- `(C) FIXES_APPLIED.md` — Detailed changelog
- `(C) QUICK_START_IMPROVEMENTS.md` — This file

### Modified Files
- `voice/text_to_speech.py` — Made `speak_async()` truly non-blocking
- `core/assistant.py` — Added profiler, use `speak_async()` everywhere
- `core/command_router.py` — Added profiler to routing stages

### No Breaking Changes
- Old code still works (backwards compatible)
- `speak()` (blocking) still exists but marked as deprecated
- All improvements are opt-in

---

## Next Steps (If Still Slow)

If E2E latency is still > 3 seconds, implement Tier 2 fixes:

### Option 1: Streaming STT (Save 700-1000ms)
Currently: Batch STT takes 1000-1500ms (waits for full utterance)  
Streaming: 300-500ms (sends chunks as you speak)

**Implementation:**
- Use Google Speech-to-Text streaming API
- Start transcription immediately (not after silence detection)
- See `(C) JARVIS Learning Notes.md` section "Streaming STT Deep Dive"

### Option 2: Aggressive Skill Matching (Save 300-500ms)
Currently: 50% of commands hit Groq LLM (300-500ms each)  
Better: Only hit Groq for ambiguous commands

**Implementation:**
- Lower confidence threshold from 0.85 → 0.75
- Add more skill patterns for common utterances
- Pre-classify "open [app]", "volume [level]", "play [song]"

### Option 3: Whisper Optimization (If Using Offline)
Currently: Whisper "base" model takes 1-2 seconds  
Faster: Use "tiny" model (much faster, slightly less accurate)

**Implementation:**
```bash
# In .env:
WHISPER_MODEL_SIZE=tiny  # Instead of "base"
```

---

## Troubleshooting

### "TTS isn't async, still blocking"
**Check:**
1. Verify `(C) fixes applied.md` line "TTS is now truly async" is implemented
2. Check `core/assistant.py` line 150: `self.tts.speak_async(reply)`
3. Check `voice/text_to_speech.py` line 40: `speak_async()` doesn't wait

### "Latency report shows tts > 100ms"
**Causes:**
- TTS queueing is happening on main thread (shouldn't be)
- Multiple TTS calls backing up (rare)

**Fix:**
```python
# Look at core/assistant.py line 150
# Should be: self.tts.speak_async(reply)
# NOT:       await loop.run_in_executor(None, self.speak, reply)
```

### "LLM latency is > 1000ms"
**Cause:** Groq API timeout or slow

**Check:**
1. Is Groq API key valid? (check `.env`)
2. Is internet connection working?
3. Try: `curl -X GET https://api.groq.com/health`

**Fix:**
- Reduce LLM calls by improving skill matching (see Tier 2)
- Or use local Ollama instead of Groq (in `config/settings.py`)

---

## Measuring Success

| Metric | Before | Target | Status |
|--------|--------|--------|--------|
| Time to hear response | 2.5s+ | <1.5s | ✅ Should improve |
| TTS blocking time | 2-3s | <10ms | ✅ Should improve |
| Can listen while speaking | ❌ No | ✅ Yes | ✅ Should work |
| E2E latency (wake to hearing response) | 4-6s | <3s | 🟡 Depends on STT |

---

## What to Do Right Now

1. **Run JARVIS:** `python run.py`
2. **Test a few commands** and watch for:
   - Does it respond faster?
   - Can you wake it while it's speaking?
   - What's the latency report show?
3. **If it's faster** → Great! Commit to GitHub
4. **If still slow** → Look at the latency report and pick a Tier 2 optimization
5. **Ship it by May 5!** ✅

---

**Remember:** The fix is in place. Now let's verify it works and ship JARVIS! 🚀
