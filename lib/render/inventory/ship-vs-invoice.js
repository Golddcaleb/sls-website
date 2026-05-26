'use strict';

/**
 * lib/render/inventory/ship-vs-invoice.js
 * Signal Logic Systems LLC
 *
 * Report composer for the Blue Ash ship-vs-invoice reconciliation. Takes
 * the structured result from lib/analyze/inventory/ship-vs-invoice.js and
 * assembles an action-first HTML report.
 *
 * Section order (per Travis's spec for the Blue Ash rollout):
 *
 *   1. Headline callout      — items needing action, in plain words.
 *   2. KPI summary cards     — counts of the four buckets at a glance.
 *   3. Mismatches            — one card per row. Each card shows the side-
 *                              by-side comparison AND a pre-filled SQL
 *                              UPDATE block (ENT_PO_DETAILS +
 *                              ENT_TRANSACTION_LOG) that Travis can copy-
 *                              paste straight into Enterprise.
 *   4. Wrong PO              — item billed against the wrong PO key.
 *   5. Unmatched (Matrix)    — received, never invoiced.
 *   6. Unmatched (Proper 21) — invoiced, never received.
 *   7. Confirmed matches     — quiet table of the cleanly-reconciled lines.
 *
 * Why the SQL block lives in the report (not on a separate page): Travis
 * runs the corrections by hand after each reconciliation. Embedding the
 * statement next to the discrepancy eliminates the copy-from-spreadsheet
 * step and removes a class of "wrong PO_DTL_KEY pasted into wrong row"
 * mistakes.
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
  formatPrice,
  formatQty,
  formatQtyDelta,
  formatPriceDelta,
  pluralize,
} = require('../utils');

// ---------------------------------------------------------------------------
// Cell formatters
// ---------------------------------------------------------------------------

function htmlSpan(cls, text) {
  return `<span class="${escapeHtml(cls)}">${escapeHtml(text)}</span>`;
}

function qtyDeltaCell(n) {
  if (n == null || typeof n !== 'number' || !isFinite(n)) return formatQtyDelta(n);
  const cls = n > 0 ? 'delta-pos' : n < 0 ? 'delta-neg' : '';
  return cls ? htmlSpan(cls, formatQtyDelta(n)) : formatQtyDelta(n);
}

function priceDeltaCell(n) {
  if (n == null) return formatPriceDelta(n);
  const cls = n > 0 ? 'delta-pos' : n < 0 ? 'delta-neg' : '';
  return cls ? htmlSpan(cls, formatPriceDelta(n)) : formatPriceDelta(n);
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

/**
 * Format a number for inclusion in a SQL literal. Two-decimal where a
 * scalar is present; "NULL" when missing so the statement still parses
 * if it ever gets pasted without further edit.
 *
 * @param {number|null|undefined} n
 * @returns {string}
 */
function sqlNumber(n) {
  if (n == null || typeof n !== 'number' || !isFinite(n)) return 'NULL';
  return n.toFixed(2);
}

/**
 * Format a PO_DTL_KEY for SQL. Strings are quoted; pure-numeric keys are
 * emitted bare (Enterprise's PO_DTL_KEY column is typically integer).
 *
 * @param {string} key
 * @returns {string}
 */
