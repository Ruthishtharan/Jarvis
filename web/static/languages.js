/* Languages JARVIS understands, and how to wake him in each.
 *
 * Two separate problems live here:
 *
 *   1. WHICH LOCALE the speech recogniser runs in. This is not optional —
 *      `SpeechRecognition` transcribes against one language model at a time.
 *      Tamil speech fed to an en-US recogniser comes back as nonsense English,
 *      so the selected language genuinely changes what JARVIS can hear.
 *
 *   2. WHAT THE WAKE WORD SOUNDS LIKE once transcribed. "Jarvis" is an English
 *      name; every recogniser mangles it differently, and Indic and Japanese
 *      recognisers return it in their own script. Each entry therefore lists
 *      several spellings — native script, romanisation, and the mishearings
 *      that actually occur ("service", "jervis", "drivers").
 *
 * The mandatory six are first. The rest are ordered by speaker count, biased
 * toward languages Ruthish is likely to encounter.
 */

export const LANGUAGES = [
  // ── The six required ────────────────────────────────────────────────
  { code: 'en-US', name: 'English',   native: 'English',
    // 'service', 'harvest', 'drivers' and 'travis' are all real mishearings
    // of "Jarvis" — and all ordinary English words. Including them made
    // "the service was terrible" wake JARVIS mid-conversation, which is the
    // exact failure this mode exists to prevent. Missing the odd wake word
    // is far cheaper than acting on speech that was not addressed to you.
    wake: ['jarvis', 'jarviss', 'jervis', 'javis', 'jarvas', 'jarvist'] },

  { code: 'ta-IN', name: 'Tamil',     native: 'தமிழ்',
    wake: ['jarvis', 'ஜார்விஸ்', 'ஜார்வீஸ்', 'jaarvis', 'jarvees', 'சார்விஸ்'] },

  { code: 'hi-IN', name: 'Hindi',     native: 'हिन्दी',
    wake: ['jarvis', 'जार्विस', 'जारविस', 'jaarvis', 'jarvees', 'जर्विस'] },

  { code: 'kn-IN', name: 'Kannada',   native: 'ಕನ್ನಡ',
    wake: ['jarvis', 'ಜಾರ್ವಿಸ್', 'ಜಾರ್ವೀಸ್', 'jaarvis', 'jarvees'] },

  { code: 'ml-IN', name: 'Malayalam', native: 'മലയാളം',
    wake: ['jarvis', 'ജാർവിസ്', 'ജാര്‍വിസ്', 'jaarvis', 'jarvees'] },

  { code: 'ja-JP', name: 'Japanese',  native: '日本語',
    wake: ['jarvis', 'ジャービス', 'ジャーヴィス', 'ジャビス', 'じゃーびす'] },

  // ── Widely spoken, added by reach ───────────────────────────────────
  { code: 'zh-CN', name: 'Mandarin',   native: '中文',      wake: ['jarvis', '贾维斯', '賈維斯'] },
  { code: 'es-ES', name: 'Spanish',    native: 'Español',   wake: ['jarvis', 'yarvis', 'charvis'] },
  { code: 'ar-SA', name: 'Arabic',     native: 'العربية',   wake: ['jarvis', 'جارفيس'] },
  { code: 'fr-FR', name: 'French',     native: 'Français',  wake: ['jarvis', 'jarvisse'] },
  { code: 'pt-BR', name: 'Portuguese', native: 'Português', wake: ['jarvis', 'jarvys'] },
  { code: 'ru-RU', name: 'Russian',    native: 'Русский',   wake: ['jarvis', 'джарвис'] },
  { code: 'de-DE', name: 'German',     native: 'Deutsch',   wake: ['jarvis', 'jarwis'] },
  { code: 'ko-KR', name: 'Korean',     native: '한국어',     wake: ['jarvis', '자비스', '자아비스'] },
  { code: 'it-IT', name: 'Italian',    native: 'Italiano',  wake: ['jarvis', 'giarvis'] },
  { code: 'id-ID', name: 'Indonesian', native: 'Indonesia', wake: ['jarvis'] },
  { code: 'tr-TR', name: 'Turkish',    native: 'Türkçe',    wake: ['jarvis', 'carvis'] },
  { code: 'vi-VN', name: 'Vietnamese', native: 'Tiếng Việt',wake: ['jarvis', 'gia vít'] },
  { code: 'th-TH', name: 'Thai',       native: 'ไทย',       wake: ['jarvis', 'จาร์วิส'] },
  { code: 'nl-NL', name: 'Dutch',      native: 'Nederlands',wake: ['jarvis'] },
  { code: 'pl-PL', name: 'Polish',     native: 'Polski',    wake: ['jarvis', 'dżarwis'] },

  // ── Other Indian languages ──────────────────────────────────────────
  { code: 'te-IN', name: 'Telugu',    native: 'తెలుగు',   wake: ['jarvis', 'జార్విస్'] },
  { code: 'bn-IN', name: 'Bengali',   native: 'বাংলা',    wake: ['jarvis', 'জার্ভিস'] },
  { code: 'mr-IN', name: 'Marathi',   native: 'मराठी',    wake: ['jarvis', 'जार्विस'] },
  { code: 'gu-IN', name: 'Gujarati',  native: 'ગુજરાતી',  wake: ['jarvis', 'જાર્વિસ'] },
  { code: 'pa-IN', name: 'Punjabi',   native: 'ਪੰਜਾਬੀ',   wake: ['jarvis', 'ਜਾਰਵਿਸ'] },
  { code: 'ur-PK', name: 'Urdu',      native: 'اردو',      wake: ['jarvis', 'جاروس'] },
];

