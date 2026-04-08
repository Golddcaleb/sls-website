# Job Flow Monitor — Processing Engine Architecture
*Signal Logic Systems LLC*
*Authored: April 2026*

---

## 1. Overview

The Job Flow Monitor (JFM) is SLS's flagship diagnostic tool. It ingests a job/work order CSV
export from a customer's ERP system, runs constraint identification and revenue-at-risk analysis
entirely in memory, and returns a self-contained diagnostic report to the customer. No raw data
is ever written to disk or retained by SLS infrastructure.

This document covers the full architecture from customer submission to report delivery, including
data flow, processing logic, security model, and the two-phase build plan.

---

## 2. Design Principles

1. **Hold the calculator.** The processing engine lives on SLS infrastructure. The customer
   receives the output (a report artifact), never the engine itself.

2. **Zero persistent storage.** Raw CSV data is processed in memory and discarded when the
   request lifecycle ends. SLS never writes customer data to any database, file system, or
   third-party service.

3. **Snapshot model.** Reports are point-in-time snapshots. This is intentional — it drives
   recurring monthly submissions, which is the recurring revenue mechanism.

4. **No third-party BI dependency.** The report is a self-contained HTML file. It requires no
   Google account, no Looker Studio setup, and no ongoing dependency on SLS beyond the next
   submission cycle.

5. **Serverless by default.** The processing function is stateless and ephemeral by
   architecture, not just by policy. Netlify Functions enforce this: no filesystem access,
   no persistent memory between invocations.

---

## 3. Data Flow

```
┌─────────────────────────┐
│     Customer System     │
│  (JobBOSS or any ERP)   │
└────────────┬────────────┘
             │
             │  CSV export (job listing report)
             │  HTTPS POST + HMAC-SHA256 signature header
             │
             ▼
┌─────────────────────────┐
│    SLS Upload Endpoint  │
│   (Netlify Function)    │
│                         │
│  1. Verify HMAC sig     │
│  2. Parse CSV in memory │
│  3. Map columns         │
│  4. Run engine          │
│  5. Render HTML report  │
│  6. Return response     │
│  7. Discard all data    │
└────────────┬────────────┘
             │
             │  HTTP 200 — self-contained HTML file
             │  (derived metrics embedded, no raw data)
             │
             ▼
┌─────────────────────────┐
│   Customer's Browser /  │
│   Local Environment     │
│                         │
│  Opens HTML file        │
│  Views dashboard        │
│  Exports PDF if needed  │
└─────────────────────────┘
```

**What crosses the wire:**
- Inbound: raw CSV, HMAC signature, customer ID token
- Outbound: HTML report file containing only derived metrics (no raw job data, no PII beyond
  what the customer chooses to include in their own report)

---

## 4. Security Model

### 4.1 Authentication — HMAC-SHA256

Each customer is issued a shared secret at onboarding. Every submission must include an
`X-SLS-Signature` header containing an HMAC-SHA256 digest of the request body, keyed with
their secret.

```
X-SLS-Signature: sha256=<hex digest>
```

The Netlify Function verifies the signature before processing begins. Requests with missing
or invalid signatures are rejected with HTTP 401. This prevents:
- Unauthorized submissions from unknown parties
- Replay attacks (timestamp included in signed payload)
- Tampering with the CSV payload in transit

### 4.2 Transport Security

All submissions travel over HTTPS. TLS is enforced by Netlify's edge network — no HTTP
fallback is permitted.

### 4.3 No Storage = No Breach Surface

Because raw data is never written anywhere, there is no database to breach, no S3 bucket
to misconfigure, and no backup to leak. The attack surface for customer data exposure is
limited to the in-flight request window.

### 4.4 Output Data Classification

The HTML report contains only **derived metrics**: counts, sums, ratios, and rankings
computed from the raw data. The raw job records are not embedded in the output. A customer
who receives the report cannot reconstruct the original CSV from it.

---

## 5. Processing Engine

### 5.1 Column Detection and Mapping

JobBOSS (and other ERP) exports use inconsistent column naming across report types and
versions. The engine uses a fuzzy match layer to map detected headers to a standard internal
schema before processing begins.

**Standard internal schema:**

