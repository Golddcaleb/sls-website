# Dev Backlog
*SLS — Things to build when there is time*
*Last updated: May 19, 2026*

---

## Obsidian ↔ Claude Project Sync

**Problem:**
SLS context currently lives in three separate places:
- Obsidian vault (`02-SLS/`)
- Claude Project (uploaded .md files)
- `sls-project/docs/` (Claude Code context files)

Updating one requires manually updating the others. As the vault grows
this becomes a real maintenance burden and creates version drift between
the three sources.

**Goal:**
One source of truth. Update a note once, everything stays current.

**Options to evaluate:**

Option A — Point Obsidian vault at `sls-project/docs/`
- Move or symlink the `02-SLS/` Obsidian folder to live inside
  `sls-project/docs/`
- Claude Code already reads from `docs/` so it picks up changes
  automatically
- Claude Project files still need manual re-upload but at least
  Obsidian and Claude Code are in sync
- Lowest effort, works today

Option B — Git-tracked Obsidian vault
- Make the Obsidian vault a subfolder of the `sls-project/` repo
- All note changes are tracked by git and committed alongside code changes
- Claude Code reads the same files Obsidian writes
- Claude Project re-upload still manual but the file is always
  current on disk
- Medium effort, cleanest long-term structure

Option C — Auto-sync script
- Write a small Node.js or batch script that watches the Obsidian
  vault for changes and copies updated files to `sls-project/docs/`
- Could also auto-trigger a Claude Project API update if Anthropic
  exposes that endpoint
- Most automated but most build time — probably overkill until
  the vault is larger

**Recommended approach:** Start with Option A or B. Pick one vault
location, make it the canonical source, and stop maintaining duplicates.
Claude Project re-uploads will still be manual but at least it's
one copy on disk instead of three.

**Files affected:**
- `sls-project/docs/` — becomes the canonical home for all .md context
- Obsidian vault path — may need to be redirected or merged
- `CLAUDE.md` — update `@docs/` references if folder structure changes

---

## Pipeline Dashboard — Contact History
→ See `Pipeline_Dashboard_Scope.md` for full detail

**Summary:** Add touch history layer to each lead card. Log individual
contacts with date, type, outcome, notes, and next action. Surface
next action on card face. Tie stage advancement to touch logging.

---

## Node.js + Google Sheets Backend
Replace the current localStorage pipeline dashboard with a proper
backend. Google Sheets as the data layer, Node.js as the API layer.

**Unlocks:**
- Pipeline data accessible from any device
- Feeds into future Notion CRM sync
- Removes the localStorage limitation on the dashboard

---

## Notion CRM Build-Out
Build the Notion sales-stage CRM with three databases:
- Prospects & Pipeline
- Partners & Referrals
- Snapshot Requests Log

Currently placeholder — needs proper schema and views built.

---

## Self-Hosted Cal.com (Replace Calendly)
Replace Calendly with self-hosted Cal.com on Proxmox.
- Eliminates monthly Calendly cost at scale
- Full control over booking data
- Requires Proxmox container setup

Dependency: Twingate/Proxmox connector deployment needs to be
resolved first.

---

## VSL — Homepage Video
Record and edit the homepage video placeholder.
- Script not yet written
- Placeholder exists on site but has no content
- Low priority until first 2-3 clients are landed and there
  are real outcomes to reference

---

*Add new items here as they come up. Keep the Pipeline Dashboard
Scope and JFM Backend Architecture as separate dedicated files —
this backlog is for smaller or future items that don't yet have
their own scope doc.*
