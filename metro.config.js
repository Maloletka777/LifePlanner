const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro's defaults, plus the two things a web bundle needs to run this application.
 *
 * **It exists so the app can be opened on this machine at all.** `AGENTS.md` records that
 * there is no way to see this screen from Windows — no iOS simulator, and the web bundle
 * refusing to start because `expo-sqlite` pulls `wa-sqlite.wasm` and Metro cannot resolve it.
 * The second half of that was a missing configuration rather than a fact about the platform:
 * `expo-sqlite` has a web implementation, and it needs a bundler that will carry a `.wasm`
 * asset and a dev server that sets the two headers `SharedArrayBuffer` requires.
 *
 * **Native is deliberately untouched.** Adding an asset extension changes nothing for a
 * platform that never asks for one, and the headers are the development server's alone —
 * `expo export --platform ios` produces the same bundle it did before this file existed.
 * The point of the web target is not to ship: it is a bench where a page turn can be watched
 * frame by frame, and where render counts and mount order can be *counted* rather than
 * guessed at from a recording. **It is not iOS** — Reanimated drives from
 * `requestAnimationFrame` there rather than from a UI thread — so it can show what the code
 * does and never what the phone feels like. Physical acceptance stays on the device.
 */
const config = getDefaultConfig(__dirname);

// `wa-sqlite.wasm` is an asset, not a module: without this Metro reports it as unresolvable
// and the whole web bundle fails at the first import of `expo-sqlite`.
config.resolver.assetExts.push('wasm');

// SQLite's web build runs in a worker and needs `SharedArrayBuffer`, which browsers only
// grant to a cross-origin-isolated document.
config.server.enhanceMiddleware = (middleware) => (request, response, next) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  return middleware(request, response, next);
};

module.exports = config;
