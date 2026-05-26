'use strict';

/**
 * lib/analyze/inventory/ship-vs-invoice.js
 * Signal Logic Systems LLC
 *
 * Ship-vs-invoice reconciliation for Blue Ash Industrial Supply. Takes two
 * streams of normalized inventory rows — the receiving side (Matrix) and
 * the invoicing side (Proper 21) — and emits one record per (base PO, item)
 * pairing classified as:
 *
 *   match              — both sides agree on quantity and unit price
 *   mismatch           — same (PO, item) on both sides, but qty or price off
 *   wrong_po           — same item billed on both sides but under different POs
 *   identity_mismatch  — same PO + qty + unit price on both sides, but the
 *                        item codes differ. Surfaces "SPOTBUY"-style cases
 *                        where the receiver entered a generic placeholder
 *                        item instead of the supplier's real part number.
 *   unmatched          — (PO, item) appears in exactly one of the two files
 *
 * Why the four-state model: per the May 12 meeting, Travis cares about
 * (1) "this line was billed correctly" (match), (2) "the qty or price is
 * off" (mismatch — re-bill or credit), (3) "we billed the right item but
 * tagged the wrong PO" (wrong_po — common when receivers and invoicers
 * key the PO differently), and (4) "this never made it across" (unmatched
 * — billing or receiving was missed).
 *
 * Join key:
 *   matrix    → (po_number,                       item)
 *   proper21  → (stripHyphenSuffix(po_number),    item)
 *
 * Proper 21 numbers each invoice off a single PO with a trailing "-N"
 * suffix (one PO becomes many invoice lines, where N is a small sequential
 * line number — 1, 2, 3, ...). Matrix carries the raw base PO. Stripping
 * the trailing -N from Proper 21 lines the two sides up before joining;
 * multiple Proper 21 rows that roll up to the same base PO + item are
 * then aggregated.
 *
 * PO_DTL_KEY source: Matrix's "PO Detail" column. Despite the name, those
 * values are the Enterprise PO_DTL_KEY identifiers (75k-range integers),
 * not a "-N" line index. They are carried through to each mismatch as
 * `matrix_po_dtl_keys` so the renderer can emit one UPDATE statement per
 * receipt row. Proper 21 does not carry the PO_DTL_KEY itself; the suffix
 * on po_no is the invoice line number, not the database key.
 *
 * Filtering: Matrix rows whose po_number is not numeric are dropped
 * before joining (subtotal/total rows in the export have blank or
 * non-numeric PO codes). Matrix rows whose line_date matches
 * opts.excludeDate by calendar day are also dropped — same-day receipts
 * have not yet had time to be invoiced and would generate spurious
 * unmatched rows.
 *
 * Input row shape (from lib/normalize/column-mapper.js +
 * lib/normalize/schemas/inventory.js):
 *   { po_number, po_detail, po_dtl_key, item, quantity, unit_price,
 *     extended_price, document_no, description, line_date }
 *   - strings trimmed ('' when absent)
 *   - quantity / unit_price / extended_price: number | null
 *   - line_date: Date | null
 */

const DEFAULT_QTY_TOLERANCE = 0;
const DEFAULT_PRICE_TOLERANCE = 0.005;  // half a cent — absorbs display rounding

/**
 * Strip a single trailing "-N" segment from a Proper 21 PO number. The
 * tail must be purely numeric so PO stems that legitimately contain
 * hyphens (e.g. "PO-2026-0142") are not truncated.
 *
 * @param {string} po
 * @returns {string}
 */
function stripHyphenSuffix(po) {
  const s = po == null ? '' : String(po).trim();
  if (!s) return '';
  return s.replace(/-\d+$/, '');
}

/**
 * Calendar-day equality between two Dates (ignores time-of-day).
 *
 * @param {Date} a
 * @param {Date} b
 * @returns {boolean}
 */
function sameCalendarDay(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return false;
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return false;
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

/**
 * Composite (po, item) key for the join. Both halves are trimmed and
 * lower-cased so casing or padding from the source export does not
 * fracture matches.
 *
 * @param {string} po
 * @param {string} item
 * @returns {string}
 */
function joinKey(po, item) {
  const p = po   == null ? '' : String(po).trim().toLowerCase();
  const i = item == null ? '' : String(item).trim().toLowerCase();
  return `${p}${i}`;
}

/**
 * True if a value looks like a numeric PO code. Allows digits with
 * optional commas/spaces but rejects subtotal/total label cells and
 * blanks. Used to filter Matrix subtotal rows out of the join.
 *
 * @param {*} v
 * @returns {boolean}
 */
function isNumericPO(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s) return false;
  return /^[\d,\s]+$/.test(s);
}

