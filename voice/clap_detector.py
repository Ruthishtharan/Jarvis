"""
Clap detector — analyses an `sr.AudioData` buffer for one or two claps.

Returns:
    "single"  — one sharp transient
    "double"  — two sharp transients within ~700 ms of each other
    None      — nothing clap-like (silence / speech / noise)

Heuristic (no ML):
    • Split audio into 20 ms RMS frames.
    • Build a loudness mask (frames above 50 % of peak).
    • Group contiguous loud frames into "regions".
    • A clap is a SHORT loud region (≤ 160 ms).  Speech produces many long regions.
    • 1 short region ⇒ "single"; 2 short regions with small gap ⇒ "double".
    • If >35 % of frames are loud ⇒ it's sustained audio (speech/music), not a clap.

Tunables at the top of the file if you want to calibrate for your environment.
"""

import struct
from typing import Optional

import speech_recognition as sr

# ── Tunables ─────────────────────────────────────────────────────────────────
FRAME_MS = 20
LOUDNESS_RATIO = 0.50          # frame is "loud" if RMS >= LOUDNESS_RATIO * peak_rms
MIN_PEAK_RMS = 2500            # below this, whole clip is too quiet to be a clap
MAX_CLAP_REGION_MS = 160       # a single clap must end within this window
MAX_DOUBLE_CLAP_GAP_MS = 700   # max silence between two claps to call them "double"
SPEECH_LOUD_FRAME_RATIO = 0.35 # if this much of clip is loud, treat as speech


def detect_clap(audio: sr.AudioData) -> Optional[str]:
    raw = audio.get_raw_data()
    sample_width = audio.sample_width
    sample_rate = audio.sample_rate

    # Only 16-bit PCM supported (what SpeechRecognition's default mic produces)
    if sample_width != 2 or not raw:
        return None

    sample_count = len(raw) // 2
    if sample_count == 0:
        return None
    samples = struct.unpack(f"<{sample_count}h", raw)

    frame_size = max(1, int(sample_rate * FRAME_MS / 1000))
    frames_per_ms = frame_size / FRAME_MS
    rms_values = []
    for i in range(0, len(samples), frame_size):
        chunk = samples[i : i + frame_size]
        if not chunk:
            continue
        # Use float math to avoid int overflow on sums of squares.
        mean_sq = sum(s * s for s in chunk) / len(chunk)
        rms_values.append(mean_sq ** 0.5)

    if not rms_values:
        return None

    peak = max(rms_values)
    if peak < MIN_PEAK_RMS:
        return None  # whole clip is quiet

    threshold = peak * LOUDNESS_RATIO
    loud_mask = [r >= threshold for r in rms_values]
    loud_ratio = sum(loud_mask) / len(loud_mask)
    if loud_ratio > SPEECH_LOUD_FRAME_RATIO:
        return None  # sustained loudness → speech / noise

    # Group contiguous loud frames into regions (start, end_exclusive)
    regions: list[tuple[int, int]] = []
    in_region = False
    start = 0
    for i, loud in enumerate(loud_mask):
        if loud and not in_region:
            in_region = True
            start = i
        elif not loud and in_region:
            in_region = False
            regions.append((start, i))
    if in_region:
        regions.append((start, len(loud_mask)))

    # A clap should be SHORT
    max_region_frames = MAX_CLAP_REGION_MS / FRAME_MS
    short_regions = [(a, b) for (a, b) in regions if (b - a) <= max_region_frames]

    if len(short_regions) == 1 and len(regions) == 1:
        return "single"

    if len(short_regions) == 2 and len(regions) == 2:
        gap_ms = (short_regions[1][0] - short_regions[0][1]) * FRAME_MS
        if 0 <= gap_ms <= MAX_DOUBLE_CLAP_GAP_MS:
            return "double"
        # Two claps but too far apart — treat as single (user's 2nd clap was separate)
        return "single"

    return None
