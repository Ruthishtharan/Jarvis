import React, { useEffect, useState } from 'react';
import ParticleRings from './ParticleRings';
import '../styles/CoreView.css';

/**
 * Full-window particle view. Nothing but the rings and one line of status.
 *
 * The dashboard's gauges and panels are still available behind a single
 * unobtrusive control — hiding them entirely would mean losing the logs and
 * settings, but they should not compete with the visualiser.
 */
export default function CoreView({ status, onExit }) {
  const [voice, setVoice] = useState({ state: 'offline' });
  const [level, setLevel] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(false);

  // Coarse pipeline state: changes a few times per utterance.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await window.electronAPI.getVoiceState();
        if (!cancelled && res) setVoice(res);
      } catch { /* keep last */ }
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Amplitude: polled far faster, because this is what drives the motion.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const v = await window.electronAPI.getAudioLevel();
        if (!cancelled && typeof v === 'number') setLevel(v);
      } catch { /* keep last */ }
    };
    const iv = setInterval(tick, 55);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const live = voice?.state;
  const visual =
    status !== 'running' ? 'offline'
    : live && live !== 'offline' ? live
    : 'idle';

  const CAPTION = {
    offline:   'offline',
    idle:      'listening for "jarvis"',
    listening: 'go ahead',
    thinking:  'thinking',
    speaking:  'speaking',
    error:     'fault',
  };

  const caption =
    (visual === 'thinking' || visual === 'speaking') && voice?.last_command
      ? `"${voice.last_command}"`
      : CAPTION[visual] || '';

  return (
    <div
      className={`coreview coreview-${visual}`}
      onMouseMove={() => setChromeVisible(true)}
      onMouseLeave={() => setChromeVisible(false)}
    >
      <ParticleRings state={visual} level={level} />

      <div className="coreview-caption">{caption}</div>

      <button
        className={`coreview-exit ${chromeVisible ? 'visible' : ''}`}
        onClick={onExit}
        title="Show the full dashboard"
      >
        ⌄ panels
      </button>
    </div>
  );
}
