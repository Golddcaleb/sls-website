'use strict';

/**
 * lib/integrations/graph-api/sharepoint-reader.js
 * Signal Logic Systems LLC
 *
 * Reads PO tracking records from the customer's SharePoint list.
 *
 * Companion to sharepoint-writer.js — see that file for the column model
 * and env-var configuration. This module returns records in the internal
 * schema shape (JSON columns decoded back into arrays/objects).
 *
 * The dashboard (signallogicsystems-site/po-dashboard.js) and the
 * follow-up-triggers analyzer are the two callers. Both want filtered
 * subsets of the same data, so listRecords accepts a filter object and
 * applies server-side filtering where possible, client-side otherwise.
 *
 * Filter rules:
 *   stage          — Graph $filter on fields/stage eq '<value>'
 *   job_id         — Graph $filter on fields/job_id eq '<value>'
 *   po_number      — Graph $filter on fields/po_number eq '<value>'
 *   constraint_flag — Graph $filter on fields/constraint_flag eq true|false
 *   overdue        — Computed client-side: any line_item_ship_dates value
 *                    that is in the past and the record isn't RECEIVED.
 *                    Cannot be server-side because ship dates are in a
 *                    JSON-encoded column.
 */

const { graphRequest, customerKey } = require('./auth');

function getListLocation(customerId) {
  const key = customerKey(customerId);
  if (!key) return { ok: false, error: 'Invalid customer ID' };

  const siteId = process.env[`SLS_SP_SITE_${key}`];
  const listId = process.env[`SLS_SP_LIST_${key}`];

  if (!siteId) return { ok: false, error: `Missing env: SLS_SP_SITE_${key}` };
  if (!listId) return { ok: false, error: `Missing env: SLS_SP_LIST_${key}` };

  return { ok: true, siteId, listId };
}

/**
 * Convert a SharePoint list item (with `fields` blob) back into the
 * internal record shape. JSON columns are parsed; missing values become
 * sensible defaults so analyzers can rely on consistent shape.
 */
function itemToRecord(item) {
  const f = (item && item.fields) || {};

  const safeJsonParse = (raw, fallback) => {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  };

  return {
    _itemId: item.id, // Internal handle for subsequent patchRecord calls.
    po_number:             f.po_number || '',
    vendor:                f.vendor || '',
    job_id:                f.job_id || '',
    stage:                 f.stage || 'STAGE_1',
    timer_start:           f.timer_start || null,
    ack_received_date:     f.ack_received_date || null,
    last_follow_up_date:   f.last_follow_up_date || null,
    constraint_item:       f.constraint_item || '',
    prior_constraint_item: f.prior_constraint_item || '',
    constraint_flag:       !!f.constraint_flag,
    notes:                 f.notes || '',
    line_items:            safeJsonParse(f.line_items_json, []),
    line_item_ship_dates:  safeJsonParse(f.line_item_ship_dates_json, {}),
    received_items:        safeJsonParse(f.received_items_json, []),
  };
}

/**
 * Build the OData $filter expression from filter object. Returns null
 * if no server-side filters apply.
 */
function buildFilterExpr(filter) {
  const clauses = [];

  const eqStr = (col, val) => {
    const v = String(val).replace(/'/g, "''");
    clauses.push(`fields/${col} eq '${encodeURIComponent(v)}'`);
  };

  if (filter.stage)     eqStr('stage', filter.stage);
  if (filter.job_id)    eqStr('job_id', filter.job_id);
  if (filter.po_number) eqStr('po_number', filter.po_number);

  if (typeof filter.constraint_flag === 'boolean') {
    clauses.push(`fields/constraint_flag eq ${filter.constraint_flag ? 'true' : 'false'}`);
  }

  return clauses.length ? clauses.join(' and ') : null;
}

/**
 * Determine if a record is overdue: at least one line_item_ship_dates
 * value is strictly before `now` and the record isn't RECEIVED.
 */
function isOverdue(record, now) {
  if (record.stage === 'RECEIVED') return false;
  const ships = record.line_item_ship_dates || {};
  for (const k of Object.keys(ships)) {
    const t = Date.parse(ships[k]);
    if (!isNaN(t) && t < now.getTime()) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List tracking records, optionally filtered.
 *
 * @param {string} customerId
 * @param {object} [filter]
 * @param {string}  [filter.stage]
 * @param {string}  [filter.job_id]
 * @param {string}  [filter.po_number]
 * @param {boolean} [filter.constraint_flag]
 * @param {boolean} [filter.overdue]
 * @param {object}  [opts]
 * @param {number}  [opts.top]   Max items per page (default 200).
 * @param {Date}    [opts.now]   Reference time for overdue check (default new Date()).
 * @returns {Promise<{ ok:true, records:object[] } | { ok:false, error:string }>}
 */
async function listRecords(customerId, filter = {}, opts = {}) {
  const loc = getListLocation(customerId);
  if (!loc.ok) return loc;

  const top = opts.top || 200;
  const filterExpr = buildFilterExpr(filter);

  let path =
    `/sites/${encodeURIComponent(loc.siteId)}/lists/${encodeURIComponent(loc.listId)}/items` +
    `?$expand=fields&$top=${top}`;
  if (filterExpr) path += `&$filter=${filterExpr}`;

  const records = [];
  let nextLink = path;

  // Page through @odata.nextLink. Most customers will have one page;
  // this guards against the rare large dataset.
  while (nextLink) {
    const res = await graphRequest(
      customerId,
      nextLink,
      filterExpr ? { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } } : {}
    );
    if (!res.ok) return res;

    const items = (res.data && res.data.value) || [];
    for (const it of items) records.push(itemToRecord(it));

    nextLink = res.data && res.data['@odata.nextLink'] ? res.data['@odata.nextLink'] : null;
  }

  // Client-side overdue filter — cannot be done server-side because ship
  // dates live in a JSON-encoded text column.
  if (filter.overdue) {
    const now = opts.now || new Date();
    return { ok: true, records: records.filter(r => isOverdue(r, now)) };
  }

  return { ok: true, records };
}

/**
 * Read the queued (PENDING) emails awaiting manual review.
 * Surfaces the Email Queue panel in the dashboard.
 */
async function listQueuedEmails(customerId) {
  const key = customerKey(customerId);
  const siteId = process.env[`SLS_SP_SITE_${key}`];
  const queueListId = process.env[`SLS_SP_QUEUE_LIST_${key}`];

  if (!siteId)      return { ok: false, error: `Missing env: SLS_SP_SITE_${key}` };
  if (!queueListId) return { ok: false, error: `Missing env: SLS_SP_QUEUE_LIST_${key}` };

  const path =
    `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(queueListId)}/items` +
    `?$expand=fields&$top=100&$filter=fields/status eq 'PENDING'`;

  const res = await graphRequest(customerId, path, {
    headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' },
  });
  if (!res.ok) return res;

  const queue = ((res.data && res.data.value) || []).map(item => {
    const f = item.fields || {};
    return {
      _itemId:    item.id,
      po_number:  f.po_number || '',
      email_type: f.email_type || '',
      recipient:  f.recipient || '',
      subject:    f.subject || '',
      body:       f.body || '',
      created_at: f.created_at || null,
      status:     f.status || 'PENDING',
    };
  });

  return { ok: true, queue };
}

module.exports = {
  listRecords,
  listQueuedEmails,
  itemToRecord,
  isOverdue,
};
