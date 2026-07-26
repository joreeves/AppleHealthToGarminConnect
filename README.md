# Apple Health → Garmin

Convert an **Apple Health** export into **Garmin-importable "Fitbit" CSV files**
(one per year), for Garmin Connect's *Import Fitbit Data* feature. Runs 100% in
your browser — your health data never leaves your device.

- **Live site:** _add your Cloudflare Workers URL / custom domain here_
- **Support this project:** [☕ Ko-fi](https://ko-fi.com/josiah1194)

It also ships the original Python CLI (`health_to_garmin_fitbit.py`) that the web
app is a port of.

## Privacy by architecture
**Your health data never leaves your device.** There is no backend and no storage.
The picked `export.zip` / `export.xml` is read and processed entirely in the
browser (streamed, so a ~300 MB file never loads into memory whole). The page
makes **zero network requests with your data** — enforced, not just promised, by a
strict Content-Security-Policy (`connect-src 'none'`, see `web/_headers`). You can
confirm in DevTools → Network that nothing is uploaded.

## How it works
```
export.zip ─ zip.js (streaming, one entry) ─┐
export.xml ─ File.stream() ─────────────────┴─► TextDecoderStream ─► line splitter
        ─► per-<Record/> regex ─► per-day totals ─► midnight-split + mi→km
        ─► group by year ─► "Activities" CSVs ─► download (.zip)
```
All heavy work runs in a Web Worker so the UI stays responsive.

## Repository layout
```
web/                  # the website (deployed to Cloudflare)
  index.html          #   UI, export/import instructions, donate, privacy
  styles.css
  _headers            #   Cloudflare security headers (CSP)
  src/
    parse.js          #   lineSplitter() + recordAttrs()
    convert.js        #   pure logic (aggregate, daySplits, buildYearlyCsvs)
    worker.js         #   streaming pipeline (zip/xml → convert)
    main.js           #   UI glue, progress, zip download
  vendor/zipjs/       #   vendored @zip.js/zip.js v2.8.34 (self-hosted, no CDN)
  test/convert.test.mjs  # parity check vs the Python CLI
wrangler.jsonc        # Cloudflare Workers static-assets config (serves ./web)
health_to_garmin_fitbit.py  # reference CLI (Apple Health export.xml → yearly CSVs)
```

## Run the website locally
Serve the `web/` folder over HTTP (module workers don't run from `file://`):
```
cd web
python -m http.server 8080
# open http://localhost:8080/
```

## Deploy to Cloudflare (free)
Deployed as a Cloudflare **Workers static-assets** site; `wrangler.jsonc` points at
`./web`. Connect the repo in Workers & Pages with an empty build command and deploy
command `npx wrangler deploy` — every push redeploys. `_headers` applies the CSP
automatically (verify with `curl -I <url>`).

## Command-line converter
Prefer to run it locally without a browser:
```
python health_to_garmin_fitbit.py            # export.xml → garmin_import/*.csv
python health_to_garmin_fitbit.py --include-existing
```

## Test parity (web logic vs the CLI)
```
node web/test/convert.test.mjs            # expects export.xml + garmin_import/ in the repo root
```
Runs `convert.js` over the real `export.xml` and diffs the generated CSVs against
the Python output (spot-checks Oct 10 2015 = 30,146 steps).

## Support
Free, open-source hobby project. If it saved you some hassle, a tip is appreciated:
**[☕ Support me on Ko-fi](https://ko-fi.com/josiah1194)**

---
Not affiliated with Apple, Garmin, or Fitbit.
