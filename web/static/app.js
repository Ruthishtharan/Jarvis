/* JARVIS — voice-first controller.
 *
 * Design intent: the star is the interface. Voice is the primary input, text
 * is the fallback, and every panel stays hidden until asked for.
 *
 * Flow:
 *   hold Space / click orb  → recognition starts, mic level feeds the star
 *   interim words           → shown live, greyed and italic
 *   final phrase            → POST /api/command
 *   reply                   → shown large, spoken via speechSynthesis
 *   continuous mode         → re-arms the mic once speaking finishes
 */

import { ParticleSun } from './particles.js';
import { LANGUAGES, byCode, ALL_WAKE, detectWake } from './languages.js';
import { AmbientListener } from './listener.js';

const $ = (s) => document.querySelector(s);

const el = {
  canvas: $('#sun'), pip: $('#pip'), conn: $('#conn'), wake: $('#wake'),
  you: $('#you'), jarvis: $('#jarvis'), hint: $('#hint'),
  wave: $('#wave'), orb: $('#orb'), composer: $('#composer'), input: $('#input'),
  drawer: $('#drawer'), transcript: $('#transcript'),
  chat: $('#chat'), chatlog: $('#chatlog'), chatform: $('#chatform'),
  chatinput: $('#chatinput'), readmore: $('#readmore'),
  settings: $('#settings'), sys: $('#sys'), sliders: $('#sliders'),
  brain: $('#brain'),
  toast: $('#toast'),
  optSpeak: $('#opt-speak'), optCont: $('#opt-continuous'),
  optRate: $('#opt-rate'), rateVal: $('#rate-val'), optVoice: $('#opt-voice'),
};

const sun = new ParticleSun(el.canvas, { count: 20000, viewShift: 120,
  mode: new URLSearchParams(location.search).get('form') === 'brain' ? 'brain' : 'star' });
sun.start();

// ── State ──────────────────────────────────────────────────────────────

let ws = null;
let recognizing = false;
let busy = false;
let busySince = 0;
let wantStop = false;
let rearmTimer = null;
let restartAfterEnd = false;
let speaking = false;
// Settings live in localStorage so the Brain app can change how JARVIS
// behaves without either app needing to know about the other.
const SETTINGS_KEY = 'jarvis.settings';
const DEFAULTS = {
  speak: true,
  continuous: true,
  rate: 1.05,
  voice: null,
  lang: 'auto',
  anyLanguage: true,   // accept wake words from every language, not just the
                       // selected one — people code-switch mid-sentence
  wakeRequired: true,  // listen always, act only when named
  clapWake: true,
};


// Settings migration. A stored value always beats a changed default, so
// simply flipping the default to 'auto' did nothing for anyone who had
// already run the app — localStorage still held 'en-US' and pinned English
// forever. Bumping the version resets that one field, once.
const SETTINGS_VERSION = 2;

function migrate(s) {
  if ((s.v || 1) < 2) {
    // Nobody explicitly chose a language before this version existed, so a
    // stored tag is a stale default rather than a real preference.
    s.lang = 'auto';
    s.v = SETTINGS_VERSION;
  }
  return s;
}

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const merged = migrate({ ...DEFAULTS, ...stored });
    if ((stored.v || 1) < SETTINGS_VERSION) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    }
    return merged;
  } catch { return { ...DEFAULTS }; }
}

let cfg = readSettings();
let continuous = cfg.continuous;
let speakEnabled = cfg.speak;
let speakRate = cfg.rate;
let chosenVoice = null;
let keepAlive = null;
let preferredVoiceName = cfg.voice;
let lang = cfg.lang;

// The language of the last thing actually heard. Whisper detects it per
// utterance, so switching languages needs no setting and no command — just
// start speaking Tamil and the reply comes back in Tamil.
let detectedTag = '';
let detectedName = '';

/** What to reply in: whatever was last heard, unless a language is pinned. */
function currentLang() {
  if (lang && lang !== 'auto') return lang;
  return detectedTag || 'en-US';
}
let wakeRequired = cfg.wakeRequired;
let clapWake = cfg.clapWake;
let anyLanguage = cfg.anyLanguage;

function wakeWords() {
  return anyLanguage ? ALL_WAKE : byCode(lang).wake;
}

function applySettings(next) {
  cfg = next;
  continuous = cfg.continuous;
  speakEnabled = cfg.speak;
  speakRate = cfg.rate;
  preferredVoiceName = cfg.voice;
  wakeRequired = cfg.wakeRequired;
  clapWake = cfg.clapWake;
  anyLanguage = cfg.anyLanguage;
  if (cfg.lang !== lang) {
    lang = cfg.lang;
    if (recog) {
      recog.lang = lang;
      // The locale only takes effect on the next session, so cycle it.
      if (recognizing) { restartAfterEnd = true; stopListening(); }
    }
    toast('Listening in ' + byCode(lang).native);
  }
  if (el.optSpeak) el.optSpeak.checked = speakEnabled;
  if (el.optCont) el.optCont.checked = continuous;
  if (el.optRate) { el.optRate.value = speakRate; el.rateVal.textContent = speakRate.toFixed(2); }
  // A change to continuous while idle should take effect immediately.
  if (continuous && !recognizing && !busy && !speaking) listen();
}

// `storage` fires for other windows; the Brain app also dispatches a custom
// event for same-window changes.
window.addEventListener('storage', (e) => {
  if (e.key === SETTINGS_KEY) applySettings(readSettings());
});
window.addEventListener('jarvis-settings', (e) => applySettings(e.detail));
let history = [];

// ── Small helpers ──────────────────────────────────────────────────────

let toastTimer;
const CLEAN = document.body.classList.contains('clean');

