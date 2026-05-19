'use strict';

/**
 * lib/render/utils.js
 * Signal Logic Systems LLC
 *
 * Shared render-layer helpers: HTML escaping and value formatting. Every
 * string interpolated into the report passes through escapeHtml; every
 * number/date passes through the matching formatter so the report has one
 * consistent way of showing money, quantities, dates, and missing values.
 *
 * Missing-value convention: an em-dash "—" everywhere. Reports never show
 * "null", "undefined", "NaN", or "$0.00" in place of a missing value —
 * those create false-positive findings ("this item was billed at $0.00").
 */

const EM_DASH = '—';
const MINUS   = '−';

/**
 * Escape a value for safe interpolation into HTML body text or an
 * attribute value. Quotes are escaped so the same helper covers both
 * contexts without callers having to remember which kind they're in.
 *
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Dollar value rounded to the nearest whole dollar. Used for headline
 * sums where penny precision would be visual noise.
 *
 * @param {number|null|undefined} n
 * @returns {string}
 */
function formatCurrency(n) {
  if (n == null || typeof n !== 'number' || !isFinite(n)) return EM_DASH;
  const rounded = Math.round(n);
  const abs = Math.abs(rounded).toLocaleString('en-US');
  return rounded < 0 ? `${MINUS}$${abs}` : `$${abs}`;
}

/**
 * Unit price — two decimals. Used in tables where a half-cent matters.
 *
 * @param {number|null|undefined} n
 * @returns {string}
 */
function formatPrice(n) {
  if (n == null || typeof n !== 'number' || !isFinite(n)) return EM_DASH;
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? `${MINUS}$${abs}` : `$${abs}`;
}

/**
 * Quantity. Integers render without decimals; fractional quantities keep
 * two decimals (Matrix occasionally reports partial units for bulk items).
 *
 * @param {number|null|undefined} n
 * @returns {string}
 */
function formatQty(n) {
  if (n == null || typeof n !== 'number' || !isFinite(n)) return EM_DASH;
  return Number.isInteger(n)
    ? n.toLocaleString('en-US')
    : n.toFixed(2);
}

/**
 * Signed delta for quantity columns. Zero renders as "0" (not "+0") so
 * a clean line doesn't look like a one-sided change.
 *
 * @param {number|null|undefined} n
 * @returns {string}
 */
function formatQtyDelta(n) {
  if (n == null || typeof n !== 'number' || !isFinite(n)) return EM_DASH;
  if (n === 0) return '0';
  const abs = Number.isInteger(n)
    ? Math.abs(n).toLocaleString('en-US')
    : Math.abs(n).toFixed(2);
  return n > 0 ? `+${abs}` : `${MINUS}${abs}`;
}

/**
 * Signed delta for price columns. Penny precision retained.
 *
 * @param {number|null|undefined} n
 * @returns {string}
 */
function formatPriceDelta(n) {
  if (n == null || typeof n !== 'number' || !isFinite(n)) return EM_DASH;
  if (n === 0) return '$0.00';
  const abs = Math.abs(n).toFixed(2);
  return n > 0 ? `+$${abs}` : `${MINUS}$${abs}`;
}

/**
 * Short date string. Reports are point-in-time so the year is shown
 * explicitly to disambiguate at-a-glance for archived copies.
 *
 * @param {Date|null|undefined} d
 * @returns {string}
 */
function formatDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return EM_DASH;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * A short, human label for an integer count: "1 item", "5 items".
 * Keeps narrative prose grammatical without per-call boilerplate.
 *
 * @param {number} n
 * @param {string} singular
 * @param {string} [plural]  Defaults to singular + 's'.
 * @returns {string}
 */
function pluralize(n, singular, plural) {
  const p = plural || `${singular}s`;
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : p}`;
}

module.exports = {
  EM_DASH,
  MINUS,
  escapeHtml,
  formatCurrency,
  formatPrice,
  formatQty,
  formatQtyDelta,
  formatPriceDelta,
  formatDate,
  pluralize,
};
