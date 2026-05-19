'use strict';

/**
 * lib/ingest/parse-csv.js
 * Signal Logic Systems LLC
 *
 * Unified file ingestion layer. Accepts CSV or XLSX input and returns
 * a consistent internal format: an array of row objects with normalized
 * string keys and trimmed string values.
 *
 * Supported input types:
 *   - CSV string or Buffer (via PapaParse)
 *   - XLSX Buffer or ArrayBuffer (via SheetJS 0.18.x)
 *
 * Security note: SheetJS 0.18.x has known prototype pollution and ReDoS
 * advisories (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9). These are
 * not exploitable in our usage because:
 *   (a) we never process formula content — raw values only
 *   (b) inputs are internal ERP exports from known clients, not
 *       arbitrary public uploads
 * Revisit if SLS ever opens public file upload endpoints.
 *
 * Output row contract:
 *   - Every row is a plain object
 *   - All keys are strings, trimmed, original case preserved
 *   - All values are strings, trimmed (numbers and dates coerced)
 *   - Empty rows (all blank values) are filtered out
 *   - Header row is NOT included in output rows
 *
 * Multi-sheet XLSX:
 *   By default, only the first sheet is parsed.
 *   Pass { sheet: 'SheetName' } or { sheetIndex: N } to target a
 *   specific sheet.
 */

const Papa = require('papaparse');
const XLSX  = require('xlsx');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Coerce a SheetJS cell value to a trimmed string.
 * Dates are formatted as YYYY-MM-DD. Numbers use their raw value.
 * Null/undefined become empty string.
 *
 * @param {*} value  Raw cell value from SheetJS sheet_to_json.
 * @returns {string}
 */
function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // ISO date portion only — time component is noise for ERP exports
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

/**
 * Normalize a row object so all values are trimmed strings.
 * Keys are also trimmed (some ERP exports have trailing spaces in headers).
 *
 * @param {object} raw  Row object as returned by the parser.
 * @returns {object}
 */
function normalizeRow(raw) {
  const out = {};
  for (const key of Object.keys(raw)) {
    out[key.trim()] = cellToString(raw[key]);
  }
  return out;
}

/**
 * Return true if every value in the row is an empty string.
 * Used to filter out blank rows that parsers sometimes emit at EOF.
 *
 * @param {object} row
 * @returns {boolean}
 */
function isBlankRow(row) {
  return Object.values(row).every(v => v === '');
}

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

/**
 * Parse a CSV string or Buffer into an array of normalized row objects.
 *
 * @param {string|Buffer} input  CSV content.
 * @param {object} [opts]
 * @param {boolean} [opts.header=true]  Treat first row as header.
 * @returns {ParseResult}
 */
function parseCSV(input, opts = {}) {
  const content = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  const header  = opts.header !== false; // default true

  const result = Papa.parse(content, {
    header,
    skipEmptyLines: true,
    trimHeaders: true,
    transform: (value) => (typeof value === 'string' ? value.trim() : value),
  });

  if (result.errors && result.errors.length > 0) {
    // PapaParse reports row-level errors but still returns what it could parse.
    // Surface them as warnings rather than hard failures — ERP exports are messy.
    const warnings = result.errors.map(e => `Row ${e.row}: ${e.message}`);
    return {
      ok: true,
      rows: result.data.map(normalizeRow).filter(r => !isBlankRow(r)),
      columns: result.meta.fields || [],
      warnings,
      format: 'csv',
    };
  }

  return {
    ok: true,
    rows: result.data.map(normalizeRow).filter(r => !isBlankRow(r)),
    columns: result.meta.fields || [],
    warnings: [],
    format: 'csv',
  };
}

// ---------------------------------------------------------------------------
// XLSX parser
// ---------------------------------------------------------------------------

/**
 * Parse an XLSX Buffer or ArrayBuffer into an array of normalized row objects.
 *
 * @param {Buffer|ArrayBuffer} input  XLSX file content.
 * @param {object} [opts]
 * @param {string}  [opts.sheet]        Target sheet by name.
 * @param {number}  [opts.sheetIndex=0] Target sheet by index (0-based).
 * @returns {ParseResult}
 */
