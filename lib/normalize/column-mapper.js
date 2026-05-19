'use strict';

/**
 * lib/normalize/column-mapper.js
 * Signal Logic Systems LLC
 *
 * Shared normalization layer. Maps the arbitrary, inconsistent column
 * headers found in real ERP exports onto a clean, stable internal schema,
 * then coerces every value to its declared type.
 *
 * This is step 2 of the SLS pipeline (Ingest → NORMALIZE → Analyze →
 * Render). It is tool-agnostic: the JFM engine and the Blue Ash
 * ship-vs-invoice engine both consume its output. The only thing that
 * changes between tools is which schema is passed in.
 *
 * ── Schema contract ────────────────────────────────────────────────────
 * A schema is a plain object:
 *
 *   {
 *     name: 'jobs',
 *     fields: {
 *       <internal_field>: {
 *         level:   'required' | 'preferred' | 'optional',
 *         type:    'string' | 'number' | 'date',
 *         variants: ['Accepted Header', 'header_alias', ...]
 *       },
 *       ...
 *     }
 *   }
 *
 * Field declaration order is significant: when a single source header
 * could plausibly satisfy more than one field, the field declared first
 * in the schema claims it. Declare more specific fields before broader
 * ones.
 *
 * ── Match levels ───────────────────────────────────────────────────────
 *   required   — if unmapped, normalization fails (ok:false). Phase 2 maps
 *                this to HTTP 422. These are the fields without which the
 *                tool cannot produce any meaningful output.
 *   preferred  — if unmapped, normalization still succeeds but emits a
 *                warning. The report degrades gracefully (a metric shows
 *                "—" rather than the whole run failing).
 *   optional   — if unmapped, silent. Enhances the report when present.
 *
 * ── Matching strategy ──────────────────────────────────────────────────
 *   1. Exact match on normalized header == normalized variant. All fields
 *      get a pass at exact matching before any fuzzy matching runs, and a
 *      source header is consumed by at most one field.
 *   2. Fuzzy fallback (token-boundary containment) only for fields still
 *      unmapped, only against headers not already consumed, and only when
 *      exactly one candidate header remains. Ambiguous fuzzy situations are
 *      reported as warnings rather than guessed — a wrong silent mapping is
 *      worse than asking the customer to rename one column.
 *
 * ── Output contract ────────────────────────────────────────────────────
 * Normalized rows contain ONLY declared schema fields. Every unrecognized
 * source column is dropped. This is deliberate: it keeps the downstream
 * surface small and supports the zero-raw-data-leak principle — the
 * normalized object cannot carry columns nobody asked for.
 */

// ---------------------------------------------------------------------------
// Header normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a header (or variant) to a comparison key.
 * Lowercases, collapses runs of whitespace / underscore / dash / dot to a
 * single underscore, and trims stray leading/trailing underscores.
 *
 * Mirrors the Phase 1 browser engine's norm() so Phase 2 produces
 * identical mappings to the demo tool. '#' is intentionally preserved so
 * variants like "job#" still match a "Job#" header.
 *
 * @param {*} str
 * @returns {string}
 */