/**
 * Roll up rows that share a (PO, item) key into a single comparison row.
 * Quantities are summed, the first non-null unit_price is taken, and the
 * full list of Matrix PO_DTL_KEYs is preserved so the renderer can emit
 * one UPDATE block per receipt row.
 *
 * @param {object[]} rows
 * @returns {{ po:string, item:string, quantity:number,
 *             unit_price:number|null, extended_price:number|null,
 *             description:string, po_dtl_keys:string[] }}
 */
function aggregate(rows) {
  let qty = 0;
  let unitPrice = null;
  let ext = 0;
  let extSeen = false;
  let description = '';
  // Dedup PO_DTL_KEYs in declaration order. Matrix occasionally repeats
  // the same key across receipts of the same line; emitting one UPDATE
  // per receipt would produce duplicate statements that hit the same row.
  const keysSet = new Set();
  const keys = [];
  for (const r of rows) {
    if (typeof r.quantity === 'number')       qty += r.quantity;
    if (typeof r.extended_price === 'number') { ext += r.extended_price; extSeen = true; }
    if (unitPrice === null && typeof r.unit_price === 'number') unitPrice = r.unit_price;
    if (!description && r.description)        description = r.description;
    if (r.po_detail) {
      const k = String(r.po_detail).trim();
      if (k && !keysSet.has(k)) {
        keysSet.add(k);
        keys.push(k);
      }
    }
  }
  return {
    po:   rows[0]._joinPO || rows[0].po_number || '',
    item: rows[0].item || '',
    quantity: qty,
    unit_price: unitPrice,
    extended_price: extSeen ? ext : null,
    description,
    po_dtl_keys: keys,
  };
}

/**
 * @param {number|null} a
 * @param {number|null} b
 * @param {number}      tol
 * @returns {boolean}
 */
function withinTolerance(a, b, tol) {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) <= tol;
}

function itemKey(item) {
  return item == null ? '' : String(item).trim().toLowerCase();
}

function poKey(po) {
  return po == null ? '' : String(po).trim().toLowerCase();
}

/**
 * Reconcile Matrix receipts against Proper 21 invoices.
 *
 * @param {object[]} matrixRows    Normalized Matrix (receiving) rows.
 * @param {object[]} proper21Rows  Normalized Proper 21 (invoicing) rows.
 * @param {object}   [opts]
 * @param {Date}     [opts.excludeDate]          Matrix rows whose line_date
 *                                                falls on this calendar day
 *                                                are dropped before joining.
 * @param {number}   [opts.qtyTolerance=0]
 * @param {number}   [opts.priceTolerance=0.005]
 * @returns {{
 *   ok: boolean,
 *   findings?: {
 *     matches:    object[],
 *     mismatches: object[],
 *     wrongPO:    object[],
 *     identityMismatches: object[],
 *     unmatched:  object[],
 *     counts: {
 *       match:number, mismatch:number, wrongPO:number,
 *       identityMismatch:number, unmatched:number,
 *       matrixExcluded:number, matrixSubtotals:number,
 *       matrixRows:number, proper21Rows:number
 *     }
 *   },
 *   error?: string
 * }}
 */
