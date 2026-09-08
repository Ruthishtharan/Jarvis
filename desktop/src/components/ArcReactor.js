import React from 'react';
import '../styles/ArcReactor.css';

/**
 * ArcReactor — the JARVIS centerpiece.
 *
 * Concentric rotating rings around a breathing core, in the language of
 * the Iron Man HUD. Ring speed and color respond to assistant state.
 *
 * state: 'offline' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'
 */

const C = 100; // center
const TICKS_OUTER = 72;
const TICKS_INNER = 36;

function tickMarks(count, radius, length, width, opacity) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 360;
    const major = i % 6 === 0;
    return (
      <line
        key={i}
        x1={C}
        y1={C - radius}
        x2={C}
        y2={C - radius + (major ? length * 1.9 : length)}
        strokeWidth={major ? width * 1.6 : width}
        opacity={major ? opacity * 1.6 : opacity}
        transform={`rotate(${angle} ${C} ${C})`}
      />
    );
  });
}

/** Segmented arc ring — four arcs with gaps, like the reactor housing. */
function segmentArc(radius, startDeg, sweepDeg) {
  const rad = (d) => ((d - 90) * Math.PI) / 180;
  const x1 = C + radius * Math.cos(rad(startDeg));
  const y1 = C + radius * Math.sin(rad(startDeg));
  const x2 = C + radius * Math.cos(rad(startDeg + sweepDeg));
  const y2 = C + radius * Math.sin(rad(startDeg + sweepDeg));
  const large = sweepDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
}

function ArcReactor({ state = 'offline', label, sublabel }) {
  const active = state !== 'offline';

  return (
    <div className={`arc-reactor state-${state}`}>
      {/* Bloom halo behind everything */}
      <div className="arc-halo" />

      <svg viewBox="0 0 200 200" className="arc-svg">
        <defs>
          <radialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="var(--rc-bright)" stopOpacity="1" />
            <stop offset="38%"  stopColor="var(--rc-main)"   stopOpacity="0.85" />
            <stop offset="72%"  stopColor="var(--rc-main)"   stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--rc-main)"   stopOpacity="0" />
          </radialGradient>

          <linearGradient id="sweepGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="var(--rc-main)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--rc-main)" stopOpacity="0.95" />
          </linearGradient>

          <filter id="reactorBloom" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Ring 1: outer dashed bezel, slow clockwise ── */}
        <g className="ring ring-outer" style={{ transformOrigin: '100px 100px' }}>
          <circle
            cx={C} cy={C} r="94"
            fill="none"
            stroke="var(--rc-main)"
            strokeWidth="0.7"
            strokeDasharray="14 7 3 7"
            opacity="0.55"
          />
        </g>

        {/* ── Ring 2: dense tick collar, counter-clockwise ── */}
        <g className="ring ring-ticks" style={{ transformOrigin: '100px 100px' }}>
          <g stroke="var(--rc-main)" strokeLinecap="butt">
            {tickMarks(TICKS_OUTER, 86, 5, 0.75, 0.45)}
          </g>
        </g>

        {/* ── Ring 3: segmented housing arcs, clockwise ── */}
        <g className="ring ring-segments" style={{ transformOrigin: '100px 100px' }}>
          {[0, 90, 180, 270].map((start) => (
            <path
              key={start}
              d={segmentArc(74, start + 8, 74)}
              fill="none"
              stroke="var(--rc-main)"
              strokeWidth="2.2"
              opacity="0.78"
              strokeLinecap="round"
              filter="url(#reactorBloom)"
            />
          ))}
        </g>

        {/* ── Ring 4: radar sweep, fast clockwise ── */}
        <g className="ring ring-sweep" style={{ transformOrigin: '100px 100px' }}>
          <path
            d={segmentArc(64, 0, 96)}
            fill="none"
            stroke="url(#sweepGrad)"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>

        {/* ── Ring 5: inner tick ring, counter-clockwise ── */}
        <g className="ring ring-inner" style={{ transformOrigin: '100px 100px' }}>
          <circle
            cx={C} cy={C} r="54"
            fill="none"
            stroke="var(--rc-main)"
            strokeWidth="0.6"
            opacity="0.4"
          />
          <g stroke="var(--rc-main)" strokeLinecap="butt">
            {tickMarks(TICKS_INNER, 54, 4, 0.7, 0.42)}
          </g>
        </g>

        {/* ── Reactor housing: hexagonal coil frame ── */}
        <g className="reactor-housing">
          <polygon
            points={hexPoints(40)}
            fill="none"
            stroke="var(--rc-main)"
            strokeWidth="1.1"
            opacity="0.62"
          />
          <polygon
            points={hexPoints(31)}
            fill="none"
            stroke="var(--rc-main)"
            strokeWidth="0.8"
            opacity="0.42"
            transform={`rotate(30 ${C} ${C})`}
          />
          {/* Coil spokes */}
          {Array.from({ length: 6 }, (_, i) => (
            <line
              key={i}
              x1={C} y1={C - 31}
              x2={C} y2={C - 40}
              stroke="var(--rc-main)"
              strokeWidth="1.4"
              opacity="0.7"
              transform={`rotate(${i * 60} ${C} ${C})`}
            />
          ))}
        </g>

        {/* ── Core: the breathing light ── */}
        <circle
          className="reactor-core"
          cx={C} cy={C} r="30"
          fill="url(#coreGrad)"
        />
        <circle
          className="reactor-core-pin"
          cx={C} cy={C} r="8"
          fill="var(--rc-bright)"
          filter="url(#reactorBloom)"
        />
      </svg>

      {/* Readout under the reactor */}
      <div className="arc-readout">
        <div className="arc-status glow-hard">{label}</div>
        {sublabel && <div className="arc-sub">{sublabel}</div>}
      </div>

      {/* Voice bars — only while speaking/listening */}
      {(state === 'speaking' || state === 'listening') && (
        <div className="arc-waveform">
          {Array.from({ length: 13 }, (_, i) => (
            <span key={i} style={{ animationDelay: `${i * 0.07}s` }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Hexagon vertex string centered at (C, C). */
function hexPoints(r) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((i * 60 - 90) * Math.PI) / 180;
    return `${(C + r * Math.cos(a)).toFixed(2)},${(C + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

export default ArcReactor;