| Internal Field | Accepted CSV Variants |
|----------------|-----------------------|
| `job_number`   | Job, Job_Number, JobNo, Job No, WO, Work_Order |
| `customer`     | Customer, Customer_Name, Cust_Name, Cust |
| `stage`        | Status, Job_Status, Current_Op, Work_Center, Operation, Stage |
| `due_date`     | Due_Date, Due Date, Req_Date, Required_Date, Need_Date |
| `order_date`   | Order_Date, Start_Date, Open_Date, Date_Opened |
| `job_value`    | Est_Total_Price, Quote_Price, Total_Price, Revenue, Price, Ext_Price |
| `qty_ordered`  | Qty_Ordered, Order_Qty, Quantity, Qty |
| `qty_shipped`  | Qty_Shipped, Ship_Qty, Shipped |
| `part_number`  | Part, Part_Number, Part_No, PartNo |
| `description`  | Description, Part_Desc, Desc, Item_Desc |

If a required field cannot be mapped automatically, the engine returns a structured error
identifying which fields are missing. In Phase 1 (browser tool), this prompts a manual
column mapping UI. In Phase 2 (serverless), it returns HTTP 422.

### 5.2 Active Job Filter

Before metric calculation, records are filtered to active jobs only. A job is considered
inactive (excluded) if its stage value matches any of the following terminal states:

`Shipped`, `Complete`, `Closed`, `Invoiced`, `Cancelled`, `Void`

This ensures metrics reflect only the current production pipeline.

### 5.3 Constraint Identification

The **constraint** is the production stage currently holding the highest count of active
jobs. This follows Theory of Constraints logic: the stage with the most queued work is
the system's bottleneck.

```
constraint_stage = stage with max(count of active jobs)
```

Where multiple stages tie, the tie is broken by total revenue value held at that stage
(highest value wins — the more financially significant bottleneck takes priority).

### 5.4 Revenue at Risk

Revenue at risk is the total dollar value of active jobs currently sitting at the
constraint stage. These jobs cannot advance until the constraint is resolved.

```
revenue_at_risk = SUM(job_value) WHERE stage == constraint_stage
```

### 5.5 Upstream Cascade Analysis

The cascade total captures the full financial exposure — not just jobs stuck at the
constraint, but all jobs upstream that will eventually reach it.

Stage ordering is inferred from the data: stages are ranked by their median job age
(older average job age = later in the process). This produces a rough operational
sequence without requiring manual configuration at onboarding.

```
cascade_total = SUM(job_value) WHERE stage is upstream of constraint_stage
```

The cascade total is the number that gets an executive's attention. It answers:
"If the constraint isn't resolved, how much total revenue is ultimately at risk?"

### 5.6 Job Priority Ranking

Each active job is assigned a priority score:

```
priority_score = days_overdue × job_value
```

Where `days_overdue = MAX(0, today - due_date)`. On-time jobs score 0 and appear at the
bottom of the ranking. The ranking surfaces the jobs where delay is costing the most money
right now.

### 5.7 Supporting Metrics

| Metric | Calculation |
|--------|-------------|
| Total active jobs | COUNT of all non-terminal jobs |
| Jobs past due | COUNT where due_date < today |
| Avg days late | MEAN(days_overdue) for past-due jobs only |
| On-time rate | (active jobs on schedule / total active jobs) × 100 |
| Jobs at constraint | COUNT where stage == constraint_stage |

---

## 6. Report Output

### 6.1 Format

The engine produces a single self-contained `.html` file. All CSS, JavaScript (Chart.js),
and derived data are embedded inline. The file:

- Opens in any modern browser with no internet connection required
- Is printable to PDF via browser print dialog
- Contains no raw customer data — only derived metrics and aggregates
- Is branded to Signal Logic Systems

### 6.2 Report Sections

1. **Header** — Report date, customer name (if mapped), SLS branding
2. **KPI Cards** — Constraint stage, revenue at risk, cascade total, jobs past due, on-time rate
3. **Constraint Chart** — Horizontal bar chart: active job count per stage, constraint highlighted
4. **Revenue Exposure Chart** — Bar chart: revenue held by stage
5. **Priority Job Table** — Top jobs ranked by priority score (job #, customer, stage, value,
   days late)
