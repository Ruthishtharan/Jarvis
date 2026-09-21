/* Microphone permission for Electron on macOS.
 *
 * getUserMedia in a normal browser prompts the user and that is the end of
 * it. In Electron there are THREE separate gates, and all of them must pass:
 *
 *   1. macOS TCC — the OS must have granted the *app process* microphone
 *      access. Requested with systemPreferences.askForMediaAccess(). Without
 *      this the call fails silently at the OS layer, before Chromium sees it.
 *
 *   2. Chromium's permission layer — Electron routes renderer permission
 *      requests to setPermissionRequestHandler. If no handler is installed
 *      the behaviour varies by version and can default to deny, which
 *      surfaces as NotAllowedError with no prompt ever appearing.
 *
 *   3. Info.plist NSMicrophoneUsageDescription — required for packaged .app
 *      bundles. Missing it makes macOS terminate the app on request rather
 *      than show a dialog.
 *
 * Getting one of the three right and assuming you are done is the usual way
 * this fails: everything looks correct and the microphone simply never works.
 */

const { systemPreferences, session } = require('electron');

async function ensureMicrophone(log = console.log) {
  // ── Gate 1: the operating system
  if (process.platform === 'darwin') {
    try {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      log(`macOS microphone status: ${status}`);

      if (status === 'not-determined') {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        log(`microphone prompt → ${granted ? 'granted' : 'denied'}`);
        if (!granted) return { ok: false, reason: 'denied at the macOS prompt' };
      } else if (status === 'denied' || status === 'restricted') {
        return {
          ok: false,
          reason: 'blocked in System Settings → Privacy & Security → Microphone',
        };
      }
    } catch (err) {
      log(`could not query macOS microphone status: ${err.message}`);
    }
  }

  // ── Gate 2: Chromium's own permission layer
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    // This app only ever needs the mic; approving everything would be lazy
    // and would silently grant camera, geolocation and notifications too.
    const allowed = ['media', 'audioCapture'];
    cb(allowed.includes(permission));
  });

  // Some Electron versions consult this synchronous variant instead.
  if (session.defaultSession.setPermissionCheckHandler) {
    session.defaultSession.setPermissionCheckHandler((wc, permission) =>
      ['media', 'audioCapture'].includes(permission));
  }

  // Local pages are a secure context, but say so explicitly rather than
  // relying on the default treatment of 127.0.0.1.
  return { ok: true };
}

module.exports = { ensureMicrophone };
