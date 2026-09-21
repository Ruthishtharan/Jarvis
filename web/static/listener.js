/* Ambient listener — continuous capture with voice-activity detection.
 *
 * Replaces `webkitSpeechRecognition`, which cannot work in Electron: it is a
 * thin client for Google's speech service and authenticates with a key
 * compiled into official Chrome builds. Electron has no such key, so every
 * request fails with `network` before it leaves the machine.
 *
 * How this works instead:
 *
 *   - One MediaRecorder runs continuously.
 *   - An AnalyserNode watches RMS in parallel to decide when you are talking.
 *   - When you stop, the recorder is stopped — which flushes a *complete,
 *     valid* WebM file — the clip is posted to /api/transcribe, and a new
 *     recorder starts immediately.
 *
 * That stop/restart is deliberate. WebM chunks are not independently
 * decodable: only the first carries the header, so slicing a live stream
 * yields files no decoder will open. Stopping is the only way to get a
 * playable container, and the restart gap is a couple of milliseconds.
 *
 * Hysteresis matters. A single threshold makes the recorder chatter on and
 * off during normal speech pauses, so speech must exceed START_RMS to open
 * and fall below STOP_RMS for SILENCE_MS to close.
 */

const START_RMS   = 0.030;   // open above this
const STOP_RMS    = 0.018;   // close below this — lower, so pauses don't cut
const SILENCE_MS  = 850;     // quiet for this long ends the utterance
const MAX_SEG_MS  = 14000;   // hard cap so one monologue isn't one huge blob
const MIN_SEG_MS  = 320;     // shorter than this is a cough, not a sentence

// Interruption while JARVIS is talking.
//
// A fixed threshold cannot work here. 0.085 was picked to sit above JARVIS's
// own voice leaking back through the mic, but that is above normal speech —
// you had to shout to be heard. Meanwhile the right level depends on speaker
// volume, mic gain, and whether headphones are in, none of which are known
// in advance.
//
// So measure it. While JARVIS talks, whatever the mic hears IS its own voice;
// that becomes the floor, and a real interruption has to clearly exceed it.
const BARGE_FACTOR = 2.0;    // must be this much louder than JARVIS's leak
const BARGE_FLOOR  = 0.030;  // ...and at least this loud, for silent rooms
const BARGE_MS     = 260;    // sustained, not one loud syllable

export class AmbientListener {
  /**
   * @param {(text:string, meta:object)=>void} onText  final transcript
   * @param {(rms:number, freq:Uint8Array)=>void} onLevel  per-frame audio
   */
  constructor({ onText, onLevel, onState, getLang, onBargeIn }) {
    this.onText = onText || (() => {});
    this.onLevel = onLevel || (() => {});
    this.onState = onState || (() => {});
    this.getLang = getLang || (() => 'en-US');
    this.onBargeIn = onBargeIn || (() => {});

    this.running = false;
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.recorder = null;
    this.chunks = [];
    this.speaking = false;
    this.segHadSpeech = false;
    this.segStart = 0;
    this.silenceSince = 0;
    this.raf = null;
    this.muted = false;
    this.paused = false;      // set while JARVIS talks
    this.bargeSince = 0;
    this.leakLevel = 0;
    this.leakSamples = 0;
  }

  async start() {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);

