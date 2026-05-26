'use strict';

/**
 * lib/analyze/po-tracking/follow-up-triggers.js
 * Signal Logic Systems LLC
 *
 * Evaluates all active tracking records and produces a list of pending
 * email actions.
 *
 * Two stages, both keyed off configurable timers:
 *
 *   STAGE_1 — Acknowledgement chase
 *     Condition: days_since_order >= ack_timer AND ack_received_date is null
 *     Action:    Ask vendor to confirm receipt and provide ship dates.
 *
 *   STAGE_2 — Ship date confirmation
 *     Condition: days_until_estimated_ship_date <= follow_up_window
 *                AND no follow-up sent in the last `min_followup_gap_days`
 *     Action:    Ask vendor to confirm shipment or supply a revised date.
 *
 * A record marked stage=RECEIVED is never triggered.
 *
 * Output is just a *plan* — no email goes out from this module. The
 * caller (the netlify cron / scheduled function that wraps this) is
 * responsible for honoring the auto_send toggle:
 *
 *   auto_send === true   → pass each action to email-sender.sendEmail()
 *                          then stamp last_follow_up_date on the record
 *   auto_send === false  → enqueue each action via
 *                          sharepoint-writer.queueEmail() for human
 *                          review in the dashboard's Email Queue panel
 *
 * Keeping send-dispatch outside this analyzer keeps the module pure
 * (testable without any network) and lets the same trigger pipeline
 * power both modes.
 *
 * Default timers (overridable via config object):
 *   ack_timer:               3   business days from order_date
 *   follow_up_window:        2   days before estimated_ship_date
 *   min_followup_gap_days:   3   days between Stage 2 nudges
 */

const DEFAULTS = Object.freeze({
  ack_timer: 3,
  follow_up_window: 2,
  min_followup_gap_days: 3,
});

const MS_PER_DAY = 86_400_000;

function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / MS_PER_DAY);
}

/**
 * Count business days (Mon-Fri) between two dates, inclusive of the
 * later date. Cheap approximation — does not honor public holidays.
 * Good enough for nudging vendors.
 */
