# Session: 2026-05-19 — Phase 2 Backend: Normalize Layer + JFM Engine

## Goals
1. Continue the Phase 2 backend build per the build order in [[JFM Backend Architecture]]
2. Build the shared Normalize layer: column mapper + JFM and Blue Ash schemas
3. Build the JFM Analyze engine (constraint, revenue-at-risk, priority rank)
4. Keep parity with the tested Phase 1 browser engine throughout

## What Was Built / Decided

### `lib/normalize/column-mapper.js` (shared)
- Schema-driven Normalize layer — step 3 of Ingest → Normalize → Analyze → Render
- Tool-agnostic: JFM and Blue Ash differ only by the schema passed in
- Public API: `normalize(input, schema)` is the main entry; also exports
  `buildMapping`, `applyMapping`, `coerceValue`, `normalizeHeader`,
  `tokenBoundaryMatch`
- Accepts either a parse-csv `ParseResult` or a bare rows array; returns the
  same `{ ok, rows, mapping, columns, warnings, error? }` contract style as
  `hmac.js` / `parse-csv.js`
- **Two-pass matching:** exact normalized match for all fields first (each
  source header consumed once), then a conservative single-candidate
  token-boundary fuzzy fallback. Ambiguous fuzzy cases are reported as
  warnings, never guessed
- Output rows contain **only declared schema fields** — unrecognized columns
  are dropped (supports the zero-raw-data-leak principle)

### `lib/normalize/schemas/jobs.js` (JFM)
- Variant lists mirror `dashboard.js COLUMN_VARIANTS` verbatim so Phase 2
  resolves identical columns to the deployed Phase 1 demo

### `lib/normalize/schemas/inventory.js` (Blue Ash — built ahead of step 7)
- Both Matrix receipts and Proper 21 invoices normalize into one shared
  line-item shape (`Qty_Received` and `Qty_Invoiced` both → generic
  `quantity`), so the future ship-vs-invoice module reconciles two datasets
  by `(po_number, item)`

### `lib/analyze/job-flow/` (JFM engine — build-order step 4)
Ported the tested Phase 1 `dashboard.js` engine logic to run server-side
against normalized rows. Decomposed into the three modules the
architecture specifies, plus a thin composer:
- `constraint.js` — active-job filter (`TERMINAL_STAGES`, verbatim from
  Phase 1) + constraint identification (max active-job count, ties broken
  by revenue held). §5.2, §5.3
- `revenue-at-risk.js` — stage-order inference (canonical
  `KNOWN_STAGE_ORDER` + median-age ranking for unknown stages),
  revenue-at-risk, and upstream cascade with the Phase 1 fallback
  (sum all non-constraint when the constraint is first). §5.4, §5.5
- `priority-rank.js` — `daysOverdue` / `isPastDue` (injectable `today`),
  priority ranking (`days_overdue × job_value`, past-due-only, top 20),
  and supporting metrics (past-due count, avg days late, on-time rate,
  total value, hasValue/hasDueDate). §5.6, §5.7
- `index.js` — `analyzeJobFlow(rows, { today, totalRecords })` composer.
  Returns `{ ok, metrics }` (or `{ ok:false, error }` when no active
  jobs), with the metrics object **byte-compatible** with Phase 1
  `calculate()` so the render layer ports with minimal change
- Priority list is **scrubbed to derived fields only** server-side
  (no `part_number` / `description`) — zero-raw-data-leak principle
- `today` is injectable through every function so the Netlify Function
  can pin one "now" per request and tests are timezone-deterministic

### Decisions
- **`index.js` composer** added beyond the architecture's folder map —
  justified: one clean call site for `process.js`, preserves Phase 1
  render contract, follows the `{ ok, error }` convention instead of
  Phase 1's null-on-empty
- **Three-tier field levels** (`required` / `preferred` / `optional`)
  resolve the discrepancy between [[JFM Backend Architecture]]-linked
  `jfm-architecture.md` §10.5 (calls `due_date`/`job_value` "required") and
  the tested Phase 1 `dashboard.js` (runs without them). Preserved the
  **deployed Phase 1 behavior**: `job_number`/`stage` hard-required;
  `due_date`/`job_value` preferred-with-warning. Open to overriding to
  strict 422s later if desired
- Built `schemas/inventory.js` now rather than waiting for build-order
  step 7 — the schema is just field definitions and unblocks Blue Ash work

## Tests
- `test/normalize.test.js` — 39 tests; Phase 1 parity checks + the Blue Ash
  two-file scenario reusing the exact headers from `ingest.test.js`
- `test/analyze-job-flow.test.js` — 22 tests; hand-computed expected values
  with a pinned timezone-safe `today`, plus a full
  parseCSV → normalize → analyzeJobFlow pipeline test
- **Full suite green, no regressions — 113 tests total:**
  - `hmac.test.js` 23/23 · `ingest.test.js` 29/29 ·
    `normalize.test.js` 39/39 · `analyze-job-flow.test.js` 22/22
- The two initial normalize failures were both test-fixture bugs (unquoted
  comma in a CSV currency value; a mislabeled duplicate-header case) — the
  mapper was correct in both; fixtures fixed and a distinct-columns test
  added. The analyze suite passed on first run

## Files Changed on PC
- `lib/normalize/column-mapper.js` (new)
- `lib/normalize/schemas/jobs.js` (new)
- `lib/normalize/schemas/inventory.js` (new)
- `lib/analyze/job-flow/constraint.js` (new)
- `lib/analyze/job-flow/revenue-at-risk.js` (new)
- `lib/analyze/job-flow/priority-rank.js` (new)
- `lib/analyze/job-flow/index.js` (new)
- `test/normalize.test.js` (new)
- `test/analyze-job-flow.test.js` (new)
- `docs/02-SLS/Dev/JFM Backend Architecture.md` (Phase 2 checklist updated)

## Phase 2 Status (after this session)
- [x] lib/auth/hmac.js
- [x] lib/ingest/parse-csv.js
- [x] lib/normalize/column-mapper.js
- [x] schemas/jobs.js
- [x] schemas/inventory.js
- [x] analyze/job-flow/ (constraint, revenue-at-risk, priority-rank, index)
- [ ] render/report-builder.js  ← next
- [ ] netlify/functions/process.js

## Next Session Should Start With
- Build `lib/render/report-builder.js` + `render/sections/` — port the
  Phase 1 `dashboard.js` render functions (KPI cards, constraint chart,
  revenue chart, priority table, diagnostic summary) into a self-contained
  HTML report shell. Input is the `analyzeJobFlow(...).metrics` object,
  which is intentionally byte-compatible with Phase 1 `calculate()`
- Then `netlify/functions/process.js` to wire hmac → ingest → normalize →
  analyze → render end to end
- Reference [[JFM Backend Architecture]] and `jfm-architecture.md` §6 for
  the report spec
