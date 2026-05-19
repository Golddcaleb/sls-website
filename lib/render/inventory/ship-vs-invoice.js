'use strict';

/**
 * lib/render/inventory/ship-vs-invoice.js
 * Signal Logic Systems LLC
 *
 * Report composer for the Blue Ash ship-vs-invoice reconciliation. Takes
 * the structured result from lib/analyze/inventory/ship-vs-invoice.js and
 * assembles an action-first HTML report.
 *
 * Section order is intentional and follows Travis's framing — "drop a
 * file and have it tell me what to do":
 *
 *   1. Headline callout      — total items needing action, in plain words.
 *   2. Narrative prose       — one short paragraph: what happened on this run.
 *   3. Mismatches            — most actionable: a real bill is wrong.
 *   4. Wrong PO              — item billed against the wrong PO key.
 *   5. Unmatched (Matrix)    — received, never invoiced.
 *   6. Unmatched (Proper 21) — invoiced, never received.
 *   7. KPI strip             — reference-only counts of the four buckets.
 *   8. Clean line            — "N lines reconciled with no issues."
 *
 * The summary KPI strip sits below the action tables, not above them.
 * Leading with counts of everything would dilute the call to action; the
 * strip is orientation for the second read, not the first.
 *
 * Empty sections are suppressed entirely (not rendered as empty tables)
 * so a clean run shows only the "all clean" callout and the KPI strip —
 * no scrolling past four empty bins.
 */

const { renderDocument }    = require('../report-builder');
const { renderKpiStrip }    = require('../sections/kpi-cards');
const { renderTable }       = require('../sections/tables');
const {
  renderCallout,
  renderProse,
  renderCleanLine,
} = require('../sections/diagnostic-text');
const {
  escapeHtml,
  formatCurrency,
  formatPrice,
  formatQty,
  formatQtyDelta,
  formatPriceDelta,
  pluralize,
} = require('../utils');

// ---------------------------------------------------------------------------
// Cell formatters (HTML-emitting helpers used by the table renderer)
//
// renderTable's convention: a format() return that starts with '<' is
// treated as trusted HTML. These helpers escape their dynamic content
// and produce a span with the appropriate semantic class.
// ---------------------------------------------------------------------------

function htmlSpan(cls, text) {
  return `<span class="${escapeHtml(cls)}">${escapeHtml(text)}</span>`;
}

function qtyDeltaCell(n) {
  const cls = n > 0 ? 'delta-pos' : n < 0 ? 'delta-neg' : '';
  return cls ? htmlSpan(cls, formatQtyDelta(n)) : formatQtyDelta(n);
}

function priceDeltaCell(n) {
  if (n == null) return formatPriceDelta(n);
  const cls = n > 0 ? 'delta-pos' : n < 0 ? 'delta-neg' : '';
  return cls ? htmlSpan(cls, formatPriceDelta(n)) : formatPriceDelta(n);
}

function reasonPillsCell(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) return '';
  const labels = { quantity: 'Qty off', unit_price: 'Price off' };
  return reasons
    .map(r => `<span class="sls-pill sls-pill--danger">${escapeHtml(labels[r] || r)}</span>`)
    .join(' ');
}

function poListCell(pos) {
  if (!Array.isArray(pos) || pos.length === 0) return formatQty(null);
  return pos.map(p => escapeHtml(p)).join(', ');
}

function sourcePillCell(source) {
  if (source === 'matrix') {
    return `<span class="sls-pill sls-pill--info">Matrix</span>`;
  }
  if (source === 'proper21') {
    return `<span class="sls-pill">Proper 21</span>`;
  }
  return escapeHtml(source || '');
}

// ---------------------------------------------------------------------------
// Sorting helpers — biggest $ impact first
// ---------------------------------------------------------------------------

function mismatchImpact(r) {
  const qty = typeof r.qty_delta === 'number' ? r.qty_delta : 0;
  const p   = typeof r.price_delta === 'number' ? r.price_delta : 0;
  const m$  = typeof r.matrix_unit_price === 'number' ? r.matrix_unit_price : 0;
  const mQ  = typeof r.matrix_quantity   === 'number' ? r.matrix_quantity   : 0;
  return Math.abs(qty * m$) + Math.abs(p * mQ);
}

function unmatchedImpact(r) {
  const qty = typeof r.quantity === 'number' ? r.quantity : 0;
  const p   = typeof r.unit_price === 'number' ? r.unit_price : 0;
  return Math.abs(qty * p) || Math.abs(qty);
}

