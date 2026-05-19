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
 * reconciles them by (po_number, item), flagging the three discrepancy
 * classes Travis cares about: quantity wrong, price wrong, item missing.
 *
 * Because both sides share this schema, the "how many" field is the
 * generic `quantity` — Matrix's Qty_Received and Proper 21's Qty_Invoiced
 * both map to it. The analyze layer, not the schema, knows which dataset
 * is the ship side and which is the invoice side.
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
        'po_number', 'po', 'po_no', 'po no', 'po#', 'po #', 'purchase_order',
        'purchase order', 'purchase_order_no', 'order_no', 'order number',
      ],
    },
    item: {
      level: 'required',
      type: 'string',
      variants: [
        'item', 'item_no', 'item_number', 'item#', 'item #', 'part', 'part_no',
        'part_number', 'partno', 'sku', 'product', 'product_code', 'item_code',
        'catalog', 'catalog_no', 'mfg_part', 'item id',
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
        'unit_price', 'unit price', 'price', 'unit_cost', 'unit cost', 'cost',
        'each', 'price_each', 'unit', 'list_price', 'net_price', 'sell_price',
      ],
    },
    extended_price: {
      level: 'optional',
      type: 'number',
      variants: [
        'extended_price', 'ext_price', 'extended', 'line_total', 'line total',
        'amount', 'total', 'ext_amount', 'extended_amount', 'net_amount',
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
        'receipt_date', 'receipt date', 'received_date', 'date_received',
        'invoice_date', 'invoice date', 'date', 'transaction_date',
        'trans_date', 'posting_date', 'doc_date',
      ],
    },
  },
};