function toast(msg) {
  // In clean mode nothing is painted over the star. The message still
  // matters, so it goes to the chat log rather than being dropped.
  if (CLEAN) {
    note(msg);
    return;
  }
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200);
}

/** A system line in the chat log — quieter than a message. */
function note(msg) {
  if (!el.chatlog) return;
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = `<div class="meta">${esc(msg)}</div>`;
  el.chatlog.appendChild(div);
  el.chatlog.scrollTop = el.chatlog.scrollHeight;
}

// The top bar is hidden until the pointer approaches it, so there is a way
// into chat and settings without anything sitting on screen permanently.
if (CLEAN) {
  let peekTimer;
  const bar = document.querySelector('.status');
  document.addEventListener('mousemove', (e) => {
    if (e.clientY < 90) {
      bar.classList.add('peek');
      clearTimeout(peekTimer);
    } else if (bar.classList.contains('peek')) {
      clearTimeout(peekTimer);
      peekTimer = setTimeout(() => bar.classList.remove('peek'), 1200);
    }
  });
}

const esc = (s) => {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
};

let passiveTimer = null;
function setPassive(text) {
  // Fade overheard speech after a moment so the screen doesn't accumulate
  // a wall of things JARVIS was not asked about.
  clearTimeout(passiveTimer);
  passiveTimer = setTimeout(() => {
    if (el.you.classList.contains('passive')) el.you.textContent = '';
  }, 4500);
}

function setState(state, detail) {
  sun.setState(state);
  el.orb.classList.toggle('rec', state === 'listening');
  el.orb.classList.toggle('busy', state === 'thinking' || state === 'speaking');
  el.wake.textContent = {
    idle: 'say something',
    listening: 'listening…',
    thinking: 'thinking…',
    speaking: 'speaking',
    error: 'something went wrong',
  }[state] || state;
  if (detail) el.wake.title = detail;
}

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
  return res.json();
}

// ── Waveform ───────────────────────────────────────────────────────────

const BARS = 28;
const bars = [];
for (let i = 0; i < BARS; i++) {
  const b = document.createElement('i');
  el.wave.appendChild(b);
  bars.push(b);
}

// ── Mic capture: level → star + waveform ───────────────────────────────

let audioCtx = null, analyser = null, micStream = null, levelRaf = null;

async function startMeter() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    audioCtx.createMediaStreamSource(micStream).connect(analyser);

    const time = new Uint8Array(analyser.frequencyBinCount);
    const freq = new Uint8Array(analyser.frequencyBinCount);
    el.wave.classList.add('on');

    const pump = () => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(time);
      analyser.getByteFrequencyData(freq);

      // RMS about the 128 midpoint. Peak alone jitters too much to look good.
      let sum = 0;
      for (let i = 0; i < time.length; i++) {
        const v = (time[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / time.length);
      sun.setLevel(Math.min(1, rms * 3.2));
      if (clapWake) detectClap(rms, freq);

      // Bars sample the low half of the spectrum — that's where speech lives,
      // and the top half is mostly empty air that would flatline the display.
      const usable = Math.floor(freq.length * 0.45);
      const step = Math.max(1, Math.floor(usable / BARS));
      for (let i = 0; i < BARS; i++) {
        let acc = 0;
        for (let j = 0; j < step; j++) acc += freq[i * step + j] || 0;
        const v = (acc / step) / 255;
        bars[i].style.height = (3 + v * 27).toFixed(1) + 'px';
      }
      levelRaf = requestAnimationFrame(pump);
    };
    pump();
  } catch (err) {
    toast('Mic unavailable — ' + err.message);
  }
}

function stopMeter() {
  if (levelRaf) cancelAnimationFrame(levelRaf);
  levelRaf = null; analyser = null;
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = null;
  if (audioCtx) audioCtx.close().catch(() => {});
  audioCtx = null;
  sun.setLevel(0);
  el.wave.classList.remove('on');
  bars.forEach((b) => (b.style.height = '3px'));
}

// ── Interruption ───────────────────────────────────────────────────────
//
// When you talk over JARVIS it stops immediately and listens. The reply it
// was part-way through is remembered, so once you have finished it can ask
// which thread you want rather than silently dropping one.

let interrupted = null;   // { topic, reply, spokenUpTo, at }

function onBargeIn() {
  if (!speaking) return;

  const lastJarvis = [...messages].reverse().find((m) => m.who === 'jarvis');
  const lastYou = [...messages].reverse().find((m) => m.who === 'you');

  interrupted = {
    topic: lastYou ? lastYou.body : '',
    reply: lastJarvis ? lastJarvis.body : '',
    at: Date.now(),
  };

  stopSpeaking();   // cancels speechSynthesis AND any playing neural audio
  speaking = false;
  clearInterval(keepAlive);
  if (ambient) ambient.setPaused(false);

  sun.setLevel(0);
  setState('listening', 'interrupted');
  // Barge-in ends the reply too, and the server needs to hear about it.
  wsSend({ type: 'state', state: 'listening' });
  el.hint.classList.remove('gone');
  el.hint.textContent = 'Go ahead — I was mid-answer, I will come back to it';
  toast('Interrupted — listening');
}

/**
 * After an interruption is dealt with, offer both threads.
 *
 * Only asks if the interruption was recent. Being asked "shall I go back to
 * what I was saying?" ten minutes later is noise, not helpfulness.
 */
function offerResume() {
  if (!interrupted) return false;

  const age = Date.now() - interrupted.at;
  const stale = age > 5 * 60 * 1000;
  const prev = interrupted;
  interrupted = null;
  if (stale || !prev.reply) return false;

  const shortTopic = prev.topic.length > 60
    ? prev.topic.slice(0, 57) + '…' : prev.topic;

  resumeOffer = prev;
  const question = shortTopic
    ? `Before that, I was answering "${shortTopic}". Shall I finish, or leave it?`
    : 'Shall I finish what I was saying before, or leave it?';

  addMessage('jarvis', question, 'resume offer');
  el.jarvis.textContent = question;
  el.readmore.hidden = true;
  say(question, () => setState('idle'));
  return true;
}

