/* JARVIS Brain — the control app.
 *
 * The companion to the JARVIS voice app. Where that one hides everything
 * behind the star, this exposes all of it: learning state, voice settings,
 * memory, skills, appearance, and diagnostics.
 *
 * Settings that affect the voice app are persisted to localStorage under a
 * shared key, so changing them here changes JARVIS's behaviour there.
 */

import { ParticleSun } from './particles.js';
import { LANGUAGES } from './languages.js';

const $ = (s) => document.querySelector(s);
const SETTINGS_KEY = 'jarvis.settings';

const sun = new ParticleSun($('#sun'), { count: 20000, mode: 'brain' });
sun.start();

// ── Shared settings ────────────────────────────────────────────────────

const defaults = {
  speak: true, continuous: true, rate: 1.05, voice: null,
  lang: 'auto', anyLanguage: true, wakeRequired: true, clapWake: true,
  v: 2,
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

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const merged = migrate({ ...defaults, ...stored });
    if ((stored.v || 1) < SETTINGS_VERSION) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    }
    return merged;
  } catch { return { ...defaults }; }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  // Same-tab writes don't fire `storage`, so tell any listener explicitly.
  window.dispatchEvent(new CustomEvent('jarvis-settings', { detail: next }));
  return next;
}

let settings = loadSettings();

// ── Helpers ────────────────────────────────────────────────────────────

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
}

const esc = (s) => {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
};

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
  return res.json();
}

const stat = (k, v, cls) =>
  `<div><span class="k">${esc(k)}</span><span class="v ${cls || ''}">${esc(v)}</span></div>`;

// ── Tabs ───────────────────────────────────────────────────────────────

document.querySelectorAll('.btab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.btab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.bpane').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.tab;
    document.querySelector(`.bpane[data-pane="${name}"]`).classList.add('active');
    if (name === 'mind') refreshBrain();
    if (name === 'memory') { refreshFacts(); refreshTurns(); }
    if (name === 'skills') refreshSkills();
    if (name === 'system') refreshSystem();
    if (name === 'voice') refreshSystem();
  });
});

// ── Mind ───────────────────────────────────────────────────────────────

async function refreshBrain() {
  try {
    const b = await getJSON('/api/brain');
    if (!b.ok) throw new Error(b.error);

    const ready = b.pending >= b.min_new_to_train;
    $('#brain-stats').innerHTML =
      stat('intent accuracy', (b.accuracy * 100).toFixed(1) + '%', 'good') +
      stat('trained on', b.train_size + ' samples') +
      stat('skills known', b.n_classes) +
      stat('last trained', (b.trained_at || '').slice(0, 16)) +
      stat('conversations logged', b.conversations_logged) +
      stat('usable as labels', b.conversations_trainable) +
      stat('pending', `${b.pending} / ${b.min_new_to_train}`, ready ? 'good' : 'warn') +
      stat('cycles run', b.cycles_run) +
      stat('promoted', b.promotions, b.promotions ? 'good' : '') +
      stat('rejected', b.rejections, b.rejections ? 'warn' : '');

    const cycles = (b.all_cycles || (b.last_cycle ? [b.last_cycle] : []));
    $('#cycles').innerHTML = cycles.length
      ? cycles.slice().reverse().map((c) => {
          const cls = c.outcome === 'promoted' ? 'ok'
                    : c.outcome === 'rejected' ? 'no' : '';
          return `<div class="item"><div class="row2">` +
            `<span class="tag ${cls}">${esc(c.outcome)}</span>` +
            `<div class="grow"><div class="s">${esc(c.detail || '')}</div>` +
            `<div class="m">${esc((c.at || '').replace('T', ' ').slice(0, 16))}` +
            (c.seconds ? ` · ${c.seconds}s` : '') + `</div></div></div></div>`;
        }).join('')
      : '<div class="item"><div class="s">No cycles run yet.</div></div>';
  } catch (err) {
    $('#brain-stats').innerHTML = stat('brain', err.message, 'bad');
  }
}

$('#btn-refresh').addEventListener('click', () => { refreshBrain(); toast('Refreshed'); });

$('#btn-learn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Learning… (minutes, not seconds)';
  toast('Learning cycle started');
  try {
    const r = await getJSON('/api/brain/learn', { method: 'POST' });
    if (!r.ok) throw new Error(r.error);
    const o = r.result.outcome;
    toast(o === 'promoted' ? `Promoted — ${r.result.detail}`
        : o === 'rejected' ? `Rejected, kept the better model (${r.result.detail})`
        : `Cycle ${o}: ${r.result.detail || ''}`);
    refreshBrain();
  } catch (err) {
    toast('Learning failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run a learning cycle';
  }
});

