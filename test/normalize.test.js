'use strict';

/**
 * test/normalize.test.js
 * Signal Logic Systems LLC
 *
 * Run with:  node test/normalize.test.js
 * No test framework required — pure Node.
 *
 * Covers lib/normalize/column-mapper.js and the two schemas it drives:
 *   - schemas/jobs.js       (JFM)
 *   - schemas/inventory.js  (Blue Ash ship-vs-invoice)
 *
 * The Blue Ash fixtures reuse the exact headers from test/ingest.test.js
 * so the ingest → normalize handoff is exercised against the real
 * two-file scenario.
 */

const {
  normalize,
  buildMapping,
  applyMapping,
  coerceValue,
  normalizeHeader,
  tokenBoundaryMatch,
} = require('../lib/normalize/column-mapper');

const jobsSchema      = require('../lib/normalize/schemas/jobs');
const inventorySchema = require('../lib/normalize/schemas/inventory');
const { parseCSV }    = require('../lib/ingest/parse-csv');

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
// normalizeHeader
// ---------------------------------------------------------------------------

console.log('\nlib/normalize/column-mapper.js — normalizeHeader\n');

test('normalizeHeader: lowercases and collapses separators', () => {
  assertEqual(normalizeHeader('Due Date'), 'due_date', 'space');
  assertEqual(normalizeHeader('Due_Date'), 'due_date', 'underscore');
  assertEqual(normalizeHeader('Due-Date'), 'due_date', 'dash');
  assertEqual(normalizeHeader('Due.Date'), 'due_date', 'dot');
  assertEqual(normalizeHeader('Due   Date'), 'due_date', 'multi-space');
});

test('normalizeHeader: trims stray leading/trailing separators', () => {
  assertEqual(normalizeHeader('  Due Date  '), 'due_date', 'padded');
  assertEqual(normalizeHeader('_Job_Number_'), 'job_number', 'underscore wrap');
});

test('normalizeHeader: preserves # so job# variants still match', () => {
  assertEqual(normalizeHeader('Job#'), 'job#', 'hash kept');
  assertEqual(normalizeHeader('Job #'), 'job_#', 'hash + space');
});

test('normalizeHeader: handles null/undefined safely', () => {
  assertEqual(normalizeHeader(null), '', 'null');
  assertEqual(normalizeHeader(undefined), '', 'undefined');
});

// ---------------------------------------------------------------------------
// tokenBoundaryMatch
// ---------------------------------------------------------------------------

console.log('\nlib/normalize/column-mapper.js — tokenBoundaryMatch\n');

test('tokenBoundaryMatch: equal strings match', () => {
  assert(tokenBoundaryMatch('due_date', 'due_date'), 'equal');
});

test('tokenBoundaryMatch: contiguous token sublist matches', () => {
  assert(tokenBoundaryMatch('due_date', 'due'), 'short inside long');
  assert(tokenBoundaryMatch('job', 'job_no'), 'long contains short other way');
  assert(tokenBoundaryMatch('customer_name_field', 'customer_name'), 'mid run');
});

test('tokenBoundaryMatch: non-token substring does NOT match', () => {
  // "due" is not a token of "overdue_flag" ("overdue" !== "due")
  assert(!tokenBoundaryMatch('overdue_flag', 'due'), 'partial token rejected');
});

test('tokenBoundaryMatch: empty inputs do not match', () => {
  assert(!tokenBoundaryMatch('', 'due'), 'empty a');
  assert(!tokenBoundaryMatch('due', ''), 'empty b');
});

// ---------------------------------------------------------------------------
// coerceValue
// ---------------------------------------------------------------------------

console.log('\nlib/normalize/column-mapper.js — coerceValue\n');

test('coerceValue: string trims', () => {
  assertEqual(coerceValue('  Welding  ', 'string'), 'Welding', 'trim');
  assertEqual(coerceValue('', 'string'), '', 'empty stays empty');
  assertEqual(coerceValue(null, 'string'), '', 'null -> empty');
});

test('coerceValue: number strips $ and commas', () => {
  assertEqual(coerceValue('$12,500.50', 'number'), 12500.5, 'currency');
  assertEqual(coerceValue('  3200 ', 'number'), 3200, 'padded int');
});

test('coerceValue: accounting parentheses become negative', () => {
  assertEqual(coerceValue('(1,234.50)', 'number'), -1234.5, 'paren negative');
});

test('coerceValue: unparseable number returns null (not 0)', () => {
  assertEqual(coerceValue('', 'number'), null, 'empty');
  assertEqual(coerceValue('N/A', 'number'), null, 'text');
  assertEqual(coerceValue(null, 'number'), null, 'null');
});