let resumeOffer = null;

/** Catch "yes, carry on" / "no, forget it" after a resume offer. */
function handleResumeAnswer(text) {
  if (!resumeOffer) return false;

  const low = text.toLowerCase().trim();
  const yes = /^(yes|yeah|yep|sure|go on|carry on|continue|finish|please do|ok|okay|do it)\b/.test(low);
  const no = /^(no|nope|nah|leave it|forget it|skip|drop it|never mind|nevermind)\b/.test(low);

  if (!yes && !no) { resumeOffer = null; return false; }

  const offer = resumeOffer;
  resumeOffer = null;

  if (no) {
    const ack = 'Dropped.';
    addMessage('jarvis', ack);
    el.jarvis.textContent = ack;
    say(ack, () => setState('idle'));
    return true;
  }

  addMessage('jarvis', offer.reply, 'resumed');
  el.jarvis.textContent = offer.reply;
  el.readmore.hidden = offer.reply.length < 160;
  say(offer.reply, () => setState('idle'));
  return true;
}

// ── Chat log ───────────────────────────────────────────────────────────
//
// The centre of the screen shows a clamped excerpt; a 400-word answer there
// buried the star and was unreadable anyway. The full text lives here.

const messages = [];

function addMessage(who, body, meta) {
  messages.push({ who, body, meta, at: new Date() });
  const div = document.createElement('div');
  div.className = 'msg ' + (who === 'you' ? 'me' : 'jarvis');
  div.innerHTML =
    `<div class="who">${who === 'you' ? 'You' : 'JARVIS'}</div>` +
    `<div class="body">${esc(body)}</div>` +
    (meta ? `<div class="meta">${esc(meta)}</div>` : '');
  el.chatlog.appendChild(div);
  el.chatlog.scrollTop = el.chatlog.scrollHeight;
}

function openChat() {
  closeDrawers();
  el.chat.classList.add('open');
  el.chatlog.scrollTop = el.chatlog.scrollHeight;
  setTimeout(() => el.chatinput.focus(), 220);
}

$('#btn-chat').addEventListener('click', openChat);
$('#chat-close').addEventListener('click', () => closeDrawers());
el.readmore.addEventListener('click', openChat);

// Clicking the reply text stops playback — the obvious gesture when a long
// answer is running and you want to cut in.
el.jarvis.style.pointerEvents = 'auto';
el.jarvis.style.cursor = 'default';
el.jarvis.addEventListener('click', () => { if (speaking) onBargeIn(); });

$('#chat-speak').addEventListener('click', () => {
  const last = [...messages].reverse().find((m) => m.who === 'jarvis');
  if (last) say(last.body, () => setState('idle'));
});

el.chatform.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.chatinput.value.trim();
  if (!text) return;
  el.chatinput.value = '';
  send(text);
});

// ── Ambient listener (server-side STT) ─────────────────────────────────
//
// Used instead of webkitSpeechRecognition, which returns `network` forever in
// Electron. Same wake-word gate, different ears.

let ambient = null;

function handleTranscript(text, meta) {
  const heard = (text || '').trim();
  if (!heard) return;

  if (meta && meta.tag) {
    const switched = detectedTag && detectedTag !== meta.tag;
    detectedTag = meta.tag;
    detectedName = meta.language || '';
    if (switched && lang === 'auto') {
      // Worth surfacing: it explains why the voice just changed.
      toast(`Switched to ${detectedName || meta.tag}`);
    }
    // Re-pick the voice so the reply is spoken by a native speaker of
    // whatever was just heard, not an English voice reading Tamil.
    pickVoiceFor(currentLang());
  }

  const armed = spaceHeld || clapArmed;

  if (!wakeRequired || armed) {
    clapArmed = false;
    el.you.classList.remove('passive', 'interim');
    el.you.textContent = heard;
    send(heard);
    return;
  }

  const { woke, command, matched } = detectWake(heard, wakeWords());

  if (!woke) {
    el.you.classList.add('passive');
    el.you.classList.remove('interim');
    el.you.textContent = heard;
    setPassive(heard);
    return;
  }

  el.you.classList.remove('passive', 'interim');

  if (!command) {
    el.you.textContent = heard;
    clapArmed = true;
    clapArmedAt = Date.now();
    setState('listening', 'awaiting command');
    toast('Listening…');
    return;
  }

  el.you.textContent = command;
  console.debug('woke on', matched, 'via', meta.engine);
  send(command);
}

async function startAmbient() {
  if (ambient) return;

  // In the desktop app the OS grant is invisible to the page — getUserMedia
  // just rejects. Ask the main process first so we can say WHY, and offer
  // the one click that fixes it, instead of showing a generic failure.
  if (window.jarvisDesktop?.micStatus) {
    try {
      const mic = await window.jarvisDesktop.micStatus();
      if (!mic.ok) {
        showMicBlocked(mic.reason);
        return;
      }
    } catch { /* fall through and let getUserMedia decide */ }
  }

  ambient = new AmbientListener({
    getLang: () => lang,
    onBargeIn,
    onText: handleTranscript,
    onLevel: (rms, freq) => {
      sun.setLevel(Math.min(1, rms * 3.2));
      paintBars(freq);
      if (clapWake) detectClap(rms, freq);
    },
    onState: (s) => {
      if (busy || speaking) return;
      if (s === 'hearing') { setState('listening'); el.wave.classList.add('on'); }
      else if (s === 'listening') { setState('idle'); el.wave.classList.add('on'); }
      else if (s === 'muted') { setState('idle'); el.wave.classList.remove('on'); }
    },
  });
  try {
    // getUserMedia can hang indefinitely when the OS permission dialog is
    // suppressed or a device is wedged. Without a deadline the UI sits on
    // "Starting the microphone…" forever with no explanation.
    await Promise.race([
      ambient.start(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('timed out waiting for the microphone')), 8000)),
    ]);
    el.hint.textContent = 'Listening — say "Jarvis" then what you want';
    el.wave.classList.add('on');
  } catch (err) {
    ambient = null;
    el.hint.textContent = 'Microphone blocked — click the mic to allow';
    toast('Mic permission needed: ' + err.message);
  }
}

