'use strict';

/**
 * lib/auth/hmac.js
 * Signal Logic Systems LLC
 *
 * HMAC-SHA256 signature verification for authenticated CSV submissions.
 *
 * Each customer is issued a shared secret at onboarding, stored as a
 * Netlify environment variable keyed by customer ID:
 *   SLS_SECRET_<CUSTOMER_ID>  (e.g. SLS_SECRET_BLUEASH)
 *
 * Every request must include:
 *   X-SLS-Signature: sha256=<hex digest>
 *   X-SLS-Timestamp: <unix seconds>
 *   X-SLS-Customer: <customer_id>
 *
 * The signed payload is:  timestamp + "." + raw request body
 * This binds the signature to both the content and a specific moment
 * in time, defeating replay attacks.
 *
 * Timestamp tolerance: ±5 minutes. Requests outside this window are
 * rejected regardless of signature validity.
 */

const { createHmac, timingSafeEqual } = require('crypto');

// How many seconds of clock skew we tolerate in either direction.
const TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

/**
 * Retrieve the shared secret for a given customer ID.
 * Secrets live in Netlify env vars as SLS_SECRET_<CUSTOMER_ID>.
 * Customer IDs are uppercased before lookup so the header value
 * is case-insensitive.
 *
 * @param {string} customerId
 * @returns {string|null}  The secret, or null if not found.
 */
function getSecretForCustomer(customerId) {
  if (!customerId || typeof customerId !== 'string') return null;
  const envKey = `SLS_SECRET_${customerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return process.env[envKey] || null;
}

/**
 * Compute the expected HMAC-SHA256 signature for a given payload.
 *
 * The payload is conceptually `${timestamp}.${body}`, but for binary
 * bodies (multipart file uploads) we cannot use a template literal —
 * coercing a Buffer to a string UTF-8-decodes it, which is lossy for
 * arbitrary bytes and would break the signature. Instead we feed the
 * prefix and the body to the HMAC as two separate update() calls.
 * For string bodies the resulting byte stream is identical to the old
 * template-literal form, so this is backward-compatible.
 *
 * @param {string} secret       Customer shared secret.
 * @param {string} timestamp    Unix seconds as a string (from the header).
 * @param {string|Buffer} body  Raw request body.
 * @returns {string}  Hex digest (no "sha256=" prefix).
 */
function computeSignature(secret, timestamp, body) {
  const hmac = createHmac('sha256', secret);
  hmac.update(`${timestamp}.`);
  hmac.update(body);
  return hmac.digest('hex');
}

/**
 * Verify an incoming request's HMAC signature.
 *
 * @param {object} params
 * @param {string}        params.customerId   Value of X-SLS-Customer header.
 * @param {string}        params.timestamp    Value of X-SLS-Timestamp header (unix seconds).
 * @param {string}        params.signature    Value of X-SLS-Signature header (e.g. "sha256=abc123").
 * @param {string|Buffer} params.body         Raw request body exactly as received.
 *
 * @returns {{ ok: boolean, error?: string }}
 */
function verifySignature({ customerId, timestamp, signature, body }) {
  // --- Input presence checks ---
  if (!customerId) return { ok: false, error: 'Missing X-SLS-Customer header' };
  if (!timestamp)  return { ok: false, error: 'Missing X-SLS-Timestamp header' };
  if (!signature)  return { ok: false, error: 'Missing X-SLS-Signature header' };
  if (!body)       return { ok: false, error: 'Missing request body' };

  // --- Timestamp validation (replay attack prevention) ---
  const tsSeconds = parseInt(timestamp, 10);
  if (isNaN(tsSeconds)) return { ok: false, error: 'Invalid timestamp format' };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const drift = Math.abs(nowSeconds - tsSeconds);
  if (drift > TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, error: `Timestamp outside tolerance window (drift: ${drift}s)` };
  }

  // --- Secret lookup ---
  const secret = getSecretForCustomer(customerId);
  if (!secret) {
    return { ok: false, error: `No secret configured for customer: ${customerId}` };
  }

  // --- Signature format ---
  // Accept "sha256=<hex>" or bare "<hex>"
  const providedHex = signature.startsWith('sha256=')
    ? signature.slice(7)
    : signature;

  if (!/^[0-9a-f]{64}$/i.test(providedHex)) {
    return { ok: false, error: 'Malformed signature (expected 64-char hex)' };
  }

  // --- Constant-time comparison ---
  const expectedHex = computeSignature(secret, timestamp, body);

  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex.toLowerCase(), 'hex');

  // Buffers must be same length for timingSafeEqual — they will be
  // (both 32 bytes from SHA-256), but guard anyway.
  if (expected.length !== provided.length) {
    return { ok: false, error: 'Signature length mismatch' };
  }

  const match = timingSafeEqual(expected, provided);
  if (!match) return { ok: false, error: 'Signature mismatch' };

  return { ok: true };
}

/**
 * Generate a signature for outbound use (testing, tooling, onboarding scripts).
 * Not used by the Netlify Function itself — the client signs their own requests.
 *
 * @param {string}        secret     Customer shared secret.
 * @param {string|Buffer} body       Request body to sign.
 * @param {number}        [ts]       Unix seconds (defaults to now).
 * @returns {{ timestamp: string, signature: string }}
 */
function generateSignature(secret, body, ts) {
  const timestamp = String(ts || Math.floor(Date.now() / 1000));
  const hex = computeSignature(secret, timestamp, body);
  return { timestamp, signature: `sha256=${hex}` };
}

module.exports = { verifySignature, generateSignature, getSecretForCustomer };