// ── Voice ──────────────────────────────────────────────────────────────

function initVoiceControls() {
  const sel = $('#opt-lang');
  sel.innerHTML =
    '<option value="auto">Auto-detect — follow whatever I speak</option>' +
    LANGUAGES.map((l) =>
      `<option value="${l.code}">${esc(l.native)} — ${esc(l.name)}</option>`).join('');
  sel.value = settings.lang;
  sel.addEventListener('change', () => {
    settings = saveSettings({ lang: sel.value });
    if (sel.value === 'auto') {
      toast('JARVIS will follow whatever language you speak');
      return;
    }
    const l = LANGUAGES.find((x) => x.code === sel.value);
    toast(`JARVIS now replies in ${l ? l.native : sel.value}`);
  });

  $('#opt-anylang').checked = settings.anyLanguage;
  $('#opt-anylang').addEventListener('change', (e) => {
    settings = saveSettings({ anyLanguage: e.target.checked });
  });
  $('#opt-wake').checked = settings.wakeRequired;
  $('#opt-wake').addEventListener('change', (e) => {
    settings = saveSettings({ wakeRequired: e.target.checked });
    toast(e.target.checked
      ? 'JARVIS will only act when you say his name'
      : '⚠ JARVIS will act on everything it hears');
  });
  $('#opt-clap').checked = settings.clapWake;
  $('#opt-clap').addEventListener('change', (e) => {
    settings = saveSettings({ clapWake: e.target.checked });
  });

  $('#opt-speak').checked = settings.speak;
  $('#opt-continuous').checked = settings.continuous;
  $('#opt-rate').value = settings.rate;
  $('#rate-val').textContent = Number(settings.rate).toFixed(2);

  $('#opt-speak').addEventListener('change', (e) => {
    settings = saveSettings({ speak: e.target.checked });
    toast(e.target.checked ? 'JARVIS will speak replies' : 'Replies muted');
  });
  $('#opt-continuous').addEventListener('change', (e) => {
    settings = saveSettings({ continuous: e.target.checked });
    toast(e.target.checked ? 'Continuous listening on'
                           : 'Push-to-talk only — hold Space in the JARVIS app');
  });
  $('#opt-rate').addEventListener('input', (e) => {
    $('#rate-val').textContent = Number(e.target.value).toFixed(2);
    settings = saveSettings({ rate: parseFloat(e.target.value) });
  });
}

function loadVoices() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  if (!voices.length) return;
  const sel = $('#opt-voice');
  sel.innerHTML = voices.map((v) =>
    `<option value="${esc(v.name)}">${esc(v.name)} — ${esc(v.lang)}</option>`).join('');
  if (settings.voice && voices.some((v) => v.name === settings.voice)) {
    sel.value = settings.voice;
  } else {
    const nice = voices.find((v) => /samantha|serena|daniel|karen|natural/i.test(v.name));
    sel.value = (nice || voices[0]).name;
    settings = saveSettings({ voice: sel.value });
  }
  sel.onchange = () => { settings = saveSettings({ voice: sel.value }); };
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

$('#btn-test-voice').addEventListener('click', () => {
  const u = new SpeechSynthesisUtterance(
    "All systems nominal. I'm listening whenever you are.");
  u.rate = settings.rate;
  const v = speechSynthesis.getVoices().find((x) => x.name === settings.voice);
  if (v) u.voice = v;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
});

// ── Memory ─────────────────────────────────────────────────────────────

let allTurns = [];

async function refreshFacts() {
  try {
    const d = await getJSON('/api/facts?limit=200');
    $('#facts').innerHTML = d.facts.length
      ? d.facts.map((f) =>
          `<div class="item"><div class="row2"><div class="grow">` +
          `<div class="t">${esc(f.text)}</div>` +
          `<div class="m">${esc(f.tags || 'no tags')} · ${esc((f.at || '').slice(0, 16))}</div>` +
          `</div><button class="x" data-del="${f.id}">forget</button></div></div>`).join('')
      : '<div class="item"><div class="s">Nothing remembered yet.</div></div>';
  } catch (err) {
    $('#facts').innerHTML = `<div class="item"><div class="s">${esc(err.message)}</div></div>`;
  }
}

