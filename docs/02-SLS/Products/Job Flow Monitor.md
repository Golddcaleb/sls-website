# Job Flow Monitor (JFM)

**Status:** Phase 1 complete — Phase 2 in progress
**Target:** Manufacturing floors, job shops, ops managers

## What It Does
Ingests job/work order CSV from any ERP. Returns a self-contained HTML diagnostic report with:
- Constraint identification (which stage holds the most jobs)
- Revenue at risk ($ held at the constraint)
- Upstream cascade analysis (total revenue blocked)
- Job priority ranking by financial impact (days overdue × job value)
- Executive-ready diagnostic summary

## Architecture
Full detail → [[JFM Backend Architecture]]

**Phase 1:** Browser-based demo engine (complete)
- Runs in visitor's browser via JS
- Used for sales demos and free operational snapshots
- Processing logic visible in source — acceptable for demo, not for paid product

**Phase 2:** Netlify Function (in progress)
- Engine moves server-side
- HMAC-SHA256 authentication per customer
- CSV in → HTML report out → nothing stored
- Must be complete before first paying client

## Key Files (on PC)
- `signallogicsystems-site/dashboard.html`
- `signallogicsystems-site/dashboard.js`
- `netlify/functions/process.js` (Phase 2 — being built)

## Pricing
Follows standard SLS tier structure → [[Pricing]]
- Starter (0-50 jobs/mo): $2,000 setup / $299/mo
- Growth (51-150): $3,500 setup / $549/mo
- Scale (151-300): $5,000 setup / $949/mo
- Enterprise (301+): Quote
