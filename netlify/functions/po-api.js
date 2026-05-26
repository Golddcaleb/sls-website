'use strict';

/**
 * netlify/functions/po-api.js
 * Signal Logic Systems LLC
 *
 * Thin SharePoint proxy serving the PO dashboard.
 *
 * Why this exists (and why it's the only file added beyond the build
 * spec's explicit list): the dashboard is a static page on Netlify. A
 * browser cannot safely hold per-tenant Graph credentials, so it can't
 * call Graph directly. This endpoint runs on the SLS side, talks to
 * the customer's Graph using the per-customer env vars, and passes the
 * result through. No PO data is stored on SLS infrastructure — every
 * read is live against the customer's SharePoint, every write goes
 * back to the customer's SharePoint. The "hold the calculator"
 * boundary is preserved.
 *
 * Auth: HMAC token issued by onboard-customer.js. Format:
 *   <customer_id>.<issued_at_unix>.<sha256(customer_id + '.' + issued_at, SLS_SECRET_<customer_id>)>
 *
 * Routes (action = body.action):
 *   list_records       { filter? }            → tracking records
 *   list_queue         {}                     → pending email queue
 *   list_alerts        {}                     → constraint shifts to surface
 *   patch_record       { item_id, partial }   → update tracking fields
 *   send_queue_item    { item_id }            → send queued email + mark SENT
 *   skip_queue_item    { item_id }            → mark queued email SKIPPED
 *   edit_queue_item    { item_id, subject, body, recipient } → edit pending email
 *   update_config      { config }             → returns env-var block to install
 *   notify_constraint  { record, shift }      → send the constraint-shift alert
 *
 * All requests POST JSON. All responses are JSON.
 */

const { createHmac, timingSafeEqual } = require('crypto');
const { customerKey, graphRequest } = require('../../lib/integrations/graph-api/auth');
const { listRecords, listQueuedEmails, isOverdue } = require('../../lib/integrations/graph-api/sharepoint-reader');
const { upsertRecord, patchRecord } = require('../../lib/integrations/graph-api/sharepoint-writer');
const { sendEmail } = require('../../lib/integrations/graph-api/email-sender');
const { analyzeLeadTime } = require('../../lib/analyze/po-tracking/lead-time');
const { detectShift } = require('../../lib/analyze/po-tracking/constraint-shift');
const { constraintAlertEmail } = require('../../lib/analyze/po-tracking/follow-up-triggers');

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function verifyToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, error: 'missing token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'malformed token' };

  const [customerId, issuedAtStr, sig] = parts;
  const issuedAt = parseInt(issuedAtStr, 10);
  if (isNaN(issuedAt)) return { ok: false, error: 'bad issuedAt' };

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - issuedAt > TOKEN_TTL_SECONDS) return { ok: false, error: 'expired' };

  const key = customerKey(customerId);
  const secret = process.env[`SLS_SECRET_${key}`];
  if (!secret) return { ok: false, error: 'unknown customer' };

  const expected = createHmac('sha256', secret).update(`${customerId}.${issuedAt}`).digest('hex');
  if (sig.length !== expected.length) return { ok: false, error: 'sig length mismatch' };

  const eq = timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  if (!eq) return { ok: false, error: 'sig mismatch' };

  return { ok: true, customerId };
}

// ---------------------------------------------------------------------------
// Config helpers (per-customer JSON blob in env)
// ---------------------------------------------------------------------------

