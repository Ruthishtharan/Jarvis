import re
import unicodedata
from datetime import datetime
from difflib import SequenceMatcher
from config.constants import WAKE_WORDS, WAKE_WORD_VARIANTS

# Known mishearings are matched EXACTLY (see config.constants).  The fuzzy
# matcher is only a backstop for variants we haven't catalogued yet, so it
# runs at a strict threshold: at the old 0.75 the 2-gram "javais" (from "the
# java is hot") scored 0.83 against "jarvis" and woke the assistant during
# ordinary conversation.  Measured 3 false wakes per 20 normal sentences.
_FUZZY_WAKE_SIMILARITY = 0.84  # 0..1; 1.0 = exact match
_PUNCT_RE = re.compile(r"[^\w\s]")


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    return text.lower().strip()


def _strip_punct(text: str) -> str:
    return _PUNCT_RE.sub("", text)


def _fuzzy_match(token: str, target: str) -> bool:
    """True if `token` is similar enough to `target` (e.g. 'darvies' ~ 'jarvis')."""
    if len(token) < 3:
        return False
    return SequenceMatcher(None, token, target).ratio() >= _FUZZY_WAKE_SIMILARITY


def _candidate_wake_fragments(tokens: list[str]) -> list[tuple[int, int, str]]:
    """Return (start_index, end_index_exclusive, fragment) for each 1- or 2-gram.
    Lets us catch Whisper splits like 'jarav is' -> 'jaravis'."""
    out = []
    for i, tok in enumerate(tokens):
        out.append((i, i + 1, tok))
        if i + 1 < len(tokens):
            out.append((i, i + 2, tok + tokens[i + 1]))
    return out


def _all_exact_wakes() -> list[str]:
    """Wake words plus catalogued STT mishearings, all matched exactly."""
    return list(WAKE_WORDS) + list(WAKE_WORD_VARIANTS)


def contains_wake_word(text: str) -> bool:
    normalized = _strip_punct(normalize_text(text))

    # 1. Exact substring — real wake words and known mishearings.
    if any(wake in normalized for wake in _all_exact_wakes()):
        return True

    # 2. Token-joined exact match, for STT splitting one word into two
    #    ("jarav is" -> "jaravis").  Still exact, so still zero-risk.
    tokens = normalized.split()
    exact = set(_all_exact_wakes())
    for _, _, frag in _candidate_wake_fragments(tokens):
        if frag in exact:
            return True

    # 3. Fuzzy backstop for uncatalogued variants, deliberately strict.
    single_wakes = [w for w in WAKE_WORDS if " " not in w]
    for _, _, frag in _candidate_wake_fragments(tokens):
        for wake in single_wakes:
            if _fuzzy_match(frag, wake):
                return True
    return False


def strip_wake_word(text: str) -> str:
    normalized = _strip_punct(normalize_text(text))
    # Exact-prefix strip first (wake words + known mishearings)
    for wake in sorted(_all_exact_wakes(), key=len, reverse=True):
        if normalized.startswith(wake):
            return normalized[len(wake):].strip(" ,.")
    # Fuzzy strip: drop the first 1–2 tokens if they together resemble a wake word
    tokens = normalized.split()
    if not tokens:
        return normalized
    single_wakes = [w for w in WAKE_WORDS if " " not in w]
    exact = set(_all_exact_wakes())
    # Prefer the 2-gram match (more to strip) over 1-gram
    for end in (2, 1):
        if end > len(tokens):
            continue
        frag = "".join(tokens[:end])
        if frag in exact:
            return " ".join(tokens[end:]).strip(" ,.")
        for wake in single_wakes:
            if _fuzzy_match(frag, wake):
                return " ".join(tokens[end:]).strip(" ,.")

    # Wake word appeared mid-utterance ("so jarvis what time is it") — drop
    # everything up to and including it, keeping only the actual command.
    for i, tok in enumerate(tokens):
        if tok in exact or any(_fuzzy_match(tok, w) for w in single_wakes):
            return " ".join(tokens[i + 1:]).strip(" ,.")

    return normalized


def get_current_time() -> str:
    return datetime.now().strftime("%I:%M %p")


def get_current_date() -> str:
    return datetime.now().strftime("%A, %B %d, %Y")


def clean_for_speech(text: str) -> str:
    """Strip formatting that a speech synthesiser reads out literally.

    Prompting the model not to use markdown is not sufficient — it still
    produces bullet lists when the answer is naturally a list. So the markers
    are removed here as well, where the guarantee is absolute.

    Without this, "- Tell you the time" is spoken with the leading dash, and
    "1. Travel dates" becomes "one dot travel dates".
    """
    # Leading list markers, per line: "- ", "* ", "• ", "1. ", "2) "
    text = re.sub(r"^[ \t]*(?:[-*•\u2022]|\d{1,2}[.)])[ \t]+", "", text, flags=re.M)
    # Inline emphasis / code / headings
    text = re.sub(r"[*_`#]", "", text)
    # Markdown links: keep the label, drop the URL
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    # Blockquotes and horizontal rules
    text = re.sub(r"^[ \t]*>[ \t]?", "", text, flags=re.M)
    text = re.sub(r"^[ \t]*[-=]{3,}[ \t]*$", "", text, flags=re.M)
    # Line breaks become sentence breaks — but only where one is needed.
    # Blindly appending a period turned "On this Mac I can:" into
    # "On this Mac I can:. Tell you the time."
    def _join(match: "re.Match") -> str:
        before = text[:match.start()].rstrip()
        return " " if before.endswith((".", "!", "?", ":", ";", ",")) else ". "

    text = re.sub(r"\n+", _join, text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def truncate(text: str, max_chars: int = 200) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rsplit(" ", 1)[0] + "..."


def parse_volume(text: str) -> int | None:
    # Match signed integers so "volume -10" clamps to 0 (not 10).
    match = re.search(r"-?\d{1,3}", text)
    if match:
        val = int(match.group(0))
        return max(0, min(100, val))
    keywords = {"full": 100, "max": 100, "half": 50, "low": 20, "minimum": 5, "zero": 0}
    for word, val in keywords.items():
        if word in text.lower():
            return val
    return None
