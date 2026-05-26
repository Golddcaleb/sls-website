'use strict';

/**
 * lib/normalize/schemas/purchase-orders.js
 * Signal Logic Systems LLC
 *
 * Schema for the PO Tracking tool. Describes a single purchase-order row
 * exported from a customer ERP (Proper 21 / SAP / Epicor / JobBOSS etc.).
 *
 * Two ingest shapes feed this schema:
 *   1. ERP CSV exports — flat one-row-per-line-item layouts; multiple rows
 *      sharing a po_number get grouped into one tracking record at the
 *      analyze stage.
 *   2. SharePoint-list rows written back by inbox-monitor.js or
 *      sharepoint-writer.js — these already match the internal field
 *      names and skip column mapping entirely.
 *
 * Match levels (see column-mapper.js header for full semantics):
 *   required   po_number, vendor       — without these no follow-up is possible
 *   preferred  order_date, expected_ack_date, line_item_ship_dates
 *                                      — drive timer / lead-time logic;
 *                                        report degrades gracefully if absent
 *   optional   everything else         — enrich the record when present
 *
 * Several fields (`line_items`, `received_items`, `line_item_ship_dates`)
 * are structured rather than scalar. They have no CSV variants — they are
 * produced by analyze/po-tracking grouping logic and by email-parser.js
 * extraction, not by direct column mapping. The schema declares them
 * (level: 'derived') so downstream code knows they belong on the record
 * even though normalize/ never populates them from a CSV cell.
 *
 * Field declaration order is significant: more specific identifiers are
 * declared before broader value/date fields so they claim ambiguous
 * headers first.
 */

module.exports = {
  name: 'purchase-orders',
  fields: {
    po_number: {
      level: 'required',
      type: 'string',
      variants: [
        'po', 'po_number', 'po_no', 'pono', 'po#', 'po #', 'purchase_order',
        'purchase order', 'purchase_order_number', 'po_num', 'order_number',
        'order_no', 'order#',
      ],
    },
    vendor: {
      level: 'required',
      type: 'string',
      variants: [
        'vendor', 'vendor_name', 'supplier', 'supplier_name', 'vend',
        'vendor name', 'supplier name', 'source',
      ],
    },
    job_id: {
      level: 'preferred',
      type: 'string',
      variants: [
        'job', 'job_id', 'job_number', 'jobno', 'job_no', 'job #', 'job#',
        'work_order', 'workorder', 'wo', 'project', 'project_id',
      ],
    },
    order_date: {
      level: 'preferred',
      type: 'date',
      variants: [
        'order_date', 'po_date', 'date_ordered', 'issued_date', 'issue_date',
        'created', 'create_date', 'open_date', 'order date', 'po date',
      ],
    },
    expected_ack_date: {
      level: 'preferred',
      type: 'date',
      variants: [
        'expected_ack_date', 'ack_due_date', 'acknowledgment_due',
        'acknowledgement_due', 'ack_by', 'expected_ack',
      ],
    },
    ack_received_date: {
      level: 'optional',
      type: 'date',
      variants: [
        'ack_received_date', 'ack_date', 'acknowledged_on', 'acknowledged',
        'acknowledgement_received', 'acknowledgment_received',
      ],
    },
    estimated_ship_date: {
      // Flat / single-line-item ERP exports often carry one ship date per
      // row. The analyze stage rolls these into the `line_item_ship_dates`
      // object keyed by line item.
      level: 'preferred',
      type: 'date',
      variants: [
        'estimated_ship_date', 'est_ship_date', 'ship_date', 'eta',
        'estimated_delivery', 'promise_date', 'promised_date', 'expected_ship',
        'ship date', 'est ship date', 'estimated ship',
      ],
    },
    item_name: {
      // Per-row item identifier on flat exports. Grouping in analyze/
      // turns these into a line_items array on the record.
      level: 'preferred',
      type: 'string',
      variants: [
        'item', 'item_name', 'item_no', 'item_number', 'part', 'part_number',
        'part_no', 'sku', 'product', 'description', 'item description',
      ],
    },
    quantity: {
      level: 'optional',
      type: 'number',
      variants: [
        'quantity', 'qty', 'qty_ordered', 'order_qty', 'ordered', 'units',
      ],
    },
    unit: {
      level: 'optional',
      type: 'string',
      variants: [
        'unit', 'uom', 'unit_of_measure', 'units_of_measure',
      ],
    },
    stage: {
      // Customers occasionally pre-stamp stage on CSV exports; usually
      // computed by follow-up-triggers.js from timer state.
      // Canonical values: STAGE_1 | STAGE_2 | RECEIVED
      level: 'optional',
      type: 'string',
      variants: [
        'stage', 'po_stage', 'status', 'po_status', 'state',
      ],
    },

    // -----------------------------------------------------------------
    // Derived / structured fields. No CSV variants — produced by analyze
    // grouping or by email-parser.js. Declared here so SharePoint
    // round-trips know the shape and so downstream code can rely on
    // their presence.
    // -----------------------------------------------------------------
    line_items: {
      level: 'derived',
      type: 'array',
      // [{ item_name, quantity, unit, estimated_ship_date, status }]
    },
    line_item_ship_dates: {
      level: 'derived',
      type: 'object',
      // { '<item_name>': '<ISO date>' }
    },
    received_items: {
      level: 'derived',
      type: 'array',
      // [{ item_name, received_date, quantity }]
    },
    constraint_item: {
      level: 'derived',
      type: 'string',
    },
    prior_constraint_item: {
      level: 'derived',
      type: 'string',
    },
  },
};
