'use strict';

/**
 * lib/analyze/inventory/ship-vs-invoice.js
 * Signal Logic Systems LLC
 *
 * Ship-vs-invoice reconciliation for Blue Ash Industrial Supply. Takes two
 * streams of normalized inventory rows — the receiving side (Matrix) and
 * the invoicing side (Proper 21) — and emits one record per (PO, item)
 * pairing classified as:
 *
 *   match      — both sides agree on quantity and unit price
 *   mismatch   — same (PO, item) on both sides, but quantity or price off
 *   wrong_po   — same item billed on both sides but under different POs
 *   unmatched  — (PO, item) appears in exactly one of the two files
 *
 * Why the four-state model: per the May 12 meeting, Travis cares about
 * (1) "this line was billed correctly" (match), (2) "the qty or price is
 * off" (mismatch — re-bill or credit), (3) "we billed the right item but
 * tagged the wrong PO" (wrong_po — common when receivers and invoicers
 * key the PO differently), and (4) "this never made it across" (unmatched
 * — billing or receiving was missed). Collapsing wrong_po into unmatched
 * would hide the most actionable category.
 *
 * Join key:
 *   matrix    → (po_number, item)
 *   proper21  → (stripHyphenSuffix(po_number), item)
 *
 * Proper 21 numbers each invoice off a single PO with a trailing "-N"
 * suffix (one PO becomes many invoice rows). Matrix carries the raw PO.
 * Stripping the trailing -N segment from the Proper 21 po_number lines
 * the two sides up before joining; multiple Proper 21 rows that roll up
 * to the same base PO + item are then aggregated (quantities summed,
 * unit_price taken from the first row carrying one — slices of a single
 * PO line are expected to agree on price, and intra-Proper-21 price drift
 * is a separate issue this engine does not try to resolve).
 *
 * Exclusion: Matrix rows whose line_date matches opts.excludeDate by
 * calendar day are dropped before joining. Same-day receipts have not yet
 * had time to be invoiced and would otherwise generate spurious
 * unmatched rows — the reconciliation is meaningful only against the
 * closed prior period.
 *
 * Input row shape (from lib/normalize/column-mapper.js +
 * lib/normalize/schemas/inventory.js):
 *   { po_number, item, quantity, unit_price, extended_price, document_no,
 *     description, line_date }
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
  return `${p}${i}`;
}

/**
 * Roll up rows that share a (PO, item) key into a single comparison row.
 *
 * @param {object[]} rows
 * @returns {{ po:string, item:string, quantity:number,
 *             unit_price:number|null, extended_price:number }}
 */
function aggregate(rows) {
  let qty = 0;
  let unitPrice = null;
  let ext = 0;
  for (const r of rows) {
    if (typeof r.quantity === 'number')       qty += r.quantity;
    if (typeof r.extended_price === 'number') ext += r.extended_price;
    if (unitPrice === null && typeof r.unit_price === 'number') unitPrice = r.unit_price;
  }
  return {
    po:   rows[0].po_number || '',
    item: rows[0].item || '',
    quantity: qty,
    unit_price: unitPrice,
    extended_price: ext,
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
 *     unmatched:  object[],
 *     counts: {
 *       match:number, mismatch:number, wrongPO:number, unmatched:number,
 *       matrixExcluded:number, matrixRows:number, proper21Rows:number
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

  // 1. Drop excluded Matrix rows (same-day receipts not yet invoiced).
  let matrixExcluded = 0;
  const matrixIn = matrix.filter(r => {
    if (excludeDate && sameCalendarDay(r.line_date, excludeDate)) {
      matrixExcluded++;
      return false;
    }
    return true;
  });

  // 2. Bucket each side by (PO, item). Matrix uses its PO verbatim;
  //    Proper 21 strips its hyphen suffix so the invoice-line slices
  //    collapse back into their base PO before comparison.
  const matrixByKey  = new Map();   // joinKey -> rows[]
  const matrixByItem = new Map();   // itemKey -> Set<poKey>
  for (const r of matrixIn) {
    const item = r.item || '';
    if (!item) continue;
    const po = r.po_number || '';
    const k = joinKey(po, item);
    if (!matrixByKey.has(k)) matrixByKey.set(k, []);
    matrixByKey.get(k).push(r);
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
    // Carry the stripped PO downstream so aggregate() reports the base PO.
    p21ByKey.get(k).push({ ...r, po_number: basePO });
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
        matrix_quantity:     m.quantity,
        proper21_quantity:   p.quantity,
        matrix_unit_price:   m.unit_price,
        proper21_unit_price: p.unit_price,
        qty_delta: m.quantity - p.quantity,
        price_delta: (m.unit_price == null || p.unit_price == null)
          ? null
          : m.unit_price - p.unit_price,
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
        matrix_quantity:   m.quantity,
        matrix_unit_price: m.unit_price,
        proper21_pos: [...p21POsForItem],
        source: 'matrix',
      });
    } else {
      unmatched.push({
        po: m.po,
        item: m.item,
        quantity:   m.quantity,
        unit_price: m.unit_price,
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
        proper21_quantity:   p.quantity,
        proper21_unit_price: p.unit_price,
        matrix_pos: [...matrixPOsForItem],
        source: 'proper21',
      });
    } else {
      unmatched.push({
        po: p.po,
        item: p.item,
        quantity:   p.quantity,
        unit_price: p.unit_price,
        source: 'proper21',
      });
    }
  }

  return {
    ok: true,
    findings: {
      matches,
      mismatches,
      wrongPO,
      unmatched,
      counts: {
        match:     matches.length,
        mismatch:  mismatches.length,
        wrongPO:   wrongPO.length,
        unmatched: unmatched.length,
        matrixExcluded,
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
};
