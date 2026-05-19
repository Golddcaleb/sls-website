'use strict';

/**
 * lib/analyze/job-flow/priority-rank.js
 * Signal Logic Systems LLC
 *
 * Job priority ranking and supporting pipeline metrics for the Job Flow
 * Monitor. Ports the tested Phase 1 logic (dashboard.js) to run
 * server-side against normalized rows.
 *
 * Governing math: jfm-architecture.md §5.6 (Job Priority Ranking) and
 * §5.7 (Supporting Metrics).
 *
 * `today` is injectable everywhere so tests are deterministic and the
 * Netlify Function can pin a single "now" for one request.
 */

/**
 * Date at local midnight. The reference "today" is floored to midnight
 * (Phase 1 parity); due dates are compared raw against it.
 *
 * @param {Date|number|string} d
 * @returns {Date}
 */
function startOfDay(d) {
  const x = d instanceof Date ? new Date(d.getTime()) : new Date(d || Date.now());
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Whole days a job is overdue (0 if on time, no due date, or unparseable).
 *
 * @param {Date|null} dueDate
 * @param {Date}      [today]
 * @returns {number}
 */
function daysOverdue(dueDate, today) {
  if (!(dueDate instanceof Date) || isNaN(dueDate.getTime())) return 0;
  const t = startOfDay(today || new Date());
  const diff = Math.floor((t.getTime() - dueDate.getTime()) / 86400000);
  return Math.max(0, diff);
}

/**
 * True if the job's due date is before the start of today.
 *
 * @param {Date|null} dueDate
 * @param {Date}      [today]
 * @returns {boolean}
 */
function isPastDue(dueDate, today) {
  if (!(dueDate instanceof Date) || isNaN(dueDate.getTime())) return false;
  return dueDate < startOfDay(today || new Date());
}

/**
 * Rank jobs by priority score = days_overdue × job_value (job_value
 * defaults to 1 when absent, so a value-less but overdue job still ranks
 * by lateness — Phase 1 parity).
 *
 * Returns scrubbed objects only: the server-side report carries derived
 * metrics, never the full raw job record (zero-raw-data-leak principle).
 *
 * @param {object[]} activeJobs
 * @param {object}   [opts]
 * @param {Date}     [opts.today]
 * @param {number}   [opts.limit=20]
 * @param {boolean}  [opts.pastDueOnly=true]  Match Phase 1 priority table.
 * @returns {object[]}  [{ job_number, customer, stage, job_value,
 *                         days_overdue, is_past_due, score }]
 */
function rankPriority(activeJobs, opts = {}) {
  const today = opts.today || new Date();
  const limit = opts.limit == null ? 20 : opts.limit;
  const pastDueOnly = opts.pastDueOnly !== false;

  let ranked = (activeJobs || []).map(j => {
    const dOver = daysOverdue(j.due_date, today);
    const pastDue = isPastDue(j.due_date, today);
    const value = typeof j.job_value === 'number' ? j.job_value : null;
    return {
      job_number: j.job_number || '',
      customer: j.customer || '',
      stage: (j.stage && String(j.stage).trim()) || '',
      job_value: value,
      days_overdue: dOver,
      is_past_due: pastDue,
      score: dOver * (value || 1),
    };
  });

  if (pastDueOnly) ranked = ranked.filter(j => j.is_past_due);
  ranked.sort((a, b) => b.score - a.score);
  return limit == null ? ranked : ranked.slice(0, limit);
}

/**
 * Supporting pipeline metrics over the active set.
 *
 * @param {object[]} activeJobs
 * @param {object}   [opts]
 * @param {Date}     [opts.today]
 * @returns {{
 *   pastDueCount: number,
 *   avgDaysLate: number,
 *   onTimeRate: number,
 *   totalValue: number,
 *   hasValue: boolean,
 *   hasDueDate: boolean
 * }}
 */
function supportingMetrics(activeJobs, opts = {}) {
  const today = opts.today || new Date();
  const jobs = activeJobs || [];

  const pastDue = jobs.filter(j => isPastDue(j.due_date, today));
  const avgDaysLate = pastDue.length
    ? Math.round(
        pastDue.reduce((s, j) => s + daysOverdue(j.due_date, today), 0) / pastDue.length
      )
    : 0;

  const totalValue = jobs.reduce(
    (s, j) => s + (typeof j.job_value === 'number' ? j.job_value : 0),
    0
  );

  const onTimeRate = jobs.length
    ? Math.round(((jobs.length - pastDue.length) / jobs.length) * 100)
    : 100;

  return {
    pastDueCount: pastDue.length,
    avgDaysLate,
    onTimeRate,
    totalValue,
    hasValue: jobs.some(j => j.job_value !== null && j.job_value !== undefined),
    hasDueDate: jobs.some(j => j.due_date instanceof Date && !isNaN(j.due_date.getTime())),
  };
}

module.exports = {
  startOfDay,
  daysOverdue,
  isPastDue,
  rankPriority,
  supportingMetrics,
};
