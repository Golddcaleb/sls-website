'use strict';

/**
 * test/detect-inventory-side.test.js
 * Signal Logic Systems LLC
 *
 * Run with:  node test/detect-inventory-side.test.js
 *
 * Covers lib/ingest/detect-inventory-side.js — the header-signature
 * classifier that decides which of two uploaded files is Matrix and
 * which is Proper 21, independent of which drop zone the user used.
 */

const { classifyColumns, assignSides } = require('../lib/ingest/detect-inventory-side');

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

// ---------------------------------------------------------------------------
// Real header sets from the DRT exports (sample-data/)
// ---------------------------------------------------------------------------

const REAL_MATRIX_COLS = [
  'Create Date (+Time)', 'Item Code', 'PO Code', 'Bin Code', 'Quantity',
  'Single Item \r\nValue', 'Value', 'Remarks', 'PO Detail',
];

const REAL_P21_COLS = [
  'invoice_date', 'customer_part_number', 'po_no', 'item_id', 'item_desc',
  'qty_shipped', 'unit_price', 'extended_price', 'order_no', 'Column1',
];

// ---------------------------------------------------------------------------
// classifyColumns
// ---------------------------------------------------------------------------

console.log('\nlib/ingest/detect-inventory-side — classifyColumns\n');

test('classifies the real DRT Matrix header set as matrix', () => {
  const r = classifyColumns(REAL_MATRIX_COLS);
  assertEqual(r.side, 'matrix', 'side');
  assert(r.matrix.strongHits > 0, 'has strong hits');
  assert(r.matrix.score > r.proper21.score, 'matrix outscores proper21');
});

test('classifies the real DRT Proper 21 header set as proper21', () => {
  const r = classifyColumns(REAL_P21_COLS);
  assertEqual(r.side, 'proper21', 'side');
  assert(r.proper21.strongHits > 0, 'has strong hits');
  assert(r.proper21.score > r.matrix.score, 'proper21 outscores matrix');
});

test('empty / unknown header set is ambiguous', () => {
  const r = classifyColumns(['col_a', 'col_b', 'thing']);
  assertEqual(r.side, 'ambiguous', 'ambiguous');
  assert(r.reason.length > 0, 'reason given');
});

test('a single weak hit on each side is too close to call', () => {
  // 'item_code' is Matrix-weak; 'invoice_date' is P21-weak. One hit
  // each shouldn't be enough to win.
  const r = classifyColumns(['item_code', 'invoice_date', 'misc']);
  assertEqual(r.side, 'ambiguous', 'ambiguous');
});

test('strong markers tolerate header noise around them', () => {
  // Same Matrix strongs as the real DRT export, plus random extras.
  const r = classifyColumns([
    'PO Code', 'PO Detail', 'Single Item Value', 'Bin Code',
    'Random Extra', 'Another Thing',
  ]);
  assertEqual(r.side, 'matrix', 'matrix wins');
});

// ---------------------------------------------------------------------------
// assignSides
// ---------------------------------------------------------------------------

console.log('\nlib/ingest/detect-inventory-side — assignSides\n');

test('matrix in slot A, p21 in slot B: ok, not swapped', () => {
  const r = assignSides(
    { name: 'receiving.xlsx',  columns: REAL_MATRIX_COLS },
    { name: 'invoices.csv',    columns: REAL_P21_COLS },
  );
  assert(r.ok, r.error);
  assertEqual(r.swapped, false, 'not swapped');
  assertEqual(r.matrix.name, 'receiving.xlsx', 'matrix from slot A');
  assertEqual(r.proper21.name, 'invoices.csv', 'p21 from slot B');
});

test('p21 in slot A, matrix in slot B: ok, swapped flag set', () => {
  const r = assignSides(
    { name: 'invoices.csv',    columns: REAL_P21_COLS },
    { name: 'receiving.xlsx',  columns: REAL_MATRIX_COLS },
  );
  assert(r.ok, r.error);
  assertEqual(r.swapped, true, 'swap detected');
  assertEqual(r.matrix.name, 'receiving.xlsx', 'matrix routed from slot B');
  assertEqual(r.proper21.name, 'invoices.csv', 'p21 routed from slot A');
});

test('two Matrix files: refused with ambiguity error', () => {
  const r = assignSides(
    { name: 'recv-a.xlsx', columns: REAL_MATRIX_COLS },
    { name: 'recv-b.xlsx', columns: REAL_MATRIX_COLS },
  );
  assert(!r.ok, 'should fail');
  assert(r.error.includes('Could not tell'), 'human-readable error');
  assert(r.error.includes('recv-a.xlsx'), 'names slot A file');
  assert(r.error.includes('recv-b.xlsx'), 'names slot B file');
});

test('two Proper 21 files: refused with ambiguity error', () => {
  const r = assignSides(
    { name: 'inv-a.csv', columns: REAL_P21_COLS },
    { name: 'inv-b.csv', columns: REAL_P21_COLS },
  );
  assert(!r.ok, 'should fail');
  assert(r.error.includes('Could not tell'), 'error');
});

test('one unrecognized file: refused, error names the unknown one', () => {
  const r = assignSides(
    { name: 'recv.xlsx',   columns: REAL_MATRIX_COLS },
    { name: 'mystery.xlsx', columns: ['foo', 'bar', 'baz'] },
  );
  assert(!r.ok, 'should fail');
  assert(r.error.includes('mystery.xlsx'), 'names the unknown file');
  assert(r.error.includes('ambiguous'), 'flags ambiguity');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
