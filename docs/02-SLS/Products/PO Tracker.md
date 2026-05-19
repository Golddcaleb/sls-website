# PO Tracker

**Status:** Planned
**Target:** Procurement teams, ops managers, supply chain

## The Problem
ERP systems track PO data but don't proactively communicate. Manufacturers chase suppliers manually and find out about delays after it's too late to avoid expedited shipping costs.

## What It Does (Planned)
- Monitors open purchase orders via CSV export
- Flags items approaching lead time thresholds
- Triggers templated follow-up communications (supplier + customer)
- Daily digest of PO status changes
- Delay detection: promised date vs actual date

## Why Blue Ash Needs This
Their three-system environment (Proper 21 / Matrix / CribMaster) means POs fall through the cracks between systems. They regularly pay expedited shipping fees for items that weren't flagged as at-risk early enough. → [[Blue Ash Industrial Supply]]

## Architecture
Will use the same modular backend as JFM → [[JFM Backend Architecture]]
- New schema: `lib/normalize/schemas/purchase-orders.js`
- New analyze module: `lib/analyze/po-tracking/`
  - `lead-time.js`
  - `follow-up-triggers.js`
