'use strict';

/**
 * test/analyze-job-flow.test.js
 * Signal Logic Systems LLC
 *
 * Run with:  node test/analyze-job-flow.test.js
 * No test framework required — pure Node.
 *
 * Covers the JFM engine:
 *   - lib/analyze/job-flow/constraint.js
 *   - lib/analyze/job-flow/revenue-at-risk.js
 *   - lib/analyze/job-flow/priority-rank.js
 *   - lib/analyze/job-flow/index.js  (composer)
 *
 * `today` is pinned with the local Date(y, m, d) constructor so day math
 * is deterministic regardless of the machine's timezone. The pipeline
 * test (parseCSV → normalize → analyzeJobFlow) asserts only tz-robust
 * facts.
 */

const { isActive, filterActive, findConstraint } = require('../lib/analyze/job-flow/constraint');
const { inferStageOrder, revenueAtRisk, cascade } = require('../lib/analyze/job-flow/revenue-at-risk');
const { daysOverdue, isPastDue, rankPriority, supportingMetrics } = require('../lib/analyze/job-flow/priority-rank');
const { analyzeJobFlow } = require('../lib/analyze/job-flow');

const { parseCSV } = require('../lib/ingest/parse-csv');
const { normalize } = require('../lib/normalize/column-mapper');
const jobsSchema = require('../lib/normalize/schemas/jobs');

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${label}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'Value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label || 'Value'}:\n  expected ${b}\n  got     ${a}`);
}

// ---------------------------------------------------------------------------
// Shared fixture: normalized job rows + pinned "today"
// ---------------------------------------------------------------------------

const TODAY = new Date(2026, 4, 19); // 2026-05-19 local midnight
const d = (y, m, day) => new Date(y, m - 1, day);

function fixtureJobs() {
  return [
    { job_number: 'JOB-001', stage: 'Welding',   job_value: 10000, due_date: d(2026,5,1),  order_date: d(2026,4,1),  customer: 'Acme', part_number: 'P1', description: 'x' },
    { job_number: 'JOB-002', stage: 'Welding',   job_value: 5000,  due_date: d(2026,6,1),  order_date: d(2026,4,5),  customer: '',     part_number: '',  description: '' },
    { job_number: 'JOB-003', stage: 'QC',        job_value: 8000,  due_date: d(2026,5,10), order_date: d(2026,4,10), customer: '',     part_number: '',  description: '' },
    { job_number: 'JOB-004', stage: 'Machining', job_value: 20000, due_date: d(2026,5,15), order_date: d(2026,3,1),  customer: '',     part_number: '',  description: '' },
    { job_number: 'JOB-005', stage: 'Shipped',   job_value: 9999,  due_date: d(2026,4,1),  order_date: d(2026,2,1),  customer: '',     part_number: '',  description: '' },
  ];
}

// ---------------------------------------------------------------------------
// constraint.js
// ---------------------------------------------------------------------------

console.log('\nlib/analyze/job-flow/constraint.js\n');

test('isActive: terminal stage is inactive', () => {
  assertEqual(isActive({ stage: 'Shipped' }), false, 'Shipped');
  assertEqual(isActive({ stage: 'closed' }), false, 'closed (case-insensitive)');
});

test('isActive: non-terminal and empty stages are active', () => {
  assertEqual(isActive({ stage: 'Welding' }), true, 'Welding');
  assertEqual(isActive({ stage: '' }), true, 'empty stage active');
});

test('filterActive: drops terminal jobs', () => {
  const active = filterActive(fixtureJobs());
  assertEqual(active.length, 4, 'JOB-005 (Shipped) excluded');
  assert(!active.some(j => j.job_number === 'JOB-005'), 'no shipped job');
});

test('findConstraint: highest-count stage wins', () => {
  const active = filterActive(fixtureJobs());
  const c = findConstraint(active);
  assertEqual(c.stage, 'Welding', 'constraint stage');
  assertEqual(c.jobsAtConstraint, 2, 'jobs at constraint');
  assertEqual(c.counts.Welding, 2, 'Welding count');
  assertEqual(c.values.Welding, 15000, 'Welding revenue');
});

test('findConstraint: tie broken by revenue held', () => {
  const jobs = [
    { stage: 'A', job_value: 100 },
    { stage: 'B', job_value: 900 }, // same count as A, higher value
  ];
  const c = findConstraint(jobs);
  assertEqual(c.stage, 'B', 'higher-value stage wins tie');
});

test('findConstraint: empty stage bucketed as Unknown', () => {
  const c = findConstraint([{ stage: '', job_value: 50 }]);
  assertEqual(c.stage, 'Unknown', 'Unknown bucket');
  assertEqual(c.values.Unknown, 50, 'value tallied');
});

