'use strict';

/**
 * lib/render/job-flow/job-flow.js
 * Signal Logic Systems LLC
 *
 * Report composer for the Job Flow Monitor. Takes the metrics object
 * returned by lib/analyze/job-flow/index.js and assembles a self-
 * contained diagnostic HTML report.
 *
 * Section order follows jfm-architecture.md §6.2 but is reordered into
 * action-first form to match the ship-vs-invoice precedent — the
 * executive sees the constraint and the worst-offending jobs before the
 * supporting visualizations:
 *
 *   1. Headline callout    — "<stage> is your constraint" with $ exposure.
 *   2. Diagnostic narrative — plain-English summary of the run.
 *   3. Priority job table   — jobs ranked by days_overdue × value.
 *   4. Constraint chart     — active job count per stage, constraint flagged.
 *   5. Revenue exposure     — revenue $ held by stage (omitted if no values).
 *   6. KPI strip            — reference-only orientation row.
 *   7. Footer               — supplied by report-builder.
 *
 * Charts are rendered as inline CSS bars rather than Chart.js. The
 * shared report shell is "Zero JS by default" — keeping the same
 * posture here means the report is a single static HTML artifact with
 * no script execution, which is the right liability default for a
 * report that customers will forward to their own stakeholders.
 *
 * Empty/degraded paths:
 *   - hasValue=false   → revenue-exposure chart and $ KPIs are suppressed
 *                        and substituted with job-count framings, matching
 *                        the Phase 1 dashboard behavior.
 *   - hasDueDate=false → priority table is suppressed entirely (there is
 *                        no way to rank lateness without a due date) and
 *                        the past-due/on-time KPIs render as em-dashes.
 *   - active set empty → analyze layer returned ok:false; this composer
 *                        renders a minimal "could not produce report"
 *                        callout, mirroring renderShipVsInvoice.
 */

const { renderDocument }    = require('../report-builder');
const { renderKpiStrip }    = require('../sections/kpi-cards');
const { renderTable }       = require('../sections/tables');
const {
  renderCallout,
  renderProse,
} = require('../sections/diagnostic-text');
const {
  escapeHtml,
  formatCurrency,
  pluralize,
} = require('../utils');

// ---------------------------------------------------------------------------
// Cell formatters
// ---------------------------------------------------------------------------

function htmlSpan(cls, text) {
  return `<span class="${escapeHtml(cls)}">${escapeHtml(text)}</span>`;
}

function jobValueCell(v) {
  return formatCurrency(v);
}

function daysLateCell(d) {
  if (d == null || typeof d !== 'number') return '';
  const tone = d > 14 ? 'sls-pill--danger' : d > 7 ? '' : 'sls-pill--info';
  return `<span class="sls-pill ${tone}">${escapeHtml(d + 'd late')}</span>`;
}

function stageCell(stage, row) {
  const isConstraint = row && row.__isConstraint;
  if (isConstraint) {
    return `<span class="sls-pill sls-pill--danger">${escapeHtml(stage || '—')}</span>`;
  }
  return escapeHtml(stage || '—');
}

// ---------------------------------------------------------------------------
// CSS bar-chart renderer
//
// Inline bars built from a percentage width on a styled div. No JS, no
// external chart library. Bars at the constraint stage take an alert
// color; everything else takes the SLS gold.
// ---------------------------------------------------------------------------

function renderBarChart(opts) {
  const title    = opts.title || '';
  const sub      = opts.sub || '';
  const rows     = Array.isArray(opts.rows) ? opts.rows : [];
  const formatter = typeof opts.format === 'function' ? opts.format : v => String(v);

  if (rows.length === 0) return '';

  const max = rows.reduce((m, r) => Math.max(m, Number(r.value) || 0), 0);
  if (max <= 0) return '';

  const bars = rows.map(r => {
    const value   = Number(r.value) || 0;
    const pct     = Math.max(1, Math.round((value / max) * 100));
    const barCls  = r.highlight ? 'sls-bar sls-bar--alert' : 'sls-bar';
    return `
      <div class="sls-bar-row">
        <div class="sls-bar-label">${escapeHtml(r.label)}</div>
        <div class="sls-bar-track">
          <div class="${barCls}" style="width:${pct}%"></div>
        </div>
        <div class="sls-bar-value">${escapeHtml(formatter(value))}</div>
      </div>`;
  }).join('');

  return `<section class="sls-table-wrap">
    <div class="sls-table-head">
      <div class="sls-table-title">${escapeHtml(title)}</div>
      ${sub ? `<div class="sls-table-sub">${escapeHtml(sub)}</div>` : ''}
    </div>
    <div class="sls-bar-chart">${bars}</div>
  </section>`;
}

