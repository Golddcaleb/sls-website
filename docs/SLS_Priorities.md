# SLS Priorities
*Last updated: May 20, 2026*

## Immediate
- [ ] **Backend unit tests** — dedicated tests for `render/job-flow`, `render/inventory/ship-vs-invoice`, `analyze/inventory/ship-vs-invoice`, and `parse-multipart` (assert section/class presence, not HTML snapshots)
- [ ] **Repo structure cleanup** — two competing git repos for the same code (parent at `02-SLS/sls-project/` and nested at `signallogicsystems-site/`); pick a source of truth, retire the other. Also delete the root-level `submit.html`/`submit-jfm.html` shadows in the nested repo and restore the parent's `signallogicsystems-site/` working tree after the May 20 reset
- [ ] **SOW/MSA legal gaps** — blank placeholders, section numbering, consequential damages exclusion, confidentiality survival clause
- [ ] **Stripe activation** — finalize pricing config
- [ ] **Google Business Profile** — verification still in progress

## In Progress
- [ ] **Blue Ash demo call** — awaiting Travis's corrected date-matched Matrix + Proper 21 exports (May 20 smoke run hit 0% match because the two files covered different months, not a pipeline bug) → [[Blue Ash Industrial Supply]]

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
- [x] **Customer-facing upload UI** — unified `submit.html` portal: tool selector, Customer ID + paste-key, localStorage credential persistence with Forget link, client-side HMAC-SHA256 via Web Crypto, morphing drop zones, inline status panel (May 20)
- [x] **HMAC key derivation aligned** — server-side `lib/auth/hmac.js` and the new client both treat the secret as a UTF-8 string, not a hex-decoded byte buffer (May 20)
- [x] **End-to-end production submission verified from the new portal UI** — 200 OK in 1,838 ms with a real Blue Ash payload against the deployed Netlify function (May 20)

## On Hold
- AMEND Consulting — re-engaged May 19 via voicemail, awaiting callback → [[AMEND Consulting]]

## Backlog
- Record VSL for homepage
- Complete Google Sheets + Node.js backend (replace localStorage)
- Node.js lead pipeline backend
- Notion CRM build-out
- Self-hosted Cal.com (replace Calendly)

## Next Actions
1. Follow up with Travis on corrected date-matched exports → re-run production smoke → schedule demo call (Tue/Thu)
2. Repo structure cleanup (nested git repos, root-level submit.html shadows, parent working-tree restore)
3. Add backend unit tests (render composers + parse-multipart)
4. SOW/MSA legal fixes before Blue Ash goes live
5. Stripe activation