function showMicBlocked(reason) {
  // Override clean mode: without this the user gets silence and no reason.
  document.querySelector('.convo').classList.add('critical');
  el.hint.innerHTML =
    `Microphone blocked — ${esc(reason || 'permission denied')}. ` +
    `<button id="fix-mic" class="linkish">Open Settings</button>`;
  el.hint.classList.remove('gone');
  el.orb.classList.add('muted');
  setState('error', reason);
  toast('JARVIS cannot hear you — microphone permission needed');

  const btn = document.getElementById('fix-mic');
  if (btn) {
    btn.onclick = () => {
      if (window.jarvisDesktop?.openMicSettings) {
        window.jarvisDesktop.openMicSettings();
        el.hint.innerHTML =
          'Enable <b>Electron</b> under Microphone, then quit and reopen JARVIS.';
      }
    };
  }
}

function paintBars(freq) {
  const usable = Math.floor(freq.length * 0.45);
  const step = Math.max(1, Math.floor(usable / BARS));
  for (let i = 0; i < BARS; i++) {
    let acc = 0;
    for (let j = 0; j < step; j++) acc += freq[i * step + j] || 0;
    bars[i].style.height = (3 + (acc / step / 255) * 27).toFixed(1) + 'px';
  }
}

// ── Clap detection ─────────────────────────────────────────────────────
//
// A clap is not just loud — speech gets loud too. What distinguishes it is
// the *shape*: a near-instant attack from near-silence, broadband (energy
// right across the spectrum, unlike voice which concentrates low), and gone
// within ~80ms. Testing all three keeps a shouted word from waking JARVIS.

let clapArmed = false;
let clapTimes = [];
let lastRms = 0;
let clapCooldownUntil = 0;

const CLAP_ATTACK = 0.16;   // jump in RMS within one frame
const CLAP_FLOOR  = 0.02;   // must rise from near-silence, not mid-sentence
const CLAP_WINDOW = 900;    // ms to gather a double clap

function detectClap(rms, freq) {
  const now = Date.now();
  const jump = rms - lastRms;
  lastRms = rms;

  if (now < clapCooldownUntil) return;
  if (jump < CLAP_ATTACK || rms - jump > CLAP_FLOOR * 4) return;

  // Broadband check: claps put real energy in the top of the spectrum where
  // speech has almost none.
  const half = freq.length >> 1;
  let lo = 0, hi = 0;
  for (let i = 0; i < half; i++) lo += freq[i];
  for (let i = half; i < freq.length; i++) hi += freq[i];
  if (hi / Math.max(lo, 1) < 0.35) return;    // too tonal — that was a voice

  clapCooldownUntil = now + 220;              // ignore the echo
  clapTimes = clapTimes.filter((tm) => now - tm < CLAP_WINDOW);
  clapTimes.push(now);

  if (clapTimes.length >= 1) {
    clapArmed = true;
    clapArmedAt = now;
    setState('listening', 'clap');
    toast(clapTimes.length >= 2 ? 'Double clap — listening' : 'Clap — listening');
    if (clapTimes.length >= 2) clapTimes = [];
  }
}

let clapArmedAt = 0;
// A clap should not arm JARVIS indefinitely, or a stray noise makes the next
// sentence a command hours later.
setInterval(() => {
  if (clapArmed && Date.now() - clapArmedAt > 8000) {
    clapArmed = false;
    if (!busy && !speaking) setState('idle');
  }
}, 1000);

// ── Speech recognition ─────────────────────────────────────────────────

// The browser speech API is deliberately not used. It cannot work in
// Electron (no Google key), and where it does work it is slower and less
// accurate than the Groq whisper endpoint JARVIS already has.
const SR = null;
let recog = null;

if (SR) {
  recog = new SR();
  // Keep one long session open rather than ending at every pause. This is
  // what makes JARVIS *ambient* instead of push-to-talk.
  recog.continuous = true;
  recog.interimResults = true;
  recog.lang = lang;

  recog.onstart = () => {
    recognizing = true;
    // A stop asked for before the engine finished starting.
    if (wantStop) { wantStop = false; try { recog.stop(); } catch {} return; }
    el.hint.classList.add('gone');
    el.you.textContent = '';
    setState('listening');
    wsSend({ type: 'state', state: 'listening' });
    startMeter();
  };

  recog.onresult = (ev) => {
    let interim = '', final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) final += r; else interim += r;
    }

    if (interim) {
      el.you.textContent = interim;
      el.you.classList.add('interim', 'passive');
    }
    if (!final.trim()) return;

    const heard = final.trim();
    el.you.classList.remove('interim');

    // Push-to-talk and the clap both bypass the wake word: you have already
    // addressed JARVIS by another means.
    const armed = spaceHeld || clapArmed;

    if (!wakeRequired || armed) {
      clapArmed = false;
      el.you.classList.remove('passive');
      el.you.textContent = heard;
      send(heard);
      return;
    }

    const { woke, command, matched } = detectWake(heard, wakeWords());

    if (!woke) {
      // Overheard, not addressed. Show it so you can see JARVIS is awake and
      // listening, but do nothing — this is the whole point of the mode.
      el.you.classList.add('passive');
      el.you.textContent = heard;
      setPassive(heard);
      return;
    }

    if (!command) {
      // Named with no instruction — "Jarvis?" — acknowledge and wait.
      el.you.classList.remove('passive');
      el.you.textContent = heard;
      clapArmed = true;          // next utterance counts as the command
      setState('listening', 'awaiting command');
      toast('Listening…');
      return;
    }

    el.you.classList.remove('passive');
    el.you.textContent = command;
    console.debug('woke on', matched);
    send(command);
  };

  recog.onerror = (ev) => {
    if (ev.error === 'not-allowed') toast('Microphone permission denied');
    else if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
      toast('Speech error: ' + ev.error);
    }
  };

  recog.onend = () => {
    recognizing = false;
    wantStop = false;
    stopMeter();
    if (!busy && !speaking) setState('idle');

    // Chrome ends the session periodically no matter what `continuous` says
    // — roughly every minute, and always after an error. For ambient
    // listening that has to be invisible, so it always comes back.
    if (continuous || restartAfterEnd) {
      restartAfterEnd = false;
      clearTimeout(rearmTimer);
      rearmTimer = setTimeout(() => {
        if (!recognizing && !busy && !speaking) listen();
      }, 350);
    }
  };
}
// No browser-API branch any more: capture is ambient and transcription is
// server side, so voice works the same in Chrome, Safari and Electron.

