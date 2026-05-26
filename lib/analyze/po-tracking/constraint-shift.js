'use strict';

/**
 * lib/analyze/po-tracking/constraint-shift.js
 * Signal Logic Systems LLC
 *
 * Detects when the longest-lead-time (constraint) item on a job
 * changes — for example, when the part everyone was waiting on
 * arrives early, or when a different item slips and becomes the new
 * bottleneck.
 *
 * Why this matters: constraint shifts are the most actionable signal
 * the tool produces. Procurement teams chase whatever they *think* is
 * the constraint. When that assumption silently changes, expedite
 * fees, missed builds, and stale customer commitments follow.
 * Surfacing the shift the moment it happens is the headline value of
 * this product.
 *
 * Input:
 *   current   { job_id, constraint_item, expected_date } from lead-time.js
 *   prior     { constraint_item, expected_date }
 *             — the values previously stamped on the SharePoint
 *               tracking record(s) for this job. Pass null / undefined
 *               if the job has never been evaluated before.
 *
 * Output:
 *   { shifted, previous_item, new_item, delta_days, severity, notify }
 *
 * severity is bucketed so downstream UI / notifications can prioritize:
 *   'low'     constraint item changed, expected date moved by < 3 days
 *   'medium'  3..7 days delta
 *   'high'    > 7 days OR the item changed to one that wasn't on the
 *             job at all before (genuinely new bottleneck)
 */

function severityFor(prior, current, itemChanged) {
  if (!prior || !prior.expected_date) {
    // First-ever evaluation. Don't fire a shift alert on the initial
    // baseline — the constraint hasn't *changed*, it's just been
    // computed for the first time.
    return 'none';
  }

  const prevT = Date.parse(prior.expected_date);
  const newT  = Date.parse(current.expected_date);
  if (isNaN(prevT) || isNaN(newT)) return itemChanged ? 'high' : 'low';

  const deltaDays = Math.abs(Math.round((newT - prevT) / 86_400_000));

  if (deltaDays > 7) return 'high';
  if (itemChanged && deltaDays >= 3) return 'high';
  if (deltaDays >= 3) return 'medium';
  return itemChanged ? 'medium' : 'low';
}

/**
 * Detect a shift between a prior and current constraint snapshot.
 *
 * @param {object|null} prior
 * @param {object}      current   Output of computeJobConstraint().
 * @returns {{
 *   shifted: boolean,
 *   previous_item: string|null,
 *   previous_date: string|null,
 *   new_item: string|null,
 *   new_date: string|null,
 *   delta_days: number,
 *   severity: 'none'|'low'|'medium'|'high',
 *   notify: boolean,
 *   job_id: string|null
 * }}
 */
function detectShift(prior, current) {
  const base = {
    shifted: false,
    previous_item: prior ? (prior.constraint_item || null) : null,
    previous_date: prior ? (prior.expected_date || null)   : null,
    new_item: current ? (current.constraint_item || null) : null,
    new_date: current ? (current.expected_date || null)   : null,
    delta_days: 0,
    severity: 'none',
    notify: false,
    job_id: current ? current.job_id : null,
  };

  if (!current) return base; // Job has no open items — not a shift, just done.
  if (!prior || !prior.constraint_item) {
    // First baseline. Mark as not-shifted; caller still wants to write
    // the baseline back to SharePoint so the next eval can compare.
    return base;
  }

  const itemChanged = String(prior.constraint_item).toLowerCase()
    !== String(current.constraint_item).toLowerCase();

  const prevT = Date.parse(prior.expected_date);
  const newT  = Date.parse(current.expected_date);
  const deltaDays = (!isNaN(prevT) && !isNaN(newT))
    ? Math.round((newT - prevT) / 86_400_000)
    : 0;

  base.delta_days = deltaDays;

  if (!itemChanged && deltaDays === 0) {
    return base; // No shift.
  }

  const severity = severityFor(prior, current, itemChanged);
  base.shifted = true;
  base.severity = severity;
  base.notify = severity === 'medium' || severity === 'high';
  return base;
}

/**
 * Walk a set of current vs prior constraint pairs and return the shifts
 * worth surfacing (notify === true). Convenience wrapper for the
 * dashboard's Constraint Alerts panel.
 *
 * @param {object[]} pairs   [{ prior, current }]
 * @returns {object[]}       Detected shifts where notify === true.
 */
function detectShifts(pairs) {
  if (!Array.isArray(pairs)) return [];
  const out = [];
  for (const p of pairs) {
    const d = detectShift(p.prior, p.current);
    if (d.notify) out.push(d);
  }
  return out;
}

module.exports = {
  detectShift,
  detectShifts,
  severityFor,
};