function shipVsInvoice(matrixRows, proper21Rows, opts = {}) {
  const matrix   = Array.isArray(matrixRows)   ? matrixRows   : [];
  const proper21 = Array.isArray(proper21Rows) ? proper21Rows : [];
  const excludeDate = opts.excludeDate || null;
  const qtyTol   = opts.qtyTolerance   == null ? DEFAULT_QTY_TOLERANCE   : opts.qtyTolerance;
  const priceTol = opts.priceTolerance == null ? DEFAULT_PRICE_TOLERANCE : opts.priceTolerance;

  if (matrix.length === 0 && proper21.length === 0) {
    return {
      ok: false,
      error: 'No rows to reconcile — both Matrix and Proper 21 inputs are empty.',
    };
  }

  // 1. Filter Matrix rows: drop same-day receipts (excludeDate) and
  //    subtotal/total rows (non-numeric PO Code).
  let matrixExcluded = 0;
  let matrixSubtotals = 0;
  const matrixIn = [];
  for (const r of matrix) {
    if (excludeDate && sameCalendarDay(r.line_date, excludeDate)) {
      matrixExcluded++;
      continue;
    }
    if (!isNumericPO(r.po_number)) {
      matrixSubtotals++;
      continue;
    }
    matrixIn.push(r);
  }

  // 2. Bucket each side by (base-PO, item). Matrix uses its PO verbatim;
  //    Proper 21 strips its trailing "-N" suffix (invoice line index, not
  //    an Enterprise key) so its rows collapse back to the base PO before
  //    comparison. The base PO is stashed on each row as _joinPO so the
  //    aggregate() helper reports the same PO on both sides.
  const matrixByKey  = new Map();   // joinKey -> rows[]
  const matrixByItem = new Map();   // itemKey -> Set<poKey>
  for (const r of matrixIn) {
    const item = r.item || '';
    if (!item) continue;
    const po = r.po_number || '';
    const k = joinKey(po, item);
    if (!matrixByKey.has(k)) matrixByKey.set(k, []);
    matrixByKey.get(k).push({ ...r, _joinPO: po });
    const ik = itemKey(item);
    if (!matrixByItem.has(ik)) matrixByItem.set(ik, new Set());
    matrixByItem.get(ik).add(poKey(po));
  }

  const p21ByKey  = new Map();
  const p21ByItem = new Map();
  for (const r of proper21) {
    const item = r.item || '';
    if (!item) continue;
    const basePO = stripHyphenSuffix(r.po_number || '');
    const k = joinKey(basePO, item);
    if (!p21ByKey.has(k)) p21ByKey.set(k, []);
    p21ByKey.get(k).push({ ...r, _joinPO: basePO });
    const ik = itemKey(item);
    if (!p21ByItem.has(ik)) p21ByItem.set(ik, new Set());
    p21ByItem.get(ik).add(poKey(basePO));
  }

  const matches    = [];
  const mismatches = [];
  const wrongPO    = [];
  const unmatched  = [];

  // 3. Walk Matrix-side keys. Each one is either present in Proper 21
  //    (match / mismatch), present there under a different PO (wrong_po),
  //    or absent entirely (unmatched).
  for (const [k, rows] of matrixByKey) {
    const m = aggregate(rows);

    if (p21ByKey.has(k)) {
      const p = aggregate(p21ByKey.get(k));
      const qtyOk   = withinTolerance(m.quantity,   p.quantity,   qtyTol);
      const priceOk = withinTolerance(m.unit_price, p.unit_price, priceTol);
      const record = {
        po: m.po,
        item: m.item,
        description: p.description || m.description || '',
        matrix_po_dtl_keys: m.po_dtl_keys,
        matrix_quantity:       m.quantity,
        proper21_quantity:     p.quantity,
        matrix_unit_price:     m.unit_price,
        proper21_unit_price:   p.unit_price,
        matrix_extended_price: m.extended_price,
        proper21_extended_price: p.extended_price,
        qty_delta: m.quantity - p.quantity,
        price_delta: (m.unit_price == null || p.unit_price == null)
          ? null
          : m.unit_price - p.unit_price,
        value_delta: (m.extended_price == null || p.extended_price == null)
          ? null
          : m.extended_price - p.extended_price,
      };
      if (qtyOk && priceOk) {
        matches.push(record);
      } else {
        const reasons = [];
        if (!qtyOk)   reasons.push('quantity');
        if (!priceOk) reasons.push('unit_price');
        mismatches.push({ ...record, reasons });
      }
      continue;
    }

    const ik = itemKey(m.item);
    const p21POsForItem = p21ByItem.get(ik);
    if (p21POsForItem && p21POsForItem.size > 0) {
      wrongPO.push({
        po: m.po,
        item: m.item,
        description: m.description,
        matrix_po_dtl_keys: m.po_dtl_keys,
        matrix_quantity:   m.quantity,
        matrix_unit_price: m.unit_price,
        proper21_pos: [...p21POsForItem],
        source: 'matrix',
      });
    } else {
      unmatched.push({
        po: m.po,
        item: m.item,
        description: m.description,
        matrix_po_dtl_keys: m.po_dtl_keys,
        quantity:   m.quantity,
        unit_price: m.unit_price,
        extended_price: m.extended_price,
        source: 'matrix',
      });
    }
  }

  // 4. Walk Proper-21-side keys that the Matrix walk did not already
  //    cover. These are P21 keys with no Matrix counterpart at the same
  //    (PO, item) — either Wrong PO (the item exists on the Matrix side
  //    under a different PO) or fully Unmatched. Wrong PO cases already
  //    surfaced from the Matrix-side walk are skipped so the same
  //    situation is not double-counted.
  for (const [k, rows] of p21ByKey) {
    if (matrixByKey.has(k)) continue;
    const p = aggregate(rows);
    const ik = itemKey(p.item);
    const matrixPOsForItem = matrixByItem.get(ik);

    if (matrixPOsForItem && matrixPOsForItem.size > 0) {
      const alreadyFlagged = wrongPO.some(
        w => w.source === 'matrix' && itemKey(w.item) === ik
      );
      if (alreadyFlagged) continue;
      wrongPO.push({
        po: p.po,
        item: p.item,
        description: p.description,
        proper21_quantity:   p.quantity,
        proper21_unit_price: p.unit_price,
        matrix_pos: [...matrixPOsForItem],
        source: 'proper21',
      });
    } else {
      unmatched.push({
        po: p.po,
        item: p.item,
        description: p.description,
        quantity:   p.quantity,
        unit_price: p.unit_price,
        extended_price: p.extended_price,
        source: 'proper21',
      });
    }
  }

  // 5. Identity-mismatch pass. Scan the unmatched lists for Matrix/P21
  //    pairs that agree on (base PO, qty, unit price) but disagree on
  //    item code. These are almost always real transactions where the
  //    receiver keyed a placeholder item (e.g. "SPOTBUY PERISHABLE TOOL
  //    01") and the invoice carries the actual supplier part number.
  //    Paired rows are LIFTED OUT of unmatched so they don't appear in
  //    two buckets.
  const identityMismatches = [];
  const mxUnmatched  = unmatched.filter(u => u.source === 'matrix');
  const p21Unmatched = unmatched.filter(u => u.source === 'proper21');
  const claimedP21 = new Set();   // indices in p21Unmatched
  const claimedMx  = new Set();   // indices in mxUnmatched

  for (let i = 0; i < mxUnmatched.length; i++) {
    const m = mxUnmatched[i];
    if (typeof m.quantity !== 'number' || m.quantity <= 0) continue;
    if (typeof m.unit_price !== 'number') continue;

    for (let j = 0; j < p21Unmatched.length; j++) {
      if (claimedP21.has(j)) continue;
      const p = p21Unmatched[j];
      if (typeof p.quantity !== 'number' || p.quantity <= 0) continue;
      if (typeof p.unit_price !== 'number') continue;
      if (poKey(m.po) !== poKey(p.po)) continue;
      if (itemKey(m.item) === itemKey(p.item)) continue;   // would have matched earlier
      if (!withinTolerance(m.quantity,   p.quantity,   qtyTol))   continue;
      if (!withinTolerance(m.unit_price, p.unit_price, priceTol)) continue;

      identityMismatches.push({
        po: m.po,
        quantity:   m.quantity,
        unit_price: p.unit_price,
        extended_price: (typeof p.extended_price === 'number')
          ? p.extended_price
          : (typeof m.extended_price === 'number' ? m.extended_price : null),
        matrix_item:          m.item,
        matrix_description:   m.description,
        matrix_po_dtl_keys:   m.matrix_po_dtl_keys || [],
        proper21_item:        p.item,
        proper21_description: p.description,
      });
      claimedP21.add(j);
      claimedMx.add(i);
      break;
    }
  }

  // Filter the lifted pairs out of unmatched in original order.
  const remainingUnmatched = [];
  let mxIdx = 0, p21Idx = 0;
  for (const u of unmatched) {
    if (u.source === 'matrix') {
      if (!claimedMx.has(mxIdx)) remainingUnmatched.push(u);
      mxIdx++;
    } else {
      if (!claimedP21.has(p21Idx)) remainingUnmatched.push(u);
      p21Idx++;
    }
  }

  return {
    ok: true,
    findings: {
      matches,
      mismatches,
      wrongPO,
      identityMismatches,
      unmatched: remainingUnmatched,
      counts: {
        match:             matches.length,
        mismatch:          mismatches.length,
        wrongPO:           wrongPO.length,
        identityMismatch:  identityMismatches.length,
        unmatched:         remainingUnmatched.length,
        matrixExcluded,
        matrixSubtotals,
        matrixRows:   matrix.length,
        proper21Rows: proper21.length,
      },
    },
  };
}

module.exports = {
  shipVsInvoice,
  stripHyphenSuffix,
  sameCalendarDay,
  joinKey,
  aggregate,
  isNumericPO,
};
