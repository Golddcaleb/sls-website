'use strict';

/**
 * lib/analyze/po-tracking/lead-time.js
 * Signal Logic Systems LLC
 *
 * Identifies the longest-lead-time (constraint) item across all open
 * line items on a given job.
 *
 * Constraint = the item whose estimated ship date is furthest in the
 * future. Drives Job-level expectations: a job is bottlenecked by its
 * latest-arriving part regardless of how on-time the rest are.
 *
 * Input shape: an array of tracking records (per
 * sharepoint-reader.itemToRecord). Records carry:
 *   job_id, line_items[], line_item_ship_dates{}, stage, received_items[]
 *
 * Output: { ok, constraint } where constraint is:
 *   { job_id, constraint_item, expected_date, days_remaining,
 *     contributing_po }
 * or null when the job has no remaining open items.
 *
 * Closed signals — these items are *not* considered in lead-time:
 *   record.stage === 'RECEIVED'
 *   item appears in record.received_items
 */

/**
 * Determine if an item on a record is still open (not received).
 */
function isItemOpen(record, itemName) {
  if (record.stage === 'RECEIVED') return false;
  const received = record.received_items || [];
  for (const r of received) {
    if (r && r.item_name && String(r.item_name).toLowerCase() === String(itemName).toLowerCase()) {
      return false;
    }
  }
  return true;
}

/**
 * Compute the constraint item for a single job.
 *
 * @param {string} jobId
 * @param {object[]} records   All tracking records belonging to this job.
 * @param {Date} [now]         Reference time for days_remaining. Default new Date().
 * @returns {{ job_id, constraint_item, expected_date, days_remaining, contributing_po } | null}
 */
function computeJobConstraint(jobId, records, now) {
  const today = now || new Date();
  let best = null; // { date: Date, item: string, po: string }

  for (const rec of records) {
    if (rec.job_id !== jobId) continue;

    const ships = rec.line_item_ship_dates || {};
    for (const itemName of Object.keys(ships)) {
      if (!isItemOpen(rec, itemName)) continue;
      const t = Date.parse(ships[itemName]);
      if (isNaN(t)) continue;
      const d = new Date(t);
      if (!best || d > best.date) {
        best = { date: d, item: itemName, po: rec.po_number };
      }
    }
  }

  if (!best) return null;

  const msPerDay = 86_400_000;
  const days = Math.round((best.date.getTime() - today.getTime()) / msPerDay);

  return {
    job_id: jobId,
    constraint_item: best.item,
    expected_date: best.date.toISOString().slice(0, 10),
    days_remaining: days,
    contributing_po: best.po,
  };
}

/**
 * Compute constraint for every distinct job_id in the record set.
 *
 * @param {object[]} records
 * @param {Date} [now]
 * @returns {{ ok:true, constraints: object[] }}
 *          constraints sorted by days_remaining descending
 *          (longest-lead jobs first — those are the ones at most risk).
 */
function analyzeLeadTime(records, now) {
  if (!Array.isArray(records)) {
    return { ok: false, error: 'analyzeLeadTime expects an array of records' };
  }

  const seenJobs = new Set();
  for (const r of records) {
    if (r && r.job_id) seenJobs.add(r.job_id);
  }

  const constraints = [];
  for (const jobId of seenJobs) {
    const c = computeJobConstraint(jobId, records, now);
    if (c) constraints.push(c);
  }

  constraints.sort((a, b) => b.days_remaining - a.days_remaining);

  return { ok: true, constraints };
}

module.exports = {
  analyzeLeadTime,
  computeJobConstraint,
  isItemOpen,
};
