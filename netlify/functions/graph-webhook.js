'use strict';

/**
 * netlify/functions/graph-webhook.js
 * Signal Logic Systems LLC
 *
 * Endpoint that receives Microsoft Graph change notifications for a
 * customer's procurement mailbox. The primary realtime path that
 * brings vendor replies into the PO tracker.
 *
 * Subscription lifecycle:
 *   1. onboard-customer.js POSTs to /subscriptions on Graph to register
 *      this URL for the customer mailbox. The subscription includes
 *      a clientState string that we verify on every notification.
 *   2. Graph immediately calls back with a `?validationToken=<...>`
 *      query param. We MUST echo the token (plain text, status 200)
 *      within ~10 seconds or the subscription is rejected.
 *   3. Subsequent change notifications arrive as POST bodies of shape:
 *        {
 *          value: [
 *            {
 *              subscriptionId, clientState,
 *              resource: 'Users/.../messages/<id>',
 *              changeType: 'created',
 *              ...
 *            }
 *          ]
 *        }
 *      We must return 202 Accepted within ~30s or Graph will retry.
 *
 * Customer routing:
 *   The notification doesn't carry our customer_id, but it carries the
 *   subscriptionId. We map subscription → customer via env vars set at
 *   onboarding time:
 *     SLS_M365_SUBSCRIPTION_<CUSTOMER_ID>      Subscription GUID
 *     SLS_M365_SUBSCRIPTION_SECRET_<CUSTOMER_ID>  clientState value
 *
 * Hold-the-calculator principle: as in inbox-monitor.js, raw message
 * content is parsed in memory, written to the customer's SharePoint,
 * and discarded. Nothing about the email's content is logged on the
 * SLS side. We log only counts and customer IDs.
 */

const { graphRequest } = require('../../lib/integrations/graph-api/auth');
const { parse } = require('../../lib/integrations/graph-api/email-parser');
const { upsertRecord } = require('../../lib/integrations/graph-api/sharepoint-writer');
const { envelopeToRecord } = require('../../lib/integrations/graph-api/inbox-monitor');

// ---------------------------------------------------------------------------
// Subscription registry lookup
// ---------------------------------------------------------------------------

/**
 * Resolve the customer ID for a given subscription ID by scanning the
 * registry env vars. Linear scan is fine — onboarded customers are
 * single-digit counts for the foreseeable future.
 *
 * @returns {{ customerId: string|null, expectedClientState: string|null }}
 */
function resolveCustomerForSubscription(subscriptionId) {
  const prefix = 'SLS_M365_SUBSCRIPTION_';
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith(prefix)) continue;
    if (key.startsWith(prefix + 'SECRET_')) continue;
    if (process.env[key] === subscriptionId) {
      const customerId = key.slice(prefix.length);
      const expectedClientState = process.env[`${prefix}SECRET_${customerId}`] || null;
      return { customerId, expectedClientState };
    }
  }
  return { customerId: null, expectedClientState: null };
}

// ---------------------------------------------------------------------------
// Notification handling
// ---------------------------------------------------------------------------

/**
 * Process a single notification envelope: fetch the message, parse,
 * upsert into SharePoint. Errors are caught and returned so one bad
 * message doesn't poison the rest of a batch.
 */
async function handleNotification(notification) {
  const subId = notification.subscriptionId;
  const { customerId, expectedClientState } = resolveCustomerForSubscription(subId);
  if (!customerId) {
    return { ok: false, error: `Unknown subscription: ${subId}` };
  }

  // clientState verification: prevents notifications from a forged
  // subscription ID being processed. Graph guarantees this echo.
  if (expectedClientState && notification.clientState !== expectedClientState) {
    return { ok: false, error: `clientState mismatch for subscription ${subId}` };
  }

  // resource is of the form Users/<id>/Messages/<message-id>
  const resourcePath = '/' + String(notification.resource || '').replace(/^\/+/, '');
  if (!/messages\/[^/]+$/i.test(resourcePath)) {
    return { ok: false, error: `Unexpected resource path: ${resourcePath}` };
  }

  const select = 'id,subject,from,bodyPreview,receivedDateTime,body';
  const fetched = await graphRequest(customerId, `${resourcePath}?$select=${encodeURIComponent(select)}`);
  if (!fetched.ok) return { ok: false, error: `fetch failed: ${fetched.error}` };

  const parsed = parse(fetched.data);
  if (!parsed.ok) return { ok: false, error: `parse failed: ${parsed.error}` };

  if (!parsed.envelope.po_number) {
    // No PO number on the message — discard. Logged at the count level
    // by the caller, no per-message detail.
    return { ok: true, skipped: true, reason: 'no po_number' };
  }

  const record = envelopeToRecord(parsed.envelope);
  const up = await upsertRecord(customerId, record);
  if (!up.ok) return { ok: false, error: `upsert failed: ${up.error}` };

  return { ok: true, customerId, po_number: parsed.envelope.po_number, action: up.action };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

exports.handler = async (event) => {
  // ── Subscription validation ─────────────────────────────────────────
  // Graph calls back with validationToken when a subscription is first
  // created. Must echo it as plain text within ~10s.
  const validationToken =
    (event.queryStringParameters && event.queryStringParameters.validationToken) ||
    (event.queryStringParameters && event.queryStringParameters.validationtoken);

  if (validationToken) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: String(validationToken),
    };
  }

  // ── Notification path ───────────────────────────────────────────────
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed.' };
  }

  let body;
  try {
    const raw = event.body || '';
    const decoded = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
    body = JSON.parse(decoded);
  } catch (err) {
    return { statusCode: 400, body: 'Bad Request: invalid JSON.' };
  }

  const notifications = Array.isArray(body && body.value) ? body.value : [];

  // Return 202 fast — actual processing happens inline but Graph wants
  // an ack within 30s. If we have a large batch we still process all
  // of it; Netlify Function timeout is 10s by default but can be raised
  // to 26s for synchronous and 15min for background. Run-of-the-mill
  // notifications are 1-5 items, well under the limit.
  const results = await Promise.all(notifications.map(handleNotification));

  const okCount   = results.filter(r => r && r.ok).length;
  const failCount = results.length - okCount;
  if (failCount) {
    console.warn(`[graph-webhook] processed=${results.length} ok=${okCount} failed=${failCount}`);
    for (const r of results) {
      if (r && !r.ok) console.warn(`[graph-webhook]   - ${r.error}`);
    }
  } else {
    console.log(`[graph-webhook] processed=${results.length} ok=${okCount}`);
  }

  return {
    statusCode: 202,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ processed: results.length, ok: okCount, failed: failCount }),
  };
};
