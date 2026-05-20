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
// Header row auto-detection
//
// Many ERP exports prepend a banner row (report title) and/or a blank row
// before the actual column headers. SheetJS's default behavior is to treat
// row 0 as the header, which produces useless keys like `__EMPTY`, `__EMPTY_1`
// when the banner row has fewer cells than the data. PapaParse has the same
// problem. To handle this, we parse the file in array mode (no header),
// score the first N rows, and pick the most plausible header row before
// building row objects.
// ---------------------------------------------------------------------------

const HEADER_SCAN_LIMIT = 10;
// A cell that is entirely digits, decimals, currency punctuation, percent
// signs, parentheses, commas, or spaces. Real column names don't look like
// this. Used to distinguish data rows from header rows.
const NUMERIC_CELL_RE = /^[\s$()%,.\-+]*[\d][\s$()%,.\-+\d]*$/;

/**
 * Score a row's likelihood of being the header row.
 *
 * Returns 0 for rows that clearly aren't headers (blank, single-cell banner,
 * mostly-numeric data row). Higher scores indicate better header candidates.
 *
 * @param {Array<string>} rowArr  Row cells as strings.
 * @returns {number}
 */
function scoreHeaderCandidate(rowArr) {
  if (!Array.isArray(rowArr)) return 0;
  const cells = rowArr.map(v => (v == null ? '' : String(v).trim())).filter(v => v !== '');

  // Need at least two distinct labels to look like a header.
  if (cells.length < 2) return 0;

  // Mostly-numeric → looks like a data row, not a header.
  const numericCount = cells.filter(v => NUMERIC_CELL_RE.test(v)).length;
  if (numericCount / cells.length > 0.5) return 0;

  // Reward unique non-empty cells. Duplicate column names are legal in raw
  // exports but uncommon; uniqueness is a strong header signal.
  const unique = new Set(cells);
  return cells.length + (unique.size === cells.length ? cells.length * 0.5 : 0);
}

/**
 * Pick the index of the most plausible header row within the first
 * HEADER_SCAN_LIMIT rows. Falls back to 0 when nothing scores above zero —
 * the caller still gets a result, even if the file is malformed.
 *
 * @param {Array<Array<string>>} rows2d  Rows as arrays of cell strings.
 * @returns {number}                     0-based header row index.
 */
function findHeaderIndex(rows2d) {
  let bestIdx = 0;
  let bestScore = 0;
  const limit = Math.min(rows2d.length, HEADER_SCAN_LIMIT);
  for (let i = 0; i < limit; i++) {
    const s = scoreHeaderCandidate(rows2d[i]);
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Make a list of header cell values safe for use as object keys.
 * Empty headers (sometimes present after the last real column) get
 * stable synthetic names so data isn't silently dropped, and duplicates
 * are disambiguated with a trailing index.
 *
 * @param {Array<string>} rawHeader
 * @returns {Array<string>}
 */
function safeHeaderNames(rawHeader) {
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < rawHeader.length; i++) {
    let name = (rawHeader[i] == null ? '' : String(rawHeader[i]).trim());
    if (name === '') name = `__col${i}`;
    if (seen[name] !== undefined) {
      seen[name] += 1;
      name = `${name}_${seen[name]}`;
    } else {
      seen[name] = 0;
    }
    out.push(name);
  }
  return out;
}

/**
 * Build row objects from a 2D array using the row at `headerIdx` as keys.
 *
 * @param {Array<Array<string>>} rows2d
 * @param {number} headerIdx
 * @returns {{ columns: string[], rows: object[] }}
 */
function rowsFromHeaderIndex(rows2d, headerIdx) {
  if (rows2d.length === 0) return { columns: [], rows: [] };
  const columns = safeHeaderNames(rows2d[headerIdx] || []);
  const rows = [];
  for (let i = headerIdx + 1; i < rows2d.length; i++) {
    const src = rows2d[i] || [];
    const obj = {};
    for (let c = 0; c < columns.length; c++) {
      obj[columns[c]] = src[c] == null ? '' : String(src[c]).trim();
    }
    rows.push(obj);
  }
  return { columns, rows };
}

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

/**
 * Parse a CSV string or Buffer into an array of normalized row objects.
 *
 * Auto-detects the header row by default — handles banner/blank prelude
 * rows that ERP exports often include. Pass `opts.headerRow` to force a
 * specific 0-based row index, or `opts.autoDetectHeader = false` to fall
 * back to the legacy behavior (first row is the header).
 *
 * @param {string|Buffer} input  CSV content.
 * @param {object} [opts]
 * @param {boolean} [opts.autoDetectHeader=true]
 * @param {number}  [opts.headerRow]   0-based index of the header row.
 * @returns {ParseResult}
 */
function parseCSV(input, opts = {}) {
  const content = Buffer.isBuffer(input) ? input.toString('utf8') : input;

  // Array mode (no header) so we can locate the real header ourselves.
  // Empty lines are kept so headerRow indexing matches what the user sees
  // in the file — we filter blank rows back out after building objects.
  const result = Papa.parse(content, {
    header: false,
    skipEmptyLines: false,
    transform: (value) => (typeof value === 'string' ? value.trim() : value),
  });

  const warnings = (result.errors || []).map(e => `Row ${e.row}: ${e.message}`);
  const rows2d = result.data || [];

  if (rows2d.length === 0) {
    return { ok: true, rows: [], columns: [], warnings, format: 'csv' };
  }

  const headerIdx = typeof opts.headerRow === 'number'
    ? opts.headerRow
    : (opts.autoDetectHeader === false ? 0 : findHeaderIndex(rows2d));

  if (headerIdx > 0) {
    warnings.push(`Skipped ${headerIdx} prelude row(s) before header`);
  }

  const built = rowsFromHeaderIndex(rows2d, headerIdx);
  const rows = built.rows.map(normalizeRow).filter(r => !isBlankRow(r));

  return {
    ok: true,
    rows,
    columns: built.columns,
    warnings,
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

  // Array-of-arrays mode so we can locate the real header row ourselves.
  // ERP exports frequently prepend a banner row ("DRT Mfg - Monthly
  // Receiving Report") that SheetJS would otherwise treat as the header,
  // producing keys like __EMPTY, __EMPTY_1.
  const raw2d = XLSX.utils.sheet_to_json(sheet, {
    header: 1,    // array-of-arrays
    defval: '',
    raw: false,
    blankrows: false,
  });

  if (!raw2d || raw2d.length === 0) {
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

  const warnings = [];
  const headerIdx = typeof opts.headerRow === 'number'
    ? opts.headerRow
    : (opts.autoDetectHeader === false ? 0 : findHeaderIndex(raw2d));

  if (headerIdx > 0) {
    warnings.push(`Skipped ${headerIdx} prelude row(s) before header`);
  }

  const built = rowsFromHeaderIndex(raw2d, headerIdx);
  const rows = built.rows.map(normalizeRow).filter(r => !isBlankRow(r));

  if (rows.length === 0) {
    warnings.push(`Sheet "${sheetName}" is empty`);
  }

  return {
    ok: true,
    rows,
    columns: built.columns,
    warnings,
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
