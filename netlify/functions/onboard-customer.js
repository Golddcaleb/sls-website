'use strict';

/**
 * netlify/functions/onboard-customer.js
 * Signal Logic Systems LLC
 *
 * One-shot customer onboarding for the PO Tracking tool.
 *
 * Does three things, in order:
 *   1. Provision the SharePoint tracking + email-queue lists in the
 *      customer's tenant.
 *   2. Register a Graph webhook subscription against the customer's
 *      procurement mailbox so vendor replies stream into the tracker.
 *   3. Return the set of env-var names + values the SLS admin must
 *      install on Netlify so subsequent calls can authenticate. Plus
 *      the customer-facing dashboard URL.
 *
 * Why we don't write env vars ourselves: Netlify env vars are
 * configured via the Netlify CLI / API at build/deploy time, not from
 * inside a function at runtime. The architecture's "store tokens
 * encrypted in Netlify environment variables per customer" requirement
 * is satisfied by Netlify's at-rest encryption on env vars once an
 * admin pastes them in. This endpoint just collects everything in one
 * place so the admin has a single block to copy.
 *
 * Auth on this endpoint:
 *   Bearer token in Authorization header, checked against the
 *   SLS_ONBOARDING_TOKEN env var. This is an SLS-admin operation, not
 *   a customer-facing one.
 *
 * Request body shape:
 *   {
 *     customer_id:    'BLUEASH',
 *     m365_tenant_id: '00000000-0000-0000-0000-000000000000',
 *     oauth_credentials: {
 *       client_id:     '00000000-...',
 *       client_secret: '...'
 *     },
 *     mailbox_upn: 'procurement@blueash.com',
 *     sharepoint_site: 'blueash.sharepoint.com:/sites/Procurement',
 *     webhook_url: 'https://signallogicsystems.com/.netlify/functions/graph-webhook',
 *     initial_config: {
 *       auto_send: false,
 *       ack_timer: 3,
 *       follow_up_window: 2,
 *       min_followup_gap_days: 3,
 *       notification_target: 'ops_lead',
 *       custom_notification_email: null,
 *       keywords: ['PO', 'purchase order', ...]
 *     }
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     env_vars: { 'SLS_M365_TENANT_BLUEASH': '...', ... },
 *     dashboard_url: 'https://signallogicsystems.com/po-dashboard.html?customer=BLUEASH&token=...',
 *     subscription_id: '...',
 *     site_id: '...',
 *     list_ids: { tracking, email_queue }
 *   }
 */

const { customerKey } = require('../../lib/integrations/graph-api/auth');
const { randomBytes, createHmac } = require('crypto');

// ---------------------------------------------------------------------------
// Constants — list schemas to provision
// ---------------------------------------------------------------------------

// Mirror the column model documented in sharepoint-writer.js. Choice
// columns get explicit choices; text columns are single-line unless
// noted; JSON-blob columns are multiline.
const TRACKING_LIST_SCHEMA = {
  displayName: 'SLS PO Tracking',
  description: 'Signal Logic Systems — PO tracking records. Managed by the SLS engine.',
  list: { template: 'genericList' },
  columns: [
    { name: 'po_number',            text: {} },
    { name: 'vendor',               text: {} },
    { name: 'job_id',               text: {} },
    { name: 'stage',                choice: { choices: ['STAGE_1', 'STAGE_2', 'RECEIVED'], displayAs: 'dropDownMenu' } },
    { name: 'timer_start',          dateTime: { displayAs: 'standard', format: 'dateOnly' } },
    { name: 'ack_received_date',    dateTime: { displayAs: 'standard', format: 'dateOnly' } },
    { name: 'last_follow_up_date',  dateTime: { displayAs: 'standard', format: 'dateOnly' } },
    { name: 'constraint_item',      text: {} },
    { name: 'prior_constraint_item', text: {} },
    { name: 'constraint_flag',      boolean: {} },
    { name: 'notes',                text: { allowMultipleLines: true } },
    { name: 'line_items_json',           text: { allowMultipleLines: true, maxLength: 64_000 } },
    { name: 'line_item_ship_dates_json', text: { allowMultipleLines: true, maxLength: 64_000 } },
    { name: 'received_items_json',       text: { allowMultipleLines: true, maxLength: 64_000 } },
  ],
};

