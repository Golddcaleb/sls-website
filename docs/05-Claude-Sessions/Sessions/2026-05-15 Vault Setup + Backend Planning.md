# Session: 2026-05-15 — Obsidian Vault Setup + SLS Backend Planning

## Goals
1. Build Obsidian vault structure
2. Plan modular JFM backend architecture
3. Draft Blue Ash follow-up email for Monday May 19

## What Was Built / Decided
- ✅ Full Obsidian vault structure designed and content written
- ✅ Modular backend architecture planned (lib/auth, lib/ingest, lib/normalize, lib/analyze, lib/render)
- ✅ Decision: start with lib/auth/hmac.js and lib/ingest/parse-csv.js as shared infrastructure
- ✅ Blue Ash confirmed as first engagement: ship-vs-invoice reconciliation, Phase 1 at $750 setup / $175/mo
- ✅ Decision: stop pursuing local LLM on Proxmox, run on Claude subscription instead
- ✅ Vault sync strategy: Google Drive folder recommended as starting point

## Left for Later
- Actually scaffold the backend files in Claude Code
- Blue Ash follow-up email (draft in this session or next)
- SOW/MSA legal gap fixes
- Stripe activation

## Next Session Should Start With
- Open Claude Code from `sls-project/` via `start-sls.bat`
- Create the folder structure: `netlify/functions/` and `lib/`
- Build `lib/auth/hmac.js` first, then `lib/ingest/parse-csv.js`
- Reference [[JFM Backend Architecture]] for the full folder map