function parseXLSX(input, opts = {}) {
  let workbook;
  try {
    workbook = XLSX.read(input, {
      type: Buffer.isBuffer(input) ? 'buffer' : 'array',
      cellDates: true,   // parse date cells as JS Date objects
      cellNF: false,     // don't need number formats
      cellHTML: false,   // don't need HTML representations
      cellFormula: false // NEVER parse formulas — avoids prototype pollution vector
    });
  } catch (err) {
    return { ok: false, error: `Failed to parse XLSX: ${err.message}`, rows: [], columns: [], warnings: [], format: 'xlsx' };
  }

  // Resolve target sheet
  // Note: SheetJS 0.18.x may silently succeed on corrupt input but return
  // an empty SheetNames array instead of throwing. Treat that as a parse failure.
  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    return { ok: false, error: 'Failed to parse XLSX: file appears corrupt or is not a valid XLSX file', rows: [], columns: [], warnings: [], format: 'xlsx' };
  }

  let sheetName;
  if (opts.sheet) {
    if (!sheetNames.includes(opts.sheet)) {
      return {
        ok: false,
        error: `Sheet "${opts.sheet}" not found. Available: ${sheetNames.join(', ')}`,
        rows: [], columns: [], warnings: [], format: 'xlsx',
      };
    }
    sheetName = opts.sheet;
  } else {
    const idx = opts.sheetIndex || 0;
    if (idx >= sheetNames.length) {
      return {
        ok: false,
        error: `Sheet index ${idx} out of range (file has ${sheetNames.length} sheet(s))`,
        rows: [], columns: [], warnings: [], format: 'xlsx',
      };
    }
    sheetName = sheetNames[idx];
  }

  const sheet = workbook.Sheets[sheetName];
  const raw   = XLSX.utils.sheet_to_json(sheet, {
    defval: '',     // use empty string for missing cells (not undefined)
    raw: false,     // format values as strings where possible
  });

  if (!raw || raw.length === 0) {
    return {
      ok: true,
      rows: [],
      columns: [],
      warnings: [`Sheet "${sheetName}" is empty`],
      format: 'xlsx',
      sheetName,
      availableSheets: sheetNames,
    };
  }

  const rows    = raw.map(normalizeRow).filter(r => !isBlankRow(r));
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return {
    ok: true,
    rows,
    columns,
    warnings: [],
    format: 'xlsx',
    sheetName,
    availableSheets: sheetNames,
  };
}

// ---------------------------------------------------------------------------
// Auto-detect entry point
// ---------------------------------------------------------------------------

/**
 * Detect file format and parse accordingly.
 *
 * Detection logic:
 *   1. If opts.format is 'csv' or 'xlsx', use that.
 *   2. If a filename is provided, use the extension.
 *   3. If input is a string, assume CSV.
 *   4. If input is a Buffer, sniff the first 4 bytes for the XLSX/ZIP magic number.
 *   5. Fall back to CSV.
 *
 * @param {string|Buffer|ArrayBuffer} input
 * @param {object} [opts]
 * @param {string} [opts.format]      Force 'csv' or 'xlsx'.
 * @param {string} [opts.filename]    Filename hint for extension detection.
 * @param {string} [opts.sheet]       XLSX sheet name (passed through).
 * @param {number} [opts.sheetIndex]  XLSX sheet index (passed through).
 * @returns {ParseResult}
 */
function parseFile(input, opts = {}) {
  if (!input) {
    return { ok: false, error: 'No input provided', rows: [], columns: [], warnings: [], format: null };
  }

  // Explicit format override
  if (opts.format === 'csv')  return parseCSV(input, opts);
  if (opts.format === 'xlsx') return parseXLSX(input, opts);

  // Filename extension hint
  if (opts.filename) {
    const ext = opts.filename.split('.').pop().toLowerCase();
    if (ext === 'csv')                         return parseCSV(input, opts);
    if (ext === 'xlsx' || ext === 'xls')       return parseXLSX(input, opts);
  }

  // String input → must be CSV
  if (typeof input === 'string') return parseCSV(input, opts);

  // Buffer: sniff for XLSX/ZIP magic bytes (50 4B 03 04)
  if (Buffer.isBuffer(input) && input.length >= 4) {
    if (input[0] === 0x50 && input[1] === 0x4B &&
        input[2] === 0x03 && input[3] === 0x04) {
      return parseXLSX(input, opts);
    }
  }

  // Default: try CSV
  return parseCSV(input, opts);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ParseResult
 * @property {boolean}   ok              True if parsing succeeded.
 * @property {object[]}  rows            Array of normalized row objects.
 * @property {string[]}  columns         Column names from the header row.
 * @property {string[]}  warnings        Non-fatal issues encountered.
 * @property {string}    format          'csv' or 'xlsx'.
 * @property {string}    [error]         Error message if ok=false.
 * @property {string}    [sheetName]     XLSX only: sheet that was parsed.
 * @property {string[]}  [availableSheets] XLSX only: all sheet names in file.
 */

module.exports = { parseFile, parseCSV, parseXLSX };
