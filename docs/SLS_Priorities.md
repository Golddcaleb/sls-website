# SLS Priorities
*Last updated: May 19, 2026*

## Immediate
- [ ] **Customer-facing upload UI** — build `submit.html` + HMAC-signing helper so Travis (and JFM prospects) don't have to hand-sign requests. Tool selector sets `X-SLS-Tool`; file-field shape switches by tool (one `jobs` field for JFM, `matrix` + `proper21` for ship-vs-invoice)
- [ ] **`SLS_SECRET_BLUEASH` env var** — set in Netlify dashboard before first real Blue Ash submission
- [ ] **Backend unit tests** — dedicated tests for `render/job-flow`, `render/inventory/ship-vs-invoice`, `analyze/inventory/ship-vs-invoice`, and `parse-multipart` (assert section/class presence, not HTML snapshots)
- [ ] **SOW/MSA legal gaps** — blank placeholders, section numbering, consequential damages exclusion, confidentiality survival clause
- [ ] **Stripe activation** — finalize pricing config
- [ ] **Google Business Profile** — verification still in progress

## In Progress
- [ ] **Blue Ash Phase 1 demo** — awaiting Matrix receipts + Proper 21 invoices from Travis → [[Blue Ash Industrial Supply]]

## Done
- [x] Website live at signallogicsystems.com
- [x] Google Workspace email routing confirmed
- [x] Calendly booking link live
- [x] JFM Phase 1 (browser-based demo engine) complete
- [x] Pricing finalized (four tiers)
- [x] SOW + MSA drafted
- [x] Stripe account set up
- [x] Phone scripts built
- [x] Blue Ash follow-up email sent (May 19)
- [x] Blue Ash follow-up call completed (May 19) — exports confirmed coming
- [x] JFM Phase 2 backend complete (ship-vs-invoice pipeline end-to-end)
- [x] Netlify env var `SLS_SECRET_BLUEASH` set
- [x] JFM render port — `lib/render/job-flow/job-flow.js` composer built, `case 'job-flow'` wired into `process.js` (May 19)
- [x] JFM Phase 2 backend functionally complete — both tools (ship-vs-invoice + job-flow) ingest → normalize → analyze → render end-to-end (May 19)

## On Hold
- AMEND Consulting — re-engaged May 19 via voicemail, awaiting callback → [[AMEND Consulting]]

## Backlog
- Record VSL for homepage
- Complete Google Sheets + Node.js backend (replace localStorage)
- Node.js lead pipeline backend
- Notion CRM build-out
- Self-hosted Cal.com (replace Calendly)

## Next Actions
1. Claude Code: `submit.html` + HMAC-signing helper (customer-facing upload UI)
2. Set `SLS_SECRET_BLUEASH` in Netlify dashboard
3. Add backend unit tests (render composers + parse-multipart)
4. Receive Travis's exports → confirm usable → schedule demo call (Tue/Thu)
5. SOW/MSA legal fixes before Blue Ash goes live
6. Stripe activation
