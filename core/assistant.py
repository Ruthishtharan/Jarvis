import asyncio
import signal
import sys
import time
from voice.text_to_speech import get_tts
from voice.wake_word import WakeWordDetector
from ai.response_generator import ResponseGenerator
from agents import get_agent_runner
from core.command_router import CommandRouter
from core.context_manager import ContextManager
from core.task_manager import TaskManager
from multitasking.scheduler import Scheduler
from config import settings
from utils.logger import get_logger
from utils.latency_profiler import get_profiler
from core import voice_state
from core.confirmation import ConfirmationGate, classify_reply

logger = get_logger(__name__)


class JarvisAssistant:
    # Debounce: ignore a repeat of the same/near-same command within this window (seconds).
    _DUPLICATE_DEBOUNCE_SECONDS = 1.2

    def __init__(self):
        self._running = False
        self._last_command: str = ""
        self._last_command_ts: float = 0.0

        self.tts = get_tts()
        # NOTE: STT is now owned by WakeWordDetector's single audio thread.
        # The old `SpeechToText` instance has been removed to eliminate mic
        # contention between wake detection and command capture.
        self.wake_detector = WakeWordDetector()

        # Conversation memory + engine are now owned by the `conversation`
        # skill (see skills/conversation.py).  The router auto-routes
        # free-form chat there.
        self.response_gen = ResponseGenerator()
        self.router = CommandRouter()
        self.context = ContextManager()
        self.task_manager = TaskManager()
        self.scheduler = Scheduler()
        self.confirmations = ConfirmationGate()
        self._shutdown_done = False

    def _is_duplicate_command(self, command: str) -> bool:
        """Guard against the same utterance being processed twice when the wake-word
        thread and the main STT loop both transcribe the same audio."""
        import re
        norm = re.sub(r"[^\w\s]", "", command.lower()).strip()
        now = time.monotonic()
        elapsed = now - self._last_command_ts
        if elapsed < self._DUPLICATE_DEBOUNCE_SECONDS and norm and norm == self._last_command:
            return True
        # Also treat "one contains the other" as duplicate (handles
        # "jarvis just open spotify" vs "just open spotify" firing back-to-back).
        if elapsed < self._DUPLICATE_DEBOUNCE_SECONDS and norm and self._last_command and (
            norm in self._last_command or self._last_command in norm
        ):
            return True
        self._last_command = norm
        self._last_command_ts = now
        return False

    def speak(self, text: str):
        """Synchronous speak (blocks until speech finishes).
        Use self.tts.speak_async() for non-blocking operation."""
        logger.info(f"Jarvis: {text}")
        self.tts.speak(text)

    def speak_async(self, text: str):
        """Async speak (returns immediately, speech happens in background).
        Preferred for most situations."""
        logger.info(f"Jarvis: {text}")
        self.tts.speak_async(text)

    async def start(self):
        settings.validate()

        self._setup_signal_handlers()
        self.scheduler.start()

        # Proactive agents (morning_brief / focus_guardian / end_of_day)
        # share Jarvis's TTS — passing `self.speak_async` means they speak in background.
        self._agent_runner = get_agent_runner(speak=self.speak_async)
        self._agent_runner.start()

        # The wake detector owns the microphone — calibration happens inside
        # its thread (no separate calibrate call needed).
        # Use async greeting so it doesn't block startup
        self.speak_async(self.response_gen.greeting())

        self.wake_detector.start()
        voice_state.set_state(voice_state.IDLE)
        logger.info("Jarvis is online — listening for 'jarvis' or a clap (1 or 2).")

        try:
            await self._main_loop()
        finally:
            # The signal handler only clears the running flag, so the loop
            # exits normally rather than by exception. Without this, Ctrl+C
            # left the TTS worker, microphone thread and scheduler running
            # and the audio device held open.
            if not self._shutdown_done:
                await self._shutdown()

    async def _main_loop(self):
        """Pure consumer loop.  All microphone work happens in the
        WakeWordDetector thread; we just await commands from its queue."""
        self._running = True
        loop = asyncio.get_event_loop()
        profiler = get_profiler()
        command_count = 0

        while self._running:
            # Poll every 2 s so SIGINT / shutdown is responsive.
            profiler.start_stage("wait_for_command")
            captured = await loop.run_in_executor(
                None, self.wake_detector.wait_for_command, 2.0
            )
            profiler.end_stage("wait_for_command")

            if not self._running:
                break
            if not captured:
                continue

            command = captured.text
            from_followup = captured.from_followup

            if self._is_duplicate_command(command):
                logger.info(f"Ignoring duplicate command within debounce window: {command!r}")
                continue

            command_count += 1
            logger.info(f"[{command_count}] Processing command: {command}")
            await self._process_command(command, from_followup=from_followup)

            # Print latency report every 10 commands
            if command_count % 10 == 0:
                logger.info(f"\n{profiler.report()}\n")

    async def _process_command(self, command: str, from_followup: bool = False):
        profiler = get_profiler()
        profiler.start_stage("route")

        # Drives the HUD arc reactor.
        voice_state.set_state(voice_state.THINKING, command=command)

        # An irreversible action may be waiting on a yes/no. Resolve that
        # before routing, so "yes" approves rather than being handed to the
        # conversation skill as small talk.
        if await self._resolve_confirmation(command):
            return

        task_id = self.task_manager.create_task(command)
        self.task_manager.start_task(task_id)
        loop = asyncio.get_event_loop()

        try:
            reply, should_shutdown, already_spoken, confirm = await self.router.route(
                command, from_followup=from_followup
            )
            profiler.end_stage("route")

            if confirm is not None:
                self.confirmations.arm(confirm)

            self.context.add_turn(command, "processed", reply)
            self.task_manager.complete_task(task_id, reply)

            # CRITICAL FIX: Use speak_async (non-blocking) instead of speak (blocking).
            # This lets JARVIS listen for the next wake word while speaking the current response.
            # Skip when the skill already streamed its reply to TTS.
            voice_state.set_state(voice_state.THINKING, reply=reply)

            if not already_spoken:
                profiler.start_stage("tts")
                # Fire-and-forget: TTS runs in background daemon thread
                self.tts.speak_async(reply)
                profiler.end_stage("tts")

            # Let the user answer without saying "jarvis" again. Only armed
            # here — the wake detector opens the actual window once TTS
            # finishes, so a long reply doesn't eat into it.
            if not should_shutdown:
                self.wake_detector.arm_followup()

            if should_shutdown:
                await self._shutdown()
        except Exception as e:
            logger.error(f"Command processing error: {e}")
            voice_state.set_state(voice_state.ERROR)
            self.task_manager.fail_task(task_id, str(e))
            # Even errors should be async — don't block loop
            self.tts.speak_async("Something went wrong. Please try again.")

    async def _resolve_confirmation(self, command: str) -> bool:
        """Handle `command` as a yes/no if an action is pending.

        Returns True when the utterance was consumed as an answer.
        """
        pending = self.confirmations.pending
        if pending is None:
            return False

        verdict = classify_reply(command)

        if verdict is True:
            action = self.confirmations.take()
            if action is None:
                return False
            logger.info(f"Confirmed: {action.description}")
            try:
                reply = await action.run()
            except Exception as e:
                logger.error(f"Confirmed action failed: {e}")
                reply = "That didn't work. Nothing has been changed."
            self.context.add_turn(command, "confirmed", reply)
            self.tts.speak_async(reply)
            self.wake_detector.arm_followup()
            return True

        if verdict is False:
            action = self.confirmations.take()
            desc = action.description if action else "that"
            logger.info(f"Declined: {desc}")
            reply = "Cancelled."
            self.context.add_turn(command, "declined", reply)
            self.tts.speak_async(reply)
            self.wake_detector.arm_followup()
            return True

        # Neither yes nor no. Drop the pending action rather than leaving it
        # armed — an unrelated "yes" a minute later must not trigger it — and
        # let the utterance route normally.
        logger.info("Ambiguous reply to a confirmation — discarding it")
        self.confirmations.clear()
        return False

    async def _shutdown(self):
        # Reachable from both a spoken "goodbye" and the signal path; doing
        # the teardown twice would join already-dead threads.
        if self._shutdown_done:
            return
        self._shutdown_done = True

        logger.info("Jarvis shutdown initiated.")
        voice_state.clear()
        self._running = False
        self.wake_detector.cancel_followup()
        self.wake_detector.stop()
        if hasattr(self, "_agent_runner"):
            self._agent_runner.stop()
        self.scheduler.stop()
        # shutdown() drains the queue and joins the TTS worker thread.
        # Plain stop() only cancels the current utterance and would leave
        # the worker alive holding a blocking queue.get().
        self.tts.shutdown()
        # Flush any unsaved conversation history before exit.
        try:
            convo = self.router._registry.by_name("conversation")
            if convo is not None and hasattr(convo, "_memory"):
                convo._memory.flush()
        except Exception as e:
            logger.debug(f"Memory flush on shutdown failed: {e}")
        from automation.whatsapp_automation import close_whatsapp
        close_whatsapp()

    def _setup_signal_handlers(self):
        def handle_exit(signum, _frame):
            logger.info(f"Signal {signum} received — shutting down.")
            self._running = False

            # Cut any speech off immediately.
            #
            # Removing sys.exit() from this handler stopped the teardown
            # traceback, but introduced a worse problem: if Jarvis was
            # mid-reply, the loop was inside `await router.route(...)` with
            # the conversation skill streaming sentence-by-sentence into TTS.
            # Nothing checked `_running` until that finished, so Ctrl+C did
            # nothing until the whole reply had been spoken. Observed live:
            # seven presses over 29 seconds.
            #
            # stop() drops the queue and kills the current utterance, which
            # unblocks the streaming call and lets the loop exit promptly.
            try:
                self.tts.stop()
            except Exception:
                pass
            # Deliberately NOT sys.exit(). The handler can fire while the
            # interpreter is already tearing down worker threads, and raising
            # SystemExit there surfaced as a traceback on every Ctrl+C:
            #     Exception ignored on threading shutdown ... SystemExit: 0
            # Clearing the flag is enough — the main loop checks it every 2s
            # and exits cleanly through the normal shutdown path.

        signal.signal(signal.SIGINT, handle_exit)
        signal.signal(signal.SIGTERM, handle_exit)
