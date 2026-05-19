'use strict';

/**
 * test/hmac.test.js
 * Signal Logic Systems LLC
 *
 * Run with:  node test/hmac.test.js
 * No test framework required — pure Node.
 *
 * Sets SLS_SECRET_TESTCLIENT in process.env before loading the module
 * so the lookup works without a real Netlify environment.
 */

// Inject a test secret before requiring the module
process.env.SLS_SECRET_TESTCLIENT = 'test-secret-do-not-use-in-production';

const { verifySignature, generateSignature, getSecretForCustomer } = require('../lib/auth/hmac');

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${label}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'Value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

console.log('\nlib/auth/hmac.js\n');

const CUSTOMER  = 'testclient';
const SECRET    = 'test-secret-do-not-use-in-production';
const BODY      = JSON.stringify({ tool: 'jfm', filename: 'jobs.csv' });
const NOW       = Math.floor(Date.now() / 1000);

// --- getSecretForCustomer ---

test('getSecretForCustomer: finds secret by customer ID', () => {
  const s = getSecretForCustomer('testclient');
  assertEqual(s, SECRET, 'secret');
});

test('getSecretForCustomer: case-insensitive customer ID', () => {
  const s = getSecretForCustomer('TESTCLIENT');
  assertEqual(s, SECRET, 'secret');
});

test('getSecretForCustomer: returns null for unknown customer', () => {
  const s = getSecretForCustomer('unknown');
  assertEqual(s, null, 'secret');
});

test('getSecretForCustomer: returns null for empty string', () => {
  const s = getSecretForCustomer('');
  assertEqual(s, null, 'secret');
});

// --- generateSignature ---

test('generateSignature: returns timestamp and sha256= prefixed signature', () => {
  const { timestamp, signature } = generateSignature(SECRET, BODY);
  assert(typeof timestamp === 'string', 'timestamp is string');
  assert(signature.startsWith('sha256='), 'signature has prefix');
  assert(signature.length === 71, `signature length: got ${signature.length}`); // "sha256=" + 64 hex chars
});

test('generateSignature: accepts explicit timestamp', () => {
  const { timestamp } = generateSignature(SECRET, BODY, 1700000000);
  assertEqual(timestamp, '1700000000', 'timestamp');
});

test('generateSignature: deterministic — same inputs produce same output', () => {
  const a = generateSignature(SECRET, BODY, 1700000000);
  const b = generateSignature(SECRET, BODY, 1700000000);
  assertEqual(a.signature, b.signature, 'signatures match');
});

test('generateSignature: different body produces different signature', () => {
  const a = generateSignature(SECRET, BODY, 1700000000);
  const b = generateSignature(SECRET, BODY + ' ', 1700000000);
  assert(a.signature !== b.signature, 'signatures should differ');
});

test('generateSignature: different timestamp produces different signature', () => {
  const a = generateSignature(SECRET, BODY, 1700000000);
  const b = generateSignature(SECRET, BODY, 1700000001);
  assert(a.signature !== b.signature, 'signatures should differ');
});

// --- verifySignature: valid cases ---

test('verifySignature: accepts a valid signature', () => {
  const { timestamp, signature } = generateSignature(SECRET, BODY, NOW);
  const result = verifySignature({ customerId: CUSTOMER, timestamp, signature, body: BODY });
  assert(result.ok, `expected ok=true, got: ${result.error}`);
});

test('verifySignature: accepts bare hex signature (no sha256= prefix)', () => {
  const { timestamp, signature } = generateSignature(SECRET, BODY, NOW);
  const bareHex = signature.slice(7); // strip "sha256="
  const result = verifySignature({ customerId: CUSTOMER, timestamp, signature: bareHex, body: BODY });
  assert(result.ok, `expected ok=true, got: ${result.error}`);
});

test('verifySignature: case-insensitive customer ID', () => {
  const { timestamp, signature } = generateSignature(SECRET, BODY, NOW);
  const result = verifySignature({ customerId: 'TESTCLIENT', timestamp, signature, body: BODY });
  assert(result.ok, `expected ok=true, got: ${result.error}`);
});

