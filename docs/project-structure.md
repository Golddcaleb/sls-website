# SLS Project Structure

*Last updated: April 2026*

---

## Folder Layout

```
sls-project/
├── .claude/
│   └── agents/
│       ├── site-builder.md
│       ├── business-writer.md
│       ├── researcher.md
│       └── session-closer.md
├── assets/
│   ├── SignalLogic Systems Logo.png
│   └── SignalLogic Systems App icon no backround.png
├── docs/
│   ├── business-context.md
│   ├── outreach-log.md
│   ├── priorities.md
│   └── project-structure.md
├── signallogicsystems-site/
│   ├── index.html
│   ├── how-it-works.html
│   ├── solutions.html
│   ├── get-started.html
│   ├── style.css
│   ├── main.js
│   ├── _headers
│   ├── signallogicsystems-logo.png
│   └── signallogicsystems-icon.png
├── .gitignore
└── CLAUDE.md
```

---

## Subagents

### site-builder
Builds and edits the Signal Logic Systems website. Scoped to `signallogicsystems-site/` only. Knows the full SLS brand system (colors, typography, tone) and enforces visual consistency. No external dependencies — the site is intentionally static HTML/CSS/JS.

**Tools:** Read, Write, Edit, Bash

---

### business-writer
Drafts client-facing and internal documents: proposals, SOWs, outreach emails, and planning docs. Writes in the SLS voice — confident, direct, industrial, B2B. Write access is limited to `docs/`; read-only everywhere else.

**Tools:** Read, Write

---

### researcher
Performs web research on manufacturing operations, competitors, consulting firms, and market signals. Returns findings as structured summaries with Key Findings, Relevance to SLS, Suggested Actions, and Sources sections.

**Tools:** Read, WebSearch, WebFetch

---

### session-closer
End-of-session routine. Summarizes what was accomplished, updates `docs/priorities.md` to reflect current state, then stages and commits all changes to git. Run this at the end of any working session.

**Tools:** Read, Write, Bash
