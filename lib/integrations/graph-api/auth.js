'use strict';

/**
 * lib/integrations/graph-api/auth.js
 * Signal Logic Systems LLC
 *
 * OAuth 2.0 token acquisition for the Microsoft Graph API.
 *
 * Hold-the-calculator principle: SLS never stores customer data, but it
 * does need a token to read the customer's inbox and write to their
 * SharePoint. We use the client-credentials flow — a per-tenant app
 * registration that the customer creates and grants the minimum required
 * permissions (Mail.Read, Mail.Send, Sites.ReadWrite.All). The customer
 * owns and can revoke the app registration at any time.
 *
 * Per-customer credentials live in Netlify env vars, keyed by customer ID:
 *
 *   SLS_M365_TENANT_<CUSTOMER_ID>        Azure tenant ID (GUID)
 *   SLS_M365_CLIENT_ID_<CUSTOMER_ID>     App registration client ID (GUID)
 *   SLS_M365_CLIENT_SECRET_<CUSTOMER_ID> App registration client secret
 *
 * Onboarding (onboard-customer.js) returns the env-var names that must be
 * set on the Netlify dashboard — we do not (and cannot) write env vars
 * from runtime. See the architecture note in process.js for the parallel
 * pattern used by SLS_SECRET_<CUSTOMER_ID>.
 *
 * Tokens are cached in module scope keyed by customer ID. Each token is
 * valid for ~3600 seconds; we refresh ~60 seconds before expiry. Module
 * scope is the right place for this cache: Netlify Functions reuse a
 * warm execution container across invocations, so most calls in a tight
 * window will hit the cache. Cold starts pay one token-fetch round trip.
 *
 * All exports return the standard SLS result shape: { ok, ... } /
 * { ok: false, error }.
 */

// Refresh this many seconds before the token expires to avoid using a
// token that may expire mid-request.
const REFRESH_BUFFER_SECONDS = 60;

// Default Graph scope for client-credentials. Customers may override per
// tenant if they have a custom scope set up, but .default is correct for
// the vast majority of app-permission flows.
const DEFAULT_SCOPE = 'https://graph.microsoft.com/.default';

// Token cache: customerId (uppercased + sanitized) → { accessToken, expiresAt }
const tokenCache = new Map();

/**
 * Normalize a customer ID for use in env-var lookups. Mirrors the
 * convention in lib/auth/hmac.js.
 */