$('#facts').addEventListener('click', async (e) => {
  const id = e.target?.dataset?.del;
  if (!id) return;
  try {
    await fetch('/api/facts/' + id, { method: 'DELETE' });
    refreshFacts(); toast('Forgotten');
  } catch { toast('Could not forget that'); }
});

$('#fact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#fact-input').value.trim();
  if (!text) return;
  try {
    await getJSON('/api/facts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, tags: [] }),
    });
    $('#fact-input').value = '';
    refreshFacts(); toast('Stored');
  } catch (err) { toast('Could not store: ' + err.message); }
});

async function refreshTurns() {
  try {
    allTurns = (await getJSON('/api/events?limit=200')).events;
  } catch { allTurns = []; }
  renderTurns();
}

function renderTurns() {
  const q = $('#search').value.trim().toLowerCase();
  const rows = allTurns.filter((e) =>
    !q || (e.user + ' ' + e.reply).toLowerCase().includes(q));
  $('#turns').innerHTML = rows.length
    ? rows.map((e) =>
        `<div class="item"><div class="t">${esc(e.user)}</div>` +
        `<div class="s">${esc(e.reply)}</div>` +
        `<div class="m">${esc(e.skill)} · ${esc(e.source || '—')} · ` +
        `${(e.confidence * 100).toFixed(0)}% · ${esc((e.at || '').slice(0, 16))}</div></div>`).join('')
    : '<div class="item"><div class="s">No matches.</div></div>';
}
$('#search').addEventListener('input', renderTurns);

// ── Skills ─────────────────────────────────────────────────────────────

async function refreshSkills() {
  try {
    const d = await getJSON('/api/skills');
    $('#skill-count').textContent = d.skills.length;
    $('#skills').innerHTML = d.skills.map((s) =>
      `<div class="item"><div class="t">${esc(s.name)}</div>` +
      `<div class="s">${esc(s.description)}</div></div>`).join('');
  } catch (err) {
    $('#skills').innerHTML = `<div class="item"><div class="s">${esc(err.message)}</div></div>`;
  }
}

// ── Appearance ─────────────────────────────────────────────────────────

const STAR_SLIDERS = [
  { key: 'sunRadius', label: 'Size', min: 10, max: 80, step: 1 },
  { key: 'fusionRate', label: 'Fusion rate', min: 0, max: 10, step: 0.1 },
  { key: 'convectionTurbulence', label: 'Convection', min: 0, max: 6, step: 0.1 },
  { key: 'magneticActivity', label: 'Magnetism', min: 0, max: 6, step: 0.1 },
  { key: 'solarWindSpeed', label: 'Solar wind', min: 0, max: 10, step: 0.1 },
  { key: 'activeRegions', label: 'Active regions', min: 4, max: 100, step: 1 },
];
const BRAIN_SLIDERS = [
  { key: 'expansion', label: 'Size', min: 20, max: 90, step: 1 },
  { key: 'foldIntensity', label: 'Cortical folding', min: 0, max: 1, step: 0.02 },
  { key: 'plasticity', label: 'Neuroplasticity', min: 0, max: 1, step: 0.02 },
  { key: 'consciousnessFlow', label: 'Consciousness flow', min: 0, max: 4, step: 0.05 },
  { key: 'chaos', label: 'Subconscious chaos', min: 0, max: 3, step: 0.05 },
  { key: 'fireRate', label: 'Synaptic firing', min: 0.5, max: 6, step: 0.1 },
  { key: 'rotationSpeed', label: 'Rotation', min: 0, max: 1, step: 0.01 },
  { key: 'mood', label: 'Neurochemical mood', min: -1, max: 1, step: 0.05 },
];

function buildSliders(host, defs, get, set) {
  host.innerHTML = '';
  defs.forEach((s) => {
    const v = get(s.key);
    const wrap = document.createElement('div');
    wrap.className = 'slider';
    wrap.innerHTML =
      `<div class="top"><span>${s.label}</span><b data-v>${v}</b></div>` +
      `<input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}">`;
    host.appendChild(wrap);
    wrap.querySelector('input').addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      wrap.querySelector('[data-v]').textContent = val;
      set(s.key, val);
    });
  });
}

buildSliders($('#sliders-star'), STAR_SLIDERS,
  (k) => sun.params[k], (k, v) => sun.setParam(k, v));
buildSliders($('#sliders-brain'), BRAIN_SLIDERS,
  (k) => sun.brainParams[k], (k, v) => sun.setBrainParam(k, v));

