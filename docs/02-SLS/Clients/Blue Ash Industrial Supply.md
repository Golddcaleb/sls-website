# Blue Ash Industrial Supply

**Type:** Tooling/supply distributor
**Location:** 6909 Cornell Rd, Cincinnati, OH 45242
**Website:** blueashsupply.com
**Status:** 🔥 Active — exports requested, Phase 1 build pending

---

## Contact

| Field | Info |
|-------|------|
| Name | Travis Thompson |
| Title | Systems Analyst / Integration Support |
| Phone | (734) 474-7730 (cell) · (513) 530-0188 (office) · (513) 605-2415 (direct) |
| Email | tthompson@blueashsupply.com |

**Note:** Matt (last name unknown) made the introduction but is not the decision-maker. All engagement goes through Travis.

---

## Their Systems

| System | Role |
|--------|------|
| Proper 21 | Invoicing/sales side — main ERP, all transactions recorded |
| Matrix | Receiving/warehouse side — vending machine inventory (60–70% of revenue) |
| CribMaster | Inventory dispensing (vending-style) — smaller scale, one customer |

Three disconnected systems with no automated reconciliation between them. Data storage is per-person OneDrive; collaboration via Teams and Monday.com.

**Matrix export formats available:** Mobile (html), PDF, TXT, XLS, XLS (html), XLSX, XML
**Agreed format:** XLSX

---

## Their Pain

**Immediate (Phase 1 target):**
Monthly ship-vs-invoice reconciliation is done manually. Travis compares Matrix receipts against Proper 21 invoices line-by-line, flagging quantity and price mismatches. Currently 4–6 hours/month of eyes-on-screen work. Leads to missed discrepancies, wasted time, and downstream billing issues.

The Proper 21 invoice report is a live Excel query sheet — user sets filters, refreshes, and it outputs a table. Travis will save a snapshot and send the raw file.

**Longer term (Phase 2+):**
No PO tracking means items aren't flagged as constraints until it's too late to order at standard shipping rates, causing expedited freight costs. Replenishment min/max levels are calculated separately in Matrix and Proper 21 and manually reconciled. No single view across all three systems.

---

## Proposed Engagement

### Phase 1: Ship-vs-Invoice Reconciliation
**Status:** ⏳ Awaiting exports from Travis
**Setup Fee:** $750
**Monthly Fee:** $175/mo
**Timeline:** 2–3 weeks from receipt of exports

**Deliverable:** SLS ingests Matrix receipts (XLSX) + Proper 21 invoices (XLSX/CSV) → returns one-page reconciliation report flagging mismatches (quantity wrong, price wrong, item missing). Drops from 4–6 hours/month to ~15 minutes.

**Build notes:**
- Must handle XLSX input (SheetJS) in addition to CSV (PapaParse)
- Raw/messy export is fine — tool handles normalization
- Good proof-of-concept for the inventory/reconciliation module of the SLS backend architecture

**Phase 1 checklist:**
- [x] Confirm Phase 1 scope at lunch (May 12)
- [x] Send follow-up email + MSA (May 13)
- [x] Follow-up call — confirmed exports coming (May 19)
- [x] Confirm export format — XLSX agreed (May 19)
- [ ] Receive Matrix receipts XLSX from Travis
- [ ] Receive Proper 21 invoices export from Travis
- [ ] Confirm exports are usable, clarify any field questions
- [ ] Build Phase 1 demo (~2 weeks)
- [ ] Schedule demo call (Tuesday or Thursday)
- [ ] Demo call — walk Travis through live output on his own data
- [ ] Get MSA signed
- [ ] Go-live
- [ ] Measure time saved vs. baseline

**Expected Year 1 Revenue (Phase 1):** $750 setup + ($175 × 12) = $2,850

---

### Phase 2: PO Tracking + Lead Time Monitoring
**Status:** Planned — after Phase 1 success
**Setup Fee:** $2,000
**Monthly Fee:** $400/mo
**Timeline:** 4–6 weeks after Phase 1 go-live