function listen() {
  // Listening is ambient now; this only ensures capture is running.
  if (!ambient) { startAmbient(); return; }
  if (ambient.muted) ambient.setMuted(false);
  return;
}

function _unusedListen() {
  if (!recog) { return; }
  if (recognizing) return;

  // Barge-in: stop any reply that is still playing and clear the flag
  // ourselves rather than waiting for an onend that may never arrive.
  if (speaking) {
    try { speechSynthesis.cancel(); } catch {}
    speaking = false;
    sun.setLevel(0);
  }

  // `busy` should never outlive its request, but a dropped promise would
  // wedge the mic permanently. Treat a stale one as finished.
  if (busy && Date.now() - busySince > 30000) {
    console.warn('stale busy flag cleared');
    busy = false;
  }
  if (busy) return;

  try {
    recog.start();
  } catch (err) {
    // "already started" means state drifted from reality — resync.
    if (String(err).includes('already')) { recognizing = true; return; }
    toast('Could not start the mic: ' + err.message);
  }
}

function stopListening() {
  return;   // ambient capture is never stopped by push-to-talk
}

function _unusedStop() {
  if (!recog) return;
  if (recognizing) {
    try { recog.stop(); } catch {}
  } else {
    // start() is still in flight; onstart will honour this.
    wantStop = true;
  }
}

function toggleMic() {
  // While JARVIS is talking the orb means "stop talking and listen to me",
  // not "mute". Acoustic barge-in can lose against loud speakers, so there
  // has to be a control that cannot fail.
  if (speaking) { onBargeIn(); return; }

  if (!ambient) { startAmbient(); return; }
  const next = !ambient.muted;
  ambient.setMuted(next);
  el.orb.classList.toggle('muted', next);
  toast(next ? 'Microphone muted' : 'Listening');
}

// ── Speaking ───────────────────────────────────────────────────────────

/** Choose the best installed voice for a BCP-47 tag. */
function pickVoiceFor(tag) {
  if (!('speechSynthesis' in window)) return;
  const all = speechSynthesis.getVoices();
  if (!all.length) return;

  const base = (tag || 'en-US').split('-')[0].toLowerCase();

  // Exact locale first, then any voice for the language, then give up and
  // keep the current one rather than reading Tamil in an English accent.
  let v = all.find((x) => x.lang.toLowerCase() === tag.toLowerCase())
       || all.find((x) => x.lang.toLowerCase().startsWith(base + '-'))
       || all.find((x) => x.lang.toLowerCase().startsWith(base));

  if (v) { chosenVoice = v; return; }

  if (base !== 'en') {
    console.warn(`no installed voice for ${tag} — install one in ` +
                 `System Settings > Accessibility > Spoken Content`);
  }
}

