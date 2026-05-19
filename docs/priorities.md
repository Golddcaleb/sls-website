# SLS Priorities

*Last updated: May 19, 2026*

## Current Top 5

1. **Deploy website**  
   Switch signallogicsystems.com DNS from Lovable to Netlify.  
   Status: **Done** — Live on Netlify, SSL active, GitHub auto-deploy configured, Google Workspace email active.

2. **Build processing engine**  
   Backend logic that accepts CSV input, returns diagnostic output without exposing the calculation engine.  
   Status: **Phase 2 backend complete end-to-end for Blue Ash ship-vs-invoice.** Pipeline wired this session: `lib/analyze/inventory/ship-vs-invoice.js` (reconciliation engine — match / mismatch / wrong_po / unmatched buckets, P21 `-N` suffix handling, multi-slice aggregation), full `lib/render/` tree (shell with inlined SLS brand CSS + screen-dark/print-light palette, shared KPI/table/diagnostic section primitives, Blue Ash composer), `lib/ingest/parse-multipart.js` (zero-dep RFC 7578 binary-safe parser), `netlify/functions/process.js` (single entry point, HMAC-first auth gate, generic 401 on failure for recon hardening, returns HTML as `Content-Disposition: attachment` download), and `lib/auth/hmac.js` binary-body fix (two-arg `hmac.update()` to avoid lossy UTF-8 decode of Buffer bodies — all 23 existing hmac tests still pass). `netlify.toml` updated with `functions = "netlify/functions"`. End-to-end smoke tests pass: valid signed POST → 200 + 15.7 KB self-contained HTML; all auth-reject paths verified. **Remaining JFM Phase 2 work:** port Phase 1 dashboard.js render functions into `lib/render/job-flow/` composer, add `case 'job-flow'` branch in `process.js`, write unit tests for parse-multipart + analyze/inventory + renders, set `SLS_SECRET_BLUEASH` in Netlify env vars before first real submission.

3. **Start outreach**  
   Begin outreach to manufacturing consulting firms and direct prospects.  
   Status: Not started. AMEND Consulting follow-up is on hold indefinitely.

4. **Land first customer**  
   Target: within 30 days of April 2026.  
   Status: No current paying customers. Blue Ash ship-vs-invoice path is now production-ready pending env var — JFM render port remains the blocker for the flagship product.

5. **Record VSL**  
   Homepage video placeholder needs real content.  
   Status: Not started.

## Known Issues (Non-Urgent)

- **Inbound email needs troubleshooting** — MX records are live in Netlify but confirmation emails to hello@signallogicsystems.com are not arriving (e.g. GitHub). Likely Google Workspace quarantine or spam filter setting. Revisit after first customer.

## Next Actions

- Port Phase 1 `dashboard.js` render functions into `lib/render/job-flow/` composer using the shared report-builder shell
- Add `case 'job-flow'` branch in `netlify/functions/process.js`
- Write unit tests for `lib/ingest/parse-multipart.js`, `lib/analyze/inventory/ship-vs-invoice.js`, and the render composers
- Set `SLS_SECRET_BLUEASH` in Netlify env vars before first real submission
- Begin outreach to manufacturing consulting firms (separate from AMEND)
- Record VSL for homepage

## Scheduling Context (for schedule-planner agent)

- Office days (before May 12): Mon, Wed, Fri
- Office days (May 12+, permanent): Mon, Thu, Fri
- WFH days with baby: remaining days
- Best call windows: early AM on WFH days (before 7:30am)
- Remote desktop available during office day downtime — amber tasks only