// --- verifySignature: rejection cases ---

test('verifySignature: rejects missing customerId', () => {
  const { timestamp, signature } = generateSignature(SECRET, BODY, NOW);
  const result = verifySignature({ customerId: '', timestamp, signature, body: BODY });
  assert(!result.ok, 'should be rejected');
  assert(result.error.includes('Customer'), result.error);
});

test('verifySignature: rejects missing timestamp', () => {
  const { timestamp, signature } = generateSignature(SECRET, BODY, NOW);
  const result = verifySignature({ customerId: CUSTOMER, timestamp: '', signature, body: BODY });
  assert(!result.ok, 'should be rejected');
  assert(result.error.includes('Timestamp'), result.error);
});

test('verifySignature: rejects missing signature', () => {
  const { timestamp } = generateSignature(SECRET, BODY, NOW);
  const result = verifySignature({ customerId: CUSTOMER, timestamp, signature: '', body: BODY });
  assert(!result.ok, 'should be rejected');
  assert(result.error.includes('Signature'), result.error);
});

test('verifySignature: rejects missing body', () => {
  const { timestamp, signature } = generateSignature(SECRET, BODY, NOW);
  const result = verifySignature({ customerId: CUSTOMER, timestamp, signature, body: '' });
  assert(!result.ok, 'should be rejected');
  assert(result.error.includes('body'), result.error);
});

test('verifySignature: rejects unknown customer', () => {
  const { timestamp, signature } = generateSignature(SECRET, BODY, NOW);
  const result = verifySignature({ customerId: 'nobody', timestamp, signature, body: BODY });
  assert(!result.ok, 'should be rejected');
  assert(result.error.includes('No secret'), result.error);
});

test('verifySignature: rejects tampered body', () => {
  const { timestamp, signature } = generateSignature(SECRET, BODY, NOW);
  const tamperedBody = BODY.replace('jfm', 'xxxx');
  const result = verifySignature({ customerId: CUSTOMER, timestamp, signature, body: tamperedBody });
  assert(!result.ok, 'should be rejected');
  assert(result.error.includes('mismatch'), result.error);
});

test('verifySignature: rejects wrong secret (different customer env var)', () => {
  // Sign with a different secret, but claim to be TESTCLIENT
  const { timestamp, signature } = generateSignature('wrong-secret', BODY, NOW);
  const result = verifySignature({ customerId: CUSTOMER, timestamp, signature, body: BODY });
  assert(!result.ok, 'should be rejected');
});

test('verifySignature: rejects stale timestamp (beyond 5-minute window)', () => {
  const staleTs = NOW - 301; // 5 min 1 sec ago
  const { signature } = generateSignature(SECRET, BODY, staleTs);
  const result = verifySignature({
    customerId: CUSTOMER,
    timestamp: String(staleTs),
    signature,
    body: BODY,
  });
  assert(!result.ok, 'should be rejected');
  assert(result.error.includes('tolerance'), result.error);
});

test('verifySignature: rejects future timestamp (beyond 5-minute window)', () => {
  const futureTs = NOW + 301;
  const { signature } = generateSignature(SECRET, BODY, futureTs);
  const result = verifySignature({
    customerId: CUSTOMER,
    timestamp: String(futureTs),
    signature,
    body: BODY,
  });
  assert(!result.ok, 'should be rejected');
});

test('verifySignature: rejects non-numeric timestamp', () => {
  const { signature } = generateSignature(SECRET, BODY, NOW);
  const result = verifySignature({
    customerId: CUSTOMER,
    timestamp: 'not-a-number',
    signature,
    body: BODY,
  });
  assert(!result.ok, 'should be rejected');
  assert(result.error.includes('Invalid timestamp'), result.error);
});

test('verifySignature: rejects malformed signature hex', () => {
  const { timestamp } = generateSignature(SECRET, BODY, NOW);
  const result = verifySignature({
    customerId: CUSTOMER,
    timestamp,
    signature: 'sha256=notvalidhex!!!',
    body: BODY,
  });
  assert(!result.ok, 'should be rejected');
  assert(result.error.includes('Malformed'), result.error);
});

// --- Summary ---

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