function loadVoices() {
  const all = speechSynthesis.getVoices();
  if (!all.length) return;
  // Show ALL installed voices, not just English.  Non-English voices are
  // used automatically by pickVoiceFor() when the language switches, but the
  // user should be able to see and select them too.
  el.optVoice.innerHTML = all
    .map((v, i) => `<option value="${i}">${esc(v.name)} <small>(${esc(v.lang)})</small>`)
    .join('');
  // Prefer a natural-sounding English default.
  let idx = preferredVoiceName
    ? all.findIndex((v) => v.name === preferredVoiceName) : -1;
  if (idx < 0) {
    const nice = all.findIndex((v) => /samantha|serena|daniel|karen|natural/i.test(v.name));
    idx = nice >= 0 ? nice : 0;
  }
  // Clamp: if the preferred voice isn't in the list anymore, pick the first.
  if (idx < 0) idx = 0;
  el.optVoice.value = String(idx);
  chosenVoice = all[idx];
  el.optVoice.onchange = () => { chosenVoice = all[+el.optVoice.value]; };
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

// ── Neural voice (ElevenLabs via /api/tts) ─────────────────────────────
//
// The browser's speechSynthesis is the flat macOS system voice. ElevenLabs was
// configured and working the whole time, but only on the Python path that
// `run.py` uses — the desktop apps never touched it, so the voice Ruthish set
// up was the one voice he never heard.
//
// Neural first, browser voice as the fallback. The fallback is not decoration:
// no network, no API key, a 503 or a blocked autoplay all land there, and a
// worse-sounding reply beats silence every time.

let currentAudio = null;   // the playing <audio>, so barge-in can stop it

/** Stop whichever engine is currently talking. */
function stopSpeaking() {
  try { speechSynthesis.cancel(); } catch {}
  if (currentAudio) {
    try { currentAudio.pause(); currentAudio.src = ''; } catch {}
    currentAudio = null;
  }
}

function sayNeural(text, onDone, onFallback) {
  const speakLang = currentLang();
  let done = false;
  let started = false;
  let tick = null;

  const finish = () => {
    if (done) return;
    done = true;
    if (tick) clearInterval(tick);
    sun.setLevel(0);
    speaking = false;
    clearInterval(keepAlive);
    if (currentAudio) { try { currentAudio.pause(); } catch {} currentAudio = null; }
    if (ambient) setTimeout(() => ambient.setPaused(false), 250);
    wsSend({ type: 'state', state: 'idle' });
    onDone && onDone();
  };

  const fail = (why) => {
    if (done || started) return;   // already playing: a late error is not a fallback
    done = true;
    if (tick) clearInterval(tick);
    console.warn('neural voice unavailable, using browser voice:', why);
    onFallback();
  };

  fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang: speakLang }),
  })
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);   // 503 = not configured
      return r.blob();
    })
    .then((blob) => {
      if (done) return;
      const audio = new Audio(URL.createObjectURL(blob));
      currentAudio = audio;
      audio.onended = finish;
      audio.onerror = () => (started ? finish() : fail('decode/playback error'));
      return audio.play().then(() => {
        started = true;
        speaking = true;
        setState('speaking');
        el.hint.classList.remove('gone');
        el.hint.textContent = 'Just talk to interrupt — or press Esc';
        if (ambient) ambient.setPaused(true);
        // No amplitude from an <audio> element either, so animate the star the
        // same way the browser path does.
        tick = setInterval(() => {
          sun.setLevel(0.32 + Math.abs(Math.sin(Date.now() / 100)) * 0.5);
        }, 50);
      });
    })
    .catch(fail);
}

function say(text, onDone) {
  if (!speakEnabled) { onDone && onDone(); return; }
  sayNeural(text, onDone, () => sayBrowser(text, onDone));
}

function sayBrowser(text, onDone) {
  if (!speakEnabled || !('speechSynthesis' in window)) { onDone && onDone(); return; }

  // currentLang(), not `lang`. `lang` is the raw SETTING, which is now the
  // literal string 'auto' — so u.lang became "auto", no voice matched
  // startsWith('auto'), and Chrome silently spoke nothing. The text path
  // already resolved it correctly; only speech did not, which is exactly why
  // replies appeared on screen in Tamil but were never audible.
  const speakLang = currentLang();
  const base = speakLang.split('-')[0];

  const u = new SpeechSynthesisUtterance(text);
  u.rate = speakRate;
  u.pitch = 0.98;
  u.lang = speakLang;

  // Prefer a voice that actually speaks the active language; a saved
  // preference is only valid while the language is unchanged.
  const voices = speechSynthesis.getVoices();
  const match = voices.find((v) => v.lang.toLowerCase() === speakLang.toLowerCase())
             || voices.find((v) => v.lang.toLowerCase().startsWith(base + '-'))
             || voices.find((v) => v.lang.toLowerCase().startsWith(base));

  if (chosenVoice && chosenVoice.lang.toLowerCase().startsWith(base)) {
    u.voice = chosenVoice;
  } else if (match) {
    u.voice = match;
  } else if (base !== 'en') {
    // No voice for this language: say so rather than reading it with an
    // English mouth, which is unintelligible and sounds broken.
    toast(`No ${base.toUpperCase()} voice installed — showing text only`);
    onDone && onDone();
    return;
  }

  // speechSynthesis exposes no amplitude, so drive the star from an
  // oscillation for the utterance rather than leaving it flat.
  const tick = setInterval(() => {
    sun.setLevel(0.32 + Math.abs(Math.sin(Date.now() / 100)) * 0.5);
  }, 50);

  let done = false;
  const finish = () => {
    if (done) return;          // onend + watchdog can both fire
    done = true;
    clearInterval(tick);
    clearInterval(watchdog);
    sun.setLevel(0);
    speaking = false;
    clearInterval(keepAlive);
    if (ambient) setTimeout(() => ambient.setPaused(false), 250);
    // Tell the server the reply finished. setState() only repaints this
    // window; the backend sets "speaking" when it dispatches a reply and has
    // no other way to learn that speech ended. Without this it stayed
    // "speaking" indefinitely — the visualiser pulsing for a reply that
    // finished minutes ago, and anything gating on "is JARVIS talking?"
    // believing it still is.
    wsSend({ type: 'state', state: 'idle' });
    onDone && onDone();
  };

  // Watchdog. speechSynthesis drops `onend` often enough that relying on it
  // alone deadlocks the mic — but a fixed timeout is worse: it cut long
  // replies off mid-sentence, because an estimate capped at 30s cannot cover
  // a 400-word answer. So poll the engine instead of guessing. It is only a
  // stall if the engine says it is no longer speaking.
  let idleTicks = 0;
  const watchdog = setInterval(() => {
    if (done) { clearInterval(watchdog); return; }

    // Chromium suspends synthesis when the window is backgrounded and, on
    // long utterances, sometimes stalls even in the foreground. resume() is
    // a no-op while healthy and un-sticks it when not.
    try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch {}

    if (speechSynthesis.speaking || speechSynthesis.pending) {
      idleTicks = 0;
      return;
    }
    // Not speaking and no onend — give it a moment before declaring a stall.
    if (++idleTicks >= 3) {
      console.warn('speechSynthesis stalled — releasing the mic');
      finish();
    }
  }, 400);

  u.onend = finish;
  u.onerror = finish;

  speaking = true;
  setState('speaking');
  el.hint.classList.remove('gone');
  el.hint.textContent = 'Just talk to interrupt — or press Esc';
  if (ambient) ambient.setPaused(true);   // measured barge-in while speaking
  speechSynthesis.cancel();
  speechSynthesis.speak(u);

  // Losing focus must not stop a reply. Chromium throttles background
  // timers and can suspend synthesis outright; this keeps it alive.
  keepAlive = setInterval(() => {
    if (!speaking) { clearInterval(keepAlive); return; }
    try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch {}
  }, 5000);
}

