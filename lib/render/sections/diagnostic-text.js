'use strict';

/**
 * lib/render/sections/diagnostic-text.js
 * Signal Logic Systems LLC
 *
 * Diagnostic prose primitives: the "what does it mean / what should I do"
 * narrative blocks that sit between the data sections. Per
 * jfm-architecture.md §6.2 (item 6), every SLS report carries a plain-
 * English diagnostic summary so the reader doesn't have to interpret
 * raw figures themselves.
 *
 * Two primitives:
 *
 *   renderCallout({ eyebrow, headline, body, tone })
 *     The lead callout that opens a report. Tone drives the left-border
 *     color: 'ok' (green) for a clean run, 'warn' (gold, default) for
 *     items needing review, 'danger' (red) for material exposure.
 *
 *   renderProse(paragraphs)
 *     A neutral wrapper for one or more paragraph strings. Used as the
 *     short narrative below the callout or above a table.
 *
 * The composer assembles the headline/body strings; this module does no
 * sentence construction itself. Why: the right words are tool-specific
 * (a JFM run talks about constraint stages; a ship-vs-invoice run talks
 * about lines and POs), and putting templates here would force every
 * tool through a shared vocabulary.
 */

const { escapeHtml } = require('../utils');

const TONE_CLASS = {
  ok:     'sls-callout--ok',
  warn:   'sls-callout--warn',
  danger: 'sls-callout--danger',
};

/**
 * @param {object} opts
 * @param {string} [opts.eyebrow]   Small uppercase label above the headline.
 * @param {string}  opts.headline   The big line ("12 items need your attention").
 * @param {string} [opts.body]      One-sentence elaboration under the headline.
 * @param {string} [opts.tone]      'ok' | 'warn' (default) | 'danger'
 * @returns {string} HTML
 */
function renderCallout(opts) {
  const eyebrow  = opts.eyebrow || '';
  const headline = opts.headline || '';
  const body     = opts.body || '';
  const tone     = TONE_CLASS[opts.tone] || TONE_CLASS.warn;

  return `<section class="sls-callout ${tone}">
    ${eyebrow ? `<span class="sls-callout-eyebrow">${escapeHtml(eyebrow)}</span>` : ''}
    <h1 class="sls-callout-headline">${escapeHtml(headline)}</h1>
    ${body ? `<p class="sls-callout-body">${escapeHtml(body)}</p>` : ''}
  </section>`;
}

/**
 * Render one or more paragraphs of body prose.
 *
 * @param {string|string[]} paragraphs
 * @returns {string} HTML
 */
function renderProse(paragraphs) {
  const arr = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
  const ps  = arr
    .filter(p => p && String(p).trim() !== '')
    .map(p => `<p class="sls-section-lede">${escapeHtml(p)}</p>`)
    .join('');
  return ps ? `<section>${ps}</section>` : '';
}

/**
 * Single-line "all clean" footer — used at the bottom of an action-led
 * report to acknowledge the silent majority of lines that reconciled
 * with no issues. Kept visually quiet so it does not compete with the
 * action sections.
 *
 * @param {string} text
 * @returns {string} HTML
 */
function renderCleanLine(text) {
  if (!text) return '';
  return `<div class="sls-clean-line">${escapeHtml(text)}</div>`;
}

module.exports = { renderCallout, renderProse, renderCleanLine };