// ---------------------------------------------------------------------------
// revenue-at-risk.js
// ---------------------------------------------------------------------------

console.log('\nlib/analyze/job-flow/revenue-at-risk.js\n');

test('inferStageOrder: known stages follow canonical sequence', () => {
  const order = inferStageOrder(filterActive(fixtureJobs()));
  assertDeepEqual(order, ['Machining', 'Welding', 'QC'], 'canonical order');
});

test('inferStageOrder: unknown stages ranked by median age (oldest first)', () => {
  const now = d(2026, 5, 19).getTime();
  const jobs = [
    { stage: 'Foo', order_date: d(2026, 1, 1) }, // older → earlier
    { stage: 'Bar', order_date: d(2026, 4, 1) },
  ];
  const order = inferStageOrder(jobs, now);
  assertDeepEqual(order, ['Foo', 'Bar'], 'oldest unknown first');
});

test('revenueAtRisk: sums job_value at the constraint stage only', () => {
  const active = filterActive(fixtureJobs());
  assertEqual(revenueAtRisk(active, 'Welding'), 15000, 'Welding revenue at risk');
});

test('revenueAtRisk: null job_value counts as 0', () => {
  const r = revenueAtRisk([{ stage: 'X', job_value: null }, { stage: 'X', job_value: 7 }], 'X');
  assertEqual(r, 7, 'null treated as 0');
});

test('cascade: sums upstream stages when order is established', () => {
  const active = filterActive(fixtureJobs());
  const order = inferStageOrder(active);
  const { cascadeTotal, upstreamStages } = cascade(active, 'Welding', order);
  assertDeepEqual(upstreamStages, ['Machining'], 'upstream stages');
  assertEqual(cascadeTotal, 20000, 'cascade = Machining value');
});

test('cascade: falls back to all non-constraint when constraint is first', () => {
  const active = filterActive(fixtureJobs());
  const order = inferStageOrder(active); // [Machining, Welding, QC]
  const { cascadeTotal, upstreamStages } = cascade(active, 'Machining', order);
  assertEqual(upstreamStages.length, 0, 'no upstream');
  // all non-Machining active value: Welding 15000 + QC 8000 = 23000
  assertEqual(cascadeTotal, 23000, 'fallback total');
});

// ---------------------------------------------------------------------------
// priority-rank.js
// ---------------------------------------------------------------------------

console.log('\nlib/analyze/job-flow/priority-rank.js\n');

test('daysOverdue: whole-day delta vs pinned today', () => {
  assertEqual(daysOverdue(d(2026, 5, 1), TODAY), 18, '18 days late');
  assertEqual(daysOverdue(d(2026, 6, 1), TODAY), 0, 'future due = 0');
  assertEqual(daysOverdue(null, TODAY), 0, 'no due date = 0');
});

test('isPastDue: strictly before start of today', () => {
  assertEqual(isPastDue(d(2026, 5, 1), TODAY), true, 'past');
  assertEqual(isPastDue(d(2026, 6, 1), TODAY), false, 'future');
  assertEqual(isPastDue(null, TODAY), false, 'no due date');
});

test('rankPriority: past-due only, sorted by score desc, scrubbed shape', () => {
  const active = filterActive(fixtureJobs());
  const ranked = rankPriority(active, { today: TODAY });
  assertEqual(ranked.length, 3, 'three past-due jobs');
  assertDeepEqual(
    ranked.map(j => j.job_number),
    ['JOB-001', 'JOB-004', 'JOB-003'],
    'score order: 180000, 80000, 72000'
  );
  // Scrubbed: only derived fields, no part_number/description
  assertDeepEqual(
    Object.keys(ranked[0]).sort(),
    ['customer', 'days_overdue', 'is_past_due', 'job_number', 'job_value', 'score', 'stage'],
    'derived-only shape'
  );
  assert(!('part_number' in ranked[0]), 'raw field not leaked');
});

test('rankPriority: limit caps the list', () => {
  const active = filterActive(fixtureJobs());
  const ranked = rankPriority(active, { today: TODAY, limit: 2 });
  assertEqual(ranked.length, 2, 'limited to 2');
});

test('supportingMetrics: matches hand-computed values', () => {
  const active = filterActive(fixtureJobs());
  const m = supportingMetrics(active, { today: TODAY });
  assertEqual(m.pastDueCount, 3, 'past due count');
  assertEqual(m.avgDaysLate, 10, 'avg days late round((18+9+4)/3)');
  assertEqual(m.totalValue, 43000, 'total active value');
  assertEqual(m.onTimeRate, 25, 'on-time rate round(1/4*100)');
  assertEqual(m.hasValue, true, 'has value');
  assertEqual(m.hasDueDate, true, 'has due date');
});