    this.time = new Uint8Array(this.analyser.frequencyBinCount);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);

    this.running = true;
    this._startSegment();
    this._loop();
    this.onState('listening');
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this._stopRecorder(false);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.onState('idle');
  }

  setMuted(v) {
    this.muted = !!v;
    if (this.stream) this.stream.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
    this.onState(this.muted ? 'muted' : 'listening');
  }

  /**
   * Called while JARVIS is speaking.
   *
   * This used to hard-pause capture so JARVIS could not transcribe its own
   * voice — but that also made it deaf, so interrupting it was impossible.
   *
   * Instead it stays listening at a much higher threshold. JARVIS's own voice
   * arrives attenuated (echo cancellation is on, and the mic is further from
   * the speakers than your mouth is from the mic), so a real interruption
   * clears BARGE_RMS and its own playback does not. Sustained speech is
   * required too — a single loud syllable from the speakers should not count.
   */
  setPaused(v) {
    this.paused = !!v;
    this.speaking = false;
    this.segHadSpeech = false;      // discard whatever is buffered
    this.bargeSince = 0;
    // Re-measure every time: volume and headphone state can change between
    // one reply and the next.
    this.leakLevel = 0;
    this.leakSamples = 0;
  }

  // ── internals ────────────────────────────────────────────────────────

  _pickMime() {
    // Safari and Chromium disagree; ask for what is actually supported.
    const options = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    return options.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  }

  _startSegment() {
    if (!this.running || !this.stream) return;
    const mime = this._pickMime();
    try {
      this.recorder = mime
        ? new MediaRecorder(this.stream, { mimeType: mime })
        : new MediaRecorder(this.stream);
    } catch {
      this.recorder = new MediaRecorder(this.stream);
    }

    this.chunks = [];
    this.segHadSpeech = false;
    this.segStart = performance.now();

    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => {
      const send = this._pendingSend;
      this._pendingSend = false;
      const blob = new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' });
      this.chunks = [];
      if (send && blob.size > 1200) this._transcribe(blob);
      if (this.running) this._startSegment();
    };

    // A timeslice keeps data flowing so a crash never loses the whole clip.
    this.recorder.start(250);
  }

  _stopRecorder(send) {
    this._pendingSend = !!send;
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch { /* already stopping */ }
    }
  }

  _loop() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(() => this._loop());
    if (!this.analyser) return;

    this.analyser.getByteTimeDomainData(this.time);
    this.analyser.getByteFrequencyData(this.freq);

    let sum = 0;
    for (let i = 0; i < this.time.length; i++) {
      const v = (this.time[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.time.length);
    this.onLevel(rms, this.freq);

    const now = performance.now();

    if (this.muted) return;

    // While JARVIS speaks, listen only for a deliberate interruption.
    if (this.paused) {
      // Learn how loud JARVIS's own voice arrives. Track a running maximum
      // rather than a mean: the mean sits in the gaps between words and would
      // set the bar far too low.
      if (this.leakSamples < 240) {
        this.leakSamples++;
        this.leakLevel = Math.max(this.leakLevel * 0.995, rms);
      } else {
        this.leakLevel = Math.max(this.leakLevel * 0.999, rms * 0.6);
      }

      const bar = Math.max(this.leakLevel * BARGE_FACTOR, BARGE_FLOOR);

      if (rms > bar) {
        if (!this.bargeSince) this.bargeSince = now;
        else if (now - this.bargeSince > BARGE_MS) {
          this.bargeSince = 0;
          this.onBargeIn();       // caller stops the reply and un-pauses us
        }
      } else {
        this.bargeSince = 0;
      }
      return;
    }

    if (!this.speaking) {
      if (rms > START_RMS) {
        this.speaking = true;
        this.segHadSpeech = true;
        this.silenceSince = 0;
        this.onState('hearing');
      }
    } else if (rms < STOP_RMS) {
      if (!this.silenceSince) this.silenceSince = now;
      else if (now - this.silenceSince > SILENCE_MS) {
        this.speaking = false;
        this.silenceSince = 0;
        const dur = now - this.segStart;
        this._stopRecorder(this.segHadSpeech && dur > MIN_SEG_MS);
        this.onState('listening');
      }
    } else {
      this.silenceSince = 0;
    }

    // Cap runaway segments — someone reading aloud shouldn't build a 5MB blob.
    if (this.segHadSpeech && now - this.segStart > MAX_SEG_MS) {
      this.speaking = false;
      this.silenceSince = 0;
      this._stopRecorder(true);
    }
  }

  async _transcribe(blob) {
    const form = new FormData();
    const ext = (blob.type || '').includes('mp4') ? 'mp4' : 'webm';
    form.append('audio', blob, `clip.${ext}`);
    // 'auto' lets Whisper detect. Pinning a language forces it to decode
    // everything as that language, so Tamil spoken to an English-pinned
    // decoder comes back as phonetic nonsense.
    form.append('lang', this.getLang());

    this.onState('thinking');
    try {
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      const data = await res.json();
      if (data.ok && data.text) {
        this.onText(data.text, {
          engine: data.engine,
          bytes: blob.size,
          language: data.language || '',   // e.g. "Tamil"
          tag: data.tag || '',             // e.g. "ta-IN"
        });
      } else if (data.error) {
        console.warn('transcribe:', data.error);
      }
    } catch (err) {
      console.warn('transcribe failed:', err.message);
    } finally {
      if (this.running) this.onState(this.muted ? 'muted' : 'listening');
    }
  }
}
