'use strict';

/**
 * lib/integrations/graph-api/sharepoint-writer.js
 * Signal Logic Systems LLC
 *
 * Writes / upserts PO tracking records to the customer's SharePoint list.
 *
 * Hold-the-calculator principle: this is the only place tracking state
 * gets persisted, and it persists into the *customer's* tenant — not
 * ours. SLS-side storage of PO data is forbidden by the architecture.
 *
 * Per-customer SharePoint location is configured via env vars:
 *
 *   SLS_SP_SITE_<CUSTOMER_ID>   Graph site ID, e.g.
 *                               'contoso.sharepoint.com,{site-guid},{web-guid}'
 *   SLS_SP_LIST_<CUSTOMER_ID>   List ID (GUID) of the tracking list.
 *
 * Both values are returned by onboard-customer.js after provisioning.
 *
 * SharePoint list column model:
 *   po_number              Single line of text (used as the upsert key)
 *   vendor                 Single line of text
 *   job_id                 Single line of text
 *   stage                  Choice (STAGE_1 | STAGE_2 | RECEIVED)
 *   timer_start            Date
 *   ack_received_date      Date (nullable)
 *   last_follow_up_date    Date (nullable)
 *   constraint_item        Single line of text
 *   prior_constraint_item  Single line of text
 *   constraint_flag        Yes/No
 *   notes                  Multiple lines of text
 *
 *   line_items_json            Multi-line text — JSON-encoded array
 *   line_item_ship_dates_json  Multi-line text — JSON-encoded object
 *   received_items_json        Multi-line text — JSON-encoded array
 *
 * SharePoint columns store flat scalars cleanly but choke on nested
 * structures, so all array/object fields are JSON-encoded into text
 * columns. The reader transparently decodes them. This is a deliberate
 * tradeoff: native SP queries on those fields aren't possible (we filter
 * in JS) but the round-trip stays lossless and the list schema is
 * trivial to provision.
 */

const { graphRequest, customerKey } = require('./auth');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Serialize a tracking record into SharePoint `fields` shape.
 * Arrays/objects → JSON text columns. Undefined values are dropped so
 * PATCH only touches fields the caller explicitly provided.
 */
function recordToFields(record) {
  const f = {};

  const passthrough = [
    'po_number', 'vendor', 'job_id', 'stage',
    'constraint_item', 'prior_constraint_item', 'notes',
  ];
  for (const k of passthrough) {
    if (record[k] !== undefined) f[k] = record[k] == null ? '' : String(record[k]);
  }

  const dates = ['timer_start', 'ack_received_date', 'last_follow_up_date'];
  for (const k of dates) {
    if (record[k] !== undefined) {
      f[k] = record[k] ? new Date(record[k]).toISOString() : null;
    }
  }

  if (record.constraint_flag !== undefined) {
    f.constraint_flag = !!record.constraint_flag;
  }

  if (record.line_items !== undefined) {
    f.line_items_json = JSON.stringify(record.line_items || []);
  }
  if (record.line_item_ship_dates !== undefined) {
    f.line_item_ship_dates_json = JSON.stringify(record.line_item_ship_dates || {});
  }
  if (record.received_items !== undefined) {
    f.received_items_json = JSON.stringify(record.received_items || []);
  }

  return f;
}

/**
 * Locate an existing list item by po_number using Graph $filter.
 * Returns the item ID if found, null if not.
 */
