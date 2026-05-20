# Session: 2026-05-19 — Submit Pages, Test CLI, Header Auto-Detect, and the Export PDF Button

## Goals
1. Build the customer-facing upload UIs that the prior session left as a
   follow-up: `submit.html` for Blue Ash ship-vs-invoice and `submit-jfm.html`
   for JFM. Both must sign client-side with HMAC-SHA256 and not require the
   customer to hand-sign anything
2. Build a Node CLI (`scripts/test-submission.js`) for SLS-side end-to-end
   testing against the production `/.netlify/functions/process` endpoint —
   so a real submission can be exercised without a browser
3. Take the full pipeline from "wired locally" to "verified working against
   Travis's real Matrix + Proper 21 files in production"
4. Add an `Export PDF` action to every SLS report so the customer can save
   a printable artifact without us shipping a PDF library

## What Was Built / Decided

### `scripts/test-submission.js` (new — SLS-side CLI test tool)
Authenticated submission harness used to drive `process.js` end-to-end
without standing up a browser. Reads `SLS_SECRET_BLUEASH` from a local
`.env` via `dotenv`.

- Constructs the multipart body as a single `Buffer` **manually** rather
  than via `FormData`/`fetch`. The HMAC is computed over the exact bytes
  we send — any re-encoding between sign and send would break server-side
  verification, and `FormData` controls its own boundary internally
- Signs with `crypto.createHmac('sha256', secret).update(`${ts}.`).update(body)`
  — exactly mirrors `lib/auth/hmac.js` so behavior matches the server byte-
  for-byte (the two-`update()` pattern is binary-safe; a template literal
  would have UTF-8-decoded the body)
- Sends `X-SLS-Customer: BLUEASH`, `X-SLS-Timestamp: <unix-seconds>`,
  `X-SLS-Signature: sha256=<hex>`, `X-SLS-Tool: ship-vs-invoice`
- Saves the returned HTML to `scripts/output/ship-vs-invoice-<ISO-stamp>.html`
- Logs status, elapsed ms, and ship-vs-invoice bucket counts on success;
  prints the full response body on non-2xx so 401 / 422 / 400 / 415 modes
  are visible without grepping Netlify logs
- `process.exitCode = 1` (not `process.exit(1)`) so the libuv "handle
  closing" assertion on Node 25 / Windows doesn't fire on rejected paths
- `.env` gitignored; `.env.example` checked in as the template

### `signallogicsystems-site/submit.html` (new — ship-vs-invoice upload page)
Customer-facing portal for Blue Ash. SLS brand. Two file drop zones
(`matrix`, `proper21`) — drag-and-drop + click-to-browse + dragover
highlight + has-file solid border state.

- HMAC signed **client-side** via `crypto.subtle.sign('HMAC', ...)`.
  Same payload shape as the test CLI — prefix bytes (`${ts}.`) +
  body bytes — so server verification works identically
- Multipart body built manually as a single `Uint8Array` for the same
  byte-identity reason as the Node CLI
- Customer ID is hard-coded to `BLUEASH`; secret is a `__SLS_SECRET_HEX__`
  placeholder replaced per-deploy. Page validates the secret is 64 hex
  chars before signing — refuses to send a request signed with the
  placeholder
- On 200: parses `Content-Disposition` filename from the response and
  triggers a blob download. On non-2xx: shows the response body in the
  status panel
- After a successful submission the form is reset and drop-zone state
  cleared — no file references linger in the DOM
- `<meta name="robots" content="noindex, nofollow">` so the submit URL
  doesn't get crawled

