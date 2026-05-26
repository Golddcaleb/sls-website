# SLS Priorities
*Last updated: May 26, 2026 (PM-2)*

## Immediate
- [ ] **First PO Tracker customer onboarding** — when the first customer commits, work them through M365 app registration (`Mail.Read`, `Mail.Send`, `Sites.ReadWrite.All`), call `/.netlify/functions/onboard-customer`, paste returned env vars into Netlify, redeploy. Then verify the Graph webhook fires and the dashboard reads back live → [[PO Tracker]]
- [ ] **Receive fresh Matrix + Proper 21 exports from Travis** once Blue Ash / DRT owner meeting is arranged — run a clean reconciliation report for that presentation → [[Blue Ash Industrial Supply]]
- [ ] **Text Aaron Satterfield** — confirm Derek intro email went out; follow up by call May 30 if no response → [[DXP_Enterprises_Inc]]
- [ ] **Await DXP intro email** — reply same day once it lands, propose 20–30 min call with Derek → [[DXP_Enterprises_Inc]]
- [ ] **Backend unit tests** — dedicated tests for `render/job-flow`, `render/inventory/ship-vs-invoice`, `analyze/inventory/ship-vs-invoice`, and `parse-multipart` (assert section/class presence, not HTML snapshots)
- [ ] **Repo structure cleanup** — two competing git repos for the same code (parent at `02-SLS/sls-project/` and nested at `signallogicsystems-site/`); pick a source of truth, retire the other. Also delete the root-level `submit.html`/`submit-jfm.html` shadows in the nested repo and restore the parent's `signallogicsystems-site/` working tree after the May 20 reset
- [ ] **SOW/MSA legal gaps** — blank placeholders, section numbering, consequential damages exclusion, confidentiality survival clause
- [ ] **Stripe activation** — finalize pricing config
- [ ] **Google Business Profile** — verification still in progress

## In Progress
*(nothing currently in-flight — see Immediate for next moves)*

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
- [x] **Blue Ash Phase 1 demo call** — walked Travis through the live ship-vs-invoice report on his real DRT data. Travis confirmed "that looks much better" and "I think we took a big step today." Forwarding to Terry at DRT, arranging owner intro meeting (May 26) → [[Blue Ash Industrial Supply]]
- [x] **Identity-mismatch detection** — surfaces lines where PO + qty + unit price agree but item codes differ (SPOTBUY placeholder ↔ real supplier part). Dropped unmatched count on the DRT run from 17 → 11. Live on production (May 26)
- [x] **PDF export landscape fix** — `@page { size: landscape }` + fixed table layout in `lib/render/report-builder.js` so the wider tables (identity mismatches, unmatched, matches) keep all columns inside the printable area (May 26)
- [x] **Submit page file auto-detection** — backend detects Matrix vs Proper 21 from column header signatures and swaps internally if the user dropped them in the wrong zones (May 26)
- [x] **PO Tracker MVP — full build + production deploy** — second SLS product live end-to-end: per-customer Graph API integration (auth, inbox monitor, email parser/sender, SharePoint reader/writer), processing engine (lead-time, constraint-shift, follow-up triggers w/ Stage 1+2 templates), onboarding endpoint, dashboard with Settings/Jobs/Queue/Alerts panels, daily webhook-subscription renewer. 16 new files + `process.js` po-tracking case. Customer data never touches SLS infra — all state lives in the customer's M365 tenant. Commits `4da2756`, `907f76e` (merge), `ca1211b`. Deployed to `main@ca1211b` via Netlify (May 26 PM) → [[PO Tracker]]

## On Hold
- AMEND Consulting — re-engaged May 19 via voicemail, awaiting callback → [[AMEND Consulting]]

## Backlog
- Record VSL for homepage
- Complete Google Sheets + Node.js backend (replace localStorage)
- Node.js lead pipeline backend
- Notion CRM build-out
- Self-hosted Cal.com (replace Calendly)

## Next Actions
1. Confirm Derek (DXP) intro email landed — text Aaron Satterfield; call by May 30 if silent
2. Reply same-day to Derek's intro once it arrives — propose 20–30 min call
3. Receive fresh Matrix + Proper 21 exports from Travis ahead of Blue Ash / DRT owner meeting; run clean reconciliation report for presentation
4. Open PO Tracker conversation with first interested customer (likely Blue Ash if they bite, or whoever surfaces via DXP intro). Trigger: customer commits → run onboarding flow
5. Repo structure cleanup (nested git repos, root-level submit.html shadows, parent working-tree restore)
6. Add backend unit tests (render composers + parse-multipart, plus new PO tracker analyzers)
7. SOW/MSA legal fixes before Blue Ash goes live
8. Stripe activation
