'use strict';

/**
 * lib/render/report-builder.js
 * Signal Logic Systems LLC
 *
 * Shared HTML shell for every SLS report. Wraps a tool-specific body in
 * the SLS brand frame (header, footer, brand CSS, print stylesheet) and
 * returns a single self-contained .html document — no external CSS,
 * no JavaScript, no CDN fonts required to render.
 *
 * Governing spec: jfm-architecture.md §6 (Report Output).
 *
 * Design choices behind the shell:
 *
 *   - Self-contained. CSS is inlined in a <style> block. Google Fonts
 *     are <link>'d (and fall back to a system stack when offline) but
 *     no other network resources are referenced. The file opens in any
 *     modern browser with no internet connection.
 *
 *   - Dark on screen, light on paper. SLS brand is gold on black — that
 *     is what Travis saw in the demo. But reports get printed, archived,
 *     and emailed to non-SLS audiences, so @media print flips to a light
 *     palette that does not eat toner.
 *
 *   - No raw-data leakage in markup. The body string is the caller's
 *     responsibility; the shell does not synthesize anything from
 *     untrusted input. Callers must escape interpolated values via
 *     lib/render/utils.escapeHtml.
 *
 *   - Zero JS by default. A report should be a static artifact. If a
 *     future tool needs Chart.js, the embed point is the `head` slot in
 *     opts so it ships inline per report — never as a CDN dependency at
 *     render time.
 */

const { escapeHtml, formatDate } = require('./utils');

/**
 * Build the report HTML.
 *
 * @param {object}    opts
 * @param {string}    opts.title          Tool name for the <title> and header strapline.
 * @param {string}   [opts.customer]      Customer display name (header subtitle).
 * @param {Date}     [opts.reportDate]    Pinned report timestamp.
 * @param {string}    opts.body           Pre-rendered HTML for the report body
 *                                        (composed from sections/*).
 * @param {string}   [opts.subtitle]      Optional second header line (e.g. period range).
 * @param {string}   [opts.head]          Extra HTML to inject in <head> (rare —
 *                                        for tool-specific inline CSS overrides).
 * @returns {string}
 */
function renderDocument(opts) {
  const title       = opts.title || 'Signal Logic Systems Report';
  const customer    = opts.customer || '';
  const reportDate  = opts.reportDate instanceof Date ? opts.reportDate : new Date();
  const subtitle    = opts.subtitle || '';
  const body        = opts.body || '';
  const extraHead   = opts.head || '';

  const dateStr = formatDate(reportDate);
  const year    = reportDate.getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}${customer ? ' — ' + escapeHtml(customer) : ''}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Inter:wght@400;500;600&display=swap">
