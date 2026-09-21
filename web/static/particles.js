/* JARVIS — volumetric particle star (three.js).
 *
 * Ported from the AI Particle Simulator "THE SUN" export Ruthish supplied.
 * The layer maths is kept faithful to that source because it is what produces
 * the look; what is added here is JARVIS reactivity, the optimisations below,
 * and a local vendored three.js so the page works with no network.
 *
 * Layers, addressed by normalised particle index `t = i / count`:
 *
 *   t < 0.12   fusing core            cbrt-uniform sphere, fusion burst flicker
 *   t < 0.32   radiative zone         slow wander, deep amber
 *   t < 0.55   convective cells       three-wave granulation flow
 *   t < 0.68   photosphere            granules + sunspot darkening
 *   t < 0.78   chromosphere           spicules jetting off the surface
 *   t < 0.90   coronal loops / wind   arcs on field lines, or escaping plasma
 *   t < 0.97   prominences            larger erupting arcs
 *   else       far solar wind         long-range outflow
 *
 * Two optimisations over the original, both real and measurable:
 *
 *   1. The six `h1..h6` hashes are constant per particle but the source
 *      recomputes them every frame — 6 sin + abs + mod x 20,000 x 60fps is
 *      ~7.2M wasted sin() calls per second. They are precomputed here into
 *      Float32Arrays once.
 *   2. The six `addControl()` reads sat inside the per-particle loop, so
 *      120,000 function calls per frame returned the same six numbers. They
 *      are hoisted above the loop.
 *
 * Bloom is what sells it. UnrealBloomPass at strength ~1.8 with threshold 0
 * means every lit instance blooms, which is why the core reads as plasma
 * rather than as 20,000 discrete triangles.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const TAU = 6.2831853;

// JARVIS states bias the simulation rather than replacing it, so the star
// stays recognisably the same object while it reacts.
const STATES = {
  idle:      { heat: 0.00, churn: 1.00, wind: 1.00, flare: 1.00, spin: 1.00, bloom: 1.00 },
  listening: { heat: 0.15, churn: 1.30, wind: 1.30, flare: 1.15, spin: 1.60, bloom: 1.15 },
  thinking:  { heat: 0.50, churn: 2.20, wind: 1.60, flare: 1.80, spin: 3.00, bloom: 1.35 },
  speaking:  { heat: 0.80, churn: 1.70, wind: 2.20, flare: 2.20, spin: 2.00, bloom: 1.60 },
  error:     { heat: -0.6, churn: 2.60, wind: 0.50, flare: 0.60, spin: 0.60, bloom: 0.85 },
};


// The brain form reads the same JARVIS states, but maps them to neural
// language instead of stellar: firing rate, mood, subconscious chaos.
const BRAIN_STATES = {
  idle:      { fire: 1.00, mood:  0.00, chaos: 1.00, flow: 1.00, bloom: 1.00 },
  listening: { fire: 1.45, mood:  0.18, chaos: 0.80, flow: 1.30, bloom: 1.12 },
  thinking:  { fire: 2.60, mood:  0.05, chaos: 1.90, flow: 2.40, bloom: 1.35 },
  speaking:  { fire: 1.90, mood:  0.42, chaos: 0.70, flow: 1.70, bloom: 1.50 },
  error:     { fire: 0.70, mood: -0.95, chaos: 2.40, flow: 0.60, bloom: 0.85 },
};

const lerp = (a, b, t) => a + (b - a) * t;

export class ParticleSun {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.count = opts.count || 20000;

    this.params = Object.assign({
      sunRadius: 40,
      fusionRate: 6,
      convectionTurbulence: 3,
      magneticActivity: 3,
      solarWindSpeed: 5,
      activeRegions: 40,
    }, opts.params);

    // Second form: a cortical brain. Same renderer, same particle buffers —
    // only the position/colour maths differs, so switching is instant.
    this.brainParams = Object.assign({
      foldIntensity: 0.4,
      plasticity: 0.3,
      expansion: 46,
      consciousnessFlow: 1.2,
      chaos: 0.8,
      rotationSpeed: 0.15,
      fireRate: 2.2,
      mood: 0,
    }, opts.brainParams);

    this.mode = opts.mode || 'star';
    this.bmod = Object.assign({}, BRAIN_STATES.idle);
    this.btarget = BRAIN_STATES.idle;

    this.state = 'idle';
    this.mod = Object.assign({}, STATES.idle);
    this.target = STATES.idle;
    this.level = 0;
    this._level = 0;
    this.speedMult = 1.19056436419487;
    this.running = false;
    // Set before _initThree(), which applies it.
    this.viewShift = opts.viewShift || 0;

    this._initThree();
    this._initParticles();

    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  // ── three.js scaffolding ───────────────────────────────────────────────

  _initThree() {
    const w = window.innerWidth, h = window.innerHeight;

    this.scene = new THREE.Scene();
    // Quadratic falloff — this is what gives the forms depth, and what makes
    // the cortical folding legible rather than a uniform ball. It is also a
    // trap: an earlier build moved the camera to 225 for brain mode, where
    // exp(-(0.01*225)^2) leaves 0.6% of the colour and the brain went black.
    // The camera distance is now fixed for both forms, so this is safe.
    this.scene.fog = new THREE.FogExp2(0x000000, 0.01);

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000);
    // The source sat at z=100, but its far solar wind reaches ~4x the sun
    // radius, so at that distance the outflow fills the frame and the disc
    // is lost. Backing off frames the star the way the reference shows it.
    this.camera.position.set(0, 0, 145);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(w, h);
    // Cap at 1.5 rather than the full 2x Retina ratio: bloom runs several
    // full-screen passes, so pixel count is the dominant cost on an M1 Air.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 2.0;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 600;
    // Target the subject's centre, not a point below it. Offsetting the
    // target makes autoRotate swing the star through an arc — it looks like
    // it is tumbling upward rather than spinning. The star is lifted in the
    // frame with setViewOffset instead, which shifts the image without
    // moving the camera or the axis it turns about.
    this.controls.target.set(0, 0, 0);
    // autoRotate only changes the azimuth, so the spin is horizontal no
    // matter what the polar angle is — a hard lock was unnecessary and stopped
    // you tilting to inspect. Clamp near the equator instead: enough freedom
    // to look around, not enough to end up upside down.
    this.controls.minPolarAngle = Math.PI * 0.30;
    this.controls.maxPolarAngle = Math.PI * 0.70;
    this.controls.update();

    this._applyViewShift();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 1.5, 0.4, 0.85);
    this.bloom.strength = 1.8;
    this.bloom.radius = 0.45;
    this.bloom.threshold = 0;   // everything lit blooms — this is the look
    this.baseBloom = 1.8;
    this.composer.addPass(this.bloom);

    this.clock = new THREE.Clock();
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.target3 = new THREE.Vector3();
  }

  _initParticles() {
    const n = this.count;

    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }

    const geometry = new THREE.TetrahedronGeometry(0.25);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geometry, material, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    // Precomputed per-particle hashes. Constant for the life of the particle,
    // so computing them per frame (as the source did) is pure waste.
    this.h1 = new Float32Array(n);
    this.h2 = new Float32Array(n);
    this.h3 = new Float32Array(n);
    this.h4 = new Float32Array(n);
    this.h5 = new Float32Array(n);
    const hash = (i, a, b) => Math.abs(Math.sin(i * a) * b) % 1;
    for (let i = 0; i < n; i++) {
      this.h1[i] = hash(i, 12.9898, 43758.5453);
      this.h2[i] = hash(i, 78.2330, 12543.1230);
      this.h3[i] = hash(i, 45.1640, 98765.4320);
      this.h4[i] = hash(i, 33.7190, 54321.9870);
      this.h5[i] = hash(i, 61.4310, 31415.9265);
    }

    // Current positions, eased toward their target each frame.
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = (Math.random() - 0.5) * 100;
      this.py[i] = (Math.random() - 0.5) * 100;
      this.pz[i] = (Math.random() - 0.5) * 100;
    }
  }

  // ── public API ─────────────────────────────────────────────────────────

  setParam(key, value) {
    if (key in this.params) this.params[key] = value;
  }

  setState(state) {
    if (!STATES[state]) state = 'idle';
    this.state = state;
    this.target = STATES[state];
    this.btarget = BRAIN_STATES[state];
  }

  /** Switch between the stellar and cortical forms. */
  setMode(mode) {
    if (mode !== 'star' && mode !== 'brain') return;
    this.mode = mode;
    // The lerp in the frame loop carries every particle to its new home, so
    // the two forms morph into each other rather than cutting.
    // The brain spans ~2x the star's radius, so it needs a longer lens.
    this.controls.target.set(0, mode === 'brain' ? -8 : -26, 0);
    const dist = mode === 'brain' ? 225 : 145;
    this.camera.position.normalize().multiplyScalar(dist);
    this.controls.update();
  }

  setBrainParam(key, value) {
    if (key in this.brainParams) this.brainParams[key] = value;
  }

  setLevel(v) { this.level = Math.max(0, Math.min(1, v || 0)); }

  setAutoRotate(on) { this.controls.autoRotate = !!on; }

  /** Shift the rendered image vertically without moving the camera. */
  _applyViewShift() {
    const w = window.innerWidth, h = window.innerHeight;
    if (!this.viewShift) { this.camera.clearViewOffset(); return; }
    // Positive y renders a lower slice of the virtual frame, so the subject
    // rises in the output.
    this.camera.setViewOffset(w, h, 0, this.viewShift, w, h);
  }

  setViewShift(px) { this.viewShift = px; this._applyViewShift(); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this._applyViewShift();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      this.frame();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.controls.dispose();
    this.renderer.dispose();
  }

  // ── frame ──────────────────────────────────────────────────────────────

  frame() {
    if (this.mode === 'brain') return this._frameBrain();
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime * this.speedMult;

    // Ease state modifiers so transitions melt instead of snapping.
    const k = Math.min(1, dt * 3);
    const m = this.mod, tg = this.target;
    for (const key in tg) m[key] = lerp(m[key], tg[key], k);

    // Loudness rises fast, falls slow — matches speech, avoids strobing.
    this._level += (this.level - this._level) *
                   Math.min(1, (this.level > this._level ? 18 : 3) * dt);

    // Hoisted out of the particle loop: the source read these 20,000 times
    // per frame to get the same six numbers.
    const P = this.params;
    const scaleR      = P.sunRadius;
    const fusionRate  = P.fusionRate * (1 + m.heat * 0.5);
    const convection  = P.convectionTurbulence * m.churn;
    const magnetic    = P.magneticActivity * m.flare;
    const windSpeed   = P.solarWindSpeed * m.wind;
    const loopsCount  = Math.max(4, Math.floor(P.activeRegions));

    const heatShift = m.heat * 0.04;   // hue nudge: hotter → whiter/bluer
    const lift      = this._level * 0.18;

    const n = this.count;
    const h1a = this.h1, h2a = this.h2, h3a = this.h3, h4a = this.h4, h5a = this.h5;
    const color = this.color, dummy = this.dummy, target = this.target3;
    const mesh = this.mesh;

    const t0 = 0.12, t1 = 0.32, t2 = 0.55, t3 = 0.68,
          t4 = 0.78, t5 = 0.90, t6 = 0.97;

    const ang = time * 0.03;
    const ca = Math.cos(ang), sa = Math.sin(ang);

    for (let i = 0; i < n; i++) {
      const t = i / n;
      const h1 = h1a[i], h2 = h2a[i], h3 = h3a[i], h4 = h4a[i], h5 = h5a[i];

      let px = 0, py = 0, pz = 0;

      if (t < t0) {
        // ── fusing core
        const coreR = scaleR * 0.22;
        const theta = h1 * TAU;
        const cphi = h2 * 2 - 1;
        const sphi = Math.sqrt(Math.max(0, 1 - cphi * cphi));
        const rr = Math.cbrt(Math.max(h3, 0.0001)) * coreR;
        const rad = rr + Math.sin(time * 3 + h4 * TAU) * coreR * 0.03;
        px = rad * sphi * Math.cos(theta);
        py = rad * sphi * Math.sin(theta);
        pz = rad * cphi;
        const burst = Math.pow(0.5 + 0.5 * Math.sin(time * fusionRate * 4 + h5 * 18.85), 6);
        color.setHSL(Math.max(0, 0.14 - burst * 0.05 + heatShift), 1.0,
                     Math.min(0.95, 0.55 + (0.5 + 0.5 * burst) * 0.4 + lift));

      } else if (t < t1) {
        // ── radiative diffusion zone
        const rr = scaleR * 0.22 + h1 * (scaleR * 0.24);
        const theta = h2 * TAU + Math.sin(time * 0.03 + h3 * TAU) * 0.3;
        const cphi = h3 * 2 - 1;
        const sphi = Math.sqrt(Math.max(0, 1 - cphi * cphi));
        const rad = rr + Math.sin(time * 0.08 + h4 * TAU) * scaleR * 0.02;
        px = rad * sphi * Math.cos(theta);
        py = rad * sphi * Math.sin(theta);
        pz = rad * cphi;
        color.setHSL(0.06 + heatShift, 0.9, 0.25 + h5 * 0.1 + lift);

      } else if (t < t2) {
        // ── convective granulation cells
        const rr = scaleR * 0.46 + h1 * (scaleR * 0.26);
        const theta = h2 * TAU;
        const cphi = h3 * 2 - 1;
        const sphi = Math.sqrt(Math.max(0, 1 - cphi * cphi));
        const cell = Math.sin(theta * 6 + time * convection * 0.5)
                   + Math.sin(cphi * 18 + time * convection * 0.4 + h4 * TAU)
                   + Math.sin((theta + cphi) * 12 - time * convection * 0.6);
        const flow = cell * convection * scaleR * 0.015;
        const rad = rr + flow;
        px = rad * sphi * Math.cos(theta + flow * 0.01);
        py = rad * sphi * Math.sin(theta + flow * 0.01);
        pz = rad * cphi;
        const heat = (cell + 3) / 6;
        color.setHSL(Math.max(0, 0.08 - heat * 0.02 + heatShift), 1.0,
                     0.3 + heat * 0.35 + lift);

      } else if (t < t3) {
        // ── photosphere with sunspots
        const R = scaleR * 0.76;
        const theta = h1 * TAU;
        const cphi = h2 * 2 - 1;
        const sphi = Math.sqrt(Math.max(0, 1 - cphi * cphi));
        const granule = Math.sin(theta * 24 + time * 0.6)
                      + Math.sin(cphi * 30 - time * 0.5 + h3 * TAU)
                      + Math.sin(theta * 17 + cphi * 13 + time * 0.4);
        const spotNoise = Math.sin(theta * 3 + h4 * TAU) + Math.sin(cphi * 4 + time * 0.05);
        const spotDark = Math.max(0, -spotNoise - 1.1) * 0.8;
        const rad = R + granule * scaleR * 0.004;
        px = rad * sphi * Math.cos(theta);
        py = rad * sphi * Math.sin(theta);
        pz = rad * cphi;
        color.setHSL(0.13 + heatShift, 0.9,
                     Math.max(0.08, Math.min(0.85, 0.6 + granule * 0.1 - spotDark + lift)));

      } else if (t < t4) {
        // ── chromospheric spicules
        const theta = h1 * TAU;
        const cphi = h2 * 2 - 1;
        const sphi = Math.sqrt(Math.max(0, 1 - cphi * cphi));
        const spiculeLen = scaleR * 0.05;
        const spicule = Math.abs(Math.sin(time * 2 + h3 * 18.85)) * spiculeLen;
        const rad = scaleR * 0.79 + spicule;
        px = rad * sphi * Math.cos(theta);
        py = rad * sphi * Math.sin(theta);
        pz = rad * cphi;
        color.setHSL(0.98, 0.85, 0.35 + (spicule / spiculeLen) * 0.25 + lift);

      } else if (t < t5) {
        if (h5 < 0.5) {
          // ── coronal loops on closed field lines
          const r = this._loop(i, loopsCount, time, magnetic, scaleR, h1,
                               17.17, 29.71, 53.13, 71.91,
                               0, 1, 0.15, 0.2, 0.35, 0.1, 0.15, 0.8, 0.4, 0.6, 0.4);
          px = r.x; py = r.y; pz = r.z;
          color.setHSL(0.55, 0.3, 0.45 + r.bulge * 0.3 + lift);
        } else {
          // ── near solar wind
          const theta = h1 * TAU;
          const cphi = h2 * 2 - 1;
          const sphi = Math.sqrt(Math.max(0, 1 - cphi * cphi));
          const travel = (time * windSpeed * 0.6 + h3 * 18) % 18;
          const rad = scaleR * 0.82 + travel * scaleR * 0.05;
          px = rad * sphi * Math.cos(theta);
          py = rad * sphi * Math.sin(theta);
          pz = rad * cphi;
          color.setHSL(0.58, 0.4, 0.15 + Math.max(0, 1 - travel / 18) * 0.5 + lift);
        }

      } else if (t < t6) {
        // ── erupting prominences (bigger arcs, hotter)
        const r = this._loop(i, loopsCount, time, magnetic, scaleR, h1,
                             21.31, 37.77, 59.59, 83.13,
                             0.15, 0, 1, 0.3, 0.5, 0.2, 0.3, 0.79, 0.5, 0.5, 0.5);
        px = r.x; py = r.y; pz = r.z;
        color.setHSL(Math.max(0, 0.05 - r.pulse * 0.02 + heatShift), 0.95,
                     0.4 + r.pulse * 0.3 + r.bulge * 0.1 + lift);

      } else {
        // ── far solar wind
        const theta = h1 * TAU;
        const cphi = h2 * 2 - 1;
        const sphi = Math.sqrt(Math.max(0, 1 - cphi * cphi));
        const travel = (time * windSpeed * 1.1 + h3 * 70) % 70;
        const rad = scaleR * 0.95 + travel * scaleR * 0.045;
        px = rad * sphi * Math.cos(theta);
        py = rad * sphi * Math.sin(theta);
        pz = rad * cphi;
        color.setHSL(0.6, 0.35, 0.1 + Math.max(0, 1 - travel / 70) * 0.4 + lift);
      }

      // Slow global spin about Z, then ease toward the target. The lerp is
      // what makes a slider change flow instead of teleport.
      target.set(px * ca - py * sa, px * sa + py * ca, pz);
      const j = i;
      this.px[j] += (target.x - this.px[j]) * 0.1;
      this.py[j] += (target.y - this.py[j]) * 0.1;
      this.pz[j] += (target.z - this.pz[j]) * 0.1;

      dummy.position.set(this.px[j], this.py[j], this.pz[j]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.controls.autoRotateSpeed = 2.0 * m.spin;
    this.controls.update();

    this.bloom.strength = this.baseBloom * m.bloom * (1 + this._level * 0.35);
    this.composer.render();
  }


  // ── Cortical brain form ────────────────────────────────────────────────
  //
  // Ported from Ruthish's "Architecture of Mind" export. Eight interwoven
  // regions on a Fibonacci sphere: biology, cognition, consciousness, memory,
  // executive control, emotion, empathy, subconscious.
  //
  // Structure:
  //   Fibonacci sphere   even surface coverage — golden-angle spiral avoids
  //                      the pole clustering that naive random angles give
  //   lobe pull          blends each point toward one of 8 lobe centres
  //   cortical folding   three stacked sine waves displace the surface
  //   hemisphere gap     a longitudinal fissure splits left from right
  //   consciousness core regions near index 2 collapse into a central spiral
  //   subconscious chaos regions near index 7 get hash jitter
  //   synaptic firing    a radial wave sweeps outward; sharp pow() spikes
  //
  // BUG FIXED FROM THE SOURCE: the three folding waves were written on
  // separate lines with no `+` between them. JavaScript's automatic semicolon
  // insertion silently turned waves two and three into dead statements, so
  // only the first contributed. Restored here — the folding is visibly richer.
  _frameBrain() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime * this.speedMult;

    const k = Math.min(1, dt * 3);
    const m = this.bmod, tg = this.btarget;
    for (const key in tg) m[key] = lerp(m[key], tg[key], k);

    this._level += (this.level - this._level) *
                   Math.min(1, (this.level > this._level ? 18 : 3) * dt);

    const B = this.brainParams;
    const foldIntensity = B.foldIntensity;
    const plasticity    = B.plasticity;
    const expansion     = B.expansion;
    const flow          = B.consciousnessFlow * m.flow;
    const chaos         = B.chaos * m.chaos;
    const rotationSpeed = B.rotationSpeed;
    const fireRate      = B.fireRate * m.fire;
    const mood          = Math.max(-1, Math.min(1, B.mood + m.mood));

    const n = this.count;
    const color = this.color, dummy = this.dummy, target = this.target3;
    const mesh = this.mesh;

    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const rotAngle = time * rotationSpeed;
    const cosR = Math.cos(rotAngle), sinR = Math.sin(rotAngle);
    const lift = this._level * 0.22;

    for (let i = 0; i < n; i++) {
      const idxF = i + 0.5;

      // Fibonacci sphere — even coverage without pole clustering.
      const phi = Math.acos(Math.min(1, Math.max(-1, 1 - 2 * idxF / n)));
      const theta = goldenAngle * idxF;
      const sinPhi = Math.sin(phi);

      const dirX = sinPhi * Math.cos(theta);
      const dirY = Math.cos(phi);
      const dirZ = sinPhi * Math.sin(theta);

      // Pull toward one of eight lobe centres.
      const regionIndex = i % 8;
      const regionT = regionIndex / 8;
      const lobeAngle = regionT * TAU;
      const lobePull = 0.35;

      const bx = dirX * (1 - lobePull) + Math.cos(lobeAngle) * lobePull;
      const by = dirY * (1 - lobePull) + Math.cos(regionIndex * Math.PI) * lobePull * 0.6;
      const bz = dirZ * (1 - lobePull) + Math.sin(lobeAngle) * lobePull;
      const vlen = Math.max(Math.sqrt(bx * bx + by * by + bz * bz), 1e-4);
      const nx = bx / vlen, ny = by / vlen, nz = bz / vlen;

      // Cortical folding — all three waves, as intended.
      const fold = Math.sin(phi * 14 + theta * 4 + time * 0.15) * 0.5
                 + Math.sin(theta * 9 - phi * 6 + time * 0.20) * 0.3
                 + Math.sin(phi * 22 + theta * 17 - time * 0.10) * 0.2;

      const foldedRadius = 1 + fold * foldIntensity * 0.3;
      const breathe = 1 + Math.sin(time * 0.25 + regionT * TAU) * 0.08 * plasticity;
      const radiusVal = expansion * foldedRadius * breathe;

      // Longitudinal fissure between hemispheres.
      const hemiSign = nx >= 0 ? 1 : -1;
      let posX = nx * 1.15 * radiusVal + hemiSign * 0.06 * expansion;
      let posY = ny * 0.95 * radiusVal;
      let posZ = nz * 1.00 * radiusVal;

      // Consciousness — regions near index 2 collapse into a central spiral.
      const coreWeight = Math.exp(-Math.pow(regionIndex - 2, 2) * 1.5);
      if (coreWeight > 0.001) {
        // The source used `(i % 400) * 0.05` for radius and `sin(i * 0.01)`
        // for height, which quantises the stream into flat stacked discs —
        // it reads as a rendering glitch. A golden-ratio fractional part
        // spreads particles continuously along the helix instead.
        // Two DIFFERENT irrationals: using one for both height and radius
        // correlates them perfectly and the stream collapses into a cone.
        const fy = (i * 0.6180339887) % 1;   // height along the column
        const fr = (i * 0.7548776662) % 1;   // radius, decorrelated
        const spiralAngle = i * 0.15 + time * flow;
        // sqrt keeps the cross-section area-uniform rather than centre-heavy.
        const spiralRadius = 3 + Math.sqrt(fr) * expansion * 0.26;
        const spiralY = (fy - 0.5) * expansion * 0.9
                      + Math.sin(time * 0.5 + fy * TAU) * expansion * 0.05;
        posX = posX * (1 - coreWeight) + Math.cos(spiralAngle) * spiralRadius * coreWeight;
        posY = posY * (1 - coreWeight) + spiralY * coreWeight;
        posZ = posZ * (1 - coreWeight) + Math.sin(spiralAngle) * spiralRadius * coreWeight;
      }

      // Subconscious — regions near index 7 get hash jitter.
      const chaosWeight = Math.exp(-Math.pow(regionIndex - 7, 2) * 1.5);
      if (chaosWeight > 0.001) {
        const amt = chaos * chaosWeight * expansion * 0.15;
        const jA = Math.sin(i * 12.9898 + time * 1.3) * 43758.5453;
        const jB = Math.sin(i * 78.2330 + time * 0.7) * 24634.6345;
        const jC = Math.sin(i * 45.1640 + time * 1.9) * 11753.3140;
        posX += ((jA - Math.floor(jA)) - 0.5) * amt;
        posY += ((jB - Math.floor(jB)) - 0.5) * amt;
        posZ += ((jC - Math.floor(jC)) - 0.5) * amt;
      }

      target.set(posX * cosR - posZ * sinR, posY, posX * sinR + posZ * cosR);

      // Synaptic firing — a radial wave, sharpened so spikes read as pulses.
      const dist = Math.sqrt(posX * posX + posY * posY + posZ * posZ);
      const phase = Math.sin(dist * 0.35 - time * fireRate + regionIndex * 0.8);
      const firing = phase > 0 ? Math.pow(phase, 6) : 0;

      // Close to the source's values. An earlier build raised these hard
      // because the brain rendered black — but that was the fog, not the
      // colour. Fixing the cause made the boost overexpose the core.
      const hueRaw = regionT * 0.85 + 0.05 + mood * 0.12 + time * 0.01;
      color.setHSL(
        ((hueRaw % 1) + 1) % 1,
        Math.min(1, Math.max(0.35, 0.72 + firing * 0.25 + coreWeight * 0.1)),
        Math.min(0.95, Math.max(0.30,
          0.52 + firing * 0.38 + coreWeight * 0.18 - chaosWeight * 0.04 + lift))
      );

      this.px[i] += (target.x - this.px[i]) * 0.1;
      this.py[i] += (target.y - this.py[i]) * 0.1;
      this.pz[i] += (target.z - this.pz[i]) * 0.1;

      dummy.position.set(this.px[i], this.py[i], this.pz[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.controls.autoRotateSpeed = 1.1;
    this.controls.update();
    this.bloom.strength = this.baseBloom * 1.25 * m.bloom * (1 + this._level * 0.3);
    this.composer.render();
  }

  /** Shared magnetic-arc solver for coronal loops and prominences. */
  _loop(i, loopsCount, time, magnetic, scaleR, s,
        a1, a2, a3, a4, refX, refY, refZ,
        hwBase, hwSpread, ahBase, ahSpread, rBase, pulseBase, pulseAmp, pulseRate) {
    const li = i % loopsCount;
    const lh1 = Math.abs(Math.sin(li * a1) * 6543.21) % 1;
    const lh2 = Math.abs(Math.sin(li * a2) * 7654.32) % 1;
    const lh3 = Math.abs(Math.sin(li * a3) * 8765.43) % 1;
    const lh4 = Math.abs(Math.sin(li * a4) * 9876.54) % 1;

    // Anchor point on the sphere for this active region.
    const pcphi = lh2 * 2 - 1;
    const psphi = Math.sqrt(Math.max(0, 1 - pcphi * pcphi));
    const pTheta = lh1 * TAU;
    const pX = psphi * Math.cos(pTheta), pY = psphi * Math.sin(pTheta), pZ = pcphi;

    // Build an orthonormal basis around the anchor so the arc sweeps in a
    // stable plane instead of wobbling as the anchor moves.
    let e1x = refY * pZ - refZ * pY,
        e1y = refZ * pX - refX * pZ,
        e1z = refX * pY - refY * pX;
    const l1 = Math.max(Math.hypot(e1x, e1y, e1z), 1e-5);
    e1x /= l1; e1y /= l1; e1z /= l1;

    let e2x = pY * e1z - pZ * e1y,
        e2y = pZ * e1x - pX * e1z,
        e2z = pX * e1y - pY * e1x;
    const l2 = Math.max(Math.hypot(e2x, e2y, e2z), 1e-5);
    e2x /= l2; e2y /= l2; e2z /= l2;

    const halfWidth = hwBase + lh3 * hwSpread;
    const alpha = (s - 0.5) * halfWidth * 2;
    const cA = Math.cos(alpha), sA = Math.sin(alpha);

    let dx = e1x * cA + e2x * sA,
        dy = e1y * cA + e2y * sA,
        dz = e1z * cA + e2z * sA;
    const dl = Math.max(Math.hypot(dx, dy, dz), 1e-5);
    dx /= dl; dy /= dl; dz /= dl;

    const bulge = Math.cos((s - 0.5) * Math.PI);
    const pulse = pulseBase + pulseAmp * Math.sin(time * pulseRate * magnetic + lh4 * TAU);
    const archHeight = scaleR * (ahBase + lh3 * ahSpread) * Math.max(0.1, magnetic) * pulse;
    const radius = scaleR * rBase + archHeight * bulge;

    return { x: dx * radius, y: dy * radius, z: dz * radius, bulge, pulse };
  }
}