function readConfig(customerId) {
  const key = customerKey(customerId);
  const raw = process.env[`SLS_PO_CONFIG_${key}`];
  if (!raw) {
    return {
      auto_send: false,
      ack_timer: 3,
      follow_up_window: 2,
      min_followup_gap_days: 3,
      notification_target: 'ops_lead',
      custom_notification_email: null,
      keywords: null,
    };
  }
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function resolveNotificationRecipient(customerId, cfg) {
  if (cfg && cfg.notification_target === 'custom' && cfg.custom_notification_email) {
    return cfg.custom_notification_email;
  }
  // Standard targets map to per-customer env vars set at onboarding.
  // None of these are *required* to be set — caller will see a clear
  // error if they try to NOTIFY without one configured.
  const key = customerKey(customerId);
  const map = {
    ops_lead:        `SLS_PO_NOTIFY_OPS_${key}`,
    plant_manager:   `SLS_PO_NOTIFY_PM_${key}`,
    end_customer:    `SLS_PO_NOTIFY_CUSTOMER_${key}`,
  };
  const envVar = map[cfg && cfg.notification_target] || map.ops_lead;
  return process.env[envVar] || null;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function actionListRecords(customerId, body) {
  const filter = body.filter || {};
  const res = await listRecords(customerId, filter);
  if (!res.ok) return res;

  const now = new Date();
  const records = res.records.map(r => Object.assign({}, r, {
    overdue: isOverdue(r, now),
  }));
  return { ok: true, records };
}

async function actionListQueue(customerId) {
  return listQueuedEmails(customerId);
}

async function actionListAlerts(customerId) {
  // Surface every record whose constraint_flag is true OR whose current
  // computed constraint differs from prior_constraint_item.
  const res = await listRecords(customerId, {});
  if (!res.ok) return res;

  const constraints = analyzeLeadTime(res.records);
  if (!constraints.ok) return constraints;

  // Build a per-job pair of { prior, current } from record state. Prior
  // values are stamped on the records by previous evaluation cycles.
  const byJob = new Map();
  for (const c of constraints.constraints) byJob.set(c.job_id, c);

  const alerts = [];
  const seenJobs = new Set();
  for (const r of res.records) {
    if (!r.job_id || seenJobs.has(r.job_id)) continue;
    seenJobs.add(r.job_id);
    const current = byJob.get(r.job_id);
    if (!current) continue;
    const prior = {
      constraint_item: r.prior_constraint_item || null,
      expected_date:   null, // not currently stamped on the record
    };
    const shift = detectShift(prior, current);
    if (r.constraint_flag || shift.shifted) {
      alerts.push(Object.assign({ job_id: r.job_id, contributing_po: current.contributing_po }, shift));
    }
  }
  return { ok: true, alerts };
}

async function actionPatchRecord(customerId, body) {
  if (!body.item_id || !body.partial) return { ok: false, error: 'item_id and partial required' };
  return patchRecord(customerId, body.item_id, body.partial);
}

async function actionSendQueueItem(customerId, body) {
  if (!body.item_id) return { ok: false, error: 'item_id required' };

  // Re-read the queue item by ID so the user can't fake the body.
  const queueRes = await listQueuedEmails(customerId);
  if (!queueRes.ok) return queueRes;
  const entry = queueRes.queue.find(q => String(q._itemId) === String(body.item_id));
  if (!entry) return { ok: false, error: 'queue item not found or already actioned' };

  const sendRes = await sendEmail(customerId, {
    to: entry.recipient,
    subject: entry.subject,
    body: entry.body,
  });
  if (!sendRes.ok) return sendRes;

  // Mark SENT in the queue list.
  const key = customerKey(customerId);
  const siteId = process.env[`SLS_SP_SITE_${key}`];
  const queueListId = process.env[`SLS_SP_QUEUE_LIST_${key}`];
  const path = `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(queueListId)}/items/${encodeURIComponent(entry._itemId)}/fields`;
  await graphRequest(customerId, path, { method: 'PATCH', body: JSON.stringify({ status: 'SENT' }) });

  // Stamp last_follow_up_date on the tracking record if we can find it.
  if (entry.po_number) {
    await upsertRecord(customerId, {
      po_number: entry.po_number,
      last_follow_up_date: new Date().toISOString(),
    });
  }

  return { ok: true, sent_at: sendRes.sentAt };
}

async function actionSkipQueueItem(customerId, body) {
  if (!body.item_id) return { ok: false, error: 'item_id required' };
  const key = customerKey(customerId);
  const siteId = process.env[`SLS_SP_SITE_${key}`];
  const queueListId = process.env[`SLS_SP_QUEUE_LIST_${key}`];
  const path = `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(queueListId)}/items/${encodeURIComponent(body.item_id)}/fields`;
  const res = await graphRequest(customerId, path, { method: 'PATCH', body: JSON.stringify({ status: 'SKIPPED' }) });
  if (!res.ok) return res;
  return { ok: true };
}

async function actionEditQueueItem(customerId, body) {
  if (!body.item_id) return { ok: false, error: 'item_id required' };
  const key = customerKey(customerId);
  const siteId = process.env[`SLS_SP_SITE_${key}`];
  const queueListId = process.env[`SLS_SP_QUEUE_LIST_${key}`];
  const path = `/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(queueListId)}/items/${encodeURIComponent(body.item_id)}/fields`;
  const fields = {};
  if (body.subject   !== undefined) fields.subject   = String(body.subject);
  if (body.body      !== undefined) fields.body      = String(body.body);
  if (body.recipient !== undefined) fields.recipient = String(body.recipient);
  const res = await graphRequest(customerId, path, { method: 'PATCH', body: JSON.stringify(fields) });
  if (!res.ok) return res;
  return { ok: true };
}

/**
 * The dashboard cannot rewrite env vars — those live on Netlify. This
 * action returns the env-var block the admin must paste in, the same
 * way onboard-customer.js does. The dashboard surfaces "settings
 * pending install" UI when the returned config doesn't yet match the
 * deployed one.
 */
async function actionUpdateConfig(customerId, body) {
  if (!body.config || typeof body.config !== 'object') {
    return { ok: false, error: 'config object required' };
  }
  const key = customerKey(customerId);
  const env = {
    [`SLS_PO_CONFIG_${key}`]: JSON.stringify(body.config),
  };
  if (Array.isArray(body.config.keywords) && body.config.keywords.length) {
    env[`SLS_PO_KEYWORDS_${key}`] = body.config.keywords.join(',');
  }
  return {
    ok: true,
    env_vars: env,
    note: 'Settings staged. Install these env vars on Netlify and redeploy to activate.',
  };
}

async function actionNotifyConstraint(customerId, body) {
  if (!body.record || !body.shift) return { ok: false, error: 'record and shift required' };
  const cfg = readConfig(customerId);
  const recipient = resolveNotificationRecipient(customerId, cfg);
  if (!recipient) return { ok: false, error: 'No notification recipient configured' };

  const tpl = constraintAlertEmail(body.record, body.shift);
  const res = await sendEmail(customerId, {
    to: recipient,
    subject: tpl.subject,
    body: tpl.body,
  });
  if (!res.ok) return res;
  return { ok: true, sent_at: res.sentAt, recipient };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const ACTIONS = {
  list_records:       actionListRecords,
  list_queue:         actionListQueue,
  list_alerts:        actionListAlerts,
  patch_record:       actionPatchRecord,
  send_queue_item:    actionSendQueueItem,
  skip_queue_item:    actionSkipQueueItem,
  edit_queue_item:    actionEditQueueItem,
  update_config:      actionUpdateConfig,
  notify_constraint:  actionNotifyConstraint,
  // Convenience: surfaces the current config to the dashboard on load.
  get_config: async (customerId) => ({ ok: true, config: readConfig(customerId) }),
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'POST required' });

    const authz = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    const auth = verifyToken(token);
    if (!auth.ok) return jsonResponse(401, { ok: false, error: `Unauthorized: ${auth.error}` });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (_) { return jsonResponse(400, { ok: false, error: 'Invalid JSON body' }); }

    const action = body.action;
    const handler = ACTIONS[action];
    if (!handler) return jsonResponse(400, { ok: false, error: `Unknown action: ${action}` });

    const result = await handler(auth.customerId, body);
    return jsonResponse(result.ok ? 200 : 400, result);
  } catch (err) {
    console.error('[po-api] uncaught:', err && err.stack || err);
    return jsonResponse(500, { ok: false, error: 'Internal Server Error' });
  }
};