function customerKey(customerId) {
  if (!customerId || typeof customerId !== 'string') return null;
  return customerId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * Read the M365 app-registration credentials for a customer from env.
 *
 * @param {string} customerId
 * @returns {{ ok: true, tenantId: string, clientId: string, clientSecret: string }
 *           | { ok: false, error: string }}
 */
function getCredentials(customerId) {
  const key = customerKey(customerId);
  if (!key) return { ok: false, error: 'Invalid customer ID' };

  const tenantId     = process.env[`SLS_M365_TENANT_${key}`];
  const clientId     = process.env[`SLS_M365_CLIENT_ID_${key}`];
  const clientSecret = process.env[`SLS_M365_CLIENT_SECRET_${key}`];

  if (!tenantId)     return { ok: false, error: `Missing env: SLS_M365_TENANT_${key}` };
  if (!clientId)     return { ok: false, error: `Missing env: SLS_M365_CLIENT_ID_${key}` };
  if (!clientSecret) return { ok: false, error: `Missing env: SLS_M365_CLIENT_SECRET_${key}` };

  return { ok: true, tenantId, clientId, clientSecret };
}

/**
 * Acquire an access token for the given customer's tenant.
 *
 * Returns a cached token if still fresh; otherwise performs the
 * client-credentials grant against the v2.0 token endpoint.
 *
 * @param {string} customerId
 * @param {object} [opts]
 * @param {string} [opts.scope]   Override the Graph scope (rarely needed).
 * @param {boolean} [opts.force]  Bypass cache and force a fresh fetch.
 * @returns {Promise<{ ok: true, accessToken: string, expiresAt: number }
 *                  | { ok: false, error: string, statusCode?: number }>}
 */
async function getAccessToken(customerId, opts = {}) {
  const key = customerKey(customerId);
  if (!key) return { ok: false, error: 'Invalid customer ID' };

  const nowSec = Math.floor(Date.now() / 1000);

  if (!opts.force) {
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt - REFRESH_BUFFER_SECONDS > nowSec) {
      return { ok: true, accessToken: cached.accessToken, expiresAt: cached.expiresAt };
    }
  }

  const creds = getCredentials(customerId);
  if (!creds.ok) return creds;

  const url = `https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id:     creds.clientId,
    client_secret: creds.clientSecret,
    scope:         opts.scope || DEFAULT_SCOPE,
    grant_type:    'client_credentials',
  });

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    return { ok: false, error: `Token request failed: ${err.message || err}` };
  }

  let payload;
  try {
    payload = await resp.json();
  } catch (_) {
    return { ok: false, error: `Token endpoint returned non-JSON (status ${resp.status})`, statusCode: resp.status };
  }

  if (!resp.ok || !payload.access_token) {
    // payload.error / error_description come from Azure AD.
    const detail = payload.error_description || payload.error || `HTTP ${resp.status}`;
    return { ok: false, error: `Token request rejected: ${detail}`, statusCode: resp.status };
  }

  const expiresIn = Number(payload.expires_in) || 3600;
  const expiresAt = nowSec + expiresIn;

  tokenCache.set(key, { accessToken: payload.access_token, expiresAt });

  return { ok: true, accessToken: payload.access_token, expiresAt };
}

/**
 * Clear the cached token for a customer (e.g. after a 401 from Graph).
 */
function invalidateToken(customerId) {
  const key = customerKey(customerId);
  if (key) tokenCache.delete(key);
}

/**
 * Convenience wrapper: perform an authenticated Graph API request,
 * transparently refreshing the token on 401.
 *
 * @param {string} customerId
 * @param {string} path     Graph path, e.g. '/me/messages?$top=50'
 *                          (must start with '/') or a full https URL.
 * @param {object} [init]   Standard fetch init (method, headers, body).
 * @returns {Promise<{ ok: true, status: number, data: any }
 *                  | { ok: false, error: string, status?: number }>}
 */
async function graphRequest(customerId, path, init = {}) {
  const tok = await getAccessToken(customerId);
  if (!tok.ok) return tok;

  const url = path.startsWith('http')
    ? path
    : `https://graph.microsoft.com/v1.0${path}`;

  const headers = Object.assign(
    {
      'Authorization': `Bearer ${tok.accessToken}`,
      'Accept':        'application/json',
    },
    init.headers || {}
  );

  // Default to JSON content-type when a body is present and the caller
  // didn't already set one. POSTing a string without this gets rejected
  // by Graph with a 415.
  if (init.body && !Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }

  let resp;
  try {
    resp = await fetch(url, Object.assign({}, init, { headers }));
  } catch (err) {
    return { ok: false, error: `Graph request failed: ${err.message || err}` };
  }

  // Single retry on 401 with a forced token refresh — handles the rare
  // case where a cached token was revoked or rotated tenant-side.
  if (resp.status === 401) {
    invalidateToken(customerId);
    const retryTok = await getAccessToken(customerId, { force: true });
    if (!retryTok.ok) return retryTok;
    headers['Authorization'] = `Bearer ${retryTok.accessToken}`;
    try {
      resp = await fetch(url, Object.assign({}, init, { headers }));
    } catch (err) {
      return { ok: false, error: `Graph retry failed: ${err.message || err}` };
    }
  }

  // 204 No Content is success but no body — common for PATCH/DELETE.
  if (resp.status === 204) {
    return { ok: true, status: 204, data: null };
  }

  let data = null;
  const text = await resp.text();
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = text; }
  }

  if (!resp.ok) {
    const errMsg = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
    return { ok: false, error: errMsg, status: resp.status };
  }

  return { ok: true, status: resp.status, data };
}

module.exports = {
  getAccessToken,
  invalidateToken,
  graphRequest,
  // Exported for onboarding scripts / diagnostics.
  getCredentials,
  customerKey,
};