test('coerceValue: date returns a Date or null', () => {
  const d = coerceValue('2026-06-01', 'date');
  assert(d instanceof Date && !isNaN(d.getTime()), 'valid date');
  assertEqual(coerceValue('', 'date'), null, 'empty date');
  assertEqual(coerceValue('not-a-date', 'date'), null, 'garbage date');
});

// ---------------------------------------------------------------------------
// buildMapping
// ---------------------------------------------------------------------------

console.log('\nlib/normalize/column-mapper.js — buildMapping\n');

test('buildMapping: exact match maps clean headers', () => {
  const r = buildMapping(['Job_Number', 'Status', 'Due_Date', 'Total_Price'], jobsSchema);
  assertEqual(r.mapping.job_number, 'Job_Number', 'job_number');
  assertEqual(r.mapping.stage, 'Status', 'stage');
  assertEqual(r.mapping.due_date, 'Due_Date', 'due_date');
  assertEqual(r.mapping.job_value, 'Total_Price', 'job_value');
  assertEqual(r.missingRequired.length, 0, 'no missing required');
});

test('buildMapping: a source header is consumed by only one field', () => {
  // "Part" matches part_number; ensure it is not also reused elsewhere.
  const r = buildMapping(['WO', 'Operation', 'Part', 'Description'], jobsSchema);
  const claimed = Object.values(r.mapping);
  const unique = new Set(claimed);
  assertEqual(claimed.length, unique.size, 'no header used twice');
});

test('buildMapping: missing required field is reported', () => {
  const r = buildMapping(['Status', 'Due_Date'], jobsSchema); // no job number
  assert(r.missingRequired.includes('job_number'), 'job_number missing');
  assert(!r.missingRequired.includes('stage'), 'stage present');
});

test('buildMapping: missing preferred field is classified separately', () => {
  const r = buildMapping(['Job', 'Status'], jobsSchema); // no due_date / job_value
  assertEqual(r.missingRequired.length, 0, 'required all present');
  assert(r.missingPreferred.includes('due_date'), 'due_date preferred-missing');
  assert(r.missingPreferred.includes('job_value'), 'job_value preferred-missing');
});

test('buildMapping: unrecognized columns are reported', () => {
  const r = buildMapping(['Job', 'Status', 'Foreman', 'Shift'], jobsSchema);
  assert(r.unmappedColumns.includes('Foreman'), 'Foreman unmapped');
  assert(r.unmappedColumns.includes('Shift'), 'Shift unmapped');
});

test('buildMapping: two columns matching the same variant warn but still map', () => {
  // Two headers that normalize to the SAME variant ("job") — a genuine
  // collision. First wins; a warning is emitted.
  const r = buildMapping(['Job', 'Job', 'Status'], jobsSchema);
  assertEqual(r.mapping.job_number, 'Job', 'job_number still mapped');
  assert(r.warnings.some(w => w.includes('multiple columns')), 'warned on dup');
});

test('buildMapping: distinct job-ish columns — first claims, second left unmapped', () => {
  // "Job" and "Job_No" normalize differently; "Job" (declared-order first
  // variant hit) claims job_number, "Job_No" becomes an unmapped column.
  const r = buildMapping(['Job', 'Job_No', 'Status'], jobsSchema);
  assertEqual(r.mapping.job_number, 'Job', 'first job-ish header wins');
  assert(r.unmappedColumns.includes('Job_No'), 'second left unmapped, not double-claimed');
});

test('buildMapping: fuzzy fallback maps a near-miss header', () => {
  // "Job Due" -> normalized "job_due"; token-boundary contains variant "due"
  const r = buildMapping(['Job', 'Status', 'Job Due'], jobsSchema);
  assertEqual(r.mapping.due_date, 'Job Due', 'fuzzy due_date');
});

// ---------------------------------------------------------------------------
// applyMapping
// ---------------------------------------------------------------------------

console.log('\nlib/normalize/column-mapper.js — applyMapping\n');

test('applyMapping: emits only schema fields, type-coerced', () => {
  const rows = [{ Job: 'JOB-001', Status: 'Welding', Total: '$12,500', Foreman: 'Dave' }];
  const { mapping } = buildMapping(Object.keys(rows[0]), jobsSchema);
  const out = applyMapping(rows, jobsSchema, mapping);
  const keys = Object.keys(out[0]).sort();
  assertDeepEqual(keys, Object.keys(jobsSchema.fields).sort(), 'only schema fields');
  assertEqual(out[0].job_number, 'JOB-001', 'job_number');
  assertEqual(out[0].job_value, 12500, 'job_value coerced to number');
  assert(!('Foreman' in out[0]), 'raw extra column dropped');
});

