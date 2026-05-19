'use strict';

/**
 * netlify/functions/process.js
 * Signal Logic Systems LLC
 *
 * Production entry point. The single Netlify Function that all SLS
 * tools route through. This file wires the four-step pipeline together:
 *
 *   Auth gate  →  Ingest  →  Normalize  →  Analyze  →  Render
 *
 * Governing spec: jfm-architecture.md §4 (Security Model) and §6
 * (Report Output).
 *
 * Currently only the Blue Ash ship-vs-invoice pipeline is wired. JFM and
 * future tools plug in by adding a branch to runPipeline() keyed on the
 * X-SLS-Tool header (defaulting to ship-vs-invoice for the first
 * customer). Every tool reuses the same auth + ingest + normalize
 * layers; only the schema, analyze module, and render composer change.
 *
 * Security posture (§4):
 *   - HMAC-SHA256 over the raw request body, verified before any other
 *     work. Bad signature → 401. The HMAC check binds the signature
 *     to both content and timestamp so replays cannot be replayed
 *     against a different file or outside the ±5-minute window.
 *   - All file content lives in process memory only. Nothing is written
 *     to disk. The Function returns and the JS GC reclaims the Buffers;
 *     there is no temp file path, no cache directory, no log line
 *     carrying a row value.
 *   - Output is a self-contained HTML attachment containing derived
 *     metrics only. The raw row arrays never reach the response.
 *
 * Error response convention:
 *   401  invalid / missing signature
 *   400  body decode, multipart parse, or file parse failure
 *   405  non-POST method
 *   415  unsupported Content-Type
 *   422  schema mapping failed (column not found)
 *   500  uncaught exception (caught and logged, no body details leaked)
 *
 * Response bodies on errors are plain text — short, non-revealing.
 */

const { verifySignature }      = require('../../lib/auth/hmac');
const { parseMultipart }       = require('../../lib/ingest/parse-multipart');
const { parseFile }            = require('../../lib/ingest/parse-csv');
const { normalize }            = require('../../lib/normalize/column-mapper');
const inventorySchema          = require('../../lib/normalize/schemas/inventory');
const { shipVsInvoice }        = require('../../lib/analyze/inventory/ship-vs-invoice');
const { renderShipVsInvoice }  = require('../../lib/render/inventory/ship-vs-invoice');

// ---------------------------------------------------------------------------
// Customer registry
//
// Per jfm-architecture.md §10.4, the HMAC secret encodes customer identity.
// This registry maps the customer ID (case-insensitive) to a friendly
// display name used in the report header. Logos and tool entitlements live
// here once onboarding produces them. Until then, an unknown customer
// authenticated against a valid env-var secret still gets a report — the
// display name just falls back to the customer ID.
// ---------------------------------------------------------------------------
const CUSTOMER_REGISTRY = {
  BLUEASH:    { displayName: 'Blue Ash Industrial Supply' },
  TESTCLIENT: { displayName: 'Test Client' },
};

function lookupCustomerDisplayName(customerId) {
  if (!customerId) return '';
  const key = customerId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const entry = CUSTOMER_REGISTRY[key];
  return entry ? entry.displayName : customerId;
}

// ---------------------------------------------------------------------------
// Small response helpers
// ---------------------------------------------------------------------------

function textResponse(statusCode, message) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: message,
  };
}

function htmlAttachment(html, filename) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: html,
  };
}

/**
 * Case-insensitive header lookup. Netlify normalizes header keys to
 * lowercase, but other harnesses (tests, local invocation) may not.
 */
function getHeader(headers, name) {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

/**
 * Slugify a name for inclusion in a filename.
 */
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'report';
}

// ---------------------------------------------------------------------------
// Pipeline (broken out for clarity and so future tools can branch in)
// ---------------------------------------------------------------------------

/**
 * Run the ship-vs-invoice pipeline end to end.
 *
 * @param {Array<{name:string, filename:string|null, contentType:string|null, data:Buffer}>} parts
 * @param {object} ctx
 * @param {string} ctx.customerId
 * @param {Date}   ctx.today
 * @returns {{ statusCode:number, body:string, filename?:string, html?:string, status?:string }}
 */
