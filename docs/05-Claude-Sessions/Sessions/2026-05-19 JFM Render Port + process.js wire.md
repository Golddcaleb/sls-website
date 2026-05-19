# Session: 2026-05-19 — JFM Render Port + `process.js` Wire

## Goals
1. Port the Phase 1 JFM render composer from `signallogicsystems-site/dashboard.js`
   into the shared backend render layer at `lib/render/job-flow/job-flow.js`
2. Wire the `case 'job-flow'` branch into `netlify/functions/process.js` using
   the `jobs` schema and `analyzeJobFlow` composer
3. Mirror the architectural pattern set by `lib/render/inventory/ship-vs-invoice.js`
   so JFM and the Blue Ash tool share posture (action-first sections,
   self-contained HTML, zero JS by default)

## What Was Built / Decided

### `lib/render/job-flow/job-flow.js` (new — JFM composer, build-order step 5 for JFM)
Consumes the `{ ok, metrics }` shape returned by `analyzeJobFlow()` and emits
a self-contained HTML report through the shared `renderDocument()` shell.

- **Action-first section order** (jfm-architecture.md §6.2 sections, reordered
  to match the ship-vs-invoice precedent):
  1. Headline callout — "&lt;stage&gt; is your constraint, holding $X in active revenue"
  2. Diagnostic narrative — one short paragraph: records processed, past-due
     count, total pipeline value
  3. Priority job table — past-due active jobs ranked by `days_overdue × value`
  4. Constraint chart — active job count per stage, constraint highlighted
  5. Revenue exposure chart — $ held by stage (suppressed when `hasValue=false`)
  6. KPI strip — orientation-only: constraint / revenue at risk / cascade
     exposure / past due / on-time rate / active jobs
  - Footer supplied by `renderDocument`
- **CSS-only horizontal bar charts** rather than Chart.js. The shared report
  shell is "Zero JS by default" and ship-vs-invoice set the no-JS precedent;
  bars are pure `div` + percentage-width. Chart CSS is injected through
  `renderDocument`'s `head` slot so it ships inline with the report and not
  in the shared shell
- **Degraded paths** match Phase 1 behavior:
  - `hasValue=false` → revenue chart suppressed, $ KPIs swap to job-count framings
  - `hasDueDate=false` → priority table suppressed entirely, past-due / on-time
    KPIs render as em-dashes
  - `result.ok=false` → minimal "Diagnostic could not run" callout, mirroring
    `renderShipVsInvoice`'s error path
- **Constraint highlighting** is a `sls-pill--danger` pill on the stage cell
  of the priority table and an alert-colored bar on both charts, so the
  constraint stage is visually consistent across all three sections

### `netlify/functions/process.js` (wired)
- New requires: `jobsSchema`, `analyzeJobFlow`, `renderJobFlow`
- `runJobFlow(parts, ctx)` pipeline helper added next to `runShipVsInvoice`,
  same shape: ingest → normalize → analyze → render → filename + status
- Accepts a single file part. Convention is the `jobs` field name, but a
  sole file part under any name is accepted so the upload form doesn't
  have to be exact for a one-file submission
- Status taxonomy unchanged: 400 (no file) / 422 (schema mapping failed) /
  200 (HTML attachment)
- Status log line on success: `jobs=N constraint="X" past_due=N on_time=N%`
- Filename pattern: `job-flow-<customer-slug>-<YYYY-MM-DD>.html`
- `case 'job-flow':` added to the `X-SLS-Tool` switch

### Decisions
- **No Chart.js inline** — the architecture spec mentions Chart.js as the
  Phase 1 visualization library, but the report-builder is explicitly
  "Zero JS by default" and ship-vs-invoice never needed it. CSS bars are
  a one-time addition that keeps the report a static artifact with no
  script execution. If a future tool needs interactive charts the `head`
  slot is the documented embed point
- **Same section order as ship-vs-invoice** — Travis's framing ("drop a
  file and have it tell me what to do") applies equally to JFM. The KPI
  strip sits below the action sections; the constraint and the worst-
  offending jobs land above the fold
- **Pulled `totalRecords` from `parsed.rows.length`, not `norm.rows.length`**
  — the architecture composer already accepts a `totalRecords` opt for
  exactly this; the count in the report header should reflect the raw CSV
  record count before terminal-stage filtering, not the post-normalize
  count
- **Tolerated field name on the file part** — `jobsPart = parts.find(p =>
  p.name === 'jobs') || (parts.length === 1 ? parts[0] : null)`. JFM
  submissions are single-file, so an unconfigured upload form should not
  hard-fail on the field name

## Tests
- `node -c` syntax check on both new/modified files — clean
- End-to-end smoke against the real `analyzeJobFlow` + `renderJobFlow`
  pipeline with a 6-row synthetic dataset (Machining × 3, QC × 1,
  Paint × 1, Shipped × 1):
  - `ok=true`, constraint resolved to Machining (correct — 3 active jobs)
  - HTML output 17 KB, contains constraint chart, revenue chart, priority
    table, KPI strip, and the constraint-pill marker on the stage cell
- No new unit test files added — JFM render dedicated tests still on the
  follow-up list with ship-vs-invoice / parse-multipart from the prior
  session

## Files Changed on PC
- `lib/render/job-flow/job-flow.js` (new)
- `netlify/functions/process.js` (added `jobsSchema` + `analyzeJobFlow` +
  `renderJobFlow` requires, added `runJobFlow()`, added `case 'job-flow'`)

## Phase 2 Status (after this session)
- [x] lib/auth/hmac.js
- [x] lib/ingest/parse-csv.js
- [x] lib/ingest/parse-multipart.js
- [x] lib/normalize/column-mapper.js
- [x] schemas/jobs.js
- [x] schemas/inventory.js
- [x] analyze/job-flow/ (constraint, revenue-at-risk, priority-rank, index)
- [x] analyze/inventory/ship-vs-invoice.js
- [x] render/report-builder.js + sections (kpi-cards, tables, diagnostic-text)
- [x] render/inventory/ship-vs-invoice.js (composer)
- [x] **render/job-flow/job-flow.js (composer)** ← this session
- [x] netlify/functions/process.js (both tools wired)
- [x] netlify.toml (functions directive)
- [ ] `SLS_SECRET_BLUEASH` env var set in Netlify dashboard before first
      real Blue Ash submission
- [ ] Customer-facing upload UI (`submit.html`) + HMAC-signing helper
- [ ] Dedicated unit tests for `render/job-flow`, `render/inventory/
      ship-vs-invoice`, `analyze/inventory/ship-vs-invoice`, and
      `parse-multipart` (HTML structure assertions, not snapshots)

## Next Session Should Start With
- Build the customer-facing `submit.html` + an HMAC-signing helper so
  neither Travis (Blue Ash) nor JFM prospects have to hand-sign requests.
  Tool selector on the form sets `X-SLS-Tool` and decides the file-field
  shape (one `jobs` field for JFM, `matrix` + `proper21` for ship-vs-invoice)
- Set `SLS_SECRET_BLUEASH` in the Netlify dashboard and run a dry
  end-to-end submission once Travis's real exports arrive
- Add the dedicated unit test files outlined above. The render tests
  should assert presence/absence of sections and class hooks
  (`sls-pill--danger`, `sls-bar--alert`, etc.) rather than full-HTML
  snapshots — snapshots will churn on every CSS tweak
- Reference [[JFM Backend Architecture]], `jfm-architecture.md` §6, and
  the prior session doc `2026-05-19 Phase 2 Backend — Blue Ash
  Ship-vs-Invoice.md`
