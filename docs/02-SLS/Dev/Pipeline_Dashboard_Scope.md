# Pipeline Dashboard — Contact History Enhancement
*SLS Lead Gen Dashboard — Build Scope*
*Written: May 19, 2026*

---

## Background

The current dashboard renders lead cards from CSV import with the following
working functionality:
- Company card with contact name, title, phone, email, LinkedIn
- Pipeline stage selector (FRESH → CALL1 → CALL2 → CALL3 → EMAIL1 →
  EMAIL2 → EMAIL3 → DM1 → DM2 → MEETING_SET → PROPOSAL →
  CLOSED_WON → CLOSED_LOST)
- Touch counter per card
- "vs 500 max" progress indicator

What it does NOT yet do:
- Store or display a history of individual touches per company
- Accept notes tied to a specific touch (date, method, what was said,
  next action)
- Surface that history inside the card detail view

---

## Scope of Changes

### 1. Touch History Data Model

Each company card needs a `touches` array alongside its existing fields.
Each entry in the array represents one outreach event.

**Touch object structure:**
```
{
  date: "YYYY-MM-DD",
  type: "CALL" | "EMAIL" | "DM" | "MEETING" | "OTHER",
  contact: "Name of person reached or attempted",
  outcome: "Connected" | "Voicemail" | "No answer" | "Replied" |
           "No reply" | "Meeting booked" | "Other",
  notes: "Free text — what was said, what was learned, any commitments made",
  next_action: "What needs to happen next",
  next_action_date: "YYYY-MM-DD or blank"
}
```

---

### 2. CSV Import Enhancement

The current CSV import creates cards from flat row data. It needs to be
extended to also ingest the activity log rows from the pipeline CSV format
(the multi-row-per-company format used in SLS_Pipeline.csv).

**Logic:**
- Rows with the same Company name are grouped together
- The first/most recent row populates the card header fields
  (contact, phone, email, stage, next action)
- All rows for that company are ingested as individual touch history entries
- Duplicate detection: if a touch with the same date + type already exists
  for that company, skip it rather than creating a duplicate on re-import

**CSV columns that map to touch history:**
```
Last_Touch_Date     → touch.date
Last_Touch_Type     → touch.type
Last_Touch_Notes    → touch.notes
Next_Action         → touch.next_action
Next_Action_Date    → touch.next_action_date
```

---

### 3. Card Detail Panel — History Tab

The card detail panel (the expanded view when you click a card) currently
shows company overview and pipeline stage selector. Add a **History tab**
alongside the existing view.

**History tab layout:**
- Chronological list of all touches, newest first
- Each entry shows:
  - Date + type badge (color-coded: CALL = green, EMAIL = gold,
    MEETING = blue, DM = purple)
  - Contact name reached
  - Outcome badge
  - Notes (full text, expandable if long)
  - Next action + date (if set)
- Empty state: "No touches logged yet. Add the first one below."

---

### 4. Add Touch — Inline Form

At the bottom of the History tab, a simple inline form to log a new touch
without leaving the card.

**Fields:**
- Date (defaults to today)
- Type (dropdown: CALL / EMAIL / DM / MEETING / OTHER)
- Contact reached (text, pre-fills from card contact name)
- Outcome (dropdown)
- Notes (textarea)
- Next action (text)
- Next action date (date picker, optional)
- Save button

On save:
- Entry is prepended to the history list
- Touch counter on the card increments
- Stage selector advances suggestion: if type was CALL and current
  stage is FRESH, suggest moving to CALL1 (don't auto-advance,
  just prompt)
- Data persists to localStorage (current storage layer)

---

### 5. Stage Advancement Tied to History

Currently the stage is changed by clicking a stage button manually.
This stays, but add a lightweight link between logging a touch and
stage advancement:

- After saving a touch, show a prompt: "Advance stage to [next stage]?"
  with Yes / Stay buttons
- This keeps manual control while reducing friction for the common path

---

### 6. Next Action Surface on Card Face

The card face (the kanban-style card in the main view) should surface
the next action and date if one is set, so you can see what needs to
happen without opening the card.

**Add to card face (below stage badge):**
```
NEXT: Follow up if no response by May 28
```
If overdue (next action date < today), highlight in gold.

---

### 7. Export Enhancement

The existing CSV export (if present) or a new export function should
write out the full touch history per company, not just the current
card state — matching the multi-row format of SLS_Pipeline.csv so
the file stays importable and the data is portable.

---

## Data Storage

All of the above uses **localStorage** as the current data layer —
no new dependencies required for this build. The touch history array
is stored as part of the existing company record JSON object.

When the Node.js + Google Sheets backend is built out, the touch
history model defined here translates directly to a Sheets tab or
database table with no structural changes needed.

---

## Out of Scope (This Build)

- Server-side storage or sync (deferred to Node.js backend phase)
- Email sending from within the dashboard
- Automated reminders or notifications
- Multi-user access

---

## Files Affected

```
pipeline-dashboard/
  ├── index.html        — add History tab to card detail panel
  ├── dashboard.js      — touch data model, CSV import logic,
  │                       add-touch form, stage prompt, next action display
  └── style.css         — touch history list styles, type badges,
                          outcome badges, next action highlight
```

---

## Definition of Done

- [ ] CSV import groups multi-row company data into touch history correctly
- [ ] Card detail panel has a History tab showing all touches chronologically
- [ ] Add Touch form saves to localStorage and increments touch counter
- [ ] Stage advancement prompt appears after logging a touch
- [ ] Next action + date visible on card face, highlighted if overdue
- [ ] Export writes full touch history in multi-row CSV format
- [ ] All existing card functionality (stage selector, contact info,
      phone/email buttons) unchanged

---

*This scope feeds directly into the Node.js backend build — the data
model defined here is the schema for the Google Sheets pipeline tab.*
