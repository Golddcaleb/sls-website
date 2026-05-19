'use strict';

/**
 * lib/analyze/job-flow/constraint.js
 * Signal Logic Systems LLC
 *
 * Step 3 (Analyze) for the Job Flow Monitor — constraint identification.
 * Ports the tested Phase 1 browser logic (dashboard.js) to run server-side
 * against normalized rows from lib/normalize/column-mapper.js.
 *
 * Governing math: jfm-architecture.md §5.2 (Active Job Filter) and
 * §5.3 (Constraint Identification).
 *
 * Input row shape (output of normalize() with the jobs schema):
 *   { job_number, stage, due_date, job_value, customer, order_date,
 *     qty_ordered, qty_shipped, part_number, description }
 *   - strings are trimmed strings ('' when absent)
 *   - job_value is number|null
 *   - due_date / order_date are Date|null
 */

// Terminal (inactive) stages — verbatim from the Phase 1 engine so Phase 2
// filters an identical set of jobs. Compared lowercased.
const TERMINAL_STAGES = new Set([
  'shipped', 'complete', 'completed', 'closed', 'invoiced',
  'cancelled', 'canceled', 'void', 'voided', 'done', 'finished',
  'delivered', 'archived',
]);

/**
 * A job is active unless its stage is a known terminal state. An empty
 * stage is treated as active (matches Phase 1 behavior — we cannot prove
 * it is finished).
 *
 * @param {object} job  Normalized job row.
 * @returns {boolean}
 */
function isActive(job) {
  const stage = job && job.stage ? String(job.stage).trim() : '';
  return stage ? !TERMINAL_STAGES.has(stage.toLowerCase()) : true;
}

/**
 * Filter a list of normalized jobs down to active jobs.
 *
 * @param {object[]} jobs
 * @returns {object[]}
 */
function filterActive(jobs) {
  return (jobs || []).filter(isActive);
}

/**
 * Identify the constraint: the stage holding the highest count of active
 * jobs. Ties are broken by total revenue held at the stage (the more
 * financially significant bottleneck wins). Jobs with an empty stage are
 * bucketed under "Unknown" (Phase 1 parity).
 *
 * @param {object[]} activeJobs  Already filtered to active jobs.
 * @returns {{
 *   stage: string|null,
 *   counts: Object<string,number>,
 *   values: Object<string,number>,
 *   jobsAtConstraint: number
 * }}
 */
function findConstraint(activeJobs) {
  const counts = {};
  const values = {};

  for (const j of activeJobs || []) {
    const s = (j.stage && String(j.stage).trim()) || 'Unknown';
    counts[s] = (counts[s] || 0) + 1;
    values[s] = (values[s] || 0) + (typeof j.job_value === 'number' ? j.job_value : 0);
  }

  const stages = Object.keys(counts);
  if (stages.length === 0) {
    return { stage: null, counts, values, jobsAtConstraint: 0 };
  }

  const max = Math.max(...stages.map(s => counts[s]));
  const tied = stages
    .filter(s => counts[s] === max)
    .sort((a, b) => (values[b] || 0) - (values[a] || 0));

  const stage = tied[0];
  return { stage, counts, values, jobsAtConstraint: counts[stage] || 0 };
}

module.exports = { TERMINAL_STAGES, isActive, filterActive, findConstraint };
