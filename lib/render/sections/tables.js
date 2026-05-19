'use strict';

/**
 * lib/render/sections/tables.js
 * Signal Logic Systems LLC
 *
 * Generic table renderer for SLS reports. One table per actionable
 * bucket (mismatches, wrong PO, unmatched, etc.). The renderer is
 * deliberately dumb: it expects already-formatted cell strings from the
 * composer, plus per-column hints (alignment, classes) so the composer
 * controls presentation without each tool re-implementing styling.
 *
 * Column shape:
 *   { key, label, align?, format?, className? }
 *     key       — property name on each row
 *     label     — column header text
 *     align     — 'left' | 'right' (default 'left')
 *                  'right' adds the .num cell class for tabular numerics
 *     format    — (value, row) => string  (callers format here; no
 *                  formatting happens inside this module besides escaping)
 *     className — optional extra class applied to every cell in this column
 *
 * Row shape:
 *   plain object keyed by column `key`s. Anything not declared as a column
 *   is ignored.
 *
 * If `rows` is empty an empty-state message is rendered in place of the
 * table body so the section reads as a deliberate "nothing here" rather
 * than a broken render. Composers can suppress the section entirely by
 * not calling renderTable at all.
 */

const { escapeHtml } = require('../utils');

/**
 * @param {object}   opts
 * @param {string}   opts.title
 * @param {string}  [opts.sub]            Subtitle / short prose under the title.
 * @param {Array}    opts.columns
 * @param {Array}    opts.rows
 * @param {string}  [opts.emptyMessage='No items in this category.']
 * @param {string}  [opts.id]             Optional id for in-page anchors.
 * @returns {string} HTML
 */
function renderTable(opts) {
  const title   = opts.title || '';
  const sub     = opts.sub || '';
  const columns = Array.isArray(opts.columns) ? opts.columns : [];
  const rows    = Array.isArray(opts.rows) ? opts.rows : [];
  const empty   = opts.emptyMessage || 'No items in this category.';
  const idAttr  = opts.id ? ` id="${escapeHtml(opts.id)}"` : '';

  const head = `
      <div class="sls-table-head">
        <div class="sls-table-title">${escapeHtml(title)}</div>
        ${sub ? `<div class="sls-table-sub">${escapeHtml(sub)}</div>` : ''}
      </div>`;

  if (rows.length === 0 || columns.length === 0) {
    return `<section class="sls-table-wrap"${idAttr}>${head}
      <div class="sls-table-empty">${escapeHtml(empty)}</div>
    </section>`;
  }

  const thead = columns.map(col => {
    const cls = col.align === 'right' ? ' class="num"' : '';
    return `<th${cls}>${escapeHtml(col.label || col.key)}</th>`;
  }).join('');

  const tbody = rows.map(row => {
    const cells = columns.map(col => {
      const raw = row[col.key];
      const formatted = typeof col.format === 'function'
        ? col.format(raw, row)
        : (raw == null ? '' : String(raw));

      // Composer-supplied format() may legitimately need to emit HTML
      // (e.g. an inline class on a delta). Convention: a format() return
      // beginning with '<' is trusted HTML the composer is responsible
      // for escaping. Everything else is treated as plain text.
      const isHtml = typeof formatted === 'string' && formatted.startsWith('<');
      const content = isHtml ? formatted : escapeHtml(formatted);

      const classes = [];
      if (col.align === 'right') classes.push('num');
      if (col.className) classes.push(col.className);
      const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
      return `<td${cls}>${content}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `<section class="sls-table-wrap"${idAttr}>${head}
    <table class="sls-table">
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table>
  </section>`;
}

module.exports = { renderTable };
