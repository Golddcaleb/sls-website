# JFM Backend Architecture
*Modular SLS Processing Engine*
*Last updated: May 2026*

## Design Principle
Every SLS tool does the same four things:
1. **Ingest** — accept CSV(s)
2. **Normalize** — map ERP columns to clean internal schema
3. **Analyze** — run tool-specific logic
4. **Render** — produce self-contained HTML report

Only steps 3 and 4 change between tools. Everything else is shared.

## Folder Structure (on PC: `sls-project/`)
```
netlify/functions/
  process.js              ← single entry point, routes by tool

lib/
  auth/
    hmac.js               ← HMAC-SHA256 verify (shared)
  ingest/
    parse-csv.js          ← PapaParse wrapper (shared)
  normalize/
    column-mapper.js      ← fuzzy header matching (shared)
    schemas/
      jobs.js             ← job/WO schema (JFM)
      inventory.js        ← inventory schema (Blue Ash)
      purchase-orders.js  ← PO schema (future)
  analyze/
    job-flow/             ← JFM engine
      constraint.js
      revenue-at-risk.js
      priority-rank.js
    inventory/            ← Blue Ash engine
      ship-vs-invoice.js
      aging.js
    po-tracking/          ← future
      lead-time.js
      follow-up-triggers.js
  render/
    report-builder.js     ← HTML shell (shared)
    sections/
      kpi-cards.js
      tables.js
      charts.js
      diagnostic-text.js
```

## Build Order
1. `lib/auth/hmac.js` — shared, no dependencies
2. `lib/ingest/parse-csv.js` — shared, no dependencies
3. `lib/normalize/column-mapper.js` + `schemas/jobs.js` — JFM schema first
4. `lib/analyze/job-flow/` — JFM engine modules
5. `lib/render/report-builder.js` + sections
6. `netlify/functions/process.js` — wire it all together
7. Repeat steps 3-4 for `inventory/` schema + analyze modules (Blue Ash)

## Phase Status
- [ ] Phase 1 (browser demo): ✅ Complete
- [ ] Phase 2 (Netlify Function): 🔄 In progress
  - [ ] lib/auth/hmac.js
  - [ ] lib/ingest/parse-csv.js
  - [ ] lib/normalize/column-mapper.js
  - [ ] schemas/jobs.js
  - [ ] analyze/job-flow/
  - [ ] render/report-builder.js
  - [ ] netlify/functions/process.js

## Security Model
- HMAC-SHA256 per customer — secret issued at onboarding
- All processing in memory — nothing written to disk
- Raw CSV discarded after request lifecycle ends
- Output HTML contains only derived metrics, no raw data

## Multi-File Ingest (Blue Ash)
Blue Ash sends 2 CSVs (Matrix receipts + Proper 21 invoices).
The ingest layer needs to handle multi-file submissions.
This is a one-time addition that all future multi-source tools inherit.

## Related
→ [[Job Flow Monitor]]
→ [[Blue Ash Industrial Supply]]
→ [[02-SLS/Products/PO Tracker/PO Tracker]]