const QUEUE_LIST_SCHEMA = {
  displayName: 'SLS PO Email Queue',
  description: 'Signal Logic Systems — pending follow-up emails awaiting review.',
  list: { template: 'genericList' },
  columns: [
    { name: 'po_number',  text: {} },
    { name: 'email_type', choice: { choices: ['STAGE_1', 'STAGE_2', 'CONSTRAINT_ALERT'], displayAs: 'dropDownMenu' } },
    { name: 'recipient',  text: {} },
    { name: 'subject',    text: {} },
    { name: 'body',       text: { allowMultipleLines: true, maxLength: 64_000 } },
    { name: 'created_at', dateTime: { displayAs: 'standard', format: 'dateTime' } },
    { name: 'status',     choice: { choices: ['PENDING', 'SENT', 'SKIPPED'], displayAs: 'dropDownMenu' } },
  ],
};

// ---------------------------------------------------------------------------
// Token / request helpers
// ---------------------------------------------------------------------------

/**
 * Acquire a token using ad-hoc credentials supplied in the request
 * body. We can't use lib/auth's getAccessToken because the env vars
 * don't exist yet at onboarding time.
 */
async function acquireToken(tenantId, clientId, clientSecret) {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials',
  });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.access_token) {
    return { ok: false, error: json.error_description || json.error || `HTTP ${resp.status}` };
  }
  return { ok: true, accessToken: json.access_token };
}

