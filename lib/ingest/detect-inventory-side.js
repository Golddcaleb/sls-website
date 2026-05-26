'use strict';

/**
 * lib/ingest/detect-inventory-side.js
 * Signal Logic Systems LLC
 *
 * Inspect a parsed file's column headers and decide whether it is a
 * Matrix receipts export or a Proper 21 invoices export. Used by the
 * ship-vs-invoice pipeline so the user's drop-zone choice on the submit
 * page is not the source of truth — if both files were dropped in the
 * wrong zones, the backend swaps them silently; if the two files can't
 * be told apart (both look like the same side, or neither looks like
 * either), the caller raises a 422 with a human-readable message.
 *
 * Detection is signature-based, not row-based. Headers are cheap to
 * read and unambiguous when they exist; sniffing rows would couple us
 * to value-shape heuristics that drift faster than column names.
 *
 * Each side has a strong signature (headers that are practically unique
 * to that side) and a weak signature (headers that are common but
 * cumulatively diagnostic). A column counts as a hit when the
 * normalizeHeader form of the column matches a signature entry.
 *
 * Scoring:
 *   strong hit = 3 points
 *   weak hit   = 1 point
 *
 * A classification is "confident" when one side has a strong hit AND
 * the side's total score is at least 4 points higher than the other
 * side's score. Anything else returns 'ambiguous' so the caller can
 * decide whether to bail or fall back to the user-provided labeling.
 */

const { normalizeHeader } = require('../normalize/column-mapper');

// Matrix Receipts (DRT-style): PO Code, PO Detail, Item Code, Quantity,
// Single Item Value, Value, Create Date, Bin Code, Remarks. The strong
// markers below are not used by any Proper 21 export we've seen.
const MATRIX_STRONG = [
  'po_code',
  'po_detail',
  'single_item_value',
  'bin_code',
];
const MATRIX_WEAK = [
  'create_date',
  'item_code',
  'value',
  'remarks',
  'supplier_code',
  'supplier_item_code',
  'category_name',
  'site',
];

// Proper 21 Invoices: invoice_date, customer_part_number, po_no,
// item_id, item_desc, qty_shipped, unit_price, extended_price, order_no.
const P21_STRONG = [
  'customer_part_number',
  'qty_shipped',
  'po_dtl_key',
  'customer_po_no',
];
const P21_WEAK = [
  'invoice_date',
  'item_id',
  'item_desc',
  'extended_price',
  'order_no',
  'po_no',
];

const STRONG_WEIGHT = 3;
const WEAK_WEIGHT   = 1;
const MIN_MARGIN    = 4;   // gap between a side's total and its opposite

function scoreSide(normSet, strong, weak) {
  let strongHits = 0;
  for (const k of strong) if (normSet.has(k)) strongHits++;
  let weakHits = 0;
  for (const k of weak)   if (normSet.has(k)) weakHits++;
  const score = strongHits * STRONG_WEIGHT + weakHits * WEAK_WEIGHT;
  return { strongHits, weakHits, score };
}

/**
 * Classify a single file's columns as 'matrix' | 'proper21' | 'ambiguous'.
 *
 * @param {string[]} columns
 * @returns {{
 *   side: 'matrix' | 'proper21' | 'ambiguous',
 *   matrix:   { strongHits:number, weakHits:number, score:number },
 *   proper21: { strongHits:number, weakHits:number, score:number },
 *   reason?: string
 * }}
 */
function classifyColumns(columns) {
  const norms = new Set(
    (columns || []).map(c => normalizeHeader(c)).filter(Boolean)
  );

  const matrix   = scoreSide(norms, MATRIX_STRONG, MATRIX_WEAK);
  const proper21 = scoreSide(norms, P21_STRONG,    P21_WEAK);

  if (matrix.score === 0 && proper21.score === 0) {
    return {
      side: 'ambiguous',
      matrix,
      proper21,
      reason: 'no recognizable Matrix or Proper 21 column headers found',
    };
  }

  const margin = matrix.score - proper21.score;

  if (margin >= MIN_MARGIN && matrix.strongHits > 0) {
    return { side: 'matrix', matrix, proper21 };
  }
  if (-margin >= MIN_MARGIN && proper21.strongHits > 0) {
    return { side: 'proper21', matrix, proper21 };
  }
  return {
    side: 'ambiguous',
    matrix,
    proper21,
    reason: `scores too close to call (matrix=${matrix.score}, proper21=${proper21.score})`,
  };
}

/**
 * Decide which of the two parsed file objects is Matrix and which is
 * Proper 21. Returns the same two file objects, but tagged with the
 * `side` field and labeled `assignedAs` (the drop-zone label the caller
 * used). When the two zones are inverted, the caller can detect it via
 * the returned `swapped` flag.
 *
 * @param {{ name:string, columns:string[] }} a   File from drop zone A.
 * @param {{ name:string, columns:string[] }} b   File from drop zone B.
 * @returns {{
 *   ok: boolean,
 *   matrix?:   { name:string, columns:string[], classification:object },
 *   proper21?: { name:string, columns:string[], classification:object },
 *   swapped?:  boolean,
 *   error?:    string,
 *   detail?:   object
 * }}
 */
function assignSides(a, b) {
  const aCls = classifyColumns(a.columns);
  const bCls = classifyColumns(b.columns);

  // Confident case: both sides classified, opposite types.
  if (aCls.side === 'matrix' && bCls.side === 'proper21') {
    return {
      ok: true,
      matrix:   { ...a, classification: aCls },
      proper21: { ...b, classification: bCls },
      swapped: false,
    };
  }
  if (aCls.side === 'proper21' && bCls.side === 'matrix') {
    return {
      ok: true,
      matrix:   { ...b, classification: bCls },
      proper21: { ...a, classification: aCls },
      swapped: true,
    };
  }

  // Both classified as the same side, or one/both ambiguous. Build a
  // human-readable message that names each file by the slot it came
  // from so the user can fix it in one read.
  const summary = (cls) => {
    if (cls.side === 'ambiguous') return `ambiguous (${cls.reason})`;
    return `looks like ${cls.side === 'matrix' ? 'Matrix Receipts' : 'Proper 21 Invoices'}`;
  };

  return {
    ok: false,
    error:
      `Could not tell which file is which. ` +
      `File "${a.name}" ${summary(aCls)}; ` +
      `file "${b.name}" ${summary(bCls)}. ` +
      `Re-upload with one Matrix Receipts export and one Proper 21 invoices export.`,
    detail: { a: aCls, b: bCls },
  };
}

module.exports = {
  classifyColumns,
  assignSides,
  MATRIX_STRONG,
  MATRIX_WEAK,
  P21_STRONG,
  P21_WEAK,
};
