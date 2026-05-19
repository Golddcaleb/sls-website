# Session: 2026-05-19 — Phase 2 Backend: Blue Ash Ship-vs-Invoice End-to-End

## Goals
1. Continue the Phase 2 backend build per the build order in [[JFM Backend Architecture]]
2. Build the Blue Ash analyze module (ship-vs-invoice reconciliation)
3. Build the shared Render layer (report shell + sections) with the
   ship-vs-invoice composer as the first concrete use case
4. Wire `netlify/functions/process.js` — hmac → ingest → normalize → analyze
   → render — so a multipart POST returns a self-contained HTML attachment

## What Was Built / Decided

### `lib/analyze/inventory/ship-vs-invoice.js` (Blue Ash engine — build-order step 7)
- Reconciles Matrix receipts against Proper 21 invoices and emits one record
  per (PO, item) classified as one of four buckets:
  - **match** — both sides agree on qty and unit price
  - **mismatch** — same (PO, item), but qty or price off
  - **wrong_po** — same item billed on both sides, different POs
  - **unmatched** — appears in exactly one file
- Join key: `(po_number, item)` on Matrix; `(stripHyphenSuffix(po_number), item)`
  on Proper 21. Proper 21 numbers each invoice off a single PO with a trailing
  `-N` (one PO becomes many invoice rows). The strip is conservative — only
  trailing `-<digits>` — so legit hyphenated stems like `PO-2026-0142` survive
- Multiple Proper 21 rows that roll up to the same base PO + item are
  aggregated before comparison (qty summed, unit_price taken from the first
  row carrying one — intra-Proper-21 price drift is out of scope)
- `excludeDate` is parameterized (calendar-day match against `line_date`).
  Caller passes today's date in; same-day receipts have not had time to be
  invoiced and would otherwise generate spurious unmatched rows
- Wrong-PO is emitted **once per relationship** — the P21-side walk skips
  items already flagged from the Matrix side so a single mis-keyed item
  is not double-counted

### `lib/render/` (shared HTML shell + sections — build-order step 5)
Built the shared render layer with the ship-vs-invoice composer as the
first concrete use case. JFM and future tools plug in by adding their
own composer; the shell and sections are tool-agnostic.

- `utils.js` — `escapeHtml`, currency / qty / date formatters, signed-delta
  helpers. Em-dash for missing values everywhere (never `null`, `undefined`,
  or `$0.00` — those create false-positive findings)
- `report-builder.js` — `renderDocument()` shell with inlined SLS brand CSS.
  Self-contained: no external CSS, no JS, fonts gracefully fall back to
  system stack offline. Dark on screen (brand parity with the Phase 1 demo
  Travis saw at lunch); `@media print` flips to a light palette so the
  report doesn't eat toner when archived
- `sections/kpi-cards.js` — `renderKpiStrip()` with tone-driven coloring
- `sections/tables.js` — generic `renderTable()`. Per-column `format()` may
  return trusted HTML (lead `<` is the signal) so composers can emit
  semantic classes on delta cells; everything else is escaped
- `sections/diagnostic-text.js` — `renderCallout()` for the lead headline,
  `renderProse()` for narrative, `renderCleanLine()` for the quiet bottom
  acknowledgment
- `inventory/ship-vs-invoice.js` — composer; section order is intentional
  and follows Travis's framing ("drop a file and have it tell me what to do"):
  headline callout → narrative prose → Mismatches → Wrong PO →
  Unmatched (Matrix) → Unmatched (Proper 21) → KPI strip → clean line.
  Empty sections are suppressed entirely so a clean run scrolls cleanly
- Mismatches are sorted by absolute $ impact
  (`|qty_delta × price| + |price_delta × qty|`); unmatched by extended
  value; wrong PO by quantity

