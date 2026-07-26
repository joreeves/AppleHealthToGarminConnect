/* ESM wrapper around the self-contained UMD build of @zip.js/zip.js v2.8.34.
 *
 * The UMD assigns its API to `globalThis.zip` (its factory prefers globalThis),
 * so importing it for its side effect works even under module strict mode. We
 * then re-export the handful of names the app uses.
 *
 * Kept same-origin (no CDN) and codec-in-JS (the "full" build, no .wasm, no
 * spawned worker) so the site's strict CSP (`script-src 'self'`, no network)
 * holds. Callers must `configure({ useWebWorkers: false })` so zip.js never
 * tries to spin up a blob/worker codec.
 */
import "./zip-full.min.js";

const zip = globalThis.zip;
if (!zip) throw new Error("zip.js UMD failed to initialise globalThis.zip");

export const {
  ZipReader,
  ZipWriter,
  BlobReader,
  BlobWriter,
  TextReader,
  configure,
} = zip;