function runShipVsInvoice(parts, ctx) {
  const matrixPart   = parts.find(p => p.name === 'matrix');
  const proper21Part = parts.find(p => p.name === 'proper21');

  if (!matrixPart || !proper21Part) {
    return { statusCode: 400, body: 'Bad Request: both "matrix" and "proper21" file fields are required.' };
  }

  // ── Ingest ───────────────────────────────────────────────────────
  const matrixParsed = parseFile(matrixPart.data, { filename: matrixPart.filename });
  if (!matrixParsed.ok) {
    return { statusCode: 400, body: `Bad Request: could not parse matrix file: ${matrixParsed.error}` };
  }
  const p21Parsed = parseFile(proper21Part.data, { filename: proper21Part.filename });
  if (!p21Parsed.ok) {
    return { statusCode: 400, body: `Bad Request: could not parse proper21 file: ${p21Parsed.error}` };
  }

  // ── Normalize ────────────────────────────────────────────────────
  const matrixNorm = normalize(matrixParsed, inventorySchema);
  if (!matrixNorm.ok) {
    return { statusCode: 422, body: `Unprocessable matrix file: ${matrixNorm.error}` };
  }
  const p21Norm = normalize(p21Parsed, inventorySchema);
  if (!p21Norm.ok) {
    return { statusCode: 422, body: `Unprocessable proper21 file: ${p21Norm.error}` };
  }

  // ── Analyze ──────────────────────────────────────────────────────
  const result = shipVsInvoice(matrixNorm.rows, p21Norm.rows, {
    excludeDate: ctx.today,
  });

  // ── Render ───────────────────────────────────────────────────────
  const customer = lookupCustomerDisplayName(ctx.customerId);
  const html = renderShipVsInvoice(result, {
    customer,
    reportDate: ctx.today,
    excludeDateLabel: ctx.today.toLocaleDateString('en-US'),
  });

  const dateSlug    = ctx.today.toISOString().slice(0, 10);
  const customerSlug = slugify(customer || ctx.customerId);
  const filename = `ship-vs-invoice-${customerSlug}-${dateSlug}.html`;

  const counts = (result.findings && result.findings.counts) || {};
  const status = result.ok
    ? `match=${counts.match || 0} mismatch=${counts.mismatch || 0} wrongPO=${counts.wrongPO || 0} unmatched=${counts.unmatched || 0}`
    : 'analyze-failed';

  return { statusCode: 200, html, filename, status };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

exports.handler = async (event) => {
  const startedAt = Date.now();
  let customerId = '';

  try {
    // ── Method ──────────────────────────────────────────────────────
    if (event.httpMethod !== 'POST') {
      return textResponse(405, 'Method Not Allowed. Use POST.');
    }

    // ── Decode body to Buffer ───────────────────────────────────────
    // Netlify sets isBase64Encoded for binary bodies (multipart with
    // any non-text part). We always materialize a Buffer because both
    // the HMAC check and the multipart parser want raw bytes.
    const rawBody = event.body || '';
    const bodyBuf = event.isBase64Encoded
      ? Buffer.from(rawBody, 'base64')
      : Buffer.from(rawBody, 'utf8');

    // ── Auth gate (FIRST, before any parsing) ───────────────────────
    // Done before content-type or multipart parsing so an unauthenticated
    // request gets the cheapest possible rejection and never reaches the
    // file-parsing code path.
    customerId = getHeader(event.headers, 'x-sls-customer') || '';
    const timestamp = getHeader(event.headers, 'x-sls-timestamp') || '';
    const signature = getHeader(event.headers, 'x-sls-signature') || '';

    const auth = verifySignature({
      customerId,
      timestamp,
      signature,
      body: bodyBuf,
    });
    if (!auth.ok) {
      // The exact reason is logged for SLS-side diagnostics but is not
      // returned to the caller — telling an attacker which check failed
      // (bad sig vs. unknown customer vs. stale ts) leaks reconnaissance.
      console.warn(`[process] auth rejected: ${auth.error} (customer="${customerId}")`);
      return textResponse(401, 'Unauthorized.');
    }

    // ── Content-Type ────────────────────────────────────────────────
    const contentType = getHeader(event.headers, 'content-type') || '';
    if (!/^multipart\/form-data/i.test(contentType)) {
      return textResponse(415, 'Unsupported Media Type. Expected multipart/form-data with two file fields: matrix, proper21.');
    }

    // ── Multipart parse ─────────────────────────────────────────────
    const multipart = parseMultipart(bodyBuf, contentType);
    if (!multipart.ok) {
      return textResponse(400, `Bad Request: ${multipart.error}`);
    }

    // ── Run the pipeline ────────────────────────────────────────────
    const today = new Date();
    const tool  = (getHeader(event.headers, 'x-sls-tool') || 'ship-vs-invoice').toLowerCase();

    let outcome;
    switch (tool) {
      case 'ship-vs-invoice':
        outcome = runShipVsInvoice(multipart.parts, { customerId, today });
        break;
      default:
        return textResponse(400, `Bad Request: unknown tool "${tool}".`);
    }

    if (outcome.statusCode !== 200) {
      console.warn(`[process] pipeline failed: ${outcome.body} (customer="${customerId}", tool="${tool}")`);
      return textResponse(outcome.statusCode, outcome.body);
    }

    const elapsed = Date.now() - startedAt;
    console.log(`[process] ok customer="${customerId}" tool="${tool}" ${outcome.status} elapsed=${elapsed}ms`);

    return htmlAttachment(outcome.html, outcome.filename);
  } catch (err) {
    // Catch-all so a thrown error never leaks a stack to the caller.
    // The detail is logged on the SLS side for diagnosis.
    console.error(`[process] uncaught error customer="${customerId}":`, err && err.stack || err);
    return textResponse(500, 'Internal Server Error.');
  }
};
