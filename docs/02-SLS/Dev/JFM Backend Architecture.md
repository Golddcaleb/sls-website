# JFM Backend Architecture

## Overview
Two-phase build. Phase 1 = browser-only demo (no IP leakage risk because demo data only). Phase 2 = Netlify Function backend that holds the calculator.

## Phase 1: Browser Demo
- Static HTML/CSS/JS
- `calculate()` runs in browser against demo CSVs
- Used for sales demos only — never against real customer data
- Lives in `signallogicsystems-site/job-flow-monitor/`

## Phase 2: Netlify Function Backend
- Customer POSTs signed multipart CSV → `/process`
- HMAC-SHA256 auth per customer (secret in Netlify env var)
- Function pipeline: hmac → ingest → normalize → analyze → render
- Returns self-contained HTML report as attachment download
- No raw data persisted; metrics retained 60 days max per SOW

## File Tree
```
lib/
  auth/hmac.js
  ingest/parse-csv.js
  ingest/parse-multipart.js
  normalize/column-mapper.js
  schemas/jobs.js
  schemas/inventory.js
  analyze/job-flow/
    constraint.js
    revenue-at-risk.js
    priority-rank.js
    index.js
  analyze/inventory/
    ship-vs-invoice.js
  render/
    utils.js
    report-builder.js
    sections/
      kpi-cards.js
      tables.js
      diagnostic-text.js
    inventory/
      ship-vs-invoice.js
netlify/
  functions/
    process.js
```

## Build Order
1. `lib/auth/hmac.js`
2. `lib/ingest/parse-csv.js`
3. `lib/normalize/column-mapper.js` + `schemas/jobs.js`
4. `lib/analyze/job-flow/` modules
5. `lib/render/report-builder.js` + sections
6. `netlify/functions/process.js` — wire it all together
7. Repeat steps 3-4 for `inventory/` schema + analyze modules (Blue Ash)

## Phase Status
- [x] Phase 1 (browser demo): Complete
- [x] Phase 2 (Netlify Function): Blue Ash ship-vs-invoice path complete end-to-end
  - [x] lib/auth/hmac.js (binary-safe HMAC update fix applied)
  - [x] lib/ingest/parse-csv.js
  - [x] lib/ingest/parse-multipart.js
  - [x] lib/normalize/column-mapper.js
  - [x] schemas/jobs.js
  - [x] schemas/inventory.js (built ahead of step 7 — Blue Ash)
  - [x] analyze/job-flow/ (constraint, revenue-at-risk, priority-rank, index)
  - [x] analyze/inventory/ship-vs-invoice.js (Blue Ash reconciliation engine)
  - [x] render/utils.js + report-builder.js + sections/ (shared shell + KPI/table/diagnostic primitives)
  - [x] render/inventory/ship-vs-invoice.js (Blue Ash composer)
  - [x] netlify/functions/process.js (HMAC-first; returns HTML attachment)
  - [ ] render/job-flow/ composer (port Phase 1 dashboard.js render functions)
  - [ ] `case 'job-flow'` branch in process.js
  - [ ] Unit tests for parse-multipart, analyze/inventory/ship-vs-invoice, renders
  - [ ] SLS_SECRET_BLUEASH env var set in Netlify before first real submission

## Security Model
- HMAC-SHA256 per customer — secret issued at onboarding
- All processing in memory — nothing written to disk
- Raw CSV discarded after request lifecycle ends
- Output HTML contains only derived metrics, no raw data
- Auth failure reasons logged server-side only — generic 401 to caller (recon hardening)