### `netlify/functions/process.js` (final wiring — build-order step 6)
Single Netlify Function that all SLS tools route through. Currently
ship-vs-invoice; JFM and future tools plug into the `X-SLS-Tool` switch.
- **Auth gate FIRST** — before any content-type or multipart parsing, so
  unauthenticated requests get the cheapest possible reject path
- HMAC failure reason is logged on the SLS side for diagnostics but the
  response body is a generic `Unauthorized.` so we don't leak which check
  failed (reconnaissance hardening)
- Pipeline: method (POST) → body→Buffer (decodes base64 if Netlify flagged
  binary) → HMAC verify → Content-Type guard (multipart/form-data) →
  parseMultipart → parseFile (per part) → normalize (inventory schema) →
  shipVsInvoice with `excludeDate: today` → renderShipVsInvoice
- Response: `text/html; charset=utf-8`, `Content-Disposition: attachment;
  filename="ship-vs-invoice-<customer-slug>-<YYYY-MM-DD>.html"`,
  `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`
- Status taxonomy: 200 / 401 (auth) / 400 (parse / missing files) / 405
  (non-POST) / 415 (wrong Content-Type) / 422 (schema mapping failed) /
  500 (uncaught — generic body, stack logged server-side only)
- `CUSTOMER_REGISTRY` inlined for now (BLUEASH → "Blue Ash Industrial
  Supply", TESTCLIENT → "Test Client") — onboarding will populate it per
  architecture §10.4
- **Zero `fs` / `writeFile` / `createWriteStream` references** anywhere in
  `netlify/` or `lib/` — verified via grep. Everything in memory; the
  Function returns and the JS GC reclaims the Buffers
- **No row-level data is ever logged** — only customer ID, tool name,
  finding counts, and elapsed ms

### `lib/ingest/parse-multipart.js` (new)
Minimal RFC 7578 multipart/form-data parser, ~150 lines, zero dependencies.
Operates on Buffers throughout (XLSX is a ZIP — UTF-8-decoding would
corrupt the bytes). Headers are decoded as UTF-8; part bodies are sliced
as raw bytes. Form-data only — no mixed/alternative or RFC 2231
encoded-filename support until a real export needs it.

### `lib/auth/hmac.js` (small fix)
`computeSignature` previously used `` `${timestamp}.${body}` `` which
silently UTF-8-decodes a Buffer body — lossy for binary multipart uploads
and would have broken signature verification for any non-ASCII byte.
Changed to two `update()` calls (`hmac.update(``${timestamp}.``)` then
`hmac.update(body)`). Backward-compatible — for string bodies the resulting
byte stream is identical, and all 23 existing hmac tests pass unchanged.

### Decisions
- **Action-first section order** in the report — Travis said at lunch
  "I just want to drop a file and have it tell me what to do." The KPI
  strip sits **below** the action tables, not above. Leading with counts
  of everything would dilute the call to action; the strip is orientation
  for the second read, not the first
- **Four buckets instead of three** — the original framing (qty wrong /
  price wrong / item missing) collapses "wrong PO" into "unmatched." Kept
  them separate because wrong-PO is the most *actionable* category: a
  receiver tagged the wrong PO at intake and it's a one-line fix.
  Collapsing it would hide that
- **Aggregate Proper 21 by base PO + item before comparing** — one invoice
  line becomes many P21 rows via the `-N` suffix; comparing slice-by-slice
  would produce false mismatches at the slice boundary
- **Render layer is shared, composer is tool-specific** — sections in
  `lib/render/sections/` are generic primitives. Tool composers (one per
  tool) own the section order and the narrative copy. Composers live in
  `lib/render/<tool>/` mirroring the analyze folder layout
- **No charts in the ship-vs-invoice v1** — the value is in the action
  tables. Chart.js can be inlined later via the `head` slot in
  `renderDocument` if a future tool needs it; deliberately no CDN
  dependency at render time
- **Print stylesheet flips to light palette** — B2B audiences print
  reconciliation reports. Dark-on-paper eats toner and looks weird in
  an archive
- **HMAC fix scoped to the failure case** — minimal two-line change.
  Confirmed with user before applying; existing string-body callers see
  byte-identical behavior

## Tests
- End-to-end smoke against a synthesized Netlify event (multipart body
  with two CSVs, real HMAC signature, real env-var secret) — 200, 15.7 KB
  HTML attachment, correct filename slug, customer name resolved from
  registry, all four bucket sections present
- Clean-run path — empty action tables suppressed; only the green "All
  clean" callout + KPI strip render
- Auth-reject paths — bad signature → 401, missing headers → 401, unknown
  customer → 401, GET → 405. Specific reasons logged on the SLS side; the
  caller only sees `Unauthorized.` / `Method Not Allowed.`
- `node test/hmac.test.js` after the `computeSignature` fix: **23/23 pass**
- No new test files added this session — the existing suites
  (`hmac.test.js`, `ingest.test.js`, `normalize.test.js`,
  `analyze-job-flow.test.js`) cover everything except the new modules.
  Dedicated tests for `parse-multipart`, `analyze/inventory/ship-vs-invoice`,
  and the renders are a follow-up

## Files Changed on PC
- `lib/analyze/inventory/ship-vs-invoice.js` (new)
- `lib/render/utils.js` (new)
- `lib/render/report-builder.js` (new)
- `lib/render/sections/kpi-cards.js` (new)
- `lib/render/sections/tables.js` (new)
- `lib/render/sections/diagnostic-text.js` (new)
- `lib/render/inventory/ship-vs-invoice.js` (new)
- `lib/ingest/parse-multipart.js` (new)
- `lib/auth/hmac.js` (binary-body fix to `computeSignature`)
- `netlify/functions/process.js` (new)
- `netlify.toml` (added `functions = "netlify/functions"`)

## Phase 2 Status (after this session)
- [x] lib/auth/hmac.js (binary-body fix applied)
- [x] lib/ingest/parse-csv.js
- [x] lib/ingest/parse-multipart.js
- [x] lib/normalize/column-mapper.js
- [x] schemas/jobs.js
- [x] schemas/inventory.js
- [x] analyze/job-flow/ (constraint, revenue-at-risk, priority-rank, index)
- [x] analyze/inventory/ship-vs-invoice.js
- [x] render/report-builder.js + sections (kpi-cards, tables, diagnostic-text)
- [x] render/inventory/ship-vs-invoice.js (composer)
- [x] netlify/functions/process.js
- [x] netlify.toml (functions directive)
- [ ] render/job-flow/ composer (JFM render port from Phase 1 dashboard.js)
- [ ] JFM branch in `process.js` switch (case `'job-flow'`)
- [ ] `SLS_SECRET_BLUEASH` env var set in Netlify dashboard before first real submission
- [ ] Customer-facing upload UI (`submit.html`) + HMAC-signing helper

## Next Session Should Start With
- Wire the JFM render path: port the Phase 1 `dashboard.js` render
  functions (KPI cards, constraint chart, revenue chart, priority table,
  diagnostic summary) into a `lib/render/job-flow/` composer that consumes
  `analyzeJobFlow(...).metrics`. Then add the `case 'job-flow'` branch in
  `process.js`. Chart.js will need to be inlined via `renderDocument`'s
  `head` slot — keep it self-contained
- Add dedicated unit tests for `analyze/inventory/ship-vs-invoice`,
  `parse-multipart`, and the render composer (HTML structure assertions,
  not snapshots)
- Set `SLS_SECRET_BLUEASH` in Netlify env vars and run a dry submission
  against the deployed function once Travis's real exports arrive
- Build the customer-facing `submit.html` + an HMAC-signing helper so
  Travis doesn't have to hand-sign requests
- Reference [[JFM Backend Architecture]], `jfm-architecture.md` §4 / §6,
  and [[Blue Ash Industrial Supply]]
