@docs/business-context.md

# Signal Logic Systems LLC

**Owner:** Caleb Malcolm — Principal Systems Analyst, Ohio  
**Status:** Pre-revenue, active development  
**Tagline:** Turn operational chaos into clear, actionable signals.

---

## Architecture Principles

**Hold the calculator.** The processing engine never goes to the client.
Client sends CSV → SLS engine runs diagnostics → client gets a report.
Raw data is never stored. The engine is never handed over. This protects
IP, justifies recurring monthly fees, and limits liability.

**Service model, not software license.** Governed by SOW + MSA.
Snapshot-based derived metrics only. Retained 60 days, deleted on termination.

---

## Current Priorities (April 2026)

1. Deploy website — switch DNS from Lovable to Netlify
2. Build Job Flow Monitor processing engine (CSV in → diagnostic report out)
3. Follow up with AMEND Consulting; begin broader outreach
4. Land first paying customer (30-day target)
5. Record VSL for homepage video placeholder

---

## Product Suite

| Tool | Status | Description |
|------|--------|-------------|
| Job Flow Monitor | MVP demo built, engine needed | Constraint ID, revenue at risk, cascade analysis |
| PO Tracking & Follow-Up | Planned | Lead time monitoring, automated supplier follow-up |

---

## Brand

- **Colors:** Gold `#F4C542` on black `#0E0E10`. Cards `#141418`, borders `#2B2F36`.
- **Type:** Rajdhani (headings), Inter (body)
- **Tone:** Confident, direct, industrial. B2B. Not startup-y.

---

## Key Files

- `signallogicsystems-site/` — Static site (HTML/CSS/JS), deployed to Netlify
- `assets/` — Logo (horizontal) and app icon (square), both on transparent background
- `docs/business-context.md` — Full business context, model, strategy
- `docs/priorities.md` — Current priority list with statuses
- `docs/outreach-log.md` — Prospect and partner contact log