// CSS injected through renderDocument's `head` slot — keeps the chart
// styling co-located with the chart code rather than smuggled into the
// shared report shell.
const CHART_CSS = `
<style>
  .sls-bar-chart {
    padding: 1rem 1.25rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: .5rem;
  }
  .sls-bar-row {
    display: grid;
    grid-template-columns: minmax(120px, 22%) 1fr minmax(80px, auto);
    align-items: center;
    gap: .85rem;
    font-size: .88rem;
  }
  .sls-bar-label {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sls-bar-track {
    background: var(--bg-card-alt);
    border: 1px solid var(--border);
    border-radius: 4px;
    height: 18px;
    overflow: hidden;
  }
  .sls-bar {
    height: 100%;
    background: var(--gold);
    border-radius: 3px 0 0 3px;
  }
  .sls-bar--alert {
    background: var(--danger);
  }
  .sls-bar-value {
    text-align: right;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  @media print {
    .sls-bar-track { background: #F4F4F6; border-color: #CCCCCC; }
    .sls-bar       { background: #8A6914; }
    .sls-bar--alert { background: #B91C1C; }
    .sls-bar-label, .sls-bar-value { color: #111111; }
  }
</style>`;

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildHeadlineCallout(m) {
  const stage = m.constraint || 'Unknown';
  const atCount = m.jobsAtConstraint || 0;

  let headline;
  let body;
  let tone = 'warn';

  if (m.hasValue && m.revenueAtRisk > 0) {
    headline = `${stage} is your constraint, holding ${formatCurrency(m.revenueAtRisk)} in active revenue.`;
    tone = 'danger';
  } else {
    headline = `${stage} is your constraint, with ${pluralize(atCount, 'job')} currently queued.`;
  }

  const bodyParts = [];
  if (m.hasValue && m.cascadeTotal > 0 && m.upstreamStages && m.upstreamStages.length > 0) {
    bodyParts.push(
      `An additional ${formatCurrency(m.cascadeTotal)} of upstream work is on track to reach ${stage} next.`
    );
  } else if (!m.hasValue) {
    const upstreamJobs = (m.totalJobs || 0) - atCount;
    if (upstreamJobs > 0) {
      bodyParts.push(
        `${pluralize(upstreamJobs, 'additional job')} ${upstreamJobs === 1 ? 'is' : 'are'} upstream and will reach ${stage} next.`
      );
    }
  }
  body = bodyParts.join(' ');

  return renderCallout({
    eyebrow: 'Constraint identified',
    tone,
    headline,
    body,
  });
}

function buildNarrative(m) {
  const sentences = [];

  sentences.push(
    `Processed ${pluralize(m.totalRecords || 0, 'record')} — ${pluralize(m.totalJobs || 0, 'active job')} after filtering terminal states.`
  );

  if (m.hasDueDate) {
    if (m.pastDueCount === 0) {
      sentences.push('All tracked jobs are currently on schedule.');
    } else {
      sentences.push(
        `${pluralize(m.pastDueCount, 'job is', 'jobs are')} past due by an average of ${pluralize(m.avgDaysLate || 0, 'day')}.`
      );
    }
  }

  if (m.hasValue && m.totalValue > 0) {
    sentences.push(`Total active pipeline value: ${formatCurrency(m.totalValue)}.`);
  }

  return renderProse(sentences.join(' '));
}

function buildPriorityTable(m) {
  if (!m.hasDueDate) return '';
  const jobs = Array.isArray(m.priorityJobs) ? m.priorityJobs : [];
  if (jobs.length === 0) return '';

  const showCustomer = jobs.some(j => j.customer);
  const showValue    = m.hasValue;

  const decorated = jobs.map((j, i) => ({
    rank: i + 1,
    job_number: j.job_number || '—',
    customer: j.customer || '',
    stage: j.stage || '',
    job_value: j.job_value,
    days_overdue: j.days_overdue,
    __isConstraint: j.stage === m.constraint,
  }));

  const columns = [
    { key: 'rank',       label: '#',        align: 'right' },
    { key: 'job_number', label: 'Job',      className: 'mono' },
  ];
  if (showCustomer) {
    columns.push({ key: 'customer', label: 'Customer' });
  }
  columns.push({ key: 'stage', label: 'Stage', format: stageCell });
  if (showValue) {
    columns.push({ key: 'job_value', label: 'Value', align: 'right', format: jobValueCell });
  }
  columns.push({ key: 'days_overdue', label: 'Overdue', align: 'right', format: daysLateCell });

  return renderTable({
    id: 'priority-jobs',
    title: 'Priority jobs — biggest delay cost right now',
    sub: 'Past-due active jobs ranked by days overdue × job value. The jobs at the top are where slipping a day is costing the most money.',
    columns,
    rows: decorated,
  });
}

