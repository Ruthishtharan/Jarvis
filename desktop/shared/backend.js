/* Shared backend supervisor for both desktop apps.
 *
 * JARVIS and JARVIS Brain are two separate apps that talk to the same Python
 * server. Whichever launches first starts it; the second finds it already
 * running and attaches. Neither one owns it, so quitting one app does not
 * take the other's brain away with it.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const HOST = '127.0.0.1';
const PORT = 8420;

let child = null;

/** Path baked in at build time by build-neutron.sh. */
function bakedRoot() {
  try {
    const pkg = path.join(__dirname, '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).jarvisRoot || null;
  } catch {
    return null;
  }
}

/**
 * The project root — meaning the directory that actually contains
 * web/server.py, not the one two levels up from this file.
 *
 * `path.resolve(__dirname, '..', '..')` is right when running from source
 * (desktop/shared -> Jarvis.ai) and wrong inside a built bundle, where it
 * lands on Neutron.app/Contents/Resources. build-neutron.sh copies only the
 * JS in, so no web/server.py exists there: spawn failed instantly, the child
 * died, and ensureBackend polled a dead port for 45 seconds before throwing.
 *
 * That went unnoticed because a hand-started backend was always already
 * listening, so the bundle only ever took the "attaching" branch and never had
 * to start one. The first time it had to, it could not — and said nothing.
 *
 * So resolve by verifying instead of assuming: take the first candidate that
 * actually contains the server.
 */
function findRoot() {
  const candidates = [
    process.env.JARVIS_ROOT,
    path.resolve(__dirname, '..', '..'),
    bakedRoot(),
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'web', 'server.py'))) return c;
  }
  return null;
}

/** Is something already answering on the API port? */
function ping(timeoutMs = 900) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: HOST, port: PORT, path: '/api/status', timeout: timeoutMs },
      (res) => { res.resume(); resolve(res.statusCode === 200); },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** Find a Python that can actually run the server. */
function findPython(root) {
  const candidates = [
    process.env.JARVIS_PYTHON,
    path.join(root, 'venv', 'bin', 'python3'),
    path.join(root, '.venv', 'bin', 'python3'),
    '/usr/local/bin/python3',
    '/opt/homebrew/bin/python3',
    'python3',
  ].filter(Boolean);

  for (const p of candidates) {
    if (p === 'python3' || fs.existsSync(p)) return p;
  }
  return 'python3';
}

/**
 * Ensure the backend is up. Returns { started, url }.
 * `started` is true only if *this* process spawned it — the caller uses that
 * to decide whether it is responsible for shutting it down.
 */
async function ensureBackend(onLog = () => {}) {
  const url = `http://${HOST}:${PORT}`;

  if (await ping()) {
    onLog('backend already running — attaching');
    return { started: false, url };
  }

  // Fail loudly and immediately when the source is missing. The old code
  // spawned into a nonexistent directory and then waited out the full 45s
  // timeout, which looks identical to a slow start and tells you nothing.
  const root = findRoot();
  if (!root) {
    const msg = 'cannot locate web/server.py — set JARVIS_ROOT, or rebuild '
      + 'the app with build-neutron.sh so the project path is baked in';
    onLog(msg);
    throw new Error(msg);
  }

  const python = findPython(root);
  onLog(`starting backend with ${python} (root: ${root})`);

  child = spawn(python, ['web/server.py', '--port', String(PORT)], {
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let exited = false;
  child.stdout.on('data', (d) => onLog(String(d).trimEnd()));
  child.stderr.on('data', (d) => onLog(String(d).trimEnd()));
  child.on('exit', (code) => {
    onLog(`backend exited (${code})`);
    child = null;
    exited = true;
  });

  // The registry import pulls in every skill and the TTS engine, so first
  // start is genuinely slow. Poll rather than guessing a fixed delay.
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await ping()) {
      onLog('backend ready');
      return { started: true, url };
    }
    // A dead child will never answer a ping. Waiting out the remaining timeout
    // only delays the same failure and hides the exit code that explains it.
    if (exited) {
      throw new Error('backend process exited during startup — see the log above');
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error('backend did not come up within 45s');
}

function stopBackend() {
  if (!child) return;
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  child = null;
}

module.exports = { ensureBackend, stopBackend, ping, PORT, HOST };