// ── Sending ────────────────────────────────────────────────────────────

async function send(text) {
  text = (text || el.input.value).trim();
  if (!text || busy) return;

  // "yes, carry on" is an answer to our own question, not a new command.
  if (handleResumeAnswer(text)) return;

  el.input.value = '';
  el.you.textContent = text;
  el.you.classList.remove('interim', 'passive');
  el.jarvis.textContent = '';
  el.readmore.hidden = true;
  el.hint.classList.add('gone');
  addMessage('you', text);
  busy = true;
  busySince = Date.now();
  setState('thinking');

  try {
    const d = await getJSON('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speak: speakEnabled, lang: currentLang() }),
    });

    busy = false;

    if (!d.ok) {
      setState('error');
      el.jarvis.textContent = d.reply || 'Something went wrong.';
      setTimeout(() => setState('idle'), 2200);
      return;
    }

    el.jarvis.textContent = d.reply;
    // Only offer "read it all" when there is actually more to read.
    el.readmore.hidden = d.reply.length < 160;
    addMessage('jarvis', d.reply,
      `${d.skill} · ${Math.round(d.confidence * 100)}% · ${d.latency_ms}ms`);
    toast(`${d.skill} · ${d.latency_ms}ms`);
    refreshHistory();

    if (speakEnabled) {
      say(d.reply, () => {
        // Now that this answer is done, offer the one that was cut off.
        if (offerResume()) return;
        setState('idle');
        // Re-arm only after speech ends, or JARVIS transcribes its own reply.
        if (continuous) setTimeout(listen, 350);
      });
    } else {
      setState('idle');
      if (continuous) setTimeout(listen, 250);
    }
  } catch (err) {
    busy = false;
    setState('error');
    el.jarvis.textContent = 'Could not reach JARVIS.';
    toast(err.message);
    setTimeout(() => setState('idle'), 2200);
  }
}

// ── WebSocket ──────────────────────────────────────────────────────────

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    el.pip.classList.add('on');
    el.conn.textContent = 'online';
    refreshHistory();
    refreshSystem();
    refreshBrain();
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    // The browser owns state while it is mid-turn; server pushes would
    // otherwise stomp the local listening/speaking transitions.
    if (m.type === 'state' && !busy && !recognizing && !speaking) {
      setState(m.state, m.detail);
    }
    // Incoming WhatsApp, pushed by the server's watcher. Not a "reply" —
    // nobody asked for it — so it gets its own type and its own handling.
    if (m.type === 'whatsapp' && m.text) {
      note(m.text);
      addMessage('jarvis', m.text);
      // Never talk over an answer in progress. An interruption that steps on
      // the thing you asked for is worse than arriving a few seconds late.
      if (!speaking && !recognizing && !busy) say(m.text);
    }
  };
  ws.onclose = () => {
    el.pip.classList.remove('on');
    el.conn.textContent = 'reconnecting';
    setTimeout(connect, 2500);
  };
  ws.onerror = () => ws.close();
}
const wsSend = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

// ── Data ───────────────────────────────────────────────────────────────

async function refreshHistory() {
  try {
    history = (await getJSON('/api/events?limit=50')).events;
  } catch { history = []; }

  el.transcript.innerHTML = history.length
    ? history.map((e) =>
        `<div class="turn"><div class="q">${esc(e.user)}</div>` +
        `<div class="a">${esc(e.reply)}</div>` +
        `<div class="m">${esc(e.skill)} · ${esc((e.at || '').slice(11, 16))}</div></div>`
      ).join('')
    : '<div class="empty">Nothing yet. Hold Space and say something.</div>';
}

async function refreshBrain() {
  try {
    const b = await getJSON('/api/brain');
    if (!b.ok) throw new Error(b.error);
    const row = (k, v, cls) =>
      `<div><span class="k">${esc(k)}</span><span class="v ${cls || ''}">${esc(v)}</span></div>`;
    const ready = b.pending >= b.min_new_to_train;
    el.brain.innerHTML =
      row('intent accuracy', (b.accuracy * 100).toFixed(1) + '%', 'good') +
      row('trained on', b.train_size + ' samples') +
      row('skills known', b.n_classes) +
      row('conversations', b.conversations_logged) +
      row('usable as labels', b.conversations_trainable) +
      row('pending', b.pending + ' / ' + b.min_new_to_train, ready ? 'good' : '') +
      row('cycles', `${b.cycles_run} (${b.promotions}↑ ${b.rejections}↩)`) +
      (b.last_cycle ? row('last', b.last_cycle.outcome,
          b.last_cycle.outcome === 'promoted' ? 'good' : '') : '');
  } catch (err) {
    el.brain.innerHTML = `<div><span class="k">brain</span><span class="v bad">${esc(err.message)}</span></div>`;
  }
}

async function refreshSystem() {
  try {
    const s = await getJSON('/api/status');
    const fb = s.llm.fallback || {};
    const row = (k, v, cls) =>
      `<div><span class="k">${esc(k)}</span><span class="v ${cls || ''}">${esc(v)}</span></div>`;

    // A present-but-rejected key is the failure mode that actually happens,
    // so it is surfaced here rather than buried in a log.
    el.sys.innerHTML =
      row('skills', s.skills) +
      row('memories', s.facts) +
      row('turns', s.events) +
      row('provider', s.llm.provider) +
      row('groq key', s.llm.has_key ? 'present' : 'missing',
          s.llm.has_key ? 'good' : 'bad') +
      row('fallback', fb.enabled ? 'armed' : 'off', fb.enabled ? 'good' : 'bad') +
      row('· freellmapi', fb.freellmapi ? 'ready' : 'not set') +
      row('· ollama', fb.ollama ? 'ready' : 'off');
  } catch { /* best effort */ }
}