function sqlKey(key) {
  const s = key == null ? '' : String(key).trim();
  if (!s) return '<<missing PO_DTL_KEY>>';
  if (/^\d+$/.test(s)) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Sorting helpers — biggest $ impact first
// ---------------------------------------------------------------------------

function mismatchImpact(r) {
  if (typeof r.value_delta === 'number') return Math.abs(r.value_delta);
  const qty = typeof r.qty_delta === 'number' ? r.qty_delta : 0;
  const p   = typeof r.price_delta === 'number' ? r.price_delta : 0;
  const m$  = typeof r.matrix_unit_price === 'number' ? r.matrix_unit_price : 0;
  const mQ  = typeof r.matrix_quantity   === 'number' ? r.matrix_quantity   : 0;
  return Math.abs(qty * m$) + Math.abs(p * mQ);
}

function unmatchedImpact(r) {
  if (typeof r.extended_price === 'number') return Math.abs(r.extended_price);
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
// Mismatch card — comparison grid + pre-filled SQL block
// ---------------------------------------------------------------------------

function reasonsBadges(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) return '';
  const labels = { quantity: 'Qty off', unit_price: 'Price off' };
  return reasons
    .map(r => `<span class="sls-pill sls-pill--danger">${escapeHtml(labels[r] || r)}</span>`)
    .join(' ');
}

function comparisonCell(label, value, extra) {
  const sub = extra ? `<span class="sls-cmp-sub">${extra}</span>` : '';
  return `
    <div class="sls-cmp-cell">
      <span class="sls-cmp-label">${escapeHtml(label)}</span>
      <span class="sls-cmp-value">${value}</span>
      ${sub}
    </div>`;
}

function buildSqlBlock(r) {
  const unit = sqlNumber(r.proper21_unit_price);
  const line = sqlNumber(r.proper21_extended_price);
  const keys = Array.isArray(r.matrix_po_dtl_keys) && r.matrix_po_dtl_keys.length > 0
    ? r.matrix_po_dtl_keys
    : [''];

  // One UPDATE pair per PO_DTL_KEY — when a single (PO, item) match
  // aggregates more than one Matrix receipt row, each receipt is its
  // own PO_DTL row in Enterprise and needs its own UPDATE.
  return keys.map(k => {
    const key = sqlKey(k);
    return `Update ENT_PO_DETAILS
Set UNIT_PRICE = ${unit}, LINE_PRICE = ${line}
Where PO_DTL_KEY = ${key} and bool_bitul = 0

Update ENT_TRANSACTION_LOG
Set LINE_VALUE = ${line}, LINE_SYSTEM_VALUE = ${line}
Where PO_DTL_KEY = ${key} and bool_bitul = 0`;
  }).join('\n\n');
}

function buildMismatchCard(r) {
  const reasons = reasonsBadges(r.reasons);
  const desc = r.description
    ? `<div class="sls-mm-desc">${escapeHtml(r.description)}</div>`
    : '';
  const keys = Array.isArray(r.matrix_po_dtl_keys) ? r.matrix_po_dtl_keys : [];
  const keyLine = keys.length > 0
    ? `<span class="sls-mm-key">PO_DTL_KEY ${keys.map(k => `<span class="mono">${escapeHtml(k)}</span>`).join(', ')}${keys.length > 1 ? ` <span class="muted">(${keys.length} receipt rows)</span>` : ''}</span>`
    : '<span class="sls-mm-key sls-mm-key--missing">PO_DTL_KEY missing — review before running SQL</span>';

  const grid = `
    <div class="sls-cmp-grid">
      ${comparisonCell('Matrix Qty',        escapeHtml(formatQty(r.matrix_quantity)))}
      ${comparisonCell('Invoice Qty',       escapeHtml(formatQty(r.proper21_quantity)))}
      ${comparisonCell('Δ Qty',             qtyDeltaCell(r.qty_delta))}
      ${comparisonCell('Matrix Unit',       escapeHtml(formatPrice(r.matrix_unit_price)))}
      ${comparisonCell('Invoice Unit',      escapeHtml(formatPrice(r.proper21_unit_price)))}
      ${comparisonCell('Δ Price',           priceDeltaCell(r.price_delta))}
      ${comparisonCell('Matrix Value',      escapeHtml(formatPrice(r.matrix_extended_price)))}
      ${comparisonCell('Invoice Value',     escapeHtml(formatPrice(r.proper21_extended_price)))}
      ${comparisonCell('Δ Value',           priceDeltaCell(r.value_delta))}
    </div>`;

  return `
    <article class="sls-mm-card">
      <header class="sls-mm-head">
        <div class="sls-mm-title">
          <span class="sls-mm-po mono">${escapeHtml(r.po || '—')}</span>
          <span class="sls-mm-item mono">${escapeHtml(r.item || '—')}</span>
        </div>
        <div class="sls-mm-flags">${reasons}</div>
      </header>
      ${desc}
      ${grid}
      <div class="sls-mm-keyline">${keyLine}</div>
      <pre class="sls-mm-sql"><code>${escapeHtml(buildSqlBlock(r))}</code></pre>
    </article>`;
}

function buildMismatchesSection(rows) {
  if (!rows || rows.length === 0) return '';
  const sorted = rows.slice().sort((a, b) => mismatchImpact(b) - mismatchImpact(a));

  const cards = sorted.map(buildMismatchCard).join('\n');

  return `
    <section class="sls-mm-wrap" id="mismatches">
      <div class="sls-mm-head-row">
        <h2 class="sls-mm-section-title">Mismatches — quantity or price disagree</h2>
        <p class="sls-mm-section-sub">Each card pairs the discrepancy with a pre-filled UPDATE block. Verify the figures, then paste the SQL into Enterprise.</p>
      </div>
      ${cards}
    </section>`;
}

// ---------------------------------------------------------------------------
// Other action sections (kept as tables — no SQL block needed)
// ---------------------------------------------------------------------------

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
      { key: 'description', label: 'Description' },
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

function identityImpact(r) {
  const qty = typeof r.quantity === 'number' ? r.quantity : 0;
  const ext = typeof r.extended_price === 'number' ? r.extended_price : 0;
  return Math.abs(ext) || Math.abs(qty);
}

function buildIdentityMismatchSection(rows) {
  if (!rows || rows.length === 0) return '';
  const sorted = rows.slice().sort((a, b) => identityImpact(b) - identityImpact(a));

  return renderTable({
    id: 'identity',
    title: 'Probable identity mismatches — same PO and dollars, different item code',
    sub: 'Both sides agree on the PO, quantity, and unit price; only the item code differs. Typically a receiver placeholder ("SPOTBUY") paired with the supplier’s real part number on the invoice.',
    columns: [
      { key: 'po',                  label: 'PO',                className: 'mono' },
      { key: 'matrix_item',         label: 'Matrix item',       className: 'mono' },
      { key: 'matrix_description',  label: 'Matrix description' },
      { key: 'proper21_item',       label: 'P21 item',          className: 'mono' },
      { key: 'proper21_description',label: 'P21 description' },
      { key: 'quantity',            label: 'Qty',     align: 'right', format: formatQty },
      { key: 'unit_price',          label: 'Unit $',  align: 'right', format: formatPrice },
      { key: 'extended_price',      label: 'Line $',  align: 'right', format: formatPrice },
      {
        key: 'matrix_po_dtl_keys',
        label: 'PO_DTL_KEY',
        className: 'mono',
        format: v => Array.isArray(v) && v.length ? v.map(escapeHtml).join(', ') : '<span class="muted">—</span>',
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

  const columns = [
    { key: 'po',          label: 'PO',          className: 'mono' },
    { key: 'item',        label: 'Item',        className: 'mono' },
    { key: 'description', label: 'Description' },
    { key: 'quantity',    label: 'Qty',         align: 'right', format: formatQty },
    { key: 'unit_price',  label: 'Unit $',      align: 'right', format: formatPrice },
    { key: 'extended_price', label: 'Line $',   align: 'right', format: formatPrice },
  ];

  // Matrix-side carries the Enterprise PO_DTL_KEY (from its PO Detail
  // column); surface it so an unmatched receipt is locatable in Enterprise.
  if (side === 'matrix') {
    columns.push({
      key: 'matrix_po_dtl_keys',
      label: 'PO_DTL_KEY',
      className: 'mono',
      format: v => Array.isArray(v) ? v.map(escapeHtml).join(', ') : '',
    });
  }

  return renderTable({
    id: side === 'matrix' ? 'unmatched-matrix' : 'unmatched-proper21',
    title,
    sub,
    columns,
    rows: sorted,
  });
}

function buildMatchesSection(rows) {
  if (!rows || rows.length === 0) return '';

  // Matches are the silent majority — show them last, light styling. Keep
  // the row count modest by trimming to the first 100 entries; a "and N
  // more" line covers the overflow without bloating the report.
  const MAX = 100;
  const total = rows.length;
  const shown = rows.slice(0, MAX);

  const sub = total > MAX
    ? `${total.toLocaleString('en-US')} lines reconciled cleanly — showing the first ${MAX}.`
    : `${total.toLocaleString('en-US')} ${total === 1 ? 'line' : 'lines'} reconciled cleanly.`;

  return renderTable({
    id: 'matches',
    title: 'Confirmed matches',
    sub,
    columns: [
      { key: 'po',                  label: 'PO',          className: 'mono' },
      { key: 'item',                label: 'Item',        className: 'mono' },
      { key: 'description',         label: 'Description' },
      { key: 'matrix_quantity',     label: 'Qty',         align: 'right', format: formatQty },
      { key: 'proper21_unit_price', label: 'Unit $',      align: 'right', format: formatPrice },
      { key: 'proper21_extended_price', label: 'Line $',  align: 'right', format: formatPrice },
    ],
    rows: shown,
  });
}

function buildKpiStrip(counts) {
  const c = counts || {};
  return renderKpiStrip([
    { label: 'Mismatches',  value: c.mismatch  || 0, tone: c.mismatch  ? 'danger' : 'ok',
      sub: 'Qty or price off' },
    { label: 'Wrong PO',    value: c.wrongPO   || 0, tone: c.wrongPO   ? 'warn'   : 'ok',
      sub: 'PO keyed differently' },
    { label: 'Identity',    value: c.identityMismatch || 0, tone: c.identityMismatch ? 'warn' : 'ok',
      sub: 'PO + $ agree, items don’t' },
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
  const action = (c.mismatch || 0) + (c.wrongPO || 0)
               + (c.identityMismatch || 0) + (c.unmatched || 0);
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
  if (c.mismatch)         parts.push(pluralize(c.mismatch,  'mismatch',  'mismatches'));
  if (c.wrongPO)          parts.push(pluralize(c.wrongPO,   'wrong-PO entry', 'wrong-PO entries'));
  if (c.identityMismatch) parts.push(pluralize(c.identityMismatch, 'identity mismatch', 'identity mismatches'));
  if (c.unmatched)        parts.push(pluralize(c.unmatched, 'unmatched line'));

  const body = parts.length
    ? `Found ${joinList(parts)}. The mismatch cards below include a pre-filled UPDATE block keyed to each PO_DTL_KEY — verify and run.`
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

  const matrixSeen = c.matrixRows || 0;
  const dropped = (c.matrixExcluded || 0) + (c.matrixSubtotals || 0);
  const matrixIn = matrixSeen - dropped;
  const p21In    = c.proper21Rows || 0;
  sentences.push(
    `Compared ${pluralize(matrixIn, 'Matrix receipt line')} against ${pluralize(p21In, 'Proper 21 invoice line')}.`
  );

  if (c.matrixSubtotals > 0) {
    sentences.push(
      `Dropped ${pluralize(c.matrixSubtotals, 'subtotal row')} from the Matrix export.`
    );
  }

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
// Inline CSS for the mismatch card (kept here, not in the shell, so the
// shell stays generic and other tools don't inherit table-card styling).
// ---------------------------------------------------------------------------

const MISMATCH_CARD_CSS = `
<style>
  .sls-mm-wrap { display: flex; flex-direction: column; gap: 1.25rem; }
  .sls-mm-head-row { margin-bottom: -.25rem; }
  .sls-mm-section-title {
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: 1.35rem;
    color: var(--text-primary);
  }
  .sls-mm-section-sub {
    color: var(--text-secondary);
    margin-top: .25rem;
    max-width: 70ch;
  }
  .sls-mm-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-left: 4px solid var(--danger);
    border-radius: 8px;
    padding: 1.1rem 1.25rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: .85rem;
  }
  .sls-mm-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .sls-mm-title {
    display: flex;
    gap: .6rem;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .sls-mm-po {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-weight: 600;
    color: var(--gold);
    font-size: 1rem;
  }
  .sls-mm-item {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    color: var(--text-primary);
    font-size: 1rem;
  }
  .sls-mm-flags { display: flex; gap: .35rem; flex-wrap: wrap; }
  .sls-mm-desc {
    color: var(--text-secondary);
    font-size: .9rem;
  }
  .sls-cmp-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: .5rem 1rem;
    background: var(--bg-card-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: .85rem 1rem;
  }
  .sls-cmp-cell {
    display: flex;
    flex-direction: column;
    gap: .1rem;
  }
  .sls-cmp-label {
    font-size: .68rem;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--text-muted);
    font-weight: 600;
  }
  .sls-cmp-value {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: .95rem;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .sls-cmp-value .delta-pos { color: var(--ok); }
  .sls-cmp-value .delta-neg { color: var(--danger); }
  .sls-mm-keyline {
    font-size: .85rem;
    color: var(--text-secondary);
  }
  .sls-mm-key { color: var(--text-secondary); }
  .sls-mm-key .mono { color: var(--gold); }
  .sls-mm-key--missing { color: var(--danger); }
  .sls-mm-sql {
    background: #0A0A0C;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    padding: .85rem 1rem;
    color: #E2E2E8;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: .82rem;
    line-height: 1.55;
    white-space: pre;
    overflow-x: auto;
    margin: 0;
  }
  @media (max-width: 720px) {
    .sls-cmp-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media print {
    .sls-mm-card {
      background: #FFFFFF;
      border: 1px solid #CCCCCC;
      border-left: 4px solid #B91C1C;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .sls-mm-po { color: #8A6914; }
    .sls-mm-item, .sls-mm-section-title { color: #111111; }
    .sls-mm-desc, .sls-mm-section-sub, .sls-mm-keyline, .sls-mm-key { color: #444444; }
    .sls-mm-key .mono { color: #8A6914; }
    .sls-cmp-grid { background: #FAFAFB; border-color: #DDDDDD; }
    .sls-cmp-label { color: #666666; }
    .sls-cmp-value { color: #111111; }
    .sls-mm-sql {
      background: #FAFAFB;
      color: #111111;
      border-color: #CCCCCC;
    }
  }
</style>`;

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

  // Error path — analyze layer refused the input.
  if (!result || !result.ok) {
    const msg = (result && result.error) || 'No reconciliation could be produced from the supplied files.';
    const body = renderCallout({
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

  const sections = [
    buildHeadlineCallout(counts),
    buildRunNarrative(counts, opts),
    buildKpiStrip(counts),
    buildMismatchesSection(findings.mismatches),
    buildWrongPoSection(findings.wrongPO),
    buildIdentityMismatchSection(findings.identityMismatches),
    buildUnmatchedSection(findings.unmatched, 'matrix'),
    buildUnmatchedSection(findings.unmatched, 'proper21'),
    buildMatchesSection(findings.matches),
  ].filter(Boolean);

  return renderDocument({
    title: 'Ship-vs-Invoice Reconciliation',
    subtitle: periodLabel,
    customer,
    reportDate,
    head: MISMATCH_CARD_CSS,
    body: sections.join('\n'),
  });
}

module.exports = { renderShipVsInvoice };