async function findItemIdByPoNumber(customerId, siteId, listId, poNumber) {
  // Note: SharePoint list columns are filterable through Graph using
  // fields/<column>. The eq operator requires single quotes around the
  // value with internal single quotes doubled per OData rules.
  const escaped = String(poNumber).replace(/'/g, "''");
  const path =
    `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/items` +
    `?$expand=fields($select=po_number)&$filter=fields/po_number eq '${encodeURIComponent(escaped)}'` +
    `&$top=2`;

  const res = await graphRequest(customerId, path, {
    headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' },
  });
  if (!res.ok) return res;

  const items = (res.data && res.data.value) || [];
  if (items.length === 0) return { ok: true, itemId: null };
  if (items.length > 1) {
    // Duplicate po_numbers indicate a bug in earlier writes. Surface it
    // rather than silently picking one.
    return { ok: false, error: `Duplicate po_number in SharePoint list: ${poNumber}` };
  }
  return { ok: true, itemId: items[0].id };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upsert a single tracking record. Updates if po_number already exists,
 * creates a new item otherwise.
 *
 * @param {string} customerId
 * @param {object} record   Tracking record (see schema in
 *                          lib/normalize/schemas/purchase-orders.js).
 *                          Must include po_number.
 * @returns {Promise<{ ok:true, itemId:string, action:'created'|'updated' }
 *                  | { ok:false, error:string }>}
 */
async function upsertRecord(customerId, record) {
  if (!record || !record.po_number) {
    return { ok: false, error: 'Record missing po_number' };
  }

  const loc = getListLocation(customerId);
  if (!loc.ok) return loc;

  const lookup = await findItemIdByPoNumber(customerId, loc.siteId, loc.listId, record.po_number);
  if (!lookup.ok) return lookup;

  const fields = recordToFields(record);

  if (lookup.itemId) {
    // Update existing
    const path = `/sites/${encodeURIComponent(loc.siteId)}/lists/${encodeURIComponent(loc.listId)}/items/${encodeURIComponent(lookup.itemId)}/fields`;
    const res = await graphRequest(customerId, path, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    });
    if (!res.ok) return res;
    return { ok: true, itemId: lookup.itemId, action: 'updated' };
  }

  // Create new
  const path = `/sites/${encodeURIComponent(loc.siteId)}/lists/${encodeURIComponent(loc.listId)}/items`;
  const res = await graphRequest(customerId, path, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) return res;
  return { ok: true, itemId: res.data.id, action: 'created' };
}

/**
 * Update specific fields on an existing record without doing the
 * po_number lookup. Used by follow-up-triggers.js to stamp
 * `last_follow_up_date` after a send.
 *
 * @param {string} customerId
 * @param {string} itemId       SharePoint list item ID (numeric string).
 * @param {object} partial      Partial record (only present fields are written).
 */
async function patchRecord(customerId, itemId, partial) {
  const loc = getListLocation(customerId);
  if (!loc.ok) return loc;

  const fields = recordToFields(partial);
  const path = `/sites/${encodeURIComponent(loc.siteId)}/lists/${encodeURIComponent(loc.listId)}/items/${encodeURIComponent(itemId)}/fields`;
  const res = await graphRequest(customerId, path, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
  if (!res.ok) return res;
  return { ok: true, itemId };
}

/**
 * Append a queued email entry for the manual-review flow.
 *
 * The email queue lives in a parallel SharePoint list configured via:
 *   SLS_SP_QUEUE_LIST_<CUSTOMER_ID>
 *
 * Queue item columns:
 *   po_number        Single line of text
 *   email_type       Choice (STAGE_1 | STAGE_2 | CONSTRAINT_ALERT)
 *   recipient        Single line of text
 *   subject          Single line of text
 *   body             Multiple lines of text
 *   created_at       Date
 *   status           Choice (PENDING | SENT | SKIPPED)
 */
async function queueEmail(customerId, entry) {
  const key = customerKey(customerId);
  const siteId = process.env[`SLS_SP_SITE_${key}`];
  const queueListId = process.env[`SLS_SP_QUEUE_LIST_${key}`];

  if (!siteId)      return { ok: false, error: `Missing env: SLS_SP_SITE_${key}` };
  if (!queueListId) return { ok: false, error: `Missing env: SLS_SP_QUEUE_LIST_${key}` };

  const fields = {
    po_number:  String(entry.po_number || ''),
    email_type: String(entry.email_type || 'STAGE_1'),
    recipient:  String(entry.recipient || ''),
    subject:    String(entry.subject || ''),
    body:       String(entry.body || ''),
    created_at: new Date().toISOString(),
    status:     'PENDING',
  };

  const path = `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(queueListId)}/items`;
  const res = await graphRequest(customerId, path, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) return res;
  return { ok: true, itemId: res.data.id };
}

module.exports = {
  upsertRecord,
  patchRecord,
  queueEmail,
  // Exported for the reader so it can decode the same field shape.
  recordToFields,
};
