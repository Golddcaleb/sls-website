'use strict';

/**
 * lib/integrations/graph-api/email-parser.js
 * Signal Logic Systems LLC
 *
 * Extracts structured PO tracking data from a vendor email.
 *
 * Hold-the-calculator principle: this is the only point where raw email
 * content touches SLS code. Input is a Graph `message` resource (or any
 * object with subject/body/from/receivedDateTime). Output is a
 * structured JSON envelope ready for sharepoint-writer.js. The raw input
 * is *not* returned and not stored anywhere — the caller (inbox-monitor
 * or graph-webhook) must discard it after invoking parse().
 *
 * Extraction is intentionally conservative. We return only what we are
 * confident about and leave everything else null. The analyze stage
 * (follow-up-triggers.js) is allowed to make decisions on partial data
 * — for example, ack_received_date set with no ship date still moves a
 * record from STAGE_1 to STAGE_2.
 *
 * Status signal taxonomy:
 *   acknowledged  Vendor confirmed receipt of the order.
 *   shipped       Vendor reports items have shipped.
 *   delayed       Vendor reports a new / revised date.
 *   received      Customer-side confirmation of delivery.
 *   unknown       Flagged by keyword but no actionable status inferred.
 */

// ---------------------------------------------------------------------------
// Patterns (compiled once at module load)
// ---------------------------------------------------------------------------

