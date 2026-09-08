import React, { useState, useEffect } from 'react';
import ParticleRings from './ParticleRings';
import { HUDPanel, CircularGauge, DataRow, HUDButton } from './HUD';
import '../styles/Dashboard.css';

const SYSTEMS = [
  { k: 'Voice Interface', v: 'ONLINE',  a: 'green' },
  { k: 'Speech Engine',   v: 'GOOGLE / WHISPER' },
  { k: 'Reasoning Core',  v: 'LLAMA 3.3 70B' },
  { k: 'Web Uplink',      v: 'DUCKDUCKGO' },
  { k: 'Code Module',     v: 'ALL LANGUAGES' },
  { k: 'Wake Protocol',   v: 'VOICE + CLAP' },
];

function Dashboard({ status }) {
  const [metrics, setMetrics] = useState({
    avgLatency: 0,
    commandsProcessed: 0,
    uptime: 0,
  });

  const [voice, setVoice] = useState({ state: 'offline' });
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await window.electronAPI.getMetrics();
        if (res?.metrics) setMetrics(res.metrics);
      } catch (e) {
        /* silent — reactor stays at zero */
      }
    };
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, []);

  // Live voice state drives the reactor. Polled fast (250ms) because
  // "listening" can last well under a second and the whole point is that
  // the reactor reacts while you are still speaking.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await window.electronAPI.getVoiceState();
        if (!cancelled && res) setVoice(res);
      } catch {
        /* leave the last known state */
      }
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  // Amplitude is polled far faster than state. The publisher updates roughly
  // every 90ms (one PCM chunk); 60ms here means we rarely miss a change, and
  // the visualiser interpolates between samples so it still looks continuous.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const v = await window.electronAPI.getAudioLevel();
        if (!cancelled && typeof v === 'number') setLevel(v);
      } catch {
        /* keep the last value */
      }
    };
    const iv = setInterval(tick, 60);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  // Reactor state comes from the live voice pipeline when the assistant is
  // up; the coarse process status is only a fallback for when it isn't.
  const live = voice?.state;
  const reactorState =
    status !== 'running' ? 'offline'
    : live && live !== 'offline' ? live
    : 'idle';

  const LABELS = {
    offline:   ['Reactor Offline',  'Press initialize to spin up'],
    idle:      ['Systems Nominal',  'Awaiting wake word'],
    listening: ['Listening',        'Go ahead, I am here'],
    thinking:  ['Processing',       'Working on it'],
    speaking:  ['Responding',       'Speaking now'],
    error:     ['System Fault',     'Check diagnostics module'],
  };
  const [statusLabel, defaultSub] = LABELS[reactorState] || LABELS.idle;

  // While thinking or speaking, show what was actually said — far more
  // useful than a generic caption.
  const statusSub =
    (reactorState === 'thinking' || reactorState === 'speaking') && voice?.last_command
      ? `"${voice.last_command}"`
      : defaultSub;

  const latency = Math.round(metrics.avgLatency || 0);
  // 2000ms is our ceiling — the arc fills as we approach it
  const latencyPct = Math.min(latency / 2000, 1);
  const latencyAccent = latency > 1500 ? 'red' : latency > 800 ? 'amber' : 'cyan';

  const uptimeMin = Math.floor((metrics.uptime || 0) / 60);

  return (
    <div className="dash">
      {/* ══ REACTOR ROW ══ */}
      <div className="dash-reactor-row">
        {/* Left gauges */}
        <div className="dash-gauges left">
          <CircularGauge
            value={latency}
            unit="ms"
            label="Response"
            pct={latencyPct}
            accent={latencyAccent}
          />
          <CircularGauge
            value={metrics.commandsProcessed || 0}
            label="Commands"
            pct={Math.min((metrics.commandsProcessed || 0) / 100, 1)}
            accent="cyan"
          />
        </div>

        {/* The core */}
        <div className="dash-core">
          <ParticleRings state={reactorState} level={level} />
          <div className="dash-core-readout">
            <div className="dash-core-label glow-hard">{statusLabel}</div>
            <div className="dash-core-sub">{statusSub}</div>
          </div>
        </div>

        {/* Right gauges */}
        <div className="dash-gauges right">
          <CircularGauge
            value={uptimeMin}
            unit="m"
            label="Uptime"
            pct={Math.min(uptimeMin / 60, 1)}
            accent="green"
          />
          <CircularGauge
            value={status === 'running' ? 100 : 0}
            unit="%"
            label="Integrity"
            pct={status === 'running' ? 1 : 0}
            accent={status === 'error' ? 'red' : 'green'}
          />
        </div>
      </div>

      {/* ══ LOWER GRID ══ */}
      <div className="dash-grid">
        <HUDPanel title="System Array" right="6 MODULES">
          <div className="sys-list">
            {SYSTEMS.map((s) => (
              <DataRow key={s.k} k={s.k} v={s.v} accent={s.a} />
            ))}
          </div>
        </HUDPanel>

        <HUDPanel title="Command Deck" right="MANUAL OVERRIDE">
          <div className="deck">
            <HUDButton>Test Voice</HUDButton>
            <HUDButton>Open Logs</HUDButton>
            <HUDButton>Restart Core</HUDButton>
            <HUDButton>Record Demo</HUDButton>
          </div>
          <div className="deck-note">
            <span className="hud-label">Wake Phrase</span>
            <span className="deck-wake glow">"JARVIS"</span>
          </div>
        </HUDPanel>

        <HUDPanel title="Power Distribution" right="LIVE">
          <div className="bars">
            {[
              { n: 'Audio Capture', p: status === 'running' ? 82 : 0 },
              { n: 'Transcription', p: status === 'running' ? 64 : 0 },
              { n: 'Inference',     p: status === 'running' ? 71 : 0 },
              { n: 'Synthesis',     p: status === 'running' ? 45 : 0 },
            ].map((b) => (
              <div className="bar-row" key={b.n}>
                <span className="bar-name">{b.n}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${b.p}%` }} />
                </div>
                <span className="bar-pct">{b.p}%</span>
              </div>
            ))}
          </div>
        </HUDPanel>
      </div>
    </div>
  );
}

export default Dashboard;