async function graphCall(token, path, init = {}) {
  const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`;
  const headers = Object.assign(
    { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    init.headers || {}
  );
  if (init.body && !Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  const resp = await fetch(url, Object.assign({}, init, { headers }));
  const text = await resp.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
    return { ok: false, status: resp.status, error: msg };
  }
  return { ok: true, status: resp.status, data };
}

/**
 * Resolve a SharePoint site by hostname:path form (e.g.
 * "contoso.sharepoint.com:/sites/Procurement") to its Graph site ID.
 */
async function resolveSiteId(token, sitePathExpression) {
  const path = `/sites/${encodeURIComponent(sitePathExpression).replace(/%3A/g, ':')}`;
  const res = await graphCall(token, path);
  if (!res.ok) return res;
  return { ok: true, siteId: res.data.id };
}

async function createList(token, siteId, schema) {
  const path = `/sites/${encodeURIComponent(siteId)}/lists`;
  const res = await graphCall(token, path, { method: 'POST', body: JSON.stringify(schema) });
  if (!res.ok) return res;
  return { ok: true, listId: res.data.id };
}

async function createSubscription(token, mailboxUpn, webhookUrl, clientState) {
  // Expiration: max 4230 minutes (~3 days) for Mail. Set near max so
  // renewal cadence is cheap. Renewal is out of scope for this build —
  // would live in a scheduled function.
  const expirationDateTime = new Date(Date.now() + 4200 * 60 * 1000).toISOString();
  const payload = {
    changeType: 'created',
    notificationUrl: webhookUrl,
    resource: `users/${mailboxUpn}/mailFolders('inbox')/messages`,
    expirationDateTime,
    clientState,
  };
  const res = await graphCall(token, '/subscriptions', { method: 'POST', body: JSON.stringify(payload) });
  if (!res.ok) return res;
  return { ok: true, subscriptionId: res.data.id, expirationDateTime: res.data.expirationDateTime };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function textResponse(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    body: message,
  };
}

/**
 * Generate a dashboard access token. This is an HMAC of customer_id +
 * issued-at, signed with the per-customer secret already used by the
 * main HMAC flow (SLS_SECRET_<CUSTOMER_ID>). The dashboard sends it
 * back on every API call so the function can verify the bearer.
 *
 * Falls back to a random opaque token if no secret is set yet (the
 * admin will install both at the same time).
 */
function buildDashboardToken(customerId) {
  const key = customerKey(customerId);
  const secret = process.env[`SLS_SECRET_${key}`];
  if (!secret) return randomBytes(24).toString('hex');
  const issuedAt = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret)
    .update(`${customerId}.${issuedAt}`)
    .digest('hex');
  return `${customerId}.${issuedAt}.${sig}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return textResponse(405, 'Method Not Allowed.');
    }

    // Admin auth
    const authz = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    const expected = process.env.SLS_ONBOARDING_TOKEN;
    if (!expected) return textResponse(500, 'Onboarding endpoint not configured (SLS_ONBOARDING_TOKEN missing).');
    if (authz !== `Bearer ${expected}`) return textResponse(401, 'Unauthorized.');

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (_) {
      return jsonResponse(400, { ok: false, error: 'Invalid JSON body.' });
    }

    const {
      customer_id,
      m365_tenant_id,
      oauth_credentials,
      mailbox_upn,
      sharepoint_site,
      webhook_url,
      initial_config,
    } = body;

    if (!customer_id || !m365_tenant_id || !oauth_credentials ||
        !oauth_credentials.client_id || !oauth_credentials.client_secret ||
        !mailbox_upn || !sharepoint_site || !webhook_url) {
      return jsonResponse(400, { ok: false, error: 'Missing required fields.' });
    }

    // ── Acquire token (transient — never persisted SLS-side) ────────
    const tok = await acquireToken(m365_tenant_id, oauth_credentials.client_id, oauth_credentials.client_secret);
    if (!tok.ok) return jsonResponse(400, { ok: false, error: `Token acquisition failed: ${tok.error}` });

    // ── Resolve site ────────────────────────────────────────────────
    const site = await resolveSiteId(tok.accessToken, sharepoint_site);
    if (!site.ok) return jsonResponse(400, { ok: false, error: `Site resolve failed: ${site.error}` });

    // ── Provision lists ─────────────────────────────────────────────
    const trackingList = await createList(tok.accessToken, site.siteId, TRACKING_LIST_SCHEMA);
    if (!trackingList.ok) return jsonResponse(400, { ok: false, error: `Tracking list creation failed: ${trackingList.error}` });

    const queueList = await createList(tok.accessToken, site.siteId, QUEUE_LIST_SCHEMA);
    if (!queueList.ok) return jsonResponse(400, { ok: false, error: `Queue list creation failed: ${queueList.error}` });

    // ── Register webhook subscription ───────────────────────────────
    const clientState = randomBytes(24).toString('hex');
    const sub = await createSubscription(tok.accessToken, mailbox_upn, webhook_url, clientState);
    if (!sub.ok) return jsonResponse(400, { ok: false, error: `Subscription creation failed: ${sub.error}` });

    // ── Compose env-var block for SLS admin to install ──────────────
    const key = customerKey(customer_id);
    const cfg = Object.assign({
      auto_send: false,
      ack_timer: 3,
      follow_up_window: 2,
      min_followup_gap_days: 3,
      notification_target: 'ops_lead',
      custom_notification_email: null,
      keywords: null, // null means "use defaults"
    }, initial_config || {});

    const envVars = {
      [`SLS_M365_TENANT_${key}`]:               m365_tenant_id,
      [`SLS_M365_CLIENT_ID_${key}`]:            oauth_credentials.client_id,
      [`SLS_M365_CLIENT_SECRET_${key}`]:        oauth_credentials.client_secret,
      [`SLS_M365_MAILBOX_${key}`]:              mailbox_upn,
      [`SLS_SP_SITE_${key}`]:                   site.siteId,
      [`SLS_SP_LIST_${key}`]:                   trackingList.listId,
      [`SLS_SP_QUEUE_LIST_${key}`]:             queueList.listId,
      [`SLS_M365_SUBSCRIPTION_${key}`]:         sub.subscriptionId,
      [`SLS_M365_SUBSCRIPTION_SECRET_${key}`]:  clientState,
      [`SLS_PO_CONFIG_${key}`]:                 JSON.stringify(cfg),
    };
    if (cfg.keywords && Array.isArray(cfg.keywords)) {
      envVars[`SLS_PO_KEYWORDS_${key}`] = cfg.keywords.join(',');
    }

    const dashboardUrl =
      `https://signallogicsystems.com/po-dashboard.html` +
      `?customer=${encodeURIComponent(customer_id)}` +
      `&token=${encodeURIComponent(buildDashboardToken(customer_id))}`;

    return jsonResponse(200, {
      ok: true,
      customer_id,
      env_vars: envVars,
      env_var_setup_note:
        'Install these env vars on Netlify (Site settings → Environment variables), then redeploy. ' +
        'Until they are installed, no requests for this customer will authenticate.',
      site_id: site.siteId,
      list_ids: {
        tracking: trackingList.listId,
        email_queue: queueList.listId,
      },
      subscription_id: sub.subscriptionId,
      subscription_expires_at: sub.expirationDateTime,
      dashboard_url: dashboardUrl,
    });
  } catch (err) {
    console.error('[onboard-customer] uncaught:', err && err.stack || err);
    return textResponse(500, 'Internal Server Error.');
  }
};
