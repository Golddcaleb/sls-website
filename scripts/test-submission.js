'use strict';

/**
 * scripts/test-submission.js
 * Signal Logic Systems LLC
 *
 * CLI test tool for the ship-vs-invoice production endpoint.
 *
 *   node scripts/test-submission.js <matrix.xlsx> <proper21.csv|.xls>
 *
 * Reads SLS_SECRET_BLUEASH from a local .env file, builds a multipart
 * body, signs it with HMAC-SHA256 per jfm-architecture.md §4, POSTs
 * to https://signallogicsystems.com/.netlify/functions/process with
 * X-SLS-Tool: ship-vs-invoice, and writes the returned HTML report
 * to scripts/output/ with a timestamped filename.
 *
 * On non-2xx responses, the response body is logged so the failure
 * mode (401 auth, 422 schema, 400 parse) is visible at a glance.
 */

require('dotenv').config();

const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');

// ── Constants ──────────────────────────────────────────────────────────
const ENDPOINT    = 'https://signallogicsystems.com/.netlify/functions/process';
const CUSTOMER_ID = 'BLUEASH';
const TOOL        = 'ship-vs-invoice';
const OUTPUT_DIR  = path.join(__dirname, 'output');

// ── Argument parsing ───────────────────────────────────────────────────
const [matrixPath, proper21Path] = process.argv.slice(2);

if (!matrixPath || !proper21Path) {
  console.error('Usage: node scripts/test-submission.js <matrix.xlsx> <proper21.csv|.xls>');
  process.exitCode = 1;
  return;
}

for (const p of [matrixPath, proper21Path]) {
  if (!fs.existsSync(p)) {
    console.error(`File not found: ${p}`);
    process.exitCode = 1;
    return;
  }
}

const secret = process.env.SLS_SECRET_BLUEASH;
if (!secret) {
  console.error('SLS_SECRET_BLUEASH is not set. Add it to a local .env file.');
  process.exitCode = 1;
  return;
}

// ── Multipart body construction ────────────────────────────────────────
// Build the body as a single Buffer so the bytes we sign are the exact
// bytes we send. The server's HMAC check is over the raw request body,
// so any re-encoding between sign and send would break verification.

function buildMultipart(parts) {
  const boundary = '----SLSBoundary' + crypto.randomBytes(16).toString('hex');
  const CRLF = '\r\n';
  const chunks = [];

  for (const part of parts) {
    chunks.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"${CRLF}` +
      `Content-Type: ${part.contentType}${CRLF}${CRLF}`,
      'utf8'
    ));
    chunks.push(part.data);
    chunks.push(Buffer.from(CRLF, 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf8'));

  return { boundary, body: Buffer.concat(chunks) };
}

function contentTypeForFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.csv') return 'text/csv';
  if (ext === '.xls') return 'application/vnd.ms-excel';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/octet-stream';
}

const matrixBuf   = fs.readFileSync(matrixPath);
const proper21Buf = fs.readFileSync(proper21Path);

const { boundary, body } = buildMultipart([
  {
    name: 'matrix',
    filename: path.basename(matrixPath),
    contentType: contentTypeForFile(matrixPath),
    data: matrixBuf,
  },
  {
    name: 'proper21',
    filename: path.basename(proper21Path),
    contentType: contentTypeForFile(proper21Path),
    data: proper21Buf,
  },
]);

// ── HMAC signature ─────────────────────────────────────────────────────
// Mirrors lib/auth/hmac.js: hmac.update(`${timestamp}.`); hmac.update(body)

const timestamp = String(Math.floor(Date.now() / 1000));
const hmac = crypto.createHmac('sha256', secret);
hmac.update(`${timestamp}.`);
hmac.update(body);
const signature = `sha256=${hmac.digest('hex')}`;

// ── Request ────────────────────────────────────────────────────────────
const startedAt = Date.now();

(async () => {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type':     `multipart/form-data; boundary=${boundary}`,
        'Content-Length':   String(body.length),
        'X-SLS-Customer':   CUSTOMER_ID,
        'X-SLS-Timestamp':  timestamp,
        'X-SLS-Signature':  signature,
        'X-SLS-Tool':       TOOL,
      },
      body,
    });
  } catch (err) {
    console.error(`Request failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const elapsed = Date.now() - startedAt;
  const responseText = await res.text();

  console.log(`Status:  ${res.status} ${res.statusText}`);
  console.log(`Elapsed: ${elapsed}ms`);

  if (!res.ok) {
    console.error('--- error response body ---');
    console.error(responseText);
    process.exitCode = 1;
    return;
  }

  // Extract bucket counts from the response. The server logs them in
  // its own console line; here we surface them from the HTML so the
  // operator running the script sees the same shape without grepping
  // Netlify logs.
  const counts = extractBucketCounts(responseText);
  if (counts) {
    console.log(`Buckets: match=${counts.match} mismatch=${counts.mismatch} wrongPO=${counts.wrongPO} unmatched=${counts.unmatched}`);
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(OUTPUT_DIR, `${TOOL}-${stamp}.html`);
  fs.writeFileSync(outPath, responseText, 'utf8');
  console.log(`Saved:   ${outPath}`);
})();

// Pulls the four ship-vs-invoice bucket counts out of the rendered HTML.
// The renderer embeds them as KPI card values; this regex is tolerant of
// markup churn — it looks for the label, then the next numeric value.
function extractBucketCounts(html) {
  const labels = ['match', 'mismatch', 'wrongPO', 'unmatched'];
  const out = {};
  for (const label of labels) {
    const re = new RegExp(`${label}[^0-9<]*<[^>]*>\\s*([0-9,]+)`, 'i');
    const m = html.match(re);
    out[label] = m ? m[1].replace(/,/g, '') : '?';
  }
  return out;
}
