# Signal Logic Systems LLC — Master Business Context Document
*Last updated: April 2026*

---

## 1. Company Overview

**Company:** Signal Logic Systems LLC
**Owner/Operator:** Caleb Malcolm
**Title:** Principal Systems Analyst
**Location:** Ohio, USA
**Status:** Pre-revenue, active development
**Structure:** Solo operation

**Contact:**
- Email: hello@signallogicsystems.com
- Phone: (330) 303-6511
- Website: signallogicsystems.com

**Tagline:** Turn operational chaos into clear, actionable signals.

---

## 2. Founder Background

Caleb is a degreed Engineering and Technology Management 
professional currently working at a pump repair shop as an 
engineer focused on reverse engineering, modeling, and drafting 
parts with long lead times or discontinued OEM availability.

This role has provided direct, firsthand exposure to:
- Manufacturing operations and their inefficiencies
- The gap between what ERP systems track and what companies 
  actually use that data for
- How small and mid-size manufacturers operate day-to-day
- Real procurement and lead time challenges

Additional background includes sales experience and systems 
experience, which directly informs both the product design 
and the go-to-market approach.

**Why this matters for positioning:** Caleb is not a 
consultant who studied manufacturing from the outside. He 
works inside a manufacturing environment daily and built 
SLS to solve problems he observes firsthand. That credibility 
is a differentiator when talking to prospects.

---

## 3. Core Business Model

SLS is a **modular operational intelligence platform** that 
provides purpose-built tools to manufacturing companies and 
the consulting firms that serve them.

### Key model principles:

**Modular / pick-and-choose:**
No forced packages. Clients select only the tools that address 
their specific operational gaps. This lowers the barrier to 
entry and creates a natural expansion path.

**Recurring revenue via retainer-style monthly fees:**
Each tool is priced with a one-time setup fee and a monthly 
service fee. The goal is to deliver enough ongoing value that 
the monthly payment is a no-brainer to continue — the client 
gets more value than they pay, Caleb gets stable recurring 
revenue with low ongoing input after initial setup.

**Caleb holds the calculator:**
Raw client data is never stored. Client sends a CSV export 
from their ERP → SLS processing engine cleans and analyzes 
it → structured output (diagnostic report, alerts, 
recommendations) is returned to the client. The client 
receives the answer, not the tool. This is intentional and 
critical for three reasons:
1. Protects SLS intellectual property
2. Eliminates the "why do I need you if I have the software" 
   objection
3. Minimizes liability and keeps insurance costs low
4. Justifies the ongoing monthly fee — they need SLS to run 
   the engine every month

**Pricing philosophy:**
Priced below traditional consulting day rates but only 
slightly — the value delivered is comparable, the model 
is more accessible, and the recurring structure makes it 
predictable for both parties. Specific pricing TBD but 
the intent is: fair, defensible, and clearly below the 
cost of the problem it solves.

---

## 4. Target Market

### Primary targets:
- Small to mid-size manufacturing companies
- Job shops and custom fabrication operations
- Manufacturing consulting firms (who use SLS tools 
  with their own clients)
- Operations managers and process improvement leads

### Ideal client profile:
- Has an ERP system but isn't fully leveraging its data
- Relies on manual processes, gut-feel decisions, or 
  boots-on-the-ground assessment
- Has visible operational pain (stalled jobs, missed 
  deadlines, supplier delays, lost POs)
- Can export CSV data from their existing system
- Values quantifiable financial impact over generic advice

### Validated market signal:
Early conversation with AMEND Consulting confirmed that 
consulting firms still rely heavily on manual, 
boots-on-the-ground analysis to identify improvement 
opportunities. This is the exact gap SLS fills.

---

## 5. Product Suite

### Tool 1: Job Flow Monitor
**Status:** MVP built, needs backend processing engine
**Target:** Manufacturing floors, job shops, ops managers

The flagship product. Ingests job/work order data exported 
from any ERP as a CSV. Processes it through the SLS 
diagnostic engine and returns:
- Constraint identification (which production stage is 
  the bottleneck)
- Revenue at risk calculation ($ value held up at 
  the constraint)
- Upstream cascade analysis (total revenue blocked, 
  not just jobs at the constraint)
- Job-level delay ranking by financial impact
- Executive-ready diagnostic report

**Current state:** Demo dashboard built (HTML/JS), 
visually complete and client-presentable. Backend 
processing engine not yet built — this is the next 
priority.

**Key architectural decision:** The processing logic 
lives on SLS infrastructure, not in client hands. 
Client sends raw CSV, gets back a structured report. 
The engine is never handed over.

---

### Tool 2: PO Tracking & Automated Follow-Up
**Status:** Planned / in development concept
**Target:** Procurement teams, ops managers, supply chain

Monitors open purchase orders and triggers follow-up 
communications when lead time constraints shift. 
Key capabilities planned:
- Longest lead time constraint monitoring
- Automatic or approval-prompted follow-up emails 
  using client-defined templates
- Supplier and customer notification logic
- Delay detection based on promised vs actual dates
- Daily digest of PO status changes

**Core insight:** ERP systems track PO data but don't 
proactively communicate. Manufacturers chase suppliers 
manually and find out about delays later than they 
should. This tool automates that follow-up loop.