test('applyMapping: unmapped optional fields are null/empty', () => {
  const rows = [{ Job: 'JOB-001', Status: 'QC' }];
  const { mapping } = buildMapping(Object.keys(rows[0]), jobsSchema);
  const out = applyMapping(rows, jobsSchema, mapping);
  assertEqual(out[0].job_value, null, 'number field null when absent');
  assertEqual(out[0].due_date, null, 'date field null when absent');
  assertEqual(out[0].customer, '', 'string field empty when absent');
});

// ---------------------------------------------------------------------------
// normalize — JFM jobs schema
// ---------------------------------------------------------------------------

console.log('\nlib/normalize — normalize() with jobs schema (JFM)\n');

test('normalize: accepts a parse-csv ParseResult', () => {
  const csv = `Job_Number,Status,Due_Date,Total_Price
JOB-001,Welding,2026-06-01,12500
JOB-002,QC,2026-05-28,8750`;
  const parsed = parseCSV(csv);
  const r = normalize(parsed, jobsSchema);
  assert(r.ok, r.error);
  assertEqual(r.rows.length, 2, 'row count');
  assertEqual(r.rows[0].job_number, 'JOB-001', 'job_number');
  assertEqual(r.rows[0].job_value, 12500, 'job_value numeric');
  assert(r.rows[0].due_date instanceof Date, 'due_date is Date');
});

test('normalize: accepts a bare rows array (columns inferred)', () => {
  const rows = [{ WO: 'A-1', Operation: 'Assembly' }];
  const r = normalize(rows, jobsSchema);
  assert(r.ok, r.error);
  assertEqual(r.rows[0].job_number, 'A-1', 'job_number');
  assertEqual(r.rows[0].stage, 'Assembly', 'stage');
});

test('normalize: fails with ok:false when a required field is unmapped', () => {
  const csv = `Status,Due_Date\nWelding,2026-06-01`;
  const r = normalize(parseCSV(csv), jobsSchema);
  assert(!r.ok, 'should fail');
  assert(r.missing.includes('job_number'), 'reports job_number missing');
  assert(r.error.includes('Missing required'), r.error);
  assertEqual(r.rows.length, 0, 'no rows on failure');
});

test('normalize: succeeds with a warning when a preferred field is unmapped', () => {
  const csv = `Job,Status\nJOB-001,Welding`;
  const r = normalize(parseCSV(csv), jobsSchema);
  assert(r.ok, 'should still succeed');
  assert(
    r.warnings.some(w => w.includes('due_date') || w.includes('job_value')),
    'preferred-missing warning present'
  );
});

test('normalize: Phase 1 parity — dashboard.js fixture headers map identically', () => {
  // Same headers/values as test/ingest.test.js SIMPLE_CSV
  const csv = `job_number,stage,due_date,job_value
JOB-001,Welding,2026-06-01,12500
JOB-002,QC,2026-05-28,8750
JOB-003,Welding,2026-06-15,3200`;
  const r = normalize(parseCSV(csv), jobsSchema);
  assert(r.ok, r.error);
  assertEqual(r.mapping.job_number, 'job_number', 'job_number');
  assertEqual(r.mapping.stage, 'stage', 'stage');
  assertEqual(r.mapping.due_date, 'due_date', 'due_date');
  assertEqual(r.mapping.job_value, 'job_value', 'job_value');
  assertEqual(r.rows.length, 3, 'rows');
  assertEqual(r.rows[2].job_value, 3200, 'last row value');
});

test('normalize: messy JobBOSS-style headers still resolve', () => {
  // Currency field is quoted because it contains a comma — exactly how a
  // real ERP CSV export emits it.
  const csv = `Job #,Work Center,Promised Date,Est Total Price,Customer Name
J-100,Machining,2026-07-01,"$45,000.00",Acme Pumps`;
  const r = normalize(parseCSV(csv), jobsSchema);
  assert(r.ok, r.error);
  assertEqual(r.rows[0].job_number, 'J-100', 'job_number');
  assertEqual(r.rows[0].stage, 'Machining', 'stage');
  assertEqual(r.rows[0].job_value, 45000, 'currency parsed');
  assertEqual(r.rows[0].customer, 'Acme Pumps', 'customer');
});

test('normalize: invalid schema returns ok:false', () => {
  const r = normalize([{ a: 1 }], { name: 'broken' });
  assert(!r.ok, 'should fail');
  assert(r.error.includes('schema'), r.error);
});

// ---------------------------------------------------------------------------
// normalize — Blue Ash inventory schema (two-file ship-vs-invoice)
// ---------------------------------------------------------------------------

console.log('\nlib/normalize — normalize() with inventory schema (Blue Ash)\n');

// Headers mirror test/ingest.test.js Blue Ash scenario exactly.
const MATRIX_CSV = `PO_Number,Item,Qty_Received,Unit_Price,Receipt_Date
PO-1001,BOLT-M10x50,100,0.45,2026-05-01
PO-1002,WASHER-M10,200,0.12,2026-05-03`;

