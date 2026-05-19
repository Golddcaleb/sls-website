# SLS Priorities

*Last updated: May 19, 2026*

## Current Top 5

1. **Deploy website**  
   Switch signallogicsystems.com DNS from Lovable to Netlify.  
   Status: **Done** — Live on Netlify, SSL active, GitHub auto-deploy configured, Google Workspace email active.

2. **Build processing engine**  
   Backend logic for Job Flow Monitor: accepts CSV input, returns diagnostic output without exposing the calculation engine.  
   Status: **In progress — Phase 2 backend core complete.** Phase 1 (browser demo) shipped. Phase 2 backend modules built and tested this session: `lib/auth/hmac.js`, `lib/ingest/parse-csv.js`, `lib/normalize/column-mapper.js` + schemas for jobs and inventory, and the full `lib/analyze/job-flow/` engine (constraint, revenue-at-risk, priority-rank, index composer). 113 tests passing, 0 failures across hmac (23), ingest (29), normalize (39), analyze-job-flow (22). JFM metrics output is byte-compatible with Phase 1 `calculate()`. **Remaining for Phase 2:** `lib/render/report-builder.js` + `render/sections/` (port Phase 1 dashboard render functions to self-contained HTML report), then `netlify/functions/process.js` to wire hmac → ingest → normalize → analyze → render end to end.

3. **Start outreach**  
   Begin outreach to manufacturing consulting firms and direct prospects.  
   Status: Not started. AMEND Consulting follow-up is on hold indefinitely.

4. **Land first customer**  
   Target: within 30 days of April 2026.  
   Status: No current paying customers. Phase 2 render layer + Netlify Function endpoint is the remaining blocker.

5. **Record VSL**  
   Homepage video placeholder needs real content.  
   Status: Not started.

## Known Issues (Non-Urgent)

- **Inbound email needs troubleshooting** — MX records are live in Netlify but confirmation emails to hello@signallogicsystems.com are not arriving (e.g. GitHub). Likely Google Workspace quarantine or spam filter setting. Revisit after first customer.

## Next Actions

- Build `lib/render/report-builder.js` and `lib/render/sections/` — port Phase 1 dashboard.js render functions to produce a self-contained HTML report from the analyze-job-flow metrics object
- Build `netlify/functions/process.js` — wire hmac → ingest → normalize → analyze → render end to end
- Test the full pipeline against the Midwest Precision Fabricating demo CSV and verify byte-compatibility with Phase 1 output
- Begin outreach to manufacturing consulting firms (separate from AMEND)
- Record VSL for homepage

## Scheduling Context (for schedule-planner agent)

- Office days (before May 12): Mon, Wed, Fri
- Office days (May 12+, permanent): Mon, Thu, Fri
- WFH days with baby: remaining days
- Best call windows: early AM on WFH days (before 7:30am)
- Remote desktop available during office day downtime — amber tasks only