---

### Future Tools (planned):
- QR-based job tracking for shop floors
- KPI dashboard builds
- Workflow orchestration
- Each tool designed to solve a specific operational 
  gap without requiring ERP replacement

---

## 6. Technology Architecture

### Current stack:
- **Website:** Static HTML/CSS/JS, hosted on Netlify
- **Domain:** signallogicsystems.com (transitioning 
  from Lovable to Netlify-hosted custom build)
- **Booking:** Calendly embedded on Get Started page
- **Dashboard demo:** HTML/JS interactive demo 
  (client-facing sales tool)
- **Documents:** Invoice, Quote, SOW, Service Proposal, 
  Pricing sheets — all templated and branded

### Processing engine (planned):
- Client exports CSV from their ERP
- CSV submitted via secure upload or email
- SLS engine processes: cleans, normalizes, runs 
  diagnostic logic
- Output returned as structured report
- Raw data never stored permanently
- Derived metrics retained 60 days for dashboard 
  continuity, deleted on termination

### Infrastructure:
- Proxmox-based homelab available for self-hosted 
  services
- Potential future use: self-hosted Cal.com, 
  processing engine hosting, internal tooling
- Claude Code used for primary development
- OpenClaw/Jarvis (local LLM system on Proxmox) 
  being evaluated for internal task management, 
  calendar automation, and Trello board management 
  — not yet integrated into SLS product

### Liability and IP protection principles:
- Never deliver the processing engine to clients
- Never store raw client data
- Snapshot-based derived metrics only
- SOW and MSA govern all engagements
- Service model (not software license model) keeps 
  liability minimal and insurance costs low

---

## 7. Brand Identity

**Visual system:**
- Primary gold: #F4C542
- Gold hover: #D4A017
- Deep gold: #B8860B
- Background black: #0E0E10
- Card black: #141418
- Border/divider: #2B2F36
- Secondary text: #B5B5BE
- Primary text: #F8F9FA

**Typography:**
- Headings: Rajdhani (Bold 600/700)
- Body: Inter (Regular 400 / Medium 500)

**Tone:** Confident, direct, industrial. 
Not startup-y. B2B professional.

**Logo assets available:**
- Full horizontal logo (dark, no background)
- App icon (square, transparent background)
- Circle variant (no background)

---

## 8. Sales & Lead Generation Strategy

### Free Operational Snapshot (primary lead gen tool):
- Prospect submits basic job/PO data export + 
  intake form on website
- SLS processes it and delivers a snapshot report
- Caleb walks through findings on a scheduled 
  30-minute call
- Call serves dual purpose: deliver value AND 
  guide prospect toward applicable paid services
- Snapshot is genuinely free — no strings — but 
  the walkthrough call is the conversion moment

### Outreach approach:
- Direct outreach to manufacturing consulting firms
- Target ops managers at manufacturers directly
- Share dashboard demo as sales tool
- Follow-up cadence after initial contact

### Planned future funnel:
- Paid ads → website → VSL (not yet recorded) → 
  snapshot request or demo booking
- VSL placeholder exists on homepage

### Pipeline status:
- AMEND Consulting: initial contact made, 
  follow-up pending
- No current paying customers

---

## 9. Documents & Templates

All documents are branded and templated:
- **Invoice** (SignalLogicSystems_Invoice.docx) — 
  template with placeholder variables
- **Quote** (SignalLogicSystems_Quote.docx) — 
  template with placeholder variables
- **Quote Auto-Generator** (Excel) — 
  automated quote generation
- **Statement of Work** — covers scope, snapshot 
  retention policy, fees, acceptance
- **Service Proposal** — Job Flow Monitor 
  specific proposal document
- **Pricing sheets** — Growth and Scale tiers 
  (pricing under review, not finalized)

---

## 10. Immediate Priorities (as of April 2026)

1. **Deploy website** — Switch signallogicsystems.com 
   DNS from Lovable to Netlify
2. **Build processing engine** — Backend logic for 
   Job Flow Monitor that accepts CSV input and 
   returns diagnostic output without exposing 
   the calculation engine
3. **Start outreach** — Send follow-up to AMEND 
   Consulting, begin broader outreach to 
   consulting firms
4. **Land first customer** — Target: within 30 days
5. **Record VSL** — Homepage video placeholder 
   needs real content

---

## 11. Key Strategic Principles

1. **You are not selling a dashboard.** You are 
   selling faster, clearer, more objective 
   identification of operational improvement 
   opportunities.

2. **Hold the calculator.** The processing engine 
   never goes to the client. This protects IP, 
   justifies recurring fees, and limits liability.

3. **Modular beats bundled.** Let clients start 
   small and expand. Lower barrier = faster 
   first customer.

4. **Recurring revenue compounds.** One client 
   paying $500/month is worth more than a 
   $3,000 one-time project. Build the base.

5. **The free snapshot is a sales call in disguise.** 
   Deliver real value, earn trust, guide toward 
   paid services naturally.

6. **Founder credibility is real.** Caleb works 
   inside manufacturing daily. That is not 
   common among SaaS founders and should be 
   used in positioning.