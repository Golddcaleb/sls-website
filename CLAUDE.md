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

1. Build Job Flow Monitor processing engine (CSV in → diagnostic report out)
2. Begin outreach to manufacturing consulting firms and direct prospects
3. Land first paying customer (30-day target)
4. Record VSL for homepage video placeholder

> Note: Website deployment to Netlify is complete. AMEND Consulting outreach is on hold indefinitely.

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

## Agents

Subagent skill files live in `.claude/agents/`. Load the relevant one when the task matches.

| Agent | Trigger | Description |
|-------|---------|-------------|
| `schedule-planner` | "start my session", "what should I work on", any scheduling question | Daily briefing: current time block, urgent items, suggested 1-2 hr task list. Reads priorities.md and outreach-log.md. |
| `site-builder` | Any HTML/CSS/JS work on the website | Scoped to `signallogicsystems-site/`. Enforces SLS brand system. |
| `business-writer` | Proposals, SOWs, outreach emails, planning docs | Write access to `docs/` only. SLS tone: confident, direct, industrial. |
| `researcher` | Market research, competitor intel, prospect background | Returns structured summaries with Key Findings, Relevance to SLS, Suggested Actions. |
| `session-closer` | End of any working session | Summarizes session, updates priorities.md, stages and commits to git. |

---

## Key Files

- `signallogicsystems-site/` — Static site (HTML/CSS/JS), deployed to Netlify
- `assets/` — Logo (horizontal) and app icon (square), both on transparent background
- `docs/business-context.md` — Full business context, model, strategy
- `docs/priorities.md` — Current priority list with statuses
- `docs/outreach-log.md` — Prospect and partner contact log
- `docs/jfm-architecture.md` — Full JFM processing engine architecture and build plan
- `sample-data/` — Demo CSVs for sales demos (gitignored)
