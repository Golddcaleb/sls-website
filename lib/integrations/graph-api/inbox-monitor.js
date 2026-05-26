'use strict';

/**
 * lib/integrations/graph-api/inbox-monitor.js
 * Signal Logic Systems LLC
 *
 * Polls the customer's procurement mailbox for vendor emails relevant
 * to active POs, hands matched messages to email-parser.js, and writes
 * the parsed envelopes to SharePoint via sharepoint-writer.js.
 *
 * Primary realtime path is the Graph webhook (graph-webhook.js). This
 * poller exists for:
 *   1. Initial backfill at onboarding.
 *   2. Cron / scheduled-function safety net so a missed webhook
 *      notification doesn't strand a vendor reply.
 *
 * Hold-the-calculator principle: messages flow:
 *
 *     Graph API → poll() → match keywords → parse to envelope
 *                                             ↓
 *                                       upsertRecord(SharePoint)
 *                                             ↓
 *                                       discard raw message
 *
 * The raw Graph message never leaves this function's stack frame. No
 * raw subject, body, or sender address is logged.
 *
 * Configuration:
 *   SLS_M365_MAILBOX_<CUSTOMER_ID>      Mailbox UPN to monitor.
 *   SLS_PO_KEYWORDS_<CUSTOMER_ID>       Optional comma-separated
 *                                       keyword override. Falls back
 *                                       to DEFAULT_KEYWORDS.
 */

const { graphRequest, customerKey } = require('./auth');
const { parse } = require('./email-parser');
const { upsertRecord } = require('./sharepoint-writer');

const DEFAULT_KEYWORDS = [
  'PO', 'purchase order', 'order acknowledgment', 'ship date',
  'estimated delivery', 'estimated ship', 'item shipped', 'tracking number',
  'dispatch notice', 'delay', 'revised date', 'received', 'delivered',
];

// Default lookback for a poll — matches the safety-net interval. The
// webhook handles realtime; this is just to catch anything missed.
const DEFAULT_LOOKBACK_MINUTES = 30;

function getKeywords(customerId) {
  const key = customerKey(customerId);
  const raw = process.env[`SLS_PO_KEYWORDS_${key}`];
  if (raw) {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  return DEFAULT_KEYWORDS.slice();
}

function getMailbox(customerId) {
  const key = customerKey(customerId);
  const upn = process.env[`SLS_M365_MAILBOX_${key}`];
  if (!upn) return { ok: false, error: `Missing env: SLS_M365_MAILBOX_${key}` };
  return { ok: true, upn };
}

/**
 * Test whether a message matches any of the keyword list. Case
 * insensitive substring match on subject + body preview. Body preview
 * is short (Graph returns ~255 chars) so this is cheap.
 */
function matchesKeywords(message, keywords) {
  const haystack = (
    (message.subject || '') + ' ' +
    (message.bodyPreview || '')
  ).toLowerCase();
  for (const k of keywords) {
    if (haystack.includes(k.toLowerCase())) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run one poll cycle for a customer mailbox. Each matching message is
 * parsed and upserted; per-message errors are collected but do not
 * abort the run.
 *
 * @param {string} customerId
 * @param {object} [opts]
 * @param {number} [opts.lookbackMinutes]  Default 30.
 * @param {number} [opts.maxMessages]      Hard cap per run. Default 100.
 * @returns {Promise<{ ok:true, scanned:number, matched:number, written:number, errors:string[] }
 *                  | { ok:false, error:string }>}
 */
async function poll(customerId, opts = {}) {
  const mb = getMailbox(customerId);
  if (!mb.ok) return mb;

  const keywords = getKeywords(customerId);
  const lookback = opts.lookbackMinutes || DEFAULT_LOOKBACK_MINUTES;
  const cap      = opts.maxMessages || 100;

  const sinceIso = new Date(Date.now() - lookback * 60_000).toISOString();
  const filter = `receivedDateTime ge ${sinceIso}`;
  const select = 'id,subject,from,bodyPreview,receivedDateTime,body';

  const path =
    `/users/${encodeURIComponent(mb.upn)}/messages` +
    `?$select=${encodeURIComponent(select)}` +
    `&$filter=${encodeURIComponent(filter)}` +
    `&$top=${cap}` +
    `&$orderby=receivedDateTime desc`;

  const res = await graphRequest(customerId, path);
  if (!res.ok) return res;

  const messages = (res.data && res.data.value) || [];
  let matched = 0;
  let written = 0;
  const errors = [];

  for (const msg of messages) {
    if (!matchesKeywords(msg, keywords)) continue;
    matched++;

    const parsed = parse(msg);
    if (!parsed.ok) {
      errors.push(`parse failed for ${msg.id}: ${parsed.error}`);
      continue;
    }

    const env = parsed.envelope;
    if (!env.po_number) {
      // No PO number = nothing to upsert against. The message is
      // logged as scanned and discarded. Real follow-up would route
      // these to an exception queue; out of scope for this build.
      continue;
    }

    const record = envelopeToRecord(env);
    const up = await upsertRecord(customerId, record);
    if (!up.ok) {
      errors.push(`upsert failed for ${env.po_number}: ${up.error}`);
      continue;
    }
    written++;
  }

  return { ok: true, scanned: messages.length, matched, written, errors };
}

/**
 * Convert a parsed email envelope into a tracking-record patch shape
 * suitable for upsertRecord. Only fields that the email actually
 * provided are included — upsertRecord's PATCH semantics mean
 * everything else on the existing record is preserved.
 */
function envelopeToRecord(env) {
  const record = {
    po_number: env.po_number,
  };
  if (env.vendor) record.vendor = env.vendor;

  if (env.ack_received_date) {
    record.ack_received_date = env.ack_received_date;
    record.stage = 'STAGE_2';
  }
  if (env.received_date) {
    record.stage = 'RECEIVED';
  }
  if (env.estimated_ship_date) {
    // We don't know which line item this date is for from a free-text
    // email — store under a synthetic key. The dashboard will surface
    // an "unmatched-item ship date" hint so the user can attach it to
    // the right line item if needed.
    record.line_item_ship_dates = { _email_hint: env.estimated_ship_date };
  }
  return record;
}

module.exports = {
  poll,
  DEFAULT_KEYWORDS,
  matchesKeywords,
  envelopeToRecord,
};