const PROPER21_CSV = `Invoice_No,PO_Number,Item,Qty_Invoiced,Unit_Price,Invoice_Date
INV-5001,PO-1001,BOLT-M10x50,100,0.45,2026-05-02
INV-5002,PO-1002,WASHER-M10,180,0.12,2026-05-04`;

test('normalize: Matrix receipts export maps into shared inventory shape', () => {
  const r = normalize(parseCSV(MATRIX_CSV), inventorySchema);
  assert(r.ok, r.error);
  assertEqual(r.mapping.po_number, 'PO_Number', 'po_number');
  assertEqual(r.mapping.item, 'Item', 'item');
  assertEqual(r.mapping.quantity, 'Qty_Received', 'qty_received -> quantity');
  assertEqual(r.mapping.unit_price, 'Unit_Price', 'unit_price');
  assertEqual(r.rows[0].quantity, 100, 'qty numeric');
  assertEqual(r.rows[1].item, 'WASHER-M10', 'second item');
});

test('normalize: Proper 21 invoices export maps into the SAME shape', () => {
  const r = normalize(parseCSV(PROPER21_CSV), inventorySchema);
  assert(r.ok, r.error);
  assertEqual(r.mapping.quantity, 'Qty_Invoiced', 'qty_invoiced -> quantity');
  assertEqual(r.mapping.document_no, 'Invoice_No', 'invoice_no -> document_no');
  assertEqual(r.rows[0].quantity, 100, 'matched qty');
  assertEqual(r.rows[1].quantity, 180, 'mismatched qty preserved for analyze layer');
});

test('normalize: both sides produce reconcilable keys (po_number + item)', () => {
  const ship    = normalize(parseCSV(MATRIX_CSV), inventorySchema).rows;
  const invoice = normalize(parseCSV(PROPER21_CSV), inventorySchema).rows;

  const key = r => `${r.po_number}|${r.item}`;
  const shipMap = new Map(ship.map(r => [key(r), r]));

  const mismatch = invoice.find(r => {
    const s = shipMap.get(key(r));
    return s && s.quantity !== r.quantity;
  });
  assert(mismatch, 'a qty mismatch line is detectable across the two datasets');
  assertEqual(mismatch.item, 'WASHER-M10', 'correct mismatch item');
  assertEqual(mismatch.quantity, 180, 'invoice qty');
});

test('normalize: inventory required fields enforced (item, quantity)', () => {
  const csv = `PO_Number,Unit_Price\nPO-9,1.50`; // no item, no quantity
  const r = normalize(parseCSV(csv), inventorySchema);
  assert(!r.ok, 'should fail');
  assert(r.missing.includes('item'), 'item required');
  assert(r.missing.includes('quantity'), 'quantity required');
});

test('normalize: inventory runs without preferred po_number / unit_price', () => {
  const csv = `Item,Qty\nBOLT-M10x50,100`;
  const r = normalize(parseCSV(csv), inventorySchema);
  assert(r.ok, r.error);
  assertEqual(r.rows[0].item, 'BOLT-M10x50', 'item');
  assertEqual(r.rows[0].quantity, 100, 'quantity');
  assert(
    r.warnings.some(w => w.includes('po_number') || w.includes('unit_price')),
    'preferred-missing warning'
  );
});

// ---------------------------------------------------------------------------
// Schema sanity
// ---------------------------------------------------------------------------

console.log('\nlib/normalize/schemas — sanity\n');

test('jobs schema: required = job_number, stage', () => {
  const req = Object.entries(jobsSchema.fields)
    .filter(([, d]) => d.level === 'required')
    .map(([f]) => f)
    .sort();
  assertDeepEqual(req, ['job_number', 'stage'], 'required fields');
});

test('jobs schema: preferred = due_date, job_value', () => {
  const pref = Object.entries(jobsSchema.fields)
    .filter(([, d]) => d.level === 'preferred')
    .map(([f]) => f)
    .sort();
  assertDeepEqual(pref, ['due_date', 'job_value'], 'preferred fields');
});

test('inventory schema: required = item, quantity', () => {
  const req = Object.entries(inventorySchema.fields)
    .filter(([, d]) => d.level === 'required')
    .map(([f]) => f)
    .sort();
  assertDeepEqual(req, ['item', 'quantity'], 'required fields');
});

test('schemas: every field declares level, type, and variants', () => {
  for (const schema of [jobsSchema, inventorySchema]) {
    for (const [field, def] of Object.entries(schema.fields)) {
      assert(['required', 'preferred', 'optional'].includes(def.level),
        `${schema.name}.${field} level`);
      assert(['string', 'number', 'date'].includes(def.type),
        `${schema.name}.${field} type`);
      assert(Array.isArray(def.variants) && def.variants.length > 0,
        `${schema.name}.${field} variants`);
    }
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
