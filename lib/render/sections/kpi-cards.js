'use strict';

/**
 * lib/render/sections/kpi-cards.js
 * Signal Logic Systems LLC
 *
 * KPI strip — a row of small at-a-glance count/value cards. Used as a
 * supporting/reference element, not the lede. Tool composers should put
 * their action items above this strip; the strip exists to orient the
 * reader on the run as a whole, not to drive action.
 *
 * Card shape:
 *   { label, value, sub?, tone? }
 *     label  — short uppercase header ("MISMATCHES")
 *     value  — the headline figure as a pre-formatted string
 *               (callers format via lib/render/utils.formatCurrency etc.
 *                so this module stays type-agnostic)
 *     sub    — optional small caption under the value
 *     tone   — 'ok' | 'warn' | 'danger' | undefined
 *               sets the value color; defaults to neutral
 */

const { escapeHtml } = require('../utils');

const TONE_CLASS = {
  ok:     'sls-kpi--ok',
  warn:   'sls-kpi--warn',
  danger: 'sls-kpi--danger',
};

/**
 * @param {Array<{ label:string, value:string|number, sub?:string, tone?:string }>} cards
 * @returns {string} HTML
 */
function renderKpiStrip(cards) {
  const items = Array.isArray(cards) ? cards : [];
  if (items.length === 0) return '';

  const cells = items.map(c => {
    const toneClass = TONE_CLASS[c.tone] || '';
    const sub = c.sub ? `<span class="sls-kpi-sub">${escapeHtml(c.sub)}</span>` : '';
    return `
      <div class="sls-kpi ${toneClass}">
        <span class="sls-kpi-label">${escapeHtml(c.label)}</span>
        <span class="sls-kpi-value">${escapeHtml(c.value)}</span>
        ${sub}
      </div>`;
  }).join('');

  return `<section class="sls-kpi-strip">${cells}</section>`;
}

module.exports = { renderKpiStrip };
