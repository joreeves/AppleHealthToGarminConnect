# Apple Health → Garmin (client-side web app)

A tiny static website that converts an Apple Health export into Garmin-importable
"Fitbit" activity CSVs (one per year), for Garmin Connect's **Import Fitbit Data**
feature. It's a browser port of the project's Python CLI
(`../health_to_garmin_fitbit.py`).

**Source code:** https://github.com/joreeves/AppleHealthToGarminConnect
**Support this project:** [☕ Ko-fi](https://ko-fi.com/josiah1194)

## Privacy by architecture
**Your health data never leaves your device.** There is no backend and no storage.
The picked `export.zip` / `export.xml` is read and processed entirely in the
browser (streamed, so a ~300 MB file never loads into memory whole). The page
makes **zero network requests with your data** — enforced, not just promised, by a
strict Content-Security-Policy (`connect-src 'none'`, see `_headers`). You can
confirm in DevTools → Network that nothing is uploaded.

## How it works
```
export.zip ─ zip.js (streaming, one entry) ─┐
export.xml ─ File.stream() ─────────────────┴─► TextDecoderStream ─► line splitter
        ─► per-<Record/> regex ─► per-day totals ─► midnight-split + mi→km
        ─► group by year ─► "Activities" CSVs ─► download (.zip)
```
All heavy work runs in a Web Worker so the UI stays responsive.

## Project layout
```
web/
  index.html          # the page (UI, instructions, donate, privacy)
  styles.css
  _headers            # Cloudflare Pages security headers (CSP)
  src/
    parse.js          # lineSplitter() + recordAttrs()
    convert.js        # pure logic port (aggregate, daySplits, buildYearlyCsvs)
    worker.js         # streaming pipeline (zip/xml → convert)
    main.js           # UI glue, progress, zip download
  vendor/zipjs/
    zip-full.min.js   # vendored @zip.js/zip.js v2.8.34 (UMD, self-contained)
    zip.js            # tiny ESM wrapper around it
  test/
    convert.test.mjs  # parity check vs the Python golden CSVs
```

## Run locally
Serve `web/` over HTTP (module workers don't run from `file://`):
```
cd web
python -m http.server 8080
# open http://localhost:8080/
```

## Configure before deploy
- **Donate button**: in `index.html`, replace `YOUR_HANDLE` in the `#donate` link
  (`https://ko-fi.com/YOUR_HANDLE`) with your Ko-fi username. It's a plain link-out
  (not the embed widget), so the strict CSP stays intact.
- **Source link**: point the `#source` link at your repo.

## Deploy to Cloudflare (free)
Deployed as a Cloudflare **Workers static-assets** site. The repo-root
`wrangler.jsonc` points at this `web/` folder:
```jsonc
{ "name": "apple-health-to-garmin-connect", "assets": { "directory": "./web" } }
```
- **Git-connected (auto-deploy):** connect the repo in Workers & Pages with an
  empty build command and deploy command `npx wrangler deploy`. Every push
  redeploys.
- **Manual:** `npx wrangler deploy` from the repo root.
- `_headers` applies the CSP automatically. Verify with `curl -I <url>`.

## Test parity with the Python CLI
```
node web/test/convert.test.mjs            # expects ../export.xml + ../garmin_import/
```
Runs `convert.js` over the real `export.xml` and diffs the generated CSVs against
the Python output in `garmin_import/` (spot-checks Oct 10 2015 = 30,146 steps).

## Support
Free, open-source hobby project. If it saved you some hassle, a tip is appreciated:
**[☕ Support me on Ko-fi](https://ko-fi.com/josiah1194)**
