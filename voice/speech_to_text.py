import os
import tempfile
import speech_recognition as sr
from voice.audio_utils import create_recognizer, calibrate_microphone
from config.constants import LISTEN_TIMEOUT, PHRASE_TIME_LIMIT
from config import settings
from utils.logger import get_logger

logger = get_logger(__name__)


class _WhisperBackend:
    """Lazy-loading wrapper around openai-whisper for offline transcription."""

    def __init__(self):
        self._model = None
        self._size = settings.WHISPER_MODEL_SIZE

    def _load(self):
        if self._model is not None:
            return
        try:
            import whisper
            logger.info(f"Loading Whisper '{self._size}' model — first-run download may take a moment...")
            self._model = whisper.load_model(self._size)
            logger.info("Whisper model ready.")
        except ImportError:
            raise RuntimeError(
                "openai-whisper is not installed. Run: pip install openai-whisper"
            )

    def transcribe(self, audio: sr.AudioData) -> str | None:
        self._load()
        tmp = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                f.write(audio.get_wav_data())
                tmp = f.name
            result = self._model.transcribe(tmp, language="en", fp16=False)
            text = result["text"].strip().lower()
            logger.info(f"Whisper heard: {text!r}")
            return text or None
        except Exception as e:
            logger.error(f"Whisper transcription error: {e}")
            return None
        finally:
            if tmp:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass


class SpeechToText:
    def __init__(self):
        self.recognizer = create_recognizer()
        self._calibrated = False
        self._whisper = _WhisperBackend() if settings.USE_OFFLINE_STT else None

    def calibrate(self):
        calibrate_microphone(self.recognizer)
        self._calibrated = True

    def listen(self, timeout: int = LISTEN_TIMEOUT, phrase_limit: int = PHRASE_TIME_LIMIT) -> str | None:
        if not self._calibrated:
            self.calibrate()
        try:
            with sr.Microphone() as source:
                logger.debug("Listening for command...")
                audio = self.recognizer.listen(source, timeout=timeout, phrase_time_limit=phrase_limit)
            return self._transcribe(audio)
        except sr.WaitTimeoutError:
            logger.debug("Listen timeout — no speech detected.")
            return None
        except Exception as e:
            logger.error(f"Listen error: {e}")
            return None

    def _transcribe(self, audio: sr.AudioData) -> str | None:
        # ── Offline (Whisper) path ─────────────────────────────────────────────
        if settings.USE_OFFLINE_STT and self._whisper:
            return self._whisper.transcribe(audio)

        # ── Online (Google) path ───────────────────────────────────────────────
        try:
            text = self.recognizer.recognize_google(audio, language=settings.GOOGLE_STT_LANGUAGE)
            logger.info(f"Heard: {text!r}")
            return text.lower().strip()
        except sr.UnknownValueError:
            logger.debug("Could not understand audio.")
            return None
        except sr.RequestError as e:
            logger.warning(f"Google STT unavailable ({e}) — falling back to Whisper.")
            if self._whisper is None:
                self._whisper = _WhisperBackend()
            return self._whisper.transcribe(audio)

    def transcribe_audio(self, audio: sr.AudioData) -> str | None:
        return self._transcribe(audio)