// ── Drawers ────────────────────────────────────────────────────────────

const closeDrawers = () => {
  el.drawer.classList.remove('open');
  el.settings.classList.remove('open');
  el.chat.classList.remove('open');
};
const openDrawer = (d) => { closeDrawers(); d.classList.add('open'); };

// Two forms: the star, and the cortical brain. Same particle buffers, so
// the lerp in the render loop morphs one into the other.
let form = new URLSearchParams(location.search).get('form') === 'brain' ? 'brain' : 'star';
function toggleForm() {
  form = form === 'star' ? 'brain' : 'star';
  sun.setMode(form);
  $('#btn-form').textContent = form;
  toast(form === 'brain' ? 'Cortical form' : 'Stellar form');
}
$('#btn-form').addEventListener('click', toggleForm);

$('#btn-history').addEventListener('click', () => {
  refreshHistory(); openDrawer(el.drawer);
});
$('#btn-settings').addEventListener('click', () => {
  refreshSystem(); refreshBrain(); openDrawer(el.settings);
});

$('#btn-learn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'learning… (this takes a few minutes)';
  toast('Learning cycle started');
  try {
    const r = await getJSON('/api/brain/learn', { method: 'POST' });
    const out = r.ok ? (r.result.outcome || 'done') : ('failed: ' + r.error);
    toast('Learning cycle ' + out);
    refreshBrain();
  } catch (err) {
    toast('Learning failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'run a learning cycle';
  }
});
$('#drawer-close').addEventListener('click', closeDrawers);
$('#settings-close').addEventListener('click', closeDrawers);

$('#sim-toggle').addEventListener('click', () => {
  $('#grp-sim').classList.toggle('collapsed');
});

// ── Settings ───────────────────────────────────────────────────────────

el.optSpeak.addEventListener('change', () => {
  speakEnabled = el.optSpeak.checked;
  if (!speakEnabled) speechSynthesis.cancel();
  persist({ speak: speakEnabled });
});

function persist(patch) {
  const next = { ...readSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
}
el.optCont.addEventListener('change', () => {
  continuous = el.optCont.checked;
  persist({ continuous });
  toast(continuous ? 'Continuous listening on' : 'Continuous listening off');
  if (continuous && !recognizing && !busy && !speaking) listen();
});
el.optRate.addEventListener('input', () => {
  speakRate = parseFloat(el.optRate.value);
  el.rateVal.textContent = speakRate.toFixed(2);
  persist({ rate: speakRate });
});

// Star appearance — tucked away, since this is a voice tool first.
const SLIDERS = [
  { key: 'sunRadius',            label: 'Size',           min: 10, max: 80,  step: 1 },
  { key: 'fusionRate',           label: 'Fusion',         min: 0,  max: 10,  step: 0.1 },
  { key: 'convectionTurbulence', label: 'Turbulence',     min: 0,  max: 6,   step: 0.1 },
  { key: 'magneticActivity',     label: 'Magnetism',      min: 0,  max: 6,   step: 0.1 },
  { key: 'solarWindSpeed',       label: 'Solar wind',     min: 0,  max: 10,  step: 0.1 },
  { key: 'activeRegions',        label: 'Active regions', min: 4,  max: 100, step: 1 },
];
SLIDERS.forEach((s) => {
  const v = sun.params[s.key];
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  wrap.innerHTML =
    `<div class="top"><span>${s.label}</span><b data-v>${v}</b></div>` +
    `<input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}">`;
  el.sliders.appendChild(wrap);
  wrap.querySelector('input').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    wrap.querySelector('[data-v]').textContent = val;
    sun.setParam(s.key, val);
  });
});

// ── Input ──────────────────────────────────────────────────────────────

el.composer.addEventListener('submit', (e) => { e.preventDefault(); send(); });
el.orb.addEventListener('click', toggleMic);

// Push-to-talk. Hold Space to speak, release to send — but only when the
// user isn't typing, or the space bar would become unusable.
let spaceHeld = false;
document.addEventListener('keydown', (e) => {
  const typing = document.activeElement === el.input
              || document.activeElement === el.chatinput;

  if (e.code === 'Space' && !typing && !e.repeat) {
    e.preventDefault(); spaceHeld = true; clearTimeout(rearmTimer); listen();
  }
  if (e.key === 'Escape') {
    if (speaking) { onBargeIn(); return; }
    closeDrawers(); stopListening(); el.input.blur();
  }
  if (!typing) {
    if (e.key === 'b') toggleForm();
    if (e.key === 'c') { e.preventDefault(); openChat(); }
    if (e.key === 'h') { refreshHistory(); openDrawer(el.drawer); }
    if (e.key === ',') { e.preventDefault(); refreshSystem(); openDrawer(el.settings); }
    if (e.key === '/') { e.preventDefault(); el.input.focus(); }
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && spaceHeld) { spaceHeld = false; stopListening(); }
});

// Send the language along so the model replies in kind.

setInterval(refreshSystem, 20000);
connect();
setState('idle');

// Ambient by default: start listening as soon as the mic is permitted,
// without waiting for a keypress. The wake word is what gates *action*,
// not what gates listening.
startAmbient();

// Coming back from System Settings is the moment the grant usually changes.
window.addEventListener('focus', () => {
  if (!ambient) startAmbient();
});