function buildConstraintChart(m) {
  const stages = (m.stageOrder || []).filter(s => m.stageCounts && m.stageCounts[s] != null);
  if (stages.length === 0) return '';

  const rows = stages.map(s => ({
    label: s,
    value: m.stageCounts[s] || 0,
    highlight: s === m.constraint,
  }));

  return renderBarChart({
    title: 'Active jobs by stage',
    sub: 'The stage with the most active jobs is the system constraint. Stages are ordered by inferred production sequence.',
    rows,
    format: v => `${v} job${v === 1 ? '' : 's'}`,
  });
}

function buildRevenueChart(m) {
  if (!m.hasValue) return '';
  const stages = (m.stageOrder || []).filter(s => m.stageCounts && m.stageCounts[s] != null);
  if (stages.length === 0) return '';

  const rows = stages.map(s => ({
    label: s,
    value: Math.round((m.stageValues && m.stageValues[s]) || 0),
    highlight: s === m.constraint,
  }));

  if (rows.every(r => r.value === 0)) return '';

  return renderBarChart({
    title: 'Revenue held by stage',
    sub: 'Total active job value queued at each stage. The constraint band is the immediate revenue at risk.',
    rows,
    format: formatCurrency,
  });
}

function buildKpiStrip(m) {
  const cards = [];

  cards.push({
    label: 'Constraint',
    value: m.constraint || '—',
    sub: `${m.jobsAtConstraint || 0} job${(m.jobsAtConstraint || 0) === 1 ? '' : 's'} queued`,
    tone: 'danger',
  });

  cards.push({
    label: 'Revenue at risk',
    value: m.hasValue ? formatCurrency(m.revenueAtRisk) : `${m.jobsAtConstraint || 0} jobs`,
    sub: 'Held at constraint',
    tone: 'danger',
  });

  cards.push({
    label: 'Cascade exposure',
    value: m.hasValue
      ? formatCurrency(m.cascadeTotal)
      : `${Math.max(0, (m.totalJobs || 0) - (m.jobsAtConstraint || 0))} jobs`,
    sub: 'Upstream work inbound',
    tone: 'warn',
  });

  if (m.hasDueDate) {
    cards.push({
      label: 'Past due',
      value: m.pastDueCount || 0,
      sub: (m.pastDueCount || 0) > 0 ? `Avg ${m.avgDaysLate || 0}d late` : 'On schedule',
      tone: (m.pastDueCount || 0) > 0 ? 'danger' : 'ok',
    });
    cards.push({
      label: 'On-time rate',
      value: `${m.onTimeRate || 0}%`,
      sub: 'Active jobs on schedule',
      tone: (m.onTimeRate || 0) >= 80 ? 'ok' : (m.onTimeRate || 0) >= 60 ? 'warn' : 'danger',
    });
  } else {
    cards.push({
      label: 'Past due',
      value: '—',
      sub: 'No due-date column',
    });
    cards.push({
      label: 'On-time rate',
      value: '—',
      sub: 'No due-date column',
    });
  }

  cards.push({
    label: 'Active jobs',
    value: (m.totalJobs || 0).toLocaleString('en-US'),
    sub: `${(m.totalRecords || 0).toLocaleString('en-US')} records processed`,
  });

  return renderKpiStrip(cards);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Render the Job Flow Monitor report.
 *
 * @param {object} result               Output of analyzeJobFlow().
 * @param {object} [opts]
 * @param {string} [opts.customer]      Display name. Falls back to the
 *                                       customer detected in the data,
 *                                       then to ''.
 * @param {Date}   [opts.reportDate]    Pinned report timestamp.
 * @param {string} [opts.periodLabel]   Optional period label for the
 *                                       header subtitle.
 * @returns {string} HTML document.
 */
function renderJobFlow(result, opts = {}) {
  const reportDate  = opts.reportDate instanceof Date ? opts.reportDate : new Date();
  const periodLabel = opts.periodLabel || '';

  if (!result || !result.ok) {
    const msg = (result && result.error) ||
      'No diagnostic could be produced from the supplied file.';
    return renderDocument({
      title: 'Job Flow Monitor',
      subtitle: periodLabel,
      customer: opts.customer || '',
      reportDate,
      body: renderCallout({
        eyebrow: 'Diagnostic could not run',
        tone: 'danger',
        headline: 'Unable to produce a report.',
        body: msg,
      }),
    });
  }

  const m = result.metrics || {};
  const customer = opts.customer || m.customerName || '';
  const date = m.reportDate instanceof Date ? m.reportDate : reportDate;

  const sections = [
    buildHeadlineCallout(m),
    buildNarrative(m),
    buildPriorityTable(m),
    buildConstraintChart(m),
    buildRevenueChart(m),
    buildKpiStrip(m),
  ].filter(Boolean);

  return renderDocument({
    title: 'Job Flow Monitor',
    subtitle: periodLabel,
    customer,
    reportDate: date,
    head: CHART_CSS,
    body: sections.join('\n'),
  });
}

module.exports = { renderJobFlow };