6. **Diagnostic Summary** — Plain-English summary of findings, e.g.:
   > "QC is your current constraint, holding $142,000 in active revenue. 8 upstream jobs
   > worth $390,000 are on track to reach QC within the next 14 days."
7. **Footer** — "Report generated by Signal Logic Systems. Raw data not retained by SLS."

### 6.3 What the Report Does NOT Contain

- Raw job records from the source CSV
- Part numbers or descriptions (unless customer opts in at onboarding)
- Any data that could be used to reconstruct the original CSV export

---

## 7. Phase Build Plan

### Phase 1 — Internal Demo Tool (Current Priority)

**What it is:** A browser-based version of the engine at `dashboard.html` on the SLS site.
Processing runs in the visitor's browser via JavaScript. No server required.

**Used for:**
- Sales calls — drag in a prospect's CSV, show them their own data analyzed live
- Free operational snapshot — prospect self-serves, Caleb reviews output on a follow-up call
- Engine development and testing before moving server-side

**Trade-off:** The JavaScript processing logic is technically visible to anyone who inspects
the page source. Acceptable for Phase 1 because this is a demo and sales tool, not the paid
product. Phase 2 moves the engine server-side before any paid engagements begin.

**Files to build:**
- `signallogicsystems-site/dashboard.html`
- `signallogicsystems-site/dashboard.js`

**CDN dependencies:**
- PapaParse — CSV parsing
- Chart.js — visualizations

### Phase 2 — Production Service (Before First Paying Client)

**What it is:** Engine logic migrated to a Netlify Function. Customers submit via
authenticated HTTPS POST. Function processes in memory and returns the HTML report.

**Files to build:**
- `netlify/functions/process-jobs.js` — serverless processing function
- `signallogicsystems-site/submit.html` — authenticated upload interface

**New requirements at Phase 2:**
- Customer secret key management (generated at onboarding, stored in Netlify env vars)
- HMAC signing guide or upload form that handles signing transparently
- Report delivery via direct HTTP response download or time-limited (24hr) hosted link

---

## 8. Infrastructure Cost

| Component | Provider | Cost |
|-----------|----------|------|
| Site hosting | Netlify Free | $0 |
| Serverless functions | Netlify Free (125k req/mo) | $0 |
| Custom domain | Already owned | $0 |
| SSL/TLS | Netlify managed | $0 |
| Storage | None — by design | $0 |

**Monthly infrastructure cost at launch: $0**

Scales to hundreds of report submissions per month before hitting Netlify free tier limits.
Paid tier ($19/month) supports millions of function invocations if needed.

---

## 9. Liability and Insurance Posture

- **No raw data retention:** SLS has nothing to lose in a breach because nothing is stored.
- **Service model, not software license:** The engine is never delivered. SLS provides a
  diagnostic service — equivalent to a consultant providing a written report.
- **Snapshot artifact:** The output HTML file is equivalent to a PDF report. SLS is not
  operating a live system on the customer's behalf.
- **No PII storage:** Customer data exists only during the in-flight request window.
- **SOW governs engagement:** All processing is performed under an executed SOW defining
  scope, data handling, and retention policy (60-day derived metrics, deleted on termination).

---

## 10. Open Questions (Resolve Before Phase 1 Build)

1. **Column mapping fallback:** If auto-detection fails, should the Phase 1 browser tool
   show a dropdown UI for manual column mapping, or display an error listing missing fields?

2. **Stage ordering:** Should the engine infer stage sequence from median job age (automatic),
   or should onboarding include a one-time stage sequence configuration step (explicit)?

3. **Report delivery in Phase 2:** Direct download in HTTP response, or a time-limited
   (24-hour) hosted URL that auto-expires?

4. **Customer identification in Phase 2:** Should the HMAC key encode a customer ID so
   the report header auto-populates the correct company name?

5. **Minimum viable CSV:** Proposed minimum required columns to produce a useful report:
   `job_number`, `stage`, `due_date`, `job_value`. Confirm or adjust.

---

*This document governs all architecture decisions for the Job Flow Monitor processing engine.
Deviations from the zero-storage and engine-protection principles require explicit review.*
