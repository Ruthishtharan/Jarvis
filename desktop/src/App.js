import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import Dashboard from './components/Dashboard';
import Settings from './components/Settings';
import CommandHistory from './components/CommandHistory';
import Logs from './components/Logs';
import CoreView from './components/CoreView';
import { StatusPip, HUDButton } from './components/HUD';

const TABS = [
  { id: 'dashboard', label: 'Core',      idx: '01' },
  { id: 'history',   label: 'Comms Log', idx: '02' },
  { id: 'logs',      label: 'Diagnostics', idx: '03' },
  { id: 'settings',  label: 'Config',    idx: '04' },
];

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  // The visualiser is the default view. Everything else is one click away
  // but should not compete with it for attention.
  const [coreOnly, setCoreOnly] = useState(true);
  const [jarvisStatus, setJarvisStatus] = useState('unknown');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(new Date());

  const checkStatus = useCallback(async () => {
    try {
      const res = await window.electronAPI.getJarvisStatus();
      setJarvisStatus(res?.status || 'unknown');
    } catch {
      setJarvisStatus('error');
    }
  }, []);

  useEffect(() => {
    checkStatus();
    const poll = setInterval(checkStatus, 3000);
    const tick = setInterval(() => setClock(new Date()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [checkStatus]);

  const handleToggle = async () => {
    setBusy(true);
    try {
      if (jarvisStatus === 'running') {
        await window.electronAPI.stopJarvis();
      } else {
        await window.electronAPI.startJarvis();
      }
    } catch (e) {
      console.error(e);
    }
    setTimeout(async () => {
      await checkStatus();
      setBusy(false);
    }, 1500);
  };

  const online = jarvisStatus === 'running';

  if (coreOnly) {
    return (
      <>
        <CoreView status={jarvisStatus} onExit={() => setCoreOnly(false)} />
        <button
          className="coreview-power"
          onClick={handleToggle}
          disabled={busy}
          title={online ? 'Shut down Jarvis' : 'Start Jarvis'}
        >
          {busy ? '····' : online ? '◼' : '▶'}
        </button>
      </>
    );
  }

  return (
    <div className="hud-root">
      {/* ── Ambient layers ── */}
      <div className="hud-bg">
        <div className="hud-bg-glow" />
        <div className="hud-bg-grid" />
        <div className="hud-bg-sweep" />
        <div className="hud-bg-scan" />
      </div>

      {/* ── Viewport corner brackets ── */}
      <span className="vp-bracket vp-tl" />
      <span className="vp-bracket vp-tr" />
      <span className="vp-bracket vp-bl" />
      <span className="vp-bracket vp-br" />

      <div className="hud-shell">
        {/* ══ TOP BAR ══ */}
        <header className="hud-top">
          <div className="brand">
            <div className="brand-mark">
              <svg viewBox="0 0 34 34">
                <circle cx="17" cy="17" r="15" fill="none" stroke="currentColor"
                        strokeWidth="1" opacity="0.4" strokeDasharray="4 3" />
                <circle cx="17" cy="17" r="9" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="17" cy="17" r="3.5" fill="currentColor" />
              </svg>
            </div>
            <div className="brand-text">
              <h1>J.A.R.V.I.S.</h1>
              <p>Just A Rather Very Intelligent System</p>
            </div>
          </div>

          <div className="top-telemetry">
            <div className="tel-block">
              <span className="hud-label">Local Time</span>
              <span className="tel-val">{clock.toLocaleTimeString('en-GB')}</span>
            </div>
            <span className="tel-div" />
            <div className="tel-block">
              <span className="hud-label">Date</span>
              <span className="tel-val">
                {clock.toLocaleDateString('en-GB').replace(/\//g, '.')}
              </span>
            </div>
            <span className="tel-div" />
            <div className="tel-block">
              <span className="hud-label">Link</span>
              <span className="tel-val">{online ? 'SECURE' : 'DORMANT'}</span>
            </div>
          </div>

          <div className="top-controls">
            <StatusPip state={jarvisStatus}>
              {online ? 'Online' : jarvisStatus === 'error' ? 'Fault' : 'Offline'}
            </StatusPip>
            <HUDButton
              variant={online ? 'danger' : 'go'}
              onClick={handleToggle}
              disabled={busy}
            >
              {busy ? '····' : online ? 'Shut Down' : 'Initialize'}
            </HUDButton>
          </div>
        </header>

        <div className="hud-body">
          {/* ══ LEFT RAIL ══ */}
          <nav className="hud-rail">
            <button
              className="rail-item rail-visualiser"
              onClick={() => setCoreOnly(true)}
            >
              <span className="rail-idx">◉</span>
              <span className="rail-label">Visualiser</span>
            </button>

            {TABS.map((t) => (
              <button
                key={t.id}
                className={`rail-item ${activeTab === t.id ? 'active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                <span className="rail-idx">{t.idx}</span>
                <span className="rail-label">{t.label}</span>
                <span className="rail-marker" />
              </button>
            ))}

            <div className="rail-footer">
              <div className="rail-spine" />
              <span className="hud-label">v1.0</span>
            </div>
          </nav>

          {/* ══ CONTENT ══ */}
          <main className="hud-main">
            {activeTab === 'dashboard' && <Dashboard status={jarvisStatus} />}
            {activeTab === 'history'   && <CommandHistory />}
            {activeTab === 'logs'      && <Logs />}
            {activeTab === 'settings'  && <Settings />}
          </main>
        </div>

        {/* ══ BOTTOM STRIP ══ */}
        <footer className="hud-bottom">
          <span>STARK INDUSTRIES // PERSONAL AI</span>
          <span className="foot-mid">
            {TABS.find((t) => t.id === activeTab)?.label.toUpperCase()} MODULE ACTIVE
          </span>
          <span>OPERATOR: RUTHISH</span>
        </footer>
      </div>
    </div>
  );
}

export default App;
