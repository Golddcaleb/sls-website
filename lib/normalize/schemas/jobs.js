'use strict';

/**
 * lib/normalize/schemas/jobs.js
 * Signal Logic Systems LLC
 *
 * Schema for the Job Flow Monitor (JFM). Describes a single job / work
 * order row exported from a customer ERP (JobBOSS or similar).
 *
 * The variant lists mirror the Phase 1 browser engine
 * (signallogicsystems-site/dashboard.js COLUMN_VARIANTS) verbatim so the
 * Phase 2 serverless engine resolves the exact same columns the demo tool
 * does. Changing a variant here changes detection for both — keep them in
 * sync until Phase 1 is retired.
 *
 * Match levels (see column-mapper.js header for full semantics):
 *   required   job_number, stage   — no diagnostic is possible without these
 *   preferred  due_date, job_value — drive revenue-at-risk / overdue metrics;
 *                                     report degrades gracefully if absent
 *   optional   everything else     — enrich the report when present
 *
 * Note on architecture doc §10.5: that section frames due_date/job_value as
 * "required for a useful report." They are modeled here as `preferred`
 * because the tested Phase 1 engine runs (and renders a constraint
 * diagnostic) without them. This preserves byte-for-byte parity with the
 * deployed demo. The three-tier model still expresses the doc's intent —
 * a missing preferred field produces a warning, not a silent omission.
 *
 * Field declaration order is significant: more specific identifiers are
 * declared before broader value/date fields so they claim ambiguous
 * headers first.
 */

module.exports = {
  name: 'jobs',
  fields: {
    job_number: {
      level: 'required',
      type: 'string',
      variants: [
        'job', 'job_number', 'jobno', 'job_no', 'job no', 'wo', 'work_order',
        'workorder', 'job#', 'job #', 'order_no', 'order no', 'order#',
      ],
    },
    stage: {
      level: 'required',
      type: 'string',
      variants: [
        'status', 'job_status', 'current_op', 'current_operation', 'work_center',
        'workcenter', 'operation', 'stage', 'phase', 'department', 'dept',
        'current stage', 'job status',
      ],
    },
    due_date: {
      level: 'preferred',
      type: 'date',
      variants: [
        'due_date', 'due date', 'req_date', 'required_date', 'need_date',
        'duedate', 'ship_date', 'promise_date', 'promised_date', 'need date',
        'required date', 'due',
      ],
    },
    job_value: {
      level: 'preferred',
      type: 'number',
      variants: [
        'est_total_price', 'quote_price', 'total_price', 'revenue', 'price',
        'ext_price', 'extended_price', 'value', 'amount', 'total', 'job_total',
        'est_price', 'estimated_price', 'sell_price', 'sales_price', 'net_price',
      ],
    },
    customer: {
      level: 'optional',
      type: 'string',
      variants: [
        'customer', 'customer_name', 'cust_name', 'cust', 'client',
        'customer name', 'company', 'account',
      ],
    },
    order_date: {
      level: 'optional',
      type: 'date',
      variants: [
        'order_date', 'start_date', 'open_date', 'date_opened', 'orderdate',
        'opened', 'create_date', 'created', 'order date', 'open date', 'start date',
      ],
    },
    qty_ordered: {
      level: 'optional',
      type: 'number',
      variants: [
        'qty_ordered', 'order_qty', 'quantity', 'qty', 'quantity_ordered', 'ordered',
      ],
    },
    qty_shipped: {
      level: 'optional',
      type: 'number',
      variants: [
        'qty_shipped', 'ship_qty', 'shipped', 'quantity_shipped',
      ],
    },
    part_number: {
      level: 'optional',
      type: 'string',
      variants: [
        'part', 'part_number', 'part_no', 'partno', 'item', 'item_no', 'part number',
      ],
    },
    description: {
      level: 'optional',
      type: 'string',
      variants: [
        'description', 'part_desc', 'desc', 'item_desc', 'part_description', 'name',
      ],
    },
  },
};