// PO numbers vary across ERPs. Common shapes: "PO 12345", "PO# A-12345",
// "purchase order: PO-2026-0042". Captures the alnum/dash token that
// follows the leading keyword. Anchored to keyword to avoid matching
// arbitrary IDs in signatures.
const PO_NUMBER_PATTERNS = [
  /\bpo\s*[#:.]?\s*([a-z0-9][a-z0-9-]{1,24})\b/i,
  /\bpurchase\s+order\s*[#:.]?\s*([a-z0-9][a-z0-9-]{1,24})\b/i,
  /\border\s*[#:.]?\s*([a-z0-9][a-z0-9-]{2,24})\b/i,
];

// Dates — covers the four most common formats vendors use in body text.
// We deliberately keep this narrow to avoid matching version numbers,
// part numbers, etc.
const DATE_PATTERNS = [
  // MM/DD/YYYY or M/D/YY
  /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g,
  // YYYY-MM-DD
  /\b(\d{4}-\d{2}-\d{2})\b/g,
  // "January 5, 2026" / "Jan 5 2026"
  /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi,
];

const SHIP_DATE_CONTEXT = /(ship(?:ping|ment|s|ped)?|deliver(?:y|ed)?|eta|estimated|revised|expected|arrival|in\s+transit)/i;
const ACK_CONTEXT       = /(acknowledg|order\s+confirm(?:ed|ation)?|received\s+(?:your\s+)?(?:po|purchase\s+order|order))/i;
const SHIPPED_CONTEXT   = /(item\s+shipped|shipment\s+sent|shipped\s+on|shipped\s+via|has\s+shipped|have\s+shipped|tracking\s+(?:number|#)|dispatched|in\s+transit)/i;
const DELAYED_CONTEXT   = /(delay(?:ed)?|backorder|out\s+of\s+stock|push(?:ed)?\s+(?:back|out)|revised\s+(?:date|eta|ship)|new\s+(?:date|eta|ship\s+date))/i;
const RECEIVED_CONTEXT  = /(was\s+delivered|has\s+been\s+delivered|package\s+delivered|received\s+(?:the\s+)?(?:shipment|package|delivery)|arrived\s+(?:today|yesterday|on)|signed\s+for)/i;

// Line-item line guesses: "1x Widget A", "Qty 3 Bolt M8", "Item: 12-3456 (50 ea)".
// Cheap heuristic — better than nothing for unstructured emails. The
// dashboard surface only treats these as hints; the authoritative
// line_items list comes from the ERP CSV.
const LINE_ITEM_PATTERNS = [
  /\b(?:item|part|sku)\s*[#:.]?\s*([a-z0-9][a-z0-9 _.\/-]{1,40})/gi,
  /\bqty\s*[:.]?\s*(\d+)\s+([a-z0-9][a-z0-9 _.\/-]{1,40})/gi,
  /\b(\d+)\s*(?:x|ea|each|pcs|pieces)\s+([a-z0-9][a-z0-9 _.\/-]{1,40})/gi,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip HTML to text. Conservative — we keep block boundaries (br/p) as
 * newlines so date proximity heuristics still work.
 */
function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse a date string in any of the supported formats to an ISO date,
 * or null if unparseable. Uses Date.parse for the heavy lifting — its
 * format support is wider than the regexes above.
 */
function toIso(raw) {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function findAllDates(text) {
  const hits = [];
  for (const pat of DATE_PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(text)) !== null) {
      hits.push({ raw: m[0], index: m.index });
    }
  }
  return hits;
}

function extractPoNumber(text) {
  for (const pat of PO_NUMBER_PATTERNS) {
    const m = pat.exec(text);
    if (m && m[1]) return m[1].toUpperCase();
  }
  return null;
}

function inferStatus(text) {
  // Order matters and is subtle. The phrase "received your PO" means
  // the vendor acknowledged the order — NOT that the customer received
  // delivery. The broader RECEIVED_CONTEXT pattern would otherwise
  // grab that. So we check the most specific signals first:
  //
  //   shipped     "shipped on", "tracking number", "in transit"
  //   delayed     "backorder", "revised date"
  //   acknowledged "received your PO", "order confirmation"
  //   received    "delivered", "arrived" (fallback — customer-side delivery)
  //
  // A vendor email that mentions both shipping and acknowledgement
  // (common pattern: "we received your PO and shipped item X") should
  // land as shipped — the more actionable signal wins.
  if (SHIPPED_CONTEXT.test(text))   return 'shipped';
  if (DELAYED_CONTEXT.test(text))   return 'delayed';
  if (ACK_CONTEXT.test(text))       return 'acknowledged';
  if (RECEIVED_CONTEXT.test(text))  return 'received';
  return 'unknown';
}

/**
 * Best-effort ship date extraction. We scan all dates in the text and
 * pick the one closest to a "ship/eta/deliver" keyword. Returns ISO
 * date string or null.
 */
function extractShipDate(text) {
  const dates = findAllDates(text);
  if (!dates.length) return null;

  // Score each date by proximity (chars) to a ship-context keyword.
  // Lower distance = higher relevance. Ignore dates with no nearby
  // context keyword — they're likely signatures, header dates, etc.
  let best = null;
  let bestDist = Infinity;

  for (const d of dates) {
    const windowStart = Math.max(0, d.index - 80);
    const windowEnd   = Math.min(text.length, d.index + d.raw.length + 80);
    const window = text.slice(windowStart, windowEnd);
    if (!SHIP_DATE_CONTEXT.test(window)) continue;

    const keywordMatch = SHIP_DATE_CONTEXT.exec(window);
    const dist = Math.abs((d.index - windowStart) - keywordMatch.index);
    if (dist < bestDist) {
      bestDist = dist;
      best = d.raw;
    }
  }

  return best ? toIso(best) : null;
}

function extractLineItemHints(text) {
  const hints = [];
  for (const pat of LINE_ITEM_PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(text)) !== null) {
      if (m[2]) {
        // qty + name pattern
        hints.push({ item_name: String(m[2]).trim(), quantity: Number(m[1]) || null, unit: null });
      } else if (m[1]) {
        hints.push({ item_name: String(m[1]).trim(), quantity: null, unit: null });
      }
      if (hints.length >= 20) break; // hard cap
    }
    if (hints.length >= 20) break;
  }

  // De-dupe on item_name (case-insensitive).
  const seen = new Set();
  const out = [];
  for (const h of hints) {
    const k = h.item_name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}

/**
 * Pull a sensible vendor display name from the Graph `from` payload.
 * Falls back to email address localpart if no display name.
 */
function extractVendor(message) {
  const from = message && message.from && message.from.emailAddress;
  if (!from) return null;
  if (from.name && from.name.trim()) return from.name.trim();
  if (from.address) {
    const m = String(from.address).match(/^([^@]+)@/);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a Graph message into a structured tracking-record envelope.
 *
 * Input:
 *   message.subject            string
 *   message.from.emailAddress  { name, address }
 *   message.receivedDateTime   ISO string
 *   message.body.contentType   'html' | 'text'
 *   message.body.content       string
 *
 * Output (all fields optional except extracted_at and source):
 *   {
 *     extracted_at,        // ISO timestamp of parse
 *     source,              // 'email'
 *     vendor,              // string | null
 *     po_number,           // string | null  — UPPER-cased
 *     status_signal,       // 'acknowledged' | 'shipped' | 'delayed' | 'received' | 'unknown'
 *     estimated_ship_date, // ISO date | null
 *     ack_received_date,   // ISO date | null (set when status=acknowledged)
 *     received_date,       // ISO date | null (set when status=received)
 *     line_item_hints,     // [{ item_name, quantity, unit }]
 *     subject,             // string  — kept for audit display only
 *     received_at,         // ISO ts  — when Outlook received the message
 *   }
 */
function parse(message) {
  if (!message || typeof message !== 'object') {
    return { ok: false, error: 'parse(): message is required' };
  }

  const subject = String(message.subject || '');
  const body = message.body || {};
  const rawBodyText = body.contentType === 'html'
    ? htmlToText(body.content)
    : String(body.content || '');

  // We search subject + body. Subject often carries the PO number;
  // body carries the date and status signals.
  const combined = `${subject}\n${rawBodyText}`;

  const status = inferStatus(combined);
  const shipDate = extractShipDate(combined);

  // received_at comes from the message envelope — independent of any
  // dates the vendor mentioned in the body.
  const receivedAt = message.receivedDateTime || new Date().toISOString();
  const receivedIso = (() => {
    const t = Date.parse(receivedAt);
    return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
  })();

  const envelope = {
    extracted_at: new Date().toISOString(),
    source: 'email',
    vendor: extractVendor(message),
    po_number: extractPoNumber(combined),
    status_signal: status,
    estimated_ship_date: shipDate,
    ack_received_date:   status === 'acknowledged' ? receivedIso : null,
    received_date:       status === 'received'     ? receivedIso : null,
    line_item_hints: extractLineItemHints(rawBodyText),
    subject,
    received_at: receivedAt,
  };

  return { ok: true, envelope };
}

module.exports = {
  parse,
  // Exported for unit tests / diagnostics.
  htmlToText,
  extractPoNumber,
  extractShipDate,
  inferStatus,
};