function wrongPoImpact(r) {
  const qty = typeof r.matrix_quantity === 'number'
    ? r.matrix_quantity
    : typeof r.proper21_quantity === 'number' ? r.proper21_quantity : 0;
  return Math.abs(qty);
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildMismatchesSection(rows) {
  if (!rows || rows.length === 0) return '';

  const sorted = rows.slice().sort((a, b) => mismatchImpact(b) - mismatchImpact(a));

  return renderTable({
    id: 'mismatches',
    title: 'Mismatches — quantity or price disagree',
    sub: 'Same PO line, both sides — but the numbers don\'t match. Each row is a candidate for re-bill, credit, or correction.',
    columns: [
      { key: 'po',                  label: 'PO',          className: 'mono' },
      { key: 'item',                label: 'Item',        className: 'mono' },
      { key: 'matrix_quantity',     label: 'Matrix Qty',  align: 'right', format: formatQty },
      { key: 'proper21_quantity',   label: 'P21 Qty',     align: 'right', format: formatQty },
      { key: 'qty_delta',           label: 'Qty Δ',       align: 'right', format: qtyDeltaCell },
      { key: 'matrix_unit_price',   label: 'Matrix $',    align: 'right', format: formatPrice },
      { key: 'proper21_unit_price', label: 'P21 $',       align: 'right', format: formatPrice },
      { key: 'price_delta',         label: 'Price Δ',     align: 'right', format: priceDeltaCell },
      { key: 'reasons',             label: 'Off',         format: reasonPillsCell },
    ],
    rows: sorted,
  });
}

function buildWrongPoSection(rows) {
  if (!rows || rows.length === 0) return '';

  const sorted = rows.slice().sort((a, b) => wrongPoImpact(b) - wrongPoImpact(a));

  return renderTable({
    id: 'wrong-po',
    title: 'Wrong PO — same item, different PO',
    sub: 'The item appears in both files but is keyed to different POs. Most common cause is a receiver tagging the wrong PO at intake.',
    columns: [
      { key: 'source', label: 'Where',       format: sourcePillCell },
      { key: 'item',   label: 'Item',        className: 'mono' },
      {
        key: 'po',
        label: 'PO on this side',
        className: 'mono',
        format: v => v == null || v === '' ? '<span class="muted">—</span>' : escapeHtml(v),
      },
      {
        key: '_otherPos',
        label: 'PO on the other side',
        className: 'mono',
        format: (_, row) => poListCell(row.proper21_pos || row.matrix_pos),
      },
      {
        key: '_qty',
        label: 'Qty',
        align: 'right',
        format: (_, row) => formatQty(
          row.matrix_quantity != null ? row.matrix_quantity : row.proper21_quantity
        ),
      },
      {
        key: '_unit',
        label: 'Unit $',
        align: 'right',
        format: (_, row) => formatPrice(
          row.matrix_unit_price != null ? row.matrix_unit_price : row.proper21_unit_price
        ),
      },
    ],
    rows: sorted,
  });
}

function buildUnmatchedSection(rows, side) {
  const filtered = (rows || []).filter(r => r.source === side);
  if (filtered.length === 0) return '';

  const sorted = filtered.slice().sort((a, b) => unmatchedImpact(b) - unmatchedImpact(a));

  const title = side === 'matrix'
    ? 'Received but not invoiced'
    : 'Invoiced but not received';
  const sub = side === 'matrix'
    ? 'Matrix logged the receipt; nothing in Proper 21 covers it. Confirm the invoice was sent.'
    : 'Proper 21 has an invoice; nothing in Matrix shows the receipt. Confirm the items shipped (or that the bill is correct).';

  return renderTable({
    id: side === 'matrix' ? 'unmatched-matrix' : 'unmatched-proper21',
    title,
    sub,
    columns: [
      { key: 'po',         label: 'PO',     className: 'mono' },
      { key: 'item',       label: 'Item',   className: 'mono' },
      { key: 'quantity',   label: 'Qty',    align: 'right', format: formatQty },
      { key: 'unit_price', label: 'Unit $', align: 'right', format: formatPrice },
    ],
    rows: sorted,
  });
}

function buildKpiStrip(counts) {
  const c = counts || {};
  return renderKpiStrip([
    { label: 'Mismatches',  value: c.mismatch  || 0, tone: c.mismatch  ? 'danger' : 'ok',
      sub: 'Qty or price off' },
    { label: 'Wrong PO',    value: c.wrongPO   || 0, tone: c.wrongPO   ? 'warn'   : 'ok',
      sub: 'Item keyed differently' },
    { label: 'Unmatched',   value: c.unmatched || 0, tone: c.unmatched ? 'warn'   : 'ok',
      sub: 'Only in one file' },
    { label: 'Matched',     value: c.match     || 0, tone: 'ok',
      sub: 'Clean lines' },
  ]);
}

// ---------------------------------------------------------------------------
// Headline & narrative
// ---------------------------------------------------------------------------

function buildHeadlineCallout(counts) {
  const c = counts || {};
  const action = (c.mismatch || 0) + (c.wrongPO || 0) + (c.unmatched || 0);
  const matched = c.match || 0;

  if (action === 0) {
    return renderCallout({
      eyebrow: 'Reconciliation complete',
      tone: 'ok',
      headline: matched > 0
        ? `All clean — ${pluralize(matched, 'line')} reconciled with no issues.`
        : 'All clean — no discrepancies found.',
      body: 'Nothing in this period requires action. Run again next month with fresh exports.',
    });
  }

  const parts = [];
  if (c.mismatch)  parts.push(pluralize(c.mismatch,  'mismatch',  'mismatches'));
  if (c.wrongPO)   parts.push(pluralize(c.wrongPO,   'wrong-PO entry', 'wrong-PO entries'));
  if (c.unmatched) parts.push(pluralize(c.unmatched, 'unmatched line'));

  const body = parts.length
    ? `Found ${joinList(parts)}. The tables below list each item with the side it came from so you can resolve them one at a time.`
    : '';

  const tone = c.mismatch > 0 ? 'danger' : 'warn';

  return renderCallout({
    eyebrow: 'Reconciliation complete',
    tone,
    headline: `${pluralize(action, 'item needs', 'items need')} your attention.`,
    body,
  });
}

function buildRunNarrative(counts, opts) {
  const c = counts || {};
  const sentences = [];

  const matrixIn = (c.matrixRows   || 0) - (c.matrixExcluded || 0);
  const p21In    =  c.proper21Rows || 0;
  sentences.push(
    `Compared ${pluralize(matrixIn, 'Matrix receipt line')} against ${pluralize(p21In, 'Proper 21 invoice line')}.`
  );

  if (c.matrixExcluded > 0) {
    const dateLabel = opts && opts.excludeDateLabel
      ? ` (${opts.excludeDateLabel})`
      : '';
    sentences.push(
      `Excluded ${pluralize(c.matrixExcluded, 'Matrix row')} dated as same-day${dateLabel} — those receipts have not had time to be invoiced.`
    );
  }

  const total = (c.match || 0) + (c.mismatch || 0) + (c.wrongPO || 0) + (c.unmatched || 0);
  if (total > 0) {
    const clean = Math.round(((c.match || 0) / total) * 100);
    sentences.push(`${clean}% of joined lines matched cleanly.`);
  }

  return renderProse(sentences.join(' '));
}

function joinList(parts) {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Render the ship-vs-invoice report.
 *
 * @param {object} result               Output of shipVsInvoice().
 * @param {object} [opts]
 * @param {string} [opts.customer='Blue Ash Industrial Supply']
 * @param {Date}   [opts.reportDate]    Defaults to now.
 * @param {string} [opts.periodLabel]   Human-readable period (e.g. "April 2026").
 *                                       Shown as the header subtitle when set.
 * @param {string} [opts.excludeDateLabel]  Human label for the excluded
 *                                       same-day date (e.g. "5/19/2026").
 * @returns {string} HTML document.
 */
function renderShipVsInvoice(result, opts = {}) {
  const customer    = opts.customer || 'Blue Ash Industrial Supply';
  const reportDate  = opts.reportDate instanceof Date ? opts.reportDate : new Date();
  const periodLabel = opts.periodLabel || '';

  // Error path — analyze layer refused the input. Render a minimal report
  // so the Netlify Function can still respond with a self-contained HTML
  // body when it chooses not to use the HTTP 422 path.
  if (!result || !result.ok) {
    const msg = (result && result.error) || 'No reconciliation could be produced from the supplied files.';
    const body =
      renderCallout({
        eyebrow: 'Reconciliation could not run',
        tone: 'danger',
        headline: 'Unable to produce a report.',
        body: msg,
      });
    return renderDocument({
      title: 'Ship-vs-Invoice Reconciliation',
      subtitle: periodLabel,
      customer,
      reportDate,
      body,
    });
  }

  const findings = result.findings || {};
  const counts   = findings.counts || {};
  const totalMatched = counts.match || 0;
  const totalAction  = (counts.mismatch || 0) + (counts.wrongPO || 0) + (counts.unmatched || 0);

  // Compose body in action-first order. Empty sections return '' and are
  // dropped by the join below, so a clean run scrolls cleanly.
  const sections = [
    buildHeadlineCallout(counts),
    buildRunNarrative(counts, opts),
    buildMismatchesSection(findings.mismatches),
    buildWrongPoSection(findings.wrongPO),
    buildUnmatchedSection(findings.unmatched, 'matrix'),
    buildUnmatchedSection(findings.unmatched, 'proper21'),
    buildKpiStrip(counts),
    totalAction > 0 && totalMatched > 0
      ? renderCleanLine(`${pluralize(totalMatched, 'line')} reconciled with no issues.`)
      : '',
  ].filter(Boolean);

  return renderDocument({
    title: 'Ship-vs-Invoice Reconciliation',
    subtitle: periodLabel,
    customer,
    reportDate,
    body: sections.join('\n'),
  });
}

module.exports = { renderShipVsInvoice };
