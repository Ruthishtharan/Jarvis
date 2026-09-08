"""
Unified audio listener — single-mic architecture.

Only ONE thread owns the microphone for the lifetime of the process.  That
thread:

  1.  Listens for any loud sound (speech, clap, noise).
  2.  Classifies what it got:
        • clap pattern     → wake via clap
        • contains "jarvis" (or a fuzzy match) → wake via voice
        • anything else    → discarded
  3.  If the wake utterance already contained a trailing command (e.g.
      "jarvis open spotify"), use that.  Otherwise listen ONCE more for the
      command utterance, then transcribe it.
  4.  Push the final command string into a thread-safe queue for the main
      async loop to consume via `wait_for_command()`.

This design kills the old bug where the wake-word thread and the main-loop
STT both opened `sr.Microphone()` at the same time, producing double-
transcription / double-processing of the same audio.
"""

import os
import queue
import tempfile
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Optional

import speech_recognition as sr

from config import settings
from utils.helpers import contains_wake_word, strip_wake_word
from utils.logger import get_logger
from voice import speaking_state
from voice.audio_utils import create_recognizer, calibrate_microphone
from voice.clap_detector import detect_clap
from voice.echo_filter import is_echo, looks_like_interrupt
from voice.audio_lock import portaudio_lock
from voice.stt_engines import build_stt
from core import voice_state

logger = get_logger(__name__)


# ── End-of-phrase timing ─────────────────────────────────────────────────────
# `pause_threshold` is how much silence ends a phrase. It is set per-listen
# because the two listens want opposite things.
#
# The idle listen must survive the natural pause after the wake word.
# At 0.4s, saying "jarvis ... play something on spotify" ended the frame at
# "jarvis". The thread then had to transcribe that frame (~300ms over Groq)
# before it could know a wake word had occurred — and one thread owns the
# microphone, so nothing was being recorded during that call. The words
# spoken in the gap were simply lost:
#
#     listen() -> "jarvis"
#                   |
#                   +-- transcribe (~300ms)   <-- "play something" lost here
#                   |
#                   +-- listen() -> "on spotify"
#
# Observed live: 'javis.' -> 'on spotify.', and 'jarvis.' -> 'hey!'.
#
# Holding the frame open through the pause means the whole utterance arrives
# together and the second listen never happens — which is already the fast
# path, since "jarvis open spotify" yields the remainder directly.
#
# The cost is ~350ms of extra end-of-speech wait on commands spoken without a
# pause. Losing half a command is worse than waiting a third of a second.
WAKE_PAUSE_THRESHOLD = 0.75

# The command capture has no such problem — the user is already speaking a
# complete instruction — so it stays fast.
COMMAND_PAUSE_THRESHOLD = 0.4

# Phrase time limits
WAKE_PHRASE_LIMIT_SEC = 6      # room for "jarvis <pause> full command"
COMMAND_PHRASE_LIMIT_SEC = 8   # generous window for the actual command
COMMAND_TIMEOUT_SEC = 5        # how long to wait for speech after the wake

# "Clap" recordings are typically < 1 s; speech is longer.  We use a 4-second
# phrase_time_limit for the idle-listen so a clap is captured fully without
# clipping a longer utterance.

# ── Conversation window ──────────────────────────────────────────────────────
# For this many seconds after Jarvis finishes speaking, the next utterance is
# treated as a command WITHOUT requiring the wake word — so you can just keep
# talking instead of saying "jarvis" before every sentence.
#
# The window opens when TTS *finishes*, not when the reply is generated.
# Arming it earlier would let a long spoken reply consume most of the window,
# leaving you a second or two to respond.
#
# Set FOLLOWUP_WINDOW_SEC to 0 in ~/.jarvis/config.json to disable.
FOLLOWUP_WINDOW_SEC = 8.0

# During the window the idle listen must allow a full-length command, not the
# short 4s frame sized for catching a wake word.
FOLLOWUP_PHRASE_LIMIT_SEC = COMMAND_PHRASE_LIMIT_SEC