**Deliverable:** Monitor open POs from Proper 21, flag items approaching or past promised delivery dates, highlight constraint items (longest lead times), auto-draft supplier follow-up emails. Prevents expedited freight costs.

**Expected Year 1 Revenue (Phase 2):** $2,000 setup + ($400 × 12) = $6,800

---

### Phase 3: Unified Dashboard
**Status:** Planned — after Phase 2 success
**Setup Fee:** $3,500
**Monthly Fee:** $750/mo
**Timeline:** 8–12 weeks after Phase 2 go-live

**Deliverable:** Single dashboard across all three systems — stock levels, items used across customers, replenishment status, supplier on-time metrics, price change tracking.

**Expected Year 1 Revenue (Phase 3):** $3,500 setup + ($750 × 12) = $12,500

---

## Total Opportunity

**Setup fees (all phases):** $6,250
**Annual recurring (all phases):** ~$15,900/yr
**Year 1 total (all phases):** ~$22,150

---

## Timeline

| Date | Milestone | Status |
|------|-----------|--------|
| May 12, 2026 | Lunch meeting at MadTree Parks & Rec | ✅ Done |
| May 13, 2026 | Follow-up email sent + MSA attached | ✅ Done |
| May 19, 2026 | Follow-up call — Travis confirmed exports coming | ✅ Done |
| May 19, 2026 | Travis confirmed XLSX as export format | ✅ Done |
| TBD | Receive exports (Matrix + Proper 21) | ⏳ Pending |
| TBD + 2 days | Confirm exports usable, schedule demo call | ⏳ Pending |
| TBD + 14 days | Phase 1 demo complete | ⏳ Target |
| TBD + 17 days | Demo call with Travis | ⏳ Target |
| TBD + 21 days | Phase 1 go-live | ⏳ Target |

---

## Call & Interaction Log

### May 19, 2026 — Export Format Email
Travis sent Matrix export format options. Replied recommending XLSX. Also nudged him to send Proper 21 export at the same time.

### May 19, 2026 — Follow-up Call
Travis had the original email sitting unread as a marker — not ignoring, just covering for 3 people out of the office. Confirmed ship-vs-invoice reconciliation is still the right first build. Clarified that the Proper 21 invoice report is a live Excel query sheet (not static CSV). Reassured him raw/messy exports are fine. He will send both files when ready. Confirmed Tuesdays and Thursdays are best days.

### May 13, 2026 — Follow-up Email
Sent Phase 1 proposal, MSA attached, requested two exports (Matrix receipts + Proper 21 invoices), proposed Tuesday/Thursday follow-up call.

### May 12, 2026 — Lunch Meeting (MadTree Parks & Rec)
~90 minutes. Matt (introducer) + Travis attended. Identified ship-vs-invoice reconciliation as first build. Travis confirmed "I just want to drop a file and have it tell me what to do." Demonstrated JFM demo. Discussed security model (in-memory, zero retention, encrypted). Travis very engaged on systems/optimization. Agreed on phased approach.

---

## Docs & Resources

- `SLS_Master_Services_Agreement.docx` — attached to May 13 email, pending signature
- `blue_ash_followup_email.md` — sent email template
- `blue_ash_meeting_analysis.md` — full strategic analysis
- Otter.ai transcripts — lunch meeting + May 19 call saved
- Travis business card photo — in phone

---

## Notes

- Travis is a systems analyst with 10 years at Blue Ash — he gets it quickly, no hand-holding needed on the technical model
- Three-system environment means multi-file ingest is a requirement from day one — informs SLS backend modular design
- 12+ years of historical data in Proper 21 — future analytics opportunity but not a near-term priority
- Family-owned business — relationships matter, showing up matters (per Matt's guidance on their culture)
- Pricing is conservative relative to value: Phase 1 alone saves ~$250/month in labor at $175/month cost

---

*Last updated: May 19, 2026*
