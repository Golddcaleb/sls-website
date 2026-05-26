'use strict';

/**
 * netlify/functions/renew-subscriptions.js
 * Signal Logic Systems LLC
 *
 * Scheduled function that renews Microsoft Graph mailbox subscriptions
 * before they expire.
 *
 * Background:
 *   Graph mail subscriptions live a maximum of 4230 minutes (~70 hours,
 *   just under 3 days). If a subscription expires, the customer's
 *   procurement inbox stops streaming notifications into the PO tracker
 *   and vendor replies start falling through the cracks. inbox-monitor.js
 *   is a fallback poller for exactly this case, but the realtime path
 *   should not be allowed to silently die.
 *
 * Schedule:
 *   Wired in netlify.toml under [functions."renew-subscriptions"] as
 *   `schedule = "@daily"`. Daily firing gives ~46+ hours of buffer
 *   before any subscription could expire — well within the 70-hour
 *   max lifetime — so one missed run isn't fatal.
 *
 * What it does, per customer:
 *   1. Look up the subscription ID from SLS_M365_SUBSCRIPTION_<ID>.
 *   2. GET /subscriptions/{id} to read current expirationDateTime.
 *   3. If expiring within RENEWAL_THRESHOLD_HOURS, PATCH with a new
 *      expiration near the 70-hour maximum.
 *   4. Log per-customer outcome. Per-customer failures do NOT abort
 *      the loop — a misconfigured customer must not block renewals
 *      for the rest.
 *
 * If GET returns 404, the subscription was deleted tenant-side (admin
 * pulled it, app perms revoked, etc.). We log and skip — recreating
 * requires the mailbox UPN + webhook URL the original onboarding had,
 * which isn't worth duplicating here. Re-run onboard-customer.js in
 * that case.
 *
 * Auth: dual-mode.
 *   - Scheduled invocation by Netlify is unauthenticated (Netlify
 *     fires the function internally with a `next_run` event body).
 *   - HTTP invocation (manual run / test) requires
 *     `Authorization: Bearer <SLS_ONBOARDING_TOKEN>`.
 */

const { graphRequest } = require('../../lib/integrations/graph-api/auth');

// Renew if the subscription expires within this many hours. At the
// recommended @daily schedule, every subscription will be inside this
// window once per day, so it gets renewed on every run.
const RENEWAL_THRESHOLD_HOURS = 36;

// New expiration to set when renewing — near the Graph max of 4230
// minutes (70.5h). Leaving a small buffer below the cap so a slight
// clock drift between us and Graph doesn't push the value out of range.
const NEW_EXPIRATION_MINUTES = 4200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

/**
 * Enumerate every (customerId, subscriptionId) pair currently
 * configured on this Netlify site. Scans env vars matching
 * SLS_M365_SUBSCRIPTION_<CUSTOMER_ID>, excluding the parallel
 * SLS_M365_SUBSCRIPTION_SECRET_* keys.
 */
function listSubscriptions() {
  const prefix = 'SLS_M365_SUBSCRIPTION_';
  const out = [];
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith(prefix)) continue;
    if (key.startsWith(`${prefix}SECRET_`)) continue;
    out.push({
      customerId:     key.slice(prefix.length),
      subscriptionId: process.env[key],
    });
  }
  return out;
}

/**
 * Renew one subscription if necessary. Returns a per-customer outcome
 * object suitable for the summary report.
 */
async function renewOne(customerId, subscriptionId) {
  const now = Date.now();

  // Read current state
  const getRes = await graphRequest(customerId, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  if (!getRes.ok) {
    if (getRes.status === 404) {
      return { customerId, subscriptionId, action: 'missing', error: 'Subscription not found on Graph (re-onboard required)' };
    }
    return { customerId, subscriptionId, action: 'error', error: `GET failed: ${getRes.error}` };
  }

  const currentExpStr = getRes.data && getRes.data.expirationDateTime;
  const currentExpMs = currentExpStr ? Date.parse(currentExpStr) : NaN;
  if (isNaN(currentExpMs)) {
    return { customerId, subscriptionId, action: 'error', error: 'Could not parse current expirationDateTime' };
  }

  const hoursUntilExp = (currentExpMs - now) / 3_600_000;

  if (hoursUntilExp > RENEWAL_THRESHOLD_HOURS) {
    return {
      customerId,
      subscriptionId,
      action: 'skipped',
      hours_until_expiration: Math.round(hoursUntilExp * 10) / 10,
    };
  }

  // Renew
  const newExp = new Date(now + NEW_EXPIRATION_MINUTES * 60_000).toISOString();
  const patchRes = await graphRequest(customerId, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ expirationDateTime: newExp }),
  });
  if (!patchRes.ok) {
    return { customerId, subscriptionId, action: 'error', error: `PATCH failed: ${patchRes.error}` };
  }

  return {
    customerId,
    subscriptionId,
    action: 'renewed',
    previous_expiration: currentExpStr,
    new_expiration: newExp,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

exports.handler = async (event) => {
  const startedAt = Date.now();

  try {
    // Auth: bypass for scheduled invocation (Netlify fires with a
    // body containing `next_run` and no auth headers).
    const isScheduled = (() => {
      try {
        const body = event.body ? JSON.parse(event.body) : null;
        return !!(body && body.next_run);
      } catch (_) { return false; }
    })();

    if (!isScheduled) {
      const authz = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
      const expected = process.env.SLS_ONBOARDING_TOKEN;
      if (!expected) return jsonResponse(500, { ok: false, error: 'SLS_ONBOARDING_TOKEN not configured' });
      if (authz !== `Bearer ${expected}`) return jsonResponse(401, { ok: false, error: 'Unauthorized' });
    }

    const subs = listSubscriptions();
    if (!subs.length) {
      console.log('[renew-subscriptions] no subscriptions configured — nothing to do');
      return jsonResponse(200, { ok: true, processed: 0, results: [] });
    }

    const results = [];
    for (const { customerId, subscriptionId } of subs) {
      try {
        const outcome = await renewOne(customerId, subscriptionId);
        results.push(outcome);
      } catch (err) {
        results.push({
          customerId,
          subscriptionId,
          action: 'error',
          error: `Uncaught: ${err.message || err}`,
        });
      }
    }

    // Tally for the log line
    const tally = results.reduce((acc, r) => {
      acc[r.action] = (acc[r.action] || 0) + 1;
      return acc;
    }, {});

    const elapsed = Date.now() - startedAt;
    const summary = Object.keys(tally).map(k => `${k}=${tally[k]}`).join(' ');
    console.log(`[renew-subscriptions] processed=${results.length} ${summary} elapsed=${elapsed}ms`);

    // Log per-customer errors so the SLS-side log has actionable detail.
    for (const r of results) {
      if (r.action === 'error' || r.action === 'missing') {
        console.warn(`[renew-subscriptions]   ${r.customerId}: ${r.action} — ${r.error}`);
      }
    }

    return jsonResponse(200, { ok: true, processed: results.length, tally, results });
  } catch (err) {
    console.error('[renew-subscriptions] uncaught:', err && err.stack || err);
    return jsonResponse(500, { ok: false, error: 'Internal Server Error' });
  }
};
