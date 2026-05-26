# PO Tracker

**Status:** MVP built, awaiting first customer onboarding *(2026-05-26)*
**Target:** Procurement teams, ops managers, supply chain

## The Problem
ERP systems track PO data but don't proactively communicate. Manufacturers chase suppliers manually and find out about delays after it's too late to avoid expedited shipping costs.

## What It Does
- Bulk-ingests open purchase orders via CSV export → customer's SharePoint tracking list
- Monitors the procurement inbox in realtime via Graph webhook; parses vendor replies for PO #, status, ship dates
- Stage 1 / Stage 2 timer logic: chases acknowledgements, then chases ship dates; respects per-PO overrides
- Detects when the longest-lead-time item on a job shifts (the new bottleneck), bucketed by severity
- Sends follow-ups + alerts through the customer's own Outlook mailbox (never an SLS sender)
- Four-panel web dashboard (Settings / Active Jobs / Email Queue / Constraint Alerts) reads live from the customer's SharePoint
- Auto-send toggle: send automatically, or queue every outbound for human review

## Architecture
**Hold-the-calculator boundary:** every customer's tracking state lives in their own M365 tenant (SharePoint + Outlook via Graph API). SLS infrastructure stores no PO data. Raw vendor email content is parsed in memory and discarded; only structured envelopes cross the tenant boundary.

Uses the same modular backend as JFM → [[JFM Backend Architecture]]
- Schema: `lib/normalize/schemas/purchase-orders.js`
- Analyze: `lib/analyze/po-tracking/` (`lead-time.js`, `constraint-shift.js`, `follow-up-triggers.js`)
- Graph integration: `lib/integrations/graph-api/` (auth, inbox-monitor, email-parser, email-sender, sharepoint-reader, sharepoint-writer)
- Netlify Functions: `process.js` (po-tracking CSV ingest case), `graph-webhook.js`, `onboard-customer.js`, `po-api.js`, `renew-subscriptions.js` (daily cron)
- Dashboard: `signallogicsystems-site/po-dashboard.{html,js}`

Full architecture spec lives at [[PO Tracker Architecture]].

## Why Blue Ash Needs This
Their three-system environment (Proper 21 / Matrix / CribMaster) means POs fall through the cracks between systems. They regularly pay expedited shipping fees for items that weren't flagged as at-risk early enough. → [[Blue Ash Industrial Supply]]

## Build / Deploy
Built and deployed end-to-end in a single session on 2026-05-26 (PM-2). Commits `4da2756`, `907f76e` (merge), `ca1211b` (renewer), `5eeb284` (CLAUDE.md status refresh). Live on `signallogicsystems.com` via Netlify `main` branch.

## Next Step Before First Use
Customer must (1) create an M365 app registration with `Mail.Read`, `Mail.Send`, `Sites.ReadWrite.All` (Application permissions, admin-consented), (2) provide tenant ID + client ID + secret, (3) SLS admin calls `/.netlify/functions/onboard-customer`, pastes the returned env-var block into Netlify settings, redeploys.
