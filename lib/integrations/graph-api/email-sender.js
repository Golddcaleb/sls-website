'use strict';

/**
 * lib/integrations/graph-api/email-sender.js
 * Signal Logic Systems LLC
 *
 * Sends emails on behalf of the customer through their own Outlook
 * mailbox via Microsoft Graph.
 *
 * Hold-the-calculator + no-SLS-email principle: every outbound email
 * travels through the customer's tenant. SLS owns no inbox, no sender
 * domain, no relay. The customer sees these messages in their Sent
 * Items folder and can audit them at any time.
 *
 * Endpoint selection:
 *   The spec phrases this as `/me/sendMail` ("through customer's own
 *   Outlook"). With the client-credentials (app-only) auth flow there
 *   is no `/me` — we must target a specific mailbox. The configured
 *   mailbox is read from env:
 *
 *     SLS_M365_MAILBOX_<CUSTOMER_ID>   The UPN of the procurement
 *                                      mailbox to send from
 *                                      (e.g. procurement@contoso.com).
 *
 *   App permissions required on the customer's app registration:
 *     Mail.Send  (Application)
 *   Optionally scoped to a single mailbox via an Exchange Online
 *   Application Access Policy if the customer prefers.
 *
 * Send-status logging:
 *   After every send attempt, follow-up-triggers.js (the only caller)
 *   stamps `last_follow_up_date` and a note on the SharePoint tracking
 *   record. That happens at the trigger layer, not here, so this
 *   module stays focused on the send mechanic alone.
 */

const { graphRequest, customerKey } = require('./auth');

function getMailbox(customerId) {
  const key = customerKey(customerId);
  if (!key) return { ok: false, error: 'Invalid customer ID' };
  const upn = process.env[`SLS_M365_MAILBOX_${key}`];
  if (!upn) return { ok: false, error: `Missing env: SLS_M365_MAILBOX_${key}` };
  return { ok: true, upn };
}

/**
 * Send a single email via Graph.
 *
 * @param {string} customerId
 * @param {object} email
 * @param {string|string[]} email.to       Recipient address(es).
 * @param {string} email.subject
 * @param {string} email.body              Plain text body (default).
 * @param {string} [email.bodyType]        'text' | 'html'. Default 'text'.
 * @param {string|string[]} [email.cc]     Optional CC recipients.
 * @param {boolean} [email.saveToSent]     Save to mailbox Sent Items. Default true.
 * @returns {Promise<{ ok:true, sentAt:string } | { ok:false, error:string }>}
 */
async function sendEmail(customerId, email) {
  if (!email || !email.to || !email.subject || !email.body) {
    return { ok: false, error: 'sendEmail(): to, subject, and body are required' };
  }

  const mb = getMailbox(customerId);
  if (!mb.ok) return mb;

  const toArr = Array.isArray(email.to) ? email.to : [email.to];
  const ccArr = email.cc ? (Array.isArray(email.cc) ? email.cc : [email.cc]) : [];

  const payload = {
    message: {
      subject: String(email.subject),
      body: {
        contentType: email.bodyType === 'html' ? 'HTML' : 'Text',
        content:     String(email.body),
      },
      toRecipients: toArr.map(addr => ({ emailAddress: { address: String(addr) } })),
    },
    saveToSentItems: email.saveToSent !== false,
  };

  if (ccArr.length) {
    payload.message.ccRecipients = ccArr.map(addr => ({ emailAddress: { address: String(addr) } }));
  }

  const path = `/users/${encodeURIComponent(mb.upn)}/sendMail`;
  const res = await graphRequest(customerId, path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) return res;

  // Graph returns 202 Accepted with no body on success.
  return { ok: true, sentAt: new Date().toISOString() };
}

module.exports = { sendEmail };
