import React, { useEffect, useRef } from 'react';
import '../styles/ParticleRings.css';

/**
 * Two concentric particle rings that move with Jarvis's voice.
 *
 * GEOMETRY
 * --------
 * The first version used tube radius 34 against a ring separation of 52, so
 * the two tori overlapped and read as a single diffuse blob. The rings need
 * to be thin relative to the gap between them to stay visually distinct:
 * tube 16, radii at 0.60 and 0.94 of the available half-size.
 *
 * RENDERING
 * ---------
 * Bytes written straight into an ImageData buffer at a deliberately low
 * internal resolution, scaled up by CSS with `image-rendering: pixelated`.
 * That is what makes it genuinely pixel-art rather than a smooth render
 * shrunk down, and it is far cheaper than thousands of fillRect calls.
 *
 * RHYTHM
 * ------
 * Volume alone produces a shape that swells and sags. Rhythm needs onsets —
 * the sharp rise at the start of a syllable. `onset` tracks how fast the
 * level is climbing and fires a decaying kick, so consonants punch and
 * vowels sustain. That difference is what reads as moving *to* speech rather
 * than merely *with* it.
 */

const PARTICLES_PER_RING = 3400;
const RING_COUNT = 2;
const TUBE = 16;            // thin, so the two rings stay separate
const FOCAL = 780;

export default function ParticleRings({ state = 'offline', level = 0 }) {
  const canvasRef = useRef(null);
  const levelRef = useRef(0);
  const stateRef = useRef(state);

  useEffect(() => { levelRef.current = level; }, [level]);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    let W = 0, H = 0, image = null, buf = null;

    // Render at roughly half the display size: big enough to hold detail,
    // small enough that each particle occupies a visible pixel once scaled.
    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      W = Math.max(320, Math.round(rect.width / 2));
      H = Math.max(320, Math.round(rect.height / 2));
      canvas.width = W;
      canvas.height = H;
      image = ctx.createImageData(W, H);
      buf = image.data;
      for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
    };
    resize();
    window.addEventListener('resize', resize);

    // Geometry is fixed; only rotation and audio displacement change.
    const particles = [];
    for (let r = 0; r < RING_COUNT; r++) {
      for (let i = 0; i < PARTICLES_PER_RING; i++) {
        const u = Math.random() * Math.PI * 2;
        const v = Math.random() * Math.PI * 2;
        particles.push({
          ring: r,
          cu: Math.cos(u), su: Math.sin(u),
          cv: Math.cos(v), sv: Math.sin(v),
          // Bias outward so each ring reads as a shell with an airy edge
          // rather than a solid tube.
          shell: 0.45 + Math.pow(Math.random(), 0.35) * 0.55,
          phase: Math.random() * Math.PI * 2,
          twinkle: 0.55 + Math.random() * 0.45,
        });
      }
    }

    const COLOURS = {
      offline:   [72, 92, 112],
      idle:      [130, 215, 255],
      listening: [165, 245, 255],
      thinking:  [140, 205, 255],
      speaking:  [255, 205, 140],
      error:     [255, 115, 125],
    };

    let raf;
    let t = 0;
    let smooth = 0;
    let onset = 0;
    let prev = 0;

    const draw = () => {
      const st = stateRef.current;
      const target = st === 'offline' ? 0 : levelRef.current;

      // Onset: how sharply the level is rising. Decays fast so it reads as a
      // hit rather than a sustained swell.
      const rise = Math.max(0, target - prev);
      prev = target;
      onset = Math.max(onset * 0.86, rise * 3.2);

      smooth += (target - smooth) * 0.20;
      const amp = Math.min(1, smooth + onset * 0.55);

      const idle = st === 'idle' || st === 'offline';
      const speed = st === 'offline' ? 0.12 : idle ? 0.30 : 0.30 + amp * 1.9;
      t += 0.0055 * speed;

      // Fade instead of clearing, leaving a short motion trail.
      const decay = 0.58;
      for (let i = 0; i < buf.length; i += 4) {
        buf[i] *= decay;
        buf[i + 1] *= decay;
        buf[i + 2] *= decay;
      }

      const [cr, cg, cb] = COLOURS[st] || COLOURS.idle;

      const half = Math.min(W, H) / 2;
      const R1 = half * 0.60;
      const R2 = half * 0.94;
      const tube = TUBE * (half / 240);

      const ax = Math.sin(t * 0.62) * 0.5 + 0.5;
      const ay = t;
      const cosX = Math.cos(ax), sinX = Math.sin(ax);
      const cosY = Math.cos(ay), sinY = Math.sin(ay);

      const cx = W / 2, cy = H / 2;
      const breathe = 1 + amp * 0.30;

      for (let p = 0; p < particles.length; p++) {
        const q = particles[p];
        const tr = tube * q.shell * breathe;
        const ringR = q.ring === 0 ? R1 : R2;

        let x = (ringR + tr * q.cv) * q.cu;
        let y = (ringR + tr * q.cv) * q.su;
        let z = tr * q.sv;

        // Tilt the outer ring so the pair interlocks rather than sitting flat.
        if (q.ring === 1) {
          const ty = y * 0.26 - z * 0.97;
          const tz = y * 0.97 + z * 0.26;
          y = ty; z = tz;
        }

        // Voice pushes particles along their own radius; the onset kick makes
        // that push land on syllables instead of averaging them out.
        if (amp > 0.002) {
          const push = 1 + amp * 0.20 * Math.sin(q.phase + t * 11) + onset * 0.10;
          x *= push; y *= push;
        }

        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;

        const denom = FOCAL + z2;
        if (denom <= 1) continue;
        const scale = FOCAL / denom;

        const sx = (cx + x1 * scale) | 0;
        const sy = (cy + y2 * scale) | 0;
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;

        // Depth drives brightness — that is what makes a flat field of
        // identical dots read as a three-dimensional object.
        const depth = Math.max(0, Math.min(1, (scale - 0.70) / 0.60));
        const shimmer = 0.6 + 0.4 * Math.sin(q.phase + t * 7) * q.twinkle;
        const b = depth * shimmer * (0.5 + amp * 0.75);

        const idx = (sy * W + sx) * 4;
        const nr = buf[idx] + cr * b;
        const ng = buf[idx + 1] + cg * b;
        const nb = buf[idx + 2] + cb * b;
        buf[idx] = nr > 255 ? 255 : nr;
        buf[idx + 1] = ng > 255 ? 255 : ng;
        buf[idx + 2] = nb > 255 ? 255 : nb;
      }

      ctx.putImageData(image, 0, 0);
      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className={`prings prings-${state}`}>
      <div className="prings-glow" />
      <canvas ref={canvasRef} className="prings-canvas" />
    </div>
  );
}