function normalizeHeader(str) {
  return String(str == null ? '' : str)
    .toLowerCase()
    .replace(/[\s_\-.]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
}

/**
 * True if two normalized strings match at token boundaries — i.e. one
 * token list is a contiguous sublist of the other. This is the fuzzy
 * fallback: "due" matches "due_date", "job_no" matches "job", but
 * "total" does NOT spuriously match "total_qty" unless "total" is a
 * standalone token (which it is there — hence fuzzy stays conservative
 * and single-candidate-only).
 *
 * @param {string} a  normalized
 * @param {string} b  normalized
 * @returns {boolean}
 */
function tokenBoundaryMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const at = a.split('_');
  const bt = b.split('_');
  const [short, long] = at.length <= bt.length ? [at, bt] : [bt, at];
  // Is `short` a contiguous run inside `long`?
  for (let i = 0; i + short.length <= long.length; i++) {
    let hit = true;
    for (let j = 0; j < short.length; j++) {
      if (long[i + j] !== short[j]) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

/**
 * Coerce a raw string cell to its schema-declared type.
 *
 *   string → trimmed string ('' stays '')
 *   number → strips $ , whitespace and (accounting) parentheses; null if NaN
 *   date   → JS Date at parsed instant; null if unparseable
 *
 * Numbers and dates return null (not 0, not Invalid Date) when absent or
 * unparseable so the analyze layer can distinguish "missing" from "zero".
 *
 * @param {*} value
 * @param {'string'|'number'|'date'} type
 * @returns {string|number|Date|null}
 */
function coerceValue(value, type) {
  const s = value == null ? '' : String(value).trim();

  if (type === 'number') {
    if (s === '') return null;
    // Accounting-style negatives: "(1,234.50)" → -1234.50
    const negative = /^\(.*\)$/.test(s);
    const cleaned = s.replace(/[$,\s]/g, '').replace(/[()]/g, '');
    if (cleaned === '' || cleaned === '-') return null;
    const n = parseFloat(cleaned);
    if (isNaN(n)) return null;
    return negative ? -Math.abs(n) : n;
  }

  if (type === 'date') {
    if (s === '') return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // string (default)
  return s;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * Build the internal-field → source-header mapping for a set of columns.
 *
 * @param {string[]} columns  Source header names (as returned by parse-csv).
 * @param {object}   schema   See module header for shape.
 * @returns {{
 *   mapping: Object<string,string>,   // internal field -> source header
 *   missingRequired: string[],
 *   missingPreferred: string[],
 *   unmappedColumns: string[],        // source headers nothing claimed
 *   warnings: string[]
 * }}
 */
function buildMapping(columns, schema) {
  const fields = schema && schema.fields ? schema.fields : {};
  const fieldNames = Object.keys(fields);

  const cols = (columns || []).filter(c => c != null && String(c).trim() !== '');
  const normCols = cols.map(c => ({ raw: c, norm: normalizeHeader(c) }));

  const mapping = {};
  const consumed = new Set(); // normalized headers already claimed
  const warnings = [];

  // --- Pass 1: exact normalized match, schema order, header consumed once ---
  for (const field of fieldNames) {
    const def = fields[field];
    const variantNorms = (def.variants || []).map(normalizeHeader);

    let chosen = null;
    for (const v of variantNorms) {
      const candidates = normCols.filter(c => c.norm === v && !consumed.has(c.norm));
      if (candidates.length === 0) continue;
      chosen = candidates[0];
      if (candidates.length > 1) {
        warnings.push(
          `Field "${field}" matched multiple columns exactly ` +
          `(${candidates.map(c => `"${c.raw}"`).join(', ')}); used "${chosen.raw}".`
        );
      }
      break;
    }
    if (chosen) {
      mapping[field] = chosen.raw;
      consumed.add(chosen.norm);
    }
  }

  // --- Pass 2: conservative fuzzy fallback for still-unmapped fields ---
  for (const field of fieldNames) {
    if (mapping[field]) continue;
    const def = fields[field];
    const variantNorms = (def.variants || []).map(normalizeHeader);

    const candidates = normCols.filter(c =>
      !consumed.has(c.norm) &&
      variantNorms.some(v => tokenBoundaryMatch(c.norm, v))
    );

    if (candidates.length === 1) {
      mapping[field] = candidates[0].raw;
      consumed.add(candidates[0].norm);
    } else if (candidates.length > 1) {
      warnings.push(
        `Field "${field}" has an ambiguous fuzzy match ` +
        `(${candidates.map(c => `"${c.raw}"`).join(', ')}); ` +
        `left unmapped — rename the intended column to an exact accepted name.`
      );
    }
  }

  // --- Classify what's missing ---
  const missingRequired = [];
  const missingPreferred = [];
  for (const field of fieldNames) {
    if (mapping[field]) continue;
    const level = fields[field].level;
    if (level === 'required') missingRequired.push(field);
    else if (level === 'preferred') missingPreferred.push(field);
  }

  const claimedRaw = new Set(Object.values(mapping));
  const unmappedColumns = cols.filter(c => !claimedRaw.has(c));

  return { mapping, missingRequired, missingPreferred, unmappedColumns, warnings };
}

/**
 * Apply a mapping to raw rows, producing normalized, type-coerced row
 * objects that contain ONLY declared schema fields.
 *
 * @param {object[]} rows     Raw row objects from parse-csv.
 * @param {object}   schema
 * @param {Object<string,string>} mapping  internal field -> source header
 * @returns {object[]}
 */
function applyMapping(rows, schema, mapping) {
  const fields = schema && schema.fields ? schema.fields : {};
  const fieldNames = Object.keys(fields);

  return (rows || []).map(raw => {
    const out = {};
    for (const field of fieldNames) {
      const sourceHeader = mapping[field];
      const rawVal = sourceHeader ? raw[sourceHeader] : undefined;
      out[field] = coerceValue(rawVal, fields[field].type);
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Normalize parsed input against a schema.
 *
 * Accepts either a parse-csv ParseResult ({ rows, columns }) or a bare
 * array of row objects (columns inferred from the first row's keys).
 *
 * @param {object|object[]} input   ParseResult or rows array.
 * @param {object}          schema
 * @returns {{
 *   ok: boolean,
 *   rows: object[],                 // normalized rows (empty on failure)
 *   mapping: Object<string,string>,
 *   columns: string[],              // source columns seen
 *   warnings: string[],
 *   error?: string,
 *   missing?: string[]              // missing required fields (failure only)
 * }}
 */
function normalize(input, schema) {
  if (!schema || !schema.fields || Object.keys(schema.fields).length === 0) {
    return {
      ok: false,
      rows: [],
      mapping: {},
      columns: [],
      warnings: [],
      error: 'Invalid or empty schema',
    };
  }

  let rows;
  let columns;
  if (Array.isArray(input)) {
    rows = input;
    columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  } else if (input && typeof input === 'object') {
    rows = Array.isArray(input.rows) ? input.rows : [];
    columns = Array.isArray(input.columns) && input.columns.length > 0
      ? input.columns
      : (rows.length > 0 ? Object.keys(rows[0]) : []);
  } else {
    return {
      ok: false,
      rows: [],
      mapping: {},
      columns: [],
      warnings: [],
      error: 'No input provided',
    };
  }

  const { mapping, missingRequired, missingPreferred, unmappedColumns, warnings } =
    buildMapping(columns, schema);

  if (missingRequired.length > 0) {
    return {
      ok: false,
      rows: [],
      mapping,
      columns,
      warnings,
      missing: missingRequired,
      error:
        `Missing required field(s): ${missingRequired.join(', ')}. ` +
        `Could not map them from columns: ${columns.join(', ') || '(none)'}.`,
    };
  }

  const allWarnings = warnings.slice();
  if (missingPreferred.length > 0) {
    allWarnings.push(
      `Recommended field(s) not found: ${missingPreferred.join(', ')}. ` +
      `Report will run but related metrics will be limited.`
    );
  }
  if (unmappedColumns.length > 0) {
    allWarnings.push(
      `Unrecognized column(s) ignored: ${unmappedColumns.join(', ')}.`
    );
  }

  return {
    ok: true,
    rows: applyMapping(rows, schema, mapping),
    mapping,
    columns,
    warnings: allWarnings,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  normalize,
  buildMapping,
  applyMapping,
  coerceValue,
  normalizeHeader,
  tokenBoundaryMatch,
};
