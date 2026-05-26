'use strict';

/**
 * lib/normalize/schemas/inventory.js
 * Signal Logic Systems LLC
 *
 * Schema for the Blue Ash Industrial Supply ship-vs-invoice
 * reconciliation (inventory module). Describes a single line item from
 * EITHER side of the reconciliation:
 *
 *   - Matrix receipts export (warehouse / receiving side)
 *   - Proper 21 invoices export (invoicing / sales side)
 *
 * Both exports normalize into this one line-item shape. The
 * ship-vs-invoice analyze module takes the two normalized datasets and
 * reconciles them by (po_number + po_detail, item), flagging the
 * discrepancy classes Travis cares about: quantity wrong, price wrong,
 * item missing, wrong PO.
 *
 * Because both sides share this schema, the "how many" field is the
 * generic `quantity` — Matrix's Quantity and Proper 21's qty_shipped both
 * map to it. The analyze layer, not the schema, knows which dataset is
 * the ship side and which is the invoice side.
 *
 * Side-specific keys:
 *   po_detail   Matrix only.   The "-N" line index inside a base PO.
 *               Concatenated with po_number by the analyze layer to form
 *               the join key.
 *   po_dtl_key  Proper 21 only. The Enterprise primary key for the
 *               PO-detail row. Carried through to the report so each
 *               mismatch can emit an UPDATE statement keyed by it.
 *
 * Match levels (see column-mapper.js header for full semantics):
 *   required   item, quantity        — the match key and the core compared value
 *   preferred  po_number, unit_price — sharpen matching and enable price-mismatch
 *                                       detection; reconciliation still runs without
 *   optional   everything else       — context for the report
 *
 * Blue Ash exports are explicitly expected to be raw and messy
 * ("just drop a file"). Variant lists are deliberately broad. Field
 * declaration order puts the identifier/key fields before value fields so
 * they claim ambiguous headers first.
 */

module.exports = {
  name: 'inventory',
  fields: {
    po_number: {
      level: 'preferred',
      type: 'string',
      variants: [
        // customer_po_no listed first so Proper 21's customer PO header
        // wins over its order_no fallback. po_code is Matrix's header.
        'customer_po_no', 'po_code',
        'po_number', 'po', 'po_no', 'po no', 'po#', 'po #', 'purchase_order',
        'purchase order', 'purchase_order_no', 'order_no', 'order number',
      ],
    },
    po_detail: {
      // Matrix-only: the Enterprise primary key for the PO-detail row
      // (75,000-range integer in the live DRT export). Carried through to
      // the renderer so each mismatch can emit an UPDATE keyed by it.
      // Despite the column NAME ("PO Detail"), the values are PO_DTL_KEY
      // identifiers — not a "-N" line index. Proper 21's po_no carries
      // the "-N" sequence number, which is a display artifact, not a key.
      level: 'optional',
      type: 'string',
      variants: ['po_detail', 'po detail', 'po_dtl', 'po_dtl_key', 'po dtl key'],
    },
    po_dtl_key: {
      // Proper 21-only: the Enterprise primary key for the PO-detail row.
      // Carried through verbatim so the renderer can build UPDATE
      // statements that target this exact line.
      level: 'optional',
      type: 'string',
      variants: ['po_dtl_key', 'po dtl key', 'po_detail_key', 'pod_key', 'dtl_key'],
    },
    item: {
      level: 'required',
      type: 'string',
      variants: [
        // customer_part_number listed first so a Proper 21 export that
        // carries BOTH item_id (the supplier's part number) and
        // customer_part_number (the buyer's internal part number) joins
        // on the buyer's number — which is what Matrix Item Code reports.
        'customer_part_number', 'customer_part_no',
        'item_code', 'item_id', 'item id',
        'item', 'item_no', 'item_number', 'item#', 'item #', 'part', 'part_no',
        'part_number', 'partno', 'sku', 'product', 'product_code',
        'catalog', 'catalog_no', 'mfg_part',
      ],
    },
    quantity: {
      level: 'required',
      type: 'number',
      variants: [
        'qty', 'quantity', 'qty_received', 'qty received', 'received',
        'qty_invoiced', 'qty invoiced', 'invoiced_qty', 'qty_shipped',
        'shipped', 'ship_qty', 'received_qty', 'qty_ord', 'units',
      ],
    },
    unit_price: {
      level: 'preferred',
      type: 'number',
      variants: [
        // single_item_value is Matrix's per-unit price header.
        'single_item_value', 'single item value',
        'unit_price', 'unit price', 'price', 'unit_cost', 'unit cost', 'cost',
        'each', 'price_each', 'unit', 'list_price', 'net_price', 'sell_price',
      ],
    },
    extended_price: {
      level: 'optional',
      type: 'number',
      variants: [
        // Matrix's line-total column is bare "Value". Listed first so its
        // exact match wins before any fuzzy fallback considers it.
        'value',
        'extended_price', 'ext_price', 'extended', 'line_total', 'line total',
        'line_price', 'amount', 'total', 'ext_amount', 'extended_amount',
        'net_amount',
      ],
    },
    document_no: {
      level: 'optional',
      type: 'string',
      variants: [
        'invoice_no', 'invoice no', 'invoice', 'invoice_number', 'invoice#',
        'inv_no', 'inv#', 'receipt_no', 'receipt', 'receipt_number',
        'document', 'document_no', 'doc_no', 'ref', 'reference',
      ],
    },
    description: {
      level: 'optional',
      type: 'string',
      variants: [
        'description', 'desc', 'item_desc', 'item_description', 'part_desc',
        'product_desc', 'name', 'item_name',
      ],
    },
    line_date: {
      level: 'optional',
      type: 'date',
      variants: [
        // create_date is Matrix's receipt-date header.
        'create_date', 'create date',
        'receipt_date', 'receipt date', 'received_date', 'date_received',
        'invoice_date', 'invoice date', 'date', 'transaction_date',
        'trans_date', 'posting_date', 'doc_date',
      ],
    },
  },
};