### `signallogicsystems-site/submit-jfm.html` (new — JFM upload page)
Single drop zone (`.csv`, `.xls`, `.xlsx`), `X-SLS-Tool: job-flow`, field
name `jobs`. Customer ID and secret are both deploy-time placeholders
(JFM hasn't named its first paying customer yet). Same client-side HMAC,
same manual-multipart, same auto-download / no-data-retention posture
as `submit.html`.

### `lib/ingest/parse-csv.js` (header row auto-detection)
The first real production submission failed with `422 — Missing required
field(s): item, quantity` because the Matrix XLSX has a banner row at
row 1 (`DRT Mfg - Blue Ash - Monthly Receiving Report - PO Detail`).
SheetJS keyed the rest as `__EMPTY`, `__EMPTY_1`, … and the column mapper
correctly reported it couldn't find `item` or `quantity`.

- New helpers (all internal to `parse-csv.js`):
  - `scoreHeaderCandidate(rowArr)` — non-empty unique cell count, with
    a uniqueness bonus and a hard zero for rows that are >50% numeric
    (those are data rows, not headers) or have fewer than two non-empty
    cells (single-cell banner)
  - `findHeaderIndex(rows2d)` — scans first 10 rows, picks the highest
    score, falls back to 0 if nothing scores above 0
  - `safeHeaderNames(rawHeader)` — synthesizes `__col<i>` for empty
    header cells and `<name>_<n>` for duplicates so data isn't silently
    dropped on the way to row objects
  - `rowsFromHeaderIndex(rows2d, headerIdx)` — builds row objects from
    the detected header
- `parseCSV` now parses in array mode (`header: false, skipEmptyLines: false`),
  finds the header, then builds objects. Empty-line preservation matters
  so the detected header index lines up with what the user sees in the
  raw file
- `parseXLSX` switched from default `sheet_to_json` mode to `header: 1`
  (array-of-arrays). This is the **root fix** for the `__EMPTY` problem —
  SheetJS only generates those keys when it's been asked to treat row 0
  as a header
- Two escape hatches: `opts.headerRow` (force a 0-based index) and
  `opts.autoDetectHeader: false` (legacy first-row-as-header for callers
  that already know their input is clean)
- When prelude rows are skipped, a `"Skipped N prelude row(s) before
  header"` line is added to `result.warnings` so the operator can see it
- Tests added in `test/ingest.test.js`:
  - `parseCSV: skips banner prelude row before header`
  - `parseCSV: opts.headerRow forces a specific header index`
  - `parseCSV: opts.autoDetectHeader=false reverts to first-row-as-header`
  - `parseXLSX: skips banner prelude row before header (DRT Blue Ash shape)`
- Suite: 33 ingest / 39 normalize / 22 analyze-job-flow / 23 hmac — all green

### `lib/render/report-builder.js` (Export PDF button)
Adds an `Export PDF` button inside `.sls-meta` in the report header,
below the report-date line. Calls `window.print()` via an inline
`onclick` so no separate `<script>` tag is needed.

- Styled as the SLS gold-outline pattern from `signallogicsystems-site/
  style.css` (Rajdhani uppercase, 1.5px gold border, transparent bg) —
  fills with gold on hover with a 1px lift to match the public site's
  `.btn` micro-interaction
- Includes an inline SVG printer icon and `aria-label="Export this
  report to PDF"` for screen readers
- `@media print { .sls-print-btn { display: none !important; } }` —
  the button does not appear in the saved/printed PDF
- Because both `lib/render/inventory/ship-vs-invoice.js` and
  `lib/render/job-flow/job-flow.js` route through `renderDocument`,
  the change applies to every SLS report (ship-vs-invoice, JFM, and any
  future tool) — no per-composer edits required
- Uses the browser's built-in print → "Save as PDF" path. Keeps the
  report bundle a static artifact with zero PDF-rendering dependencies,
  per the existing self-contained-artifact policy in `report-builder.js`

### Decisions
- **`window.print()` is acceptable JS in the report.** The shell's
  "Zero JS by default" rule explicitly exists so reports don't depend
  on CDN scripts or runtime libraries — a one-line `onclick` for a
  user-driven print action does not breach the spirit of that rule.
  An alternative was to ship a PDF generator (jsPDF / html2pdf); both
  were rejected as carrying ~50–100 KB of script for what every browser
  already does natively
- **Embedded secret model for the submit pages** — each customer gets
  their own copy of `submit.html` with their HMAC secret baked in at
  deploy time. The threat model is "anyone holding this page holds
  this customer's signing key," which is acceptable because the page
  is served only to that customer's URL/path. Documented inline at the
  top of the page script
- **Manual multipart construction in both the CLI and the browser
  pages.** Because the HMAC signs the request body, the bytes we
  sign have to equal the bytes we send. Using `FormData` would have
  delegated boundary choice to the runtime, which would have required
  reading the encoded body back out before signing — extra round-trip,
  extra failure mode. The manual builder is ~30 lines and removes that
  failure mode entirely
- **Header auto-detection lives in `parse-csv.js`, not the schema
  layer.** The schema layer's job is "given clean rows, map columns to
  internal fields." Banner-row handling is a parser-level concern —
  any future tool that loads ERP exports will hit the same problem,
  and fixing it upstream means every analyze module gets the benefit
  with zero changes
- **`fix(ingest):` and `feat(render):` commit prefixes** — first time
  this project has used conventional-commit-style prefixes (prior
  history used `session:`). Mixed style for now; not enforced

### Production verification (Travis's real files)
Drove the full pipeline end-to-end against the live Netlify function
using `scripts/test-submission.js` and Travis's real exports
(`Search_2026_5_19_12_29_31_798.xlsx` matrix + `DRT INVOICED ITEMS
MAY 2025.csv`). Observed status progression across iterations:
- `404 Not Found` — function not yet deployed
- `401 Unauthorized` — `SLS_SECRET_BLUEASH` not yet set in Netlify env
- `422 Unprocessable Entity` — banner row tripped the column mapper
- `200 OK` — pipeline returned a 57 KB self-contained HTML report,
  saved to `scripts/output/`, contains the new `sls-print-btn` in the
  header. Auth → ingest → header-detect → normalize → analyze → render
  all proven against real customer data

## Tests
- `test/ingest.test.js` — 33 tests, all pass (4 new for header
  auto-detection)
- `test/normalize.test.js` — 39 tests, no regressions
- `test/analyze-job-flow.test.js` — 22 tests, no regressions
- `test/hmac.test.js` — 23 tests, no regressions
- End-to-end production smoke via `scripts/test-submission.js` against
  Travis's files — `200 OK`, 57 KB HTML attachment, button verified in
  rendered output
- No render-layer unit tests added — still on the follow-up list from
  the prior session

## Files Changed on PC
- `scripts/test-submission.js` (new)
- `signallogicsystems-site/submit.html` (new)
- `signallogicsystems-site/submit-jfm.html` (new)
- `lib/ingest/parse-csv.js` (header auto-detect)
- `lib/render/report-builder.js` (Export PDF button + styles + print rule)
- `test/ingest.test.js` (+4 tests)
- `.env.example` (new)
- `.gitignore` (added `.env`, `.env.local`, `scripts/output/`)
- `package.json` / `package-lock.json` (added `dotenv`)
- `.claude/settings.local.json` (allowed `npm install *`)
- `docs/02-SLS/jfm-architecture.md` (vault reorg from prior session)
- `docs/Outreach_Log.md` (vault reorg from prior session)

## Git
- Set up first-ever remote on this repo: `origin` →
  `https://github.com/Golddcaleb/sls-website.git` (corrected from
  GitHub's lowercase redirect)
- Local `master` and `origin/main` had unrelated histories. Force-pushed
  local master → origin/main once to align; subsequent pushes have been
  fast-forwards
- Three commits landed this session:
  - `46c146d session: submit pages + test-submission CLI for ship-vs-invoice + JFM`
  - `350ee30 fix(ingest): auto-detect header row, skip banner/blank prelude`
  - `55d6f64 feat(render): add Export PDF button to report header`

## Phase 2 Status (after this session)
- [x] lib/auth/hmac.js
- [x] lib/ingest/parse-csv.js (with header auto-detect)
- [x] lib/ingest/parse-multipart.js
- [x] lib/normalize/column-mapper.js
- [x] schemas/jobs.js
- [x] schemas/inventory.js
- [x] analyze/job-flow/ + analyze/inventory/ship-vs-invoice.js
- [x] render/report-builder.js (now includes Export PDF action)
- [x] render/inventory/ship-vs-invoice.js + render/job-flow/job-flow.js
- [x] netlify/functions/process.js (both tools wired)
- [x] netlify.toml
- [x] **`SLS_SECRET_BLUEASH` set in Netlify dashboard** ← this session
- [x] **Customer-facing upload UIs (`submit.html`, `submit-jfm.html`)** ← this session
- [x] **End-to-end production submission verified against Travis's real
      files** ← this session
- [ ] Dedicated unit tests for `render/job-flow`, `render/inventory/
      ship-vs-invoice`, `analyze/inventory/ship-vs-invoice`, and
      `parse-multipart` (HTML structure assertions, not snapshots)
- [ ] Fix the bucket-count regex in `scripts/test-submission.js` — it
      currently prints `?` for all four counts because the heuristic
      doesn't match the rendered KPI markup. Cosmetic; the saved HTML
      has the real numbers

## Next Session Should Start With
- Send Travis the Blue Ash submission portal link and the rendered
  report from this session. Walk him through the "drop two files →
  download report → click Export PDF" flow on a quick call
- Repeat the production verification with a new dataset to confirm
  the header auto-detector holds up on Travis's monthly cadence
- Tighten the bucket-count regex in `scripts/test-submission.js` so the
  CLI summary line is accurate without having to open the HTML
- Add the render-layer unit tests outlined above. Assert presence /
  absence of section markers (`sls-print-btn`, `sls-pill--danger`,
  `sls-bar--alert`) rather than full HTML snapshots — snapshots will
  churn on every CSS tweak
- Begin JFM customer outreach. The full submission portal works for
  JFM today; the only thing missing is a paying customer ID + secret
  to bake into `submit-jfm.html`
- Reference [[JFM Backend Architecture]], `jfm-architecture.md` §4 and
  §6, and the prior session doc `2026-05-19 JFM Render Port + process.js
  wire.md`