export const byCode = (code) =>
  LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];

/** Every wake spelling across every language — used in "any language" mode. */
export const ALL_WAKE = [...new Set(LANGUAGES.flatMap((l) => l.wake))];

/**
 * Does `text` contain a wake word, and where does the command start?
 *
 * Returns { woke, command, matched } — `command` is the text with the wake
 * word and any leading filler removed, so "jarvis, please open chrome"
 * becomes "open chrome".
 *
 * Deliberately generous about position: people say "jarvis open chrome",
 * "hey jarvis, open chrome", and "open chrome jarvis". Requiring it at the
 * front would reject a third of real usage.
 */
export function detectWake(text, wakeWords) {
  if (!text) return { woke: false, command: '', matched: null };

  const lower = text.toLowerCase().trim();

  for (const w of wakeWords) {
    const needle = w.toLowerCase();

    // Word-boundary match. A substring search fires on "jarvisian" and, worse,
    // on any longer word that happens to contain a short wake spelling.
    // \b is unreliable for non-Latin scripts, so fall back to checking the
    // characters either side are not letters.
    let at = -1, from = 0;
    while (from <= lower.length) {
      const i = lower.indexOf(needle, from);
      if (i === -1) break;
      const before = i === 0 ? ' ' : lower[i - 1];
      const after = lower[i + needle.length] ?? ' ';
      const isLetter = (c) => /[\p{L}\p{N}]/u.test(c);
      if (!isLetter(before) && !isLetter(after)) { at = i; break; }
      from = i + 1;
    }
    if (at === -1) continue;

    // Take everything after the wake word; if nothing follows, take what
    // preceded it ("open chrome jarvis").
    let after = text.slice(at + needle.length);
    let command = after.trim() ? after : text.slice(0, at);

    command = command
      .replace(/^[\s,.:;!?—-]+/, '')          // punctuation left by the split
      .replace(/^(hey|hi|hello|ok|okay|please|can you|could you)\s+/i, '')
      .replace(/[\s,.:;]+$/, '')
      .trim();

    return { woke: true, command, matched: w };
  }
  return { woke: false, command: '', matched: null };
}