# ── Barge-in ─────────────────────────────────────────────────────────────────
# Interrupting Jarvis mid-sentence requires listening WHILE the speakers are
# playing, which is exactly the condition `speaking_state` normally exists to
# prevent. Two defences make it safe:
#
#   1. An energy threshold raised well above the level the speakers register
#      at, so ordinary playback does not trip the recogniser at all.
#   2. voice/echo_filter.py, which compares any transcription against the text
#      currently being spoken and rejects overlap as self-hearing.
#
# Modes:
#   "off"  — never listen during playback (previous behaviour)
#   "wake" — interrupt only on the wake word or an explicit stop phrase
#   "any"  — any non-echo speech interrupts (closest to the films)
#
# Default is "wake": it is the conservative choice, and the failure mode of
# "any" — mistaking playback for a command — is a feedback loop.
BARGEIN_MODE_DEFAULT = "wake"

# Multiplier applied to the calibrated energy threshold while listening during
# playback. Raise it if Jarvis interrupts itself; lower it if it can't hear you.
BARGEIN_ENERGY_MULTIPLIER = 2.5

BARGEIN_LISTEN_TIMEOUT = 0.6   # short, so we re-check speaking state often
BARGEIN_PHRASE_LIMIT = 3.0

# Runaway guard: if barge-in fires this many times inside this window, the
# echo filter is clearly failing in this room, so disable it for the session
# rather than let a feedback loop run.
BARGEIN_RUNAWAY_COUNT = 5
BARGEIN_RUNAWAY_WINDOW = 10.0

# Upper bound on the calibrated energy threshold. A quiet room measures ~150;
# anything above this means something was making noise during calibration,
# and accepting it would leave the microphone effectively deaf.
CALIBRATION_CEILING = 4000


@dataclass
class Command:
    """A captured utterance plus how it was triggered.

    `from_followup` matters: a command spoken after the wake word carries
    explicit evidence that it was addressed to Jarvis. One picked up during
    the conversation window does not — it may just be the user thinking out
    loud. Observed in a real session: "that is open, spotify." was matched to
    open_app at 0.81 confidence and re-launched an app that was already open.
    """

    text: str
    from_followup: bool = False


