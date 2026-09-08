import React from 'react';
import '../styles/HUD.css';

/* ============================================================
   HUD primitives — the building blocks of the interface.
   ============================================================ */

/**
 * HUDPanel — an angular frame with corner brackets and a clipped
 * top-right corner, like a targeting overlay.
 */
export function HUDPanel({ title, right, children, className = '', accent }) {
  return (
    <section className={`hud-panel ${className}`} data-accent={accent || undefined}>
      <span className="bracket tl" />
      <span className="bracket tr" />
      <span className="bracket bl" />
      <span className="bracket br" />

      {(title || right) && (
        <header className="hud-panel-head">
          <span className="hud-panel-title">{title}</span>
          <span className="hud-panel-rule" />
          {right && <span className="hud-panel-right">{right}</span>}
        </header>
      )}

      <div className="hud-panel-body">{children}</div>
    </section>
  );
}

/**
 * CircularGauge — a tick-marked ring with an arc that fills to `pct`.
 * The Iron Man readout: number in the middle, label beneath.
 */
export function CircularGauge({
  value,
  unit = '',
  label,
  pct = 0,
  accent = 'cyan',
  size = 132,
}) {
  const R = 54;
  const CIRC = 2 * Math.PI * R;
  const clamped = Math.max(0, Math.min(1, pct));
  const offset = CIRC * (1 - clamped);

  return (
    <div className={`gauge accent-${accent}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 140 140">
        {/* Tick collar */}
        <g stroke="currentColor" opacity="0.3">
          {Array.from({ length: 48 }, (_, i) => {
            const major = i % 4 === 0;
            return (
              <line
                key={i}
                x1="70" y1={70 - 66}
                x2="70" y2={70 - 66 + (major ? 7 : 4)}
                strokeWidth={major ? 1.2 : 0.7}
                opacity={major ? 1 : 0.5}
                transform={`rotate(${(i / 48) * 360} 70 70)`}
              />
            );
          })}
        </g>

        {/* Track */}
        <circle
          cx="70" cy="70" r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.13"
        />

        {/* Progress arc */}
        <circle
          className="gauge-arc"
          cx="70" cy="70" r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          transform="rotate(-90 70 70)"
        />
      </svg>

      <div className="gauge-center">
        <div className="gauge-value">
          {value}
          {unit && <span className="gauge-unit">{unit}</span>}
        </div>
        <div className="gauge-label">{label}</div>
      </div>
    </div>
  );
}

/**
 * StatusPip — small blinking indicator + text.
 */
export function StatusPip({ state, children }) {
  return (
    <span className={`pip-wrap pip-${state}`}>
      <span className="pip" />
      <span className="pip-text">{children}</span>
    </span>
  );
}

/**
 * HUDButton — bracketed action button.
 */
export function HUDButton({ children, onClick, variant = 'default', disabled }) {
  return (
    <button
      className={`hud-btn hud-btn-${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="hud-btn-edge left" />
      <span className="hud-btn-text">{children}</span>
      <span className="hud-btn-edge right" />
    </button>
  );
}

/**
 * DataRow — a key/value telemetry line with dot leaders.
 */
export function DataRow({ k, v, accent }) {
  return (
    <div className="data-row">
      <span className="data-k">{k}</span>
      <span className="data-dots" />
      <span className="data-v" data-accent={accent || undefined}>{v}</span>
    </div>
  );
}