function businessDaysBetween(earlier, later) {
  if (later <= earlier) return 0;
  let count = 0;
  const cursor = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  const stop   = new Date(later.getFullYear(),   later.getMonth(),   later.getDate());
  while (cursor < stop) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Email templates
//
// Plain string interpolation per spec — no external template engine.
// Subject + body are returned to the caller as-is.
// ---------------------------------------------------------------------------

function formatLineItemList(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return '';
  const lines = lineItems.map(li => {
    if (!li || !li.item_name) return '';
    const qty = li.quantity ? ` (qty ${li.quantity}${li.unit ? ' ' + li.unit : ''})` : '';
    return `  - ${li.item_name}${qty}`;
  }).filter(Boolean);
  return lines.length ? `\n\n${lines.join('\n')}\n` : '';
}

function stage1Email(record) {
  const itemList = formatLineItemList(record.line_items);
  const subject = `Following up on PO ${record.po_number}`;
  const body =
    `Hi ${record.vendor || 'team'}, following up on PO ${record.po_number} placed on ${formatDate(record.order_date || record.timer_start)}. ` +
    `Could you please confirm receipt and provide estimated ship dates for each item?${itemList}` +
    `\nThank you.`;
  return { subject, body };
}

function stage2Email(record, itemName, estimatedDate) {
  const subject = `Checking in on PO ${record.po_number}`;
  const body =
    `Hi ${record.vendor || 'team'}, checking in on PO ${record.po_number}. ` +
    `Our records show estimated ship date of ${formatDate(estimatedDate)} for ${itemName}. ` +
    `Could you confirm shipment or provide a revised date if needed?\n\nThank you.`;
  return { subject, body };
}

function constraintAlertEmail(record, shift) {
  const subject = `Lead time alert — Job ${record.job_id || record.po_number}`;
  const body =
    `Heads up: the constraint item on Job ${record.job_id || '(unspecified)'} has shifted.\n\n` +
    `Previous: ${shift.previous_item} (${formatDate(shift.previous_date)})\n` +
    `New:      ${shift.new_item} (${formatDate(shift.new_date)})\n` +
    `Delta:    ${shift.delta_days >= 0 ? '+' : ''}${shift.delta_days} days\n\n` +
    `This is the new bottleneck for the job. Adjust downstream commitments accordingly.`;
  return { subject, body };
}

function formatDate(iso) {
  if (!iso) return '(date unknown)';
  const t = Date.parse(iso);
  if (isNaN(t)) return String(iso);
  return new Date(t).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Trigger evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate one record. Returns the action to take, or null if no action.
 *
 * @returns {{ type: 'STAGE_1'|'STAGE_2', recipient, po_number, line_items,
 *             subject, body, item_name?, _record } | null}
 */
function evaluateRecord(record, recipient, cfg, now) {
  if (!record || !record.po_number) return null;
  if (record.stage === 'RECEIVED')   return null;

  const today = now || new Date();

  // STAGE 1 — chase ack
  if (!record.ack_received_date) {
    const orderDate = record.order_date || record.timer_start;
    if (orderDate) {
      const t = new Date(orderDate);
      if (!isNaN(t.getTime())) {
        const bDays = businessDaysBetween(t, today);
        if (bDays >= cfg.ack_timer) {
          const tpl = stage1Email(record);
          return {
            type: 'STAGE_1',
            recipient,
            po_number: record.po_number,
            line_items: record.line_items || [],
            subject: tpl.subject,
            body: tpl.body,
            _record: record,
          };
        }
      }
    }
    return null;
  }

  // STAGE 2 — ship-date check
  // For each line item with an estimated ship date, see if we are
  // inside the follow_up_window. Send at most one Stage 2 per record
  // per evaluation cycle (the most urgent — closest to / past
  // estimated ship date).
  const ships = record.line_item_ship_dates || {};
  let candidate = null;
  for (const itemName of Object.keys(ships)) {
    const t = Date.parse(ships[itemName]);
    if (isNaN(t)) continue;
    const daysUntil = Math.ceil((t - today.getTime()) / MS_PER_DAY);
    if (daysUntil <= cfg.follow_up_window) {
      if (!candidate || daysUntil < candidate.daysUntil) {
        candidate = { itemName, date: ships[itemName], daysUntil };
      }
    }
  }
  if (!candidate) return null;

  // Respect the minimum gap between Stage 2 nudges so we don't pester
  // the vendor.
  if (record.last_follow_up_date) {
    const lastT = Date.parse(record.last_follow_up_date);
    if (!isNaN(lastT)) {
      const sinceDays = daysBetween(today, new Date(lastT));
      if (sinceDays < cfg.min_followup_gap_days) return null;
    }
  }

  const tpl = stage2Email(record, candidate.itemName, candidate.date);
  return {
    type: 'STAGE_2',
    recipient,
    po_number: record.po_number,
    line_items: record.line_items || [],
    item_name: candidate.itemName,
    subject: tpl.subject,
    body: tpl.body,
    _record: record,
  };
}

/**
 * Evaluate every active record and return all pending email actions.
 *
 * @param {object[]} records   Active tracking records.
 * @param {object} [config]
 * @param {number} [config.ack_timer]
 * @param {number} [config.follow_up_window]
 * @param {number} [config.min_followup_gap_days]
 * @param {(record:object) => string|null} [config.resolveRecipient]
 *        Function that returns the vendor email address for a record.
 *        Required for the action to have a `recipient` field; if
 *        omitted, actions are produced with recipient=null and the
 *        dispatch layer must fill it in.
 * @param {Date} [config.now]
 * @returns {{ ok:true, actions: object[] }}
 */
function evaluateAll(records, config) {
  if (!Array.isArray(records)) return { ok: false, error: 'records must be an array' };

  const cfg = Object.assign({}, DEFAULTS, config || {});
  const resolveRecipient = (config && config.resolveRecipient) || (() => null);

  const actions = [];
  for (const rec of records) {
    const recipient = resolveRecipient(rec);
    const a = evaluateRecord(rec, recipient, cfg, cfg.now);
    if (a) actions.push(a);
  }
  return { ok: true, actions };
}

module.exports = {
  evaluateAll,
  evaluateRecord,
  stage1Email,
  stage2Email,
  constraintAlertEmail,
  DEFAULTS,
};