class WakeWordDetector:
    """Single-mic wake + command pipeline.

    External API kept compatible with the old implementation so
    `core/assistant.py` only needs a tiny patch:

        start()                    — begin the listener thread
        stop()                     — stop and join the thread
        wait_for_command(timeout)  — block until a command is ready
        wait_for_wake(timeout)     — legacy alias (calls wait_for_command)
    """

    def __init__(self):
        self.recognizer = create_recognizer()
        self._command_queue: "queue.Queue[Command]" = queue.Queue()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        # Transcription is delegated so the backend can change without
        # touching the audio loop. See voice/stt_engines.py.
        self._stt = build_stt(self.recognizer)

        # Conversation window. `_followup_armed` means "Jarvis has replied,
        # open the window as soon as it stops talking"; `_followup_until` is
        # the monotonic deadline once open.
        self._followup_armed = False
        self._followup_until = 0.0
        self._followup_window = self._configured_window()

        # Barge-in
        self._bargein_mode = self._configured_bargein()
        self._bargein_times: list[float] = []

    # ── Lifecycle ────────────────────────────────────────────────────────────

    def start(self):
        if self._running:
            return
        # Warm the local model only when it is the primary backend.
        self._stt.preload()
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="jarvis-audio")
        self._thread.start()
        logger.info(
            f"Audio listener started — wake = '{settings.WAKE_WORD}' or 1/2 claps"
        )

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)

    # ── Public consumer API ──────────────────────────────────────────────────

    def wait_for_command(self, timeout: Optional[float] = None) -> Optional["Command"]:
        """Block until a command is available, or timeout (seconds) elapses."""
        try:
            return self._command_queue.get(timeout=timeout)
        except queue.Empty:
            return None

    # Back-compat alias (old callers used `wait_for_wake`)
    def wait_for_wake(self, timeout: Optional[float] = None) -> Optional[str]:
        return self.wait_for_command(timeout)

    def arm_followup(self) -> None:
        """Called by the assistant after it dispatches a reply.

        Only *arms* the window — it opens when TTS actually finishes, so the
        full duration is available for you to respond.
        """
        if self._followup_window > 0:
            self._followup_armed = True

    def cancel_followup(self) -> None:
        """Close the window immediately (e.g. on shutdown)."""
        self._followup_armed = False
        self._followup_until = 0.0

    # ── Conversation window internals ────────────────────────────────────────

    @staticmethod
    def _configured_window() -> float:
        """Read the window length from user config, falling back to default."""
        try:
            from config.user_config import get_user_config
            value = get_user_config().get("followup_window_sec", FOLLOWUP_WINDOW_SEC)
            return max(0.0, float(value))
        except Exception:
            return FOLLOWUP_WINDOW_SEC

    @staticmethod
    def _configured_bargein() -> str:
        try:
            from config.user_config import get_user_config
            mode = str(get_user_config().get("bargein_mode", BARGEIN_MODE_DEFAULT))
            return mode if mode in ("off", "wake", "any") else BARGEIN_MODE_DEFAULT
        except Exception:
            return BARGEIN_MODE_DEFAULT

    # ── Barge-in ─────────────────────────────────────────────────────────────

    def _tts_text(self) -> Optional[str]:
        """What the speakers are playing right now, if anything."""
        try:
            from voice.text_to_speech import get_tts
            return get_tts().current_text()
        except Exception:
            return None

    def _note_bargein(self) -> bool:
        """Record a barge-in; return False if we are clearly in a loop."""
        now = time.monotonic()
        self._bargein_times = [
            t for t in self._bargein_times if now - t < BARGEIN_RUNAWAY_WINDOW
        ]
        self._bargein_times.append(now)
        if len(self._bargein_times) >= BARGEIN_RUNAWAY_COUNT:
            logger.warning(
                f"Barge-in fired {len(self._bargein_times)} times in "
                f"{BARGEIN_RUNAWAY_WINDOW:.0f}s — the echo filter is not holding "
                "in this room. Disabling barge-in for this session. "
                "Raise BARGEIN_ENERGY_MULTIPLIER or set bargein_mode to 'off'."
            )
            self._bargein_mode = "off"
            return False
        return True

    def _listen_during_speech(self, source: sr.AudioSource) -> Optional[str]:
        """Listen for an interruption while Jarvis is talking.

        Returns the user's text, or None for silence / self-hearing.
        """
        recognizer = self.recognizer
        original_energy = recognizer.energy_threshold
        original_dynamic = recognizer.dynamic_energy_threshold

        # Pin the threshold high. Dynamic adjustment must be off or it would
        # calibrate itself to Jarvis's own voice and then trip on it.
        recognizer.dynamic_energy_threshold = False
        recognizer.energy_threshold = original_energy * BARGEIN_ENERGY_MULTIPLIER
        try:
            audio = recognizer.listen(
                source,
                timeout=BARGEIN_LISTEN_TIMEOUT,
                phrase_time_limit=BARGEIN_PHRASE_LIMIT,
            )
        except sr.WaitTimeoutError:
            return None
        except Exception as e:
            logger.debug(f"Barge-in listen error: {e}")
            return None
        finally:
            recognizer.energy_threshold = original_energy
            recognizer.dynamic_energy_threshold = original_dynamic

        # Capture the spoken text BEFORE transcribing: transcription takes
        # time, and by the time it returns TTS may have moved to the next
        # utterance, leaving us comparing against the wrong reference.
        spoken = self._tts_text()

        text = self._transcribe(audio)
        if not text or self._is_filler(text):
            return None

        if is_echo(text, spoken):
            logger.debug(f"Barge-in rejected as self-hearing: {text!r}")
            return None

        if self._bargein_mode == "wake":
            if not (contains_wake_word(text) or looks_like_interrupt(text)):
                logger.debug(f"Barge-in ignored (mode=wake, no trigger): {text!r}")
                return None

        return text

    @contextmanager
    def _pause_threshold(self, seconds: float):
        """Temporarily set how much silence ends a phrase."""
        previous = self.recognizer.pause_threshold
        self.recognizer.pause_threshold = seconds
        try:
            yield
        finally:
            self.recognizer.pause_threshold = previous

    def _followup_active(self) -> bool:
        return self._followup_until > 0 and time.monotonic() < self._followup_until

    def _open_followup(self) -> None:
        self._followup_until = time.monotonic() + self._followup_window
        self._followup_armed = False
        logger.info(f"Conversation window open ({self._followup_window:.0f}s) — "
                    "no wake word needed")
        voice_state.set_state(voice_state.LISTENING)

    def _close_followup(self, reason: str = "timeout") -> None:
        if self._followup_until:
            logger.debug(f"Conversation window closed ({reason})")
        self._followup_until = 0.0
        voice_state.set_state(voice_state.IDLE)

    # ── Background loop ──────────────────────────────────────────────────────

    def _run(self):
        """Main audio loop.  Keeps ONE `sr.Microphone` context open for the
        whole lifetime so PyAudio isn't repeatedly torn down and re-created."""
        try:
            # Same lock as the playback path: sr.Microphone() constructs a
            # PyAudio instance, and concurrent Pa_Initialize() segfaults.
            with portaudio_lock:
                mic = sr.Microphone()
        except Exception as e:
            logger.error(f"Could not open microphone: {e}")
            return

        with mic as source:
            # Calibrate once, using the opened source (avoids a second mic open)
            try:
                # Wait for the startup greeting to finish first.
                #
                # Calibration measures "ambient noise" — if Jarvis is talking
                # while it runs, it calibrates to its own voice and sets the
                # threshold absurdly high. Measured on three real runs:
                #     silent room        145
                #     during greeting  6,861
                #     during greeting 19,231
                # At 19,231 the microphone is effectively deaf and no wake
                # word registers until something re-triggers dynamic
                # adjustment.
                if speaking_state.is_speaking():
                    logger.debug("Waiting for greeting to finish before calibrating")
                    speaking_state.wait_until_silent()

                logger.info("Calibrating microphone for ambient noise...")
                self.recognizer.adjust_for_ambient_noise(source, duration=1.0)

                threshold = self.recognizer.energy_threshold
                # A very high reading means something was making noise during
                # calibration. Clamp it: dynamic adjustment will raise it
                # again if the room genuinely is that loud, but starting deaf
                # means the user has to shout to be heard at all.
                if threshold > CALIBRATION_CEILING:
                    logger.warning(
                        f"Calibrated threshold {threshold:.0f} is implausibly high "
                        f"(noise during calibration?) — clamping to {CALIBRATION_CEILING}"
                    )
                    self.recognizer.energy_threshold = CALIBRATION_CEILING
                    threshold = CALIBRATION_CEILING

                logger.info(f"Energy threshold set to: {threshold:.0f}")
            except Exception as e:
                logger.warning(f"Calibration failed: {e}")

            while self._running:
                # Self-hearing suppression: don't capture audio while Jarvis
                # is speaking — `say` would otherwise loop back through the
                # mic and look like a wake word.
                if speaking_state.is_speaking():
                    if self._bargein_mode != "off":
                        heard = self._listen_during_speech(source)
                        if heard:
                            self._handle_bargein(heard)
                            continue
                        # Still speaking and nothing heard — loop round and
                        # listen again rather than blocking, so an interruption
                        # part-way through a long reply is still caught.
                        if speaking_state.is_speaking():
                            continue
                    else:
                        speaking_state.wait_until_silent()

                    # TTS has just finished. This — not reply generation — is
                    # when the conversation window should start, so its full
                    # duration is available to the user.
                    if self._followup_armed:
                        self._open_followup()
                    continue

                # Expire an open window before listening, so the HUD returns
                # to idle promptly rather than on the next utterance.
                if self._followup_until and not self._followup_active():
                    self._close_followup()

                # A follow-up is a full command, so it needs the longer frame;
                # the short frame exists only to catch a wake word cheaply.
                in_window = self._followup_active()
                frame = (
                    FOLLOWUP_PHRASE_LIMIT_SEC if in_window else WAKE_PHRASE_LIMIT_SEC
                )

                try:
                    with self._pause_threshold(WAKE_PAUSE_THRESHOLD):
                        audio = self.recognizer.listen(
                            source,
                            timeout=None,
                            phrase_time_limit=frame,
                        )
                except sr.WaitTimeoutError:
                    continue
                except Exception as e:
                    if self._running:
                        logger.debug(f"Idle listen error: {e}")
                        time.sleep(0.2)
                    continue

                # If TTS started while we were listening, the tail of the
                # buffer is Jarvis's own voice — drop the whole frame.
                if speaking_state.is_speaking():
                    continue

                in_window_now = self._followup_active()
                command = self._classify_and_maybe_capture(source, audio)
                if command:
                    self._command_queue.put(
                        Command(text=command, from_followup=in_window_now)
                    )

    def _handle_bargein(self, heard: str) -> None:
        """Cut Jarvis off and, unless it was purely a stop, run the command."""
        if not self._note_bargein():
            return

        logger.info(f"Barge-in: {heard!r}")

        # Silence the speakers immediately. stop() drops the whole queue, so a
        # multi-sentence reply doesn't resume after the interruption.
        try:
            from voice.text_to_speech import get_tts
            get_tts().stop()
        except Exception as e:
            logger.debug(f"Barge-in stop failed: {e}")

        speaking_state.clear_speaking()
        self._close_followup("barge-in")

        if looks_like_interrupt(heard):
            # "stop" / "shut up" means stop talking, not run a command.
            voice_state.set_state(voice_state.IDLE)
            return

        command = strip_wake_word(heard) if contains_wake_word(heard) else heard
        if command.strip():
            self._command_queue.put(Command(text=command, from_followup=False))

    # ── Audio classification ─────────────────────────────────────────────────

    def _classify_and_maybe_capture(
        self,
        source: sr.AudioSource,
        audio: sr.AudioData,
    ) -> Optional[str]:
        """Decide whether `audio` was a wake trigger; if yes, return the
        command text (capturing it from a follow-up utterance if needed)."""
        # 1. Cheap check first: is it a clap?
        clap = detect_clap(audio)
        if clap in ("single", "double"):
            logger.info(f"Wake: {clap} clap")
            return self._capture_command(source)

        # 2. Transcribe and check for "jarvis"
        text = self._transcribe(audio)
        if not text:
            return None

        if contains_wake_word(text):
            remainder = strip_wake_word(text)
            logger.info(f"Wake: voice ({text!r})")
            # An explicit wake word supersedes any open window.
            self._close_followup("explicit wake")
            if remainder:
                return remainder
            return self._capture_command(source)

        # 3. Conversation window — no wake word required.
        if self._followup_active():
            if self._is_filler(text):
                # Don't fire on "um", "yeah", a cough transcribed as a word.
                # Deliberately does NOT extend the window: filler is not
                # engagement, and extending on noise would keep the mic hot
                # indefinitely in a room with background chatter.
                logger.debug(f"Follow-up ignored (filler): {text!r}")
                return None
            logger.info(f"Follow-up (no wake word): {text!r}")
            self._close_followup("consumed")
            return text

        # Not for us — discard.
        logger.debug(f"Ignored (no wake): {text!r}")
        return None

    # Pure disfluencies and mis-transcribed noise.
    #
    # Deliberately does NOT include "yes", "no", "yeah", "sure", "okay":
    # inside a conversation window those are genuine answers to whatever
    # Jarvis just said, and swallowing them would break the exact
    # back-and-forth this feature exists to enable.
    _FILLER = {
        "um", "umm", "uh", "uhh", "er", "erm", "hmm", "hm", "mm", "mhm",
        "ah", "eh", "huh", "the", "a", "an", "and",
    }

    @classmethod
    def _is_filler(cls, text: str) -> bool:
        cleaned = text.strip().strip(".,!?").lower()
        if not cleaned:
            return True
        if cleaned in cls._FILLER:
            return True
        # A lone single character is mis-transcribed noise. The bound is 1,
        # not 2: at 2 this swallowed "no", which is a perfectly good answer
        # to whatever Jarvis just asked.
        tokens = cleaned.split()
        return len(tokens) == 1 and len(cleaned) <= 1

    def _capture_command(self, source: sr.AudioSource) -> Optional[str]:
        """Listen for the user's command on the already-open mic source."""
        # Wake word confirmed — the HUD should show we're actively listening.
        voice_state.set_state(voice_state.LISTENING)
        try:
            with self._pause_threshold(COMMAND_PAUSE_THRESHOLD):
                audio = self.recognizer.listen(
                    source,
                    timeout=COMMAND_TIMEOUT_SEC,
                    phrase_time_limit=COMMAND_PHRASE_LIMIT_SEC,
                )
        except sr.WaitTimeoutError:
            logger.info("No command heard after wake — returning to idle.")
            voice_state.set_state(voice_state.IDLE)
            return None
        except Exception as e:
            logger.error(f"Command capture error: {e}")
            return None
        text = self._transcribe(audio)
        if not text:
            logger.info("Command captured but could not transcribe.")
            return None
        return text

    # ── Transcription ────────────────────────────────────────────────────────

    def _transcribe(self, audio: sr.AudioData) -> Optional[str]:
        return self._stt.transcribe(audio)