// ---------------------------------------------------------------------------
// index.js — composer
// ---------------------------------------------------------------------------

console.log('\nlib/analyze/job-flow/index.js — analyzeJobFlow\n');

test('analyzeJobFlow: returns ok:false when no active jobs', () => {
  const r = analyzeJobFlow([{ job_number: 'X', stage: 'Shipped' }], { today: TODAY });
  assert(!r.ok, 'should fail');
  assert(r.error.includes('No active jobs'), r.error);
});

test('analyzeJobFlow: full metrics object matches hand-computed values', () => {
  const r = analyzeJobFlow(fixtureJobs(), { today: TODAY });
  assert(r.ok, r.error);
  const m = r.metrics;
  assertEqual(m.totalRecords, 5, 'total records (pre-filter)');
  assertEqual(m.totalJobs, 4, 'active jobs');
  assertEqual(m.constraint, 'Welding', 'constraint');
  assertEqual(m.jobsAtConstraint, 2, 'jobs at constraint');
  assertEqual(m.revenueAtRisk, 15000, 'revenue at risk');
  assertEqual(m.cascadeTotal, 20000, 'cascade total');
  assertEqual(m.totalValue, 43000, 'total value');
  assertEqual(m.pastDueCount, 3, 'past due');
  assertEqual(m.onTimeRate, 25, 'on-time rate');
  assertDeepEqual(m.stageOrder, ['Machining', 'Welding', 'QC'], 'stage order');
  assertDeepEqual(m.upstreamStages, ['Machining'], 'upstream');
  assertEqual(m.customerName, 'Acme', 'first customer');
  assertEqual(m.priorityJobs[0].job_number, 'JOB-001', 'top priority job');
});

test('analyzeJobFlow: metrics shape matches the Phase 1 render contract', () => {
  const r = analyzeJobFlow(fixtureJobs(), { today: TODAY });
  const expected = [
    'avgDaysLate', 'cascadeTotal', 'constraint', 'customerName', 'hasDueDate',
    'hasValue', 'jobsAtConstraint', 'onTimeRate', 'pastDueCount', 'priorityJobs',
    'reportDate', 'revenueAtRisk', 'stageCounts', 'stageOrder', 'stageValues',
    'totalJobs', 'totalRecords', 'totalValue', 'upstreamStages',
  ];
  assertDeepEqual(Object.keys(r.metrics).sort(), expected, 'metrics keys');
});

test('analyzeJobFlow: totalRecords override is honored', () => {
  const r = analyzeJobFlow(fixtureJobs(), { today: TODAY, totalRecords: 999 });
  assertEqual(r.metrics.totalRecords, 999, 'override');
});

// ---------------------------------------------------------------------------
// End-to-end pipeline: parseCSV → normalize → analyzeJobFlow
// ---------------------------------------------------------------------------

console.log('\nJFM pipeline — parseCSV → normalize → analyzeJobFlow\n');

test('pipeline: messy ERP CSV flows through to a diagnostic', () => {
  const csv = `Job #,Work Center,Due Date,Est Total Price,Customer Name
J-100,Welding,2026-05-01,"$10,000.00",Acme Pumps
J-101,Welding,2026-06-01,"$5,000.00",Acme Pumps
J-102,QC,2026-05-10,"$8,000.00",Acme Pumps
J-103,Machining,2026-05-15,"$20,000.00",Acme Pumps
J-104,Shipped,2026-04-01,"$9,999.00",Acme Pumps`;

  const parsed = parseCSV(csv);
  assert(parsed.ok, 'parse ok');

  const norm = normalize(parsed, jobsSchema);
  assert(norm.ok, norm.error);
  assertEqual(norm.rows.length, 5, 'normalized rows');

  const result = analyzeJobFlow(norm.rows, { today: TODAY });
  assert(result.ok, result.error);
  assertEqual(result.metrics.totalJobs, 4, 'Shipped excluded');
  assertEqual(result.metrics.constraint, 'Welding', 'constraint');
  assertEqual(result.metrics.jobsAtConstraint, 2, 'jobs at constraint');
  assertEqual(result.metrics.revenueAtRisk, 15000, 'revenue at risk');
  assertEqual(result.metrics.customerName, 'Acme Pumps', 'customer name');
  assertEqual(result.metrics.hasValue, true, 'value detected');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
