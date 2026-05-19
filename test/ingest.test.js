'use strict';

/**
 * test/ingest.test.js
 * Signal Logic Systems LLC
 *
 * Run with:  node test/ingest.test.js
 * No test framework required — pure Node.
 *
 * XLSX fixtures are built in-memory using SheetJS so no fixture files
 * are needed. This keeps the test self-contained and runnable anywhere.
 */

const XLSX = require('xlsx');
const { parseFile, parseCSV, parseXLSX } = require('../lib/ingest/parse-csv');

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
// XLSX fixture builder
// ---------------------------------------------------------------------------

/**
 * Build a minimal XLSX Buffer from an array of row arrays.
 * First row is treated as headers.
 *
 * @param {Array<Array<*>>} rows  e.g. [['Name','Value'],['Alpha',1]]
 * @param {string} [sheetName='Sheet1']
 * @returns {Buffer}
 */
function makeXLSX(rows, sheetName = 'Sheet1') {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Build a multi-sheet XLSX Buffer.
 * @param {Array<{ name: string, rows: Array<Array<*>> }>} sheets
 * @returns {Buffer}
 */
function makeMultiSheetXLSX(sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SIMPLE_CSV = `job_number,stage,due_date,job_value
JOB-001,Welding,2026-06-01,12500
JOB-002,QC,2026-05-28,8750
JOB-003,Welding,2026-06-15,3200
`;

const SIMPLE_XLSX_BUF = makeXLSX([
  ['job_number', 'stage', 'due_date', 'job_value'],
  ['JOB-001', 'Welding', '2026-06-01', 12500],
  ['JOB-002', 'QC', '2026-05-28', 8750],
  ['JOB-003', 'Welding', '2026-06-15', 3200],
]);

// ---------------------------------------------------------------------------
// CSV tests
// ---------------------------------------------------------------------------

console.log('\nlib/ingest/parse-csv.js — CSV\n');

test('parseCSV: parses simple CSV string', () => {
  const r = parseCSV(SIMPLE_CSV);
  assert(r.ok, r.error);
  assertEqual(r.rows.length, 3, 'row count');
  assertEqual(r.format, 'csv', 'format');
});

test('parseCSV: column names match header row', () => {
  const r = parseCSV(SIMPLE_CSV);
  assertDeepEqual(r.columns, ['job_number', 'stage', 'due_date', 'job_value'], 'columns');
});

test('parseCSV: row values are strings', () => {
  const r = parseCSV(SIMPLE_CSV);
  const row = r.rows[0];
  assertEqual(typeof row.job_value, 'string', 'job_value type');
  assertEqual(row.job_value, '12500', 'job_value');
});

test('parseCSV: values are trimmed', () => {
  const csv = 'name , value \n  Alpha  ,  42  \n';
  const r = parseCSV(csv);
  assertEqual(r.rows[0]['name'], 'Alpha', 'name trimmed');
  assertEqual(r.rows[0]['value'], '42', 'value trimmed');
});

test('parseCSV: accepts Buffer input', () => {
  const buf = Buffer.from(SIMPLE_CSV, 'utf8');
  const r = parseCSV(buf);
  assert(r.ok, r.error);
  assertEqual(r.rows.length, 3, 'row count');
});

test('parseCSV: filters blank rows', () => {
  const csv = 'a,b\n1,2\n\n\n3,4\n';
  const r = parseCSV(csv);
  assertEqual(r.rows.length, 2, 'row count after blank filter');
});

test('parseCSV: returns ok=true with warnings for malformed rows', () => {
  // Extra column in one row — PapaParse reports this but still parses
  const csv = 'a,b\n1,2\n3,4,EXTRA\n5,6\n';
  const r = parseCSV(csv);
  assert(r.ok, 'should still be ok');
  assert(Array.isArray(r.warnings), 'warnings is array');
});

test('parseCSV: empty CSV returns zero rows', () => {
  const r = parseCSV('');
  assert(r.ok, r.error);
  assertEqual(r.rows.length, 0, 'row count');
});

test('parseCSV: headers-only CSV returns zero rows', () => {
  const r = parseCSV('a,b,c\n');
  assert(r.ok, r.error);
  assertEqual(r.rows.length, 0, 'row count');
});

// ---------------------------------------------------------------------------
// XLSX tests
// ---------------------------------------------------------------------------

console.log('\nlib/ingest/parse-csv.js — XLSX\n');

test('parseXLSX: parses simple XLSX buffer', () => {
  const r = parseXLSX(SIMPLE_XLSX_BUF);
  assert(r.ok, r.error);
  assertEqual(r.rows.length, 3, 'row count');
  assertEqual(r.format, 'xlsx', 'format');
});

test('parseXLSX: column names match header row', () => {
  const r = parseXLSX(SIMPLE_XLSX_BUF);
  assertDeepEqual(r.columns, ['job_number', 'stage', 'due_date', 'job_value'], 'columns');
});

test('parseXLSX: row values are strings', () => {
  const r = parseXLSX(SIMPLE_XLSX_BUF);
  assertEqual(typeof r.rows[0].job_value, 'string', 'type');
  assertEqual(r.rows[0].job_number, 'JOB-001', 'job_number');
});

test('parseXLSX: numeric cell coerced to string', () => {
  const r = parseXLSX(SIMPLE_XLSX_BUF);
  assertEqual(r.rows[0].job_value, '12500', 'numeric as string');
});

test('parseXLSX: reports sheetName and availableSheets', () => {
  const r = parseXLSX(SIMPLE_XLSX_BUF);
  assertEqual(r.sheetName, 'Sheet1', 'sheetName');
  assertDeepEqual(r.availableSheets, ['Sheet1'], 'availableSheets');
});

test('parseXLSX: selects sheet by name', () => {
  const buf = makeMultiSheetXLSX([
    { name: 'Matrix Receipts', rows: [['item','qty'],['BOLT-10',50]] },
    { name: 'Invoices',        rows: [['inv_no','amount'],['INV-001',999]] },
  ]);
  const r = parseXLSX(buf, { sheet: 'Invoices' });
  assert(r.ok, r.error);
  assertEqual(r.sheetName, 'Invoices', 'sheetName');
  assertEqual(r.rows[0].inv_no, 'INV-001', 'inv_no');
});

test('parseXLSX: selects sheet by index', () => {
  const buf = makeMultiSheetXLSX([
    { name: 'Alpha', rows: [['x'],['1']] },
    { name: 'Beta',  rows: [['y'],['2']] },
  ]);
  const r = parseXLSX(buf, { sheetIndex: 1 });
  assert(r.ok, r.error);
  assertEqual(r.sheetName, 'Beta', 'sheetName');
});

test('parseXLSX: error on unknown sheet name', () => {
  const r = parseXLSX(SIMPLE_XLSX_BUF, { sheet: 'DoesNotExist' });
  assert(!r.ok, 'should fail');
  assert(r.error.includes('not found'), r.error);
});

test('parseXLSX: error on out-of-range sheet index', () => {
  const r = parseXLSX(SIMPLE_XLSX_BUF, { sheetIndex: 99 });
  assert(!r.ok, 'should fail');
  assert(r.error.includes('out of range'), r.error);
});

test('parseXLSX: invalid buffer returns empty result (SheetJS 0.18 behavior)', () => {
  // SheetJS 0.18.x does not throw on corrupt input — it returns an empty sheet.
  // The result is ok=true with zero rows and a warning, not an error.
  // The analyze layer will catch this via empty-input validation downstream.
  const r = parseXLSX(Buffer.from('this is not xlsx'));
  // Either ok=false (threw) or ok=true with zero rows — both are acceptable
  if (r.ok) {
    assertEqual(r.rows.length, 0, 'corrupt input should produce zero rows');
  } else {
    assert(r.error.length > 0, 'error message should be present');
  }
});

test('parseXLSX: empty sheet returns ok=true with zero rows and a warning', () => {
  const buf = makeXLSX([['a','b']]); // header only, no data rows
  const r = parseXLSX(buf);
  assert(r.ok, r.error);
  assertEqual(r.rows.length, 0, 'row count');
  assert(r.warnings.length > 0, 'should have warning');
});

// ---------------------------------------------------------------------------
// parseFile auto-detection tests
// ---------------------------------------------------------------------------

console.log('\nlib/ingest/parse-csv.js — parseFile (auto-detect)\n');

test('parseFile: detects CSV string', () => {
  const r = parseFile(SIMPLE_CSV);
  assert(r.ok, r.error);
  assertEqual(r.format, 'csv', 'format');
});

test('parseFile: detects XLSX buffer via magic bytes', () => {
  const r = parseFile(SIMPLE_XLSX_BUF);
  assert(r.ok, r.error);
  assertEqual(r.format, 'xlsx', 'format');
  assertEqual(r.rows.length, 3, 'row count');
});

test('parseFile: filename hint .csv forces CSV parser', () => {
  const r = parseFile(SIMPLE_CSV, { filename: 'jobs_export.csv' });
  assert(r.ok, r.error);
  assertEqual(r.format, 'csv', 'format');
});

test('parseFile: filename hint .xlsx forces XLSX parser', () => {
  const r = parseFile(SIMPLE_XLSX_BUF, { filename: 'matrix_receipts.xlsx' });
  assert(r.ok, r.error);
  assertEqual(r.format, 'xlsx', 'format');
});

test('parseFile: opts.format csv override', () => {
  const r = parseFile(SIMPLE_CSV, { format: 'csv' });
  assert(r.ok, r.error);
  assertEqual(r.format, 'csv', 'format');
});

test('parseFile: opts.format xlsx override', () => {
  const r = parseFile(SIMPLE_XLSX_BUF, { format: 'xlsx' });
  assert(r.ok, r.error);
  assertEqual(r.format, 'xlsx', 'format');
});

test('parseFile: returns error on null input', () => {
  const r = parseFile(null);
  assert(!r.ok, 'should fail');
  assert(r.error.includes('No input'), r.error);
});

test('parseFile: passes sheet option through to XLSX parser', () => {
  const buf = makeMultiSheetXLSX([
    { name: 'Matrix Receipts', rows: [['item','qty'],['BOLT-10',50]] },
    { name: 'Proper 21',       rows: [['inv_no','amount'],['INV-001',999]] },
  ]);
  const r = parseFile(buf, { sheet: 'Proper 21' });
  assert(r.ok, r.error);
  assertEqual(r.sheetName, 'Proper 21', 'sheetName');
  assertEqual(r.rows[0].inv_no, 'INV-001', 'correct sheet data');
});

// Blue Ash specific: two-file ingest simulation
test('parseFile: Blue Ash scenario — Matrix XLSX + Proper 21 XLSX parsed independently', () => {
  const matrixBuf = makeXLSX([
    ['PO_Number', 'Item', 'Qty_Received', 'Unit_Price', 'Receipt_Date'],
    ['PO-1001', 'BOLT-M10x50', '100', '0.45', '2026-05-01'],
    ['PO-1002', 'WASHER-M10',  '200', '0.12', '2026-05-03'],
  ]);
  const proper21Buf = makeXLSX([
    ['Invoice_No', 'PO_Number', 'Item', 'Qty_Invoiced', 'Unit_Price', 'Invoice_Date'],
    ['INV-5001', 'PO-1001', 'BOLT-M10x50', '100', '0.45', '2026-05-02'],
    ['INV-5002', 'PO-1002', 'WASHER-M10',  '180', '0.12', '2026-05-04'], // qty mismatch
  ]);

  const matrixResult  = parseFile(matrixBuf,  { filename: 'matrix_receipts.xlsx' });
  const proper21Result = parseFile(proper21Buf, { filename: 'proper21_invoices.xlsx' });

  assert(matrixResult.ok,   matrixResult.error);
  assert(proper21Result.ok, proper21Result.error);
  assertEqual(matrixResult.rows.length,   2, 'matrix rows');
  assertEqual(proper21Result.rows.length, 2, 'proper21 rows');

  // Spot-check the mismatch row is present and readable
  const mismatchRow = proper21Result.rows.find(r => r.Invoice_No === 'INV-5002');
  assert(mismatchRow, 'mismatch row found');
  assertEqual(mismatchRow.Qty_Invoiced, '180', 'mismatched qty');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
