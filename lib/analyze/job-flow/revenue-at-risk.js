'use strict';

/**
 * lib/analyze/job-flow/revenue-at-risk.js
 * Signal Logic Systems LLC
 *
 * Revenue-at-risk and upstream cascade analysis for the Job Flow Monitor.
 * Ports the tested Phase 1 logic (dashboard.js) to run server-side.
 *
 * Governing math: jfm-architecture.md §5.4 (Revenue at Risk) and
 * §5.5 (Upstream Cascade Analysis).
 *
 * Stage ordering is inferred without onboarding config: stages with a
 * known manufacturing name are placed by a canonical sequence; unknown
 * stages are ranked by median job age (older average age = earlier in
 * the process, since those jobs have been open longest).
 */

// Canonical manufacturing stage order (earlier stages first) — verbatim
// from the Phase 1 engine. Compared lowercased.
const KNOWN_STAGE_ORDER = [
  'quote', 'order', 'open', 'planning', 'planned', 'engineering',
  'material', 'materials', 'purchasing', 'layout', 'setup',
  'run', 'running', 'machining', 'machine', 'welding', 'weld',
  'fabrication', 'fab', 'forming', 'assembly', 'assemble',
  'inspection', 'inspect', 'qc', 'quality', 'test', 'testing',
  'paint', 'painting', 'coating', 'finish', 'finishing',
  'packing', 'pack', 'shipping', 'ship', 'in process', 'in_process',
];

/**
 * Infer an operational stage sequence from the jobs themselves.
 * Known-named stages sort by KNOWN_STAGE_ORDER; unknown stages are
 * appended, ranked by median job age (oldest first).
 *
 * @param {object[]} jobs  Active jobs (need stage; order_date used if present).
 * @param {number}   [now] Epoch ms reference point (injectable for tests).
 * @returns {string[]}  Ordered stage names.
 */
function inferStageOrder(jobs, now) {
  const ref = typeof now === 'number' ? now : Date.now();
  const stages = [...new Set((jobs || []).map(j => j.stage).filter(Boolean))];

  const known = [];
  const unknown = [];
  for (const s of stages) {
    const ki = KNOWN_STAGE_ORDER.indexOf(String(s).toLowerCase());
    if (ki !== -1) known.push({ s, ki });
    else unknown.push(s);
  }
  known.sort((a, b) => a.ki - b.ki);

  const ranked = unknown.map(stage => {
    const aged = (jobs || [])
      .filter(j => j.stage === stage && j.order_date instanceof Date && !isNaN(j.order_date))
      .map(j => ref - j.order_date.getTime());
    const median = aged.length
      ? aged.sort((a, b) => a - b)[Math.floor(aged.length / 2)]
      : 0;
    return { s: stage, median };
  });
  ranked.sort((a, b) => b.median - a.median);

  return [...known.map(x => x.s), ...ranked.map(x => x.s)];
}

/**
 * Total dollar value of active jobs sitting AT the constraint stage.
 * These cannot advance until the constraint is resolved.
 *
 * @param {object[]} activeJobs
 * @param {string}   constraintStage
 * @returns {number}
 */
function revenueAtRisk(activeJobs, constraintStage) {
  if (!constraintStage) return 0;
  return (activeJobs || []).reduce((sum, j) => {
    const stage = (j.stage && String(j.stage).trim()) || 'Unknown';
    if (stage !== constraintStage) return sum;
    return sum + (typeof j.job_value === 'number' ? j.job_value : 0);
  }, 0);
}

/**
 * Upstream cascade: total value of work that will eventually reach the
 * constraint. If a stage order is established, this is the sum of all
 * stages upstream of the constraint. If the constraint is first (or order
 * is unknown), fall back to the sum of every active non-constraint job —
 * the full exposure. (Phase 1 parity.)
 *
 * @param {object[]} activeJobs
 * @param {string}   constraintStage
 * @param {string[]} stageOrder
 * @returns {{ cascadeTotal: number, upstreamStages: string[] }}
 */
function cascade(activeJobs, constraintStage, stageOrder) {
  const order = stageOrder || [];
  const ci = order.indexOf(constraintStage);
  const upstreamStages = ci > 0 ? order.slice(0, ci) : [];

  let cascadeTotal = 0;
  if (upstreamStages.length > 0) {
    const upstream = new Set(upstreamStages);
    cascadeTotal = (activeJobs || []).reduce((sum, j) => {
      const stage = (j.stage && String(j.stage).trim()) || 'Unknown';
      if (!upstream.has(stage)) return sum;
      return sum + (typeof j.job_value === 'number' ? j.job_value : 0);
    }, 0);
  } else {
    cascadeTotal = (activeJobs || []).reduce((sum, j) => {
      const stage = (j.stage && String(j.stage).trim()) || 'Unknown';
      if (stage === constraintStage) return sum;
      return sum + (typeof j.job_value === 'number' ? j.job_value : 0);
    }, 0);
  }

  return { cascadeTotal, upstreamStages };
}

module.exports = { KNOWN_STAGE_ORDER, inferStageOrder, revenueAtRisk, cascade };