$('#btn-form-star').addEventListener('click', () => {
  sun.setMode('star');
  $('#btn-form-star').classList.add('primary');
  $('#btn-form-brain').classList.remove('primary');
});
$('#btn-form-brain').addEventListener('click', () => {
  sun.setMode('brain');
  $('#btn-form-brain').classList.add('primary');
  $('#btn-form-star').classList.remove('primary');
});

// ── System ─────────────────────────────────────────────────────────────

async function refreshSystem() {
  try {
    const s = await getJSON('/api/status');
    const fb = s.llm.fallback || {};

    $('#sys').innerHTML =
      stat('skills', s.skills, 'good') +
      stat('facts', s.facts) +
      stat('conversations', s.events) +
      stat('connected apps', s.clients) +
      stat('state', s.state);

    $('#voice-stats').innerHTML =
      stat('desktop TTS', s.voice.tts_engine) +
      stat('desktop STT', s.voice.stt_engine) +
      stat('browser speech', 'speechSynthesis' in window ? 'available' : 'missing',
           'speechSynthesis' in window ? 'good' : 'bad') +
      stat('browser mic', (window.SpeechRecognition || window.webkitSpeechRecognition)
           ? 'available' : 'missing',
           (window.SpeechRecognition || window.webkitSpeechRecognition) ? 'good' : 'bad');

    $('#llm').innerHTML =
      stat('provider', s.llm.provider) +
      stat('model', s.llm.chat_model) +
      stat('api key', s.llm.has_key ? 'present' : 'missing',
           s.llm.has_key ? 'good' : 'bad') +
      stat('fallback chain', fb.enabled ? 'armed' : 'off', fb.enabled ? 'good' : 'bad') +
      stat('· freellmapi', fb.freellmapi ? 'ready' : 'not configured') +
      stat('· ollama', fb.ollama ? 'ready' : 'off');

    // A present-but-rejected key is the failure that actually happens, and it
    // looks identical to "working" unless you say so.
    $('#llm-note').innerHTML = s.llm.has_key
      ? 'A key being <b>present</b> is not the same as it working. If replies say '
        + '"having trouble reaching Groq", it is being rejected — rotate it with '
        + '<b>python3 set_groq_key.py</b>.'
      : 'No key set. Run <b>python3 set_groq_key.py</b> to add one.';
  } catch (err) {
    $('#sys').innerHTML = stat('status', err.message, 'bad');
  }
}

$('#btn-ping').addEventListener('click', async () => {
  const out = $('#diag');
  out.textContent = 'Sending "what time is it"…';
  try {
    const t0 = performance.now();
    const d = await getJSON('/api/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'what time is it', speak: false }),
    });
    const rt = Math.round(performance.now() - t0);
    out.textContent =
      `reply       ${d.reply}\nskill       ${d.skill}\n` +
      `confidence  ${(d.confidence * 100).toFixed(0)}%\n` +
      `used llm    ${d.used_llm}\nserver      ${d.latency_ms}ms\nround trip  ${rt}ms`;
  } catch (err) { out.textContent = 'Failed: ' + err.message; }
});

$('#btn-export').addEventListener('click', async () => {
  try {
    const [status, brain, ev, fa] = await Promise.all([
      getJSON('/api/status'), getJSON('/api/brain'),
      getJSON('/api/events?limit=500'), getJSON('/api/facts?limit=500'),
    ]);
    const blob = new Blob([JSON.stringify(
      { exported: new Date().toISOString(), status, brain,
        events: ev.events, facts: fa.facts }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jarvis-brain-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Exported');
  } catch (err) { toast('Export failed: ' + err.message); }
});

// ── Connection ─────────────────────────────────────────────────────────

let ws = null;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    $('#pip').classList.add('on');
    $('#conn').textContent = 'connected';
    refreshBrain(); refreshSystem();
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    // Mirror what the JARVIS app is doing, so the brain reacts in sympathy.
    if (m.type === 'state') sun.setState(m.state);
    if (m.type === 'learning' && m.phase === 'done') refreshBrain();
  };
  ws.onclose = () => {
    $('#pip').classList.remove('on');
    $('#conn').textContent = 'reconnecting';
    setTimeout(connect, 2500);
  };
  ws.onerror = () => ws.close();
}

initVoiceControls();
connect();
setInterval(() => {
  if (document.querySelector('.bpane[data-pane="mind"]').classList.contains('active')) {
    refreshBrain();
  }
}, 20000);
