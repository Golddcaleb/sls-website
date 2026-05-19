'use strict';

/**
 * lib/analyze/job-flow/index.js
 * Signal Logic Systems LLC
 *
 * Job Flow Monitor engine — composition entry point. Takes normalized
 * rows (output of normalize() with the jobs schema) and returns the
 * full diagnostic metrics object.
 *
 * This composer is a small, deliberate addition not enumerated in the
 * architecture folder map: it gives netlify/functions/process.js one call
 * site and keeps the metrics contract byte-compatible with the Phase 1
 * dashboard.js calculate() return, so the render layer ports with minimal
 * change. Result follows the codebase's { ok, error } convention rather
 * than Phase 1's null-on-empty.
 *
 * Governing math: jfm-architecture.md §5.
 */

const { filterActive, findConstraint } = require('./constraint');
const { inferStageOrder, cascade } = require('./revenue-at-risk');
const { rankPriority, supportingMetrics } = require('./priority-rank');

/**
 * Run the full JFM diagnostic.
 *
 * @param {object[]} rows  Normalized job rows.
 * @param {object}   [opts]
 * @param {Date}     [opts.today]         Pinned "now" for the request.
 * @param {number}   [opts.totalRecords]  Pre-filter record count for the
 *                                        report header (defaults to rows.length).
 * @returns {{ ok: boolean, metrics?: object, error?: string }}
 */
function analyzeJobFlow(rows, opts = {}) {
  const input = Array.isArray(rows) ? rows : [];
  const today = opts.today || new Date();
  const totalRecords = opts.totalRecords == null ? input.length : opts.totalRecords;

  // Drop rows that carry neither an identifier nor a stage (Phase 1 parity).
  const jobs = input.filter(j => (j.job_number && j.job_number !== '') ||
                                 (j.stage && String(j.stage).trim() !== ''));

  const active = filterActive(jobs);
  if (active.length === 0) {
    return {
      ok: false,
      error: 'No active jobs found. Check that the Status/Stage column contains active records.',
    };
  }

  const stageOrder = inferStageOrder(active);
  const { stage: constraint, counts, values, jobsAtConstraint } = findConstraint(active);

  const revenueAtRisk = values[constraint] || 0;
  const { cascadeTotal, upstreamStages } = cascade(active, constraint, stageOrder);

  const support = supportingMetrics(active, { today });
  const priorityJobs = rankPriority(active, { today });

  const firstCustomer = jobs.find(j => j.customer);
  const customerName = firstCustomer ? firstCustomer.customer : null;

  return {
    ok: true,
    metrics: {
      totalRecords,
      totalJobs: active.length,
      constraint,
      jobsAtConstraint,
      revenueAtRisk,
      cascadeTotal,
      totalValue: support.totalValue,
      pastDueCount: support.pastDueCount,
      avgDaysLate: support.avgDaysLate,
      onTimeRate: support.onTimeRate,
      stageOrder,
      stageCounts: counts,
      stageValues: values,
      priorityJobs,
      hasValue: support.hasValue,
      hasDueDate: support.hasDueDate,
      upstreamStages,
      customerName,
      reportDate: today,
    },
  };
}

module.exports = { analyzeJobFlow };
