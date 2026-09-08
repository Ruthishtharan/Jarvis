import speech_recognition as sr
from utils.logger import get_logger
from voice.audio_lock import portaudio_lock

logger = get_logger(__name__)


def get_microphone(device_index: int | None = None) -> sr.Microphone:
    return sr.Microphone(device_index=device_index)


def list_microphones() -> list[str]:
    return sr.Microphone.list_microphone_names()


def calibrate_microphone(recognizer: sr.Recognizer, duration: float = 1.0):
    try:
        with portaudio_lock, sr.Microphone() as source:
            logger.info("Calibrating microphone for ambient noise...")
            recognizer.adjust_for_ambient_noise(source, duration=duration)
            logger.info(f"Energy threshold set to: {recognizer.energy_threshold:.0f}")
    except Exception as e:
        logger.warning(f"Microphone calibration failed: {e}")


def create_recognizer(energy_threshold: int = 2500) -> sr.Recognizer:
    r = sr.Recognizer()
    r.energy_threshold = energy_threshold
    r.dynamic_energy_threshold = True
    # Tightened from 0.8/0.5 — cuts ~700ms of dead air after the user stops
    # speaking before STT begins.  Slight risk of clipping mid-thought
    # pauses; tune up if you see chopped commands.
    r.pause_threshold = 0.4
    r.phrase_threshold = 0.3
    r.non_speaking_duration = 0.2
    return r