<style>${BASE_CSS}</style>
${extraHead}
</head>
<body class="sls-report">
  <header class="sls-header">
    <div class="sls-header-inner">
      <div class="sls-brand">
        <span class="sls-brand-mark">SLS</span>
        <span class="sls-brand-name">Signal Logic Systems</span>
      </div>
      <div class="sls-meta">
        <div class="sls-meta-title">${escapeHtml(title)}</div>
        ${customer ? `<div class="sls-meta-customer">${escapeHtml(customer)}</div>` : ''}
        ${subtitle ? `<div class="sls-meta-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        <div class="sls-meta-date">Report date · ${escapeHtml(dateStr)}</div>
        <button type="button" class="sls-print-btn" onclick="window.print()" aria-label="Export this report to PDF">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="6 9 6 2 18 2 18 9"></polyline>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
            <rect x="6" y="14" width="12" height="8"></rect>
          </svg>
          <span>Export PDF</span>
        </button>
      </div>
    </div>
  </header>

  <main class="sls-main">
    ${body}
  </main>

  <footer class="sls-footer">
    <div class="sls-footer-inner">
      <div>Signal Logic Systems · signallogicsystems.com</div>
      <div class="sls-footer-fineprint">
        Raw data is not retained by SLS. This report contains derived metrics only.
        © ${year} Signal Logic Systems LLC.
      </div>
    </div>
  </footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Inlined CSS
//
// Kept verbose-but-flat (no preprocessor variables besides CSS custom
// properties) so the rendered HTML stays self-contained and diff-friendly.
// Mirrors the public site's brand tokens from signallogicsystems-site/style.css.
// ---------------------------------------------------------------------------
const BASE_CSS = `
  :root {
    --gold:           #F4C542;
    --gold-hover:     #D4A017;
    --gold-deep:      #B8860B;
    --bg-black:       #0E0E10;
    --bg-card:        #141418;
    --bg-card-alt:    #1A1A1F;
    --border:         #2B2F36;
    --border-strong:  #3A3F48;
    --text-primary:   #F8F9FA;
    --text-secondary: #B5B5BE;
    --text-muted:     #7C7C85;
    --danger:         #F87171;
    --warn:           #F4C542;
    --info:           #7AB8FF;
    --ok:             #6EE7B7;
    --font-heading:   'Rajdhani', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --font-body:      'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
    --report-max:     1100px;
  }

  * , *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body.sls-report {
    background: var(--bg-black);
    color: var(--text-primary);
    font-family: var(--font-body);
    font-size: 14.5px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Header ─────────────────────────────────────────────────── */
  .sls-header {
    background: linear-gradient(180deg, #0E0E10 0%, #15151A 100%);
    border-bottom: 1px solid var(--border);
  }
  .sls-header-inner {
    max-width: var(--report-max);
    margin: 0 auto;
    padding: 2rem 1.5rem;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 2rem;
  }
  .sls-brand {
    display: flex;
    align-items: center;
    gap: .75rem;
  }
  .sls-brand-mark {
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: 1.5rem;
    letter-spacing: 2px;
    color: var(--bg-black);
    background: var(--gold);
    padding: .35rem .65rem;
    border-radius: 4px;
    line-height: 1;
  }
  .sls-brand-name {
    font-family: var(--font-heading);
    font-weight: 600;
    font-size: 1.15rem;
    color: var(--text-primary);
    letter-spacing: .5px;
  }
  .sls-meta { text-align: right; }
  .sls-meta-title {
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: 1.25rem;
    color: var(--text-primary);
  }
  .sls-meta-customer {
    font-family: var(--font-heading);
    font-weight: 600;
    color: var(--gold);
    margin-top: .15rem;
  }
  .sls-meta-subtitle {
    font-size: .85rem;
    color: var(--text-secondary);
    margin-top: .15rem;
  }
  .sls-meta-date {
    font-size: .75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1.2px;
    margin-top: .65rem;
  }

  /* ── Export PDF button ─────────────────────────────────────────
     Screen-only action that triggers the browser print dialog.
     Save-as-PDF is the standard "Destination" in every modern print
     dialog, so window.print() is the simplest path to a PDF without
     shipping a PDF-rendering library inside the report. */
  .sls-print-btn {
    display: inline-flex;
    align-items: center;
    gap: .4rem;
    margin-top: .9rem;
    padding: .45rem .85rem;
    background: transparent;
    color: var(--gold);
    border: 1.5px solid var(--gold);
    border-radius: 6px;
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: .78rem;
    letter-spacing: 1px;
    text-transform: uppercase;
    cursor: pointer;
    transition: background .15s ease, color .15s ease, transform .15s ease;
    line-height: 1;
  }
  .sls-print-btn:hover,
  .sls-print-btn:focus-visible {
    background: var(--gold);
    color: var(--bg-black);
    transform: translateY(-1px);
    outline: none;
  }
  .sls-print-btn svg { display: block; }

  /* ── Main ───────────────────────────────────────────────────── */
  .sls-main {
    max-width: var(--report-max);
    margin: 0 auto;
    padding: 2.5rem 1.5rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 2.5rem;
  }

  /* ── Section primitives (used by sections/*) ────────────────── */
  .sls-section-label {
    display: block;
    font-family: var(--font-body);
    font-weight: 600;
    font-size: .7rem;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: .75rem;
  }
  .sls-section-title {
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: 1.35rem;
    color: var(--text-primary);
    margin-bottom: .25rem;
  }
  .sls-section-lede {
    color: var(--text-secondary);
    margin-bottom: 1rem;
    max-width: 70ch;
  }

  /* ── Callouts (diagnostic-text) ─────────────────────────────── */
  .sls-callout {
    border: 1px solid var(--border);
    border-left: 4px solid var(--gold);
    background: var(--bg-card);
    border-radius: 8px;
    padding: 1.5rem 1.75rem;
  }
  .sls-callout-eyebrow {
    font-family: var(--font-body);
    font-weight: 600;
    font-size: .72rem;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--gold);
    display: block;
    margin-bottom: .4rem;
  }
  .sls-callout-headline {
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: clamp(1.5rem, 3vw, 2rem);
    line-height: 1.15;
    color: var(--text-primary);
    margin-bottom: .5rem;
  }
  .sls-callout-body {
    color: var(--text-secondary);
    font-size: .95rem;
    max-width: 70ch;
  }
  .sls-callout--ok       { border-left-color: var(--ok); }
  .sls-callout--ok       .sls-callout-eyebrow { color: var(--ok); }
  .sls-callout--warn     { border-left-color: var(--warn); }
  .sls-callout--danger   { border-left-color: var(--danger); }
  .sls-callout--danger   .sls-callout-eyebrow { color: var(--danger); }

  /* ── KPI strip ──────────────────────────────────────────────── */
  .sls-kpi-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1rem;
  }
  .sls-kpi {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: .15rem;
  }
  .sls-kpi-label {
    font-size: .7rem;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--text-muted);
    font-weight: 600;
  }
  .sls-kpi-value {
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: 1.75rem;
    color: var(--text-primary);
    line-height: 1.1;
  }
  .sls-kpi-sub {
    font-size: .78rem;
    color: var(--text-secondary);
  }
  .sls-kpi--ok      .sls-kpi-value { color: var(--ok); }
  .sls-kpi--warn    .sls-kpi-value { color: var(--gold); }
  .sls-kpi--danger  .sls-kpi-value { color: var(--danger); }

  /* ── Tables ─────────────────────────────────────────────────── */
  .sls-table-wrap {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .sls-table-head {
    padding: 1.1rem 1.25rem 0;
  }
  .sls-table-title {
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--text-primary);
  }
  .sls-table-sub {
    color: var(--text-secondary);
    font-size: .85rem;
    margin-top: .15rem;
  }
  .sls-table-empty {
    padding: 1rem 1.25rem 1.25rem;
    color: var(--text-muted);
    font-style: italic;
    font-size: .9rem;
  }
  .sls-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1rem;
    font-size: .88rem;
  }
  .sls-table thead th {
    text-align: left;
    font-family: var(--font-body);
    font-weight: 600;
    font-size: .7rem;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--text-muted);
    padding: .65rem 1rem;
    border-bottom: 1px solid var(--border-strong);
    background: var(--bg-card-alt);
  }
  .sls-table tbody td {
    padding: .7rem 1rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-primary);
    vertical-align: top;
  }
  .sls-table tbody tr:last-child td { border-bottom: none; }
  .sls-table .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .sls-table .mono {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: .85em;
  }
  .sls-table .delta-pos { color: var(--ok); }
  .sls-table .delta-neg { color: var(--danger); }
  .sls-table .muted     { color: var(--text-muted); }

  .sls-pill {
    display: inline-block;
    padding: .15rem .55rem;
    border-radius: 999px;
    font-size: .7rem;
    font-weight: 600;
    letter-spacing: .5px;
    text-transform: uppercase;
    background: rgba(244,197,66,.12);
    color: var(--gold);
    border: 1px solid rgba(244,197,66,.3);
  }
  .sls-pill--danger { background: rgba(248,113,113,.12); color: var(--danger); border-color: rgba(248,113,113,.3); }
  .sls-pill--info   { background: rgba(122,184,255,.12); color: var(--info);   border-color: rgba(122,184,255,.3); }

  /* ── Tiny "all clean" footer line ───────────────────────────── */
  .sls-clean-line {
    color: var(--text-muted);
    font-size: .88rem;
    text-align: center;
    padding: .5rem 0;
  }

  /* ── Footer ─────────────────────────────────────────────────── */
  .sls-footer {
    border-top: 1px solid var(--border);
    background: #0B0B0D;
  }
  .sls-footer-inner {
    max-width: var(--report-max);
    margin: 0 auto;
    padding: 1.5rem;
    font-size: .82rem;
    color: var(--text-muted);
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .sls-footer-fineprint { color: var(--text-muted); }

  /* ── Print: light palette, no toner waste ───────────────────── */
  @media print {
    .sls-print-btn { display: none !important; }
    body.sls-report {
      background: #FFFFFF;
      color: #111111;
    }
    .sls-header, .sls-footer { background: #FFFFFF; border-color: #DDDDDD; }
    .sls-brand-mark { background: #111111; color: #F4C542; }
    .sls-brand-name, .sls-meta-title, .sls-section-title,
    .sls-table-title, .sls-callout-headline, .sls-kpi-value { color: #111111; }
    .sls-meta-customer { color: #8A6914; }
    .sls-meta-subtitle, .sls-meta-date, .sls-section-lede,
    .sls-callout-body, .sls-kpi-sub, .sls-footer-inner,
    .sls-table-sub, .sls-clean-line { color: #444444; }
    .sls-callout, .sls-kpi, .sls-table-wrap {
      background: #FFFFFF;
      border: 1px solid #CCCCCC;
    }
    .sls-callout { border-left-width: 4px; }
    .sls-table thead th {
      background: #F4F4F6;
      color: #444444;
      border-bottom-color: #BBBBBB;
    }
    .sls-table tbody td { border-bottom-color: #E5E5E5; color: #111111; }
    .sls-table-wrap, .sls-callout, .sls-kpi { break-inside: avoid; page-break-inside: avoid; }
    .sls-main { padding: 1rem .5in; }
    .sls-table .delta-pos { color: #0D6B3E; }
    .sls-table .delta-neg { color: #B91C1C; }
    .sls-pill {
      background: transparent;
      color: #8A6914;
      border-color: #BBBBBB;
    }
    .sls-pill--danger { color: #B91C1C; }
    .sls-pill--info   { color: #1E4A8A; }
  }
`;

module.exports = { renderDocument };
